import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';

const getAccessToken = vi.fn();
const signIn = vi.fn();
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  getAccessToken: () => getAccessToken(),
  signIn: () => signIn(),
}));
vi.mock('../sync/drive', () => ({
  ensureFolder: vi.fn(async () => 'folder1'),
  findFile: vi.fn(async () => null),
  findFolder: vi.fn(async () => 'folder1'),
  listFiles: vi.fn(async () => [{ id: 'ledger1', version: '1' }]),
  readJson: vi.fn(),
  getVersion: vi.fn(),
  writeJson: vi.fn(async () => ({ id: 'ledger1', version: '1' })),
}));

const adopt = vi.hoisted(() => vi.fn());
vi.mock('../sync/onboard', async (orig) => ({ ...(await orig<typeof import('../sync/onboard')>()), adoptExistingLedger: () => adopt() }));
import { AuthNeeded } from '../sync/auth';
import { syncNow } from '../sync/sync';
import { SyncStatus } from './SyncStatus';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  getAccessToken.mockReset();
  signIn.mockReset();
});

test('authNeeded shows a "Sign in to sync" button that signs in, adopts or claims the ledger, then syncs', async () => {
  await db.settings.put({ id: 'shared', updatedAt: 1, deviceId: 'd', deleted: false, restaurantName: 'R', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  getAccessToken.mockRejectedValue(new AuthNeeded());
  render(<SyncStatus />);
  await act(async () => { await syncNow(); });
  const btn = await screen.findByRole('button', { name: 'Sign in to sync' });
  getAccessToken.mockReset().mockResolvedValue('TOK');
  signIn.mockResolvedValue({ email: 'a@b.com' });
  fireEvent.click(btn);
  await waitFor(() => expect(screen.getByText(/^Synced /)).toBeTruthy());
  expect(signIn).toHaveBeenCalledTimes(1);
  const { findFolder } = await import('../sync/drive');
  expect(findFolder).toHaveBeenCalledWith('Restaurant Accounts'); // no ledger chosen: adoption lookup first
  expect(screen.queryByRole('button', { name: 'Sign in to sync' })).toBeNull();
});

test('offline and error states', async () => {
  const { Offline } = await import('../sync/auth');
  getAccessToken.mockRejectedValueOnce(new Offline());
  render(<SyncStatus />);
  await act(async () => { await syncNow(); });
  expect(screen.getByText('Offline — will retry')).toBeTruthy();
  getAccessToken.mockRejectedValueOnce(new Error('boom'));
  await act(async () => { await syncNow(); });
  expect(screen.getByText('Sync error')).toBeTruthy();
});

test('pending: "Not syncing yet — finish connecting" with Retry that runs the lookup and shows its error', async () => {
  await db.meta.put({ key: 'adoptPending', value: true });
  render(<SyncStatus />);
  await act(async () => { await syncNow(); });
  expect(screen.getByText('Not syncing yet — finish connecting')).toBeTruthy();
  adopt.mockResolvedValueOnce('offline');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Couldn’t reach Google Drive — try again')).toBeTruthy();
  expect(adopt).toHaveBeenCalledTimes(1);
  adopt.mockImplementationOnce(async () => { await db.meta.delete('adoptPending'); return 'adopted'; });
  getAccessToken.mockResolvedValue('TOK');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByText('Not syncing yet — finish connecting')).toBeNull());
});
