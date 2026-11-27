import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '../db/db';
import { GEMINI_MODEL, getGeminiKey, readBillWithGemini, setGeminiKey } from './gemini';

const blob = new Blob(['img'], { type: 'image/jpeg' });
const reply = (obj: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] }) });

beforeEach(async () => { await db.meta.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

test("'184,50' becomes 18450; key goes in a header, never the URL", async () => {
  const f = reply({ incl: '184,50' });
  vi.stubGlobal('fetch', f);
  const r = await readBillWithGemini(blob, 'SECRET');
  expect(r.incl).toBe(18450);
  const [url, init] = f.mock.calls[0];
  expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
  expect(url).not.toContain('SECRET');
  expect(init.headers['x-goog-api-key']).toBe('SECRET');
  const body = JSON.parse(init.body);
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.contents[0].parts.some((p: { inline_data?: { mime_type: string } }) => p.inline_data?.mime_type === 'image/jpeg')).toBe(true);
});

test('full reply: shop matched to a supplier, date, amounts', async () => {
  vi.stubGlobal('fetch', reply({ shop: 'Metro Cash & Carry', date: '2026-11-25', incl: '184,50', excl: '153,80', tax: '30,70' }));
  const r = await readBillWithGemini(blob, 'k', [{ id: 's1', name: 'METRO cash carry' } as never]);
  expect(r).toMatchObject({ shop: 'Metro Cash & Carry', supplierId: 's1', date: '2026-11-25', incl: 18450, excl: 15380, tax: 3070 });
});

test('bad values are dropped, not crashed', async () => {
  vi.stubGlobal('fetch', reply({ shop: '', date: '25/11', incl: 'abc', excl: '12,00', tax: 5 }));
  expect(await readBillWithGemini(blob, 'k')).toEqual({ excl: 1200 });
});

test('HTTP error, bad JSON and network failure all throw', async () => {
  vi.stubGlobal('fetch', reply({}, false, 500));
  await expect(readBillWithGemini(blob, 'k')).rejects.toThrow();
  vi.stubGlobal('fetch', reply('not json'));
  await expect(readBillWithGemini(blob, 'k')).rejects.toThrow();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
  await expect(readBillWithGemini(blob, 'k')).rejects.toThrow();
});

test('key is stored in device meta', async () => {
  expect(await getGeminiKey()).toBeNull();
  await setGeminiKey(' abc ');
  expect(await getGeminiKey()).toBe('abc');
  expect((await db.meta.get('geminiKey'))?.value).toBe('abc');
  await setGeminiKey('');
  expect(await getGeminiKey()).toBeNull();
});
