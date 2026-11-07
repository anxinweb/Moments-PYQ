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

/* --------------------------------------------------------------- 赞与评论 */

/** 访客 UUID：点赞去重用，首次访问生成，永久存 localStorage */
export function visitorId() {
  let id = localStorage.getItem('pyq-visitor');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('pyq-visitor', id);
  }
  return id;
}

/** 评论/点赞用的昵称（localStorage 持久化） */
export function getNickname() {
  return localStorage.getItem('pyq-nick') || '';
}

export function setNickname(name) {
  localStorage.setItem('pyq-nick', name);
}

/** 访客主页链接（选填）：评论和点赞共用，点昵称跳转 */
export function getHomepage() {
  return localStorage.getItem('pyq-link') || '';
}

export function setHomepage(url) {
  localStorage.setItem('pyq-link', url);
}

/** 待审评论（本地）：提交后立刻显示「审核中」，过审后自动转正并清除 */
export function getPendingComments() {
  try {
    const arr = JSON.parse(localStorage.getItem('pyq-pending') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

export function addPendingComment(entry) {
  const arr = getPendingComments();
  arr.push(entry);
  try {
    localStorage.setItem('pyq-pending', JSON.stringify(arr.slice(-200)));
  } catch (e) {
    /* 存储满时静默失败，仅本次会话可见 */
  }
}

export function removePendingComments(uids) {
  if (!uids.length) return;
  try {
    localStorage.setItem(
      'pyq-pending',
      JSON.stringify(getPendingComments().filter((p) => !uids.includes(p.uid)))
    );
  } catch (e) {
    /* ignore */
  }
}

/** 批量拉取一组动态的点赞状态 */
export async function getLikes(uids) {
  if (!uids.length) return {};
  const qs = new URLSearchParams({ uids: uids.join(','), visitor: visitorId() });
  const data = await getJSON('/likes?' + qs.toString());
  return data.likes || {};
}

/** 点赞 / 取消点赞，返回最新状态；url 为访客主页链接（选填，点昵称跳转） */
export async function toggleLike(uid, on, name, url) {
  const res = await fetch(BASE + '/likes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid, visitor: visitorId(), name: name || '访客', url: url || '', on: !!on }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** 批量拉取一组动态的已过审评论 */
export async function getComments(uids) {
  if (!uids.length) return {};
  const qs = new URLSearchParams({ uids: uids.join(',') });
  const data = await getJSON('/comments?' + qs.toString());
  return data.comments || {};
}

/**
 * 提交评论（先审后发：提交后为待审状态，Memos 里改公开即上架）
 * reply: { attachUid, replyName } —— 回复某条评论时：挂到一级评论下，replyName 用于展示
 * 返回 { uid } 供本地「审核中」显示与过审匹配
 */
export async function postComment(uid, name, url, text, reply) {
  const res = await fetch(BASE + '/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uid,
      name,
      url: url || '',
      text,
      replyTo: reply?.attachUid || '',
      replyName: reply?.replyName || '',
    }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
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
