import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { seedDefaults } from '../db/repo';
import { reloadSettings, saveShared } from '../settings/store';

const drive = vi.hoisted(() => ({ shareFolder: vi.fn(async () => {}), shareFile: vi.fn(async () => {}) }));
vi.mock('../sync/drive', async (orig) => ({ ...(await orig<typeof import('../sync/drive')>()), ...drive }));
const auth = vi.hoisted(() => ({
  email: 'adi@x.com' as string | null,
  signOut: vi.fn(async () => {}), signIn: vi.fn(), disconnect: vi.fn(async () => {}),
}));
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  currentEmail: async () => auth.email,
  signOut: () => auth.signOut(),
  signIn: (o?: unknown) => auth.signIn(o),
  disconnectGoogle: () => auth.disconnect(),
}));
const adopt = vi.hoisted(() => vi.fn());
vi.mock('../sync/onboard', () => ({
  adoptExistingLedger: () => adopt(),
  signInLater: async (o?: unknown) => { const { email } = await auth.signIn(o); return { email, result: await adopt() }; },
}));
const sync = vi.hoisted(() => ({ syncNow: vi.fn(async () => ({ status: 'ok', at: Date.now() })) }));
vi.mock('../sync/sync', async (orig) => ({ ...(await orig<typeof import('../sync/sync')>()), syncNow: () => sync.syncNow() }));
const backup = vi.hoisted(() => ({ backupPendingPhotos: vi.fn(async () => 0) }));
vi.mock('../photos/backup', () => backup);
const bio = vi.hoisted(() => ({ enable: vi.fn(async () => true) }));
vi.mock('../lock/lock', async (orig) => ({ ...(await orig<typeof import('../lock/lock')>()), enableBiometric: () => bio.enable() }));

import { Settings } from './Settings';
import { hasPin, setPin, biometricEnabled } from '../lock/lock';

const base = { restaurantName: 'Chez Adi', country: 'FR', currency: 'EUR', billLanguage: 'fra' as const, taxView: 'incl' as const, photoBackup: false, ocrMode: 'device' as const };

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  auth.email = 'adi@x.com';
  for (const f of [auth.signOut, auth.signIn, auth.disconnect, adopt, drive.shareFolder, backup.backupPendingPhotos, sync.syncNow, bio.enable]) f.mockClear();
  bio.enable.mockResolvedValue(true);
  await seedDefaults();
  await saveShared({ ...base, ownerEmail: 'adi@x.com' });
  await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F1', fileId: 'L1' } });
});

const shared = async () => (await db.settings.get('shared'))!;

test('restaurant card: name, signed-in email, Owner role, and Sync now', async () => {
  render(<Settings onGo={vi.fn()} />);
  expect(await screen.findByDisplayValue('Chez Adi')).toBeTruthy();
  expect((await screen.findAllByText(/adi@x\.com/)).length).toBeGreaterThan(0);
  expect(screen.getByText('Owner')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
  expect(sync.syncNow).toHaveBeenCalled();
});

test('tax view and bill language are shared settings and are saved', async () => {
  render(<Settings onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Excl. tax' }));
  await waitFor(async () => expect((await shared()).taxView).toBe('excl'));
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  await waitFor(async () => expect((await shared()).billLanguage).toBe('eng'));
});

test('country change sets its currency; the owner can edit it', async () => {
  render(<Settings onGo={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('Country'), { target: { value: 'GB' } });
  await waitFor(async () => { const s = await shared(); expect([s.country, s.currency]).toEqual(['GB', 'GBP']); });
  fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } });
  await waitFor(async () => expect((await shared()).currency).toBe('USD'));
});

test('a non-owner cannot edit country and currency', async () => {
  auth.email = 'son@x.com';
  render(<Settings onGo={vi.fn()} />);
  await screen.findByText('Chez Adi');
  await waitFor(() => expect(screen.getByText('Shared')).toBeTruthy());
  expect(screen.queryByLabelText('Country')).toBeNull();
  expect(screen.queryByText('Share with someone')).toBeNull();
});

