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
  el.coverName.textContent = profile.name;
  el.coverAvatar.src = profile.avatar || PLACEHOLDER_AVATAR;
  el.coverAvatar.addEventListener(
    'error',
    () => {
      el.coverAvatar.src = PLACEHOLDER_AVATAR;
    },
    { once: true }
  );
  el.postBtn.href = CONFIG.POST_URL;
  document.title = CONFIG.SITE_TITLE;
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

function bindMoment(node) {
  node.querySelectorAll('.cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const grid = cell.closest('.grid');
      const list = Array.from(grid.querySelectorAll('img')).map((i) => ({
        thumb: i.currentSrc || i.src,
        origin: i.dataset.origin || i.src,
      }));
      openViewer(list, Number(cell.dataset.index) || 0);
    });
  });
  const moreBtn = node.querySelector('.more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      toast('点赞与评论将在下一步接入');
    });
  }
}

/* --------------------------------------------------------------- 分页加载 */

/** 首屏请求预热占位：boot 时发起，loadOnePage 直接复用 */
let firstPageTask = null;

function pageFromUrl() {
  const n = parseInt(new URLSearchParams(location.search).get('page') || '1', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : 1;
}

function syncUrl() {
  const next =
    state.loadedPages > 1
      ? `${location.pathname}?page=${state.loadedPages}`
      : location.pathname;
  if (location.search !== next.replace(location.pathname, '') || state.loadedPages > 1) {
    history.replaceState(null, '', next);
  }
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
    // 首屏数据可能在 boot 时已提前发起，直接复用，省掉一次往返
    const req = firstPageTask || getMemos({ pageToken: token });
    firstPageTask = null;
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
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 2.6;

let tapAt = 0;
let tapTimer = 0;

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
    const item = viewer.list[(viewer.index + d + total) % total];
    if (item) preloadOrigin(item.origin);
  });
}

function openViewer(list, index) {
  if (!list.length) return;
  viewer.list = list;
  viewer.index = index;
  viewer.open = true;
  viewer.scale = 1;
  viewer.panX = 0;
  viewer.panY = 0;
  el.viewer.classList.add('is-open');
  el.viewer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  paintViewer();
}

function paintViewer() {
  const total = viewer.list.length;
  const item = viewer.list[viewer.index];
  if (!item) return;

  viewer.token += 1;
  const token = viewer.token;

  // 先用已缓存的缩略图立即上屏，切换不会有空白等待
  el.viewerImg.src = item.thumb || item.origin;
  el.viewerCount.textContent = total > 1 ? `${viewer.index + 1} / ${total}` : '';
  el.viewerPrev.hidden = total < 2;
  el.viewerNext.hidden = total < 2;
  applyViewerTransform();

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

function applyViewerTransform() {
  const zoomed = viewer.scale > 1.01;
  el.viewer.classList.toggle('is-zoom', zoomed);
  el.viewerImg.classList.toggle('is-zoom', zoomed);
  el.viewerImg.style.transform = zoomed
    ? `translate3d(${viewer.panX}px, ${viewer.panY}px, 0) scale(${viewer.scale})`
    : '';
}

/** 限制拖动范围，图片边缘不会被拖进画面里出现空白 */
function clampPan() {
  if (viewer.scale <= 1.01) {
    viewer.panX = 0;
    viewer.panY = 0;
    return;
  }
  const maxX = Math.max(0, (el.viewerImg.clientWidth * viewer.scale - el.viewerStage.clientWidth) / 2);
  const maxY = Math.max(0, (el.viewerImg.clientHeight * viewer.scale - el.viewerStage.clientHeight) / 2);
  viewer.panX = Math.min(maxX, Math.max(-maxX, viewer.panX));
  viewer.panY = Math.min(maxY, Math.max(-maxY, viewer.panY));
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
  const total = viewer.list.length;
  if (total < 2) return;
  viewer.index = (viewer.index + delta + total) % total;
  viewer.scale = 1;
  viewer.panX = 0;
  viewer.panY = 0;
  paintViewer();
}

function closeViewer() {
  viewer.open = false;
  viewer.token += 1; // 取消尚未完成的原图替换
  clearTimeout(tapTimer);
  el.viewer.classList.remove('is-open');
  el.viewer.classList.remove('is-zoom');
  el.viewer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  el.viewerImg.removeAttribute('src');
}


function initViewer() {
  el.viewerClose.addEventListener('click', closeViewer);
  el.viewerPrev.addEventListener('click', () => stepViewer(-1));
  el.viewerNext.addEventListener('click', () => stepViewer(1));
  el.viewerStage.addEventListener('click', (e) => {
    if (e.target === el.viewerStage) closeViewer();
  });

  const pointers = new Map();
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let moved = false;
  let pinchDist = 0;
  let pinchScale = 1;
  let pinchMidX = 0;
  let pinchMidY = 0;
  let pinchPanX = 0;
  let pinchPanY = 0;

  const at = (e) => ({ x: e.clientX, y: e.clientY });
  const all = () => Array.from(pointers.values());

  el.viewerStage.addEventListener('pointerdown', (e) => {
    // 箭头/关闭按钮不参与手势，否则会影响点击
    if (e.target.closest('.viewer-arrow') || e.target.closest('.viewer-close')) return;

    pointers.set(e.pointerId, at(e));
    moved = false;

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

    // 放大状态下单指拖动
    if (viewer.scale > 1.01) {
      viewer.panX += e.clientX - prev.x;
      viewer.panY += e.clientY - prev.y;
      clampPan();
      el.viewerImg.classList.add('is-panning');
      applyViewerTransform();
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

    // 放大状态：轻点还原原始大小
    if (viewer.scale > 1.01) {
      if (isTap && quick) zoomTo(1);
      return;
    }

    // 左右滑动切图
    if (!isTap && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      stepViewer(dx < 0 ? 1 : -1);
      return;
    }
    if (!isTap) return;

    // 鼠标端交给 dblclick 处理（单击不关闭，对齐微信 PC 版）
    if (e.pointerType !== 'touch') return;

    // 轻点：双击（两次 300ms 内）放大，单击延时关闭，避免双击被单击抢掉
    const now = performance.now();
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

  // 资料与首屏动态并行请求（原先串行，白白多等一个来回）
  const profileTask = getProfile()
    .then(applyProfile)
    .catch(() => applyProfile({ name: CONFIG.NICKNAME, avatar: '', bio: '' }));

  firstPageTask = getMemos({ pageToken: '' });

  await Promise.all([profileTask, gotoPage(pageFromUrl())]);
}

boot();
