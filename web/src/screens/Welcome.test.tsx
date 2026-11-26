import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { reloadSettings } from '../settings/store';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));
const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  email: null as string | null,
}));
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  signIn: (o?: unknown) => auth.signIn(o),
  currentEmail: async () => auth.email,
}));
const adopt = vi.hoisted(() => vi.fn());
vi.mock('../sync/onboard', () => ({ adoptExistingLedger: () => adopt() }));

import { App } from '../App';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  auth.email = null;
  auth.signIn.mockReset().mockImplementation(async () => { auth.email = 'dad@x.com'; return { email: 'dad@x.com' }; });
  adopt.mockReset();
  window.location.hash = '';
});

test('first run shows Welcome with Sign in and Not now; Not now goes to Setup (no sign-in line)', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
  expect(screen.queryByText(/Signed in as/)).toBeNull();
  expect(auth.signIn).not.toHaveBeenCalled();
});

test('same account on a new phone: an existing ledger is synced first and Setup is never shown', async () => {
  adopt.mockImplementation(async () => {
    // what syncNow does: bring the owner's shared settings down
    await db.settings.put({ id: 'shared', updatedAt: 5, deviceId: 'old', deleted: false, restaurantName: 'Chez Dad', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device', ownerEmail: 'dad@x.com' });
    await reloadSettings();
    return 'adopted';
  });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('Chez Dad')).toBeTruthy();
  expect(screen.queryByText('Set up your restaurant')).toBeNull();
  expect(await db.settings.get('shared')).toMatchObject({ updatedAt: 5, deviceId: 'old' });
});

test('no ledger for this account: Setup shows "Signed in as" and stores ownerEmail', async () => {
  adopt.mockResolvedValue('none');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
  expect(await screen.findByText('Signed in as dad@x.com')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Chez Adi' } });
  fireEvent.click(screen.getByText('Continue'));
  await waitFor(async () => expect((await db.settings.get('shared'))?.ownerEmail).toBe('dad@x.com'));
});

test('a ledger exists but the sync failed: stays on Welcome with an error, never Setup', async () => {
  adopt.mockResolvedValue('offline');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Set up your restaurant')).toBeNull();
});

test('consent retry shows "Please approve access again"', async () => {
  let release!: () => void;
  auth.signIn.mockImplementation(async (o: { onConsentRetry?: () => void }) => {
    o?.onConsentRetry?.();
    await new Promise<void>((r) => { release = r; });
    return { email: 'dad@x.com' };
  });
  adopt.mockResolvedValue('none');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('Please approve access again')).toBeTruthy();
  release();
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
});

test('a failed sign-in shows an error and stays on Welcome', async () => {
  auth.signIn.mockRejectedValue(new Error('Sign-in cancelled'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(adopt).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
});

test('the join route is still reachable on first run', async () => {
  window.location.hash = '#/join';
  render(<App />);
  expect(await screen.findByText('Join a shared restaurant')).toBeTruthy();
});
