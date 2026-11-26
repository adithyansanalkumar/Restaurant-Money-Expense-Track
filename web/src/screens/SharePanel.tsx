import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import { t, useLanguage } from '../i18n';
import { primaryBtn } from '../lock/PinPad';
import { useSignIn } from '../ui/useSignIn';
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
  const { run, busy: signingIn, notice } = useSignIn();
  const [email, setEmail] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [invite, setInvite] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [e, o] = await Promise.all([currentEmail(), isOwner()]);
    setEmail(e);
    setOwner(o);
  }, []);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh, shared]);

  const doSignIn = async () => {
    setMsg(null);
    try { await run(); } catch { setMsg({ ok: false, text: t('auth.error') }); }
    await refresh();
  };
  const doSignOut = async () => {
    setMsg(null);
    await signOut();
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
            <button type="button" style={primaryBtn} disabled={signingIn} onClick={() => void doSignIn()}>{t('auth.signIn')}</button>
          </>}
      {notice && <div role="status" style={noticeText}>{notice}</div>}
      {email && owner && (
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
