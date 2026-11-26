import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { put, seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import { formatMoney } from '../domain/money';
import { novemberEntries, novemberPayments } from '../domain/__fixtures__/november';
import { creditEntries, creditPayments, creditSuppliers } from '../domain/__fixtures__/credit';
import type { Entry, Payment, Supplier } from '../domain/types';
import { Home } from './Home';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));

const fmt = (c: number, sign = false) => formatMoney(c, 'EUR', 'fr-FR', { sign }).replace(/\s+/g, ' ');
const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ');

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'Chez Test', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  window.location.hash = '';
});

const seed = async (entries: Entry[], payments: Payment[] = [], suppliers: { id: string; name: string }[] = []) => {
  for (const s of suppliers) await put<Supplier>('suppliers', s);
  for (const e of entries) await put<Entry>('entries', e);
  for (const p of payments) await put<Payment>('payments', p);
};

test('month view: profit, in/out, badge vs last period, today figures, no owed card', async () => {
  await seed(novemberEntries, novemberPayments);
  render(<Home onGo={vi.fn()} />);
  expect(await screen.findByText(fmt(234000, true))).toBeTruthy();
  expect(screen.getByText(fmt(980000))).toBeTruthy();
  expect(screen.getByText(fmt(746000))).toBeTruthy();
  expect(screen.getByText('▲ 12% vs last period')).toBeTruthy();
  expect(norm(screen.getByTestId('today-in').textContent)).toContain(fmt(0));
  expect(screen.queryByText(/Owed to suppliers/)).toBeNull();
});

test('today in / out come from entries dated today', async () => {
  await seed([
    ...novemberEntries,
    { ...novemberEntries[1], id: 'today-in', date: '2026-11-25', amountIncl: 42000, amountExcl: 38000 },
    { ...novemberEntries[2], id: 'today-out', date: '2026-11-25', amountIncl: 18600, amountExcl: 17000 },
  ], novemberPayments);
  render(<Home onGo={vi.fn()} />);
  await waitFor(() => expect(norm(screen.getByTestId('today-in').textContent)).toContain(fmt(42000, true)));
  expect(norm(screen.getByTestId('today-out').textContent)).toContain(fmt(18600).replace(/^/, '−'));
});

test('period control switches to Day and the badge hides when there is no previous data', async () => {
  await seed(novemberEntries, novemberPayments);
  render(<Home onGo={vi.fn()} />);
  await screen.findByText(fmt(234000, true));
  fireEvent.click(screen.getByRole('button', { name: 'Day' }));
  await waitFor(() => expect(screen.getAllByText(fmt(0)).length).toBeGreaterThan(0));
  expect(screen.queryByText(/vs last period/)).toBeNull();
});

test('owed card: total owed and bills due this week; taps route owe', async () => {
  await seed(creditEntries, creditPayments, creditSuppliers);
  const go = vi.fn();
  render(<Home onGo={go} />);
  const card = await screen.findByRole('button', { name: /Owed to suppliers/ });
  expect(norm(card.textContent)).toContain(`Owed to suppliers · ${fmt(128000)}`);
  expect(within(card).getByText('3 bills due this week')).toBeTruthy();
  fireEvent.click(card);
  expect(go).toHaveBeenCalledWith('owe');
});

test('See all routes to history; recent shows at most 5; sync button renders', async () => {
  await seed(novemberEntries, novemberPayments);
  for (let i = 0; i < 6; i++) await put<Entry>('entries', { ...novemberEntries[1], id: `x${i}`, date: '2026-11-0' + (i + 1), amountIncl: 1000 + i, amountExcl: 900 });
  const go = vi.fn();
  render(<Home onGo={go} />);
  await screen.findByText('Recent activity');
  expect(screen.getAllByTestId('recent-row')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'See all' }));
  expect(go).toHaveBeenCalledWith('history');
});
