/**
 * 本地预览服务器（仅开发用，不部署）
 * 复刻 /api/feed、/api/profile、/api/img 三个接口，保证本地与线上同一条代码路径
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const UPSTREAM = 'https://memos.ahxin.cn';

// 本地密钥：.env.local（已 gitignore），格式与 Vercel 环境变量一致
const env = (() => {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
})();
const UPSTASH_URL = env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MEMOS_TOKEN = env.MEMOS_TOKEN || process.env.MEMOS_TOKEN;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/api/feed') return await handleFeed(url, res);
    if (url.pathname === '/api/memo') return await handleMemo(url, res);
    if (url.pathname === '/api/profile') return await handleProfile(url, res);
    if (url.pathname === '/api/likes') return await handleLikes(url, req, res);
    if (url.pathname === '/api/comments') return await handleComments(url, req, res);
    return serveStatic(url, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end('server error');
  }
});

async function handleFeed(url, res) {
  const size = Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '20', 10) || 20, 1), 50);
  const token = url.searchParams.get('pageToken') || '';
  const target = new URL('/api/memos', UPSTREAM);
  target.searchParams.set('pageSize', String(size));
  if (token) target.searchParams.set('pageToken', token);

  const r = await fetch(target, { headers: { accept: 'application/json' } });
  const body = await r.text();
  res.writeHead(r.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function handleMemo(url, res) {
  const uid = (url.searchParams.get('uid') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const r = await fetch(`${UPSTREAM}/api/memos/${uid}`, { headers: { accept: 'application/json' } });
  const body = await r.text();
  res.writeHead(r.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  // 与线上 api/memo.js 同构：包一层 { memo }
  res.end(r.ok ? JSON.stringify({ memo: JSON.parse(body) }) : body);
}

async function handleProfile(url, res) {
  const user = (url.searchParams.get('user') || 'ahxin').replace(/[^a-zA-Z0-9_-]/g, '');
  const r = await fetch(`${UPSTREAM}/api/users/${user}`, { headers: { accept: 'application/json' } });
  const body = await r.text();
  res.writeHead(r.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/* ---------------- 点赞（Upstash Redis REST） ---------------- */

async function upstash(commands) {
  const r = await fetch(UPSTASH_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + UPSTASH_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('redis http ' + r.status);
  const data = await r.json();
  return data.map((x) => (x && typeof x === 'object' && 'result' in x ? x.result : x));
}

/** value → { n, u }：JSON 新格式 / 纯昵称旧格式 */
function parseNameValue(v) {
  const s = String(v || '');
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s);
      if (o && typeof o.n === 'string') {
        return { n: o.n.slice(0, 12), u: /^https?:\/\/\S{1,300}$/i.test(o.u || '') ? o.u : '' };
      }
    } catch {
      /* 旧数据兜底 */
    }
  }
  return { n: s.slice(0, 12) || '访客', u: '' };
}

function parseUids(url) {
  return (url.searchParams.get('uids') || '')
    .split(',')
    .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(Boolean)
    .slice(0, 50);
}

