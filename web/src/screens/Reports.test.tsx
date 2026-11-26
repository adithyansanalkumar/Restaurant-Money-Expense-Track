import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { put, seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import { formatMoney } from '../domain/money';
import { novemberEntries, novemberPayments } from '../domain/__fixtures__/november';
import type { Entry, Payment } from '../domain/types';
import { Reports } from './Reports';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));
const shareMock = vi.hoisted(() => vi.fn().mockResolvedValue('downloaded'));
vi.mock('../export/share', () => ({ shareOrDownload: shareMock }));

const fmt = (c: number, sign = false) => formatMoney(c, 'EUR', 'fr-FR', { sign }).replace(/\s+/g, ' ');
const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ');

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'X', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  for (const e of novemberEntries) await put<Entry>('entries', e);
  for (const p of novemberPayments) await put<Payment>('payments', { ...p, date: '2026-11-20' });
  shareMock.mockClear();
});

test('default 6M range totals, donut legend and cash paid out', async () => {
  render(<Reports />);
  // Oct 31 income 209000 + Nov income 980000 - Nov out 450000 (entries after today 2026-11-25 excluded)
  await waitFor(() => expect(norm(screen.getByTestId('range-profit').textContent)).toBe(fmt(739000, true)));
  expect(norm(screen.getByTestId('cash-out').textContent)).toBe(fmt(296000));
  expect(screen.getAllByTestId('legend-row').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '6M' }).getAttribute('aria-pressed')).toBe('true');
});

test('custom range shows two date inputs and recomputes', async () => {
  render(<Reports />);
  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
  await waitFor(() => expect(norm(screen.getByTestId('range-profit').textContent)).toBe(fmt(530000, true)));
});

test('export button builds file and shares it', async () => {
  render(<Reports />);
  fireEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
  await waitFor(() => expect(shareMock).toHaveBeenCalled());
  expect(shareMock.mock.calls[0][1]).toBe('restaurant-2026-06-01_2026-11-25.xlsx');
  expect(await screen.findByText('Downloaded')).toBeTruthy();
});
