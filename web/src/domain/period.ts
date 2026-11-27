import type { ISODate } from './types';

export type Period = 'day' | 'week' | 'month' | 'year';

const toMs = (d: ISODate) => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
const fromMs = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: ISODate, n: number) => fromMs(toMs(d) + n * 86400000);
const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The day / week / month / year containing `today`. */
export function periodRange(period: Period, today: ISODate, weekStart: 0 | 1): { from: ISODate; to: ISODate } {
  if (period === 'day') return { from: today, to: today };
  if (period === 'week') {
    const dow = new Date(toMs(today)).getUTCDay();
    const from = addDays(today, -((dow - weekStart + 7) % 7));
    return { from, to: addDays(from, 6) };
  }
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (period === 'month') return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` };
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** The immediately preceding period of the same kind. */
export function previousRange(period: Period, today: ISODate, weekStart: 0 | 1): { from: ISODate; to: ISODate } {
  const { from } = periodRange(period, today, weekStart);
  return periodRange(period, addDays(from, -1), weekStart);
}
