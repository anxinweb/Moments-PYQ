/**
 * 朋友圈小程序 · 内容格式化
 * 从网页版 js/render.js 移植，但输出「纯文本」而不是 HTML：
 * 小程序 WXML 不能渲染 HTML，且本版本不提供任何可点链接入口。
 */
const { CONFIG } = require('./config.js');

const DAY = 86400000;
const DIVIDER_RE = /^[ \t]*(?:[-—–_*=][ \t]*){2,}$/;
const HR_LINE = '────────────';

/** Memos 的 RFC3339 时间（可能带纳秒与偏移）在 iOS 上 Date.parse 不稳，自己解析 */
function parseTime(iso) {
  if (!iso) return 0;
  const m = String(iso).match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (!m) {
    const t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }
  let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const tz = m[7];
  if (tz && tz !== 'Z') {
    const clean = tz.replace(':', '');
    const sign = clean.charAt(0) === '+' ? 1 : -1;
    const offset = +clean.slice(1, 3) * 60 + +clean.slice(3, 5);
    ms -= sign * offset * 60000;
  }
  return ms;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 微信朋友圈时间：刚刚 / n分钟前 / n小时前 / 昨天 / 前天 / M月D日 / YYYY年M月D日 */
function timeText(iso) {
  const d = parseTime(iso);
  if (!d) return '';
  const now = Date.now();
  const diff = now - d;

  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前';

  const sd = startOfDay(d);
  const sn = startOfDay(now);
  if (sd === sn) return Math.floor(diff / 3600000) + '小时前';

  const dayDiff = Math.round((sn - sd) / DAY);
  if (dayDiff === 1) return '昨天';
  if (dayDiff === 2) return '前天';

  const dt = new Date(d);
  const md = dt.getMonth() + 1 + '月' + dt.getDate() + '日';
  return dt.getFullYear() === new Date(now).getFullYear()
    ? md
    : dt.getFullYear() + '年' + md;
}

/** Markdown 精简为朋友圈可接受的纯文本：无标题、无标签、无可点链接、无代码块样式 */
function renderContent(raw, opts) {
  const hideTags = !opts || opts.hideTags !== false;
  let t = String(raw || '').replace(/\r\n?/g, '\n');

  // 图片语法交给九宫格附件展示，正文里不再出现
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // 标题降级为普通文本
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  t = t.replace(/^[ \t]*#{1,6}[ \t]*$/gm, '');

  // 表格：去掉分隔行，单元格降级成空格分隔的纯文本
  t = t.replace(
    /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm,
    ''
  );
  t = t.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, function (_, inner) {
    return inner.replace(/\|/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  });

  // 整行分隔符 → 一条文本细线
  t = t
    .split('\n')
    .map(function (line) {
      return DIVIDER_RE.test(line) ? HR_LINE : line;
    })
    .join('\n');

  // 任务列表 / 无序列表 / 引用
  t = t.replace(/^[ \t]*[-*+][ \t]+\[[xX]\][ \t]*/gm, '☑ ');
  t = t.replace(/^[ \t]*[-*+][ \t]+\[ \][ \t]*/gm, '☐ ');
  t = t.replace(/^[ \t]*[-*+][ \t]+/gm, '· ');
  t = t.replace(/^[ \t]*>[ \t]?/gm, '');

  if (hideTags) t = t.replace(/(^|\s)#[^\s#]+/g, '$1');

  t = t.replace(/^[ \t]*·[ \t]*$/gm, '');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/[ \t]+$/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n');

  // 行内标记一律降级为文字（不做成可点入口）
  t = t.replace(/```([\s\S]*?)```/g, function (_, code) {
    return code.trim();
  });
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/~~([^~]+)~~/g, '$1');
  // [文字](链接) 只保留文字；裸 URL 原样作为文本展示，不可点
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1');

  return t.replace(/^[\s\u00a0]+/, '').replace(/[\s\u00a0]+$/, '');
}

/** Memos 附件原图：memos.ahxin.cn/file/attachments/<id>/<filename> */
function attachmentUrl(att) {
  const parts = String(att.name || '').split('/');
  const id = parts.length > 1 ? parts[1] : parts[0];
  const file = encodeURIComponent(att.filename || '');
  return CONFIG.MEMOS_URL + '/file/attachments/' + id + '/' + file;
}

/** Memos 原生缩略图：列表用，点开预览才加载原图 */
function thumbUrl(url) {
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'thumbnail=true';
}

function bytesText(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** Memos 转码视频名 video_xxx_0_2.mp4 → 还原成原视频名 */
function prettyMediaName(name) {
  if (!name || name.indexOf('video_') !== 0) return name || '视频';
  const stripped = name.replace(/^video_/, '').replace(/_\d+_\d+(\.[a-z0-9]+)$/i, '$1');
  return stripped || name;
}

/** 拆成九宫格图片 + 其它媒体（视频/音频/附件） */
function mediaOf(memo) {
  const images = [];
  const extras = [];
  (memo.attachments || []).forEach(function (a) {
    const type = a.type || '';
    const url = attachmentUrl(a);
    const name = a.filename || '';
    const sizeText = bytesText(Number(a.size || 0));
    if (type.indexOf('image/') === 0) {
      images.push({ url: url, thumb: thumbUrl(url), name: name });
    } else if (type.indexOf('video/') === 0) {
      extras.push({ kind: 'video', url: url, name: prettyMediaName(name), sizeText: sizeText });
    } else if (type.indexOf('audio/') === 0) {
      extras.push({ kind: 'audio', url: url, name: name || '音频', sizeText: sizeText });
    } else {
      extras.push({ kind: 'file', url: url, name: name || '附件', sizeText: sizeText });
    }
  });
  return { images: images, extras: extras };
}

module.exports = {
  parseTime: parseTime,
  timeText: timeText,
  renderContent: renderContent,
  mediaOf: mediaOf,
  bytesText: bytesText,
};
