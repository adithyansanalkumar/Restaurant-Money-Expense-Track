import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import { ProfitBars } from '../ui/charts/ProfitBars';
import { Donut } from '../ui/charts/Donut';
import { useMoney } from '../ui/useMoney';
import { todayISO } from '../domain/clock';
import { byCategory, bySupplier, cashOut, mostlyFallback, series, summarize } from '../domain/totals';
import type { Category, Entry, ISODate, Payment, Supplier } from '../domain/types';
import { listLive } from '../db/repo';
import { t, useLanguage } from '../i18n';
import { exportExcel, exportFilename } from '../export/workbook';
import { shareOrDownload } from '../export/share';
import { saveExportToDrive } from '../export/drive';
import { currentEmail } from '../sync/auth';
import { isAdoptPending, useSyncStatus } from '../sync/sync';

type Preset = '3M' | '6M' | '1Y' | 'custom';
const PRESETS: Preset[] = ['3M', '6M', '1Y', 'custom'];
const MONTHS: Record<'3M' | '6M' | '1Y', number> = { '3M': 3, '6M': 6, '1Y': 12 };
const COLORS = ['#8FD8F2', '#2E8FD0', '#DDF2FB', '#5A7BA6', '#B8C7D6'];
const IN = '#6FE3A0';
const OUT = '#FF8E8E';
const field: CSSProperties = { minHeight: 44, borderRadius: 14, border: '1px solid rgba(255,255,255,0.24)', background: 'rgba(255,255,255,0.12)', color: '#FFFFFF', padding: '0 10px', font: '500 14px Inter, sans-serif' };

