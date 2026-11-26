import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { db } from '../db/db';
import { Glass } from '../ui/Glass';
import { Segmented } from '../ui/Segmented';
import { SyncStatus } from '../ui/SyncStatus';
import { SignInPrompts } from '../ui/ConsentNotice';
import { useSignInLater } from '../ui/useSignIn';
import type { Route } from '../ui/router';
import { t, useLanguage, type Lang } from '../i18n';
import { COUNTRY_DEFAULTS, useSettings } from '../settings/store';
import { currentEmail, disconnectGoogle, signOut } from '../sync/auth';
import { adoptExistingLedger, type AdoptResult } from '../sync/onboard';
import { InvalidEmail, inviteByEmail, isOwner } from '../sync/share';
import { isAdoptPending, syncNow, useSyncStatus } from '../sync/sync';
import { backupPendingPhotos } from '../photos/backup';
import { biometricEnabled, clearPin, disableBiometric, enableBiometric, hasPin } from '../lock/lock';
import { PinSetup } from '../lock/PinSetup';
import { primaryBtn } from '../lock/PinPad';
import { errorText, mutedText, noticeText, secondaryBtn } from '../ui/styles';
import { CategoriesEditor } from './CategoriesEditor';
import { getGeminiKey, setGeminiKey } from '../ocr/gemini';

/** Google AI key field: saved on this phone only (device meta), never in shared settings. */
function GeminiKeyInput() {
  const [v, setV] = useState('');
  useEffect(() => { void getGeminiKey().then((k) => setV(k ?? '')).catch(() => {}); }, []);
  return (
    <div style={col}>
      <label style={label} htmlFor="gemini-key">{t('settings.geminiKey')}</label>
      <input id="gemini-key" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={v}
        onChange={(e) => setV(e.target.value)} onBlur={() => void setGeminiKey(v)}
        style={{ ...select, width: '100%', boxSizing: 'border-box' }} />
      <div style={hint}>{t('settings.geminiKeyHelp')}</div>
    </div>
  );
}

const CURRENCIES = ['EUR', 'CHF', 'GBP', 'INR', 'USD'];
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: '#C6D8E6' };
const heading: CSSProperties = { fontSize: 15, fontWeight: 800, color: '#FFFFFF' };
const card: CSSProperties = { borderRadius: 24, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, color: '#FFFFFF' };
const select: CSSProperties = { height: 46, borderRadius: 14, padding: '0 10px', font: '600 14px Inter, sans-serif', color: '#FFFFFF' };
const col: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const hint: CSSProperties = { ...mutedText, textAlign: 'left' };
const dangerBtn: CSSProperties = { ...secondaryBtn, borderColor: 'rgba(255,142,142,0.6)', color: '#FF8E8E' };

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Glass as="section" aria-label={title} style={card}>
      <h2 style={{ ...heading, margin: 0 }}>{title}</h2>
      {children}
    </Glass>
  );
}

/** An on/off switch row, 44px+ tall. */
function Switch({ on, label: text, hint: sub, disabled, onChange }: { on: boolean; label: string; hint?: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={text} disabled={disabled} onClick={() => onChange(!on)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: 0, border: 0, background: 'transparent', color: '#FFFFFF', textAlign: 'left', opacity: disabled ? 0.6 : 1 }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{text}</span>
        {sub && <span style={{ fontSize: 12, color: '#B3C8D9' }}>{sub}</span>}
      </span>
      <span aria-hidden="true" style={{ width: 52, height: 30, borderRadius: 15, background: on ? '#6FE3A0' : 'rgba(255,255,255,0.22)', position: 'relative', flex: 'none' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: 12, background: '#FFFFFF', transition: 'left .15s' }} />
      </span>
    </button>
  );
}

function NameInput({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { const n = v.trim(); if (!n) setV(value); else if (n !== value) onSave(n); };
  return (
    <input className="field" aria-label={t('setup.name')} value={v} disabled={disabled}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ height: 46, borderRadius: 14, padding: '0 14px', font: '800 18px Inter, sans-serif', color: '#FFFFFF' }} />
  );
}

