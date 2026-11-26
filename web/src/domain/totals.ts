import type { Cents, Entry, Id, ISODate, Payment } from './types';

type View = 'incl' | 'excl';
type Bucket = 'day' | 'week' | 'month';

export function shownAmount(e: Entry, view: View): { cents: Cents; fallback: boolean } {
  if (view === 'excl') {
    if (e.amountExcl === undefined || e.amountExcl === null) return { cents: e.amountIncl, fallback: true };
    return { cents: e.amountExcl, fallback: false };
  }
  return { cents: e.amountIncl, fallback: false };
}

const inRange = (d: ISODate, from: ISODate, to: ISODate) => d >= from && d <= to;
const live = (entries: Entry[], from: ISODate, to: ISODate) =>
  entries.filter((e) => !e.deleted && inRange(e.date, from, to));

// UTC-safe date helpers
const toMs = (d: ISODate) => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};
const fromMs = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: ISODate, n: number) => fromMs(toMs(d) + n * 86400000);

function bucketStart(d: ISODate, bucket: Bucket, weekStart: number): ISODate {
  if (bucket === 'day') return d;
  if (bucket === 'month') return d.slice(0, 7) + '-01';
  const dow = new Date(toMs(d)).getUTCDay();
  return addDays(d, -((dow - weekStart + 7) % 7));
}
function nextBucket(start: ISODate, bucket: Bucket): ISODate {
  if (bucket === 'day') return addDays(start, 1);
  if (bucket === 'week') return addDays(start, 7);
  const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export function summarize(entries: Entry[], from: ISODate, to: ISODate, view: View) {
  let inn = 0, out = 0, fallbackCount = 0;
  for (const e of live(entries, from, to)) {
    const { cents, fallback } = shownAmount(e, view);
    if (fallback) fallbackCount++;
    if (e.kind === 'income') inn += cents; else out += cents;
  }
  return { in: inn, out, profit: inn - out, fallbackCount };
}

export function series(
  entries: Entry[], from: ISODate, to: ISODate, bucket: Bucket, view: View, weekStart = 1,
): { label: string; in: Cents; out: Cents; profit: Cents }[] {
  const label = (start: ISODate) => (bucket === 'month' ? start.slice(0, 7) : start);
  const map = new Map<string, { label: string; in: Cents; out: Cents; profit: Cents }>();
  for (let s = bucketStart(from, bucket, weekStart); s <= to; s = nextBucket(s, bucket)) {
    map.set(s, { label: label(s), in: 0, out: 0, profit: 0 });
  }
  for (const e of live(entries, from, to)) {
    const b = map.get(bucketStart(e.date, bucket, weekStart))!;
    const { cents } = shownAmount(e, view);
    if (e.kind === 'income') b.in += cents; else b.out += cents;
    b.profit = b.in - b.out;
  }
  return [...map.values()];
}

function groupOut(entries: Entry[], from: ISODate, to: ISODate, view: View, key: (e: Entry) => Id | undefined) {
  const exp = live(entries, from, to).filter((e) => e.kind === 'expense');
  const total = exp.reduce((s, e) => s + shownAmount(e, view).cents, 0);
  const m = new Map<Id, Cents>();
  for (const e of exp) {
    const k = key(e);
    if (k === undefined) continue;
    m.set(k, (m.get(k) ?? 0) + shownAmount(e, view).cents);
  }
  return [...m].map(([id, cents]) => ({ id, cents, share: total === 0 ? 0 : cents / total }))
    .sort((a, b) => b.cents - a.cents);
}

export function byCategory(entries: Entry[], from: ISODate, to: ISODate, view: View) {
  return groupOut(entries, from, to, view, (e) => e.categoryId)
    .map(({ id, cents, share }) => ({ categoryId: id, cents, share }));
}

export function bySupplier(entries: Entry[], from: ISODate, to: ISODate, view: View) {
  return groupOut(entries, from, to, view, (e) => e.supplierId)
    .map(({ id, cents, share }) => ({ supplierId: id, cents, share }));
}

export function cashOut(payments: Payment[], from: ISODate, to: ISODate): Cents {
  return payments.filter((p) => !p.deleted && inRange(p.date, from, to)).reduce((s, p) => s + p.amount, 0);
}

export function compare(curr: Cents, prev: Cents): number | null {
  return prev === 0 ? null : (curr - prev) / Math.abs(prev);
}
