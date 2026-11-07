import { CONFIG } from './config.js';
import { getProfile, getMemos, PLACEHOLDER_AVATAR } from './api.js';
import { renderMoment, imagesOf } from './render.js';

const $ = (id) => document.getElementById(id);

const el = {
  app: $('app'),
  nav: $('nav'),
  cover: $('cover'),
  coverImg: $('coverImg'),
  coverName: $('coverName'),
  coverAvatar: $('coverAvatar'),
  feed: $('feed'),
  pager: $('pager'),
  moreBtn: $('moreBtn'),
  spinner: $('spinner'),
  end: $('feedEnd'),
  retry: $('retryBtn'),
  toast: $('toast'),
  topBtn: $('topBtn'),
  navTitle: $('navTitle'),
  themeBtn: $('themeBtn'),
  postBtn: $('postBtn'),
  viewer: $('viewer'),
  viewerStage: $('viewerStage'),
  viewerImg: $('viewerImg'),
  viewerCount: $('viewerCount'),
  viewerClose: $('viewerClose'),
  viewerPrev: $('viewerPrev'),
  viewerNext: $('viewerNext'),
};

const DESKTOP_MQ = window.matchMedia('(min-width: 768px)');

const state = {
  profile: { name: CONFIG.NICKNAME, avatar: '', bio: '' },
  tokens: {},
  loadedPages: 0,
  count: 0,
  done: false,
  loading: false,
  failed: false,
  coverSet: false,
  booting: true,
};

/* --------------------------------------------------------------- 主题 */

function initTheme() {
  el.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('pyq-theme', next);
    } catch (e) {
      /* ignore */
    }
    const color = next === 'dark' ? '#191919' : '#ffffff';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
  });
}

/* --------------------------------------------------------------- Toast */

let toastTimer = 0;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-show'), 2000);
}

/* --------------------------------------------------------------- 资料与封面 */

function applyProfile(profile) {
  state.profile = profile;
  const avatar = profile.avatar || PLACEHOLDER_AVATAR;

  el.coverName.textContent = profile.name;
  el.coverAvatar.src = avatar;
  el.coverAvatar.addEventListener(
    'error',
    () => {
      el.coverAvatar.src = PLACEHOLDER_AVATAR;
    },
    { once: true }
  );
  el.postBtn.href = CONFIG.POST_URL;
  document.title = CONFIG.SITE_TITLE;

  // 刷新 ?page=n 时信息流走 CDN 缓存会比资料先到，那时头像渲染成占位图，
  // 资料回来后统一回填一次，避免前面几条的头像一直是灰块
  document.querySelectorAll('.moment-avatar').forEach((img) => {
    if (img.dataset.avatar === avatar) return;
    img.dataset.avatar = avatar;
    img.src = avatar;
  });
}

function setCover(url) {
  if (state.coverSet || !url) return;
  state.coverSet = true;
  el.coverImg.addEventListener(
    'load',
    () => el.coverImg.classList.add('is-ready'),
    { once: true }
  );
  el.coverImg.src = url;
}

function applyCoverPosition() {
  const pos = DESKTOP_MQ.matches ? CONFIG.COVER.DESKTOP_POS : CONFIG.COVER.MOBILE_POS;
  el.coverImg.style.objectPosition = pos;
}

function initCover() {
  // 封面头像先放占位图，等资料回来再换，避免刷新时出现破图
  el.coverAvatar.src = PLACEHOLDER_AVATAR;
  if (CONFIG.COVER.MODE === 'none') {
    el.coverImg.remove();
    return;
  }
  applyCoverPosition();
  DESKTOP_MQ.addEventListener('change', applyCoverPosition);
  if (CONFIG.COVER.MODE === 'fixed' && CONFIG.COVER.URL) {
    setCover(CONFIG.COVER.URL);
  }
  // memo 模式在第一页数据到达后由 pickCover 兜底
}

