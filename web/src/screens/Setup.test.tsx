import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db/db';
import { setLanguage } from '../i18n';
import * as repo from '../db/repo';
import { Setup } from './Setup';

beforeEach(async () => {
  setLanguage('en');
  await Promise.all(db.tables.map((t) => t.clear()));
});

test('choosing France preselects EUR and French bills; Continue saves and routes home', async () => {
  const go = vi.fn();
  render(<Setup onGo={go} />);
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Chez Adi' } });
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'US' } });
  expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('USD');
  expect((screen.getByLabelText('Bills printed in') as HTMLSelectElement).value).toBe('eng');
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'FR' } });
  expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('EUR');
  expect((screen.getByLabelText('Bills printed in') as HTMLSelectElement).value).toBe('fra');
  fireEvent.click(screen.getByText('Continue'));
  await waitFor(() => expect(go).toHaveBeenCalledWith('home'));
  const s = await db.settings.get('shared');
  expect(s).toMatchObject({ restaurantName: 'Chez Adi', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' });
  expect(await db.categories.count()).toBeGreaterThan(0);
  expect((await db.meta.get('device'))?.value).toMatchObject({ appLanguage: 'en', weekStart: 1 });
});

test('Open it here routes to join', () => {
  const go = vi.fn();
  render(<Setup onGo={go} />);
  fireEvent.click(screen.getByText('Open it here'));
  expect(go).toHaveBeenCalledWith('join');
});

test('failed seeding leaves no shared settings, shows an error and re-enables Continue', async () => {
  vi.spyOn(repo, 'seedDefaults').mockRejectedValueOnce(new Error('boom'));
  const go = vi.fn();
  render(<Setup onGo={go} />);
  fireEvent.click(screen.getByText('Continue'));
  await screen.findByRole('alert');
  expect(go).not.toHaveBeenCalled();
  expect(await db.settings.get('shared')).toBeUndefined();
  expect(screen.getByText('Continue')).not.toBeDisabled();
});
