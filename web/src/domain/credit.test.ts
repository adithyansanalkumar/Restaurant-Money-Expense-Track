import { describe, expect, it } from 'vitest';
import { allocatePayment, dueBucket, openBills, paymentsForPaidNow, supplierBalances } from './credit';
import { creditEntries, creditPayments, creditToday } from './__fixtures__/credit';
import type { Entry, Payment } from './types';

const martin = creditEntries.filter((e) => e.supplierId === 'sup-martin');
const pay = (entryId: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: 'p-' + entryId + amount, updatedAt: 1, deviceId: 'd', deleted: false, entryId,
  date: '2026-11-24', amount, method: 'cash', createdBy: 'u', ...extra,
});

describe('openBills', () => {
  it('sorts oldest first and ignores deleted/paid/income', () => {
    const extra: Entry[] = [
      { ...creditEntries[0], id: 'del', deleted: true },
      { ...creditEntries[0], id: 'paid', status: 'paid' },
      { ...creditEntries[0], id: 'inc', kind: 'income' },
    ];
    const r = openBills([...creditEntries, ...extra], creditPayments);
    expect(r.map((b) => b.entry.id)).toEqual(['b-martin-1', 'b-martin-2', 'b-sud-1', 'b-express-1', 'b-martin-3']);
  });
  it('subtracts live payments and drops settled bills', () => {
    const ps = [pay('b-martin-1', 32000), pay('b-martin-2', 5000), pay('b-martin-3', 17000, { deleted: true })];
    const r = openBills(martin, ps);
    expect(r.map((b) => [b.entry.id, b.paid, b.remaining])).toEqual([
      ['b-martin-2', 5000, 24000],
      ['b-martin-3', 0, 17000],
    ]);
  });
});

describe('supplierBalances', () => {
  it('aggregates and sorts by owed desc', () => {
    const r = supplierBalances(creditEntries, [pay('b-martin-2', 5000)]);
    expect(r[0]).toEqual({ supplierId: 'sup-martin', owed: 73000, bills: 3, paidSoFar: 5000, total: 78000 });
    expect(r.map((b) => b.owed)).toEqual([73000, 32000, 18000]);
  });
});

describe('dueBucket', () => {
  const t = creditToday;
  const b = (dueDate?: string) => ({ ...creditEntries[0], dueDate }) as Entry;
  it('buckets', () => {
    expect(dueBucket(b('2026-11-20'), t)).toBe('overdue');
    expect(dueBucket(b('2026-11-28'), t)).toBe('thisWeek');
    expect(dueBucket(b('2026-11-29'), t)).toBe('thisWeek');
    expect(dueBucket(b('2026-11-30'), t)).toBe('later');
    expect(dueBucket(b('2026-12-07'), t)).toBe('later');
    expect(dueBucket(b(undefined), t)).toBe('none');
    expect(dueBucket(b('2026-11-25'), t)).toBe('thisWeek');
  });
  it('Sunday today: week ends today', () => {
    expect(dueBucket(b('2026-11-29'), '2026-11-29')).toBe('thisWeek');
    expect(dueBucket(b('2026-11-30'), '2026-11-29')).toBe('later');
  });
  it('fixture totals', () => {
    const sum = (k: string) => openBills(creditEntries, creditPayments).filter((x) => dueBucket(x.entry, t) === k);
    expect(sum('overdue').reduce((s, x) => s + x.remaining, 0)).toBe(32000);
    expect(sum('thisWeek').reduce((s, x) => s + x.remaining, 0)).toBe(61000);
    expect(sum('later').reduce((s, x) => s + x.remaining, 0)).toBe(35000);
    expect(sum('thisWeek')).toHaveLength(2);
  });
});

describe('allocatePayment', () => {
  it('pays oldest first', () => {
    const r = allocatePayment('sup-martin', 40000, '2026-11-25', 'transfer', creditEntries, creditPayments, 'u9');
    if (!Array.isArray(r)) throw new Error('expected payments');
    expect(r.map((p) => [p.entryId, p.amount])).toEqual([['b-martin-1', 32000], ['b-martin-2', 8000]]);
    expect(r[0]).toMatchObject({ updatedAt: 0, deviceId: '', deleted: false, date: '2026-11-25', method: 'transfer', createdBy: 'u9' });
    expect(r[0].id).not.toBe(r[1].id);
  });
  it('accounts for existing payments', () => {
    const r = allocatePayment('sup-martin', 24000, '2026-11-25', 'cash', creditEntries, [pay('b-martin-1', 32000), pay('b-martin-2', 5000)]);
    expect(Array.isArray(r) && r.map((p) => [p.entryId, p.amount])).toEqual([['b-martin-2', 24000]]);
  });
  it('rejects overpay and non-positive', () => {
    expect(allocatePayment('sup-martin', 78001, '2026-11-25', 'cash', creditEntries, [])).toEqual({ error: 'tooMuch', owed: 78000 });
    expect(allocatePayment('sup-martin', 0, '2026-11-25', 'cash', creditEntries, [])).toEqual({ error: 'notPositive', owed: 78000 });
    expect(allocatePayment('sup-martin', -5, '2026-11-25', 'cash', creditEntries, [])).toEqual({ error: 'notPositive', owed: 78000 });
  });
});

describe('paymentsForPaidNow', () => {
  it('one payment for paid expense', () => {
    const e = { ...creditEntries[0], status: 'paid' as const, method: 'card' as const };
    const r = paymentsForPaidNow(e);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(`paid:${e.id}`); // deterministic: concurrent edits of one entry merge (LWW)
    expect(r[0]).toMatchObject({ entryId: e.id, date: e.date, amount: e.amountIncl, method: 'card', createdBy: 'u1', deleted: false });
  });
  it('none otherwise', () => {
    expect(paymentsForPaidNow(creditEntries[0])).toEqual([]);
    expect(paymentsForPaidNow({ ...creditEntries[0], kind: 'income', status: 'paid' })).toEqual([]);
  });
});
