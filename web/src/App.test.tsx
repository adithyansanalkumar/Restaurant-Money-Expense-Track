import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { db } from './db/db';
import { setLanguage } from './i18n';
import { put, seedDefaults } from './db/repo';
import { saveShared } from './settings/store';
import type { Entry } from './domain/types';
import { getEditing, setEditing } from './ui/editing';
import { App } from './App';

vi.mock('./domain/clock', () => ({ todayISO: () => '2026-11-25' }));

beforeEach(async () => {
  setLanguage('en');
  setEditing(null);
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'Chez Test', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  window.location.hash = '';
});

test('App renders the Home screen without throwing', async () => {
  render(<App />);
  expect(await screen.findByText('Recent activity')).toBeTruthy();
  expect(screen.getByText('Chez Test')).toBeTruthy();
});

test('leaving the add route (browser back) clears the editing hand-off', async () => {
  const e = await put<Entry>('entries', { kind: 'expense', date: '2026-11-10', amountIncl: 5000, categoryId: 'cat:expense:3', method: 'cash', status: 'paid', createdBy: '' });
  setEditing(e);
  window.location.hash = '#/add';
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Save expense' })).toBeTruthy();
  expect(getEditing()?.id).toBe(e.id);
  act(() => { window.location.hash = '#/home'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await waitFor(() => expect(getEditing()).toBeNull());
  expect(await screen.findByText('Recent activity')).toBeTruthy();
});
