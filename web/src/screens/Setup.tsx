import { useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import type { Route } from '../ui/router';
import { seedDefaults } from '../db/repo';
import { t, useLanguage, type Lang } from '../i18n';
import { COUNTRY_DEFAULTS, useSettings } from '../settings/store';

const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: '#C6D8E6' };
const select: CSSProperties = { height: 46, borderRadius: 14, padding: '0 10px', font: '600 14px Inter, sans-serif', color: '#FFFFFF' };
const col: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 };

const CURRENCIES = ['EUR', 'CHF', 'GBP', 'INR', 'USD'];

export function Setup({ onGo }: { onGo: (r: Route) => void }) {
  useLanguage();
  const { device, saveShared, saveDevice } = useSettings();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('FR');
  const [currency, setCurrency] = useState(COUNTRY_DEFAULTS.FR.currency);
  const [billLanguage, setBillLanguage] = useState<'fra' | 'eng'>(COUNTRY_DEFAULTS.FR.billLanguage);
  const [taxView, setTaxView] = useState<'incl' | 'excl'>('incl');
  const [busy, setBusy] = useState(false);

  const pickCountry = (c: string) => {
    setCountry(c);
    const d = COUNTRY_DEFAULTS[c];
    if (d) { setCurrency(d.currency); setBillLanguage(d.billLanguage); }
  };

  const cont = async () => {
    if (busy) return;
    setBusy(true);
    await saveShared({ restaurantName: name.trim(), country, currency, billLanguage, taxView, photoBackup: false, ocrMode: 'device' });
    await saveDevice({ appLanguage: device.appLanguage });
    await seedDefaults();
    onGo('home');
  };

  const totalBtn = (v: 'incl' | 'excl', title: string, hint: string) => {
    const on = taxView === v;
    return (
      <button type="button" aria-pressed={on} onClick={() => setTaxView(v)} style={{
        height: 66, borderRadius: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        border: on ? '1.5px solid #FFFFFF' : '1px solid rgba(255,255,255,0.2)',
        background: on ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
        boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,0.5), 0 0 22px rgba(143,216,242,0.35)' : undefined,
        font: `${on ? 800 : 600} 15px Inter, sans-serif`, color: on ? '#FFFFFF' : '#DCE8F1',
      }}>
        {title}
        <span style={{ fontSize: 11, fontWeight: 500, color: on ? '#DCE8F1' : '#B3C8D9' }}>{hint}</span>
      </button>
    );
  };

  return (
    <div className="setup" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: '#FFFFFF', minHeight: 'calc(100vh - 140px)' }}>
      <Glass style={{ width: 76, height: 76, borderRadius: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg aria-hidden="true" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10" /><path d="M17 21V3c-2 1.5-3 4-3 7v3h3" /></svg>
      </Glass>
      <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 28, fontWeight: 800, textAlign: 'center', lineHeight: 1.15 }}>{t('setup.title')}</div>
      <div style={{ fontSize: 14, color: '#C6D8E6', textAlign: 'center', marginTop: -6 }}>{t('setup.subtitle')}</div>

      <Glass style={{ alignSelf: 'stretch', borderRadius: 28, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={col}>
          <label htmlFor="s-name" style={label}>{t('setup.name')}</label>
          <input id="s-name" className="field" value={name} onChange={(e) => setName(e.target.value)}
            style={{ height: 46, borderRadius: 14, padding: '0 14px', font: '600 15px Inter, sans-serif', color: '#FFFFFF' }} />
        </div>
        <div style={grid}>
          <div style={col}>
            <label htmlFor="s-country" style={label}>{t('setup.country')}</label>
            <select id="s-country" className="field" style={select} value={country} onChange={(e) => pickCountry(e.target.value)}>
              {Object.keys(COUNTRY_DEFAULTS).map((c) => <option key={c} value={c}>{t(`country.${c}` as 'country.FR')}</option>)}
            </select>
          </div>
          <div style={col}>
            <label htmlFor="s-cur" style={label}>{t('setup.currency')}</label>
            <select id="s-cur" className="field" style={select} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{t(`currency.${c}` as 'currency.EUR')}</option>)}
            </select>
          </div>
          <div style={col}>
            <label htmlFor="s-al" style={label}>{t('setup.appLanguage')}</label>
            <select id="s-al" className="field" style={select} value={device.appLanguage} onChange={(e) => void saveDevice({ appLanguage: e.target.value as Lang })}>
              <option value="en">{t('lang.en')}</option>
              <option value="fr">{t('lang.fr')}</option>
            </select>
          </div>
          <div style={col}>
            <label htmlFor="s-bl" style={label}>{t('setup.billLanguage')}</label>
            <select id="s-bl" className="field" style={select} value={billLanguage} onChange={(e) => setBillLanguage(e.target.value as 'fra' | 'eng')}>
              <option value="fra">{t('lang.fra')}</option>
              <option value="eng">{t('lang.eng')}</option>
            </select>
          </div>
        </div>
        <div style={{ ...label, paddingTop: 2 }}>{t('setup.showTotals')}</div>
        <div style={grid}>
          {totalBtn('incl', t('setup.incl'), t('setup.inclHint'))}
          {totalBtn('excl', t('setup.excl'), t('setup.exclHint'))}
        </div>
      </Glass>

      <button type="button" onClick={() => void cont()} disabled={busy} style={{
        alignSelf: 'stretch', marginTop: 'auto', height: 58, borderRadius: 29, border: 0,
        background: 'linear-gradient(160deg, #FFFFFF 0%, #DDF2FB 100%)',
        boxShadow: 'inset 0 1px 0 #FFFFFF, 0 14px 30px rgba(2,10,24,0.45)',
        color: '#1B365D', fontSize: 17, fontWeight: 800,
      }}>{t('setup.continue')}</button>
      <div style={{ fontSize: 13, color: '#C6D8E6' }}>
        {t('setup.joining')}{' '}
        <a href="#/join" style={{ color: '#8FD8F2' }} onClick={(e) => { e.preventDefault(); onGo('join'); }}>{t('setup.openHere')}</a>
      </div>
    </div>
  );
}
