import { useCallback, useState } from 'react';
import { signIn, type SignInOptions } from '../sync/auth';

export const isConsentRequired = (e: unknown) => (e as Error | undefined)?.name === 'ConsentRequired';

/**
 * signIn() for screens: tracks busy, and `consent` = Google must be asked again (the worker got
 * no refresh token). Then show <ConsentNotice>: its button signs in again from the user's tap,
 * because browsers block popups opened without one. run() still throws; callers ignore
 * ConsentRequired (isConsentRequired) instead of showing a generic error.
 */
export function useSignIn() {
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const run = useCallback(async (opts: SignInOptions = {}) => {
    setBusy(true);
    setConsent(false);
    try {
      return await signIn(opts);
    } catch (e) {
      if (isConsentRequired(e)) setConsent(true);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, consent };
}
