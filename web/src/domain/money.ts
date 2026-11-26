import type { Cents } from './types';

const SEP_CLASS = /[   .,]/;

/** Validate an integer part with optional thousands separators; returns digits or null. */
function parseInt_(part: string, forbidden: string | null): string | null {
  if (/^\d+$/.test(part)) return part;
  const seps = new Set(part.split('').filter((ch) => SEP_CLASS.test(ch)));
  if (seps.size !== 1) return null;
  const sep = [...seps][0];
  if (sep === forbidden) return null;
  const groups = part.split(sep);
  if (!/^\d{1,3}$/.test(groups[0])) return null;
  if (!groups.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
  return groups.join('');
}

/** Parse a user-typed amount into cents; null when invalid. */
export function parseAmount(input: string): Cents | null {
  const s = input.trim();
  if (!/^\d[\d.,   ]*$/.test(s)) return null;
  const m = /^(.*\d)([.,])(\d{1,2})$/.exec(s);
  let intPart: string;
  let frac = '';
  if (m) {
    const digits = parseInt_(m[1], m[2]);
    if (digits === null) return null;
    intPart = digits;
    frac = m[3];
  } else {
    const digits = parseInt_(s, null);
    if (digits === null) return null;
    intPart = digits;
  }
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Format cents as localized currency; real minus sign; optional explicit '+'. */
export function formatMoney(
  c: Cents,
  currency: string,
  locale: string,
  opts?: { sign?: boolean },
): string {
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    signDisplay: opts?.sign ? 'exceptZero' : 'auto',
  });
  return fmt.format(c / 100).replace(/-/g, '−');
}
