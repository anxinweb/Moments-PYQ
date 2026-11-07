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
const RESIZER = 'https://images.weserv.nl/';

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
    if (url.pathname === '/api/img') return await handleImg(url, res);
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

async function handleImg(url, res) {
  const raw = url.searchParams.get('u');
  const w = Math.min(Math.max(parseInt(url.searchParams.get('w') || '480', 10) || 480, 120), 2000);
  if (!raw) {
    res.writeHead(400);
    return res.end('missing u');
  }
  let src;
  try {
    src = new URL(raw);
  } catch {
    res.writeHead(400);
    return res.end('bad u');
  }
  if (src.hostname !== 'memos.ahxin.cn') {
    res.writeHead(403);
    return res.end('forbidden');
  }

  const target = `${RESIZER}?url=${encodeURIComponent(src.host + src.pathname + src.search)}&w=${w}&output=webp&q=78&we`;
  try {
    const r = await fetch(target);
    if (!r.ok) throw new Error('resizer ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, {
      'content-type': r.headers.get('content-type') || 'image/webp',
      'cache-control': 'public, max-age=86400',
    });
    res.end(buf);
  } catch {
    res.writeHead(302, { location: src.toString() });
    res.end();
  }
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
