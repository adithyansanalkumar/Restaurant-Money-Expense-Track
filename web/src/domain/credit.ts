import type { Cents, Entry, Id, ISODate, Payment } from './types';

type Method = Payment['method'];

const toMs = (d: ISODate) => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};
const addDays = (d: ISODate, n: number): ISODate => new Date(toMs(d) + n * 86400000).toISOString().slice(0, 10);

export type OpenBill = { entry: Entry; paid: Cents; remaining: Cents };

export function openBills(entries: Entry[], payments: Payment[]): OpenBill[] {
  const paidBy = new Map<Id, Cents>();
  for (const p of payments) if (!p.deleted) paidBy.set(p.entryId, (paidBy.get(p.entryId) ?? 0) + p.amount);
  return entries
    .filter((e) => !e.deleted && e.kind === 'expense' && e.status === 'credit')
    .map((entry) => {
      const paid = paidBy.get(entry.id) ?? 0;
      return { entry, paid, remaining: entry.amountIncl - paid };
    })
    .filter((b) => b.remaining > 0)
    .sort((a, b) => (a.entry.date < b.entry.date ? -1 : a.entry.date > b.entry.date ? 1 : a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
}

export function supplierBalances(entries: Entry[], payments: Payment[]) {
  const open = openBills(entries, payments);
  const owedBy = new Map<Id, { owed: Cents; bills: number }>();
  for (const b of open) {
    const id = b.entry.supplierId;
    if (id === undefined) continue;
    const cur = owedBy.get(id) ?? { owed: 0, bills: 0 };
    cur.owed += b.remaining;
    cur.bills++;
    owedBy.set(id, cur);
  }
  const paidBy = new Map<Id, Cents>();
  for (const p of payments) if (!p.deleted) paidBy.set(p.entryId, (paidBy.get(p.entryId) ?? 0) + p.amount);
  const result: { supplierId: Id; owed: Cents; bills: number; paidSoFar: Cents; total: Cents }[] = [];
  for (const [supplierId, { owed, bills }] of owedBy) {
    let paidSoFar = 0, total = 0;
    for (const e of entries) {
      if (e.deleted || e.kind !== 'expense' || e.status !== 'credit' || e.supplierId !== supplierId) continue;
      total += e.amountIncl;
      paidSoFar += paidBy.get(e.id) ?? 0;
    }
    result.push({ supplierId, owed, bills, paidSoFar, total });
  }
  return result.sort((a, b) => b.owed - a.owed);
}

export function dueBucket(bill: Entry, today: ISODate): 'overdue' | 'thisWeek' | 'later' | 'none' {
  if (!bill.dueDate) return 'none';
  if (bill.dueDate < today) return 'overdue';
  const dow = new Date(toMs(today)).getUTCDay(); // 0 = Sunday
  const sunday = addDays(today, (7 - dow) % 7);
  return bill.dueDate <= sunday ? 'thisWeek' : 'later';
}

export function allocatePayment(
  supplierId: Id, amount: Cents, date: ISODate, method: Method,
  entries: Entry[], payments: Payment[], createdBy = '',
): Payment[] | { error: 'tooMuch' | 'notPositive'; owed: Cents } {
  const bills = openBills(entries, payments).filter((b) => b.entry.supplierId === supplierId);
  const owed = bills.reduce((s, b) => s + b.remaining, 0);
  if (amount <= 0) return { error: 'notPositive', owed };
  if (amount > owed) return { error: 'tooMuch', owed };
  const out: Payment[] = [];
  let left = amount;
  for (const b of bills) {
    if (left <= 0) break;
    const take = Math.min(left, b.remaining);
    out.push({
      id: crypto.randomUUID(), updatedAt: 0, deviceId: '', deleted: false,
      entryId: b.entry.id, date, amount: take, method, createdBy,
    });
    left -= take;
  }
  return out;
}

export function paymentsForPaidNow(entry: Entry): Payment[] {
  if (entry.kind !== 'expense' || entry.status !== 'paid') return [];
  return [{
    id: crypto.randomUUID(), updatedAt: 0, deviceId: '', deleted: false,
    entryId: entry.id, date: entry.date, amount: entry.amountIncl, method: entry.method, createdBy: entry.createdBy,
  }];
}
