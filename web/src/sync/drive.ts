import { getAccessToken } from './auth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type Id = string;

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async (force: boolean) => {
    const token = await getAccessToken(force);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  if (!res.ok) throw new Error(`Drive request failed (${res.status})`);
  return res;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function ensureFolder(name: string, parentId?: Id): Promise<Id> {
  let q = `name='${esc(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  if (parentId) q += ` and '${esc(parentId)}' in parents`;
  const found = await (await driveFetch(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`)).json();
  if (found.files?.length) return found.files[0].id;
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const created = await (await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();
  return created.id;
}

export async function findFile(name: string, parentId: Id): Promise<{ id: string; version: string } | null> {
  const q = `name='${esc(name)}' and '${esc(parentId)}' in parents and trashed=false`;
  const r = await (await driveFetch(`${API}/files?${new URLSearchParams({ q, fields: 'files(id,version)', pageSize: '1' })}`)).json();
  return r.files?.length ? { id: r.files[0].id, version: r.files[0].version } : null;
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

export async function shareFolder(id: Id, email: string): Promise<void> {
  await driveFetch(`${API}/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  });
}
