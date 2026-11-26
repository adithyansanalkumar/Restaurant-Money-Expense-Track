import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { reloadSettings } from '../settings/store';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));
const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  email: null as string | null,
}));
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  signIn: (o?: unknown) => auth.signIn(o),
  signOut: () => auth.signOut(),
  currentEmail: async () => auth.email,
}));
const resetPhone = vi.hoisted(() => vi.fn(async () => {}));
const atRisk = vi.hoisted(() => ({ value: false }));
vi.mock('../sync/sync', async (orig) => ({ ...(await orig<typeof import('../sync/sync')>()), resetPhone: () => resetPhone(), checkBeforeReset: async () => atRisk.value }));
const adopt = vi.hoisted(() => vi.fn());
vi.mock('../sync/onboard', () => ({
  adoptExistingLedger: () => adopt(),
  signInLater: async (o?: unknown) => { const { email } = await auth.signIn(o); return { email, result: await adopt() }; },
}));

import { App } from '../App';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  auth.email = null;
  auth.signIn.mockReset().mockImplementation(async () => { auth.email = 'dad@x.com'; return { email: 'dad@x.com' }; });
  adopt.mockReset();
  auth.signOut.mockReset().mockImplementation(async () => { auth.email = null; });
  resetPhone.mockClear();
  atRisk.value = false;
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
  expect(await screen.findByText('Couldn’t reach Google Drive — try again')).toBeTruthy();
  expect(screen.queryByText('Set up your restaurant')).toBeNull();
  // signed in with the lookup not done: no "Not now" into Setup
  expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  // Retry runs the lookup again without another popup
  adopt.mockResolvedValueOnce('none');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
  expect(auth.signIn).toHaveBeenCalledTimes(1);
  expect(adopt).toHaveBeenCalledTimes(2);
});

test('after a failed lookup, "Use without Google" signs out first, then Setup', async () => {
  adopt.mockResolvedValue('error');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use without Google' }));
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
  expect(auth.signOut).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Signed in as/)).toBeNull();
});

test('another account than this phone\'s: Reset this phone / Cancel', async () => {
  const { AccountSwitch } = await import('../sync/auth');
  auth.signIn.mockRejectedValueOnce(new AccountSwitch('new@x.com'));
  adopt.mockResolvedValue('none');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('This phone holds another account’s restaurant. Reset this phone to use new@x.com?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByText(/Reset this phone to use/)).toBeNull());
  expect(resetPhone).not.toHaveBeenCalled();
  auth.signIn.mockRejectedValueOnce(new AccountSwitch('new@x.com'));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reset this phone' }));
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
  expect(resetPhone).toHaveBeenCalledTimes(1);
  expect(auth.signIn).toHaveBeenCalledTimes(3); // signed in again after the reset
});

test('consent_required: shows "Please approve access again" and a Continue with Google button that signs in from the tap', async () => {
  const { ConsentRequired } = await import('../sync/auth');
  auth.signIn.mockRejectedValueOnce(new ConsentRequired());
  adopt.mockResolvedValue('none');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('Please approve access again')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(auth.signIn).toHaveBeenCalledTimes(1); // not reopened automatically
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
  expect(auth.signIn).toHaveBeenCalledTimes(2);
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

test('lookup says authNeeded (session expired): the next tap signs in again instead of looping', async () => {
  adopt.mockResolvedValueOnce('authNeeded').mockResolvedValueOnce('none');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('Couldn’t reach Google Drive — try again')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('Set up your restaurant')).toBeTruthy();
  expect(auth.signIn).toHaveBeenCalledTimes(2);
});

test('reset prompt warns "Entries not yet synced will be lost" when the pre-reset sync could not secure them', async () => {
  const { AccountSwitch } = await import('../sync/auth');
  atRisk.value = true;
  auth.signIn.mockRejectedValueOnce(new AccountSwitch('new@x.com'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  expect(await screen.findByText('Entries not yet synced will be lost')).toBeTruthy();
});

test('no warning when everything is synced', async () => {
  const { AccountSwitch } = await import('../sync/auth');
  auth.signIn.mockRejectedValueOnce(new AccountSwitch('new@x.com'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  await screen.findByRole('button', { name: 'Reset this phone' });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText('Entries not yet synced will be lost')).toBeNull();
});
