import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import { Keypad } from '../ui/Keypad';
import { Segmented } from '../ui/Segmented';
import type { Route } from '../ui/router';
import { pressKey, type KeypadKey } from '../domain/keypad';
import { parseAmount } from '../domain/money';
import { todayISO } from '../domain/clock';
import { paymentsForPaidNow } from '../domain/credit';
import type { Category, Entry, Id, Supplier } from '../domain/types';
import { db } from '../db/db';
import { getDeviceId } from '../db/device';
import { listLive, put, softDelete } from '../db/repo';
import { t, useLanguage } from '../i18n';
import { currentEmail } from '../sync/auth';
import { COUNTRY_DEFAULTS, useSettings } from '../settings/store';

type Method = Entry['method'];
const METHODS: Method[] = ['cash', 'card', 'transfer', 'other'];
const OTHER_EXPENSE_ID = 'cat:expense:13';
const IN = '#6FE3A0';
const OUT = '#FF8E8E';


export function formatTyped(cents: number, sep: ',' | '.'): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}${sep}${String(frac).padStart(2, '0')}`;
}

export function currencyParts(currency: string, locale: string): { symbol: string; before: boolean; sep: ',' | '.' } {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1234.5);
    const symbol = parts.find((p) => p.type === 'currency')?.value ?? currency;
    const before = parts.findIndex((p) => p.type === 'currency') < parts.findIndex((p) => p.type === 'integer');
    const dec = parts.find((p) => p.type === 'decimal')?.value;
    return { symbol, before, sep: dec === ',' ? ',' : '.' };
  } catch {
    return { symbol: currency, before: true, sep: '.' };
  }
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const rowLabel: CSSProperties = { color: '#C6D8E6' };
const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, gap: 10, minHeight: 44 };
const chip = (on: boolean): CSSProperties => ({
  flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 22,
  border: `1px solid ${on ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)'}`,
  background: on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)',
  font: `${on ? 600 : 500} 13px Inter, sans-serif`, color: on ? '#FFFFFF' : '#DCE8F1',
  display: 'flex', alignItems: 'center', gap: 8,
});
const dateInput: CSSProperties = { height: 44, borderRadius: 12, padding: '0 10px', font: '600 14px Inter, sans-serif', color: '#FFFFFF' };