function pickCoverFromMemos(memos) {
  if (state.coverSet || CONFIG.COVER.MODE !== 'memo') return;
  const first = memos.map((m) => imagesOf(m)[0]).find(Boolean);
  if (first) setCover(first.url);
}

/* --------------------------------------------------------------- 渲染 */

function hydrateImages(root) {
  root.querySelectorAll('img').forEach((img) => {
    const done = () => img.classList.add('is-ready');
    if (img.complete && img.naturalWidth > 0) done();
    else img.addEventListener('load', done);

    img.addEventListener('error', () => {
      // 头像挂了就退回占位图，避免留下破图
      if (img.classList.contains('moment-avatar')) {
        if (!img.dataset.avatarFallback) {
          img.dataset.avatarFallback = '1';
          img.src = PLACEHOLDER_AVATAR;
        }
        return;
      }
      // 缩略图失败（老附件可能没有缩略图）→ 回退原图，只回退一次
      const origin = img.dataset.origin;
      if (origin && !img.dataset.fallbackUsed && !img.src.endsWith(origin)) {
        img.dataset.fallbackUsed = '1';
        img.src = origin;
        return;
      }
      img.style.opacity = '1';
      img.classList.add('is-ready');
    });
  });
}

function setupFolding(root) {
  root.querySelectorAll('.moment-text.is-folded').forEach((p) => {
    if (p.scrollHeight - p.clientHeight <= 4) {
      p.classList.remove('is-folded');
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'fold-btn';
    btn.type = 'button';
    btn.textContent = '全文';
    btn.addEventListener('click', () => {
      const folded = p.classList.toggle('is-folded');
      btn.textContent = folded ? '全文' : '收起';
    });
    p.after(btn);
  });
}

const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};

/** 音频卡片：播放/暂停、进度、时长，同一时间只播一条 */
function bindAudio(card) {
  const audio = card.querySelector('audio');
  const btn = card.querySelector('.audio-play');
  const fill = card.querySelector('.audio-fill');
  const bars = card.querySelector('.audio-bars');
  const label = card.querySelector('.audio-time');
  if (!audio || !btn) return;

  // 点进度条跳转播放位置
  if (bars) {
    bars.addEventListener('click', (e) => {
      if (!isFinite(audio.duration) || audio.duration <= 0) return;
      const r = bars.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      audio.currentTime = ratio * audio.duration;
      if (audio.paused) audio.play().catch(() => {});
    });
  }

  const paint = () => {
    const dur = isFinite(audio.duration) ? audio.duration : 0;
    const cur = audio.currentTime || 0;
    fill.style.width = dur ? (cur / dur) * 100 + '%' : '0%';
    label.textContent = cur > 0.2 ? `${fmtTime(cur)} / ${fmtTime(dur)}` : fmtTime(dur);
  };

  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('play', () => {
    card.classList.add('is-playing');
    paint();
  });
  audio.addEventListener('pause', () => {
    card.classList.remove('is-playing');
    paint();
  });
  audio.addEventListener('ended', () => {
    card.classList.remove('is-playing');
    fill.style.width = '0%';
    paint();
  });

  btn.addEventListener('click', () => {
    if (audio.paused) {
      document.querySelectorAll('.media-audio audio').forEach((a) => {
        if (a !== audio) a.pause();
      });
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  });
}

function bindMoment(node) {
  node.querySelectorAll('.cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const grid = cell.closest('.grid');
      const list = Array.from(grid.querySelectorAll('img')).map((i) => ({
        thumb: i.currentSrc || i.src,
        origin: i.dataset.origin || i.src,
      }));
      openViewer(list, Number(cell.dataset.index) || 0, cell);
    });
  });

  // 「…」→ 赞 / 评论浮层（同微信：点空白处或滚动即收起）
  const moreBtn = node.querySelector('.more-btn');
  const pop = node.querySelector('.popover');
  if (moreBtn && pop) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      closePopover();
      if (!willOpen) return;
      pop.hidden = false;
      openPopover = pop;
    });
    pop.addEventListener('click', (e) => {
      const btn = e.target.closest('.pop-btn');
      if (!btn) return;
      const act = btn.dataset.act;
      closePopover();
      toast(act === 'like' ? '点赞功能正在接入，马上就能用了' : '评论功能正在接入，马上就能用了');
    });
  }

  node.querySelectorAll('.media-audio').forEach(bindAudio);
}

