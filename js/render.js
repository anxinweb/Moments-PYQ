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
 * 整行只有分隔符（- — – _ * =）时视为分割线，渲染成一条细线
 * 注意：中文破折号单用（——后面接正文）不在此列，必须是整行
 */
const DIVIDER_RE = /^[ \t]*(?:[-—–_*=][ \t]*){2,}$/;
const DIVIDER_TOKEN = '\u0001hr\u0001';

/**
 * Memos 的 Markdown 精简成朋友圈能接受的纯文本 + 链接 + 加粗
 * 朋友圈没有标题/标签/代码块概念，这里全部降级处理
 */
export function renderContent(raw, opts = {}) {
  const hideTags = opts.hideTags !== false;
  let t = String(raw || '').replace(/\r\n?/g, '\n');

  // 图片语法交给九宫格附件展示，正文里不再出现
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // 标题降级为普通文本
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  t = t.replace(/^[ \t]*#{1,6}[ \t]*$/gm, '');

  // 表格：先去掉 |---|---| 这类分隔行，再把单元格降级成空格分隔的纯文本
  t = t.replace(
    /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm,
    ''
  );
  t = t.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, inner) =>
    inner.replace(/\|/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
  );

  // 分割线：换成占位标记，等转义完成后再落成 <hr>，避免被整行删掉
  t = t
    .split('\n')
    .map((line) => (DIVIDER_RE.test(line) ? DIVIDER_TOKEN : line))
    .join('\n');

  // 任务列表 → 勾选符号
  t = t.replace(/^[ \t]*[-*+][ \t]+\[[xX]\][ \t]*/gm, '☑ ');
  t = t.replace(/^[ \t]*[-*+][ \t]+\[ \][ \t]*/gm, '☐ ');
  // 无序列表 → 圆点（保留原来的行结构）
  t = t.replace(/^[ \t]*[-*+][ \t]+/gm, '· ');
  // 引用前缀
  t = t.replace(/^[ \t]*>[ \t]?/gm, '');
  if (hideTags) t = t.replace(/(^|\s)#[^\s#]+/g, '$1');
  // 语法删除后残留的空格 / 空行 / 空列表行
  t = t.replace(/^[ \t]*·[ \t]*$/gm, '');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/[ \t]+$/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n');

  t = escapeHtml(t);
  t = t.replace(/```([\s\S]*?)```/g, (_, code) => '<code class="md-code">' + code.trim() + '</code>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  t = t.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  t = linkify(t);
  // 分割线前后的换行在 pre-wrap 里会变成空行盒，吃掉一层
  t = t
    .split('\n' + DIVIDER_TOKEN + '\n').join(DIVIDER_TOKEN)
    .split('\n' + DIVIDER_TOKEN).join(DIVIDER_TOKEN)
    .split(DIVIDER_TOKEN + '\n').join(DIVIDER_TOKEN);
  t = t.split(DIVIDER_TOKEN).join('<hr class="md-hr">');
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

/** Memos 转码视频的文件名是 video_xxx_0_2.mp4，展示时还原成原视频名 */
function prettyMediaName(name) {
  if (!name) return '';
  if (!name.startsWith('video_')) return name;
  const stripped = name.replace(/^video_/, '').replace(/_\d+_\d+(\.[a-z0-9]+)$/i, '$1');
  return stripped || name;
}

function videoHtml(v) {
  const vname = prettyMediaName(v.name);
  return (
    `<div class="media media-video">` +
    `<video src="${v.url}" controls playsinline preload="metadata" data-media></video>` +
    `<a class="media-caption" href="${v.url}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(vname)}">` +
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5.6v12.8l10-6.4z"></path></svg>` +
    `<span class="media-caption-name">${escapeHtml(vname || '视频')}</span>` +
    (v.size ? `<span class="media-caption-size">${bytesText(v.size)}</span>` : '') +
    `</a>` +
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
    `<span class="audio-main">` +
    `<span class="audio-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name || '音频')}</span>` +
    `<span class="audio-bars"><span class="audio-track"><span class="audio-fill"></span></span></span>` +
    `</span>` +
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

/** 微信「…」点开后的赞 / 评论浮层 */
function popoverHtml() {
  return (
    `<div class="popover" data-pop hidden>` +
    `<button class="pop-btn" type="button" data-act="like">` +
    `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.6 4.7 13.3a4.9 4.9 0 0 1 0-6.9 4.7 4.7 0 0 1 6.6 0l.7.8.7-.8a4.7 4.7 0 0 1 6.6 0 4.9 4.9 0 0 1 0 6.9z"/></svg>` +
    `<span class="pop-txt">赞</span></button>` +
    `<span class="pop-sep" aria-hidden="true"></span>` +
    `<button class="pop-btn" type="button" data-act="comment">` +
    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.2A3.2 3.2 0 0 1 7.2 3h9.6A3.2 3.2 0 0 1 20 6.2v6.4a3.2 3.2 0 0 1-3.2 3.2H9.9l-3.6 3.2a.7.7 0 0 1-1.2-.5z"/></svg>` +
    `评论</button>` +
    `</div>`
  );
}

export function renderMoment(memo, profile, opts = {}) {
  const media = mediaOf(memo);
  const body = renderContent(memo.content, { hideTags: CONFIG.HIDE_TAGS });
  const hasText = body.trim().length > 0;
  const name = profile?.name || CONFIG.NICKNAME;
  const avatar = profile?.avatar || PLACEHOLDER_AVATAR;
  const folded = opts.folded !== false;

  return (
    `<article class="moment" data-name="${escapeHtml(memo.name)}">` +
    `<img class="moment-avatar" src="${avatar}" data-avatar="${avatar}" alt="" decoding="async">` +
    `<div class="moment-body">` +
    `<h2 class="moment-name">${escapeHtml(name)}</h2>` +
    (hasText ? `<div class="moment-text${folded ? ' is-folded' : ''}">${body}</div>` : '') +
    (media.images.length ? gridHtml(media.images) : '') +
    media.videos.map(videoHtml).join('') +
    media.audios.map(audioHtml).join('') +
    media.files.map(fileHtml).join('') +
    `<div class="meta">` +
    `<time datetime="${memo.createTime}">${timeText(memo.createTime)}</time>` +
    `<button class="more-btn" data-more="${escapeHtml(memo.name)}" aria-label="赞和评论"><i></i><i></i></button>` +
    popoverHtml() +
    `</div>` +
    `<div class="drawer" data-drawer="${escapeHtml(memo.name)}"></div>` +
    commentInlineHtml() +
    `</div>` +
    `</article>`
  );
}

/** 评论可用表情（够日常用，点一下插到光标处） */
const EMOJIS = [
  '😀', '😄', '😂', '🤣', '😊', '🥰', '😍', '😘',
  '😜', '🤪', '🙃', '😅', '😭', '😢', '😮', '🤔',
  '😴', '😎', '🥳', '😇', '👍', '👎', '👏', '🙏',
  '💪', '🤝', '✌️', '👌', '❤️', '💔', '💯', '🔥',
  '🎉', '✨', '⭐', '🌙', '☀️', '🌈', '🍀', '🌸',
  '🍜', '🍺', '☕', '🎂', '🎵', '📷', '🚗', '🐱',
];

function emojiPanelHtml() {
  return `<div class="emoji-panel" hidden>${EMOJIS.map(
    (e) => `<button type="button" class="emoji-item">${e}</button>`
  ).join('')}</div>`;
}

/** 内联评论输入（微信同款：点「评论」后在动态下方就地展开） */
export function commentInlineHtml() {
  return (
    `<div class="comment-inline" hidden>` +
    `<div class="comment-reply-bar" hidden>` +
    `<span class="comment-reply-txt"></span>` +
    `<button class="comment-reply-x" type="button" aria-label="取消回复"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` +
    `</div>` +
    `<div class="comment-nick-row">` +
    `<span class="comment-nick-label">昵称</span>` +
    `<input class="comment-nick" placeholder="给自己起个名字" maxlength="12" autocomplete="nickname" enterkeyhint="next">` +
    `<svg class="comment-nick-pen" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>` +
    `</div>` +
    `<div class="comment-nick-row comment-link-row">` +
    `<span class="comment-nick-label">主页</span>` +
    `<input class="comment-link" type="url" inputmode="url" placeholder="选填，别人点你昵称会跳过去" maxlength="300" autocomplete="url" enterkeyhint="next">` +
    `</div>` +
    `<div class="comment-box">` +
    `<textarea class="comment-input" placeholder="评论" maxlength="500" rows="2"></textarea>` +
    `<div class="comment-tools">` +
    `<div class="comment-emos">` +
    `<button type="button" class="emoji-toggle" aria-label="表情" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/></svg></button>` +
    `</div>` +
    `<div class="comment-actions">` +
    `<button class="comment-cancel" type="button">取消</button>` +
    `<button class="comment-send" type="button" disabled>发送</button>` +
    `</div>` +
    `</div>` +
    `</div>` +
    emojiPanelHtml() +
    `</div>`
  );
}

/** 评论里的昵称：有主页链接就渲染成可点的链接 */
function whoHtml(name, url) {
  return url
    ? `<a class="who" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`
    : `<span class="who">${escapeHtml(name)}</span>`;
}

/** 评论文本：转义 + 网址自动变链接（仅 http/https，防注入） */
function commentTextHtml(text) {
  return linkify(escapeHtml(String(text || '')));
}

/** 对外：纯文本里的网址自动变可点链接（个人简介等场景复用） */
export function linkifyText(text) {
  return linkify(escapeHtml(String(text || '')));
}

function commentItemHtml(c, isReply) {
  const replyPrefix = c.replyName
    ? `<span class="reply-to">回复@${escapeHtml(c.replyName)}：</span>`
    : '';
  const badge = c.pending ? `<span class="pending-badge">审核中</span>` : '';
  return (
    `<div class="comment${c.pending ? ' is-pending' : ''}${isReply ? ' is-reply' : ''}" data-cuid="${escapeHtml(c.uid || '')}" data-cname="${escapeHtml(c.name || '')}">` +
    whoHtml(c.name, c.url) +
    replyPrefix +
    `<span class="c-text">${commentTextHtml(c.text)}</span>` +
    badge +
    (c.replies && c.replies.length
      ? `<div class="comment-replies">${c.replies.map((r) => commentItemHtml(r, true)).join('')}</div>`
      : '') +
    `</div>`
  );
}

/** 微信样式的赞/评论灰底框：♥ 昵称们 + 两级评论「昵称：内容」/「昵称 回复@某某：内容」 */
/** 评论折叠阈值：一级评论超过这个数就收起，只显示最新的几条 */
const COMMENT_FOLD = 5;

/** 微信样式的赞/评论灰底框：♥ 昵称们 + 评论列表（超过 5 条折叠） */
export function drawerHtml(likes, comments, opts = {}) {
  const hasLikes = likes && likes.count > 0;
  const list = comments || [];
  if (!hasLikes && !list.length) return '';

  // 折叠：未展开时显示最新的 COMMENT_FOLD 条（「审核中」条目无论多旧都追加显示，
  // 避免评论者自己刚发的被藏起来）；展开后显示全部 + 收起按钮
  const foldable = list.length > COMMENT_FOLD && !opts.noFold;
  let visible = list;
  let foldBtn = '';
  if (foldable && !opts.expanded) {
    const tail = list.slice(-COMMENT_FOLD);
    const seen = new Set(tail);
    const pendingExtra = list.filter((c) => c.pending && !seen.has(c));
    visible = pendingExtra.length ? tail.concat(pendingExtra) : tail;
    foldBtn = `<button class="drawer-fold" type="button">查看全部 ${list.length} 条评论 ›</button>`;
  } else if (foldable && opts.expanded) {
    foldBtn = `<button class="drawer-fold is-collapse" type="button">收起</button>`;
  }

  let out = '';
  if (hasLikes) {
    const nameHtml = (likes.names || [])
      .map((n) =>
        typeof n === 'string'
          ? escapeHtml(n) // 旧数据兼容
          : n.u
            ? `<a href="${escapeHtml(n.u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.n)}</a>`
            : escapeHtml(n.n)
      )
      .join('、');
    out +=
      `<div class="drawer-likes">` +
      `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.6 4.7 13.3a4.9 4.9 0 0 1 0-6.9 4.7 4.7 0 0 1 6.6 0l.7.8.7-.8a4.7 4.7 0 0 1 6.6 0 4.9 4.9 0 0 1 0 6.9z"/></svg>` +
      `<span class="names">${nameHtml}</span>` +
      `</div>`;
  }
  if (list.length) {
    if (hasLikes) out += `<div class="drawer-sep"></div>`;
    out +=
      `<div class="drawer-comments">` +
      visible.map((c) => commentItemHtml(c, false)).join('') +
      (foldBtn ? `<div class="drawer-fold-wrap">${foldBtn}</div>` : '') +
      `</div>`;
  }
  return out;
}

export function skeletonHtml(n) {  let out = '';
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
