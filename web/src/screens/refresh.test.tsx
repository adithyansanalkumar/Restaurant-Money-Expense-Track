import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { put, seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import type { Entry, Supplier } from '../domain/types';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));
const rev = vi.hoisted(() => ({ n: 0 }));
vi.mock('../sync/sync', async (orig) => {
  const o = await orig<typeof import('../sync/sync')>();
  return { ...o, useSyncStatus: () => ({ ...o.getSyncState(), revision: rev.n }) };
});
import { History } from './History';
import { Owe } from './Owe';
import { Reports } from './Reports';

beforeEach(async () => {
  setLanguage('en');
  rev.n = 0;
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'R', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
});

const addEntry = (over: Partial<Entry> = {}) => put<Entry>('entries', {
  kind: 'expense', date: '2026-11-20', amountIncl: 10000, categoryId: 'cat:expense:0', method: 'cash', createdBy: '', ...over,
});

test('History reloads when the sync revision changes', async () => {
  const sup = await put<Supplier>('suppliers', { name: 'Metro' });
  const { rerender } = render(<History onGo={vi.fn()} />);
  await screen.findByRole('textbox').catch(() => {});
  expect(screen.queryByText('Metro')).toBeNull();
  await addEntry({ supplierId: sup.id });
  rev.n = 1;
  rerender(<History onGo={vi.fn()} />);
  expect(await screen.findByText('Metro')).toBeTruthy();
});

test('Owe reloads when the sync revision changes', async () => {
  const sup = await put<Supplier>('suppliers', { name: 'Metro' });
  const { rerender } = render(<Owe onGo={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText('Metro')).toBeNull());
  await addEntry({ supplierId: sup.id, status: 'credit', dueDate: '2026-11-30' });
  rev.n = 1;
  rerender(<Owe onGo={vi.fn()} />);
  expect((await screen.findAllByText('Metro')).length).toBeGreaterThan(0);
});

test('Reports reloads when the sync revision changes', async () => {
  const { rerender } = render(<Reports />);
  await waitFor(() => expect(screen.getByTestId('range-profit')).toBeTruthy());
  const before = screen.getByTestId('range-profit').textContent;
  await addEntry({ kind: 'income', amountIncl: 50000, categoryId: 'cat:income:0' });
  rev.n = 1;
  rerender(<Reports />);
  await waitFor(() => expect(screen.getByTestId('range-profit').textContent).not.toBe(before));
});