/* --------------------------------------------------------------- 赞/评论浮层 */

let openPopover = null;

function closePopover() {
  if (!openPopover) return;
  openPopover.hidden = true;
  openPopover = null;
}

/* --------------------------------------------------------------- 分页加载 */

/** 首屏请求预热占位：boot 时发起，loadOnePage 直接复用 */
let firstPageTask = null;

/** 下一页预取：当前页渲染完就提前拉下一页，点「加载更多」几乎无等待 */
let nextPageTask = null;

function pageFromUrl() {
  const n = parseInt(new URLSearchParams(location.search).get('page') || '1', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : 1;
}

function syncUrl() {
  // 启动阶段（?page=n 逐页补拉）先不改地址栏，避免刷新时 URL 在 1/2/3 之间抖动
  if (state.booting) return;
  const next =
    state.loadedPages > 1
      ? `${location.pathname}?page=${state.loadedPages}`
      : location.pathname;
  if (location.pathname + location.search !== next) history.replaceState(null, '', next);
}

function updatePager() {
  el.moreBtn.hidden = state.done || state.failed || state.loading;
  el.retry.hidden = !state.failed;
  el.end.hidden = !(state.done && state.count > 0 && !state.failed);
}

function appendMoments(memos) {
  const frag = document.createElement('div');
  frag.innerHTML = memos.map((m) => renderMoment(m, state.profile)).join('');
  Array.from(frag.children).forEach((n) => {
    el.feed.appendChild(n);
    hydrateImages(n);
    setupFolding(n);
    bindMoment(n);
  });
  state.count += memos.length;
}

async function loadOnePage() {
  if (state.loading || state.done) return;
  state.loading = true;
  state.failed = false;
  el.moreBtn.disabled = true;
  el.spinner.hidden = false;
  el.retry.hidden = true;
  updatePager();

  try {
    const token = state.tokens[state.loadedPages] || '';
    // 首屏与下一页都可能已提前发起，直接复用，点击即可秒出
    let req;
    if (firstPageTask) {
      req = firstPageTask;
      firstPageTask = null;
    } else if (nextPageTask && nextPageTask.page === state.loadedPages) {
      req = nextPageTask.promise;
      nextPageTask = null;
    } else {
      req = getMemos({ pageToken: token });
    }
    const { memos, nextPageToken } = await req;

    if (!memos.length && state.loadedPages === 0) {
      el.feed.innerHTML = '<p class="empty">还没有内容，去 Memos 写一条吧</p>';
      state.done = true;
      return;
    }

    // 首页数据到达后移除骨架占位
    if (state.loadedPages === 0) el.feed.innerHTML = '';
    appendMoments(memos);
    state.loadedPages += 1;
    state.tokens[state.loadedPages] = nextPageToken;
    if (!nextPageToken) state.done = true;
    syncUrl();

    if (state.loadedPages === 1) pickCoverFromMemos(memos);

    // 后台预取下一页（只提前一页，避免浪费流量）
    if (nextPageToken) {
      nextPageTask = {
        page: state.loadedPages,
        promise: getMemos({ pageToken: nextPageToken }),
      };
      nextPageTask.promise.catch(() => {
        nextPageTask = null;
      });
    }
  } catch (err) {
    console.error('[feed]', err);
    state.failed = true;
    if (!state.count) el.feed.innerHTML = '';
  } finally {
    state.loading = false;
    el.spinner.hidden = true;
    el.moreBtn.disabled = false;
    updatePager();
  }
}

/** 到达第 target 页：前进就补拉，后退就裁剪 */
async function gotoPage(target) {
  while (state.loadedPages < target && !state.done) {
    const before = state.loadedPages;
    await loadOnePage();
    if (state.loadedPages === before) break; // 出错防死循环
  }
  if (target < state.loadedPages) trimToPage(target);
}

function trimToPage(page) {
  const keep = page * CONFIG.PAGE_SIZE;
  const moments = Array.from(el.feed.querySelectorAll('.moment'));
  moments.slice(keep).forEach((n) => n.remove());
  state.count = Math.min(state.count, keep);
  state.loadedPages = page;
  state.done = !state.tokens[page];
  syncUrl();
  updatePager();
}

/* --------------------------------------------------------------- 大图查看 */

const viewer = {
  list: [],
  index: 0,
  open: false,
  scale: 1,
  panX: 0,
  panY: 0,
  token: 0,
  fromEl: null,
  switching: false,
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 2.6;
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

let tapAt = 0;
let tapTimer = 0;
let lastReset = 0; // 轻点/双击还原缩放的时刻，其后一瞬间内的轻点不再参与判定
let lastGestureAt = 0; // 手势刚结束，避免拖动后被当成点击背景而关闭

// 原图预加载缓存：url -> HTMLImageElement（浏览器 HTTP 缓存之外再保一层，切图零等待）
const originCache = new Map();

function preloadOrigin(url) {
  if (!url) return null;
  let img = originCache.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = url;
    originCache.set(url, img);
  }
  return img;
}

/** 预取前后各两张，滑动时基本都是秒出 */
function preloadAround() {
  const total = viewer.list.length;
  if (total < 2) return;
  [1, -1, 2, -2].forEach((d) => {
    const i = viewer.index + d;
    if (i < 0 || i >= total) return;
    const item = viewer.list[i];
    if (item) preloadOrigin(item.origin);
  });
}

function openViewer(list, index, fromEl) {
  if (!list.length) return;
  viewer.list = list;
  viewer.index = index;
  viewer.open = true;
  viewer.scale = 1;
  viewer.panX = 0;
  viewer.panY = 0;
  viewer.switching = false;
  viewer.fromEl = fromEl || null;
  el.viewer.classList.add('is-open');
  el.viewer.classList.remove('is-closing');
  el.viewer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  paintViewer();
  // 从缩略图位置放大展开（微信的打开动效）
  const cell = viewer.fromEl;
  if (!cell || !cell.isConnected || REDUCE_MOTION.matches) return;
  const from = cell.getBoundingClientRect();
  if (!from.width) return;
  requestAnimationFrame(() => {
    if (!viewer.open) return;
    const to = el.viewerImg.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = Math.min(1.3, from.width / to.width);
    el.viewerImg.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.45 },
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ],
      { duration: 280, easing: 'cubic-bezier(.22,.72,.24,1)' }
    );
  });
}