test('app language and first day of week are device settings', async () => {
  render(<Settings onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sunday' }));
  await waitFor(async () => expect(((await db.meta.get('device'))!.value as any).weekStart).toBe(0));
  fireEvent.change(screen.getByLabelText('App language'), { target: { value: 'fr' } });
  await waitFor(async () => expect(((await db.meta.get('device'))!.value as any).appLanguage).toBe('fr'));
  expect((await shared()).updatedAt).toBeDefined();
});

test('while adoptPending nothing shared is written and a pending notice shows', async () => {
  await db.meta.put({ key: 'adoptPending', value: true });
  const before = await shared();
  render(<Settings onGo={vi.fn()} />);
  expect(await screen.findByText(/can’t change yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Excl. tax' }));
  fireEvent.click(screen.getByRole('switch', { name: /Back up bill photos/ }));
  expect(screen.queryByText('Share with someone')).toBeNull();
  await new Promise((r) => setTimeout(r, 30));
  expect(await shared()).toEqual(before);
});

test('categories: add, rename, archive and unarchive write through put', async () => {
  render(<Settings onGo={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('New category name'), { target: { value: 'Spices' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
  await waitFor(async () => expect((await db.categories.toArray()).some((c) => c.name === 'Spices' && c.kind === 'expense' && !c.archived)).toBe(true));
  const spices = (await db.categories.toArray()).find((c) => c.name === 'Spices')!;
  expect(spices.updatedAt).toBeGreaterThan(0); // a synced write (stamped)

  const input = await screen.findByLabelText('Rename Spices');
  fireEvent.change(input, { target: { value: 'Herbs' } });
  fireEvent.blur(input);
  await waitFor(async () => expect((await db.categories.get(spices.id))!.name).toBe('Herbs'));

  fireEvent.click(await screen.findByRole('button', { name: 'Archive Herbs' }));
  await waitFor(async () => expect((await db.categories.get(spices.id))!.archived).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: 'Unarchive Herbs' }));
  await waitFor(async () => expect((await db.categories.get(spices.id))!.archived).toBe(false));
});

test('income channels are edited the same way', async () => {
  render(<Settings onGo={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('New channel name'), { target: { value: 'Events' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add channel' }));
  await waitFor(async () => expect((await db.categories.toArray()).some((c) => c.name === 'Events' && c.kind === 'income')).toBe(true));
});

test('suppliers: add, rename and set a default category', async () => {
  const dairy = (await db.categories.toArray()).find((c) => c.name === 'Dairy')!;
  render(<Settings onGo={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText('New supplier name'), { target: { value: 'Metro' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
  await waitFor(async () => expect((await db.suppliers.toArray()).map((s) => s.name)).toEqual(['Metro']));
  const sup = (await db.suppliers.toArray())[0];

  fireEvent.change(await screen.findByLabelText('Default category for Metro'), { target: { value: dairy.id } });
  await waitFor(async () => expect((await db.suppliers.get(sup.id))!.defaultCategoryId).toBe(dairy.id));

  const input = screen.getByLabelText('Rename supplier Metro');
  fireEvent.change(input, { target: { value: 'Metro Cash' } });
  fireEvent.blur(input);
  await waitFor(async () => expect((await db.suppliers.get(sup.id))!.name).toBe('Metro Cash'));
  expect((await db.suppliers.get(sup.id))!.defaultCategoryId).toBe(dairy.id);
});

test('sharing (owner): lists who was invited, invites by email and records it in shared settings', async () => {
  await saveShared({ sharedWith: ['old@x.com'] });
  render(<Settings onGo={vi.fn()} />);
  expect(await screen.findByText('old@x.com')).toBeTruthy();
  const input = screen.getByLabelText('Email address');
  fireEvent.change(input, { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
  expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
  expect(drive.shareFolder).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'son@gmail.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
  expect(await screen.findByText('Invite sent to son@gmail.com')).toBeTruthy();
  expect(drive.shareFolder).toHaveBeenCalledWith('F1', 'son@gmail.com');
  await waitFor(async () => expect((await shared()).sharedWith).toEqual(['old@x.com', 'son@gmail.com']));
  expect(await screen.findByText('son@gmail.com')).toBeTruthy();
});

test('photo backup toggle is a shared setting; turning it on runs the backup', async () => {
  render(<Settings onGo={vi.fn()} />);
  const sw = await screen.findByRole('switch', { name: /Back up bill photos/ });
  expect(sw.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(sw);
  await waitFor(async () => expect((await shared()).photoBackup).toBe(true));
  await waitFor(() => expect(backup.backupPendingPhotos).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('switch', { name: /Back up bill photos/ }));
  await waitFor(async () => expect((await shared()).photoBackup).toBe(false));
  expect(backup.backupPendingPhotos).toHaveBeenCalledTimes(1);
});

test('app lock: set a PIN, then change/remove and the biometric switch appear; remove asks first', async () => {
  render(<Settings onGo={vi.fn()} />);
  expect(screen.queryByRole('switch', { name: /Face ID/ })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Set a PIN' }));
  for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByRole('button', { name: d }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByRole('button', { name: d }));
  fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
  await waitFor(async () => expect(await hasPin()).toBe(true));
  expect(await screen.findByRole('button', { name: 'Change PIN' })).toBeTruthy();

  const sw = await screen.findByRole('switch', { name: /Face ID/ });
  fireEvent.click(sw);
  await waitFor(() => expect(bio.enable).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('switch', { name: /Face ID/ }).getAttribute('aria-checked')).toBe('true'));

  fireEvent.click(screen.getByRole('button', { name: 'Remove PIN' }));
  expect(await hasPin()).toBe(true); // asks first
  fireEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
  await waitFor(async () => expect(await hasPin()).toBe(false));
  expect(await biometricEnabled()).toBe(false);
  await waitFor(() => expect(screen.queryByRole('switch', { name: /Face ID/ })).toBeNull());
});

test('biometric not available on this phone: says so and stays off', async () => {
  await setPin('1234', 1000);
  bio.enable.mockResolvedValue(false);
  render(<Settings onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('switch', { name: /Face ID/ }));
  expect(await screen.findByText(/isn’t available/)).toBeTruthy();
  expect(screen.getByRole('switch', { name: /Face ID/ }).getAttribute('aria-checked')).toBe('false');
});

test('bill reading offers only "On this phone" for now', async () => {
  render(<Settings onGo={vi.fn()} />);
  expect(await screen.findByText('On this phone')).toBeTruthy();
});

test('Export to Excel goes to Reports; Open a shared restaurant goes to join', async () => {
  const go = vi.fn();
  render(<Settings onGo={go} />);
  fireEvent.click(await screen.findByRole('button', { name: /Export to Excel/ }));
  expect(go).toHaveBeenCalledWith('reports');
  fireEvent.click(screen.getByRole('button', { name: 'Open a shared restaurant' }));
  expect(go).toHaveBeenCalledWith('join');
});

test('Sign out calls signOut', async () => {
  render(<Settings onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
});

test('Disconnect Google asks first, explaining it signs out every phone', async () => {
  render(<Settings onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Google completely' }));
  expect(screen.getByText(/signs out every phone/)).toBeTruthy();
  expect(auth.disconnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(auth.disconnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google completely' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect everywhere' }));
  await waitFor(() => expect(auth.disconnect).toHaveBeenCalled());
});

test('signed out: Sign in with Google runs signInLater (adoption decides)', async () => {
  auth.email = null;
  auth.signIn.mockImplementation(async () => { auth.email = 'adi@x.com'; return { email: 'adi@x.com' }; });
  adopt.mockResolvedValue('none');
  render(<Settings onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  await waitFor(() => expect(adopt).toHaveBeenCalled());
  expect(await screen.findByText('Share with someone')).toBeTruthy();
});

test('signed out former joiner: sign-in that ends in needsJoin sends the user to Join', async () => {
  auth.email = null;
  await db.meta.delete('ledgerRef');
  auth.signIn.mockImplementation(async () => { auth.email = 'son@x.com'; return { email: 'son@x.com' }; });
  adopt.mockResolvedValue('needsJoin');
  const go = vi.fn();
  render(<Settings onGo={go} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  await waitFor(() => expect(go).toHaveBeenCalledWith('join'));
});

test('owner can rename the restaurant (shared setting); a non-owner sees it read-only', async () => {
  const { unmount } = render(<Settings onGo={vi.fn()} />);
  const input = await screen.findByLabelText('Restaurant name');
  fireEvent.change(input, { target: { value: 'Chez Dad' } });
  fireEvent.blur(input);
  await waitFor(async () => expect((await shared()).restaurantName).toBe('Chez Dad'));
  unmount();
  auth.email = 'son@x.com';
  render(<Settings onGo={vi.fn()} />);
  await screen.findByText('Chez Dad');
  expect(screen.queryByLabelText('Restaurant name')).toBeNull();
});

test('name is not editable while adoptPending', async () => {
  await db.meta.put({ key: 'adoptPending', value: true });
  render(<Settings onGo={vi.fn()} />);
  expect((await screen.findByLabelText('Restaurant name') as HTMLInputElement).disabled).toBe(true);
});

test('a purely local phone (signed out, no ledgerRef) can edit name and region even with an ownerEmail stored', async () => {
  auth.email = null;
  await db.meta.delete('ledgerRef');
  render(<Settings onGo={vi.fn()} />);
  expect(await screen.findByLabelText('Restaurant name')).toBeTruthy();
  expect(screen.getByLabelText('Country')).toBeTruthy();
});

test('signed out but with a ledgerRef and another owner: read-only', async () => {
  auth.email = null; // ownerEmail adi@x.com is set, a ledger exists: not purely local
  render(<Settings onGo={vi.fn()} />);
  await screen.findByText('Chez Adi');
  expect(screen.queryByLabelText('Restaurant name')).toBeNull();
  expect(screen.queryByLabelText('Country')).toBeNull();
});

test('bill reading: Google AI choice writes ocrMode, reveals the key field; key stays on the device', async () => {
  render(<Settings onGo={vi.fn()} />);
  expect(await screen.findByRole('radio', { name: 'On this phone' })).toBeChecked();
  expect(screen.queryByLabelText('Google AI key')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: /Google AI/ }));
  await waitFor(async () => expect((await shared()).ocrMode).toBe('gemini'));
  const key = await screen.findByLabelText('Google AI key');
  expect(key).toHaveAttribute('type', 'password');
  expect(screen.getByText(/sent to Google/)).toBeTruthy();
  fireEvent.change(key, { target: { value: 'AIza123' } });
  fireEvent.blur(key);
  await waitFor(async () => expect((await db.meta.get('geminiKey'))?.value).toBe('AIza123'));
  expect(JSON.stringify(await shared())).not.toContain('AIza123');
  fireEvent.click(screen.getByRole('radio', { name: 'On this phone' }));
  await waitFor(async () => expect((await shared()).ocrMode).toBe('device'));
});

test('bill reading mode is not written while adoptPending', async () => {
  await db.meta.put({ key: 'adoptPending', value: true });
  const before = await shared();
  render(<Settings onGo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('radio', { name: /Google AI/ }));
  await new Promise((r) => setTimeout(r, 30));
  expect(await shared()).toEqual(before);
});
