import { parseAmount } from '../domain/money';
import type { Cents, Id, ISODate, Supplier } from '../domain/types';

export interface ParsedReceipt { shop?: string; supplierId?: Id; date?: ISODate; incl?: Cents; excl?: Cents; tax?: Cents }

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Same shop ignoring case/accents/punctuation; also when one name starts with the other. */
export function matchSupplier(name: string, suppliers: Supplier[]): Supplier | undefined {
  const n = normalizeName(name);
  if (n.length < 3) return undefined;
  const norm = suppliers.map((s) => ({ s, n: normalizeName(s.name) })).filter((x) => x.n.length >= 3);
  const exact = norm.find((x) => x.n === n);
  if (exact) return exact.s;
  // Compare on whole-word prefixes so "metro" matches "metro cash carry" but "met" does not match "metro".
  const pre = (a: string, b: string) => a === b || a.startsWith(b + ' ');
  return norm.find((x) => pre(n, x.n) || pre(x.n, n))?.s;
}

type Kind = 'incl' | 'excl' | 'tax';
// Higher score = more specific. A line takes the kind of its best-scoring keyword.
const KEYWORDS: { re: RegExp; kind: Kind; score: number }[] = [
  { re: /\bTOTAL\s*TTC\b/, kind: 'incl', score: 3 },
  { re: /\bNET\s*A\s*PAYER\b/, kind: 'incl', score: 3 },
  { re: /\bGRAND\s*TOTAL\b/, kind: 'incl', score: 3 },
  { re: /\bTTC\b/, kind: 'incl', score: 2 },
  { re: /\bTOTAL\b/, kind: 'incl', score: 1 },
  { re: /\bTOTAL\s*HT\b/, kind: 'excl', score: 3 },
  { re: /\bSOUS[-\s]*TOTAL\b/, kind: 'excl', score: 3 },
  { re: /\bSUB[-\s]*TOTAL\b/, kind: 'excl', score: 3 },
  { re: /\bHT\b/, kind: 'excl', score: 2 },
  { re: /\bTOTAL\s*(TVA|VAT|TAX)\b/, kind: 'tax', score: 3 },
  { re: /\b(TVA|VAT|TAX)\b/, kind: 'tax', score: 2 },
];

/** Upper-case, drop accents (so "À" matches "A"). */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// A money token: digits (or an OCR 'O' for 0), optional separators, and a 2-digit decimal part.
const AMOUNT_RE = /(?:\d[\d., ]*)?\d[.,]\d{2}(?!\d)/g;

/** Read an 'O' as 0 only when touching a digit (or another such O), e.g. "1O,5O"; "BIO" and "EURO" stay words. */
function fixZeros(line: string): string {
  let prev = line;
  for (;;) {
    const next = prev.replace(/(?<=\d)O|O(?=\d)/g, '0');
    if (next === prev) return next;
    prev = next;
  }
}

function lastAmount(line: string): Cents | undefined {
  const toks = fixZeros(line).match(AMOUNT_RE) ?? [];
  for (let i = toks.length - 1; i >= 0; i--) {
    const c = parseAmount(toks[i].trim());
    if (c !== null) return c;
  }
  return undefined;
}

function pickAmounts(lines: string[]): Record<Kind, Cents | undefined> {
  const best: Partial<Record<Kind, { score: number; cents: Cents }>> = {};
  for (const raw of lines) {
    const line = fold(raw);
    let hit: { kind: Kind; score: number } | undefined;
    for (const k of KEYWORDS) if (k.re.test(line) && (!hit || k.score > hit.score)) hit = k;
    if (!hit) continue;
    // Keep digits-only text after the keyword so "TVA 20%" is not read as 20.
    const cents = lastAmount(raw.replace(/\d+(?:[.,]\d+)?\s*%/g, ' '));
    if (cents === undefined) continue;
    const cur = best[hit.kind];
    if (!cur || hit.score >= cur.score) best[hit.kind] = { score: hit.score, cents }; // >= : bottom-most wins ties
  }
  return { incl: best.incl?.cents, excl: best.excl?.cents, tax: best.tax?.cents };
}

const iso = (y: number, m: number, d: number): ISODate | undefined => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

function parseDate(text: string, lang: 'fra' | 'eng'): ISODate | undefined {
  // OCR can put spaces inside the date ("2 5 . 1 1 . 2 6"): try a squeezed copy too.
  const candidates = [text, ...text.split('\n').map((l) => l.replace(/(\d)\s+(?=[\d./-])|(?<=[./-])\s+(?=\d)/g, '$1'))];
  for (const src of candidates) {
    const ymd = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(src);
    if (ymd) { const r = iso(+ymd[1], +ymd[2], +ymd[3]); if (r) return r; }
    for (const m of src.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g)) {
      const a = +m[1]; const b = +m[2];
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      // Day first unless only month-first makes sense; ambiguous dates follow the bill language's
      // usual order (day first for both here: FR, and GB/IN English).
      const monthFirst = a <= 12 && b > 12;
      void lang;
      const r = monthFirst ? iso(y, a, b) : iso(y, b, a);
      if (r) return r;
    }
  }
  return undefined;
}

function guessShop(lines: string[], suppliers: Supplier[]): { shop?: string; supplier?: Supplier } {
  const cands = lines.map((l) => l.trim()).filter((l) => (l.match(/\p{L}/gu)?.length ?? 0) >= 3 && !/^\d/.test(l));
  for (const c of cands.slice(0, 5)) {
    const s = matchSupplier(c, suppliers);
    if (s) return { shop: c, supplier: s };
  }
  return { shop: cands[0] };
}

export function parseReceipt(text: string, lang: 'fra' | 'eng', suppliers: Supplier[]): ParsedReceipt {
  const lines = text.split(/\r?\n/);
  let { incl, excl, tax } = pickAmounts(lines);
  if (incl === undefined && excl !== undefined && tax !== undefined) incl = excl + tax;
  else if (excl === undefined && incl !== undefined && tax !== undefined && incl >= tax) excl = incl - tax;
  else if (tax === undefined && incl !== undefined && excl !== undefined && incl >= excl) tax = incl - excl;
  const { shop, supplier } = guessShop(lines, suppliers);
  const out: ParsedReceipt = {};
  if (shop) out.shop = shop;
  if (supplier) out.supplierId = supplier.id;
  const date = parseDate(text, lang);
  if (date) out.date = date;
  if (incl !== undefined) out.incl = incl;
  if (excl !== undefined) out.excl = excl;
  if (tax !== undefined) out.tax = tax;
  return out;
}
