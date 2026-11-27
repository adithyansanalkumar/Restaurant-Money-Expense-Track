export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSession(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** ENC_KEY must be base64 (standard or url-safe) of exactly 32 bytes (AES-256). Throws otherwise. */
export function assertKey(encKeyB64: string): Uint8Array<ArrayBuffer> {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = b64urlDecode((encKeyB64 ?? '').trim()); } catch { throw new Error('ENC_KEY is not base64'); }
  if (raw.length !== 32) throw new Error('ENC_KEY must decode to 32 bytes');
  return raw;
}

async function importKey(encKeyB64: string): Promise<CryptoKey> {
  const raw = assertKey(encKeyB64);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** base64url(iv12 || ciphertext) */
export async function encrypt(plain: string, encKeyB64: string): Promise<string> {
  const key = await importKey(encKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64urlEncode(out);
}

export async function decrypt(blob: string, encKeyB64: string): Promise<string> {
  const key = await importKey(encKeyB64);
  const all = b64urlDecode(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
  return new TextDecoder().decode(pt);
}
