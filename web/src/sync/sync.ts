import { useSyncExternalStore } from 'react';
import type { Table, Transaction } from 'dexie';
import { db } from '../db/db';
import { reloadSettings } from '../settings/store';
import type { Base, SharedSettings } from '../domain/types';
import { AuthNeeded, Offline, currentEmail, getAccessToken, onAccountChange, signOut } from './auth';
import { ensureFolder, findFile, findFolder, getVersion, listFiles, readJson, writeJson } from './drive';
import { LEDGER_TABLES, emptyLedger, merge, parseLedger, wins, canonical, type Ledger, type LedgerTable } from './merge';

/** 'pending': signed in but adoptPending is set; nothing synced until adoption / join settles it. */
export type SyncStatusCode = 'ok' | 'offline' | 'authNeeded' | 'error' | 'pending';
/** code 'sharedGone': the joined (shared) ledger.json was deleted or trashed; Join must reopen it. */
export type SyncErrorCode = 'sharedGone';
export interface SyncResult { status: SyncStatusCode; at: number; message?: string; code?: SyncErrorCode }
export interface SyncState {
  status: SyncStatusCode | 'idle';
  at: number | null;
  running: boolean;
  /** bumps whenever a sync changed local rows, so screens can reload */
  revision: number;
  message?: string;
  code?: SyncErrorCode;
}
/**
 * createdHere: this phone created the file (so it re-checks that no older ledger exists).
 * joined: picked by the user (Join, someone else's ledger). Used as is: never re-checked or replaced.
 * Only a joined ref may lack folderId (a file picked on its own).
 */
export interface LedgerRef { folderId?: string; fileId: string | null; createdHere?: boolean; joined?: boolean }
type OwnRef = LedgerRef & { folderId: string };

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
 * Where ledger.json lives. A joined ref (picked in Join) is returned unchanged. Otherwise the stored
 * ref, or the "Restaurant Accounts" folder and the ledger.json inside it (fileId null = create it
 * on the first write).
 */
export async function resolveLedgerRef(): Promise<LedgerRef> {
  const stored = (await db.meta.get('ledgerRef'))?.value as LedgerRef | undefined;
  if (stored?.joined && stored.fileId) return stored;
  if (stored?.folderId && stored.fileId) return stored;
  const folderId = stored?.folderId ?? await ensureFolder(FOLDER_NAME);
  const found = await findFile(LEDGER_NAME, folderId);
  return { folderId, fileId: found?.id ?? null };
}

export async function setLedgerRef(ref: LedgerRef): Promise<void> {
  const value: LedgerRef = { fileId: ref.fileId };
  if (ref.folderId) value.folderId = ref.folderId;
  if (ref.joined) value.joined = true;
  else if (ref.createdHere) value.createdHere = true;
  await db.meta.put({ key: 'ledgerRef', value });
}

// Bumped by resetLedgerState: a sync that started before it must not write its old ref back.
let generation = 0;

/**
 * Forget where the ledger is (sign-out, account switch, join): clears meta 'ledgerRef' and
 * 'lastSync', the pending retry and debounce, and the shown sync time.
 */
export async function resetLedgerState(): Promise<void> {
  resetTimers();
  await db.meta.bulkDelete(['ledgerRef', 'lastSync', 'lastJoinedRef']);
}

function resetTimers(): void {
  generation++;
  clearRetry();
  retryCount = 0;
  if (timer) clearTimeout(timer);
  timer = null;
  setState({ status: 'idle', at: null, message: undefined, code: undefined });
}

// auth already deleted the meta keys; stop the timers here.
onAccountChange(() => resetTimers());

/**
 * The canonical ledger is the oldest ledger.json in the oldest "Restaurant Accounts" folder.
 * For a ref marked createdHere (this phone created a ledger, or switched away from one it created),
 * returns that canonical one if it is a different file
 * (another phone created theirs at the same time and it was not listed yet), else null.
 */
