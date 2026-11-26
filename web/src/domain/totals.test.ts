import { describe, expect, test } from 'vitest';
import { shownAmount, summarize, series, byCategory, bySupplier, cashOut, compare } from './totals';
import { novemberEntries as E, novemberPayments as P } from './__fixtures__/november';

describe('summarize', () => {
  test('November incl', () => {
    expect(summarize(E, '2026-11-01', '2026-11-30', 'incl')).toEqual({ in: 980000, out: 746000, profit: 234000, fallbackCount: 0 });
  });
  test('October profit; bounds inclusive', () => {
    expect(summarize(E, '2026-10-01', '2026-10-31', 'incl').profit).toBe(209000);
    expect(summarize(E, '2026-10-31', '2026-10-31', 'incl').in).toBe(209000);
    expect(summarize(E, '2026-12-02', '2026-12-02', 'incl').out).toBe(50000);
  });
  test('excl view falls back and counts', () => {
    const s = summarize(E, '2026-11-01', '2026-11-30', 'excl');
    expect(s.fallbackCount).toBe(1);
    expect(s.out).toBe(410000 + 296000);
    expect(s.in).toBe(890000);
  });
  test('deleted ignored', () => {
    expect(summarize(E, '2026-11-12', '2026-11-12', 'incl').out).toBe(0);
  });
});

test('shownAmount', () => {
  expect(shownAmount(E[3], 'excl')).toEqual({ cents: 296000, fallback: true });
  expect(shownAmount(E[2], 'excl')).toEqual({ cents: 410000, fallback: false });
  expect(shownAmount(E[3], 'incl')).toEqual({ cents: 296000, fallback: false });
});

test('cashOut excludes December payment from November', () => {
  expect(cashOut(P, '2026-11-01', '2026-11-30')).toBe(0);
  expect(cashOut(P, '2026-12-01', '2026-12-31')).toBe(296000);
});

test('compare', () => {
  expect(compare(234000, 209000)).toBeCloseTo(0.1196, 4);
  expect(compare(5, 0)).toBeNull();
  expect(compare(-50, -100)).toBe(0.5);
});

describe('series', () => {
  test('day buckets fill gaps', () => {
    const s = series(E, '2026-11-09', '2026-11-11', 'day', 'incl');
    expect(s.map((b) => b.label)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(s[1]).toEqual({ label: '2026-11-10', in: 980000, out: 0, profit: 980000 });
    expect(s[0].in).toBe(0);
  });
  test('week buckets start Monday by default', () => {
    const s = series(E, '2026-11-01', '2026-11-30', 'week', 'incl');
    expect(s[0].label).toBe('2026-10-26'); // 1 Nov 2026 is a Sunday
    expect(s.map((b) => b.label)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(s.find((b) => b.label === '2026-11-09')!.in).toBe(980000);
    expect(s.find((b) => b.label === '2026-11-23')!.out).toBe(296000);
  });
  test('week start Sunday', () => {
    expect(series(E, '2026-11-10', '2026-11-10', 'week', 'incl', 0)[0].label).toBe('2026-11-08');
  });
  test('month buckets', () => {
    const s = series(E, '2026-10-01', '2026-12-31', 'month', 'incl');
    expect(s.map((b) => [b.label, b.profit])).toEqual([['2026-10', 209000], ['2026-11', 234000], ['2026-12', -50000]]);
  });
});

describe('byCategory / bySupplier', () => {
  test('category sorted with shares', () => {
    const r = byCategory(E, '2026-11-01', '2026-11-30', 'incl');
    expect(r.map((x) => [x.categoryId, x.cents])).toEqual([['cat-food', 450000], ['cat-drinks', 296000]]);
    expect(r[0].share).toBeCloseTo(450000 / 746000);
  });
  test('supplier skips entries without supplier; share 0 on empty', () => {
    const r = bySupplier(E, '2026-11-01', '2026-11-30', 'incl');
    expect(r.map((x) => x.supplierId)).toEqual(['sup-a', 'sup-b']);
    expect(bySupplier(E, '2027-01-01', '2027-01-31', 'incl')).toEqual([]);
    const noSup = [{ ...E[2], supplierId: undefined }];
    expect(bySupplier(noSup, '2026-11-01', '2026-11-30', 'incl')).toEqual([]);
  });
});
