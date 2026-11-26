import { db } from './db';

let cached: string | undefined;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const row = await db.meta.get('deviceId');
  if (row && typeof row.value === 'string') {
    cached = row.value;
    return cached;
  }
  const id = crypto.randomUUID();
  await db.meta.put({ key: 'deviceId', value: id });
  cached = id;
  return id;
}

/** test helper */
export function _resetDeviceIdCache(): void {
  cached = undefined;
}
