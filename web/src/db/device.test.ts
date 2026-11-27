import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { db } from './db';
import { _resetDeviceIdCache, getDeviceId } from './device';

beforeEach(async () => {
  await db.meta.clear();
  _resetDeviceIdCache();
});

it('two concurrent first calls get the same id, and it is the stored one', async () => {
  const [a, b] = await Promise.all([getDeviceId(), getDeviceId()]);
  expect(a).toBe(b);
  expect((await db.meta.get('deviceId'))?.value).toBe(a);
  _resetDeviceIdCache();
  expect(await getDeviceId()).toBe(a);
});
