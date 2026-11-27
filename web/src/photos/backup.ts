import { db } from '../db/db';
import { AuthNeeded, Offline, currentEmail } from '../sync/auth';
import { downloadByName, ensureFolder, findFolder, uploadBlob } from '../sync/drive';
import { ledgerParentFolder } from '../sync/share';

const quiet = (e: unknown) => e instanceof Offline || e instanceof AuthNeeded || ['Offline', 'AuthNeeded'].includes((e as Error | undefined)?.name ?? '');

let running: Promise<number> | null = null;
let rerun = false;

/**
 * Uploads each photo that is not backed up yet to the "Bills" subfolder, once, then marks it.
 * Only when the shared photoBackup setting is on, signed in and not waiting on adoption.
 * Offline / sign-in needed stop quietly. Returns how many were uploaded. One run at a time.
 */
export function backupPendingPhotos(): Promise<number> {
  if (running) {
    rerun = true; // the running pass may have read the setting before it changed: go once more after it
    return running;
  }
  running = (async () => {
    let total = 0;
    try {
      do {
        rerun = false;
        total += await doBackup();
      } while (rerun);
    } finally {
      running = null;
    }
    return total;
  })();
  return running;
}

const backupOn = async () => {
  const s = await db.settings.get('shared');
  return !!s && !s.deleted && !!s.photoBackup;
};

/** Photo backup is on, signed in, and not waiting on adoption. */
async function backupReady(): Promise<boolean> {
  if (!(await backupOn())) return false;
  if ((await db.meta.get('adoptPending'))?.value) return false;
  return !!(await currentEmail());
}

async function doBackup(): Promise<number> {
  if (!(await backupReady())) return 0;
  const todo = (await db.photos.orderBy('createdAt').toArray()).filter((p) => !p.backedUp);
  if (todo.length === 0) return 0;
  let n = 0;
  try {
    const folder = await ensureFolder('Bills', await ledgerParentFolder());
    for (const p of todo) {
      if (!(await backupOn())) break; // switched off mid-run
      await uploadBlob(`${p.id}.jpg`, folder, p.blob, 'image/jpeg');
      await db.photos.update(p.id, { backedUp: true }); // photos are not synced: a raw update
      n++;
    }
  } catch (e) {
    if (!quiet(e)) throw e;
  }
  return n;
}

// ---------------- lazy restore ----------------
const restoring = new Map<string, Promise<Blob | null>>();
// looked up this session and not found (e.g. the other person's photo): not asked again
const missing = new Set<string>();

/** test helper */
export function _resetRestore(): void {
  restoring.clear();
  missing.clear();
}

/**
 * A photo an entry references but this phone lacks (a new phone, or the cleared one): with photo
 * backup on and signed in, download `<photoId>.jpg` from this account's Bills folder and keep it
 * here (backedUp). Null when it is not available: backup off, signed out, offline, or not in this
 * account's Drive (the other person's photos stay in their own Drive). Never throws.
 */
export function restorePhoto(photoId: string): Promise<Blob | null> {
  const going = restoring.get(photoId);
  if (going) return going;
  const p = doRestore(photoId).catch(() => null).finally(() => { restoring.delete(photoId); });
  restoring.set(photoId, p);
  return p;
}

async function doRestore(photoId: string): Promise<Blob | null> {
  const local = await db.photos.get(photoId);
  if (local) return local.blob;
  if (missing.has(photoId) || !(await backupReady())) return null;
  try {
    const bills = await findFolder('Bills', await ledgerParentFolder());
    const blob = bills ? await downloadByName(`${photoId}.jpg`, bills) : null;
    if (!blob) { missing.add(photoId); return null; }
    const entry = await db.entries.filter((e) => e.photoId === photoId).first();
    const at = entry ? Date.parse(entry.date) : NaN;
    // photos are not synced: a raw put; it is in Drive already, so backedUp
    await db.photos.put({ id: photoId, blob, createdAt: Number.isFinite(at) ? at : Date.now(), backedUp: true });
    return blob;
  } catch (e) {
    if (!quiet(e)) missing.add(photoId);
    return null;
  }
}