export function AddEntry({ onGo, initial }: { onGo: (r: Route) => void; initial?: Partial<Entry> & { photoId?: Id } }) {
  useLanguage();
  const { shared } = useSettings();
  const currency = shared?.currency ?? 'EUR';
  const locale = (shared && COUNTRY_DEFAULTS[shared.country]?.locale) || 'en-US';
  const cur = useMemo(() => currencyParts(currency, locale), [currency, locale]);
  const sep = cur.sep;

  const [kind, setKind] = useState<Entry['kind']>(initial?.kind ?? 'expense');
  const [display, setDisplay] = useState(() => (initial?.amountIncl ? formatTyped(initial.amountIncl, sep) : '0'));
  const [supplierId, setSupplierId] = useState<Id | undefined>(initial?.supplierId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [categoryId, setCategoryId] = useState<Id | undefined>(initial?.kind === 'income' ? undefined : initial?.categoryId);
  const [channelId, setChannelId] = useState<Id | undefined>(initial?.kind === 'income' ? initial.categoryId : undefined);
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [method, setMethod] = useState<Method>(initial?.method ?? 'cash');
  const [status, setStatus] = useState<'paid' | 'credit'>(initial?.status ?? 'paid');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [s, c, e] = await Promise.all([
        listLive<Supplier>('suppliers'), listLive<Category>('categories'), listLive<Entry>('entries'),
      ]);
      if (live) {
        setSuppliers(s); setCategories(c); setEntries(e);
        const sup = initial?.supplierId ? s.find((x) => x.id === initial.supplierId) : undefined;
        if (sup?.defaultCategoryId) setCategoryId((cur) => cur ?? sup.defaultCategoryId);
      }
    })();
    return () => { live = false; };
  }, []);

  const typed = display.endsWith(sep) ? display.slice(0, -1) : display;
  const cents = parseAmount(typed) ?? 0;
  const color = kind === 'expense' ? OUT : IN;

  const recentSuppliers = useMemo(() => {
    const last = new Map<Id, number>();
    for (const e of entries) if (e.supplierId) last.set(e.supplierId, Math.max(last.get(e.supplierId) ?? 0, e.updatedAt));
    return [...suppliers]
      .sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [suppliers, entries]);

  const byId = (a: Category, b: Category) => a.id.localeCompare(b.id, undefined, { numeric: true });
  const expenseCats = useMemo(() => categories.filter((c) => c.kind === 'expense' && !c.archived).sort(byId), [categories]);
  const incomeCats = useMemo(() => categories.filter((c) => c.kind === 'income' && !c.archived).sort(byId), [categories]);
  const topCats = useMemo(() => {
    const use = new Map<Id, number>();
    for (const e of entries) if (e.kind === 'expense') use.set(e.categoryId, (use.get(e.categoryId) ?? 0) + 1);
    const top = expenseCats
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (use.get(b.c.id) ?? 0) - (use.get(a.c.id) ?? 0) || a.i - b.i)
      .slice(0, 4).map((x) => x.c);
    const sel = expenseCats.find((c) => c.id === categoryId);
    if (sel && !top.some((c) => c.id === sel.id)) top[top.length - 1] = sel;
    return top;
  }, [expenseCats, entries, categoryId]);

  const pickSupplier = (s: Supplier) => {
    setSupplierId(s.id);
    setCreating(false);
    if (s.defaultCategoryId) setCategoryId(s.defaultCategoryId);
  };

  const channelSel = channelId ?? incomeCats[0]?.id;

  const save = async () => {
    if (busy || cents <= 0) return;
    setBusy(true);
    setError(false);
    try {
      await getDeviceId();
      const createdBy = (await currentEmail()) ?? ''; // read before the transaction
      await db.transaction('rw', [db.suppliers, db.entries, db.payments, db.meta], async () => {
        let sid = supplierId;
        let cat = categoryId;
        if (kind === 'expense') {
          const name = newName.trim();
          if (creating && name) {
            const s = await put<Supplier>('suppliers', { name, defaultCategoryId: cat });
            sid = s.id;
          } else if (sid && cat) {
            const s = suppliers.find((x) => x.id === sid);
            if (s && !s.defaultCategoryId) await put<Supplier>('suppliers', { ...s, defaultCategoryId: cat });
          }
          cat ??= OTHER_EXPENSE_ID;
        }
        const channelCat = incomeCats.find((c) => c.id === channelSel);
        const noteText = note.trim();
        const base = {
          kind, date, amountIncl: cents, method, createdBy: initial?.createdBy ?? createdBy,
          ...(initial?.id ? { id: initial.id } : {}),
          ...(noteText ? { note: noteText } : {}),
          ...(initial?.photoId ? { photoId: initial.photoId } : {}),
          ...(initial?.amountExcl !== undefined && cents === initial.amountIncl ? { amountExcl: initial.amountExcl } : {}),
          ...(initial?.tax !== undefined && cents === initial.amountIncl ? { tax: initial.tax } : {}),
        };
        const orig = initial?.id ? await db.entries.get(initial.id) : undefined; // before overwrite
        const entry = kind === 'expense'
          ? await put<Entry>('entries', {
              ...base, categoryId: cat ?? '', ...(sid ? { supplierId: sid } : {}), status,
              ...(status === 'credit' && dueDate ? { dueDate } : {}),
            })
          : await put<Entry>('entries', { ...base, categoryId: channelCat?.id ?? '', channel: channelCat?.name ?? '' });
        // Editing: the original status comes from the DB. Paid originals own an auto "paid now"
        // payment; credit originals own real supplier payments, kept only while it stays a credit expense.
        if (initial?.id) {
          const retire = entry.kind === 'income' || entry.status === 'paid' || orig?.status === 'paid';
          if (retire) {
            const old = await db.payments.where('entryId').equals(entry.id).toArray();
            for (const p of old) if (!p.deleted) await softDelete('payments', p.id);
          }
        }
        for (const p of paymentsForPaidNow(entry)) await put('payments', p);
      });
      onGo('home');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const amountLabel = typed + (display.endsWith(sep) ? sep : '');
  const shown = cur.before ? `${cur.symbol}${amountLabel}` : `${amountLabel} ${cur.symbol}`;
  const methodLabels: Record<Method, string> = {
    cash: t('method.cash'), card: t('method.card'), transfer: t('method.transfer'), other: t('method.other'),
  };
  const methodChips = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {METHODS.map((m) => (
        <button key={m} type="button" aria-pressed={method === m} style={chip(method === m)} onClick={() => setMethod(m)}>{methodLabels[m]}</button>
      ))}
    </div>
  );
  const divider = <div style={{ height: 1, background: 'rgba(255,255,255,0.12)' }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520, margin: '0 auto', minHeight: 'calc(100vh - 44px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" className="glass" aria-label={t('add.close')} onClick={() => onGo('home')}
          style={{ width: 44, height: 44, borderRadius: 22, border: undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <Segmented<Entry['kind']> glass label={t('add.type')} value={kind} onChange={setKind} options={[
          { value: 'expense', label: t('add.expense'), activeBg: OUT, activeColor: '#3D0A0A' },
          { value: 'income', label: t('add.collection'), activeBg: IN, activeColor: '#0A3D1E' },
        ]} />
        <button type="button" className="glass" aria-label={t('add.scan')} onClick={() => onGo('bills')}
          style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0 2px' }}>
        <div style={{ fontSize: 12, color: '#C6D8E6', letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {kind === 'expense' ? t('add.amountIncl') : t('add.amount')}
        </div>
        <div data-testid="amount" style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 58, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05, color }}>
          {shown}
        </div>
      </div>

      <Glass style={{ borderRadius: 24, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {kind === 'expense' ? (
          <>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
              {recentSuppliers.map((s) => {
                const on = !creating && supplierId === s.id;
                return (
                  <button key={s.id} type="button" aria-pressed={on} style={{ ...chip(on), padding: '0 12px 0 6px' }} onClick={() => pickSupplier(s)}>
                    <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 14, background: on ? '#8FD8F2' : 'rgba(255,255,255,0.18)', color: on ? '#0A1B33' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>{initials(s.name)}</span>
                    {s.name}
                  </button>
                );
              })}
              <button type="button" aria-pressed={creating} style={chip(creating)} onClick={() => { setCreating(true); setSupplierId(undefined); }}>{t('add.newSupplier')}</button>
            </div>
            {creating && (
              <input className="field" aria-label={t('add.supplierName')} placeholder={t('add.supplierName')} value={newName}
                onChange={(e) => setNewName(e.target.value)} style={{ ...dateInput, width: '100%' }} />
            )}
            {divider}
            <div style={{ ...row, alignItems: 'flex-start', flexDirection: 'column' }}>
              <span style={rowLabel}>{t('add.category')}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {topCats.map((c) => (
                  <button key={c.id} type="button" aria-pressed={categoryId === c.id} style={chip(categoryId === c.id)} onClick={() => setCategoryId(c.id)}>{c.name}</button>
                ))}
                <button type="button" style={chip(false)} onClick={() => setSheet(true)}>{t('add.more')}</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ ...row, alignItems: 'flex-start', flexDirection: 'column' }}>
              <span style={rowLabel}>{t('add.channel')}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {incomeCats.map((c) => (
                  <button key={c.id} type="button" aria-pressed={channelSel === c.id} style={chip(channelSel === c.id)} onClick={() => setChannelId(c.id)}>{c.name}</button>
                ))}
              </div>
            </div>
            {divider}
            <div style={{ ...row, alignItems: 'flex-start', flexDirection: 'column' }}>
              <span style={rowLabel}>{t('add.method')}</span>
              {methodChips}
            </div>
          </>
        )}
        {divider}
        <label style={row}>
          <span style={rowLabel}>{kind === 'expense' ? t('add.billDate') : t('add.date')}</span>
          <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} style={dateInput} />
        </label>
        {kind === 'expense' && (
          <>
            <div style={row}>
              <span style={rowLabel}>{t('add.payment')}</span>
              <Segmented<'paid' | 'credit'> small label={t('add.paymentStatus')} value={status} onChange={setStatus} options={[
                { value: 'paid', label: t('add.paid') }, { value: 'credit', label: t('add.onCredit') },
              ]} />
            </div>
            {status === 'paid' ? methodChips : (
              <label style={row}>
                <span style={rowLabel}>{t('add.dueDate')}</span>
                <input type="date" className="field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={dateInput} />
              </label>
            )}
          </>
        )}
        <input className="field" aria-label={t('add.note')} placeholder={t('add.note')} value={note}
          onChange={(e) => setNote(e.target.value)} style={{ ...dateInput, width: '100%', fontWeight: 500 }} />
      </Glass>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Keypad decimalSep={sep} onKey={(k: KeypadKey) => setDisplay((d) => pressKey(d, k, sep))} />
        {error && <div role="alert" style={{ color: OUT, fontSize: 13, textAlign: 'center' }}>{t('add.error')}</div>}
        <button type="button" disabled={cents <= 0 || busy} onClick={() => void save()} style={{
          height: 58, borderRadius: 29, border: 0, background: 'linear-gradient(160deg, #FFFFFF 0%, #DDF2FB 100%)',
          boxShadow: 'inset 0 1px 0 #FFFFFF, 0 14px 30px rgba(2,10,24,0.45)', color: '#1B365D',
          fontSize: 17, fontWeight: 800, opacity: cents <= 0 || busy ? 0.5 : 1,
        }}>{kind === 'expense' ? t('add.saveExpense') : t('add.saveCollection')}</button>
      </div>

      {sheet && (
        <div role="dialog" aria-modal="true" aria-label={t('add.category')} onClick={() => setSheet(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,10,24,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 20 }}>
          <Glass strong onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '70vh', overflowY: 'auto', borderRadius: '24px 24px 0 0', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {expenseCats.map((c) => (
              <button key={c.id} type="button" onClick={() => { setCategoryId(c.id); setSheet(false); }} style={{
                minHeight: 48, textAlign: 'left', padding: '0 14px', borderRadius: 14, border: 0,
                background: categoryId === c.id ? 'rgba(255,255,255,0.22)' : 'transparent', font: '600 15px Inter, sans-serif', color: '#FFFFFF',
              }}>{c.name}</button>
            ))}
          </Glass>
        </div>
      )}
    </div>
  );
}
