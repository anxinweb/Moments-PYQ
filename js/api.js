import { CONFIG } from './config.js';

const BASE = CONFIG.API_BASE;

async function getJSON(path) {
  const res = await fetch(BASE + path, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function absolute(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return CONFIG.MEMOS_URL + (url.startsWith('/') ? url : '/' + url);
}

export function normalizeProfile(raw) {
  return {
    name: (raw && (raw.displayName || raw.username)) || CONFIG.NICKNAME,
    avatar: raw && raw.avatarUrl ? absolute(raw.avatarUrl) : '',
    bio: (raw && raw.description) || '',
  };
}

export async function getProfile() {
  const raw = await getJSON(`/profile?user=${encodeURIComponent(CONFIG.ADMIN_USER)}`);
  return normalizeProfile(raw);
}

export async function getMemos({ pageToken } = {}) {
  const qs = new URLSearchParams({ pageSize: String(CONFIG.PAGE_SIZE) });
  if (pageToken) qs.set('pageToken', pageToken);
  const data = await getJSON('/feed?' + qs.toString());
  const memos = (data.memos || [])
    .filter((m) => m.state !== 'ARCHIVED')
    .filter((m) => m.creator === `users/${CONFIG.ADMIN_USER}`);
  return { memos, nextPageToken: data.nextPageToken || '' };
}

/** 单条动态（详情页）：仅返回本站作者的公开动态 */
export async function getMemo(uid) {
  const data = await getJSON('/memo?uid=' + encodeURIComponent(uid));
  const memo = data && data.memo;
  if (!memo || memo.creator !== `users/${CONFIG.ADMIN_USER}`) {
    throw new Error('not_found');
  }
  return memo;
}

/** 附件原图地址：memos.ahxin.cn/file/attachments/<id>/<filename> */
export function attachmentUrl(att) {
  const id = (att.name || '').split('/')[1] || '';
  const file = encodeURIComponent(att.filename || '');
  return `${CONFIG.MEMOS_URL}/file/attachments/${id}/${file}`;
}

/** Memos 原生缩略图：约 60-100KB，列表与九宫格专用 */
export function thumbUrl(url) {
  return url + (url.includes('?') ? '&' : '?') + 'thumbnail=true';
}

export const PLACEHOLDER_AVATAR =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="#e6e6e6"/>' +
      '<circle cx="32" cy="26" r="10" fill="#c9c9c9"/>' +
      '<path d="M12 60c2-11 10-17 20-17s18 6 20 17z" fill="#c9c9c9"/>' +
      '</svg>'
  );
