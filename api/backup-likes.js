/**
 * GET /api/backup-likes —— 点赞数据每日快照到 Memos（防 Upstash 免费层丢数据）
 *
 * 由 Vercel Cron 每天调用一次（见 vercel.json 的 crons）。
 * 快照内容：Redis 里所有 like:<memoUid> 哈希 → 一条 PRIVATE memo（含 JSON）。
 * Memos 里搜 #like-backup 就能找到历史快照；恢复见 README 的「点赞备份恢复」。
 *
 * 环境变量：
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  已有
 *   MEMOS_TOKEN                                        已有（用于写 memo）
 *   CRON_SECRET（可选）Vercel Cron 会带 Authorization: Bearer <CRON_SECRET>
 *   NOTIFY_KEY（可选）手动触发时用 ?key=<NOTIFY_KEY>
 */

export const config = { runtime: 'edge' };

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const MEMOS = 'https://memos.ahxin.cn';
const MEMOS_TOKEN = process.env.MEMOS_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET || '';
const NOTIFY_KEY = process.env.NOTIFY_KEY || '';

async function redis(commands) {
  const res = await fetch(REST_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + REST_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error('redis_http_' + res.status);
  const data = await res.json();
  return data.map((x) => (x && typeof x === 'object' && 'result' in x ? x.result : x));
}

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // 鉴权：Vercel Cron 带 Bearer CRON_SECRET；手动触发用 ?key=NOTIFY_KEY
  const url = new URL(request.url);
  const auth = request.headers.get('authorization') || '';
  const keyOk = (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) || (NOTIFY_KEY && url.searchParams.get('key') === NOTIFY_KEY);
  if (!keyOk) return json({ error: 'forbidden' }, 403);

  if (!REST_URL || !REST_TOKEN || !MEMOS_TOKEN) return json({ error: 'not_configured' }, 503);

  try {
    // 1. SCAN 出所有 like:* 键
    const keys = [];
    let cursor = '0';
    for (let i = 0; i < 200; i++) {
      const [next, batch] = await redis([['SCAN', cursor, 'MATCH', 'like:*', 'COUNT', 200]]);
      cursor = String(next || '0');
      (batch || []).forEach((k) => keys.push(k));
      if (cursor === '0') break;
    }

    // 2. 逐个 HGETALL
    let dump = {};
    let totalLikes = 0;
    if (keys.length) {
      const results = await redis(keys.map((k) => ['HGETALL', k]));
      keys.forEach((k, i) => {
        const flat = results[i] || [];
        const obj = {};
        for (let j = 0; j < flat.length; j += 2) {
          const visitor = flat[j];
          let value = flat[j + 1];
          // value 可能是纯昵称，也可能是 {"n":"昵称","u":"主页"}
          obj[visitor] = value;
          totalLikes += 1;
        }
        dump[k.replace(/^like:/, '')] = obj;
      });
    }

    const at = new Date().toISOString();
    const date = at.slice(0, 10);
    const payload = JSON.stringify({ at, likes: dump });

    // 3. 写入 Memos（私有，带 #like-backup 标签便于检索）
    const content =
      `#like-backup ${date}\n\n` +
      `点赞备份快照 · ${keys.length} 条动态 · ${totalLikes} 个赞 · ${at}\n\n` +
      '```json\n' +
      payload +
      '\n```';

    const res = await fetch(`${MEMOS}/api/memos`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + MEMOS_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ content, visibility: 'PRIVATE' }),
    });
    if (!res.ok) return json({ error: 'memos_rejected', status: res.status }, 502);

    const created = await res.json().catch(() => null);
    return json({
      ok: true,
      memos: keys.length,
      likes: totalLikes,
      bytes: payload.length,
      memo: (created && created.name) || '',
    });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 502);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
