const UPSTREAM = 'https://memos.ahxin.cn';
const TOKEN = process.env.MEMOS_TOKEN;

export const config = { runtime: 'edge' };

/**
 * 评论接口（评论本体存 Memos，用 Memos 原生「评论的评论」表达两级层级）
 *
 * GET  /api/comments?uids=a,b,c
 *      → { comments: { [uid]: [ { uid, name, url, text, time, replies: [...] } ] } }
 *      只返回 PUBLIC（= 已过审）的评论；PROTECTED = 待审，未过审不对外可见。
 *      replies 里是二级回复：{ uid, name, url, text, time, replyName }
 *      replyName 非空表示「回复@某某」（该回复本身指向另一条二级回复）
 *
 * POST /api/comments { uid, name, url, text, replyTo?, replyName? }
 *      以 PROTECTED（待审）创建；你在 Memos 里把它改成「公开」即过审上架。
 *      待审用 PROTECTED 而不是 PRIVATE：匿名同样看不到，但 Memos 会发邮件通知。
 *      replyTo = 被回复的一级评论 uid（回复永远挂在一级评论下，最多两级）；
 *      replyName = 被回复人昵称（仅用于展示「回复@某某：」）。
 *
 * 存储格式（Memos 里可读）：
 *   一级：[昵称](主页链接) 内容          （链接选填，无链接时 [昵称] 内容）
 *   二级：[昵称](链接) 回复@某某： 内容
 */

const NAME_RE = /^\[([^\]\n]{1,24})\](?:\((https?:\/\/[^)\s]{1,300})\))?\s?/;
const REPLY_RE = /^回复@([^：:\n]{1,24})[：:]\s*/;

function safeUrl(raw) {
  const s = String(raw || '').trim();
  return /^https?:\/\/\S{1,300}$/i.test(s) ? s : '';
}

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

const byTime = (a, b) => (a.time < b.time ? -1 : 1);

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
            const raws = (data.comments || []).filter(
              (c) => c.visibility === 'PUBLIC' && c.state !== 'ARCHIVED'
            );
            const list = raws.map(parseComment);
            await Promise.all(
              list.map(async (item, i) => {
                const raw = raws[i];
                const hasReplies = (raw.relations || []).some(
                  (r) => r.type === 'COMMENT' && r.memo && r.memo.name !== raw.name
                );
                item.replies = [];
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
                  /* 单条失败静默 */
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
      const name = String(body.name || '').replace(/[\[\]\(\)\r\n\t]/g, '').trim().slice(0, 12);
      const link = safeUrl(body.url);
      const text = String(body.text || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 500);
      const replyTo = String(body.replyTo || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const replyName = String(body.replyName || '').replace(/[：:\r\n\t@]/g, '').trim().slice(0, 12);
      if (!uid || !name || !text) return json({ error: 'bad_request' }, 400);

      // 回复必须挂在被评动态的一级评论下（校验被回复评论确实属于该动态）
      let target = uid;
      if (replyTo) {
        try {
          const check = await fetch(`${UPSTREAM}/api/memos/${replyTo}`, {
            headers: { accept: 'application/json' },
          });
          const cd = check.ok ? await check.json() : null;
          const ok =
            cd &&
            (cd.relations || []).some(
              (r) => r.type === 'COMMENT' && r.relatedMemo && r.relatedMemo.name === `memos/${uid}`
            );
          if (!ok) return json({ error: 'bad_reply_target' }, 400);
          target = replyTo;
        } catch {
          return json({ error: 'bad_reply_target' }, 400);
        }
      }

      const content =
        `[${name}]${link ? `(${link})` : ''} ` +
        (replyTo && replyName ? `回复@${replyName}：` : '') +
        text;

      const res = await fetch(`${UPSTREAM}/api/memos/${target}/comments`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          // PROTECTED（登录可见）= 待审核：匿名访客看不到，效果同 PRIVATE；
          // 但 Memos 的邮件通知只对 PRIVATE 一律不发、PROTECTED 会发——
          // 用 PROTECTED 让「待审评论」也能触发邮件通知，提醒站主去过审。
          visibility: 'PROTECTED',
        }),
      });
      if (!res.ok) return json({ error: 'memos_rejected' }, 502);
      const created = await res.json().catch(() => null);
      return json({ ok: true, pending: true, uid: (created && created.name || '').split('/')[1] || '' });
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
