import { db } from '../db/db';

export const LOCK_AFTER_MS = 180000;
export const MAX_FAILS = 5;
export const LOCKOUT_MS = 30000;
export const PBKDF2_ITERATIONS = 200000;

interface LockRow { salt: string; hash: string; iterations: number; fails: number; lockedUntil: number }

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string): Uint8Array => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const read = async (): Promise<LockRow | null> => ((await db.meta.get('lock'))?.value as LockRow | undefined) ?? null;
const write = (v: LockRow) => db.meta.put({ key: 'lock', value: v });

/** `iterations` is injectable for tests only; production callers omit it. */
export async function setPin(pin: string, iterations: number = PBKDF2_ITERATIONS): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4 to 6 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, iterations);
  await write({ salt: b64(salt), hash: b64(hash), iterations, fails: 0, lockedUntil: 0 });
}

export async function clearPin(): Promise<void> {
  await db.meta.delete('lock');
}

export async function hasPin(): Promise<boolean> {
  return (await read()) !== null;
}

export async function lockoutRemainingMs(): Promise<number> {
  const r = await read();
  return r ? Math.max(0, r.lockedUntil - Date.now()) : 0;
}

export async function checkPin(pin: string): Promise<boolean> {
  const r = await read();
  if (!r) return false;
  if (r.lockedUntil > Date.now()) return false;
  const ok = equal(await derive(pin, unb64(r.salt), r.iterations), unb64(r.hash));
  if (ok) {
    if (r.fails !== 0 || r.lockedUntil !== 0) await write({ ...r, fails: 0, lockedUntil: 0 });
    return true;
  }
  const fails = r.fails + 1;
  await write(fails >= MAX_FAILS ? { ...r, fails: 0, lockedUntil: Date.now() + LOCKOUT_MS } : { ...r, fails, lockedUntil: 0 });
  return false;
}

export function shouldLock(hiddenAt: number, now: number): boolean {
  return now - hiddenAt >= LOCK_AFTER_MS;
}

// ---- Biometric (WebAuthn platform authenticator; a local gate only) ----

const creds = () => (typeof navigator !== 'undefined' ? navigator.credentials : undefined);

export async function biometricEnabled(): Promise<boolean> {
  return !!(await db.meta.get('biometric'))?.value;
}

export async function enableBiometric(): Promise<boolean> {
  try {
    const PKC = (globalThis as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
    if (!PKC?.isUserVerifyingPlatformAuthenticatorAvailable || !creds()?.create) return false;
    if (!(await PKC.isUserVerifyingPlatformAuthenticatorAvailable())) return false;
    const cred = (await creds()!.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Resto' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'resto', displayName: 'Resto' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    await db.meta.put({ key: 'biometric', value: b64(cred.rawId) });
    return true;
  } catch {
    return false;
  }
}

export async function disableBiometric(): Promise<void> {
  await db.meta.delete('biometric');
}

export async function unlockBiometric(): Promise<boolean> {
  try {
    const id = (await db.meta.get('biometric'))?.value as string | undefined;
    if (!id || !creds()?.get) return false;
    const a = await creds()!.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(id) as BufferSource }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!a;
  } catch {
    return false;
  }
}
