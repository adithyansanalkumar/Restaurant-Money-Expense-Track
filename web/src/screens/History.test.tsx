import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { put, seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import type { Entry, Payment, Supplier } from '../domain/types';
import { getEditing, setEditing } from '../ui/editing';
import { History } from './History';

beforeEach(async () => {
  setLanguage('en');
  setEditing(null);
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'R', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  window.location.hash = '';
});

const entry = (id: string, over: Partial<Entry>): Omit<Entry, 'updatedAt' | 'deviceId' | 'deleted'> => ({
  id, kind: 'expense', date: '2026-11-10', amountIncl: 10000, categoryId: 'cat:expense:0', method: 'cash', status: 'paid', createdBy: '', ...over,
});

async function seed() {
  await put<Supplier>('suppliers', { id: 's1', name: 'Metro' });
  await put<Supplier>('suppliers', { id: 's2', name: 'Boucherie Martin' });
  await put<Entry>('entries', entry('e1', { supplierId: 's1', date: '2026-11-12' }));
  await put<Entry>('entries', entry('e2', { supplierId: 's2', note: 'veal order' }));
  await put<Entry>('entries', entry('e3', { supplierId: 's2', date: '2026-11-01', note: 'other' }));
  await put<Payment>('payments', { id: 'p1', entryId: 'e1', date: '2026-11-12', amount: 10000, method: 'cash', createdBy: '' });
}

test('lists newest first and the search filters by supplier name or note', async () => {
  await seed();
  render(<History onGo={vi.fn()} />);
  await screen.findByText('Metro');
  expect(screen.getAllByTestId('history-row')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Search supplier or note'), { target: { value: 'metro' } });
  expect(screen.getAllByTestId('history-row')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Search supplier or note'), { target: { value: 'veal' } });
  const rows = screen.getAllByTestId('history-row');
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain('Boucherie Martin');
});

test('delete asks first and soft-deletes entry and its payments only after confirming', async () => {
  await seed();
  render(<History onGo={vi.fn()} />);
  await screen.findByText('Metro');
  const row = screen.getAllByTestId('history-row')[0];
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  expect(screen.getByText('Delete this entry?')).toBeTruthy();
  expect((await db.entries.get('e1'))!.deleted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Delete this entry?')).toBeNull();
  expect((await db.entries.get('e1'))!.deleted).toBe(false);
  fireEvent.click(within(screen.getAllByTestId('history-row')[0]).getByRole('button', { name: 'Delete' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
  await waitFor(async () => expect((await db.entries.get('e1'))!.deleted).toBe(true));
  expect((await db.payments.get('p1'))!.deleted).toBe(true);
  await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(2));
});

test('tapping a row opens the entry for editing', async () => {
  await seed();
  const go = vi.fn();
  render(<History onGo={go} />);
  await screen.findByText('Metro');
  fireEvent.click(within(screen.getAllByTestId('history-row')[0]).getByRole('button', { name: /Edit entry/ }));
  expect(getEditing()?.id).toBe('e1');
  expect(go).toHaveBeenCalledWith('add');
});

test('excl view marks only rows that fell back to the incl amount', async () => {
  await saveShared({ taxView: 'excl' });
  await put<Supplier>('suppliers', { id: 's1', name: 'Metro' });
  await put<Entry>('entries', entry('a', { supplierId: 's1', amountExcl: 9000 }));
  await put<Entry>('entries', entry('b', { supplierId: 's1', date: '2026-11-01' }));
  render(<History onGo={vi.fn()} />);
  await screen.findAllByText('Metro');
  expect(screen.getAllByTestId('incl-tag')).toHaveLength(1);
  expect(within(screen.getAllByTestId('history-row')[1]).getByTestId('incl-tag')).toBeTruthy();
});
