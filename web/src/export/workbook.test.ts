import { describe, expect, test } from 'vitest';
import { buildWorkbook, exportFilename, type ExportData } from './workbook';
import { translate } from '../i18n';
import { novemberEntries, novemberPayments } from '../domain/__fixtures__/november';
import type { Category, Supplier } from '../domain/types';

const base = { updatedAt: 1, deviceId: 'd1', deleted: false };
const suppliers: Supplier[] = [
  { ...base, id: 'sup-a', name: 'Boucherie A' },
  { ...base, id: 'sup-b', name: 'Boissons B' },
];
const categories: Category[] = [
  { ...base, id: 'inc-dine', name: 'Dine-in', kind: 'income', archived: false },
  { ...base, id: 'cat-food', name: 'Food', kind: 'expense', archived: false },
  { ...base, id: 'cat-drinks', name: 'Drinks', kind: 'expense', archived: false },
];
const data: ExportData = { entries: novemberEntries, payments: novemberPayments, suppliers, categories };
const tt = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
const sheets = buildWorkbook(data, '2026-11-01', '2026-11-30', 'incl', tt as never, 'en-US');
const get = (name: string) => sheets.find((s) => s.sheet === name)!.rows;

describe('buildWorkbook', () => {
  test('sheet order and names', () => {
    expect(sheets.map((s) => s.sheet)).toEqual(['Entries', 'Monthly summary', 'By category', 'By supplier', 'Payments', 'Supplier balances']);
  });

  test('monthly summary: Nov 2026 in/out/profit as numbers in currency units', () => {
    const rows = get('Monthly summary');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['Nov 2026', 9800, 7460, 2340]);
  });

  test('entries sheet: header + one row per live in-range entry, names not ids', () => {
    const rows = get('Entries');
    expect(rows).toHaveLength(1 + 3);
    const flat = rows.slice(1).flat();
    expect(flat).toContain('Food');
    expect(flat).toContain('Boucherie A');
    expect(flat).not.toContain('cat-food');
    expect(flat).not.toContain(999999 / 100);
    const nov15 = rows.find((r) => r[0] === '2026-11-15')!;
    expect(nov15).toContain(4500);
    expect(rows.slice(1).flat().every((c) => c === null || typeof c === 'string' || typeof c === 'number')).toBe(true);
  });

  test('payments sheet only has payments dated in range; balances are not range limited', () => {
    expect(get('Payments')).toHaveLength(1); // header only: payment dated 2026-12-10
    const dec = buildWorkbook(data, '2026-12-01', '2026-12-31', 'incl', tt as never, 'en-US');
    const pay = dec.find((s) => s.sheet === 'Payments')!.rows;
    expect(pay).toHaveLength(2);
    expect(pay[1]).toContain(2960);
    expect(pay[1]).toContain('Boissons B');
    expect(get('Supplier balances')).toHaveLength(1); // nothing owed after payment
  });

  test('by supplier lists expense totals with names', () => {
    const rows = get('By supplier');
    expect(rows.map((r) => r[0])).toContain('Boucherie A');
    expect(rows.find((r) => r[0] === 'Boucherie A')![1]).toBe(4500);
  });

  test('filename', () => {
    expect(exportFilename('2026-11-01', '2026-11-30')).toBe('restaurant-2026-11-01_2026-11-30.xlsx');
  });
});
