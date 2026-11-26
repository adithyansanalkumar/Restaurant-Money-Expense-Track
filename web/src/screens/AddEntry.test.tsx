import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { put, seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import type { Supplier } from '../domain/types';
import { AddEntry } from './AddEntry';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'R', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  await put<Supplier>('suppliers', { name: 'Metro', defaultCategoryId: 'cat:expense:3' });
  window.location.hash = '';
});

const tap = (...keys: string[]) => keys.forEach((k) => fireEvent.click(screen.getByRole('button', { name: k })));

test('expense: typed 184,5 with Metro saves 18450, default category, paid, one payment', async () => {
  const go = vi.fn();
  render(<AddEntry onGo={go} />);
  fireEvent.click(await screen.findByText('Metro'));
  tap('1', '8', '4', ',', '5');
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  const entries = await db.entries.toArray();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ kind: 'expense', amountIncl: 18450, categoryId: 'cat:expense:3', status: 'paid', method: 'cash', createdBy: '' });
  expect(entries[0].supplierId).toBe((await db.suppliers.toArray())[0].id);
  expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const pays = await db.payments.toArray();
  expect(pays).toHaveLength(1);
  expect(pays[0]).toMatchObject({ entryId: entries[0].id, amount: 18450 });
});

test('on credit shows a due date and creates no payment', async () => {
  const go = vi.fn();
  render(<AddEntry onGo={go} />);
  fireEvent.click(await screen.findByText('Metro'));
  expect(screen.queryByLabelText('Due date')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'On credit' }));
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2030-01-31' } });
  tap('5', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  expect((await db.entries.toArray())[0]).toMatchObject({ status: 'credit', dueDate: '2030-01-31', amountIncl: 5000 });
  expect(await db.payments.count()).toBe(0);
});

test('collection hides supplier and category; saves an income entry', async () => {
  const go = vi.fn();
  render(<AddEntry onGo={go} />);
  await screen.findByText('Metro');
  fireEvent.click(screen.getByRole('button', { name: 'Collection' }));
  expect(screen.queryByText('Metro')).toBeNull();
  expect(screen.queryByText('Category')).toBeNull();
  expect(screen.getByText('Channel')).toBeTruthy();
  expect(screen.getByText('Method')).toBeTruthy();
  fireEvent.click(screen.getByText('Takeaway'));
  tap('9', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Save collection' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  expect((await db.entries.toArray())[0]).toMatchObject({ kind: 'income', amountIncl: 9000, categoryId: 'cat:income:1', channel: 'Takeaway' });
  expect(await db.payments.count()).toBe(0);
});

test('Save is disabled while the amount is 0', async () => {
  render(<AddEntry onGo={vi.fn()} />);
  const save = await screen.findByRole('button', { name: 'Save expense' });
  expect(save).toBeDisabled();
  tap('0');
  expect(save).toBeDisabled();
  tap('3');
  expect(save).not.toBeDisabled();
});

test('new supplier with a category gets that category as default', async () => {
  const go = vi.fn();
  render(<AddEntry onGo={go} />);
  await screen.findByText('Metro');
  fireEvent.click(screen.getByRole('button', { name: '+ New' }));
  fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Halles' } });
  fireEvent.click(screen.getByText('Dairy'));
  tap('7');
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  const s = (await db.suppliers.toArray()).find((x) => x.name === 'Halles')!;
  expect(s.defaultCategoryId).toBe('cat:expense:2');
  expect((await db.entries.toArray())[0]).toMatchObject({ supplierId: s.id, categoryId: 'cat:expense:2' });
});

test('close routes home; scan routes bills; initial pre-fills amount', async () => {
  const go = vi.fn();
  render(<AddEntry onGo={go} initial={{ amountIncl: 12345 }} />);
  expect(await screen.findByText(/123,45/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(go).toHaveBeenCalledWith('home');
  fireEvent.click(screen.getByRole('button', { name: 'Scan a bill' }));
  expect(go).toHaveBeenCalledWith('bills');
  expect(await db.entries.count()).toBe(0);
});

test('note is saved (expense and collection)', async () => {
  const go = vi.fn();
  render(<AddEntry onGo={go} />);
  await screen.findByText('Metro');
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: ' fish delivery ' } });
  tap('4');
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  expect((await db.entries.toArray())[0].note).toBe('fish delivery');
});

test('a failed payment write rolls back entry and new supplier; retry does not duplicate', async () => {
  const go = vi.fn();
  render(<AddEntry onGo={go} />);
  await screen.findByText('Metro');
  fireEvent.click(screen.getByRole('button', { name: '+ New' }));
  fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Halles' } });
  tap('7');
  const spy = vi.spyOn(db.payments, 'put').mockRejectedValueOnce(new Error('boom'));
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await screen.findByRole('alert');
  expect(go).not.toHaveBeenCalled();
  expect(await db.entries.count()).toBe(0);
  expect(await db.suppliers.count()).toBe(1);
  spy.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  expect(await db.entries.count()).toBe(1);
  expect(await db.suppliers.count()).toBe(2);
  expect(await db.payments.count()).toBe(1);
});

test('initial.supplierId pre-selects its default category', async () => {
  const go = vi.fn();
  const metro = (await db.suppliers.toArray())[0];
  render(<AddEntry onGo={go} initial={{ supplierId: metro.id, amountIncl: 1000 }} />);
  await waitFor(() => expect(screen.getByText('Dry goods & groceries')).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  expect((await db.entries.toArray())[0]).toMatchObject({ supplierId: metro.id, categoryId: 'cat:expense:3' });
});
