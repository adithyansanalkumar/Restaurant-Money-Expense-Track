import { db } from '../db/db';
import { reloadSettings, saveShared } from '../settings/store';
import { Offline, currentEmail, getAccessToken } from './auth';
import { ensureFolder, findFile, shareFile, shareFolder, type Id } from './drive';
import { FOLDER_NAME, LEDGER_NAME, clearAdoptPending, dropLocalShared, eraseLocalBooks, resetLedgerState, restoreLocalShared, resolveLedgerRef, setLedgerRef, syncFresh, type LedgerRef, type SyncStatusCode } from './sync';

/**
 * How Join picks the shared ledger: 'file' = pick ledger.json itself; 'folder' = pick the shared
 * "Restaurant Accounts" folder, then find ledger.json in it.
 */
// 'folder' caveat: with the drive.file scope, picking a folder may not grant access to the files
// inside it (ledger.json), so findFile can come back empty. 'file' is the safe default.
export const JOIN_MODE: 'file' | 'folder' = 'file';

const PICKER_JS = 'https://apis.google.com/js/api.js';
const JSON_MIME = 'application/json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class InvalidEmail extends Error {
  constructor() { super('Invalid email address'); this.name = 'InvalidEmail'; }
}
export class NotOwner extends Error {
  constructor() { super('Only the owner can share'); this.name = 'NotOwner'; }
}
export class PickerCancelled extends Error {
  constructor() { super('Picker cancelled'); this.name = 'PickerCancelled'; }
}
export class NoLedger extends Error {
  constructor() { super('No ledger.json found'); this.name = 'NoLedger'; }
}
/** The joined ledger has no restaurant (shared settings) in it. */
export class NoRestaurant extends Error {
  constructor() { super('That ledger has no restaurant yet'); this.name = 'NoRestaurant'; }
}
export class JoinSyncFailed extends Error {
  constructor(public status: SyncStatusCode) { super(`Could not sync the shared ledger (${status})`); this.name = 'JoinSyncFailed'; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Simple check (something@domain.tld, no spaces); Google does the real validation. */
export function isValidEmail(email: string): boolean {
  const e = email.trim();
  return e.length <= 254 && EMAIL_RE.test(e);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const storedRef = async () => (await db.meta.get('ledgerRef'))?.value as LedgerRef | undefined;

/**
 * The owner is the account stored as ownerEmail when the restaurant was set up. A restaurant set
 * up signed out has none: then this phone is the owner unless it joined someone else's ledger.
 */
export async function isOwner(): Promise<boolean> {
  const shared = await db.settings.get('shared');
  if (shared?.ownerEmail) {
    const me = await currentEmail();
    return !!me && same(me, shared.ownerEmail);
  }
  return !(await storedRef())?.joined;
}

/** Owner only. Gives `email` edit access to the ledger folder (or the file, for a ref without one). */
export async function inviteByEmail(email: string): Promise<void> {
  const addr = email.trim();
  if (!isValidEmail(addr)) throw new InvalidEmail();
  if (!(await isOwner())) throw new NotOwner();
  const ref = await resolveLedgerRef();
  if (ref.folderId) await shareFolder(ref.folderId, addr);
  else if (ref.fileId) await shareFile(ref.fileId, addr);
  else throw new NoLedger();
  await rememberInvited(addr);
}

/** Keeps a small "who has access" list in shared settings. Never while adoptPending; best effort. */
async function rememberInvited(addr: string): Promise<void> {
  try {
    if ((await db.meta.get('adoptPending'))?.value) return;
    const shared = await db.settings.get('shared');
    if (!shared || shared.deleted) return;
    const list = shared.sharedWith ?? [];
    if (list.some((e) => same(e, addr))) return;
    await saveShared({ sharedWith: [...list, addr] });
  } catch { /* the invite itself went out */ }
}

/** This account's own "Restaurant Accounts" folder (a joined phone's exports and photos go here). */
export function ownFolderId(): Promise<Id> {
  return ensureFolder(FOLDER_NAME);
}

/**
 * Where this phone keeps its Bills and Exports subfolders: the ledger folder for the owner,
 * this account's own "Restaurant Accounts" folder for a joined phone.
 */
export async function ledgerParentFolder(): Promise<Id> {
  const ref = await storedRef();
  if (ref && !ref.joined && ref.folderId) return ref.folderId;
  return ownFolderId();
}

// ---------------- Google Picker ----------------
let apiLoading: Promise<void> | null = null;

function loadApiJs(): Promise<void> {
  if ((window as any).gapi?.load) return Promise.resolve();
  if (apiLoading) return apiLoading;
  apiLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PICKER_JS;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { apiLoading = null; s.remove(); reject(new Offline('Could not load Google Picker')); };
    document.head.appendChild(s);
  });
  return apiLoading;
}

async function loadPicker(): Promise<any> {
  const w = window as any;
  if (!w.google?.picker) {
    await loadApiJs();
    await new Promise<void>((resolve, reject) => {
      w.gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Offline('Could not load Google Picker')) });
    });
  }
  return w.google.picker;
}