function paintViewer(dir = 0) {
  const total = viewer.list.length;
  const item = viewer.list[viewer.index];
  if (!item) return;

  viewer.token += 1;
  const token = viewer.token;

  // 先用已缓存的缩略图立即上屏，切换不会有空白等待
  el.viewerImg.classList.remove('is-panning');
  el.viewerImg.src = item.thumb || item.origin;
  el.viewerCount.textContent = total > 1 ? `${viewer.index + 1} / ${total}` : '';
  applyArrowState();
  applyViewerTransform();

  // 新图从手指滑动的方向滑入
  if (dir && !REDUCE_MOTION.matches) {
    el.viewerImg.animate(
      [
        { transform: `translateX(${dir > 0 ? 52 : -52}px)`, opacity: 0.35 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      { duration: 210, easing: 'cubic-bezier(.26,.8,.3,1)' }
    );
  }

  // 原图解码完成后无缝替换为高清版本
  const pre = preloadOrigin(item.origin);
  const swap = () => {
    if (token !== viewer.token || !viewer.open) return;
    el.viewerImg.src = item.origin;
  };
  if (pre.complete && pre.naturalWidth > 0) swap();
  else pre.addEventListener('load', swap, { once: true });

  preloadAround();
}

/** 箭头：第一张没有上一张、最后一张没有下一张（同微信，不循环） */
function applyArrowState() {
  const total = viewer.list.length;
  el.viewerPrev.hidden = total < 2;
  el.viewerNext.hidden = total < 2;
  el.viewerPrev.classList.toggle('is-off', viewer.index <= 0);
  el.viewerNext.classList.toggle('is-off', viewer.index >= total - 1);
}

function applyViewerTransform() {
  const zoomed = viewer.scale > 1.01;
  el.viewer.classList.toggle('is-zoom', zoomed);
  el.viewerImg.classList.toggle('is-zoom', zoomed);
  const shifted = viewer.panX !== 0 || viewer.panY !== 0 || zoomed;
  el.viewerImg.style.transform = shifted
    ? `translate3d(${viewer.panX}px, ${viewer.panY}px, 0) scale(${viewer.scale})`
    : '';
}

/** 限制拖动范围，返回被裁掉的溢出量（用于「拖到边界继续拖 = 切图」） */
function clampPan() {
  if (viewer.scale <= 1.01) {
    viewer.panX = 0;
    viewer.panY = 0;
    return { x: 0, y: 0 };
  }
  const maxX = Math.max(0, (el.viewerImg.clientWidth * viewer.scale - el.viewerStage.clientWidth) / 2);
  const maxY = Math.max(0, (el.viewerImg.clientHeight * viewer.scale - el.viewerStage.clientHeight) / 2);
  const rawX = viewer.panX;
  const rawY = viewer.panY;
  viewer.panX = Math.min(maxX, Math.max(-maxX, viewer.panX));
  viewer.panY = Math.min(maxY, Math.max(-maxY, viewer.panY));
  return { x: rawX - viewer.panX, y: rawY - viewer.panY };
}

/** 以某个屏幕点为中心缩放；不传坐标就围绕图片中心 */
function zoomTo(target, clientX, clientY) {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, target));
  if (next <= 1.01) {
    viewer.scale = 1;
    viewer.panX = 0;
    viewer.panY = 0;
    applyViewerTransform();
    return;
  }

  const rect = el.viewerImg.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const px = clientX === undefined ? cx : clientX;
  const py = clientY === undefined ? cy : clientY;
  const ratio = next / viewer.scale;

  // 让点击位置在缩放前后保持不动
  viewer.panX = viewer.panX * ratio - (px - cx) * (ratio - 1);
  viewer.panY = viewer.panY * ratio - (py - cy) * (ratio - 1);
  viewer.scale = next;
  clampPan();
  applyViewerTransform();
}

