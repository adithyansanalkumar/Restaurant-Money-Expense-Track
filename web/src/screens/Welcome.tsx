import { useEffect, useState } from 'react';
import { Glass } from '../ui/Glass';
import { t, useLanguage } from '../i18n';
import { primaryBtn } from '../lock/PinPad';
import { useSignInLater } from '../ui/useSignIn';
import { SignInPrompts } from '../ui/ConsentNotice';
import { adoptExistingLedger, type AdoptResult } from '../sync/onboard';
import { currentEmail, signOut } from '../sync/auth';
import { errorText, iconTile, mutedText, noticeText, screenCol, screenTitle, secondaryBtn } from '../ui/styles';

/**
 * First run, before Setup. Sign in: if this account already has a restaurant (same Google account
 * on a new phone), it is synced down and used as is (onDone); otherwise Setup as the owner.
 * Not now: Setup on this phone only. While signed in with the lookup not done (adoptPending),
 * "Not now" is not offered: Retry, or "Use without Google" (signs out first).
 */
export function Welcome({ onSetup, onDone }: { onSetup: () => void; onDone: () => void }) {
  useLanguage();
  const s = useSignInLater();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void currentEmail().then((e) => { if (live) setEmail(e); }, () => {});
    return () => { live = false; };
  }, []);

  const settle = (r: AdoptResult | 'kept') => {
    if (r === 'adopted') onDone();
    else if (r === 'none' || r === 'kept') onSetup();
    else {
      if (r === 'authNeeded') setEmail(null); // session gone: the next tap signs in again
      setError(t('welcome.driveError'));
    }
  };

  const start = async (viaReset = false) => {
    if (s.busy || checking) return;
    setError(null);
    setChecking(true);
    try {
      if (email && !viaReset) {
        settle(await adoptExistingLedger()); // already signed in: just (re)try the lookup
        return;
      }
      const r = viaReset ? await s.resetAndRetry() : await s.run();
      if (!r) return; // consent / account-switch prompt shown
      setEmail(r.email);
      settle(r.result);
    } catch {
      setError(t('auth.error'));
    } finally {
      setChecking(false);
    }
  };

  const useWithout = async () => {
    await signOut();
    setEmail(null);
    onSetup();
  };

  const busy = s.busy || checking;
  return (
    <div className="welcome" style={{ ...screenCol, justifyContent: 'center' }}>
      <Glass style={iconTile}>
        <svg aria-hidden="true" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10" /><path d="M17 21V3c-2 1.5-3 4-3 7v3h3" /></svg>
      </Glass>
      <div style={screenTitle}>{t('welcome.title')}</div>
      <div style={{ ...mutedText, fontSize: 14, marginTop: -6 }}>{t('welcome.subtitle')}</div>
      <Glass style={{ alignSelf: 'stretch', borderRadius: 28, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {email
          ? <button type="button" style={primaryBtn} disabled={busy} onClick={() => void start()}>
              {error ? t('welcome.retry') : t('welcome.continueAs', { email })}
            </button>
          : <button type="button" style={primaryBtn} disabled={busy} onClick={() => void start()}>{t('auth.signIn')}</button>}
        <SignInPrompts s={s} onContinue={() => void start()} onReset={() => void start(true)} />
        {checking && !s.busy && <div role="status" style={noticeText}>{t('welcome.checking')}</div>}
        {error && <div role="alert" style={errorText}>{error}</div>}
        {email
          ? <button type="button" style={secondaryBtn} disabled={busy} onClick={() => void useWithout()}>{t('welcome.useWithout')}</button>
          : <>
              <button type="button" style={secondaryBtn} disabled={busy} onClick={onSetup}>{t('welcome.notNow')}</button>
              <div style={mutedText}>{t('welcome.notNowHint')}</div>
            </>}
      </Glass>
    </div>
  );
}
