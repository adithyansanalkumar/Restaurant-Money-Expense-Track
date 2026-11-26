import { db } from '../db/db';
import { reloadSettings, saveShared } from '../settings/store';
import { AuthNeeded, Offline, currentEmail, signIn, type SignInOptions } from './auth';
import { findFile, findFolder } from './drive';
import {
  FOLDER_NAME, LEDGER_NAME, clearAdoptPending, dropLocalShared, interruptSync, resetLedgerState,
  restoreLocalShared, setLedgerRef, syncFresh, syncNow, type SyncStatusCode,
} from './sync';

export type AdoptResult = 'adopted' | 'none' | Exclude<SyncStatusCode, 'ok' | 'pending'>;

/** With no ledger for this account, this phone is the owner: stamp ownerEmail on a local restaurant (if any). */
async function becomeOwner(): Promise<void> {
  await reloadSettings();
  const email = await currentEmail();
  const local = await db.settings.get('shared');
  if (email && local) await saveShared({ ownerEmail: email });
  await clearAdoptPending();
  if (local) void syncNow(); // a restaurant made signed out: its first upload (first run waits for Setup)
}

/**
 * After signing in with no ledger chosen (adoptPending): if this Google account already has a
 * ledger.json (e.g. Dad's new phone), sync it down FIRST and use its shared settings ('adopted').
 * 'none' = no ledger with a restaurant: this phone is the owner (ownerEmail set on a local
 * restaurant; on first run Setup follows). Lookup only: creates no folder.
 *
 * Before the first sync the local shared row (phone used signed out) is removed RAW, so the owner's
 * settings survive; other local rows merge in. If the sync fails (offline / error) the row is put
 * back, the ref dropped and adoptPending kept, so background sync stays off until a retry.
 * Only this and openShared clear adoptPending.
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
  if (!folderId || !fileId) {
    await becomeOwner();
    return 'none';
  }
  interruptSync(); // nothing that started earlier may write from here on
  const dropped = await dropLocalShared(); // before the ref exists, so no sync can push it
  await setLedgerRef({ folderId, fileId });
  const r = await syncFresh(true);
  const rollback = async () => {
    await resetLedgerState();
    if (dropped) await restoreLocalShared(dropped);
  };
  if (r.status !== 'ok') {
    await rollback();
    await reloadSettings();
    return r.status === 'pending' ? 'error' : r.status;
  }
  const shared = await db.settings.get('shared');
  if (!shared || shared.deleted) {
    // a ledger with no restaurant in it: keep ours, as the owner
    await rollback();
    await becomeOwner();
    return 'none';
  }
  await clearAdoptPending();
  await reloadSettings();
  return 'adopted';
}

export type SignInLaterResult = { email: string; result: AdoptResult | 'kept' };

/**
 * The one sign-in entry point for a phone already in use (Welcome, Home's "Sign in to sync",
 * Settings, Forgot PIN). With a ledger already chosen: sign in and sync ('kept'). Without: sign in,
 * then adoptExistingLedger. Throws ConsentRequired / AccountSwitch / EmailMismatch from signIn.
 */
export async function signInLater(opts: SignInOptions = {}): Promise<SignInLaterResult> {
  const { email } = await signIn(opts);
  if (await db.meta.get('ledgerRef')) {
    void syncNow();
    return { email, result: 'kept' };
  }
  return { email, result: await adoptExistingLedger() };
}
