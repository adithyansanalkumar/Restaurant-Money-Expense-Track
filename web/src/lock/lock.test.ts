import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import {
  setPin, checkPin, clearPin, hasPin, shouldLock, LOCK_AFTER_MS,
  enableBiometric, disableBiometric, biometricEnabled, unlockBiometric, lockoutRemainingMs,
} from './lock';

const IT = 1000; // tests only: fast PBKDF2

beforeEach(async () => { await db.meta.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('PIN', () => {
  it('right PIN true, wrong PIN false, nothing stored in clear text', async () => {
    await setPin('4821', IT);
    expect(await hasPin()).toBe(true);
    expect(await checkPin('4821')).toBe(true);
    expect(await checkPin('1111')).toBe(false);
    const row = await db.meta.get('lock');
    const json = JSON.stringify(row);
    expect(json).not.toContain('4821');
    const v = row!.value as { salt: string; hash: string; iterations: number };
    expect(v.iterations).toBe(IT);
    expect(typeof v.salt).toBe('string');
    expect(typeof v.hash).toBe('string');
  });

  it('defaults to 200000 iterations', async () => {
    await setPin('1234');
    expect(((await db.meta.get('lock'))!.value as { iterations: number }).iterations).toBe(200000);
  });

  it('rejects PINs that are not 4-6 digits', async () => {
    for (const bad of ['123', '1234567', '12a4', '', '12 4']) {
      await expect(setPin(bad, IT)).rejects.toThrow();
    }
    expect(await hasPin()).toBe(false);
  });

  it('clearPin also removes the biometric entry', async () => {
    await setPin('1234', IT);
    await db.meta.put({ key: 'biometric', value: 'abc' });
    await clearPin();
    expect(await db.meta.get('biometric')).toBeUndefined();
  });

  it('clearPin removes the lock', async () => {
    await setPin('1234', IT);
    await clearPin();
    expect(await hasPin()).toBe(false);
  });

  it('locks out for 30 s after 5 wrong PINs, persisted, and resets on success', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    await setPin('1234', IT);
    for (let i = 0; i < 4; i++) expect(await checkPin('0000')).toBe(false);
    expect(await lockoutRemainingMs()).toBe(0);
    expect(await checkPin('0000')).toBe(false); // 5th
    expect(await lockoutRemainingMs()).toBe(30000);
    expect(await checkPin('1234')).toBe(false); // refused while locked
    vi.setSystemTime(1_000_000 + 29_999);
    expect(await checkPin('1234')).toBe(false);
    vi.setSystemTime(1_000_000 + 30_000);
    expect(await checkPin('1234')).toBe(true);
    // fails reset: four more wrongs do not lock
    for (let i = 0; i < 4; i++) await checkPin('0000');
    expect(await lockoutRemainingMs()).toBe(0);
  });

  it('lockout survives a reload (stored in meta)', async () => {
    await setPin('1234', IT);
    for (let i = 0; i < 5; i++) await checkPin('0000');
    const row = await db.meta.get('lock');
    expect((row!.value as { lockedUntil: number }).lockedUntil).toBeGreaterThan(Date.now());
  });
});

describe('shouldLock', () => {
  it('locks after 180000 ms hidden', () => {
    expect(LOCK_AFTER_MS).toBe(180000);
    expect(shouldLock(0, 179999)).toBe(false);
    expect(shouldLock(0, 180000)).toBe(true);
  });
});

describe('biometric', () => {
  const credId = new Uint8Array([1, 2, 3, 250, 251]).buffer;
  it('resolves false when WebAuthn is unavailable', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(await enableBiometric()).toBe(false);
    expect(await biometricEnabled()).toBe(false);
  });

  it('enables with a platform authenticator, stores the credential id, then unlocks', async () => {
    const create = vi.fn().mockResolvedValue({ rawId: credId });
    const get = vi.fn().mockResolvedValue({ id: 'x' });
    vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: async () => true });
    vi.stubGlobal('navigator', { ...navigator, credentials: { create, get } });
    expect(await enableBiometric()).toBe(true);
    const opts = create.mock.calls[0][0].publicKey;
    expect(opts.authenticatorSelection).toEqual({ authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' });
    expect(await biometricEnabled()).toBe(true);
    expect(await unlockBiometric()).toBe(true);
    const g = get.mock.calls[0][0].publicKey;
    expect(g.userVerification).toBe('required');
    expect(new Uint8Array(g.allowCredentials[0].id)).toEqual(new Uint8Array([1, 2, 3, 250, 251]));
    get.mockRejectedValueOnce(new Error('cancel'));
    expect(await unlockBiometric()).toBe(false);
    await disableBiometric();
    expect(await biometricEnabled()).toBe(false);
    expect(await unlockBiometric()).toBe(false);
  });

  it('resolves false when creation is refused', async () => {
    vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: async () => true });
    vi.stubGlobal('navigator', { ...navigator, credentials: { create: vi.fn().mockRejectedValue(new Error('no')), get: vi.fn() } });
    expect(await enableBiometric()).toBe(false);
    expect(await biometricEnabled()).toBe(false);
  });
});
