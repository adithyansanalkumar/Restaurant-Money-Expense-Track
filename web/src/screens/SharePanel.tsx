import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import { t, useLanguage } from '../i18n';
import { primaryBtn } from '../lock/PinPad';
import { useSignInLater } from '../ui/useSignIn';
import { SignInPrompts } from '../ui/ConsentNotice';
import { adoptExistingLedger, type AdoptResult } from '../sync/onboard';
import { isAdoptPending } from '../sync/sync';
import { currentEmail, signOut } from '../sync/auth';
import { InvalidEmail, inviteByEmail, isOwner } from '../sync/share';
import { useSettings } from '../settings/store';
import { errorText, mutedText, noticeText, secondaryBtn } from '../ui/styles';

const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: '#C6D8E6' };
const heading: CSSProperties = { fontSize: 15, fontWeight: 800, color: '#FFFFFF' };

/**
 * Account and sharing. A temporary home on the Settings route until the full Settings screen
 * (Task 16 part B) embeds it. "Share with someone" shows for the owner only.
 */
export function SharePanel() {
  useLanguage();
  const { shared } = useSettings();
  const s = useSignInLater();
  const signingIn = s.busy;
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [invite, setInvite] = useState('');
  const [sending, setSending] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [e, o, p] = await Promise.all([currentEmail(), isOwner(), isAdoptPending()]);
      setEmail(e);
      setOwner(o);
      setPending(!!e && p);
    } catch { /* keep what is shown */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, shared]);

  const showResult = (r: AdoptResult | 'kept') => {
    if (r !== 'adopted' && r !== 'none' && r !== 'kept') setMsg({ ok: false, text: t('welcome.driveError') });
  };
  // Signing in later (phone used signed out): signInLater adopts this account's ledger (never
  // written over) or, with none, makes this phone the owner (ownerEmail).
  const doSignIn = async (viaReset = false) => {
    setMsg(null);
    setAdopting(true);
    try {
      const r = viaReset ? await s.resetAndRetry() : await s.run();
      if (r) showResult(r.result);
    } catch {
      setMsg({ ok: false, text: t('auth.error') });
    } finally {
      setAdopting(false);
    }
    await refresh();
  };
  const retryAdopt = async () => {
    setMsg(null);
    setAdopting(true);
    try { showResult(await adoptExistingLedger()); } catch { setMsg({ ok: false, text: t('welcome.driveError') }); } finally { setAdopting(false); }
    await refresh();
  };
  const doSignOut = async () => {
    setMsg(null);
    try { await signOut(); } catch { /* local sign-out still happened */ }
    await refresh();
  };
  const send = async () => {
    if (sending) return;
    setMsg(null);
    setSending(true);
    const addr = invite.trim();
    try {
      await inviteByEmail(addr);
      setMsg({ ok: true, text: t('share.sent', { email: addr }) });
      setInvite('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof InvalidEmail || (e as Error)?.name === 'InvalidEmail' ? t('share.invalid') : t('share.error') });
    } finally {
      setSending(false);
    }
  };

  return (
    <Glass style={{ borderRadius: 24, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, color: '#FFFFFF' }}>
      <div style={heading}>{t('share.account')}</div>
      {email
        ? <>
            <div style={{ ...mutedText, textAlign: 'left' }}>{t('auth.signedInAs', { email })}</div>
            <button type="button" style={secondaryBtn} onClick={() => void doSignOut()}>{t('auth.signOut')}</button>
          </>
        : <>
            <div style={{ ...mutedText, textAlign: 'left' }}>{t('share.notSignedIn')}</div>
            <button type="button" style={primaryBtn} disabled={signingIn || adopting} onClick={() => void doSignIn()}>{t('auth.signIn')}</button>
          </>}
      {!email && <SignInPrompts s={s} onContinue={() => void doSignIn()} onReset={() => void doSignIn(true)} />}
      {pending && (
        <>
          <div role="alert" style={errorText}>{t('share.pending')}</div>
          <button type="button" style={secondaryBtn} disabled={adopting} onClick={() => void retryAdopt()}>{t('share.retry')}</button>
        </>
      )}
      {email && owner && !pending && (
        <>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.12)' }} />
          <div style={heading}>{t('share.title')}</div>
          <div style={{ ...mutedText, textAlign: 'left' }}>{t('share.hint')}</div>
          <label htmlFor="share-email" style={label}>{t('share.email')}</label>
          <input id="share-email" className="field" type="email" inputMode="email" autoComplete="email" value={invite}
            onChange={(e) => { setInvite(e.target.value); setMsg(null); }}
            style={{ height: 46, borderRadius: 14, padding: '0 14px', font: '600 15px Inter, sans-serif', color: '#FFFFFF' }} />
          <button type="button" style={primaryBtn} disabled={sending} onClick={() => void send()}>{t('share.invite')}</button>
        </>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={msg.ok ? noticeText : errorText}>{msg.text}</div>}
    </Glass>
  );
}
