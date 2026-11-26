import { getAccessToken, Offline } from './auth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type Id = string;

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async (force: boolean) => {
    const token = await getAccessToken(force);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    try {
      return await fetch(url, { ...init, headers });
    } catch {
      throw new Offline();
    }
  };
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  if (!res.ok) throw new Error(`Drive request failed (${res.status})`);
  return res;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Lists by query, oldest first (orderBy createdTime), so every phone agrees on which one is canonical. */
async function listOldest(q: string, fields: string, pageSize: number): Promise<Record<string, string>[]> {
  const params = new URLSearchParams({ q, fields: `files(${fields})`, pageSize: String(pageSize), orderBy: 'createdTime' });
  const r = await (await driveFetch(`${API}/files?${params}`)).json();
  return r.files ?? [];
}

const folderQuery = (name: string, parentId?: Id) => {
  let q = `name='${esc(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  if (parentId) q += ` and '${esc(parentId)}' in parents`;
  return q;
};

/** The oldest folder with this name, or null. */
export async function findFolder(name: string, parentId?: Id): Promise<Id | null> {
  return (await listOldest(folderQuery(name, parentId), 'id', 1))[0]?.id ?? null;
}

/**
 * The oldest folder with this name; creates it when missing. After creating, re-lists: if another
 * phone created one at the same time and theirs is older, theirs is returned.
 */
export async function ensureFolder(name: string, parentId?: Id): Promise<Id> {
  const found = await findFolder(name, parentId);
  if (found) return found;
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const created = await (await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();
  const again = await listOldest(folderQuery(name, parentId), 'id', 2);
  return again[0]?.id ?? created.id;
}

/** Files with this name in the folder, oldest first, at most pageSize. */
export async function listFiles(name: string, parentId: Id, pageSize = 1): Promise<{ id: string; version: string }[]> {
  const q = `name='${esc(name)}' and '${esc(parentId)}' in parents and trashed=false`;
  return (await listOldest(q, 'id,version', pageSize)).map((f) => ({ id: f.id, version: f.version }));
}

/** The oldest file with this name in the folder, or null. */
export async function findFile(name: string, parentId: Id): Promise<{ id: string; version: string } | null> {
  return (await listFiles(name, parentId, 1))[0] ?? null;
}

/** Cheap metadata-only read of a file's version (used right before writing). */
export async function getVersion(id: Id): Promise<string> {
  const meta = await (await driveFetch(`${API}/files/${encodeURIComponent(id)}?fields=version`)).json();
  return meta.version;
}

export async function readJson(id: Id): Promise<{ data: unknown; version: string }> {
  const meta = await (await driveFetch(`${API}/files/${encodeURIComponent(id)}?fields=version`)).json();
  const data = await (await driveFetch(`${API}/files/${encodeURIComponent(id)}?alt=media`)).json();
  return { data, version: meta.version };
}

function multipart(metadata: object, content: string | Blob, mime: string): { body: string | Blob; contentType: string } {
  const boundary = 'resto' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const contentType = `multipart/related; boundary=${boundary}`;
  if (typeof content === 'string') return { body: head + content + tail, contentType };
  return { body: new Blob([head, content, tail]), contentType };
}

async function upload(id: Id | null, name: string, parentId: Id, content: string | Blob, mime: string) {
  const metadata: Record<string, unknown> = { name };
  if (!id) metadata.parents = [parentId];
  const { body, contentType } = multipart(metadata, content, mime);
  const url = id
    ? `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id,version`
    : `${UPLOAD}/files?uploadType=multipart&fields=id,version`;
  const r = await (await driveFetch(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': contentType }, body })).json();
  return { id: r.id as string, version: r.version as string };
}

export function writeJson(id: Id | null, name: string, parentId: Id, data: unknown): Promise<{ id: string; version: string }> {
  return upload(id, name, parentId, JSON.stringify(data), 'application/json');
}

export function uploadBlob(name: string, parentId: Id, blob: Blob, mime: string): Promise<{ id: string; version: string }> {
  return upload(null, name, parentId, blob, mime);
}

/** Adds `email` as a writer and lets Google email them. */
async function shareWith(id: Id, email: string): Promise<void> {
  await driveFetch(`${API}/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  });
}

export function shareFolder(id: Id, email: string): Promise<void> {
  return shareWith(id, email);
}

/** Same as shareFolder, for a single file (a ledger ref with no folder). */
export function shareFile(id: Id, email: string): Promise<void> {
  return shareWith(id, email);
}

/** Downloads the oldest file with this name in the folder (alt=media), or null when there is none. */
export async function downloadByName(name: string, parentId: Id): Promise<Blob | null> {
  const f = await findFile(name, parentId);
  if (!f) return null;
  return (await driveFetch(`${API}/files/${encodeURIComponent(f.id)}?alt=media`)).blob();
}
