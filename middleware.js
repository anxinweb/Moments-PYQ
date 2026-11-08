/**
 * Edge Middleware：给动态详情页注入 OG 标签（微信/群里分享出卡片）
 *
 * 详情页是前端路由（/?memo=uid），微信爬虫不执行 JS，所以必须在边缘把
 * OG 标签塞进 HTML。首页（无 memo 参数）直接放行，用 index.html 里的默认标签。
 *
 * 只改 meta，不动页面结构；Memos 拉不到（动态被删/私有）就退回默认标签。
 */

export const config = {
  matcher: ['/', '/index', '/memo/:path*'],
};

const UPSTREAM = 'https://memos.ahxin.cn';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Markdown 粗坯转纯文本（OG 描述用） */
function plain(content) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接留文字
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_~`>]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function ogBlock({ title, desc, image, url }) {
  const tags = [
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${esc(url)}">`,
  ];
  if (image) tags.push(`<meta property="og:image" content="${esc(image)}">`);
  return tags.join('\n');
}

async function fetchShell(origin) {
  // cleanUrls 下 /index.html 会 308，直接要 /index，避免多余跳转
  for (const path of ['/index', '/index.html', '/']) {
    try {
      const res = await fetch(new URL(path, origin), {
        headers: { 'x-og-shell': '1', 'accept': 'text/html' },
        redirect: 'follow',
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes('</head>')) return text;
      }
    } catch (e) {
      /* 试下一个 */
    }
  }
  return '';
}

export default async function middleware(request) {
  // 取 shell 的内部子请求直接放行，避免自己调自己无限递归
  if (request.headers.get('x-og-shell')) return;

  const url = new URL(request.url);
  // 只处理 HTML 请求（图片/接口等直接放行）
  const dest = request.headers.get('sec-fetch-dest');
  if (dest && dest !== 'document' && dest !== 'empty' && dest !== 'iframe') return;

  const m = url.pathname.match(/^\/memo\/([A-Za-z0-9_-]+)/);
  const uid = url.searchParams.get('memo') || (m ? m[1] : '');
  if (!uid || !/^[A-Za-z0-9_-]{1,64}$/.test(uid)) return; // 首页默认标签，放行

  let memo = null;
  try {
    const res = await fetch(`${UPSTREAM}/api/memos/${uid}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) memo = await res.json();
  } catch (e) {
    /* 拉不到就用默认标签 */
  }

  const shell = await fetchShell(url.origin);
  if (!shell) return;

  let block = '';
  if (memo) {
    const text = plain(memo.content);
    const firstLine = text.split(/(?<=[。！？!?])|(?<=\n)/)[0] || text;
    const title = (firstLine || '朋友圈动态').slice(0, 42) || '朋友圈动态';
    const desc = (text.slice(0, 80) || '记录生活中的每一刻') + (text.length > 80 ? '…' : '');
    const img = (memo.attachments || []).find((a) => (a.type || '').startsWith('image/'));
    let image = `${url.origin}/assets/pyqlogo.png`; // 无图动态用站点图标兜底
    if (img) {
      const id = String(img.name || '').split('/')[1] || '';
      if (id) {
        image = `${UPSTREAM}/file/attachments/${id}/${encodeURIComponent(img.filename || '')}?thumbnail=true`;
      }
    }
    const shareUrl = `${url.origin}/?memo=${uid}`;
    block = ogBlock({ title, desc, image, url: shareUrl });
  }

  // 先把 index.html 里的默认 og 标签摘掉，再插入详情页专属的
  let html = shell
    .replace(/\s*<meta property="og:(title|description|type|url|image)"[^>]*>/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, memo ? `<title>${esc(plain(memo.content).slice(0, 30) || '朋友圈')}</title>` : '$&');

  if (block) html = html.replace('</head>', `${block}\n</head>`);

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=600',
    },
  });
}
