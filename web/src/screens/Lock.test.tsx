import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { seedDefaults } from '../db/repo';
import { saveShared } from '../settings/store';
import { setPin } from '../lock/lock';
import { PinSetup } from '../lock/PinSetup';
import { App } from '../App';

vi.mock('../domain/clock', () => ({ todayISO: () => '2026-11-25' }));

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  await saveShared({ restaurantName: 'Chez Test', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  window.location.hash = '';
});

const type = (pin: string) => pin.split('').forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

test('with a PIN, the lock shows on cold start and no other screen renders', async () => {
  await setPin('1234', 1000);
  render(<App />);
  expect(await screen.findByText('App locked')).toBeTruthy();
  expect(screen.queryByText('Recent activity')).toBeNull();
  expect(screen.queryByText('Chez Test')).toBeNull();
});

test('wrong PIN shows a message; right PIN unlocks', async () => {
  await setPin('1234', 1000);
  render(<App />);
  await screen.findByText('App locked');
  type('1111');
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByText('Wrong PIN. Try again.')).toBeTruthy();
  type('1234');
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByText('Recent activity')).toBeTruthy();
});

test('5 wrong PINs show a lockout countdown', async () => {
  await setPin('1234', 1000);
  render(<App />);
  await screen.findByText('App locked');
  for (let i = 0; i < 5; i++) {
    type('0000');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getAllByTestId('pin-dot')[0].getAttribute('data-filled')).toBe('false'));
  }
  expect(await screen.findByText(/Try again in 30 s/)).toBeTruthy();
});

test('re-locks when visible again after 3 minutes hidden, not after less', async () => {
  await setPin('1234', 1000);
  render(<App />);
  await screen.findByText('App locked');
  type('1234');
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByText('Recent activity');
  const vis = (v: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const now = vi.spyOn(Date, 'now');
  now.mockReturnValue(1_000_000);
  act(() => vis('hidden'));
  now.mockReturnValue(1_000_000 + 179_999);
  act(() => vis('visible'));
  expect(screen.queryByText('App locked')).toBeNull();
  now.mockReturnValue(2_000_000);
  act(() => vis('hidden'));
  now.mockReturnValue(2_000_000 + 180_000);
  act(() => vis('visible'));
  expect(await screen.findByText('App locked')).toBeTruthy();
  expect(screen.queryByText('Recent activity')).toBeNull();
  now.mockRestore();
});

test('PinSetup asks twice and stores the PIN; mismatch restarts', async () => {
  const done = vi.fn();
  render(<PinSetup onDone={done} iterations={1000} />);
  type('12');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('The PIN must be 4 to 6 digits.')).toBeTruthy();
  type('34');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Enter the PIN again')).toBeTruthy();
  type('9999');
  fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
  expect(await screen.findByText('The PINs do not match. Start again.')).toBeTruthy();
  type('1234'); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Enter the PIN again');
  type('1234'); fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(await db.meta.get('lock')).toBeTruthy();
});
