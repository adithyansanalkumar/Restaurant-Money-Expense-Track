import type { Entry, Payment } from '../types';

const base = { updatedAt: 1, deviceId: 'd1', deleted: false, createdBy: 'u1' };

// November 2026: in 980000, out 746000, profit 234000. October: profit 209000.
export const novemberEntries: Entry[] = [
  { ...base, id: 'e-oct31', kind: 'income', date: '2026-10-31', amountIncl: 209000, amountExcl: 190000, categoryId: 'inc-dine', channel: 'dine-in', method: 'card' },
  { ...base, id: 'e-nov10', kind: 'income', date: '2026-11-10', amountIncl: 980000, amountExcl: 890000, categoryId: 'inc-dine', channel: 'dine-in', method: 'card' },
  { ...base, id: 'e-nov15', kind: 'expense', date: '2026-11-15', amountIncl: 450000, amountExcl: 410000, categoryId: 'cat-food', supplierId: 'sup-a', method: 'transfer', status: 'paid' },
  // no amountExcl -> falls back to amountIncl in 'excl' view
  { ...base, id: 'e-nov28', kind: 'expense', date: '2026-11-28', amountIncl: 296000, categoryId: 'cat-drinks', supplierId: 'sup-b', method: 'transfer', status: 'credit', dueDate: '2026-12-15' },
  { ...base, id: 'e-dec02', kind: 'expense', date: '2026-12-02', amountIncl: 50000, amountExcl: 45000, categoryId: 'cat-food', supplierId: 'sup-a', method: 'cash', status: 'paid' },
  { ...base, id: 'e-deleted', kind: 'expense', date: '2026-11-12', amountIncl: 999999, categoryId: 'cat-food', supplierId: 'sup-a', method: 'cash', deleted: true },
];

export const novemberPayments: Payment[] = [
  { ...base, id: 'p-nov28', entryId: 'e-nov28', date: '2026-12-10', amount: 296000, method: 'transfer' },
];
