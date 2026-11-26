import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import { hasPin, setPin } from '../lock/lock';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));
const signIn = vi.hoisted(() => vi.fn());
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  signIn: (o?: unknown) => signIn(o),
}));

import { App } from '../App';
import { EmailMismatch } from '../sync/auth';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'Chez Test', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  await setPin('1234', 1000);
  signIn.mockReset();
  window.location.hash = '';
});

test('no auth session: no "Forgot PIN?" link', async () => {
  render(<App />);
  await screen.findByText('App locked');
  await waitFor(() => expect(screen.getByRole('button', { name: '1' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Forgot PIN?' })).toBeNull();
});

test('Forgot PIN: signing in with the same account clears the PIN and unlocks', async () => {
  await db.meta.put({ key: 'auth', value: { session: 'S', email: 'dad@x.com' } });
  signIn.mockResolvedValue({ email: 'dad@x.com' });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Forgot PIN?' }));
  expect(await screen.findByText('Recent activity')).toBeTruthy();
  expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ expectEmail: 'dad@x.com' }));
  expect(await hasPin()).toBe(false);
});

test('Forgot PIN with a different account: error, stays locked, PIN kept', async () => {
  await db.meta.put({ key: 'auth', value: { session: 'S', email: 'dad@x.com' } });
  signIn.mockRejectedValue(new EmailMismatch('x@y.com'));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Forgot PIN?' }));
  expect(await screen.findByText(/not the account/)).toBeTruthy();
  expect(screen.getByText('App locked')).toBeTruthy();
  expect(await hasPin()).toBe(true);
});