export function Settings({ onGo }: { onGo: (r: Route) => void }) {
  useLanguage();
  const { shared, device, saveShared, saveDevice } = useSettings();
  const { status, revision } = useSyncStatus();
  const s = useSignInLater();
  const [email, setEmail] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [pending, setPending] = useState(false);
  const [hasRef, setHasRef] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adopting, setAdopting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [e, o, p, r] = await Promise.all([currentEmail(), isOwner(), isAdoptPending(), db.meta.get('ledgerRef')]);
      setEmail(e); setOwner(o); setPending(p); setHasRef(!!r);
    } catch { /* keep what is shown */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, shared, status, revision]);

  // Shared settings are never written while adoptPending is set (the ledger's own may be waiting).
  const save = async (p: Parameters<typeof saveShared>[0]) => {
    if (pending || (await isAdoptPending())) { setPending(true); return false; }
    try { await saveShared(p); return true; } catch { setMsg({ ok: false, text: t('settings.saveError') }); return false; }
  };

  // ---- sign in / out ----
  const showResult = (r: AdoptResult | 'kept') => {
    if (r !== 'adopted' && r !== 'none' && r !== 'kept') setMsg({ ok: false, text: t('welcome.driveError') });
  };
  const doSignIn = async (viaReset = false) => {
    setMsg(null); setAdopting(true);
    try {
      const r = viaReset ? await s.resetAndRetry() : await s.run();
      if (r) showResult(r.result);
    } catch { setMsg({ ok: false, text: t('auth.error') }); } finally { setAdopting(false); }
    await refresh();
  };
  const retryAdopt = async () => {
    setMsg(null); setAdopting(true);
    try {
      const r = await adoptExistingLedger();
      if (r === 'authNeeded') { await doSignIn(); return; } // session gone: sign in again
      showResult(r);
    } catch { setMsg({ ok: false, text: t('welcome.driveError') }); } finally { setAdopting(false); }
    await refresh();
  };
  const doSignOut = async () => {
    setMsg(null);
    try { await signOut(); } catch { /* local sign-out still happened */ }
    await refresh();
  };
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const doDisconnect = async () => {
    setMsg(null); setConfirmDisconnect(false);
    try { await disconnectGoogle(); } catch { setMsg({ ok: false, text: t('auth.error') }); }
    await refresh();
  };

  // ---- sharing ----
  const [invite, setInvite] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (sending) return;
    setMsg(null); setSending(true);
    const addr = invite.trim();
    try {
      await inviteByEmail(addr);
      setMsg({ ok: true, text: t('share.sent', { email: addr }) });
      setInvite('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof InvalidEmail || (e as Error)?.name === 'InvalidEmail' ? t('share.invalid') : t('share.error') });
    } finally { setSending(false); }
  };

  // ---- photo backup ----
  const togglePhotos = async (on: boolean) => {
    if (await save({ photoBackup: on }) && on) void backupPendingPhotos().catch(() => {});
  };

  // ---- app lock ----
  const [pin, setPin] = useState<boolean | null>(null);
  const [bio, setBio] = useState(false);
  const [pinMode, setPinMode] = useState<'idle' | 'setup' | 'remove'>('idle');
  const [bioMsg, setBioMsg] = useState(false);
  const loadLock = useCallback(async () => {
    try { const p = await hasPin(); setPin(p); setBio(p ? await biometricEnabled() : false); } catch { setPin(false); }
  }, []);
  useEffect(() => { void loadLock(); }, [loadLock]);
  const toggleBio = async (on: boolean) => {
    setBioMsg(false);
    if (!on) { await disableBiometric(); setBio(false); return; }
    const ok = await enableBiometric();
    setBio(ok);
    setBioMsg(!ok);
  };
  const removePin = async () => { await clearPin(); setPinMode('idle'); setBio(false); await loadLock(); };

  // owner, or a purely local restaurant (signed out, no ledger yet)
  const canEditRegion = owner || (!email && !hasRef);
  const roleText = !email ? t('settings.localOnly') : owner ? t('settings.owner') : t('settings.sharedRole');
  const sharedWith = shared?.sharedWith ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '0 auto', paddingBottom: 12 }}>
      <h1 style={{ margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 28, fontWeight: 800, color: '#FFFFFF' }}>{t('settings.title')}</h1>

      <Card title={t('settings.restaurant')}>
        {shared && canEditRegion
          ? <NameInput value={shared.restaurantName} disabled={pending} onSave={(n) => void save({ restaurantName: n })} />
          : <div style={{ fontSize: 20, fontWeight: 800 }}>{shared?.restaurantName}</div>}
        <div style={{ ...hint, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {email && <span>{email}</span>}
          <span style={{ padding: '2px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.14)', fontWeight: 700, color: '#FFFFFF' }}>{roleText}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <SyncStatus />
          <button type="button" style={{ ...secondaryBtn, alignSelf: 'auto', minHeight: 44, fontSize: 14 }} onClick={() => void syncNow()}>{t('settings.syncNow')}</button>
        </div>
        {pending && (
          <>
            <div role="alert" style={errorText}>{t('settings.pendingShared')}</div>
            <button type="button" style={secondaryBtn} disabled={adopting} onClick={() => void retryAdopt()}>{t('share.retry')}</button>
          </>
        )}
      </Card>

      {shared && (
        <Card title={t('settings.region')}>
          {canEditRegion ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <div style={col}>
                <label htmlFor="st-country" style={label}>{t('setup.country')}</label>
                <select id="st-country" className="field" style={select} value={shared.country} disabled={pending}
                  onChange={(e) => { const c = e.target.value; void save({ country: c, ...(COUNTRY_DEFAULTS[c] ? { currency: COUNTRY_DEFAULTS[c].currency } : {}) }); }}>
                  {Object.keys(COUNTRY_DEFAULTS).map((c) => <option key={c} value={c}>{t(`country.${c}` as 'country.FR')}</option>)}
                </select>
              </div>
              <div style={col}>
                <label htmlFor="st-cur" style={label}>{t('setup.currency')}</label>
                <select id="st-cur" className="field" style={select} value={shared.currency} disabled={pending} onChange={(e) => void save({ currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{t(`currency.${c}` as 'currency.EUR')}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div style={hint}>
              {t(`country.${shared.country}` as 'country.FR')} · {t(`currency.${shared.currency}` as 'currency.EUR')}. {t('settings.regionReadOnly')}
            </div>
          )}
        </Card>
      )}

      {shared && (
        <Card title={t('settings.language')}>
          <div style={col}>
            <label htmlFor="st-al" style={label}>{t('setup.appLanguage')}</label>
            <select id="st-al" className="field" style={select} value={device.appLanguage} onChange={(e) => void saveDevice({ appLanguage: e.target.value as Lang })}>
              <option value="en">{t('lang.en')}</option>
              <option value="fr">{t('lang.fr')}</option>
            </select>
          </div>
          <div style={col}>
            <span style={label}>{t('setup.billLanguage')}</span>
            <Segmented label={t('setup.billLanguage')} value={shared.billLanguage}
              onChange={(v) => { if (!pending) void save({ billLanguage: v }); }}
              options={[{ value: 'fra', label: t('lang.fra') }, { value: 'eng', label: t('lang.eng') }]} />
          </div>
          <div style={col}>
            <span style={label}>{t('setup.showTotals')}</span>
            <Segmented label={t('setup.showTotals')} value={shared.taxView}
              onChange={(v) => { if (!pending) void save({ taxView: v }); }}
              options={[{ value: 'incl', label: t('setup.incl') }, { value: 'excl', label: t('setup.excl') }]} />
          </div>
          <div style={col}>
            <span style={label}>{t('settings.firstDay')}</span>
            <Segmented label={t('settings.firstDay')} value={String(device.weekStart) as '0' | '1'}
              onChange={(v) => void saveDevice({ weekStart: Number(v) as 0 | 1 })}
              options={[{ value: '1', label: t('settings.monday') }, { value: '0', label: t('settings.sunday') }]} />
          </div>
        </Card>
      )}

      <CategoriesEditor />

      {email && owner && !pending && (
        <Card title={t('settings.sharing')}>
          <div style={label}>{t('settings.hasAccess')}</div>
          {sharedWith.length === 0
            ? <div style={hint}>{t('settings.nobodyYet')}</div>
            : <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                {sharedWith.map((e) => <li key={e}>{e}</li>)}
              </ul>}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.12)' }} />
          <div style={heading}>{t('share.title')}</div>
          <div style={hint}>{t('share.hint')}</div>
          <label htmlFor="share-email" style={label}>{t('share.email')}</label>
          <input id="share-email" className="field" type="email" inputMode="email" autoComplete="email" value={invite}
            onChange={(e) => { setInvite(e.target.value); setMsg(null); }}
            style={{ height: 46, borderRadius: 14, padding: '0 14px', font: '600 15px Inter, sans-serif', color: '#FFFFFF' }} />
          <button type="button" style={primaryBtn} disabled={sending} onClick={() => void send()}>{t('share.invite')}</button>
        </Card>
      )}

      {shared && (
        <Card title={t('settings.photoBackup')}>
          <Switch on={shared.photoBackup} label={t('settings.photoBackup')} hint={t('settings.photoBackupHint')} disabled={pending || !email}
            onChange={(v) => void togglePhotos(v)} />
          {!email && <div style={hint}>{t('settings.photoBackupSignIn')}</div>}
        </Card>
      )}

      <Card title={t('settings.lock')}>
        {pinMode === 'setup' ? (
          <>
            <PinSetup onDone={() => { setPinMode('idle'); void loadLock(); }} />
            <button type="button" style={secondaryBtn} onClick={() => setPinMode('idle')}>{t('settings.cancel')}</button>
          </>
        ) : (
          <>
            <div style={hint}>{pin ? t('settings.pinSet') : t('settings.pinNone')}</div>
            <button type="button" style={pin ? secondaryBtn : primaryBtn} disabled={pin === null} onClick={() => setPinMode('setup')}>
              {pin ? t('settings.changePin') : t('settings.setPin')}
            </button>
            {pin && pinMode === 'idle' && <button type="button" style={dangerBtn} onClick={() => setPinMode('remove')}>{t('settings.removePin')}</button>}
            {pin && pinMode === 'remove' && (
              <div role="alertdialog" aria-label={t('settings.removePin')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={noticeText}>{t('settings.removePinAsk')}</div>
                <button type="button" style={dangerBtn} onClick={() => void removePin()}>{t('settings.removePinYes')}</button>
                <button type="button" style={secondaryBtn} onClick={() => setPinMode('idle')}>{t('settings.cancel')}</button>
              </div>
            )}
            {pin && <Switch on={bio} label={t('settings.biometric')} onChange={(v) => void toggleBio(v)} />}
            {bioMsg && <div role="status" style={noticeText}>{t('settings.biometricUnavailable')}</div>}
          </>
        )}
      </Card>

      <Card title={t('settings.billReading')}>
        <div role="radiogroup" aria-label={t('settings.billReading')} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {([['device', 'settings.ocrDevice', 'settings.ocrDeviceHint'], ['gemini', 'settings.ocrGoogle', 'settings.ocrGoogleHint']] as const).map(([mode, l, h]) => (
            <button key={mode} type="button" role="radio" aria-checked={shared?.ocrMode === mode || (mode === 'device' && shared?.ocrMode !== 'gemini')}
              aria-label={t(l)} disabled={pending} onClick={() => void save({ ocrMode: mode })}
              style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: 0, border: 0, background: 'transparent', color: '#FFFFFF', textAlign: 'left', opacity: pending ? 0.6 : 1 }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, border: '2px solid #FFFFFF', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(shared?.ocrMode === mode || (mode === 'device' && shared?.ocrMode !== 'gemini')) && <span style={{ width: 10, height: 10, borderRadius: 5, background: '#6FE3A0' }} />}
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{t(l)}</span>
                <span style={{ fontSize: 12, color: '#B3C8D9' }}>{t(h)}</span>
              </span>
            </button>
          ))}
        </div>
        {shared?.ocrMode === 'gemini' && <GeminiKeyInput />}
      </Card>

      <Card title={t('settings.export')}>
        <div style={hint}>{t('settings.exportHint')}</div>
        <button type="button" style={secondaryBtn} onClick={() => onGo('reports')}>{t('settings.export')}</button>
      </Card>

      <Card title={t('settings.account')}>
        {email
          ? <>
              <div style={hint}>{t('auth.signedInAs', { email })}</div>
              <button type="button" style={secondaryBtn} onClick={() => void doSignOut()}>{t('auth.signOut')}</button>
            </>
          : <>
              <div style={hint}>{t('share.notSignedIn')}</div>
              <button type="button" style={primaryBtn} disabled={s.busy || adopting} onClick={() => void doSignIn()}>{t('auth.signIn')}</button>
              <SignInPrompts s={s} onContinue={() => void doSignIn()} onReset={() => void doSignIn(true)} />
            </>}
        <button type="button" style={secondaryBtn} onClick={() => onGo('join')}>{t('settings.openShared')}</button>
        {email && !confirmDisconnect && <button type="button" style={dangerBtn} onClick={() => setConfirmDisconnect(true)}>{t('settings.disconnect')}</button>}
        {email && confirmDisconnect && (
          <div role="alertdialog" aria-label={t('settings.disconnect')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={noticeText}>{t('settings.disconnectAsk')}</div>
            <button type="button" style={dangerBtn} onClick={() => void doDisconnect()}>{t('settings.disconnectYes')}</button>
            <button type="button" style={secondaryBtn} onClick={() => setConfirmDisconnect(false)}>{t('settings.cancel')}</button>
          </div>
        )}
      </Card>

      {msg && <div role={msg.ok ? 'status' : 'alert'} style={msg.ok ? noticeText : errorText}>{msg.text}</div>}
    </div>
  );
}
