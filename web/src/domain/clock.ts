import type { ISODate } from './types';

/** Today's date in the device's LOCAL time zone. Tests stub this. */
export function todayISO(): ISODate {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
