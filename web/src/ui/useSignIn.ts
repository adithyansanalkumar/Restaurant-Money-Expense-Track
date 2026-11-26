import { useCallback, useState } from 'react';
import { signIn, type SignInOptions } from '../sync/auth';
import { t } from '../i18n';

/**
 * signIn() for screens: tracks busy, and shows "Please approve access again" while Google is
 * asked for consent a second time (the worker got no refresh token).
 */
export function useSignIn() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useCallback(async (opts: Omit<SignInOptions, 'onConsentRetry'> = {}) => {
    setBusy(true);
    setNotice(null);
    try {
      return await signIn({ ...opts, onConsentRetry: () => setNotice(t('auth.reconsent')) });
    } finally {
      setBusy(false);
      setNotice(null);
    }
  }, []);
  return { run, busy, notice };
}
