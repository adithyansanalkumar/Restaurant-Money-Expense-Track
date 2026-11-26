import { db } from './db';

let cached: Promise<string> | undefined;

async function load(): Promise<string> {
  const row = await db.meta.get('deviceId');
  if (row && typeof row.value === 'string') return row.value;
  const id = crypto.randomUUID();
  // add (not put): if another tab/caller stored one first, keep theirs.
  try {
    await db.meta.add({ key: 'deviceId', value: id });
    return id;
  } catch {
    const again = await db.meta.get('deviceId');
    if (again && typeof again.value === 'string') return again.value;
    throw new Error('Could not store device id');
  }
}

/** The in-flight promise is memoized, so concurrent first calls share one id. */
export function getDeviceId(): Promise<string> {
  if (!cached) {
    const p = load();
    cached = p;
    p.catch(() => { if (cached === p) cached = undefined; });
  }
  return cached;
}

/** test helper */
export function _resetDeviceIdCache(): void {
  cached = undefined;
}
