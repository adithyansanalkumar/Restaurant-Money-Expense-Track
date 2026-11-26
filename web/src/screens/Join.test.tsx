import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { reloadSettings } from '../settings/store';

const auth = vi.hoisted(() => ({ email: null as string | null, signIn: vi.fn(), signOut: vi.fn(async () => {}) }));
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  currentEmail: async () => auth.email,
  signIn: (o?: unknown) => auth.signIn(o),
  signOut: () => auth.signOut(),
}));
const openShared = vi.hoisted(() => vi.fn());
vi.mock('../sync/share', async (orig) => ({ ...(await orig<typeof import('../sync/share')>()), openShared: (...a: unknown[]) => openShared(...a) }));

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

test('Back returns to setup (no sign-out when nothing is pending)', async () => {
  auth.signOut.mockClear();
  const go = vi.fn();
  render(<Join onGo={go} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('setup'));
  expect(auth.signOut).not.toHaveBeenCalled();
});

test('abandoning Join after signing in here (adoptPending) signs out before routing to setup', async () => {
  auth.signOut.mockClear();
  auth.email = 'son@x.com';
  await db.meta.put({ key: 'adoptPending', value: true });
  const go = vi.fn();
  render(<Join onGo={go} />);
  openShared.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NoRestaurant' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Choose the shared ledger' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('setup'));
  expect(auth.signOut).toHaveBeenCalledTimes(1);
  expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(go.mock.invocationCallOrder[0]);
});

test('a phone holding another account\'s restaurant (no ledger chosen) says so: open it again', async () => {
  auth.email = 'son@x.com';
  await db.settings.put({ id: 'shared', updatedAt: 5, deviceId: 'dad', deleted: false, restaurantName: 'Chez Dad', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device', ownerEmail: 'dad@x.com' });
  await db.meta.put({ key: 'adoptPending', value: true });
  render(<Join onGo={vi.fn()} />);
  expect(await screen.findByText('This phone belongs to dad@x.com’s restaurant — open it again')).toBeTruthy();
});

describe('a phone that already has entries (I2)', () => {
  const entries = async (n: number) => {
    for (let i = 0; i < n; i++) await db.entries.put({ id: `e${i}`, updatedAt: 1, deviceId: 'me', deleted: false, kind: 'expense', date: '2026-11-01', amountIncl: 100, categoryId: 'c', method: 'cash', createdBy: '' } as any);
  };
  const ask = 'This phone has 2 entries. Add them to the shared restaurant, or erase them first?';
  test('asks first; "Add them" joins keeping them', async () => {
    auth.email = 'son@x.com';
    await entries(2);
    const go = vi.fn();
    render(<Join onGo={go} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose the shared ledger' }));
    expect(await screen.findByText(ask)).toBeTruthy();
    expect(openShared).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add them' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
    expect(openShared).toHaveBeenCalledWith('file', { eraseLocal: false });
  });
  test('"Erase them first" joins with eraseLocal', async () => {
    auth.email = 'son@x.com';
    await entries(2);
    const go = vi.fn();
    render(<Join onGo={go} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose the shared ledger' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Erase them first' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
    expect(openShared).toHaveBeenCalledWith('file', { eraseLocal: true });
  });
  test('Cancel does nothing', async () => {
    auth.email = 'son@x.com';
    await entries(2);
    render(<Join onGo={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose the shared ledger' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(ask)).toBeNull());
    expect(openShared).not.toHaveBeenCalled();
  });
  test('no entries: no question', async () => {
    auth.email = 'son@x.com';
    const go = vi.fn();
    render(<Join onGo={go} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose the shared ledger' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  });
});
