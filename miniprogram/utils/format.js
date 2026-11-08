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

/** 秒 → m:ss（音频进度 / 时长） */
function clockText(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}

/** 估算正文渲染行数（以「每行可容纳的中文字数」为单位）：
 *  CJK / 全角 / emoji 约占 1 个字宽，西文与数字约占 0.5 个。
 *  用来决定是否显示「全文」，避免一串长 URL / 英文被误判成长文本而折叠。 */
function estimateLines(text, charsPerLine) {
  const per = Math.max(8, Number(charsPerLine) || 18);
  return String(text || '').split('\n').reduce(function (sum, line) {
    let width = 0;
    for (const ch of line) {
      const code = ch.codePointAt(0);
      width += code > 0x2e80 || (code >= 0xff00 && code <= 0xffef) ? 1 : 0.5;
    }
    return sum + Math.max(1, Math.ceil(width / per));
  }, 0);
}

/** 转发卡片标题：跳过空行、分割线、纯符号行，取第一条有效正文 */
function shareTitle(content, fallback) {
  const lines = String(content || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]
      .replace(/^[\s·☐☑]+/, '')
      .replace(/^─+/, '')
      .trim();
    if (t && !/^[─—\-=*_\s.。、，,]+$/.test(t)) return t.slice(0, 40);
  }
  return fallback || '';
}

/** 用户微信字体大小设置 → 缩放系数；取不到或非预期值返回 1 */
function fontScale() {
  function from(sys) {
    if (!sys) return 0;
    const f = Number(sys.fontSizeScaleFactor);
    if (f > 0.7 && f < 1.6) return f;
    const s = Number(sys.fontSizeSetting);
    if (s >= 12 && s <= 24) return s / 16;
    return 0;
  }
  let f = 0;
  try {
    if (wx.getAppBaseInfo) f = from(wx.getAppBaseInfo());
  } catch (e) { /* ignore */ }
  if (!f) {
    try { f = from(wx.getSystemInfoSync()); } catch (e) { /* ignore */ }
  }
  return f ? Math.round(f * 100) / 100 : 1;
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
  const videoItems = [];
  (memo.attachments || []).forEach(function (a) {
    const type = a.type || '';
    const url = attachmentUrl(a);
    const name = a.filename || '';
    const sizeText = bytesText(Number(a.size || 0));
    if (type.indexOf('image/') === 0) {
      images.push({ url: url, thumb: thumbUrl(url), name: name });
    } else if (type.indexOf('video/') === 0) {
      // Memos 不生成配套封面帧：同条动态有图片时用首图作 poster，否则保持原生播放按钮
      const item = { kind: 'video', url: url, name: prettyMediaName(name), sizeText: sizeText, poster: '' };
      videoItems.push(item);
      extras.push(item);
    } else if (type.indexOf('audio/') === 0) {
      extras.push({ kind: 'audio', url: url, name: name || '音频', sizeText: sizeText, poster: '' });
    } else {
      extras.push({ kind: 'file', url: url, name: name || '附件', sizeText: sizeText, poster: '' });
    }
  });
  videoItems.forEach(function (v) {
    if (images.length) v.poster = images[0].url;
  });
  return { images: images, extras: extras };
}

/** 首页与详情页共用的「原始 memo → 页面可绑定对象」，避免两处逻辑分歧。
 *  opts: { hideTags, foldable, foldLines, charsPerLine,
 *          layout: { cell3Px, cell2Px, grid2WidthPx, singleWidthPx } } */
function buildMoment(memo, opts) {
  const o = opts || {};
  const layout = o.layout || {};
  const src = memo || {};
  const content = renderContent(src.content, { hideTags: o.hideTags !== false });
  const media = mediaOf(src);
  const total = media.images.length;
  const images = media.images.slice(0, 9).map(function (img, i) {
    return {
      thumb: img.thumb,
      origin: img.url,
      more: i === 8 && total > 9,
      moreCount: total > 9 ? total - 9 : 0,
    };
  });
  const gridType = total === 1 ? 1 : (total === 2 || total === 4) ? 2 : 3;
  const lines = estimateLines(content, o.charsPerLine || 18);
  const needFold = !!o.foldable && lines > (o.foldLines || 6);
  const name = String(src.name || '');

  return {
    uid: name.split('/')[1] || name,
    content: content,
    needFold: needFold,
    // 只有真会被截断的长文本才默认折叠；短文本直接展开并可长按复制
    folded: needFold,
    timeText: timeText(src.createTime),
    images: images,
    allOrigins: media.images.map(function (img) { return img.url; }),
    gridType: gridType,
    gridStyle: gridType === 2 ? 'width:' + (layout.grid2WidthPx || '280px') : '',
    cellStyle:
      gridType === 2
        ? 'width:' + (layout.cell2Px || '140px') + ';height:' + (layout.cell2Px || '140px')
        : 'width:' + (layout.cell3Px || '90px') + ';height:' + (layout.cell3Px || '90px'),
    singleStyle: 'width:' + (layout.singleWidthPx || '200px'),
    extras: media.extras,
  };
}

module.exports = {
  parseTime: parseTime,
  timeText: timeText,
  clockText: clockText,
  estimateLines: estimateLines,
  shareTitle: shareTitle,
  fontScale: fontScale,
  renderContent: renderContent,
  mediaOf: mediaOf,
  buildMoment: buildMoment,
  bytesText: bytesText,
};
