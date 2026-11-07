const UPSTREAM = 'https://memos.ahxin.cn';

export const config = { runtime: 'edge' };

/**
 * GET /api/feed?pageSize=20&pageToken=xxx
 * 同源转发 Memos 公开信息流，顺带做 30 秒边缘缓存并规避跨域限制
 */
export default async function handler(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const rawSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
  const pageSize = Math.min(Math.max(Number.isFinite(rawSize) ? rawSize : 20, 1), 50);
  const pageToken = url.searchParams.get('pageToken') || '';

  const target = new URL('/api/memos', UPSTREAM);
  target.searchParams.set('pageSize', String(pageSize));
  if (pageToken) target.searchParams.set('pageToken', pageToken);

  try {
    const res = await fetch(target.toString(), {
      headers: { accept: 'application/json' },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.ok ? 200 : res.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=60, stale-while-revalidate=600',
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    return json({ error: 'upstream_unavailable' }, 502);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
