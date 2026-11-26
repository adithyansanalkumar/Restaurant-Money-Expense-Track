import { db } from '../db/db';
import { reloadSettings } from '../settings/store';
import { AuthNeeded, Offline, signOut } from './auth';
import { findFile, findFolder } from './drive';
import { FOLDER_NAME, LEDGER_NAME, dropLocalShared, resetLedgerState, restoreLocalShared, setLedgerRef, syncFresh, type SyncStatusCode } from './sync';

export type AdoptResult = 'adopted' | 'none' | Exclude<SyncStatusCode, 'ok'>;

/**
 * After signing in on a phone with no restaurant yet: if this Google account already has a
 * ledger.json (e.g. Dad's new phone), sync it down FIRST and use its shared settings ('adopted').
 * Nothing shared is written here. 'none' = no ledger for this account: run Setup as the owner.
 * Lookup only: creates no folder.
 * A local shared row (phone used signed out) is removed raw before the first sync so the owner's
 * settings survive; other local rows merge in. If that sync fails the row is put back and the phone
 * signed out, so no later background sync can push it over the owner's.
 */
export async function adoptExistingLedger(): Promise<AdoptResult> {
  let fileId: string | null = null;
  let folderId: string | null = null;
  try {
    folderId = await findFolder(FOLDER_NAME);
    if (folderId) fileId = (await findFile(LEDGER_NAME, folderId))?.id ?? null;
  } catch (e) {
    const name = (e as Error | undefined)?.name;
    if (e instanceof AuthNeeded || name === 'AuthNeeded') return 'authNeeded';
    if (e instanceof Offline || name === 'Offline') return 'offline';
    return 'error';
  }
  if (!folderId || !fileId) return 'none';
  await setLedgerRef({ folderId, fileId });
  const dropped = await dropLocalShared();
  const r = await syncFresh();
  if (r.status !== 'ok') {
    await resetLedgerState();
    if (dropped) {
      await restoreLocalShared(dropped);
      await signOut();
    }
    await reloadSettings();
    return r.status;
  }
  await reloadSettings();
  const shared = await db.settings.get('shared');
  return shared && !shared.deleted ? 'adopted' : 'none';
}
