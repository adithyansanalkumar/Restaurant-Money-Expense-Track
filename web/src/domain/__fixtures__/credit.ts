import type { Entry, Payment } from '../types';

const base = { updatedAt: 1, deviceId: 'd1', deleted: false, createdBy: 'u1' };

export const creditToday = '2026-11-25'; // a Wednesday

export const creditSuppliers = [
  { id: 'sup-martin', name: 'Boucherie Martin' },
  { id: 'sup-sud', name: 'Primeurs du Sud' },
  { id: 'sup-express', name: 'Boissons Express' },
];

const bill = (id: string, supplierId: string, date: string, amountIncl: number, dueDate: string): Entry => ({
  ...base, id, kind: 'expense', date, amountIncl, categoryId: 'cat-food', supplierId,
  method: 'transfer', status: 'credit', dueDate,
});

// owed 128000; overdue 32000 (1); thisWeek 61000 (2); later 35000 (2)
export const creditEntries: Entry[] = [
  bill('b-martin-1', 'sup-martin', '2026-11-12', 32000, '2026-11-20'),
  bill('b-martin-2', 'sup-martin', '2026-11-19', 29000, '2026-11-28'),
  bill('b-martin-3', 'sup-martin', '2026-11-23', 17000, '2026-12-07'),
  bill('b-sud-1', 'sup-sud', '2026-11-20', 32000, '2026-11-29'),
  bill('b-express-1', 'sup-express', '2026-11-22', 18000, '2026-12-10'),
];

export const creditPayments: Payment[] = [];
