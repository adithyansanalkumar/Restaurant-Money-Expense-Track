import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import { reloadSettings, saveShared } from '../settings/store';

const drive = vi.hoisted(() => ({ shareFolder: vi.fn(async () => {}), shareFile: vi.fn(async () => {}) }));
vi.mock('../sync/drive', async (orig) => ({ ...(await orig<typeof import('../sync/drive')>()), ...drive }));
const auth = vi.hoisted(() => ({ email: 'adi@x.com' as string | null, signOut: vi.fn(async () => {}) }));
vi.mock('../sync/auth', async (orig) => ({
  ...(await orig<typeof import('../sync/auth')>()),
  currentEmail: async () => auth.email,
  signOut: () => auth.signOut(),
}));

import { SharePanel } from './SharePanel';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  auth.email = 'adi@x.com';
  auth.signOut.mockClear();
  drive.shareFolder.mockClear();
  await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F1', fileId: 'L1' } });
});

test('only the owner sees "Share with someone"', async () => {
  await saveShared({ restaurantName: 'R', ownerEmail: 'adi@x.com' });
  const { unmount } = render(<SharePanel />);
  expect(await screen.findByText('Share with someone')).toBeTruthy();
  unmount();
  auth.email = 'son@x.com';
  render(<SharePanel />);
  await screen.findByText('Signed in as son@x.com');
  expect(screen.queryByText('Share with someone')).toBeNull();
});

test('an invalid email shows an error and sends nothing; a valid one shares the folder', async () => {
  await saveShared({ restaurantName: 'R', ownerEmail: 'adi@x.com' });
  render(<SharePanel />);
  const input = await screen.findByLabelText('Email address');
  fireEvent.change(input, { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
  expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
  expect(drive.shareFolder).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'son@gmail.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
  expect(await screen.findByText('Invite sent to son@gmail.com')).toBeTruthy();
  expect(drive.shareFolder).toHaveBeenCalledWith('F1', 'son@gmail.com');
});

test('Sign out calls signOut', async () => {
  await saveShared({ restaurantName: 'R', ownerEmail: 'adi@x.com' });
  render(<SharePanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
});