function stepViewer(delta) {
  if (!viewer.open) return;
  const total = viewer.list.length;
  const next = viewer.index + delta;
  if (total < 2 || next < 0 || next >= total) return;
  viewer.index = next;
  viewer.scale = 1;
  viewer.panX = 0;
  viewer.panY = 0;
  el.viewer.style.background = '';
  paintViewer(delta);
}

/** 划到边界：图片滑出去，再从另一侧滑入新图（两段拼接，接近微信手感） */
function slideTo(dir) {
  if (viewer.switching) return;
  const total = viewer.list.length;
  const next = viewer.index + dir;
  if (next < 0 || next >= total) {
    // 端点：回弹
    viewer.panX = 0;
    el.viewerImg.classList.remove('is-panning');
    applyViewerTransform();
    return;
  }
  viewer.switching = true;
  const w = el.viewerStage.clientWidth;
  const from = viewer.panX;
  el.viewerImg.classList.remove('is-panning');
  const anim = el.viewerImg.animate(
    [
      { transform: `translate3d(${from}px, 0, 0)` },
      { transform: `translate3d(${dir > 0 ? -w : w}px, 0, 0)`, opacity: 0.4 },
    ],
    { duration: 165, easing: 'cubic-bezier(.4,0,.6,1)' }
  );
  const done = () => {
    viewer.switching = false;
    stepViewer(dir);
  };
  anim.finished.then(done, done);
}

