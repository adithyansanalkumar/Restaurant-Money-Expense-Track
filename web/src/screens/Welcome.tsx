import { useState } from 'react';
import { Glass } from '../ui/Glass';
import { t, useLanguage } from '../i18n';
import { primaryBtn } from '../lock/PinPad';
import { useSignIn } from '../ui/useSignIn';
import { adoptExistingLedger } from '../sync/onboard';
import { errorText, iconTile, mutedText, noticeText, screenCol, screenTitle, secondaryBtn } from '../ui/styles';

/**
 * First run, before Setup. Sign in: if this account already has a restaurant (same Google account
 * on a new phone), it is synced down and used as is (onDone); otherwise Setup as the owner.
 * Not now: Setup on this phone only.
 */
export function Welcome({ onSetup, onDone }: { onSetup: () => void; onDone: () => void }) {
  useLanguage();
  const { run, busy, notice } = useSignIn();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy || checking) return;
    setError(null);
    try {
      await run();
    } catch {
      setError(t('auth.error'));
      return;
    }
    setChecking(true);
    try {
      const r = await adoptExistingLedger();
      if (r === 'adopted') onDone();
      else if (r === 'none') onSetup();
      else setError(t('welcome.syncError'));
    } catch {
      setError(t('welcome.syncError'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="welcome" style={{ ...screenCol, justifyContent: 'center' }}>
      <Glass style={iconTile}>
        <svg aria-hidden="true" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10" /><path d="M17 21V3c-2 1.5-3 4-3 7v3h3" /></svg>
      </Glass>
      <div style={screenTitle}>{t('welcome.title')}</div>
      <div style={{ ...mutedText, fontSize: 14, marginTop: -6 }}>{t('welcome.subtitle')}</div>
      <Glass style={{ alignSelf: 'stretch', borderRadius: 28, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button type="button" style={primaryBtn} disabled={busy || checking} onClick={() => void start()}>{t('auth.signIn')}</button>
        {notice && <div role="status" style={noticeText}>{notice}</div>}
        {checking && <div role="status" style={noticeText}>{t('welcome.checking')}</div>}
        {error && <div role="alert" style={errorText}>{error}</div>}
        <button type="button" style={secondaryBtn} disabled={busy || checking} onClick={onSetup}>{t('welcome.notNow')}</button>
        <div style={mutedText}>{t('welcome.notNowHint')}</div>
      </Glass>
    </div>
  );
}
