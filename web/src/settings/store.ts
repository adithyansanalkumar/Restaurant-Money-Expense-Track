import { useEffect, useSyncExternalStore } from 'react';
import { db } from '../db/db';
import { put } from '../db/repo';
import type { SharedSettings } from '../domain/types';
import { detectLanguage, setLanguage, type Lang } from '../i18n';

export interface DeviceSettings { appLanguage: Lang; weekStart: 0 | 1 }

export const COUNTRY_DEFAULTS: Record<string, { currency: string; locale: string; billLanguage: 'fra' | 'eng' }> = {
  FR: { currency: 'EUR', locale: 'fr-FR', billLanguage: 'fra' },
  BE: { currency: 'EUR', locale: 'fr-BE', billLanguage: 'fra' },
  CH: { currency: 'CHF', locale: 'fr-CH', billLanguage: 'fra' },
  GB: { currency: 'GBP', locale: 'en-GB', billLanguage: 'eng' },
  IN: { currency: 'INR', locale: 'en-IN', billLanguage: 'eng' },
  US: { currency: 'USD', locale: 'en-US', billLanguage: 'eng' },
};

interface State { loaded: boolean; shared: SharedSettings | null; device: DeviceSettings }

const defaultDevice = (): DeviceSettings => ({ appLanguage: detectLanguage(), weekStart: 1 });
let state: State = { loaded: false, shared: null, device: defaultDevice() };
const listeners = new Set<() => void>();
const set = (s: State) => { state = s; listeners.forEach((l) => l()); };

let loading: Promise<void> | null = null;
export function loadSettings(): Promise<void> {
  return (loading ??= doLoad());
}

/** Re-read settings from IndexedDB (after a sync brought new shared settings). */
export function reloadSettings(): Promise<void> {
  loading = doLoad();
  return loading;
}

async function doLoad(): Promise<void> {
  const shared = (await db.settings.get('shared')) ?? null;
  const row = await db.meta.get('device');
  const device = { ...defaultDevice(), ...((row?.value as Partial<DeviceSettings> | undefined) ?? {}) };
  setLanguage(device.appLanguage);
  set({ loaded: true, shared: shared && !shared.deleted ? shared : null, device });
}

export async function saveShared(p: Partial<SharedSettings>): Promise<void> {
  await loadSettings();
  const base = state.shared ?? { restaurantName: '', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device' } as Omit<SharedSettings, 'id' | 'updatedAt' | 'deviceId' | 'deleted'>;
  const row = await put<SharedSettings>('settings', { ...base, ...p, id: 'shared' });
  set({ ...state, shared: row });
}

export async function saveDevice(p: Partial<DeviceSettings>): Promise<void> {
  await loadSettings();
  const device = { ...state.device, ...p };
  await db.meta.put({ key: 'device', value: device });
  setLanguage(device.appLanguage);
  set({ ...state, device });
}

export function useSettings() {
  const s = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => state,
  );
  useEffect(() => { void loadSettings(); }, []);
  return { loaded: s.loaded, shared: s.shared, device: s.device, saveShared, saveDevice };
}
