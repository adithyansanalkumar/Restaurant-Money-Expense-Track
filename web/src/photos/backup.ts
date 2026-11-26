import { db } from '../db/db';
import { AuthNeeded, Offline, currentEmail } from '../sync/auth';
import { ensureFolder, uploadBlob } from '../sync/drive';
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

async function doBackup(): Promise<number> {
  const shared = await db.settings.get('shared');
  if (!shared || shared.deleted || !shared.photoBackup) return 0;
  if ((await db.meta.get('adoptPending'))?.value) return 0;
  if (!(await currentEmail())) return 0;
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
