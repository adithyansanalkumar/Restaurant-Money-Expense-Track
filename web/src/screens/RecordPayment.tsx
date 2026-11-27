import { useMemo, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import { Keypad } from '../ui/Keypad';
import { useMoney } from '../ui/useMoney';
import { pressKey, type KeypadKey } from '../domain/keypad';
import { parseAmount } from '../domain/money';
import { todayISO } from '../domain/clock';
import { allocatePayment } from '../domain/credit';
import type { Entry, Payment, Supplier } from '../domain/types';
import { db } from '../db/db';
import { getDeviceId } from '../db/device';
import { put } from '../db/repo';
import { t, useLanguage } from '../i18n';
import { currentEmail } from '../sync/auth';
import { currencyParts } from './AddEntry';

type Method = Payment['method'];
const METHODS: Method[] = ['cash', 'card', 'transfer', 'other'];
const OUT = '#FF8E8E';

const chip = (on: boolean): CSSProperties => ({
  flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 22,
  border: `1px solid ${on ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)'}`,
  background: on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)',
  font: `${on ? 600 : 500} 13px Inter, sans-serif`, color: on ? '#FFFFFF' : '#DCE8F1',
});

export function RecordPayment({ supplier, entries, payments, onDone, onCancel }: {
  supplier: Supplier; entries: Entry[]; payments: Payment[]; onDone: () => void; onCancel: () => void;
}) {
  useLanguage();
  const { fmt, currency, locale } = useMoney();
  const cur = useMemo(() => currencyParts(currency, locale), [currency, locale]);
  const sep = cur.sep;
  const [display, setDisplay] = useState('0');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<Method>('cash');
  const [tooMuch, setTooMuch] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const typed = display.endsWith(sep) ? display.slice(0, -1) : display;
  const cents = parseAmount(typed) ?? 0;
  const shown = cur.before ? `${cur.symbol}${display}` : `${display} ${cur.symbol}`;
  const owedNow = useMemo(() => {
    const r = allocatePayment(supplier.id, 1, date, 'cash', entries, payments);
    return Array.isArray(r) ? null : r.owed;
  }, [supplier.id, date, entries, payments]);

  const confirm = async () => {
    if (busy || cents <= 0) return;
    setBusy(true); setFailed(false);
    try {
      // a cleared date input: today, never an empty date
      const res = allocatePayment(supplier.id, cents, date || todayISO(), method, entries, payments, (await currentEmail()) ?? '');
      if (!Array.isArray(res)) {
        if (res.error === 'tooMuch') setTooMuch(res.owed);
        return;
      }
      await getDeviceId();
      await db.transaction('rw', [db.payments, db.meta], async () => {
        for (const p of res) await put<Payment>('payments', p);
      });
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const methodLabels: Record<Method, string> = {
    cash: t('method.cash'), card: t('method.card'), transfer: t('method.transfer'), other: t('method.other'),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520, margin: '0 auto', minHeight: 'calc(100vh - 44px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="glass" aria-label={t('owe.back')} onClick={onCancel}
          style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 24, fontWeight: 800 }}>{t('pay.title')}</div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 13, color: '#C6D8E6' }}>
        {owedNow !== null ? t('pay.owes', { supplier: supplier.name, owed: fmt(owedNow) }) : supplier.name}
      </div>
      <div data-testid="amount" style={{ textAlign: 'center', fontFamily: "'Inter Tight', sans-serif", fontSize: 58, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05, color: OUT }}>{shown}</div>
      <Glass style={{ borderRadius: 24, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {METHODS.map((m) => (
            <button key={m} type="button" aria-pressed={method === m} style={chip(method === m)} onClick={() => setMethod(m)}>{methodLabels[m]}</button>
          ))}
        </div>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, minHeight: 44 }}>
          <span style={{ color: '#C6D8E6' }}>{t('pay.date')}</span>
          <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ height: 44, borderRadius: 12, padding: '0 10px', font: '600 14px Inter, sans-serif', color: '#FFFFFF' }} />
        </label>
      </Glass>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Keypad decimalSep={sep} onKey={(k: KeypadKey) => { setTooMuch(null); setDisplay((d) => pressKey(d, k, sep)); }} />
        {tooMuch !== null && <div role="alert" style={{ color: OUT, fontSize: 13, textAlign: 'center' }}>{t('pay.tooMuch', { owed: fmt(tooMuch) })}</div>}
        {failed && <div role="alert" style={{ color: OUT, fontSize: 13, textAlign: 'center' }}>{t('pay.error')}</div>}
        <button type="button" disabled={cents <= 0 || busy} onClick={() => void confirm()} style={{
          height: 58, borderRadius: 29, border: 0, background: 'linear-gradient(160deg, #FFFFFF 0%, #DDF2FB 100%)',
          boxShadow: 'inset 0 1px 0 #FFFFFF, 0 14px 30px rgba(2,10,24,0.45)', color: '#1B365D',
          fontSize: 17, fontWeight: 800, opacity: cents <= 0 || busy ? 0.5 : 1,
        }}>{t('pay.confirm')}</button>
      </div>
    </div>
  );
}