function teardownViewer() {
  viewer.open = false;
  viewer.token += 1; // 取消尚未完成的原图替换
  viewer.switching = false;
  viewer.fromEl = null;
  clearTimeout(tapTimer);
  el.viewer.classList.remove('is-open', 'is-zoom', 'is-closing');
  el.viewer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  el.viewer.style.background = '';
  el.viewerImg.style.transform = '';
  el.viewerImg.removeAttribute('src');
}

function closeViewer() {
  if (!viewer.open) return;
  // 先冻结状态，后续手势/延时都不再生效
  viewer.open = false;
  viewer.token += 1;
  clearTimeout(tapTimer);

  const cell = viewer.fromEl;
  const rect = cell && cell.isConnected ? cell.getBoundingClientRect() : null;
  const box = el.viewerImg.getBoundingClientRect();
  const canFlip = rect && rect.width > 2 && box.width > 0 && viewer.scale <= 1.01 && !REDUCE_MOTION.matches;
  if (!canFlip) {
    teardownViewer();
    return;
  }

  // 收回缩略图原位
  const dx = rect.left + rect.width / 2 - (box.left + box.width / 2);
  const dy = rect.top + rect.height / 2 - (box.top + box.height / 2);
  const s = Math.min(1.3, rect.width / box.width);
  el.viewer.classList.add('is-closing');
  const anim = el.viewerImg.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.25 },
    ],
    { duration: 220, easing: 'cubic-bezier(.4,0,.7,1)' }
  );
  const done = () => teardownViewer();
  anim.finished.then(done, done);
}


