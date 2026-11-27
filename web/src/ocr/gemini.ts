import { db } from '../db/db';
import { parseAmount } from '../domain/money';
import type { ISODate, Supplier } from '../domain/types';
import { matchSupplier, type ParsedReceipt } from './parseReceipt';

/** The one place the Google model name lives. */
export const GEMINI_MODEL = 'gemini-flash-latest';
const TIMEOUT_MS = 15000;

/** The API key lives on this phone only (meta table is never synced). Never logged. */
export async function getGeminiKey(): Promise<string | null> {
  const v = (await db.meta.get('geminiKey'))?.value;
  return typeof v === 'string' && v ? v : null;
}
export async function setGeminiKey(key: string): Promise<void> {
  const k = key.trim();
  if (k) await db.meta.put({ key: 'geminiKey', value: k });
  else await db.meta.delete('geminiKey');
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('read'));
    r.readAsDataURL(blob);
  });
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Read a bill photo with Google AI. Throws on any failure so the caller can fall back to the device. */
export async function readBillWithGemini(blob: Blob, apiKey: string, suppliers: Supplier[] = []): Promise<ParsedReceipt> {
  const data = await toBase64(blob);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let json: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: ctl.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: 'Read this shop bill. Return the shop name, the date as YYYY-MM-DD, the total including tax (incl), the total excluding tax (excl) and the tax amount (tax). Amounts as plain numbers with a decimal comma or point. Leave out anything you cannot read.' },
          { inline_data: { mime_type: 'image/jpeg', data } },
        ] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', properties: {
            shop: { type: 'STRING' }, date: { type: 'STRING' }, incl: { type: 'STRING' }, excl: { type: 'STRING' }, tax: { type: 'STRING' },
          } },
        },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    json = await res.json();
  } finally { clearTimeout(timer); }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('gemini: empty');
  const o = JSON.parse(text) as Record<string, unknown>;
  if (!o || typeof o !== 'object') throw new Error('gemini: bad json');

  const out: ParsedReceipt = {};
  const shop = str(o.shop);
  if (shop) {
    out.shop = shop;
    const s = matchSupplier(shop, suppliers);
    if (s) out.supplierId = s.id;
  }
  const date = str(o.date);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) out.date = date as ISODate;
  }
  for (const k of ['incl', 'excl', 'tax'] as const) {
    const s = str(o[k]);
    const c = s ? parseAmount(s) : null;
    if (c !== null) out[k] = c;
  }
  return out;
}
