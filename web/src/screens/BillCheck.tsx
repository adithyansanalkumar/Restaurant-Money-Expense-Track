import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import type { Route } from '../ui/router';
import { setEditing } from '../ui/editing';
import { parseAmount } from '../domain/money';
import { todayISO } from '../domain/clock';
import type { Id, Supplier } from '../domain/types';
import { put } from '../db/repo';
import { matchSupplier, type ParsedReceipt } from '../ocr/parseReceipt';
import { t, useLanguage } from '../i18n';
import { COUNTRY_DEFAULTS, useSettings } from '../settings/store';
import { currencyParts, formatTyped } from './AddEntry';

const READ = '#8FD8F2';
const MISSING = '#FF8E8E';
const field = (state: 'read' | 'missing' | 'plain'): CSSProperties => ({
  height: 44, borderRadius: 12, padding: '0 10px', minWidth: 0, width: '100%', boxSizing: 'border-box',
  font: '600 15px Inter, sans-serif', color: '#FFFFFF',
  border: `1.5px solid ${state === 'read' ? READ : state === 'missing' ? MISSING : 'rgba(255,255,255,0.18)'}`,
});

/** Review what was read from a bill photo, fix it, then hand off to the add-expense screen. */
export function BillCheck({ photoId, photoUrl, parsed, suppliers, ocrFailed, onRetake, onGo }: {
  photoId: Id; photoUrl?: string; parsed: ParsedReceipt; suppliers: Supplier[]; ocrFailed?: boolean;
  onRetake: () => void; onGo: (r: Route) => void;
}) {
  useLanguage();
  const { shared } = useSettings();
  const currency = shared?.currency ?? 'EUR';
  const locale = (shared && COUNTRY_DEFAULTS[shared.country]?.locale) || 'en-US';
  const cur = useMemo(() => currencyParts(currency, locale), [currency, locale]);
  const show = (c?: number) => (c === undefined ? '' : formatTyped(c, cur.sep));

  const [shop, setShop] = useState(parsed.shop ?? '');
  const [date, setDate] = useState(parsed.date ?? todayISO());
  const [incl, setIncl] = useState(show(parsed.incl));
  const [excl, setExcl] = useState(show(parsed.excl));
  const [tax, setTax] = useState(show(parsed.tax));
  const [newSupplier, setNewSupplier] = useState(true);
  const [busy, setBusy] = useState(false);
  // Re-format once settings (and so the decimal separator) have loaded.
  useEffect(() => { setIncl(show(parsed.incl)); setExcl(show(parsed.excl)); setTax(show(parsed.tax)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cur.sep]);

  const matched = useMemo(() => matchSupplier(shop, suppliers), [shop, suppliers]);
  const inclCents = parseAmount(incl.trim());
  const canGo = inclCents !== null && inclCents > 0 && !busy;
  const name = shop.trim();

  const confirm = async () => {
    if (!canGo || inclCents === null) return;
    setBusy(true);
    let supplierId: Id | undefined = matched?.id;
    if (!supplierId && newSupplier && name) supplierId = (await put<Supplier>('suppliers', { name })).id;
    const ex = parseAmount(excl.trim());
    const tx = parseAmount(tax.trim());
    setEditing({
      kind: 'expense', date, amountIncl: inclCents, photoId,
      ...(ex !== null ? { amountExcl: ex } : {}),
      ...(tx !== null ? { tax: tx } : {}),
      ...(supplierId ? { supplierId } : {}),
    });
    onGo('add');
  };

  const lbl: CSSProperties = { fontSize: 12, color: '#C6D8E6' };
  const missing = incl.trim() === '' || inclCents === null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 25, background: 'radial-gradient(70% 45% at 50% 30%,#3a3630 0,#1d1b18 70%,#121110 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
        <button type="button" className="glass" aria-label={t('bills.close')} onClick={() => onGo('bills')}
          style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="glass" role="status" style={{ minHeight: 36, padding: '0 14px', borderRadius: 18, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: ocrFailed ? MISSING : '#6FE3A0' }} />
          {ocrFailed ? t('bill.notRead') : t('bill.found')}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', padding: '0 24px' }}>
        {photoUrl && <img src={photoUrl} alt={t('bills.photoAlt')} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 24px 50px rgba(0,0,0,0.6)' }} />}
      </div>
      <div style={{
        borderRadius: '34px 34px 0 0', padding: '12px 18px 24px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '62%', overflowY: 'auto',
        background: 'linear-gradient(170deg,rgba(27,54,93,.88) 0%,rgba(10,27,51,.94) 100%)', borderTop: '1px solid rgba(255,255,255,0.3)',
      }}>
        <div aria-hidden="true" style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.4)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 22, fontWeight: 800 }}>{t('bill.check')}</h2>
          <span style={{ fontSize: 12, color: '#C6D8E6' }}>{t('bill.tapToFix')}</span>
        </div>
        <Glass style={{ borderRadius: 22, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...lbl, display: 'flex', justifyContent: 'space-between' }}>
              {t('bill.shop')}
              {matched && <span style={{ fontSize: 10, fontWeight: 700, color: '#0A1B33', background: READ, padding: '3px 6px', borderRadius: 6 }}>{t('bill.saved')}</span>}
            </span>
            <input className="field" value={shop} onChange={(e) => setShop(e.target.value)} style={field(parsed.shop ? 'read' : 'plain')} />
          </label>
          {!matched && name && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14 }}>
              <input type="checkbox" checked={newSupplier} onChange={(e) => setNewSupplier(e.target.checked)} style={{ width: 22, height: 22 }} />
              {t('bill.newSupplier')}
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lbl}>{t('bill.date')}</span>
            <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field(parsed.date ? 'read' : 'plain')} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={lbl}>{t('bill.totalIncl')}</span>
              <input className="field" inputMode="decimal" value={incl} onChange={(e) => setIncl(e.target.value)}
                placeholder={parsed.incl === undefined ? t('bill.notFound') : undefined} aria-invalid={missing}
                style={field(missing ? 'missing' : parsed.incl !== undefined ? 'read' : 'plain')} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={lbl}>{t('bill.totalExcl')}</span>
              <input className="field" inputMode="decimal" value={excl} onChange={(e) => setExcl(e.target.value)} style={field(parsed.excl !== undefined ? 'read' : 'plain')} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={lbl}>{t('bill.tax')}</span>
              <input className="field" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} style={field(parsed.tax !== undefined ? 'read' : 'plain')} />
            </label>
          </div>
          {missing && <div role="note" style={{ fontSize: 12, color: MISSING }}>{t('bill.totalIncl')}: {t('bill.notFound')}</div>}
        </Glass>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <button type="button" className="glass" onClick={onRetake} style={{ minHeight: 56, borderRadius: 28, font: '700 15px Inter, sans-serif', color: '#FFFFFF' }}>{t('bill.retake')}</button>
          <button type="button" disabled={!canGo} onClick={() => void confirm()} style={{
            minHeight: 56, borderRadius: 28, border: 0, opacity: canGo ? 1 : 0.5,
            background: 'linear-gradient(160deg, #FFFFFF 0%, #DDF2FB 100%)', color: '#1B365D', font: '800 16px Inter, sans-serif',
          }}>{t('bill.looksRight')}</button>
        </div>
      </div>
    </div>
  );
}