function initViewer() {
  el.viewerClose.addEventListener('click', closeViewer);
  el.viewerPrev.addEventListener('click', () => stepViewer(-1));
  el.viewerNext.addEventListener('click', () => stepViewer(1));
  el.viewerStage.addEventListener('click', (e) => {
    if (e.target !== el.viewerStage) return;
    // 刚拖完图松手，别把这次点击当成「点背景关闭」
    if (performance.now() - lastGestureAt < 320) return;
    closeViewer();
  });

  const pointers = new Map();
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let moved = false;
  let edgeX = 0;
  let pinched = false;
  let pinchDist = 0;
  let pinchScale = 1;
  let pinchMidX = 0;
  let pinchMidY = 0;
  let pinchPanX = 0;
  let pinchPanY = 0;

  const at = (e) => ({ x: e.clientX, y: e.clientY });
  const all = () => Array.from(pointers.values());

  el.viewerStage.addEventListener('pointerdown', (e) => {
    if (!viewer.open || viewer.switching) return;
    // 箭头/关闭按钮不参与手势，否则会影响点击
    if (e.target.closest('.viewer-arrow') || e.target.closest('.viewer-close')) return;

    pointers.set(e.pointerId, at(e));
    moved = false;
    edgeX = 0;

    if (pointers.size === 1) {
      downX = e.clientX;
      downY = e.clientY;
      downAt = performance.now();
    } else if (pointers.size === 2) {
      const [a, b] = all();
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchScale = viewer.scale;
      pinchMidX = (a.x + b.x) / 2;
      pinchMidY = (a.y + b.y) / 2;
      pinchPanX = viewer.panX;
      pinchPanY = viewer.panY;
      moved = true;
      pinched = true; // 本次手势是捏合：抬手时不能被当成轻点还原
      clearTimeout(tapTimer);
    }
  });

  el.viewerStage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, at(e));

    // 双指捏合缩放
    if (pointers.size >= 2) {
      const [a, b] = all();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        viewer.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchScale * (d / pinchDist)));
        viewer.panX = pinchPanX + (mx - pinchMidX);
        viewer.panY = pinchPanY + (my - pinchMidY);
        clampPan();
        el.viewerImg.classList.add('is-panning');
        applyViewerTransform();
      }
      return;
    }

    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;

    if (viewer.scale > 1.01) {
      // 放大态：单指拖动，拖到边界继续拖会攒溢出量，松手即切图（同微信）
      viewer.panX += e.clientX - prev.x;
      viewer.panY += e.clientY - prev.y;
      const over = clampPan();
      if (over.x) edgeX = over.x;
      el.viewerImg.classList.add('is-panning');
      applyViewerTransform();
      return;
    }

    // 未放大：横向拖动跟手（切图），纵向下拉跟手（关闭），同微信
    if (Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
      const edge = viewer.list.length < 2 || (dx > 0 && viewer.index === 0) || (dx < 0 && viewer.index === viewer.list.length - 1);
      viewer.panX = edge ? dx * 0.22 : dx * 0.92;
      el.viewerImg.classList.add('is-panning');
      applyViewerTransform();
      return;
    }
    if (dy > 4 && Math.abs(dy) > Math.abs(dx)) {
      viewer.panY = Math.min(dy * 0.92, 280);
      el.viewerImg.classList.add('is-panning');
      applyViewerTransform();
      el.viewer.style.background = `rgba(0, 0, 0, ${Math.max(0.25, 1 - viewer.panY / 460)})`;
    }
  });

  el.viewerStage.addEventListener('pointerup', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    el.viewerImg.classList.remove('is-panning');

    // 双指松开一指：用剩下那根手指重建基准，避免画面跳动
    if (pointers.size === 1) {
      const [p] = all();
      downX = p.x;
      downY = p.y;
      downAt = performance.now();
      moved = false;
      return;
    }
    if (pointers.size > 0) return;

    // 刚做完捏合缩放：这次抬手一律不做轻点判定，否则手指一松就回缩
    const wasPinch = pinched;
    pinched = false;

    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    const quick = performance.now() - downAt < 320;
    const isTap = !moved && Math.abs(dx) < 12 && Math.abs(dy) < 12;

    // 双指缩放到 1 附近时归位
    if (viewer.scale < 1.05 && viewer.scale !== 1) {
      viewer.scale = 1;
      viewer.panX = 0;
      viewer.panY = 0;
      applyViewerTransform();
    }

    // 放大状态：拖到边界继续拖 → 切图（同微信）；轻点/双击还原原始大小
    if (viewer.scale > 1.01) {
      if (Math.abs(edgeX) > 70 && Math.abs(edgeX) > Math.abs(dy)) {
        const dir = edgeX > 0 ? -1 : 1;
        edgeX = 0;
        stepViewer(dir);
        return;
      }
      edgeX = 0;
      // 触屏：轻点还原原始大小（双击放小的第一下）；桌面端交给 dblclick 切换
      if (!wasPinch && isTap && quick && e.pointerType === 'touch') {
        lastReset = performance.now();
        tapAt = 0;
        clearTimeout(tapTimer);
        zoomTo(1);
      }
      return;
    }

    lastGestureAt = performance.now();

    // 未放大时下拉超过阈值 → 关闭（同微信）
    if (viewer.panY > 110) {
      closeViewer();
      return;
    }

    // 横向拖动过阈值 → 切图（第一张/最后一张回弹，与微信一致不循环）
    if (!isTap && Math.abs(viewer.panX) > 62 && Math.abs(viewer.panX) > Math.abs(dy)) {
      slideTo(viewer.panX < 0 ? 1 : -1);
      return;
    }

    // 其余拖动：回弹到原位
    if (viewer.panY || viewer.panX) {
      viewer.panY = 0;
      viewer.panX = 0;
      el.viewer.style.background = '';
      applyViewerTransform();
    }
    if (!isTap) return;

    // 捏合结束后手指离开不算轻点，别把刚放大的图关掉
    if (wasPinch) return;

    // 鼠标端交给 dblclick 处理（单击不关闭，对齐微信 PC 版）
    if (e.pointerType !== 'touch') return;

    // 轻点：双击（两次 300ms 内）放大，单击延时关闭，避免双击被单击抢掉
    const now = performance.now();
    // 刚还原过缩放：紧接着的那次轻点（双击放小的第二下）不再触发放大或关闭
    if (now - lastReset < 400) return;
    if (tapAt && now - tapAt < 300) {
      tapAt = 0;
      clearTimeout(tapTimer);
      zoomTo(ZOOM_STEP, e.clientX, e.clientY);
      return;
    }
    tapAt = now;
    tapTimer = setTimeout(() => {
      if (viewer.open) closeViewer();
    }, 300);
  });

  // 鼠标双击：放大 / 还原
  el.viewerImg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (viewer.scale > 1.01) zoomTo(1);
    else zoomTo(ZOOM_STEP, e.clientX, e.clientY);
  });

  // 桌面滚轮缩放（微信 PC 版同样支持）
  el.viewerStage.addEventListener(
    'wheel',
    (e) => {
      if (!viewer.open) return;
      e.preventDefault();
      if (viewer.scale <= 1.01 && e.deltaY > 0) return;
      const next = viewer.scale * (e.deltaY < 0 ? 1.14 : 1 / 1.14);
      zoomTo(next, e.clientX, e.clientY);
    },
    { passive: false }
  );

  el.viewerStage.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    el.viewerImg.classList.remove('is-panning');
  });

  document.addEventListener('keydown', (e) => {
    if (!viewer.open) return;
    if (e.key === 'Escape') {
      if (viewer.scale > 1.01) zoomTo(1);
      else closeViewer();
    }
    if (e.key === 'ArrowLeft') stepViewer(-1);
    if (e.key === 'ArrowRight') stepViewer(1);
  });
}

