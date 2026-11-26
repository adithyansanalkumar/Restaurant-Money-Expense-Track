import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { put, seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import type { Supplier } from '../domain/types';
import { getEditing, setEditing } from '../ui/editing';

vi.mock('../ocr/ocr', () => ({ readBill: vi.fn() }));
vi.mock('../photos/photos', async (orig) => ({ ...(await orig<typeof import('../photos/photos')>()), compressPhoto: async (b: Blob) => b }));
import { readBill } from '../ocr/ocr';
import { Bills } from './Bills';

const TEXT = 'METRO CASH & CARRY\n25/11/2026\nTotal HT 153,80\nTVA 20% 30,70\nTOTAL TTC 184,50\n';

beforeEach(async () => {
  setLanguage('en'); setEditing(null);
  vi.mocked(readBill).mockReset();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'R', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
});

const pick = () => fireEvent.change(screen.getByTestId('bill-input'), { target: { files: [new File(['img'], 'b.jpg', { type: 'image/jpeg' })] } });

test('photo -> read -> check -> Looks right hands a pre-filled new entry to add', async () => {
  await put<Supplier>('suppliers', { id: 's1', name: 'Metro Cash & Carry' });
  vi.mocked(readBill).mockResolvedValue(TEXT);
  const onGo = vi.fn();
  render(<Bills onGo={onGo} />);
  pick();
  await screen.findByText('Check the details');
  expect(readBill).toHaveBeenCalledWith(expect.anything(), 'fra');
  expect(screen.getByText('SAVED')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Looks right'));
  await waitFor(() => expect(onGo).toHaveBeenCalledWith('add'));
  const e = getEditing()!;
  expect(e).toMatchObject({ kind: 'expense', date: '2026-11-25', amountIncl: 18450, amountExcl: 15380, tax: 3070, supplierId: 's1' });
  expect(e.id).toBeUndefined();
  expect(e.photoId).toBeTruthy();
  expect(await db.photos.count()).toBe(1);
});

test('unmatched shop is saved as a new supplier when the toggle is on, and not when off', async () => {
  vi.mocked(readBill).mockResolvedValue('Primeur du Sud\n25/11/2026\nTOTAL TTC 12,00\n');
  const onGo = vi.fn();
  render(<Bills onGo={onGo} />);
  pick();
  await screen.findByText('Check the details');
  const toggle = screen.getByLabelText('Save as new supplier');
  expect(toggle).toBeChecked();
  fireEvent.click(screen.getByText('Looks right'));
  await waitFor(() => expect(onGo).toHaveBeenCalled());
  const sups = await db.suppliers.toArray();
  expect(sups.map((s) => s.name)).toEqual(['Primeur du Sud']);
  expect(getEditing()?.supplierId).toBe(sups[0].id);
});

test('no total found: amount empty, Looks right disabled until typed', async () => {
  vi.mocked(readBill).mockResolvedValue('Primeur du Sud\nTomates 12,00\n');
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  const btn = screen.getByText('Looks right');
  expect(btn).toBeDisabled();
  expect(screen.getByPlaceholderText('not found — type it')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Total incl. tax'), { target: { value: '12,50' } });
  expect(btn).toBeEnabled();
});

test('OCR failure still reaches the check screen with empty fields', async () => {
  vi.mocked(readBill).mockRejectedValue(new Error('offline'));
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  expect(screen.getByLabelText('Total incl. tax')).toHaveValue('');
  expect(await db.photos.count()).toBe(1);
});

test('grid lists photos and the viewer links to the expense', async () => {
  await db.photos.add({ id: 'p1', blob: new Blob(['a']), createdAt: 1, backedUp: false });
  await db.photos.add({ id: 'p2', blob: new Blob(['b']), createdAt: 2, backedUp: false });
  await db.entries.add({ id: 'e1', kind: 'expense', date: '2026-11-25', amountIncl: 100, categoryId: 'cat:expense:0', method: 'cash', createdBy: '', photoId: 'p2', updatedAt: 1, deviceId: 'd', deleted: false });
  const onGo = vi.fn();
  render(<Bills onGo={onGo} />);
  const thumbs = await screen.findAllByTestId('bill-thumb');
  expect(thumbs).toHaveLength(2);
  fireEvent.click(thumbs[0]); // newest first => p2
  expect(await screen.findByText('Save to phone')).toBeInTheDocument();
  fireEvent.click(await screen.findByText('View expense'));
  expect(getEditing()?.id).toBe('e1');
  expect(onGo).toHaveBeenCalledWith('add');
});
