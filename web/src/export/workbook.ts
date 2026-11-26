import writeXlsxFile from 'write-excel-file/browser';
import type { Category, Entry, ISODate, Payment, Supplier } from '../domain/types';
import { byCategory, bySupplier, series } from '../domain/totals';
import { supplierBalances } from '../domain/credit';
import { db } from '../db/db';
import { listLive } from '../db/repo';
import { getLanguage, t, type Key } from '../i18n';
import { COUNTRY_DEFAULTS } from '../settings/store';

export interface ExportData { entries: Entry[]; payments: Payment[]; suppliers: Supplier[]; categories: Category[] }
export type Cell = string | number | Date | null;
export type SheetRows = { sheet: string; rows: Cell[][] };
type View = 'incl' | 'excl';
type T = (key: Key, vars?: Record<string, string | number>) => string;

const units = (cents: number) => cents / 100;
const optUnits = (cents?: number | null) => (cents === undefined || cents === null ? null : units(cents));

export const exportFilename = (from: ISODate, to: ISODate) => `restaurant-${from}_${to}.xlsx`;

function monthLabel(ym: string, locale: string): string {
  const [y, m] = ym.split('-').map(Number);
  const mon = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${mon.replace(/\.$/, '')} ${y}`;
}

export function buildWorkbook(data: ExportData, from: ISODate, to: ISODate, view: View, t: T, locale = 'en'): SheetRows[] {
  const live = <R extends { deleted: boolean }>(rows: R[]) => rows.filter((r) => !r.deleted);
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const supName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  const cn = (id?: string) => (id === undefined ? null : catName.get(id) ?? null);
  const sn = (id?: string) => (id === undefined ? null : supName.get(id) ?? null);
  const entries = live(data.entries);
  const payments = live(data.payments);
  const entryById = new Map(entries.map((e) => [e.id, e]));

  // Entries
  const inRange = entries.filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.updatedAt - b.updatedAt));
  const entryRows: Cell[][] = [[
    t('export.date'), t('export.type'), t('export.category'), t('export.supplier'), t('export.channel'),
    t('export.amountIncl'), t('export.amountExcl'), t('export.tax'), t('export.method'), t('export.status'),
    t('export.dueDate'), t('export.note'),
  ]];
  for (const e of inRange) {
    entryRows.push([
      e.date, e.kind === 'income' ? t('export.income') : t('export.expense'), cn(e.categoryId), sn(e.supplierId),
      e.channel ?? null, units(e.amountIncl), optUnits(e.amountExcl), optUnits(e.tax),
      t(`method.${e.method}` as Key), e.status ? (e.status === 'credit' ? t('export.credit') : t('export.paid')) : null,
      e.dueDate ?? null, e.note ?? null,
    ]);
  }

  // Monthly summary
  const months = series(entries, from, to, 'month', view);
  const monthly: Cell[][] = [[t('export.month'), t('export.in'), t('export.out'), t('export.profit')]];
  for (const m of months) monthly.push([monthLabel(m.label, locale), units(m.in), units(m.out), units(m.profit)]);

  // By category (rows: categories, columns: months + total)
  const perMonth = months.map((m) => {
    const start = m.label + '-01';
    const end = m.label + '-31';
    return byCategory(entries, start < from ? from : start, end > to ? to : end, view);
  });
  const catTotals = byCategory(entries, from, to, view);
  const catRows: Cell[][] = [[t('export.category'), ...months.map((m) => monthLabel(m.label, locale)), t('export.total')]];
  for (const c of catTotals) {
    catRows.push([
      cn(c.categoryId), ...perMonth.map((pm) => units(pm.find((x) => x.categoryId === c.categoryId)?.cents ?? 0)), units(c.cents),
    ]);
  }

  // By supplier
  const supRows: Cell[][] = [[t('export.supplier'), t('export.total'), t('export.share')]];
  for (const s of bySupplier(entries, from, to, view)) supRows.push([sn(s.supplierId), units(s.cents), s.share]);

  // Payments
  const payRows: Cell[][] = [[t('export.date'), t('export.supplier'), t('export.billDate'), t('export.amount'), t('export.method')]];
  for (const p of payments.filter((x) => x.date >= from && x.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const e = entryById.get(p.entryId);
    payRows.push([p.date, sn(e?.supplierId), e?.date ?? null, units(p.amount), t(`method.${p.method}` as Key)]);
  }

  // Supplier balances (current, not range-limited)
  const balRows: Cell[][] = [[t('export.supplier'), t('export.bills'), t('export.creditTotal'), t('export.paidSoFar'), t('export.owed')]];
  for (const b of supplierBalances(entries, payments)) {
    balRows.push([sn(b.supplierId), b.bills, units(b.total), units(b.paidSoFar), units(b.owed)]);
  }

  return [
    { sheet: t('export.entries'), rows: entryRows },
    { sheet: t('export.monthly'), rows: monthly },
    { sheet: t('export.byCategory'), rows: catRows },
    { sheet: t('export.bySupplier'), rows: supRows },
    { sheet: t('export.payments'), rows: payRows },
    { sheet: t('export.balances'), rows: balRows },
  ];
}

export async function exportExcel(from: ISODate, to: ISODate): Promise<Blob> {
  const [entries, payments, suppliers, categories, shared] = await Promise.all([
    listLive<Entry>('entries'), listLive<Payment>('payments'), listLive<Supplier>('suppliers'), listLive<Category>('categories'),
    db.settings.get('shared'),
  ]);
  const view: View = shared?.taxView ?? 'incl';
  const locale = (shared && COUNTRY_DEFAULTS[shared.country]?.locale) || getLanguage();
  const sheets = buildWorkbook({ entries, payments, suppliers, categories }, from, to, view, t, locale);
  return writeXlsxFile(sheets.map((s) => ({ sheet: s.sheet, data: s.rows }))).toBlob();
}
