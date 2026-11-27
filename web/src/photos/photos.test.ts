import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { compressPhoto, fitWithin, getPhoto, listPhotos, saveAllPhotos, savePhoto, savePhotoToPhone } from './photos';

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('fitWithin', () => {
  it('scales the long edge down to maxEdge, keeping ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe('compressPhoto', () => {
  it('draws to a canvas at the fitted size and exports jpeg', async () => {
    const out = new Blob(['x'], { type: 'image/jpeg' });
    const convertToBlob = vi.fn().mockResolvedValue(out);
    const drawImage = vi.fn();
    const sizes: number[][] = [];
    class FakeCanvas {
      constructor(public width: number, public height: number) { sizes.push([width, height]); }
      getContext() { return { drawImage }; }
      convertToBlob = convertToBlob;
    }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    const res = await compressPhoto(new Blob(['in']), 1600, 0.7);
    expect(res).toBe(out);
    expect(sizes).toEqual([[1600, 1200]]);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.7 });
  });
  it('returns the original when the platform cannot decode', async () => {
    const f = new Blob(['in']);
    expect(await compressPhoto(f)).toBe(f);
  });
});

describe('photo store', () => {
  it('saves, gets and lists newest first', async () => {
    const a = await savePhoto(new Blob(['a'], { type: 'image/jpeg' }));
    await new Promise((r) => setTimeout(r, 5));
    const b = await savePhoto(new Blob(['b'], { type: 'image/jpeg' }));
    expect(await getPhoto(a)).toBeDefined(); // fake-indexeddb clones Blobs loosely under jsdom
    expect(await getPhoto('nope')).toBeUndefined();
    expect((await listPhotos()).map((p) => p.id)).toEqual([b, a]);
    expect((await db.photos.get(a))?.backedUp).toBe(false);
  });
  it('savePhotoToPhone and saveAllPhotos download one file each when sharing many is unsupported', async () => {
    await savePhoto(new Blob(['a'], { type: 'image/jpeg' }));
    await savePhoto(new Blob(['b'], { type: 'image/jpeg' }));
    const id = (await listPhotos())[0].id;
    const clicks: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    try {
      expect(await savePhotoToPhone(id)).toBe('downloaded');
      expect(await saveAllPhotos()).toBe(2);
    } finally { HTMLAnchorElement.prototype.click = orig; }
    expect(clicks).toHaveLength(3);
    expect(clicks.every((n) => n.endsWith('.jpg'))).toBe(true);
  });
});
