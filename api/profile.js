const UPSTREAM = 'https://memos.ahxin.cn';
const DEFAULT_USER = 'ahxin';

export const config = { runtime: 'edge' };

/** GET /api/profile?user=ahxin —— 昵称、头像、个性签名 */
export default async function handler(request) {
  const url = new URL(request.url);
  const user = (url.searchParams.get('user') || DEFAULT_USER).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!user) {
    return json({ error: 'invalid_user' }, 400);
  }

  try {
    const res = await fetch(`${UPSTREAM}/api/users/${user}`, {
      headers: { accept: 'application/json' },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.ok ? 200 : res.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
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
