import { useSyncExternalStore } from 'react';
import type { Table, Transaction } from 'dexie';
import { db } from '../db/db';
import { reloadSettings } from '../settings/store';
import type { Base } from '../domain/types';
import { AuthNeeded, Offline, currentEmail, getAccessToken } from './auth';
import { ensureFolder, findFile, findFolder, getVersion, listFiles, readJson, writeJson } from './drive';
import { LEDGER_TABLES, emptyLedger, merge, parseLedger, wins, canonical, type Ledger, type LedgerTable } from './merge';

export type SyncStatusCode = 'ok' | 'offline' | 'authNeeded' | 'error';
export interface SyncResult { status: SyncStatusCode; at: number; message?: string }
export interface SyncState {
  status: SyncStatusCode | 'idle';
  at: number | null;
  running: boolean;
  /** bumps whenever a sync changed local rows, so screens can reload */
  revision: number;
  message?: string;
}
/** createdHere: this phone created the file (so it re-checks that no older ledger exists). */
export interface LedgerRef { folderId: string; fileId: string | null; createdHere?: boolean }

export const FOLDER_NAME = 'Restaurant Accounts';
export const LEDGER_NAME = 'ledger.json';
const MAX_ATTEMPTS = 3;
const DEBOUNCE_MS = 5000;
const RETRY_MS = [30_000, 120_000, 600_000];

// ---------------- status store ----------------
let state: SyncState = { status: 'idle', at: null, running: false, revision: 0 };
const listeners = new Set<() => void>();
const setState = (p: Partial<SyncState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const getSyncState = (): SyncState => state;

export function useSyncStatus(): SyncState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getSyncState);
}

// ---------------- ledger location ----------------
const tbl = (t: LedgerTable) => db[t] as unknown as Table<Base, string>;

/**
 * Where ledger.json lives. Stored ref first; otherwise the "Restaurant Accounts" folder and the
 * ledger.json inside it (fileId null = create it on the first write). Task 16's join flow replaces
 * this lookup by storing a ref picked by the user (setLedgerRef).
 */
export async function resolveLedgerRef(): Promise<LedgerRef> {
  const stored = (await db.meta.get('ledgerRef'))?.value as LedgerRef | undefined;
  if (stored?.folderId && stored.fileId) return stored;
  const folderId = stored?.folderId ?? await ensureFolder(FOLDER_NAME);
  const found = await findFile(LEDGER_NAME, folderId);
  return { folderId, fileId: found?.id ?? null };
}

export async function setLedgerRef(ref: LedgerRef): Promise<void> {
  const value: LedgerRef = { folderId: ref.folderId, fileId: ref.fileId };
  if (ref.createdHere) value.createdHere = true;
  await db.meta.put({ key: 'ledgerRef', value });
}

/**
 * The canonical ledger is the oldest ledger.json in the oldest "Restaurant Accounts" folder.
 * For a ref marked createdHere (this phone created a ledger, or switched away from one it created),
 * returns that canonical one if it is a different file
 * (another phone created theirs at the same time and it was not listed yet), else null.
 */
async function olderLedger(ref: LedgerRef): Promise<LedgerRef | null> {
  const folder = await findFolder(FOLDER_NAME);
  if (folder && folder !== ref.folderId) {
    const f = await findFile(LEDGER_NAME, folder);
    if (f && f.id !== ref.fileId) return { folderId: folder, fileId: f.id };
  }
  const f = await findFile(LEDGER_NAME, ref.folderId);
  if (f && f.id !== ref.fileId) return { folderId: ref.folderId, fileId: f.id };
  return null;
}

// ---------------- local read / apply ----------------
async function readLocal(): Promise<Ledger> {
  return db.transaction('r', LEDGER_TABLES.map(tbl), async () => {
    const out = emptyLedger() as unknown as Record<LedgerTable, Base[]>;
    for (const t of LEDGER_TABLES) out[t] = await tbl(t).toArray();
    return out as unknown as Ledger;
  });
}

