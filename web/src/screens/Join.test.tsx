import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { reloadSettings } from '../settings/store';

const auth = vi.hoisted(() => ({ email: null as string | null, signIn: vi.fn() }));
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  currentEmail: async () => auth.email,
  signIn: (o?: unknown) => auth.signIn(o),
}));
const openShared = vi.hoisted(() => vi.fn());
vi.mock('../sync/share', async (orig) => ({ ...(await orig<typeof import('../sync/share')>()), openShared: () => openShared() }));

import { Join } from './Join';
import { PickerCancelled } from '../sync/share';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  auth.email = null;
  auth.signIn.mockReset().mockImplementation(async () => { auth.email = 'son@x.com'; return { email: 'son@x.com' }; });
  openShared.mockReset().mockImplementation(async () => {
    await db.settings.put({ id: 'shared', updatedAt: 5, deviceId: 'dad', deleted: false, restaurantName: 'Chez Dad', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device', ownerEmail: 'dad@x.com' });
    await reloadSettings();
  });
});

test('sign in, choose the shared ledger, then home; only device settings are written', async () => {
  const go = vi.fn();
  render(<Join onGo={go} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Choose the shared ledger' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  expect(await db.settings.get('shared')).toMatchObject({ updatedAt: 5, deviceId: 'dad' });
  expect((await db.meta.get('device'))?.value).toMatchObject({ appLanguage: 'en' });
});

test('already signed in: shows the email and goes straight to choosing', async () => {
  auth.email = 'son@x.com';
  render(<Join onGo={vi.fn()} />);
  expect(await screen.findByText('Signed in as son@x.com')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Choose the shared ledger' })).toBeTruthy();
});

test('cancelling the picker stays on Join quietly; other failures show an error', async () => {
  auth.email = 'son@x.com';
  const go = vi.fn();
  render(<Join onGo={go} />);
  openShared.mockRejectedValueOnce(new PickerCancelled());
  fireEvent.click(await screen.findByRole('button', { name: 'Choose the shared ledger' }));
  await waitFor(() => expect(openShared).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).toBeNull();
  openShared.mockRejectedValueOnce(new Error('boom'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose the shared ledger' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(go).not.toHaveBeenCalled();
});

test('Back returns to setup', async () => {
  const go = vi.fn();
  render(<Join onGo={go} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
  expect(go).toHaveBeenCalledWith('setup');
});
