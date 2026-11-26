import { db } from '../db/db';
import type { Id } from '../domain/types';
import { t } from '../i18n';
import { shareOrDownload } from '../export/share';

export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const k = maxEdge / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Shrink a camera photo to a JPEG no larger than maxEdge. Falls back to the original if the browser can't decode it. */
export async function compressPhoto(file: Blob, maxEdge = 1600, quality = 0.7): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function') return file;
    const bmp = await createImageBitmap(file);
    const { width, height } = fitWithin(bmp.width, bmp.height, maxEdge);
    let out: Blob | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(width, height);
      c.getContext('2d')?.drawImage(bmp, 0, 0, width, height);
      out = await c.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d')?.drawImage(bmp, 0, 0, width, height);
      out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality));
    }
    bmp.close?.();
    return out ?? file;
  } catch {
    return file;
  }
}

export async function savePhoto(blob: Blob): Promise<Id> {
  const id = crypto.randomUUID();
  await db.photos.add({ id, blob, createdAt: Date.now(), backedUp: false });
  return id;
}

export async function getPhoto(id: Id): Promise<Blob | undefined> {
  return (await db.photos.get(id))?.blob;
}

export async function listPhotos() {
  return (await db.photos.orderBy('createdAt').reverse().toArray());
}

export async function deletePhoto(id: Id): Promise<void> {
  await db.photos.delete(id);
}

const fileName = (createdAt: number, n?: number) =>
  `bill-${new Date(createdAt).toISOString().slice(0, 10)}${n ? `-${n}` : `-${createdAt}`}.jpg`;

export async function savePhotoToPhone(id: Id): Promise<'shared' | 'downloaded'> {
  const row = await db.photos.get(id);
  if (!row) throw new Error('photo not found');
  return shareOrDownload(row.blob, fileName(row.createdAt));
}

/** Share every bill in one sheet when the phone allows it, otherwise download one file each. Returns the count. */
export async function saveAllPhotos(): Promise<number> {
  const rows = (await listPhotos()).reverse();
  if (rows.length === 0) return 0;
  const files = rows.map((r, i) => new File([r.blob], fileName(r.createdAt, i + 1), { type: r.blob.type || 'image/jpeg' }));
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: t('bills.title') });
      return rows.length;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return rows.length;
      throw err;
    }
  }
  for (const f of files) await shareOrDownload(f, f.name);
  return rows.length;
}
