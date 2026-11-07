const UPSTREAM = 'https://memos.ahxin.cn';

export const config = { runtime: 'edge' };

/**
 * GET /api/memo?uid=<memo uid>
 * 单条动态详情（详情页用）。仅返回公开发布、未归档的动态，
 * 私有/受保护的内容未登录拿不到，天然 404，不会泄露。
 */
export default async function handler(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const uid = (url.searchParams.get('uid') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!uid) return json({ error: 'missing_uid' }, 400);

  try {
    const res = await fetch(`${UPSTREAM}/api/memos/${uid}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return json({ error: 'not_found' }, 404);

    const memo = await res.json();
    if (memo.state === 'ARCHIVED') return json({ error: 'not_found' }, 404);
    if (memo.visibility && memo.visibility !== 'PUBLIC') {
      return json({ error: 'not_found' }, 404);
    }

    return new Response(JSON.stringify({ memo }), {
      status: 200,
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
