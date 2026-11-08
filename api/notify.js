/**
 * POST /api/notify —— 评论内容邮件通知（Node 运行时，零依赖手写 SMTP）
 *
 * 为什么不用 Memos 自带的邮件通知：Memos 官方邮件正文只有「谁评论了 + 链接」，
 * 不含评论内容（上游设计）。这里由本站自己发一封带完整内容的邮件。
 *
 * 环境变量（Vercel → Settings → Environment Variables）：
 *   SMTP_HOST  默认 smtp.qq.com
 *   SMTP_PORT  默认 465（SSL）
 *   SMTP_USER  发信邮箱，如 ahxin188@qq.com
 *   SMTP_PASS  QQ 邮箱「授权码」（不是登录密码）
 *   NOTIFY_TO  收件邮箱，默认同 SMTP_USER
 *   NOTIFY_KEY 内部调用密钥，防止接口被当成公开发信器滥用
 */

import tls from 'node:tls';

const HOST = process.env.SMTP_HOST || 'smtp.qq.com';
const PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const TO = process.env.NOTIFY_TO || USER;
const KEY = process.env.NOTIFY_KEY || '';

const UPSTREAM = 'https://memos.ahxin.cn';
const SITE = 'https://pyq.ahxin.cn';

function plain(content) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_~`>]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function b64(s) {
  return Buffer.from(String(s), 'utf8').toString('base64');
}

/** base64 正文按 76 字符折行（RFC 2045） */
function b64Lines(text) {
  const raw = b64(text);
  const out = [];
  for (let i = 0; i < raw.length; i += 76) out.push(raw.slice(i, i + 76));
  return out;
}

/** 极简 SMTP over TLS：EHLO → AUTH LOGIN → MAIL/RCPT → DATA → QUIT */
function smtpSend({ subject, body }) {
  return new Promise((resolve, reject) => {
    if (!USER || !PASS) return reject(new Error('smtp_not_configured'));
    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST });
    let buf = '';
    let step = 0;
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      try {
        socket.end();
      } catch (e) {
        /* ignore */
      }
      err ? reject(err) : resolve();
    };

    socket.setTimeout(15000, () => finish(new Error('smtp_timeout')));
    socket.on('error', finish);

    const send = (line) => socket.write(line + '\r\n');
    const message = [
      `From: "朋友圈" <${USER}>`,
      `To: <${TO}>`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2, 8)}@pyq.ahxin.cn>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      ...b64Lines(body),
    ];

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!buf.includes('\r\n')) return;
      const lines = buf.split('\r\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.length < 3) continue;
        const code = line.slice(0, 3);
        if (line[3] === '-') continue; // 多行响应未结束
        if (code === '220' && step === 0) {
          step = 1;
          send('EHLO pyq.ahxin.cn');
        } else if (code === '250' && step === 1) {
          step = 2;
          send('AUTH LOGIN');
        } else if (code === '334' && step === 2) {
          step = 3;
          send(b64(USER));
        } else if (code === '334' && step === 3) {
          step = 4;
          send(b64(PASS));
        } else if (code === '235' && step === 4) {
          step = 5;
          send(`MAIL FROM:<${USER}>`);
        } else if (code === '250' && step === 5) {
          step = 6;
          send(`RCPT TO:<${TO}>`);
        } else if (code === '250' && step === 6) {
          step = 7;
          send('DATA');
        } else if (code === '354' && step === 7) {
          step = 8;
          socket.write(message.join('\r\n') + '\r\n.\r\n');
        } else if (code === '250' && step === 8) {
          step = 9;
          send('QUIT');
          finish(null);
        } else if (code[0] === '4' || code[0] === '5') {
          finish(new Error('smtp_' + line.slice(0, 80)));
        }
      }
    });
  });
}

async function memoExcerpt(uid) {
  if (!uid) return '';
  try {
    const res = await fetch(`${UPSTREAM}/api/memos/${uid}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return '';
    const d = await res.json();
    const t = plain(d.content);
    return t.slice(0, 90) + (t.length > 90 ? '…' : '');
  } catch (e) {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!KEY || req.headers['x-notify-key'] !== KEY) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  const name = String(body.name || '访客').slice(0, 20);
  const text = String(body.text || '').slice(0, 600);
  const replyName = String(body.replyName || '').slice(0, 20);
  const link = /^https?:\/\//i.test(String(body.url || '')) ? String(body.url).slice(0, 300) : '';
  const memoUid = String(body.memoUid || '').replace(/[^A-Za-z0-9_-]/g, '');
  const commentUid = String(body.commentUid || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!text) {
    res.status(400).json({ error: 'empty' });
    return;
  }

  const excerpt = await memoExcerpt(memoUid);
  const kind = replyName ? `回复 @${replyName}` : '新评论';
  const subject = `[朋友圈] ${name} ${kind}`;

  const lines = [
    `${name} ${kind}你的动态：`,
    '',
    `  ${text}`,
    '',
    excerpt ? `── 所在动态 ──` : '',
    excerpt ? excerpt : '',
    '',
    memoUid ? `看动态：${SITE}/?memo=${memoUid}` : `看朋友圈：${SITE}/`,
    commentUid ? `Memos 里查看该评论：${UPSTREAM}/memos/${commentUid}` : '',
    link ? `评论人主页：${link}` : '',
    '',
    '（这条通知由 pyq.ahxin.cn 自己发出；评论默认「待审」，改成公开后访客才可见）',
  ].filter((x) => x !== null && x !== undefined);

  try {
    await smtpSend({ subject, body: lines.join('\n') });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: String(err && err.message || err) });
  }
}