async function olderLedger(ref: OwnRef): Promise<LedgerRef | null> {
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
async function applyMerged(merged: Ledger, live: () => void): Promise<Set<LedgerTable>> {
  const changed = new Set<LedgerTable>();
  await db.transaction('rw', LEDGER_TABLES.map(tbl), async (tx) => {
    live(); // inside the transaction: a reset (Reset this phone, sign-out) since the last check aborts it
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

/**
 * Removes the local shared-settings row RAW (no tombstone, no restamp, sync hooks ignore it), so a
 * ledger this phone is about to adopt or join keeps its owner's settings. Returns the removed row.
 */
export async function dropLocalShared(): Promise<SharedSettings | undefined> {
  return db.transaction('rw', db.settings, async (tx) => {
    applyingTx = tx;
    try {
      const row = await db.settings.get('shared');
      if (row) await db.settings.delete('shared');
      return row;
    } finally {
      applyingTx = null;
    }
  });
}

/** Puts back a row removed by dropLocalShared (raw, as it was), unless a shared row arrived since. */
export async function restoreLocalShared(row: SharedSettings): Promise<void> {
  await db.transaction('rw', db.settings, async (tx) => {
    applyingTx = tx;
    try {
      if (!(await db.settings.get('shared'))) await db.settings.put(row);
    } finally {
      applyingTx = null;
    }
  });
}

// ---------------- sync ----------------
class Superseded extends Error {
  constructor() { super('The ledger changed during sync'); this.name = 'Superseded'; }
}

type DoSyncResult = Omit<SyncResult, 'at'> & { at?: number; wrote?: boolean };

async function doSync(bypassPending: boolean): Promise<DoSyncResult> {
  // signed in without a chosen ledger yet: no Drive calls until adoption / join decides (adoptPending)
  if (!bypassPending && (await db.meta.get('adoptPending'))?.value) return { status: 'pending' };
  const gen = generation;
  // every meta/local write below checks this first: after a reset, the old ledger is not ours any more
  const live = () => { if (gen !== generation) throw new Superseded(); };
  await getAccessToken(); // fail fast with AuthNeeded / Offline before touching anything
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    live();
    let ref = await resolveLedgerRef();
    if (!ref.joined && ref.fileId && ref.createdHere) {
      const older = await olderLedger(ref as OwnRef);
      // keep createdHere: the re-check is read-only, and listing lag may still hide the true oldest
      if (older) { ref = { ...older, createdHere: true }; live(); await setLedgerRef(ref); }
    }
    const local = await readLocal();
    let remote: Ledger | null = null;
    let readVersion: string | null = null;
    if (ref.fileId) {
      let r: { data: unknown; version: string };
      try {
        r = await readJson(ref.fileId);
      } catch (e) {
        if ((e as Error | undefined)?.name !== 'NotFound') throw e;
        // the shared ledger was deleted or trashed: only its owner's phone can bring it back
        if (ref.joined) return { status: 'error', code: 'sharedGone', message: 'The shared ledger.json is gone' };
        // our own ledger.json is gone (deleted / trashed): forget it and find or create it again;
        // this phone keeps the full replica, so the new file gets every row
        live();
        await db.meta.bulkDelete(['ledgerRef', 'lastSync']);
        continue;
      }
      remote = parseLedger(r.data);
      readVersion = r.version;
    }
    const merged = merge(local, remote ?? emptyLedger());

    let version: string;
    let fileId: string;
    let wrote = false;
    if (ref.fileId && remote && canonical(merged) === canonical(remote)) {
      // nothing new to push: don't bump the file version (saves the other phone a restart)
      version = readVersion!;
      fileId = ref.fileId;
    } else {
      // immediately before writing: has someone else written since we read?
      if (ref.fileId) {
        if ((await getVersion(ref.fileId)) !== readVersion) continue;
      } else if (await findFile(LEDGER_NAME, ref.folderId!)) {
        continue; // the other phone created it meanwhile: merge with theirs instead of making a second one
      }
      live();
      // parentId only matters when creating (fileId null), which only happens for our own folder
      const w = await writeJson(ref.fileId, LEDGER_NAME, ref.folderId ?? '', merged);
      if (!ref.fileId) {
        const folderId = ref.folderId!;
        // we just created ledger.json: if another phone made one at the same time, the oldest wins
        const oldest = (await listFiles(LEDGER_NAME, folderId, 2))[0];
        if (oldest && oldest.id !== w.id) {
          // keep createdHere so later syncs re-check: with listing lag the other phone may have
          // switched to OUR file, and only re-checking lets both settle on the true oldest
          live();
          await setLedgerRef({ folderId, fileId: oldest.id, createdHere: true });
          continue; // re-read theirs and merge our rows into it
        }
        ref = { ...ref, createdHere: true };
      }
      version = w.version;
      fileId = w.id;
      wrote = true;
    }
    live();
    await setLedgerRef({ ...ref, fileId });
    const changed = await applyMerged(merged, live);
    const at = Date.now();
    live();
    await db.meta.put({ key: 'lastSync', value: { at, version } });
    if (changed.size) {
      setState({ revision: state.revision + 1 });
      if (changed.has('settings')) await reloadSettings();
    }
    return { status: 'ok', at, wrote };
  }
  return { status: 'error', message: `ledger.json kept changing (${MAX_ATTEMPTS} attempts)` };
}

const isErr = (e: unknown, cls: { new (...a: never[]): Error }, name: string) =>
  e instanceof cls || (e as Error | undefined)?.name === name;

let running: Promise<SyncResult> | null = null;

/** Never throws. Only one sync at a time: a call while one runs returns the running promise. */
export function syncNow(): Promise<SyncResult> {
  return runSync(false);
}

function runSync(bypassPending: boolean): Promise<SyncResult> {
  if (running) return running;
  setState({ running: true });
  const p = (async (): Promise<SyncResult> => {
    let r: DoSyncResult;
    let superseded = false;
    try {
      r = await doSync(bypassPending);
    } catch (e) {
      if (e instanceof Superseded) { superseded = true; r = { status: 'error', message: e.message }; }
      else if (isErr(e, AuthNeeded, 'AuthNeeded')) r = { status: 'authNeeded' };
      else if (isErr(e, Offline, 'Offline')) r = { status: 'offline' };
      else r = { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    const { wrote, ...rest } = r;
    const result: SyncResult = { ...rest, at: r.at ?? Date.now() };
    running = null;
    if (superseded) {
      // reset while running: leave the reset state (idle, no retry) as it is
      setState({ running: false });
      return result;
    }
    if (r.status === 'pending') {
      // shown as "Not syncing yet — finish connecting"; no retry (the adoption lookup settles it)
      setState({ running: false, status: 'pending', message: undefined, code: undefined });
      return result;
    }
    if (r.status === 'error') console.warn('[sync]', r.message);
    setState({ running: false, status: result.status, at: result.at, message: result.message, code: result.code });
    planRetry(result.status);
    // Drive has no conditional write: another phone's write could land between our version check
    // and our write and be overwritten. One more pass re-reads and heals that (and finds nothing to
    // write when all is well, so it stops there).
    if (wrote && onOnline) scheduleSync();
    return result;
  })();
  running = p;
  return p;
}

/**
 * A sync that starts after any running one finished (so it sees a ref stored just now).
 * bypassPending: adoption / join syncing the ledger they just chose while adoptPending is still set.
 */
export async function syncFresh(bypassPending = false): Promise<SyncResult> {
  while (running) await running;
  return runSync(bypassPending);
}

export const clearAdoptPending = (): Promise<void> => db.meta.delete('adoptPending');
export const isAdoptPending = async (): Promise<boolean> => !!(await db.meta.get('adoptPending'))?.value;

/** Bump the generation (a running sync can't write any more) and stop timers. Adoption / join start with it. */
export function interruptSync(): void {
  resetTimers();
}

/** Any synced row changed after the last successful sync (or any row at all if never synced). */
export async function hasUnsyncedChanges(): Promise<boolean> {
  const last = (await db.meta.get('lastSync'))?.value as { at: number } | undefined;
  for (const t of LEDGER_TABLES) {
    const n = last ? await tbl(t).where('updatedAt').above(last.at).count() : await tbl(t).count();
    if (n > 0) return true;
  }
  return false;
}

async function hasLocalRows(): Promise<boolean> {
  for (const t of LEDGER_TABLES) if ((await tbl(t).count()) > 0) return true;
  return false;
}

/**
 * Before offering "Reset this phone": one best-effort sync of the current account (at most
 * timeoutMs). True = warn "Entries not yet synced will be lost": the sync did not succeed (and the
 * phone has rows), or rows changed after the last successful sync.
 */
export async function checkBeforeReset(timeoutMs = 10_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), timeoutMs); });
  try {
    const r = await Promise.race([syncNow(), timeout]);
    if (!r || r.status !== 'ok') return await hasLocalRows(); // couldn't confirm: warn unless empty
    return await hasUnsyncedChanges();
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Reset this phone" (switching to another Google account): signs out here, then erases the synced
 * tables, photos and ledger meta RAW (no hooks, no tombstones). Keeps device settings and the PIN.
 * The caller reloads settings when it is done.
 */
export async function resetPhone(): Promise<void> {
  resetTimers();
  await signOut();
  await clearBooks(['ledgerRef', 'lastSync', 'account', 'adoptPending', 'auth', 'lastJoinedRef']);
}

/** Erases the synced tables and photos RAW (no hooks, no tombstones), and these meta keys. */
async function clearBooks(metaKeys: string[]): Promise<void> {
  const tables = [...LEDGER_TABLES.map(tbl), db.photos, db.meta];
  await db.transaction('rw', tables, async (tx) => {
    applyingTx = tx;
    try {
      for (const t of LEDGER_TABLES) await tbl(t).clear();
      await db.photos.clear();
      if (metaKeys.length) await db.meta.bulkDelete(metaKeys);
    } finally {
      applyingTx = null;
    }
  });
  setState({ revision: state.revision + 1 });
}

/**
 * Join "erase them first": the same raw erase as resetPhone (nothing reaches any ledger as a
 * tombstone) but still signed in. Forgets the old ledger ref; the caller picks the new one.
 */
export async function eraseLocalBooks(): Promise<void> {
  resetTimers();
  await clearBooks(['ledgerRef', 'lastSync', 'lastJoinedRef']);
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
