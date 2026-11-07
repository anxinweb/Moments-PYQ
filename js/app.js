import { CONFIG } from './config.js';
import { getProfile, getMemos, PLACEHOLDER_AVATAR } from './api.js';
import { renderMoment, skeletonHtml, imagesOf } from './render.js';

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
      const origins = Array.from(grid.querySelectorAll('img')).map((i) => i.dataset.origin || i.src);
      openViewer(origins, Number(cell.dataset.index) || 0);
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
    const { memos, nextPageToken } = await getMemos({ pageToken: token });

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

const viewer = { list: [], index: 0, open: false, zoom: false, panX: 0, panY: 0 };

function openViewer(list, index) {
  if (!list.length) return;
  viewer.list = list;
  viewer.index = index;
  viewer.open = true;
  viewer.zoom = false;
  viewer.panX = 0;
  viewer.panY = 0;
  el.viewer.classList.add('is-open');
  el.viewer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  paintViewer();
}

function paintViewer() {
  const total = viewer.list.length;
  el.viewerImg.src = viewer.list[viewer.index];
  el.viewerCount.textContent = total > 1 ? `${viewer.index + 1} / ${total}` : '';
  el.viewerPrev.hidden = total < 2;
  el.viewerNext.hidden = total < 2;
  applyViewerTransform();
}

function applyViewerTransform() {
  el.viewerImg.classList.toggle('is-zoom', viewer.zoom);
  el.viewer.classList.toggle('is-zoom', viewer.zoom);
  el.viewerImg.style.transform = viewer.zoom
    ? `translate(${viewer.panX}px, ${viewer.panY}px) scale(2)`
    : '';
}

function stepViewer(delta) {
  const total = viewer.list.length;
  if (total < 2) return;
  viewer.index = (viewer.index + delta + total) % total;
  viewer.zoom = false;
  viewer.panX = 0;
  viewer.panY = 0;
  paintViewer();
}

function closeViewer() {
  viewer.open = false;
  el.viewer.classList.remove('is-open');
  el.viewer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  el.viewerImg.removeAttribute('src');
}

function toggleZoom() {
  viewer.zoom = !viewer.zoom;
  if (!viewer.zoom) {
    viewer.panX = 0;
    viewer.panY = 0;
  }
  applyViewerTransform();
}

function initViewer() {
  el.viewerClose.addEventListener('click', closeViewer);
  el.viewerPrev.addEventListener('click', () => stepViewer(-1));
  el.viewerNext.addEventListener('click', () => stepViewer(1));
  el.viewerStage.addEventListener('click', (e) => {
    if (e.target === el.viewerStage) closeViewer();
  });

  let startX = 0;
  let startY = 0;
  let lastTap = 0;
  let tracking = false;
  let moved = false;

  el.viewerStage.addEventListener('pointerdown', (e) => {
    // 箭头按钮不参与拖拽/缩放手势，否则 pointer capture 会吞掉点击
    if (e.target.closest('.viewer-arrow')) return;
    tracking = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    el.viewerStage.setPointerCapture(e.pointerId);
  });

  el.viewerStage.addEventListener('pointermove', (e) => {
    if (!tracking || !viewer.zoom) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    viewer.panX = dx;
    viewer.panY = dy;
    applyViewerTransform();
  });

  el.viewerStage.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (viewer.zoom) {
      if (moved) return;
      toggleZoom();
      return;
    }

    const now = Date.now();
    if (now - lastTap < 300 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      lastTap = 0;
      toggleZoom();
      return;
    }
    lastTap = now;

    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      stepViewer(dx < 0 ? 1 : -1);
      return;
    }
    // 点图片关闭仅限触屏；鼠标用户点黑色区域或右上角 × 关闭（对齐微信 PC 版）
    if (
      !moved &&
      Math.abs(dx) < 12 &&
      Math.abs(dy) < 12 &&
      e.target === el.viewerImg &&
      e.pointerType === 'touch'
    ) {
      closeViewer();
    }
  });

  el.viewerStage.addEventListener('pointercancel', () => {
    tracking = false;
  });

  el.viewerImg.addEventListener('dblclick', toggleZoom);

  document.addEventListener('keydown', (e) => {
    if (!viewer.open) return;
    if (e.key === 'Escape') closeViewer();
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
    if (el.coverImg && y >= 0 && y <= coverH + 80) {
      el.coverImg.style.transform = `translate3d(0, ${y * 0.35}px, 0) scale(1.02)`;
    }
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

  try {
    applyProfile(await getProfile());
  } catch (e) {
    applyProfile({ name: CONFIG.NICKNAME, avatar: '', bio: '' });
  }

  el.feed.innerHTML = skeletonHtml(CONFIG.SKELETON_COUNT);
  await gotoPage(pageFromUrl());
}

boot();
