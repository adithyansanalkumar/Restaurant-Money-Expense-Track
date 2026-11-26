import { useCallback, useEffect, useMemo, useState } from 'react';
import { Glass } from '../ui/Glass';
import { useMoney } from '../ui/useMoney';
import type { Route } from '../ui/router';
import { dueBucket, openBills, supplierBalances } from '../domain/credit';
import { todayISO } from '../domain/clock';
import type { Entry, Id, Payment, Supplier } from '../domain/types';
import { listLive } from '../db/repo';
import { t, useLanguage } from '../i18n';
import { initials } from './AddEntry';
import { RecordPayment } from './RecordPayment';

const OUT = '#FF8E8E';
const IN = '#6FE3A0';

export function Owe({ onGo }: { onGo: (r: Route) => void }) {
  const lang = useLanguage();
  const { fmt } = useMoney();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [expanded, setExpanded] = useState<Id | null | undefined>(undefined); // undefined = default first card
  const [paying, setPaying] = useState<Id | null>(null);
  const today = todayISO();

  const load = useCallback(async () => {
    const [e, p, s] = await Promise.all([listLive<Entry>('entries'), listLive<Payment>('payments'), listLive<Supplier>('suppliers')]);
    setEntries(e); setPayments(p); setSuppliers(s);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const balances = useMemo(() => supplierBalances(entries, payments), [entries, payments]);
  const bills = useMemo(() => openBills(entries, payments), [entries, payments]);
  const total = balances.reduce((s, b) => s + b.owed, 0);
  const buckets = useMemo(() => {
    const sums = { overdue: 0, thisWeek: 0, later: 0 };
    for (const b of bills) {
      const k = dueBucket(b.entry, today);
      sums[k === 'none' ? 'later' : k] += b.remaining;
    }
    return sums;
  }, [bills, today]);

  const dateFmt = (opts: Intl.DateTimeFormatOptions, iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
  };

  const payingSupplier = paying ? suppliers.find((s) => s.id === paying) : undefined;
  if (payingSupplier) {
    return (
      <RecordPayment supplier={payingSupplier} entries={entries} payments={payments}
        onCancel={() => setPaying(null)}
        onDone={() => { setPaying(null); void load(); }} />
    );
  }

  const openId = expanded === undefined ? balances[0]?.supplierId ?? null : expanded;
  const tiles: { key: 'overdue' | 'thisWeek' | 'later'; label: string }[] = [
    { key: 'overdue', label: t('owe.overdue') }, { key: 'thisWeek', label: t('owe.thisWeek') }, { key: 'later', label: t('owe.later') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="glass" aria-label={t('owe.back')} onClick={() => onGo('home')}
          style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 24, fontWeight: 800 }}>{t('owe.title')}</h1>
      </div>

      <Glass style={{ borderRadius: 28, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#C6D8E6' }}>{t('owe.total')}</div>
        <div data-testid="owe-total" style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 48, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1, color: OUT }}>
          {fmt(-total)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {tiles.map(({ key, label }) => {
            const od = key === 'overdue';
            return (
              <div key={key} data-testid={`bucket-${key}`} style={{
                background: od ? 'rgba(255,142,142,0.2)' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${od ? 'rgba(255,142,142,0.45)' : 'rgba(255,255,255,0.2)'}`,
                borderRadius: 16, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: od ? '#FFC2C2' : '#DCE8F1', textTransform: 'uppercase' }}>{label}</span>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{fmt(buckets[key])}</span>
              </div>
            );
          })}
        </div>
      </Glass>

      {balances.length === 0 && <div style={{ textAlign: 'center', color: '#C6D8E6', fontSize: 14 }}>{t('owe.empty')}</div>}

      {balances.map((b) => {
        const sup = suppliers.find((s) => s.id === b.supplierId);
        const name = sup?.name ?? '?';
        const open = openId === b.supplierId;
        const mine = bills.filter((x) => x.entry.supplierId === b.supplierId);
        const summary = t(b.bills === 1 ? 'owe.bill1' : 'owe.bills', { n: b.bills, paid: fmt(b.paidSoFar), total: fmt(b.total) });
        const pct = b.total > 0 ? Math.min(100, Math.round((b.paidSoFar / b.total) * 100)) : 0;
        return (
          <Glass key={b.supplierId} data-testid={`supplier-${b.supplierId}`} style={{ borderRadius: 26, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : b.supplierId)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, background: 'none', border: 0, padding: 0, color: '#FFFFFF', textAlign: 'left', width: '100%' }}>
              <span aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(255,142,142,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#FFC2C2', flex: 'none' }}>{initials(name)}</span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{name}</span>
                <span style={{ fontSize: 12, color: '#C6D8E6' }}>{summary}</span>
              </span>
              <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 20, fontWeight: 800 }}>{fmt(b.owed)}</span>
            </button>
            {open && (
              <>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={summary}
                  style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: 6, background: IN, borderRadius: 3 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mine.map((x) => {
                    const overdue = dueBucket(x.entry, today) === 'overdue';
                    const chipText = overdue ? t('owe.overdue')
                      : x.entry.dueDate ? t('owe.due', { date: dateFmt({ weekday: 'short', day: 'numeric', month: 'short' }, x.entry.dueDate) }) : t('owe.noDue');
                    return (
                      <div key={x.entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {dateFmt({ day: 'numeric', month: 'short' }, x.entry.date)}
                          <span style={{
                            fontSize: 11, fontWeight: overdue ? 700 : 600, padding: '2px 7px', borderRadius: 8,
                            color: overdue ? '#3D0A0A' : '#DCE8F1', background: overdue ? OUT : 'rgba(255,255,255,0.14)',
                          }}>{chipText}</span>
                        </span>
                        <span style={{ fontWeight: 700 }}>{fmt(x.remaining)}</span>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => setPaying(b.supplierId)} style={{
                  height: 50, borderRadius: 25, border: 0, background: 'linear-gradient(160deg, #FFFFFF 0%, #DDF2FB 100%)',
                  boxShadow: 'inset 0 1px 0 #FFFFFF, 0 10px 24px rgba(2,10,24,0.4)', font: '800 15px Inter, sans-serif', color: '#1B365D',
                }}>{t('owe.record')}</button>
              </>
            )}
          </Glass>
        );
      })}
      <div style={{ fontSize: 12, color: '#B3C8D9', textAlign: 'center' }}>{t('owe.note')}</div>
    </div>
  );
}
