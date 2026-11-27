import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  // Saved shortly after each change and when the screen goes away: iOS often unmounts the screen
  // (tab tap) without blurring the field first, so blur alone could lose a pasted key.
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current === null) return;
    const key = pending.current;
    pending.current = null;
    void setGeminiKey(key).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    void getGeminiKey().then((k) => { if (live && pending.current === null) setV(k ?? ''); }).catch(() => {});
    return () => { live = false; flush(); };
  }, [flush]);
  const change = (key: string) => {
    setV(key);
    pending.current = key;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  };
  return (
    <div style={col}>
      <label style={label} htmlFor="gemini-key">{t('settings.geminiKey')}</label>
      <input id="gemini-key" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={v}
        onChange={(e) => change(e.target.value)} onBlur={flush}
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

/** A glass card; `plain` leaves out the visible heading when the page title already says it. */
function Card({ title, plain, children }: { title: string; plain?: boolean; children: ReactNode }) {
  return (
    <Glass as="section" aria-label={title} style={card}>
      {!plain && <h2 style={{ ...heading, margin: 0 }}>{title}</h2>}
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
    <input id="st-name" className="field" aria-label={t('setup.name')} value={v} disabled={disabled}
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [page, setPage] = useState<Page>('main');
  const open = (p: Page) => {
    setMsg(null); setPage(p);
    try { window.scrollTo(0, 0); } catch { /* not available in tests */ }
  };

  const refresh = useCallback(async () => {
    try {
      const [e, o, p] = await Promise.all([currentEmail(), isOwner(), isAdoptPending()]);
      setEmail(e); setOwner(o); setPending(p);
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
    if (r === 'needsJoin') { onGo('join'); return; } // someone else's restaurant: Join explains and reopens it
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

  // Spec §10: both people have equal rights over shared settings; only sharing is owner-only.
  // Nothing shared is written while adoptPending (save() refuses, the fields are disabled).
  const roleText = !email ? t('settings.localOnly') : owner ? t('settings.owner') : t('settings.sharedRole');
  const sharedWith = shared?.sharedWith ?? [];

  const ocr = shared?.ocrMode === 'gemini' ? 'gemini' : 'device';
  const lockValue = pin === null ? '' : !pin ? t('settings.lockOff') : bio ? t('settings.lockBio') : t('settings.lockPin');
  const sharedValue = sharedWith.length === 0 ? t('settings.sharedNobody')
    : sharedWith.length === 1 ? shortName(sharedWith[0]) : t('settings.sharedMore', { name: shortName(sharedWith[0]), n: sharedWith.length - 1 });

  const message = msg && <div role={msg.ok ? 'status' : 'alert'} style={msg.ok ? noticeText : errorText}>{msg.text}</div>;
  const pendingNotice = pending && (
    <>
      <div role="alert" style={errorText}>{t('settings.pendingShared')}</div>
      <button type="button" style={secondaryBtn} disabled={adopting} onClick={() => void retryAdopt()}>{t('share.retry')}</button>
    </>
  );

  if (page !== 'main') {
    const titles: Record<Exclude<Page, 'main'>, string> = {
      restaurant: t('settings.restaurantAccount'), region: t('settings.region'), languages: t('settings.languages'),
      categories: t('settings.categories'), sharing: t('settings.sharing'), lock: t('settings.lock'), ocr: t('settings.billReading'),
    };
    return (
      <div style={pageCol}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="glass" aria-label={t('settings.back')} onClick={() => open('main')}
            style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', flex: 'none' }}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <h1 style={{ ...pageTitle, fontSize: 24 }}>{titles[page]}</h1>
        </div>

        {page === 'restaurant' && (
          <>
            <Card title={t('settings.restaurant')}>
              {shared && (
                <div style={col}>
                  <label style={label} htmlFor="st-name">{t('setup.name')}</label>
                  <NameInput value={shared.restaurantName} disabled={pending} onSave={(n) => void save({ restaurantName: n })} />
                </div>
              )}
              {pendingNotice}
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
          </>
        )}

        {page === 'region' && shared && (
          <Card plain title={t('settings.region')}>
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
            <div style={col}>
              <span style={label}>{t('settings.firstDay')}</span>
              <Segmented label={t('settings.firstDay')} value={String(device.weekStart) as '0' | '1'}
                onChange={(v) => void saveDevice({ weekStart: Number(v) as 0 | 1 })}
                options={[{ value: '1', label: t('settings.monday') }, { value: '0', label: t('settings.sunday') }]} />
            </div>
            {pendingNotice}
          </Card>
        )}

        {page === 'languages' && shared && (
          <Card plain title={t('settings.languages')}>
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
          </Card>
        )}

        {page === 'categories' && <CategoriesEditor />}

        {page === 'sharing' && (
          <Card plain title={t('settings.sharing')}>
            <div style={label}>{t('settings.hasAccess')}</div>
            {sharedWith.length === 0
              ? <div style={hint}>{t('settings.nobodyYet')}</div>
              : <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                  {sharedWith.map((e) => <li key={e}>{e}</li>)}
                </ul>}
            {email && owner && !pending && (
              <>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.12)' }} />
                <div style={heading}>{t('share.title')}</div>
                <div style={hint}>{t('share.hint')}</div>
                <label htmlFor="share-email" style={label}>{t('share.email')}</label>
                <input id="share-email" className="field" type="email" inputMode="email" autoComplete="email" value={invite}
                  onChange={(e) => { setInvite(e.target.value); setMsg(null); }}
                  style={{ height: 46, borderRadius: 14, padding: '0 14px', font: '600 15px Inter, sans-serif', color: '#FFFFFF' }} />
                <button type="button" style={primaryBtn} disabled={sending} onClick={() => void send()}>{t('share.invite')}</button>
              </>
            )}
          </Card>
        )}

        {page === 'lock' && (
          <Card plain title={t('settings.lock')}>
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
        )}

        {page === 'ocr' && (
          <Card plain title={t('settings.billReading')}>
            <div role="radiogroup" aria-label={t('settings.billReading')} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {([['device', 'settings.ocrDevice', 'settings.ocrDeviceHint'], ['gemini', 'settings.ocrGoogle', 'settings.ocrGoogleHint']] as const).map(([mode, l, h]) => (
                <button key={mode} type="button" role="radio" aria-checked={ocr === mode}
                  aria-label={t(l)} disabled={pending} onClick={() => void save({ ocrMode: mode })}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: 0, border: 0, background: 'transparent', color: '#FFFFFF', textAlign: 'left', opacity: pending ? 0.6 : 1 }}>
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, border: '2px solid #FFFFFF', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {ocr === mode && <span style={{ width: 10, height: 10, borderRadius: 5, background: '#6FE3A0' }} />}
                  </span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{t(l)}</span>
                    <span style={{ fontSize: 12, color: '#B3C8D9' }}>{t(h)}</span>
                  </span>
                </button>
              ))}
            </div>
            {ocr === 'gemini' && <GeminiKeyInput />}
          </Card>
        )}

        {message}
      </div>
    );
  }

  const name = shared?.restaurantName ?? '';
  return (
    <div style={pageCol}>
      <h1 style={pageTitle}>{t('settings.title')}</h1>

      <Glass as="section" aria-label={t('settings.restaurant')} style={{ ...card, borderRadius: 28, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" aria-label={t('settings.restaurantAccount')} onClick={() => open('restaurant')}
            style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, padding: 0, border: 0, background: 'transparent', color: '#FFFFFF', textAlign: 'left' }}>
            <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 18, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(160deg, #8ED3F5 0%, #3E8FD8 100%)', boxShadow: '0 6px 18px rgba(0,0,0,0.25)', font: "800 24px 'Inter Tight', Inter, sans-serif" }}>
              {(name.trim()[0] ?? 'R').toUpperCase()}
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ font: "800 17px 'Inter Tight', Inter, sans-serif", lineHeight: 1.2, overflowWrap: 'anywhere' }}>{name}</span>
              <span style={{ fontSize: 13, color: '#B3C8D9', overflowWrap: 'anywhere' }}>{email ? `${email} · ${roleText}` : roleText}</span>
            </span>
          </button>
          <button type="button" onClick={() => void syncNow()}
            style={{ minHeight: 44, padding: '0 18px', borderRadius: 22, border: 0, background: '#FFFFFF', color: '#1B365D', font: '700 14px Inter, sans-serif', flex: 'none' }}>
            {t('settings.syncNow')}
          </button>
        </div>
        <div style={{ paddingLeft: 70 }}><SyncStatus /></div>
        {pendingNotice}
      </Glass>

      {shared && (
        <Group>
          <Row icon={<Glyph>€</Glyph>} color="#2F8FE0" title={t('settings.region')}
            value={`${t(`country.${shared.country}` as 'country.FR')} · ${currencySymbol(shared.currency)}`} onClick={() => open('region')} />
          <Row icon={<Glyph>Aa</Glyph>} color="#5B7594" title={t('settings.languages')}
            value={t('settings.languagesValue', { app: device.appLanguage.toUpperCase(), bill: shared.billLanguage === 'eng' ? 'EN' : 'FR' })} onClick={() => open('languages')} />
          <Item icon={<Glyph>%</Glyph>} color="#33B26B" title={t('setup.showTotals')}>
            <Segmented label={t('setup.showTotals')} value={shared.taxView} small
              onChange={(v) => { if (!pending) void save({ taxView: v }); }}
              options={[{ value: 'incl', label: t('settings.inclShort'), ariaLabel: t('setup.incl') }, { value: 'excl', label: t('settings.exclShort'), ariaLabel: t('setup.excl') }]} />
          </Item>
          <Row icon={<Icon d="M6 8h12M6 12h12M6 16h8" />} color="#EE8A35" title={t('settings.categories')} onClick={() => open('categories')} />
        </Group>
      )}

      <Group>
        {email && owner && !pending && (
          <Row icon={<Icon d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.7-5 6-5s6 2 6 5M16 5.5a2.5 2.5 0 0 1 0 5M18 14c2 .5 3 2.2 3 5" />}
            color="#8B5CF6" title={t('settings.sharedWith')} value={sharedValue} onClick={() => open('sharing')} />
        )}
        {shared && (
          <Item icon={<Icon d="M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />} color="#2F8FE0"
            title={t('settings.photoBackupShort')}
            sub={!email ? t('settings.photoBackupSignIn') : shared.photoBackup ? t('settings.photoOn') : t('settings.photoOff')}>
            <Toggle on={shared.photoBackup} label={t('settings.photoBackup')} disabled={pending || !email} onChange={(v) => void togglePhotos(v)} />
          </Item>
        )}
        <Row icon={<Icon d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" />} color="rgba(255,255,255,0.16)" title={t('settings.lock')} value={lockValue} onClick={() => open('lock')} />
        <Row icon={<Icon d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 12h8" />} color="#14A8A0" title={t('settings.billReading')}
          value={ocr === 'gemini' ? t('settings.ocrShortGoogle') : t('settings.ocrShortDevice')} onClick={() => open('ocr')} />
        <Row icon={<Icon d="M5 4h14v16H5zM5 10h14M11 4v16" />} color="#33B26B" title={t('settings.export')} onClick={() => onGo('reports')} />
      </Group>

      {message}
    </div>
  );
}

type Page = 'main' | 'restaurant' | 'region' | 'languages' | 'categories' | 'sharing' | 'lock' | 'ocr';

const pageCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '0 auto', paddingBottom: 12, color: '#FFFFFF' };
const pageTitle: CSSProperties = { margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 30, fontWeight: 800, color: '#FFFFFF' };

/** "son@gmail.com" → "son". */
function shortName(email: string): string { return email.split('@')[0]; }

function currencySymbol(code: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch { return code; }
}

/** One glass card holding a list of rows separated by inset hairlines. */
function Group({ children }: { children: ReactNode }) {
  return <Glass style={{ borderRadius: 24, padding: '2px 16px', display: 'flex', flexDirection: 'column', color: '#FFFFFF' }}>{children}</Glass>;
}

function Glyph({ children }: { children: ReactNode }) {
  return <span style={{ font: "800 15px 'Inter Tight', Inter, sans-serif", letterSpacing: -0.3 }}>{children}</span>;
}

function Icon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

function Tile({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, flex: 'none', background: color, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </span>
  );
}

const rowBody: CSSProperties = {
  flex: 1, minWidth: 0, minHeight: 58, display: 'flex', alignItems: 'center', gap: 10,
  borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '8px 0',
};

/** A row that opens something: icon, title, current value and a chevron. */
function Row({ icon, color, title, value, onClick }: { icon: ReactNode; color: string; title: string; value?: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={title} onClick={onClick} className="settings-row"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 0, border: 0, background: 'transparent', color: '#FFFFFF', textAlign: 'left', width: '100%' }}>
      <Tile color={color}>{icon}</Tile>
      <span style={rowBody}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500 }}>{title}</span>
        {value && <span style={{ fontSize: 14, color: '#B3C8D9', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>}
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B3C8D9" strokeWidth="2.6" strokeLinecap="round" style={{ flex: 'none' }}><path d="M9 6l6 6-6 6" /></svg>
      </span>
    </button>
  );
}

/** A row with its control on the right (toggle, segmented). */
function Item({ icon, color, title, sub, children }: { icon: ReactNode; color: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <Tile color={color}>{icon}</Tile>
      <div style={rowBody}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 500 }}>{title}</span>
          {sub && <span style={{ fontSize: 12, color: '#B3C8D9' }}>{sub}</span>}
        </div>
        <div style={{ flex: 'none' }}>{children}</div>
      </div>
    </div>
  );
}

/** Bare on/off switch for an Item row. */
function Toggle({ on, label: text, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={text} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 56, height: 44, padding: 0, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', opacity: disabled ? 0.5 : 1 }}>
      <span aria-hidden="true" style={{ width: 52, height: 30, borderRadius: 15, background: on ? '#6FE3A0' : 'rgba(255,255,255,0.22)', position: 'relative' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: 12, background: '#FFFFFF', transition: 'left .15s' }} />
      </span>
    </button>
  );
}