// The transaction the sync itself is writing in; hooks ignore writes made in it.
let applyingTx: Transaction | null = null;

/**
 * Writes merged rows raw (no restamping), and only where the merged row beats the CURRENT local
 * row read inside this same transaction, so an edit made while the sync was in flight survives.
 * Returns the tables that changed.
 */
async function applyMerged(merged: Ledger): Promise<Set<LedgerTable>> {
  const changed = new Set<LedgerTable>();
  await db.transaction('rw', LEDGER_TABLES.map(tbl), async (tx) => {
    applyingTx = tx;
    try {
      for (const t of LEDGER_TABLES) {
        const rows = merged[t] as Base[];
        if (!rows.length) continue;
        const current = await tbl(t).bulkGet(rows.map((r) => r.id));
        const winners = rows.filter((r, i) => !current[i] || wins(r, current[i]!));
        if (winners.length) {
          await tbl(t).bulkPut(winners);
          changed.add(t);
        }
      }
    } finally {
      applyingTx = null;
    }
  });
  return changed;
}

// ---------------- sync ----------------
async function doSync(): Promise<Omit<SyncResult, 'at'> & { at?: number }> {
  await getAccessToken(); // fail fast with AuthNeeded / Offline before touching anything
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let ref = await resolveLedgerRef();
    if (ref.fileId && ref.createdHere) {
      const older = await olderLedger(ref);
      // keep createdHere: the re-check is read-only, and listing lag may still hide the true oldest
      if (older) { ref = { ...older, createdHere: true }; await setLedgerRef(ref); }
    }
    const local = await readLocal();
    let remote: Ledger | null = null;
    let readVersion: string | null = null;
    if (ref.fileId) {
      const r = await readJson(ref.fileId);
      remote = parseLedger(r.data);
      readVersion = r.version;
    }
    const merged = merge(local, remote ?? emptyLedger());

    let version: string;
    let fileId: string;
    if (ref.fileId && remote && canonical(merged) === canonical(remote)) {
      // nothing new to push: don't bump the file version (saves the other phone a restart)
      version = readVersion!;
      fileId = ref.fileId;
    } else {
      // immediately before writing: has someone else written since we read?
      if (ref.fileId) {
        if ((await getVersion(ref.fileId)) !== readVersion) continue;
      } else if (await findFile(LEDGER_NAME, ref.folderId)) {
        continue; // the other phone created it meanwhile: merge with theirs instead of making a second one
      }
      const w = await writeJson(ref.fileId, LEDGER_NAME, ref.folderId, merged);
      if (!ref.fileId) {
        // we just created ledger.json: if another phone made one at the same time, the oldest wins
        const oldest = (await listFiles(LEDGER_NAME, ref.folderId, 2))[0];
        if (oldest && oldest.id !== w.id) {
          // keep createdHere so later syncs re-check: with listing lag the other phone may have
          // switched to OUR file, and only re-checking lets both settle on the true oldest
          await setLedgerRef({ folderId: ref.folderId, fileId: oldest.id, createdHere: true });
          continue; // re-read theirs and merge our rows into it
        }
        ref = { ...ref, createdHere: true };
      }
      version = w.version;
      fileId = w.id;
    }
    await setLedgerRef({ ...ref, fileId });
    const changed = await applyMerged(merged);
    const at = Date.now();
    await db.meta.put({ key: 'lastSync', value: { at, version } });
    if (changed.size) {
      setState({ revision: state.revision + 1 });
      if (changed.has('settings')) await reloadSettings();
    }
    return { status: 'ok', at };
  }
  return { status: 'error', message: `ledger.json kept changing (${MAX_ATTEMPTS} attempts)` };
}

const isErr = (e: unknown, cls: { new (...a: never[]): Error }, name: string) =>
  e instanceof cls || (e as Error | undefined)?.name === name;

let running: Promise<SyncResult> | null = null;

