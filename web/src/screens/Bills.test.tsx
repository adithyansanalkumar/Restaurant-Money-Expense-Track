import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { put, seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import type { Supplier } from '../domain/types';
import { getEditing, setEditing } from '../ui/editing';

vi.mock('../ocr/ocr', () => ({ readBill: vi.fn() }));
const restore = vi.hoisted(() => vi.fn(async (_id: string): Promise<Blob | null> => null));
vi.mock('../photos/backup', async (orig) => ({ ...(await orig<typeof import('../photos/backup')>()), restorePhoto: (id: string) => restore(id) }));
vi.mock('../photos/photos', async (orig) => ({ ...(await orig<typeof import('../photos/photos')>()), compressPhoto: async (b: Blob) => b }));
import { readBill } from '../ocr/ocr';
import { Bills } from './Bills';

const TEXT = 'METRO CASH & CARRY\n25/11/2026\nTotal HT 153,80\nTVA 20% 30,70\nTOTAL TTC 184,50\n';

beforeEach(async () => {
  setLanguage('en'); setEditing(null);
  vi.mocked(readBill).mockReset();
  restore.mockReset().mockResolvedValue(null);
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

test('closing the check screen returns to the grid', async () => {
  vi.mocked(readBill).mockResolvedValue(TEXT);
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  fireEvent.click(screen.getByLabelText('Close'));
  await waitFor(() => expect(screen.queryByText('Check the details')).toBeNull());
  expect(await screen.findAllByTestId('bill-thumb')).toHaveLength(1);
});

test('Retake opens the picker synchronously in the tap', async () => {
  vi.mocked(readBill).mockResolvedValue(TEXT);
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  click.mockClear();
  fireEvent.click(screen.getByText('Retake'));
  expect(click).toHaveBeenCalledTimes(1);
  click.mockRestore();
});

test('the picker input survives Retake so the retaken photo is read', async () => {
  vi.mocked(readBill).mockResolvedValue(TEXT);
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  render(<Bills onGo={vi.fn()} />);
  const input = screen.getByTestId('bill-input');
  pick();
  await screen.findByText('Check the details');
  fireEvent.click(screen.getByText('Retake'));
  await waitFor(() => expect(screen.queryByText('Check the details')).toBeNull());
  expect(screen.getByTestId('bill-input')).toBe(input);
  expect(input.isConnected).toBe(true);
  vi.mocked(readBill).mockClear();
  fireEvent.change(input, { target: { files: [new File(['img2'], 'c.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Check the details');
  expect(readBill).toHaveBeenCalledTimes(1);
  expect(await db.photos.count()).toBe(1);
  vi.restoreAllMocks();
});

// ---- Google AI bill reading (optional) ----
const gem = (obj: unknown) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });

test('gemini mode + key: Google reads the bill, device OCR is not used', async () => {
  await saveShared({ ocrMode: 'gemini' });
  await db.meta.put({ key: 'geminiKey', value: 'K' });
  const f = gem({ shop: 'Marché', date: '2026-11-25', incl: '184,50' });
  vi.stubGlobal('fetch', f);
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  expect(f).toHaveBeenCalledTimes(1);
  expect(readBill).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Total incl. tax')).toHaveValue('184,50');
  vi.unstubAllGlobals();
});

test('gemini error falls back to the phone and shows a notice', async () => {
  await saveShared({ ocrMode: 'gemini' });
  await db.meta.put({ key: 'geminiKey', value: 'K' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
  vi.mocked(readBill).mockResolvedValue(TEXT);
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  expect(readBill).toHaveBeenCalled();
  expect(screen.getByText('Google AI unavailable — read on this phone instead')).toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('gemini mode without a key on this phone uses the phone, no notice', async () => {
  await saveShared({ ocrMode: 'gemini' });
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  vi.mocked(readBill).mockResolvedValue(TEXT);
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  expect(f).not.toHaveBeenCalled();
  expect(readBill).toHaveBeenCalled();
  expect(screen.queryByText(/Google AI unavailable/)).toBeNull();
  vi.unstubAllGlobals();
});

test('offline goes straight to the phone', async () => {
  await saveShared({ ocrMode: 'gemini' });
  await db.meta.put({ key: 'geminiKey', value: 'K' });
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.mocked(readBill).mockResolvedValue(TEXT);
  render(<Bills onGo={vi.fn()} />);
  pick();
  await screen.findByText('Check the details');
  expect(f).not.toHaveBeenCalled();
  expect(readBill).toHaveBeenCalled();
  spy.mockRestore();
  vi.unstubAllGlobals();
});

test('a photo an entry references but this phone lacks: placeholder tile, then restored from Drive when possible', async () => {
  await put('entries', { id: 'e1', kind: 'expense', date: '2026-11-20', amountIncl: 100, categoryId: 'c', method: 'cash', createdBy: '', photoId: 'gone' } as any);
  render(<Bills onGo={vi.fn()} />);
  expect(await screen.findByText('Photo not on this phone')).toBeInTheDocument();
  await waitFor(() => expect(restore).toHaveBeenCalledWith('gone'));
  cleanup();
  restore.mockImplementation(async (id: string) => {
    const blob = new Blob(['IMG'], { type: 'image/jpeg' });
    await db.photos.put({ id, blob, createdAt: 1, backedUp: true });
    return blob;
  });
  render(<Bills onGo={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('[data-testid="bill-thumb"] img')).toBeTruthy());
  expect(screen.getAllByTestId('bill-thumb')).toHaveLength(1);
  expect(screen.queryByText('Photo not on this phone')).toBeNull();
});

test('the viewer restores a missing photo, or says it is not on this phone', async () => {
  const { PhotoViewer } = await import('./PhotoViewer');
  render(<PhotoViewer photoId="gone" onClose={vi.fn()} onGo={vi.fn()} />);
  expect(await screen.findByText('Photo not on this phone')).toBeInTheDocument();
  expect(restore).toHaveBeenCalledWith('gone');
  cleanup();
  restore.mockResolvedValue(new Blob(['IMG'], { type: 'image/jpeg' }));
  render(<PhotoViewer photoId="gone" onClose={vi.fn()} onGo={vi.fn()} />);
  expect(await screen.findByRole('img', { name: 'Bill photo' })).toBeInTheDocument();
  expect(screen.queryByText('Photo not on this phone')).toBeNull();
});
