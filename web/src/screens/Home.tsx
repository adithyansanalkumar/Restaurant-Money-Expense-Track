import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import { InOutLine } from '../ui/charts/InOutLine';
import type { Route } from '../ui/router';
import { useMoney } from '../ui/useMoney';
import { todayISO } from '../domain/clock';
import { periodRange, previousRange, type Period } from '../domain/period';
import { compare, series, shownAmount, summarize } from '../domain/totals';
import { dueBucket, openBills, supplierBalances } from '../domain/credit';
import type { Category, Entry, Payment, Supplier } from '../domain/types';
import { listLive } from '../db/repo';
import { t, useLanguage } from '../i18n';
import { useSettings } from '../settings/store';
import { SyncStatus } from '../ui/SyncStatus';
import { syncNow, useSyncStatus } from '../sync/sync';

const IN = '#6FE3A0';
const OUT = '#FF8E8E';
const PERIODS: Period[] = ['day', 'week', 'month', 'year'];
const card: CSSProperties = { borderRadius: 22, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export function Home({ onGo }: { onGo: (r: Route) => void }) {
  const lang = useLanguage();
  const { shared, device } = useSettings();
  const { fmt, view } = useMoney();
  const [period, setPeriod] = useState<Period>('month');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [ready, setReady] = useState(false);
  const { running, revision } = useSyncStatus();

  useEffect(() => {
    let live = true;
    void (async () => {
      const [e, p, s, c] = await Promise.all([
        listLive<Entry>('entries'), listLive<Payment>('payments'), listLive<Supplier>('suppliers'), listLive<Category>('categories'),
      ]);
      if (live) { setEntries(e); setPayments(p); setSuppliers(s); setCategories(c); setReady(true); }
    })();
    return () => { live = false; };
  }, [revision]);

  const today = todayISO();
  const ws = device.weekStart;
  const range = periodRange(period, today, ws);
  const prev = previousRange(period, today, ws);
  const sum = useMemo(() => summarize(entries, range.from, range.to, view), [entries, range.from, range.to, view]);
  const prevSum = useMemo(() => summarize(entries, prev.from, prev.to, view), [entries, prev.from, prev.to, view]);
  const delta = compare(sum.profit, prevSum.profit);
  const bucket = period === 'year' ? 'month' : 'day';
  const data = useMemo(() => series(entries, range.from, range.to, bucket, view, ws), [entries, range.from, range.to, bucket, view, ws]);
  const todaySum = useMemo(() => summarize(entries, today, today, view), [entries, today, view]);

  const owed = useMemo(() => supplierBalances(entries, payments).reduce((s, b) => s + b.owed, 0), [entries, payments]);
  const dueSoon = useMemo(
    () => openBills(entries, payments).filter((b) => { const k = dueBucket(b.entry, today); return k === 'overdue' || k === 'thisWeek'; }).length,
    [entries, payments, today],
  );

  const recent = useMemo(
    () => [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt - a.updatedAt)).slice(0, 5),
    [entries],
  );
  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name;
  const catName = (id: string) => categories.find((c) => c.id === id)?.name;

  const dateFmt = (opts: Intl.DateTimeFormatOptions, iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  const periodLabel = period === 'day' ? t('home.today')
    : period === 'week' ? t('home.thisWeek')
    : period === 'month' ? dateFmt({ month: 'long' }, today) : today.slice(0, 4);
  const labels: Record<Period, string> = { day: t('home.day'), week: t('home.week'), month: t('home.month'), year: t('home.year') };
  const total = sum.in + sum.out;
  const inPct = total === 0 ? 50 : (sum.in / total) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 13, color: '#C6D8E6' }}>{dateFmt({ weekday: 'long', day: 'numeric', month: 'long' }, today)}</div>
          <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>{shared?.restaurantName}</div>
          <SyncStatus />
        </div>
        <button type="button" className="glass" aria-label={t('home.sync')} aria-busy={running} disabled={running} onClick={() => { void syncNow(); }}
          style={{ width: 46, height: 46, borderRadius: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></svg>
        </button>
      </div>

      <div className="glass" role="group" aria-label={t('home.period')} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', padding: 4, borderRadius: 22 }}>
        {PERIODS.map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} style={{
            minHeight: 44, border: 0, borderRadius: 18, background: period === p ? '#FFFFFF' : 'transparent',
            font: `${period === p ? 700 : 500} 13px Inter, sans-serif`, color: period === p ? '#1B365D' : '#DCE8F1',
          }}>{labels[p]}</button>
        ))}
      </div>

      <Glass style={{ borderRadius: 28, padding: '18px 18px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#C6D8E6' }}>{t('home.profit', { period: periodLabel })}</div>
          {delta !== null && (
            <div style={{ fontSize: 12, fontWeight: 700, color: delta >= 0 ? '#0B3B22' : '#3D0A0A', background: delta >= 0 ? IN : OUT, padding: '4px 9px', borderRadius: 10 }}>
              {t('home.vsLast', { arrow: delta >= 0 ? '▲' : '▼', pct: Math.round(Math.abs(delta) * 100) })}
            </div>
          )}
        </div>
        <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 52, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1 }}>{fmt(sum.profit, { sign: true })}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div aria-hidden="true" style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 3 }}>
            <div style={{ width: `${inPct}%`, background: IN, borderRadius: 4 }} />
            <div style={{ width: `${100 - inPct}%`, background: OUT, borderRadius: 4 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ display: 'flex', gap: 6, color: '#DCE8F1' }}><span style={{ color: IN, fontWeight: 700 }}>↓ {t('home.in')}</span><span>{fmt(sum.in)}</span></span>
            <span style={{ display: 'flex', gap: 6, color: '#DCE8F1' }}><span style={{ color: OUT, fontWeight: 700 }}>↑ {t('home.out')}</span><span>{fmt(sum.out)}</span></span>
          </div>
        </div>
        {sum.fallbackCount > 0 && (
          <div style={{ fontSize: 12, color: '#C6D8E6' }}>
            {sum.fallbackCount === 1 ? t('home.fallbackNoteOne') : t('home.fallbackNote', { n: sum.fallbackCount })}
          </div>
        )}
        <InOutLine data={data} />
      </Glass>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <Glass style={card} data-testid="today-in">
          <div style={{ fontSize: 12, color: '#C6D8E6' }}>{t('home.todayIn')}</div>
          <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 24, fontWeight: 700, color: IN }}>{fmt(todaySum.in, { sign: true })}</div>
        </Glass>
        <Glass style={card} data-testid="today-out">
          <div style={{ fontSize: 12, color: '#C6D8E6' }}>{t('home.todayOut')}</div>
          <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 24, fontWeight: 700, color: OUT }}>{todaySum.out === 0 ? fmt(0) : fmt(-todaySum.out)}</div>
        </Glass>
      </div>

      {owed > 0 && (
        <button type="button" className="glass" onClick={() => onGo('owe')} style={{
          borderRadius: 22, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, color: '#FFFFFF',
          borderColor: 'rgba(255,142,142,0.5)', textAlign: 'left', minHeight: 44, width: '100%',
        }}>
          <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 14, background: 'rgba(255,142,142,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFB4B4' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h4" /></svg>
          </span>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{t('home.owed', { amount: fmt(owed) })}</span>
            {dueSoon > 0 && <span style={{ fontSize: 12, color: '#FFC2C2' }}>{dueSoon === 1 ? t('home.billsDueOne') : t('home.billsDue', { n: dueSoon })}</span>}
          </span>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C6D8E6" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      )}

      <Glass style={{ borderRadius: 22, padding: '6px 14px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#C6D8E6' }}>{t('home.recent')}</div>
          <button type="button" onClick={() => onGo('history')} style={{ minHeight: 44, minWidth: 44, border: 0, background: 'transparent', color: '#8FD8F2', fontSize: 13, fontWeight: 600 }}>{t('home.seeAll')}</button>
        </div>
        {ready && recent.length === 0 && <div style={{ fontSize: 13, color: '#A9BED0', padding: '4px 0 12px' }}>{t('home.noActivity')}</div>}
        {recent.map((e, i) => {
          const income = e.kind === 'income';
          const name = income ? (e.channel || catName(e.categoryId) || t('history.collection')) : (supplierName(e.supplierId) ?? catName(e.categoryId) ?? '');
          const { cents, fallback } = shownAmount(e, view);
          return (
            <div key={e.id} data-testid="recent-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i ? '1px solid rgba(255,255,255,0.12)' : undefined }}>
              <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 12, background: income ? 'rgba(111,227,160,0.2)' : 'rgba(255,142,142,0.2)', color: income ? IN : '#FFB4B4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{initials(name)}</span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 12, color: '#A9BED0' }}>{[income ? undefined : catName(e.categoryId), e.date].filter(Boolean).join(' · ')}</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: income ? IN : OUT }}>{income ? fmt(cents, { sign: true }) : fmt(-cents)}</span>
                {fallback && <span data-testid="incl-tag" style={{ fontSize: 11, color: '#A9BED0' }}>{t('tax.inclTag')}</span>}
              </span>
            </div>
          );
        })}
      </Glass>
    </div>
  );
}
