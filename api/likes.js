export const config = { runtime: 'edge' };

/**
 * 点赞接口（Upstash Redis 存储）
 *
 * GET  /api/likes?uids=a,b,c&visitor=<uuid>
 *      → { likes: { [uid]: { count, names: [...], liked } } }
 *      names 用于微信样式的「♥ 昵称、昵称」展示；liked 表示当前访客是否已赞
 *
 * POST /api/likes { uid, visitor, name, url, on }
 *      on=true 点赞（HSET），false 取消（HDEL）；返回最新状态
 *      url 选填（访客主页链接，点昵称跳转），仅接受 http(s)
 *
 * 数据结构：Redis Hash like:<memoUid>，field=访客UUID，value=点赞时用的昵称
 * 带链接时 value 存 {"n":"昵称","u":"https://..."}，老数据纯文本昵称直接兼容。
 * 不存任何个人信息，无清理策略，单条动态的量级永远在几百以内。
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

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

export default async function handler(request) {
  if (!REST_URL || !REST_TOKEN) return json({ error: 'not_configured' }, 503);

  const url = new URL(request.url);

  try {
    if (request.method === 'GET') {
      const uids = (url.searchParams.get('uids') || '')
        .split(',')
        .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter(Boolean)
        .slice(0, 50);
      const visitor = (url.searchParams.get('visitor') || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
      if (!uids.length) return json({ likes: {} });

      // pipeline：每条动态取全部昵称 + 当前访客是否已赞
      const commands = [];
      for (const uid of uids) {
        commands.push(['HVALS', 'like:' + uid]);
        if (visitor) commands.push(['HEXISTS', 'like:' + uid, visitor]);
      }
      const results = await redis(commands);
      const likes = {};
      uids.forEach((uid, i) => {
        const names = (results[i * 2] || []).map(parseNameValue);
        const liked = visitor ? Boolean(results[i * 2 + 1]) : false;
        likes[uid] = { count: names.length, names, liked };
      });
      return new Response(JSON.stringify({ likes }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) return json({ error: 'bad_request' }, 400);

      const uid = String(body.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const visitor = String(body.visitor || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
      const name = String(body.name || '').replace(/[\r\n\t]/g, '').slice(0, 12) || '访客';
      const link = String(body.url || '').trim();
      const url = /^https?:\/\/\S{1,300}$/i.test(link) ? link : '';
      const on = body.on !== false;
      if (!uid || !visitor) return json({ error: 'bad_request' }, 400);

      const key = 'like:' + uid;
      const value = url ? JSON.stringify({ n: name, u: url }) : name;
      const results = await redis([
        on ? ['HSET', key, visitor, value] : ['HDEL', key, visitor],
        ['HVALS', key],
      ]);
      const names = (results[1] || []).map(parseNameValue);
      return json({ ok: true, count: names.length, names, liked: on });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return json({ error: 'redis_error' }, 502);
  }
}

/** Upstash REST pipeline：POST 一组命令到 /pipeline，返回逐条 result */
async function redis(commands) {
  const res = await fetch(REST_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + REST_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error('redis http ' + res.status);
  const data = await res.json();
  return data.map((r) => (r && typeof r === 'object' && 'result' in r ? r.result : r));
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