/** First day of the month that is `back` months before the month of `today`. */
function monthsBack(today: ISODate, back: number): ISODate {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1 - back;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

export function Reports() {
  const lang = useLanguage();
  const { fmt, view } = useMoney();
  const [preset, setPreset] = useState<Preset>('6M');
  const today = todayISO();
  const [customFrom, setCustomFrom] = useState<ISODate>(monthsBack(today, 0));
  const [customTo, setCustomTo] = useState<ISODate>(today);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { revision } = useSyncStatus();

  useEffect(() => {
    let live = true;
    void (async () => {
      const [e, p, c, s] = await Promise.all([listLive<Entry>('entries'), listLive<Payment>('payments'), listLive<Category>('categories'), listLive<Supplier>('suppliers')]);
      if (live) { setEntries(e); setPayments(p); setCategories(c); setSuppliers(s); }
    })();
    return () => { live = false; };
  }, [revision]); // revision: a sync changed rows

  const range = preset === 'custom'
    ? { from: customFrom, to: customTo }
    : { from: monthsBack(today, MONTHS[preset] - 1), to: today };
  const valid = range.from <= range.to;

  const sum = useMemo(() => summarize(entries, range.from, range.to, view), [entries, range.from, range.to, view]);
  const data = useMemo(() => (valid ? series(entries, range.from, range.to, 'month', view) : []), [entries, range.from, range.to, view, valid]);
  const cash = useMemo(() => cashOut(payments, range.from, range.to), [payments, range.from, range.to]);
  const slices = useMemo(() => {
    const cats = byCategory(entries, range.from, range.to, view);
    const name = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
    const top = cats.slice(0, 4).map((c, i) => ({ key: c.categoryId, label: name(c.categoryId), cents: c.cents, color: COLORS[i] }));
    const rest = cats.slice(4).reduce((s, c) => s + c.cents, 0);
    if (rest > 0) top.push({ key: ' other', label: t('reports.other'), cents: rest, color: COLORS[4] });
    return top;
  }, [entries, categories, range.from, range.to, view, lang]);
  // top 5 suppliers, then "Other" (the rest, and spending with no supplier), as a share of money out
  const supplierRows = useMemo(() => {
    const rows = bySupplier(entries, range.from, range.to, view);
    const name = (id: string) => suppliers.find((s) => s.id === id)?.name ?? '';
    const top = rows.slice(0, 5).map((r) => ({ key: r.supplierId, label: name(r.supplierId), cents: r.cents }));
    const shown = top.reduce((s, r) => s + r.cents, 0);
    if (sum.out - shown > 0) top.push({ key: ' other', label: t('reports.other'), cents: sum.out - shown });
    return top;
  }, [entries, suppliers, range.from, range.to, view, sum.out, lang]);

  const monthFmt = (iso: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, 1)));
  };
  const rangeLabel = preset === 'custom' ? `${range.from} – ${range.to}` : `${monthFmt(range.from, { month: 'short' })} – ${monthFmt(range.to, { month: 'short' })}`;
  const labels: Record<Preset, string> = { '3M': t('reports.r3m'), '6M': t('reports.r6m'), '1Y': t('reports.r1y'), custom: t('reports.custom') };
  const totalSlices = slices.reduce((s, x) => s + x.cents, 0);

  const doExport = async () => {
    setBusy(true); setMessage('');
    try {
      const blob = await exportExcel(range.from, range.to);
      const filename = exportFilename(range.from, range.to);
      const res = await shareOrDownload(blob, filename);
      let text = res === 'shared' ? t('reports.shared') : t('reports.downloaded');
      // Best effort copy in Google Drive when signed in; a failure here is not worth alarming anyone.
      try {
        if ((await currentEmail()) && !(await isAdoptPending())) {
          await saveExportToDrive(blob, filename);
          text += ` · ${t('reports.savedDrive')}`;
        }
      } catch { /* the export itself worked */ }
      setMessage(text);
    } catch {
      setMessage(t('reports.exportFailed'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h1 style={{ margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 28, fontWeight: 800 }}>{t('reports.title')}</h1>
        <div className="glass" role="group" aria-label={t('reports.range')} style={{ display: 'flex', padding: 3, borderRadius: 24 }}>
          {PRESETS.map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)} style={{
              minHeight: 44, minWidth: 44, padding: '0 10px', border: 0, borderRadius: 21, background: preset === p ? '#FFFFFF' : 'transparent',
              font: `${preset === p ? 700 : 500} 12px Inter, sans-serif`, color: preset === p ? '#1B365D' : '#DCE8F1',
            }}>{labels[p]}</button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#C6D8E6' }}>{t('reports.from')}
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={field} />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#C6D8E6' }}>{t('reports.to')}
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={field} />
          </label>
        </div>
      )}

      <Glass style={{ borderRadius: 28, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, color: '#C6D8E6', fontWeight: 600 }}>{t('reports.profit', { range: rangeLabel })}</span>
          <span data-testid="range-profit" style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 34, fontWeight: 800, letterSpacing: -0.8, color: sum.profit < 0 ? OUT : '#FFFFFF' }}>{fmt(sum.profit, { sign: true })}</span>
        </div>
        <ProfitBars data={data} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#B3C8D9' }}>
          {data.map((d) => <span key={d.label}>{monthFmt(d.label + '-01', { month: 'short' })}</span>)}
        </div>
        {mostlyFallback(sum, view) ? (
          <div role="note" style={{ fontSize: 13, fontWeight: 600, color: '#FFE3A3', background: 'rgba(255,200,90,0.14)', border: '1px solid rgba(255,200,90,0.4)', borderRadius: 14, padding: '8px 12px' }}>{t('tax.mostlyIncl')}</div>
        ) : sum.fallbackCount > 0 && (
          <div style={{ fontSize: 12, color: '#C6D8E6' }}>
            {sum.fallbackCount === 1 ? t('home.fallbackNoteOne') : t('home.fallbackNote', { n: sum.fallbackCount })}
          </div>
        )}
      </Glass>

      <Glass style={{ borderRadius: 28, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 'none' }}>
          <Donut slices={slices} centerLabel={t('reports.moneyOut')} centerValue={fmt(sum.out)} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12 }}>
          {slices.length === 0 && <span style={{ color: '#A9BED0' }}>{t('reports.noSpending')}</span>}
          {slices.map((s) => (
            <div key={s.key} data-testid="legend-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
              <span style={{ flex: 1 }}>{s.label}</span>
              <span style={{ fontWeight: 700 }}>{Math.round((s.cents / totalSlices) * 100)}%</span>
            </div>
          ))}
        </div>
      </Glass>

      {supplierRows.length > 0 && (
        <Glass as="section" aria-label={t('reports.bySupplier')} style={{ borderRadius: 28, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#C6D8E6' }}>{t('reports.bySupplier')}</h2>
          {supplierRows.map((r) => (
            <div key={r.key} data-testid="supplier-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minHeight: 28 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontWeight: 600 }}>{fmt(r.cents)}</span>
              <span style={{ width: 40, textAlign: 'right', fontWeight: 700, color: '#C6D8E6' }}>{sum.out ? Math.round((r.cents / sum.out) * 100) : 0}%</span>
            </div>
          ))}
        </Glass>
      )}

      <Glass style={{ borderRadius: 22, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#C6D8E6' }}>{t('reports.cashOut')}</span>
        <span data-testid="cash-out" style={{ fontSize: 17, fontWeight: 700, color: OUT }}>{fmt(cash)}</span>
      </Glass>

      <button type="button" className="glass" disabled={busy || !valid} onClick={() => void doExport()} style={{
        minHeight: 56, borderRadius: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        font: '700 16px Inter, sans-serif', color: '#FFFFFF', borderColor: 'rgba(111,227,160,0.6)',
      }}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={IN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z" /><path d="M4 10h16M10 4v16" /></svg>
        {busy ? t('reports.exporting') : t('reports.export')}
      </button>
      <div role="status" style={{ minHeight: 18, textAlign: 'center', fontSize: 13, color: '#C6D8E6' }}>{message}</div>
    </div>
  );
}
