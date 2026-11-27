import { useCallback, useRef, useState } from 'react';
import { signIn, type SignInOptions } from '../sync/auth';
import { signInLater, type SignInLaterResult } from '../sync/onboard';
import { checkBeforeReset, resetPhone } from '../sync/sync';
import { reloadSettings } from '../settings/store';

export const isConsentRequired = (e: unknown) => (e as Error | undefined)?.name === 'ConsentRequired';
const isAccountSwitch = (e: unknown) => (e as Error | undefined)?.name === 'AccountSwitch';

/**
 * A sign-in function for screens, with the two prompts it can end in:
 * - consent: Google must be asked again (no refresh token). Show <SignInPrompts>: its button signs
 *   in again from the user's tap (browsers block popups without one).
 * - switchTo: another account than the one this phone's books belong to. <SignInPrompts> offers
 *   "Reset this phone" (erase local books, then sign in again) or Cancel (nothing changes).
 * run() resolves null for those two; other errors are thrown.
 */
export function useGuardedSignIn<T>(fn: (opts: SignInOptions) => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  // "Entries not yet synced will be lost": set after one best-effort sync of the current account
  const [switchWarn, setSwitchWarn] = useState(false);
  const lastOpts = useRef<SignInOptions>({});

  const run = useCallback(async (opts: SignInOptions = {}): Promise<T | null> => {
    lastOpts.current = opts;
    setBusy(true);
    setConsent(false);
    setSwitchTo(null);
    try {
      return await fn(opts);
    } catch (e) {
      if (isConsentRequired(e)) { setConsent(true); return null; }
      if (isAccountSwitch(e)) {
        setSwitchTo((e as Error & { email: string }).email);
        setSwitchWarn(false);
        void checkBeforeReset().then(setSwitchWarn, () => setSwitchWarn(true));
        return null;
      }
      throw e;
    } finally {
      setBusy(false);
    }
  }, [fn]);

  /** "Reset this phone": erase local books, then sign in again (still within the user's tap). */
  const resetAndRetry = useCallback(async (): Promise<T | null> => {
    setBusy(true);
    try {
      await resetPhone();
    } finally {
      setBusy(false);
    }
    try {
      return await run(lastOpts.current);
    } finally {
      await reloadSettings();
    }
  }, [run]);

  const cancelSwitch = useCallback(() => setSwitchTo(null), []);
  return { run, busy, consent, switchTo, switchWarn, resetAndRetry, cancelSwitch };
}

/** Plain sign-in (Join picks its ledger itself). */
export const useSignIn = () => useGuardedSignIn(signIn);
/** Sign in on a phone in use: adopts this account's ledger when none is chosen (see signInLater). */
export const useSignInLater = () => useGuardedSignIn<SignInLaterResult>(signInLater);