/* --------------------------------------------------------------- 滚动 */

let ticking = false;

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const y = window.scrollY || 0;
    const coverH = el.coverImg ? el.cover.offsetHeight : 0;
    el.nav.classList.toggle('is-solid', y > coverH - 44);
    el.topBtn.classList.toggle('is-show', y > 1200);
  });
}

function initScroll() {
  window.addEventListener('scroll', onScroll, { passive: true });
  el.topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  // 点标题回主页顶部（同微信状态栏点一下回顶），保留 ctrl/⌘ 点击开新标签
  el.navTitle.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  onScroll();
}

/* --------------------------------------------------------------- 启动 */

async function boot() {
  initTheme();
  initScroll();
  initViewer();
  initCover();
  el.retry.addEventListener('click', () => gotoPage(Math.max(1, state.loadedPages + 1)));
  el.moreBtn.addEventListener('click', () => loadOnePage());
  window.addEventListener('popstate', () => gotoPage(pageFromUrl()));

  // 赞/评论浮层：点空白处、滚动页面、按 Esc 都收起（同微信）
  document.addEventListener('click', closePopover);
  window.addEventListener('scroll', closePopover, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });

  // 资料与首屏动态并行请求（原先串行，白白多等一个来回）
  const profileTask = getProfile()
    .then(applyProfile)
    .catch(() => applyProfile({ name: CONFIG.NICKNAME, avatar: '', bio: '' }));

  firstPageTask = getMemos({ pageToken: '' });

  await Promise.all([profileTask, gotoPage(pageFromUrl())]);

  state.booting = false;
  syncUrl();
  onScroll();
}

boot();