async function handleLikes(url, req, res) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return send(res, 503, { error: 'not_configured' });
  try {
    if (req.method === 'GET') {
      const uids = parseUids(url);
      const visitor = (url.searchParams.get('visitor') || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
      if (!uids.length) return send(res, 200, { likes: {} });
      const commands = [];
      for (const uid of uids) {
        commands.push(['HVALS', 'like:' + uid]);
        if (visitor) commands.push(['HEXISTS', 'like:' + uid, visitor]);
      }
      const results = await upstash(commands);
      const likes = {};
      uids.forEach((uid, i) => {
        const names = (results[i * 2] || []).map(parseNameValue);
        likes[uid] = { count: names.length, names, liked: visitor ? Boolean(results[i * 2 + 1]) : false };
      });
      return send(res, 200, { likes });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const uid = String(body.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const visitor = String(body.visitor || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
      const name = String(body.name || '').replace(/[\r\n\t]/g, '').slice(0, 12) || '访客';
      const link = String(body.url || '').trim();
      const url2 = /^https?:\/\/\S{1,300}$/i.test(link) ? link : '';
      const on = body.on !== false;
      if (!uid || !visitor) return send(res, 400, { error: 'bad_request' });
      const key = 'like:' + uid;
      const value = url2 ? JSON.stringify({ n: name, u: url2 }) : name;
      const results = await upstash([on ? ['HSET', key, visitor, value] : ['HDEL', key, visitor], ['HVALS', key]]);
      const names = (results[1] || []).map(parseNameValue);
      return send(res, 200, { ok: true, count: names.length, names, liked: on });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error('[likes]', err);
    return send(res, 502, { error: 'redis_error' });
  }
}

/* ---------------- 评论（Memos，先审后发，原生两级） ---------------- */

const NAME_RE = /^\[([^\]\n]{1,24})\](?:\((https?:\/\/[^)\s]{1,300})\))?\s?/;
const REPLY_RE = /^回复@([^：:\n]{1,24})[：:]\s*/;
const byTime = (a, b) => (a.time < b.time ? -1 : 1);

function parseComment(raw) {
  const content = String(raw.content || '');
  const m = NAME_RE.exec(content);
  const item = {
    uid: (raw.name || '').split('/')[1] || '',
    name: m ? m[1] : '访客',
    url: m && m[2] ? m[2] : '',
    text: m ? content.slice(m[0].length) : content,
    time: raw.createTime || '',
  };
  const r = REPLY_RE.exec(item.text);
  if (r) {
    item.replyName = r[1];
    item.text = item.text.slice(r[0].length);
  }
  return item;
}

async function handleComments(url, req, res) {
  try {
    if (req.method === 'GET') {
      const uids = parseUids(url);
      if (!uids.length) return send(res, 200, { comments: {} });
      const entries = await Promise.all(
        uids.map(async (uid) => {
          try {
            const r = await fetch(`${UPSTREAM}/api/memos/${uid}/comments`, { headers: { accept: 'application/json' } });
            if (!r.ok) return [uid, []];
            const data = await r.json();
            const raws = (data.comments || []).filter(
              (c) => c.visibility === 'PUBLIC' && c.state !== 'ARCHIVED'
            );
            const list = raws.map(parseComment);
            await Promise.all(
              list.map(async (item, i) => {
                item.replies = [];
                const hasReplies = (raws[i].relations || []).some(
                  (x) => x.type === 'COMMENT' && x.memo && x.memo.name !== raws[i].name
                );
                if (!hasReplies) return;
                try {
                  const r2 = await fetch(`${UPSTREAM}/api/memos/${item.uid}/comments`, {
                    headers: { accept: 'application/json' },
                  });
                  if (!r2.ok) return;
                  const d2 = await r2.json();
                  item.replies = (d2.comments || [])
                    .filter((c) => c.visibility === 'PUBLIC' && c.state !== 'ARCHIVED')
                    .map(parseComment)
                    .sort(byTime);
                } catch {
                  /* ignore */
                }
              })
            );
            list.sort(byTime);
            return [uid, list];
          } catch {
            return [uid, []];
          }
        })
      );
      return send(res, 200, { comments: Object.fromEntries(entries) });
    }
    if (req.method === 'POST') {
      if (!MEMOS_TOKEN) return send(res, 503, { error: 'not_configured' });
      const body = await readJson(req);
      const uid = String(body.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const name = String(body.name || '').replace(/[\[\]\(\)\r\n\t]/g, '').trim().slice(0, 12);
      const link = String(body.url || '').trim();
      const url2 = /^https?:\/\/\S{1,300}$/i.test(link) ? link : '';
      const text = String(body.text || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 500);
      const replyTo = String(body.replyTo || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const replyName = String(body.replyName || '').replace(/[：:\r\n\t@]/g, '').trim().slice(0, 12);
      if (!uid || !name || !text) return send(res, 400, { error: 'bad_request' });

      let target = uid;
      if (replyTo) {
        const check = await fetch(`${UPSTREAM}/api/memos/${replyTo}`, { headers: { accept: 'application/json' } });
        const cd = check.ok ? await check.json() : null;
        const ok =
          cd &&
          (cd.relations || []).some(
            (x) => x.type === 'COMMENT' && x.relatedMemo && x.relatedMemo.name === `memos/${uid}`
          );
        if (!ok) return send(res, 400, { error: 'bad_reply_target' });
        target = replyTo;
      }
      const content =
        `[${name}]${url2 ? `(${url2})` : ''} ` + (replyTo && replyName ? `回复@${replyName}：` : '') + text;
      const r = await fetch(`${UPSTREAM}/api/memos/${target}/comments`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + MEMOS_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ content, visibility: 'PROTECTED' }), // 待审：匿名不可见 + 邮件通知可发
      });
      if (!r.ok) return send(res, 502, { error: 'memos_rejected' });
      const created = await r.json().catch(() => null);
      return send(res, 200, { ok: true, pending: true, uid: ((created && created.name) || '').split('/')[1] || '' });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error('[comments]', err);
    return send(res, 502, { error: 'upstream_unavailable' });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(url, res) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/about') pathname = '/index.html';
  if (pathname.startsWith('/memo/')) pathname = '/index.html';

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PYQ dev server → http://127.0.0.1:${PORT}`);
});