/** Never throws. Only one sync at a time: a call while one runs returns the running promise. */
export function syncNow(): Promise<SyncResult> {
  if (running) return running;
  setState({ running: true });
  const p = (async (): Promise<SyncResult> => {
    let r: Omit<SyncResult, 'at'> & { at?: number };
    try {
      r = await doSync();
    } catch (e) {
      if (isErr(e, AuthNeeded, 'AuthNeeded')) r = { status: 'authNeeded' };
      else if (isErr(e, Offline, 'Offline')) r = { status: 'offline' };
      else r = { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    if (r.status === 'error') console.warn('[sync]', r.message);
    const result: SyncResult = { ...r, at: r.at ?? Date.now() };
    running = null;
    setState({ running: false, status: result.status, at: result.at, message: result.message });
    planRetry(result.status);
    return result;
  })();
  running = p;
  return p;
}

// ---------------- scheduling ----------------
let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced: a sync 5 s after the last call. If a sync is running then, it queues another after it. */
export function scheduleSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (running) void running.then(() => scheduleSync());
    else void syncNow();
  }, DEBOUNCE_MS);
}

/** test helper: is a debounced sync armed? */
export const _pendingSync = (): boolean => timer !== null;

// After 'offline' / 'error', one retry with backoff (30 s, 2 min, then 10 min) until a sync succeeds.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay: number | null = null;
let retryCount = 0;

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = null;
}

function planRetry(status: SyncStatusCode): void {
  if (!onOnline) return; // only once the app started sync (startSync)
  clearRetry();
  if (status !== 'offline' && status !== 'error') { retryCount = 0; return; }
  const delay = RETRY_MS[Math.min(retryCount, RETRY_MS.length - 1)];
  retryCount++;
  retryDelay = delay;
  retryTimer = setTimeout(() => { retryTimer = null; retryDelay = null; void syncNow(); }, delay);
}

/** test helper: the armed retry's delay, or null. */
export const _retryDelay = (): number | null => retryDelay;

type HookFn = (...args: any[]) => void;
const hooks: { table: Table<Base, string>; type: 'creating' | 'updating' | 'deleting'; fn: HookFn }[] = [];
let onOnline: (() => void) | null = null;
let onVisible: (() => void) | null = null;

async function syncIfSignedIn(): Promise<void> {
  if (await currentEmail()) void syncNow();
  else if (!state.running) setState({ status: 'authNeeded' });
}

/** Call once at app open: write hooks, the online listener, the last sync time, and a first sync when signed in. */
export async function startSync(): Promise<void> {
  if (onOnline) return;
  for (const t of LEDGER_TABLES) {
    const table = tbl(t);
    for (const type of ['creating', 'updating', 'deleting'] as const) {
      // Dexie passes the transaction as the last argument of every hook
      const fn: HookFn = (...args) => {
        const tx = args[args.length - 1] as Transaction | undefined;
        if (applyingTx && tx === applyingTx) return;
        scheduleSync();
      };
      (table.hook as any)(type, fn);
      hooks.push({ table, type, fn });
    }
  }
  onOnline = () => { void syncIfSignedIn(); };
  window.addEventListener('online', onOnline);
  onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    void currentEmail().then((e) => { if (e) scheduleSync(); }, () => {});
  };
  document.addEventListener('visibilitychange', onVisible);
  const last = (await db.meta.get('lastSync'))?.value as { at: number } | undefined;
  if (last && state.status === 'idle') setState({ status: 'ok', at: last.at });
  await syncIfSignedIn();
}

/** Undo startSync (tests). */
export function stopSync(): void {
  for (const h of hooks.splice(0)) (h.table.hook as any)(h.type).unsubscribe(h.fn);
  if (onOnline) window.removeEventListener('online', onOnline);
  if (onVisible) document.removeEventListener('visibilitychange', onVisible);
  onOnline = null;
  onVisible = null;
  clearRetry();
  retryCount = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}
