import { CONFIG } from './config.js';
import { attachmentUrl, thumbUrl, PLACEHOLDER_AVATAR } from './api.js';

const DAY = 86400000;

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkify(html) {
  return html
    .split(/(<a\b[^>]*>[\s\S]*?<\/a>)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /(https?:\/\/[^\s<)]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
          )
    )
    .join('');
}

/**
 * Memos 的 Markdown 精简成朋友圈能接受的纯文本 + 链接 + 加粗
 * 朋友圈没有标题/标签/代码块概念，这里全部降级处理
 */
export function renderContent(raw, opts = {}) {
  const hideTags = opts.hideTags !== false;
  let t = String(raw || '');

  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/^#{1,6}\s+/gm, '');
  if (hideTags) t = t.replace(/(^|\s)#([^\s#]+)/g, '$1');
  t = t.replace(/^\s*([-—–_*]\s*){2,}$/gm, '');
  t = escapeHtml(t);
  t = t.replace(/```([\s\S]*?)```/g, (_, code) => '<code>' + code.trim() + '</code>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  t = linkify(t);
  return t.replace(/^[\s\u00a0]+/, '').replace(/[\s\u00a0]+$/, '');
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 朋友圈时间规则：刚刚 / n分钟前 / n小时前 / 昨天 / M月D日 / YYYY年M月D日 */
export function timeText(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now - d;

  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前';
  if (startOfDay(d).getTime() === startOfDay(now).getTime()) {
    return Math.floor(diff / 3600000) + '小时前';
  }

  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (dayDiff === 1) return '昨天';
  if (dayDiff === 2) return '前天';

  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

export function imagesOf(memo) {
  return (memo.attachments || [])
    .filter((a) => (a.type || '').startsWith('image/'))
    .map((a) => ({ url: attachmentUrl(a), name: a.filename }));
}

function gridHtml(images) {
  const count = images.length;
  const shown = images.slice(0, 9);
  const cells = shown
    .map((img, i) => {
      const more = i === 8 && count > 9;
      const src = thumbUrl(img.url);
      return (
        `<div class="cell${more ? ' cell-more' : ''}" data-index="${i}">` +
        `<img src="${src}" data-origin="${img.url}" alt="" loading="lazy" decoding="async">` +
        (more ? `<span>+${count - 9}</span>` : '') +
        `</div>`
      );
    })
    .join('');
  return `<div class="grid" data-count="${Math.min(count, 9)}" data-total="${count}">${cells}</div>`;
}

export function renderMoment(memo, profile) {
  const imageList = imagesOf(memo);
  const body = renderContent(memo.content, { hideTags: CONFIG.HIDE_TAGS });
  const hasText = body.trim().length > 0;
  const name = profile?.name || CONFIG.NICKNAME;
  const avatar = profile?.avatar || PLACEHOLDER_AVATAR;

  return (
    `<article class="moment" data-name="${escapeHtml(memo.name)}">` +
    `<img class="moment-avatar" src="${avatar}" alt="" loading="lazy" decoding="async">` +
    `<div class="moment-body">` +
    `<h2 class="moment-name">${escapeHtml(name)}</h2>` +
    (hasText ? `<div class="moment-text is-folded">${body}</div>` : '') +
    (imageList.length ? gridHtml(imageList) : '') +
    `<div class="meta">` +
    `<time datetime="${memo.createTime}">${timeText(memo.createTime)}</time>` +
    `<button class="more-btn" data-more="${escapeHtml(memo.name)}" aria-label="赞和评论"><i></i><i></i><i></i></button>` +
    `</div>` +
    `<div class="drawer" data-drawer="${escapeHtml(memo.name)}"></div>` +
    `</div>` +
    `</article>`
  );
}

export function skeletonHtml(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out +=
      `<div class="skeleton">` +
      `<div class="sk sk-avatar"></div>` +
      `<div>` +
      `<div class="sk sk-line" style="width:30%"></div>` +
      `<div class="sk sk-line" style="width:88%"></div>` +
      `<div class="sk sk-line" style="width:64%"></div>` +
      `<div class="sk sk-block"></div>` +
      `</div>` +
      `</div>`;
  }
  return out;
}