/** Shows the Picker; resolves with the picked item's id. */
async function pick(mode: 'file' | 'folder', token: string): Promise<string> {
  const key = import.meta.env.VITE_PICKER_API_KEY as string | undefined;
  const appId = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;
  if (!key || !appId) throw new Error('Picker is not configured: set VITE_PICKER_API_KEY and VITE_GOOGLE_APP_ID');
  const P = await loadPicker();
  let view: any;
  if (mode === 'folder') {
    view = new P.DocsView(P.ViewId.FOLDERS).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME);
  } else {
    view = new P.DocsView(P.ViewId.DOCS).setMimeTypes(JSON_MIME);
    if (typeof view.setQuery === 'function') view = view.setQuery(LEDGER_NAME);
  }
  return new Promise<string>((resolve, reject) => {
    const picker = new P.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(key)
      .setAppId(appId) // with drive.file, picking grants this app access to the item
      .setCallback((data: Record<string, any>) => {
        const action = data[P.Response.ACTION];
        if (action === P.Action.PICKED) {
          const id = data[P.Response.DOCUMENTS]?.[0]?.[P.Document.ID];
          if (id) resolve(id); else reject(new PickerCancelled());
        } else if (action === P.Action.CANCEL) {
          reject(new PickerCancelled());
        }
      })
      .build();
    picker.setVisible(true);
  });
}

/** Live (not deleted) entries on this phone: Join asks what to do with them first. */
export async function countLocalEntries(): Promise<number> {
  return db.entries.filter((e) => !e.deleted).count();
}

/**
 * Join: pick the shared ledger (JOIN_MODE), store it as a joined ref (dropping the old ref and
 * last-sync), then sync it down. Never writes shared settings: they come from the ledger. A local
 * shared row (phone used signed out) is removed raw first; other local rows merge in. If the sync
 * fails, or the ledger has no restaurant, that row is put back and the joined ref dropped.
 * eraseLocal: the phone's own books are erased first (Join asked). Clears adoptPending on success.
 * Throws PickerCancelled, NoLedger, NoRestaurant or JoinSyncFailed.
 */
export async function openShared(mode: 'file' | 'folder' = JOIN_MODE, opts: { eraseLocal?: boolean } = {}): Promise<void> {
  const token = await getAccessToken();
  const id = await pick(mode, token);
  let ref: LedgerRef;
  if (mode === 'folder') {
    const f = await findFile(LEDGER_NAME, id);
    if (!f) throw new NoLedger();
    ref = { folderId: id, fileId: f.id, joined: true };
  } else {
    ref = { fileId: id, joined: true };
  }
  // "erase them first": only once a ledger was picked, raw (no tombstones), still signed in
  if (opts.eraseLocal) await eraseLocalBooks();
  await resetLedgerState(); // bumps the generation: nothing earlier may write from here on
  const dropped = await dropLocalShared(); // before the ref exists, so no sync can push it
  await setLedgerRef(ref);
  const r = await syncFresh(true);
  const rollback = async () => {
    await resetLedgerState();
    if (dropped) await restoreLocalShared(dropped);
    await reloadSettings();
  };
  if (r.status !== 'ok') {
    await rollback();
    throw new JoinSyncFailed(r.status);
  }
  const shared = await db.settings.get('shared');
  if (!shared || shared.deleted) {
    await rollback();
    throw new NoRestaurant();
  }
  await clearAdoptPending();
  await reloadSettings();
}
