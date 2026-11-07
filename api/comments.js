const UPSTREAM = 'https://memos.ahxin.cn';
const TOKEN = process.env.MEMOS_TOKEN;

export const config = { runtime: 'edge' };

/**
 * 评论接口（评论本体存 Memos：以专用账号发布、parent 指向被评动态）
 *
 * GET  /api/comments?uids=a,b,c
 *      → { comments: { [uid]: [{ name, text, time }] } }
 *      只返回 PUBLIC（= 已过审）的评论；PRIVATE = 待审，未过审不对外可见
 *
 * POST /api/comments { uid, name, text }
 *      以 PRIVATE（待审）创建评论；你在 Memos 里把它改成「公开」即过审上架
 *
 * 存储格式：内容首部用 [昵称] 标记，渲染时解析成「昵称：内容」。
 */

export default async function handler(request) {
  const url = new URL(request.url);

  try {
    if (request.method === 'GET') {
      const uids = (url.searchParams.get('uids') || '')
        .split(',')
        .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter(Boolean)
        .slice(0, 50);
      if (!uids.length) return json({ comments: {} });

      const entries = await Promise.all(
        uids.map(async (uid) => {
          try {
            const res = await fetch(`${UPSTREAM}/api/memos/${uid}/comments`, {
              headers: { accept: 'application/json' },
            });
            if (!res.ok) return [uid, []];
            const data = await res.json();
            const list = (data.comments || [])
              .filter((c) => c.visibility === 'PUBLIC' && c.state !== 'ARCHIVED')
              .map((c) => {
                const m = /^\[([^\]\n]{1,12})\]\s?/.exec(c.content || '');
                return {
                  name: m ? m[1] : '访客',
                  text: m ? String(c.content).slice(m[0].length) : String(c.content || ''),
                  time: c.createTime || '',
                };
              })
              .sort((a, b) => (a.time < b.time ? -1 : 1));
            return [uid, list];
          } catch {
            return [uid, []];
          }
        })
      );

      return new Response(JSON.stringify({ comments: Object.fromEntries(entries) }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, s-maxage=30, stale-while-revalidate=300',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (request.method === 'POST') {
      if (!TOKEN) return json({ error: 'not_configured' }, 503);
      const body = await request.json().catch(() => null);
      if (!body) return json({ error: 'bad_request' }, 400);

      const uid = String(body.uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const name = String(body.name || '').replace(/[\[\]\r\n\t]/g, '').trim().slice(0, 12);
      const text = String(body.text || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 500);
      if (!uid || !name || !text) return json({ error: 'bad_request' }, 400);

      const res = await fetch(`${UPSTREAM}/api/memos/${uid}/comments`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({
          content: `[${name}] ${text}`,
          visibility: 'PRIVATE', // 私有 = 待审核
        }),
      });
      if (!res.ok) return json({ error: 'memos_rejected' }, 502);
      return json({ ok: true, pending: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
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
