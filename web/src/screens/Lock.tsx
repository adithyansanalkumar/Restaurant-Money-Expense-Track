import { useCallback, useEffect, useState } from 'react';
import { Glass } from '../ui/Glass';
import { t, useLanguage } from '../i18n';
import { biometricEnabled, checkPin, clearPin, lockoutRemainingMs, unlockBiometric } from '../lock/lock';
import { PinPad, primaryBtn } from '../lock/PinPad';
import { currentEmail } from '../sync/auth';
import { isConsentRequired, useSignIn } from '../ui/useSignIn';
import { ConsentNotice } from '../ui/ConsentNotice';
import { errorText, linkBtn } from '../ui/styles';

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function Lock({ onUnlock }: { onUnlock: () => void }) {
  useLanguage();
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [bio, setBio] = useState(false);
  const [busy, setBusy] = useState(false);
  // "Forgot PIN?" only when this phone has a Google session to prove who you are.
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const { run: runSignIn, busy: signingIn, consent } = useSignIn();

  useEffect(() => {
    let live = true;
    void lockoutRemainingMs().then((ms) => { if (live) setRemaining(ms); });
    void biometricEnabled().then((b) => { if (live) setBio(b); });
    void currentEmail().then((e) => { if (live) setAuthEmail(e); }, () => {});
    return () => { live = false; };
  }, []);

  const forgot = async () => {
    if (!authEmail || signingIn) return;
    setForgotError(null);
    try {
      // expectEmail: a different account is refused without replacing this phone's session
      const r = await runSignIn({ expectEmail: authEmail });
      if (!sameEmail(r.email, authEmail)) throw Object.assign(new Error('mismatch'), { name: 'EmailMismatch' });
      await clearPin();
      onUnlock();
    } catch (e) {
      if (isConsentRequired(e)) return;
      setForgotError((e as Error | undefined)?.name === 'EmailMismatch'
        ? t('lock.forgotMismatch', { email: authEmail })
        : t('lock.forgotError'));
    }
  };

  useEffect(() => {
    if ((remaining ?? 0) <= 0) return;
    const id = setInterval(() => { void lockoutRemainingMs().then(setRemaining); }, 1000);
    return () => clearInterval(id);
  }, [(remaining ?? 0) > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const tryBio = useCallback(async () => { if (await unlockBiometric()) onUnlock(); }, [onUnlock]);

  const submit = async () => {
    if (busy || pin.length < 4) return;
    setBusy(true);
    try {
      if (await checkPin(pin)) { onUnlock(); return; }
      setWrong(true);
      setPin('');
      setRemaining(await lockoutRemainingMs());
    } finally { setBusy(false); }
  };

  const ready = remaining !== null;
  const locked = (remaining ?? 0) > 0;
  const bioBtn = bio ? (
    <button type="button" className="key" aria-label={t('lock.biometric')} onClick={() => void tryBio()}
      style={{ height: 54, minWidth: 44, width: '100%', borderRadius: 20, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 11v3a5 5 0 0 1-1 3M8 14a4 4 0 0 1 8 0c0 2-.5 4-1.5 6M5 14a7 7 0 0 1 14 0c0 2-.3 3.5-.8 5M3 10a9 9 0 0 1 18 0" /></svg>
    </button>
  ) : null;

  return (
    <div className="scene app-shell">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: '#FFFFFF', minHeight: 'calc(100vh - 140px)', justifyContent: 'center' }}>
        <Glass style={{ width: 76, height: 76, borderRadius: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg aria-hidden="true" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        </Glass>
        <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 26, fontWeight: 800 }}>{t('lock.title')}</div>
        <Glass style={{ alignSelf: 'stretch', borderRadius: 28, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          <div style={{ fontSize: 14, color: '#C6D8E6' }}>{t('lock.enter')}</div>
          <PinPad value={pin} onChange={(v) => { setPin(v); setWrong(false); }} disabled={!ready || locked || busy} shake={wrong} extra={bioBtn} />
          {locked
            ? <div role="alert" style={{ fontSize: 13, color: '#FF8E8E', textAlign: 'center' }}>{t('lock.locked', { s: Math.ceil((remaining ?? 0) / 1000) })}</div>
            : wrong && <div role="alert" style={{ fontSize: 13, color: '#FF8E8E' }}>{t('lock.wrong')}</div>}
          <button type="button" style={primaryBtn} disabled={!ready || locked || busy || pin.length < 4} onClick={() => void submit()}>{t('lock.unlock')}</button>
          {authEmail && (
            <button type="button" style={linkBtn} disabled={signingIn} onClick={() => void forgot()}>{t('lock.forgot')}</button>
          )}
          {consent && <ConsentNotice disabled={signingIn} onContinue={() => void forgot()} />}
          {forgotError && <div role="alert" style={errorText}>{forgotError}</div>}
        </Glass>
      </div>
    </div>
  );
}
