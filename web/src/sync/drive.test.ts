import { describe, it, expect, beforeEach, vi } from 'vitest';

const getAccessToken = vi.fn();
vi.mock('./auth', async (orig) => ({ ...(await orig<typeof import('./auth')>()), getAccessToken: (force?: boolean) => getAccessToken(force) }));

import { ensureFolder, findFile, findFolder, listFiles, readJson, writeJson, uploadBlob, shareFolder, shareFile, getVersion } from './drive';
import { Offline } from './auth';

const fetchMock = vi.fn();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const hdr = (init: RequestInit, k: string) => new Headers(init.headers).get(k);

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockReset();
  getAccessToken.mockResolvedValue('TOK');
  vi.stubGlobal('fetch', fetchMock);
});

describe('writeJson', () => {
  it('creates via multipart POST to the upload URL', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'f1', version: '3' }));
    const r = await writeJson(null, 'a.json', 'parent', { x: 1 });
    expect(r).toEqual({ id: 'f1', version: '3' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version');
    expect(init.method).toBe('POST');
    expect(hdr(init, 'Authorization')).toBe('Bearer TOK');
    expect(hdr(init, 'Content-Type')).toMatch(/^multipart\/related; boundary=/);
    const body = init.body as string;
    expect(body).toContain('"name":"a.json"');
    expect(body).toContain('"parents":["parent"]');
    expect(body).toContain('{"x":1}');
  });
  it('updates via multipart PATCH', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'f1', version: '4' }));
    await writeJson('f1', 'a.json', 'parent', { x: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/upload/drive/v3/files/f1?uploadType=multipart&fields=id,version');
    expect(init.method).toBe('PATCH');
    expect(init.body as string).not.toContain('parents');
  });
});

describe('401 handling', () => {
  it('forces one token refresh and retries once', async () => {
    getAccessToken.mockResolvedValueOnce('OLD').mockResolvedValueOnce('NEW');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(json({ id: 'f1', version: '1' }));
    await writeJson(null, 'a.json', 'p', {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, true);
    expect(hdr(fetchMock.mock.calls[0][1], 'Authorization')).toBe('Bearer OLD');
    expect(hdr(fetchMock.mock.calls[1][1], 'Authorization')).toBe('Bearer NEW');
  });
  it('does not retry a second time', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    await expect(writeJson(null, 'a.json', 'p', {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('ensureFolder / findFile', () => {
  it('returns existing folder, escaping quotes and scoping by parent', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: [{ id: 'fold' }] }));
    expect(await ensureFolder("Bob's", 'par')).toBe('fold');
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files');
    expect(url.searchParams.get('q')).toBe(
      "name='Bob\\'s' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'par' in parents",
    );
  });
  it('creates when missing', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: [] })).mockResolvedValueOnce(json({ id: 'new' })).mockResolvedValueOnce(json({ files: [{ id: 'new' }] }));
    expect(await ensureFolder('F')).toBe('new');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('https://www.googleapis.com/drive/v3/files');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'F', mimeType: 'application/vnd.google-apps.folder' });
  });
  it('lists oldest first (orderBy createdTime) and picks the oldest', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: [{ id: 'old' }] })).mockResolvedValueOnce(json({ files: [{ id: 'oldf', version: '2' }] }));
    expect(await findFolder('F')).toBe('old');
    expect(await findFile('x.json', 'p')).toEqual({ id: 'oldf', version: '2' });
    for (const [u] of fetchMock.mock.calls) {
      const url = new URL(u);
      expect(url.searchParams.get('orderBy')).toBe('createdTime');
      expect(url.searchParams.get('pageSize')).toBe('1');
    }
  });
  it('ensureFolder re-lists after creating and switches to an older folder made concurrently', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(json({ id: 'mine' }))
      .mockResolvedValueOnce(json({ files: [{ id: 'theirs' }, { id: 'mine' }] }));
    expect(await ensureFolder('F')).toBe('theirs');
    const relist = new URL(fetchMock.mock.calls[2][0]);
    expect(relist.searchParams.get('orderBy')).toBe('createdTime');
    expect(relist.searchParams.get('pageSize')).toBe('2');
  });
  it('listFiles returns up to pageSize files oldest first', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: [{ id: 'a', version: '1' }, { id: 'b', version: '3' }] }));
    expect(await listFiles('x.json', 'p', 2)).toEqual([{ id: 'a', version: '1' }, { id: 'b', version: '3' }]);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('pageSize')).toBe('2');
  });
  it('findFile returns id+version or null', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: [{ id: 'a', version: '7' }] })).mockResolvedValueOnce(json({ files: [] }));
    expect(await findFile('x.json', 'p')).toEqual({ id: 'a', version: '7' });
    expect(await findFile('y.json', 'p')).toBeNull();
  });
});

describe('readJson / uploadBlob / shareFolder', () => {
  it('reads metadata version and media', async () => {
    fetchMock.mockResolvedValueOnce(json({ version: '9' })).mockResolvedValueOnce(json({ hello: 'w' }));
    expect(await readJson('id1')).toEqual({ data: { hello: 'w' }, version: '9' });
    expect(fetchMock.mock.calls[0][0]).toContain('/drive/v3/files/id1?fields=version');
    expect(fetchMock.mock.calls[1][0]).toContain('/drive/v3/files/id1?alt=media');
  });
  it('uploads a blob with its mime', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'b1', version: '1' }));
    const r = await uploadBlob('p.jpg', 'par', new Blob([new Uint8Array([1, 2, 3])]), 'image/jpeg');
    expect(r.id).toBe('b1');
    const init = fetchMock.mock.calls[0][1];
    expect(hdr(init, 'Content-Type')).toMatch(/^multipart\/related/);
  });
  it('shares as writer with notification', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'perm' }));
    await shareFolder('fid', 'a@b.com');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/drive/v3/files/fid/permissions');
    expect(url).toContain('sendNotificationEmail=true');
    expect(JSON.parse(init.body)).toEqual({ type: 'user', role: 'writer', emailAddress: 'a@b.com' });
  });
  it('shareFile uses the same permissions endpoint on the file', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'perm' }));
    await shareFile('led1', 'a@b.com');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/drive/v3/files/led1/permissions?sendNotificationEmail=true');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ type: 'user', role: 'writer', emailAddress: 'a@b.com' });
  });
});

describe('network failures and getVersion', () => {
  it('maps a fetch rejection to Offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(readJson('f1')).rejects.toBeInstanceOf(Offline);
    await expect(writeJson('f1', 'a.json', 'p', {})).rejects.toBeInstanceOf(Offline);
    await expect(ensureFolder('X')).rejects.toBeInstanceOf(Offline);
  });
  it('getVersion does a cheap fields=version GET', async () => {
    fetchMock.mockResolvedValueOnce(json({ version: '9' }));
    expect(await getVersion('f1')).toBe('9');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.googleapis.com/drive/v3/files/f1?fields=version');
  });
});
