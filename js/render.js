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

export function mediaOf(memo) {
  const atts = (memo.attachments || []).map((a) => ({
    url: attachmentUrl(a),
    name: a.filename || '',
    type: a.type || '',
    size: a.size || 0,
  }));
  return {
    images: atts.filter((a) => a.type.startsWith('image/')),
    videos: atts.filter((a) => a.type.startsWith('video/')),
    audios: atts.filter((a) => a.type.startsWith('audio/')),
    files: atts.filter((a) => !/^(image|video|audio)\//.test(a.type)),
  };
}

export function imagesOf(memo) {
  return mediaOf(memo).images.map((a) => ({ url: a.url, name: a.name }));
}

function bytesText(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function videoHtml(v) {
  return (
    `<div class="media media-video">` +
    `<video src="${v.url}" controls playsinline preload="metadata" data-media></video>` +
    `</div>`
  );
}

function audioHtml(a) {
  return (
    `<div class="media-audio" data-audio>` +
    `<button class="audio-play" type="button" aria-label="播放音频">` +
    `<svg class="ic-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10-6.8a1 1 0 0 0 0-1.8l-10-6.8A1 1 0 0 0 8 5.2z"/></svg>` +
    `<svg class="ic-pause" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/></svg>` +
    `</button>` +
    `<span class="audio-bars"><span class="audio-fill"></span></span>` +
    `<span class="audio-time">0:00</span>` +
    `<audio src="${a.url}" preload="metadata"></audio>` +
    `</div>`
  );
}

function fileHtml(f) {
  return (
    `<a class="media-file" href="${f.url}" target="_blank" rel="noopener noreferrer">` +
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/></svg>` +
    `<span class="media-file-name">${escapeHtml(f.name || '附件')}</span>` +
    (f.size ? `<span class="media-file-size">${bytesText(f.size)}</span>` : '') +
    `</a>`
  );
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
  const media = mediaOf(memo);
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
    (media.images.length ? gridHtml(media.images) : '') +
    media.videos.map(videoHtml).join('') +
    media.audios.map(audioHtml).join('') +
    media.files.map(fileHtml).join('') +
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
