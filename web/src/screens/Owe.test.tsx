import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { formatMoney } from '../domain/money';
import { saveShared } from '../settings/store';
import { creditEntries, creditSuppliers } from '../domain/__fixtures__/credit';
import { Owe } from './Owe';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));

const eur = (c: number) => formatMoney(c, 'EUR', 'fr-FR');

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.suppliers.bulkPut(creditSuppliers.map((s) => ({ ...s, updatedAt: 1, deviceId: 'd1', deleted: false })));
  await db.entries.bulkPut(creditEntries);
  await saveShared({ restaurantName: 'R', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  window.location.hash = '';
});

const tap = (...keys: string[]) => keys.forEach((k) => fireEvent.click(screen.getByRole('button', { name: k })));

test('shows total owed and the three buckets', async () => {
  render(<Owe onGo={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId('owe-total').textContent).toBe(eur(-128000)));
  expect(screen.getByTestId('bucket-overdue').textContent).toContain(eur(32000));
  expect(screen.getByTestId('bucket-thisWeek').textContent).toContain(eur(61000));
  expect(screen.getByTestId('bucket-later').textContent).toContain(eur(35000));
  expect(screen.getAllByText('Overdue').length).toBeGreaterThanOrEqual(2); // tile label + chip
});

test('back goes home', async () => {
  const go = vi.fn();
  render(<Owe onGo={go} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
  expect(go).toHaveBeenCalledWith('home');
});

test('recording 400 for Boucherie Martin writes 2 payments; balance becomes 380', async () => {
  render(<Owe onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }));
  tap('4', '0', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
  await waitFor(() => expect(screen.getByTestId('owe-total').textContent).toBe(eur(-88000)));
  const pays = await db.payments.toArray();
  expect(pays).toHaveLength(2);
  expect(pays.map((p) => p.amount).sort((a, b) => a - b)).toEqual([8000, 32000]);
  expect(pays.every((p) => p.method === 'cash' && p.date === '2026-11-25')).toBe(true);
  const card = screen.getByText('Boucherie Martin').closest('[data-testid^="supplier-"]') as HTMLElement;
  expect(card.textContent).toContain(eur(38000));
});

test('900 is more than owed: message shown, nothing written', async () => {
  render(<Owe onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }));
  tap('9', '0', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
  expect((await screen.findByRole('alert')).textContent).toBe(`That's more than you owe (${eur(78000)})`);
  expect(await db.payments.count()).toBe(0);
});

test('confirm is disabled at 0', async () => {
  render(<Owe onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }));
  expect((screen.getByRole('button', { name: 'Confirm payment' }) as HTMLButtonElement).disabled).toBe(true);
});

test('a recorded payment is stamped with the signed-in email', async () => {
  await db.meta.put({ key: 'auth', value: { session: 'S', email: 'dad@x.com' } });
  render(<Owe onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }));
  tap('4', '0', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
  await waitFor(async () => expect(await db.payments.count()).toBe(2));
  expect((await db.payments.toArray()).every((p) => p.createdBy === 'dad@x.com')).toBe(true);
});
