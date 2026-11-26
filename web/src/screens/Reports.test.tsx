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
const driveMock = vi.hoisted(() => ({ save: vi.fn(async (_b: Blob, _n: string) => {}), email: null as string | null }));
vi.mock('../export/drive', () => ({ saveExportToDrive: (b: Blob, n: string) => driveMock.save(b, n) }));
vi.mock('../sync/auth', async (orig) => ({ ...(await orig<typeof import('../sync/auth')>()), currentEmail: async () => driveMock.email }));

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
  driveMock.save.mockClear().mockResolvedValue(undefined);
  driveMock.email = null;
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

test('export: signed out saves nothing to Drive', async () => {
  render(<Reports />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export to Excel' }));
  await waitFor(() => expect(shareMock).toHaveBeenCalled());
  await screen.findByText('Downloaded');
  expect(driveMock.save).not.toHaveBeenCalled();
});

test('export: signed in also saves to Google Drive and says so', async () => {
  driveMock.email = 'adi@x.com';
  render(<Reports />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export to Excel' }));
  expect(await screen.findByText(/Saved to Google Drive/)).toBeTruthy();
  expect(driveMock.save).toHaveBeenCalledTimes(1);
  expect((driveMock.save.mock.calls[0] as unknown as [Blob, string])[1]).toMatch(/\.xlsx$/);
});

test('export: a Drive failure is silent (the export itself still worked)', async () => {
  driveMock.email = 'adi@x.com';
  driveMock.save.mockRejectedValue(new Error('offline'));
  render(<Reports />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export to Excel' }));
  await screen.findByText('Downloaded');
  expect(screen.queryByText(/Saved to Google Drive/)).toBeNull();
  expect(screen.queryByText('Export failed')).toBeNull();
});

test('By supplier: top 5 suppliers + Other, with amount and share of money out (I3)', async () => {
  await db.entries.clear();
  const names = ['Metro', 'Promocash', 'Boucherie', 'Primeur', 'Cave', 'Boulangerie', 'Poissonnier'];
  const cents = [40000, 20000, 15000, 10000, 5000, 4000, 1000]; // + 5000 with no supplier = 100000
  for (let i = 0; i < names.length; i++) {
    await put('suppliers', { id: `s${i}`, name: names[i] } as any);
    await put<Entry>('entries', { id: `x${i}`, kind: 'expense', date: '2026-11-10', amountIncl: cents[i], categoryId: 'cat-food', supplierId: `s${i}`, method: 'cash', createdBy: '' } as any);
  }
  await put<Entry>('entries', { id: 'nosup', kind: 'expense', date: '2026-11-10', amountIncl: 5000, categoryId: 'cat-food', method: 'cash', createdBy: '' } as any);
  render(<Reports />);
  const section = await screen.findByRole('region', { name: 'By supplier' });
  await waitFor(() => expect(section.querySelectorAll('[data-testid="supplier-row"]')).toHaveLength(6));
  const rows = [...section.querySelectorAll('[data-testid="supplier-row"]')].map((r) => norm(r.textContent));
  expect(rows[0]).toBe(`Metro${fmt(40000)}40%`);
  expect(rows[4]).toBe(`Cave${fmt(5000)}5%`);
  expect(rows[5]).toBe(`Other${fmt(10000)}10%`); // 4000 + 1000 + 5000 without a supplier
});

test('a category named "Other" next to the remainder slice gives no duplicate React key (M8)', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const cats = ['Other', 'B', 'C', 'D', 'E'];
    for (let i = 0; i < cats.length; i++) {
      await put('categories', { id: `k${i}`, kind: 'expense', name: cats[i], order: 10 + i } as any);
      await put<Entry>('entries', { id: `k${i}`, kind: 'expense', date: '2026-11-11', amountIncl: 900000 - i * 1000, categoryId: `k${i}`, method: 'cash', createdBy: '' } as any);
    }
    render(<Reports />);
    await waitFor(() => expect(screen.getAllByTestId('legend-row').map((r) => r.textContent).filter((x) => x?.startsWith('Other'))).toHaveLength(2));
    expect(err.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
  } finally { err.mockRestore(); }
});
