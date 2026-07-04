/**
 * Moments - 朋友圈静态站主逻辑 v2
 * 全面优化交互体验
 * 基于 Memos 0.29.1 API (name-based 资源风格)
 */
(function () {
  'use strict';

  // ==================== 状态管理 ====================
  const state = {
    memos: [],
    allPublicMemos: [],
    allTags: [],
    userProfile: null,
    currentPageToken: '',
    hasMore: true,
    loading: false,
    firstLoad: true,
    searchQuery: '',
    activeTag: 'all',
    lightboxImages: [],
    lightboxIndex: 0,
    sseConnection: null,
    pollTimer: null,
    allReactions: {},
    linkPreviewCache: {},
    isGuest: true,
    lastScrollY: 0,
    navScrolled: false,
    navCompact: false,
    lightboxTouchStartX: 0,
    lightboxTouchStartY: 0,
    lightboxSwipeHandled: false,
    loadedCount: 0,
    // 持久化登录：口令(proxy)永不过期，真实Token(direct)7天过期
    publishToken: (() => { try { const d = JSON.parse(localStorage.getItem('moments-publish-token')); if (!d) return ''; const expired = d.m === 'direct' && Date.now() - d.t > 7*86400000; return expired ? '' : d.v; } catch {} return ''; })(),
    publishAuthMode: (() => { try { const d = JSON.parse(localStorage.getItem('moments-publish-token')); if (!d) return 'proxy'; const expired = d.m === 'direct' && Date.now() - d.t > 7*86400000; return expired ? 'proxy' : d.m || 'proxy'; } catch {} return 'proxy'; })(),
    directApiMode: (() => { try { const d = JSON.parse(localStorage.getItem('moments-publish-token')); if (!d) return false; const expired = d.m === 'direct' && Date.now() - d.t > 7*86400000; return expired ? false : d.m === 'direct'; } catch {} return false; })(),
    activeDate: '',
    editingMemoName: '',
    selectedPublishFiles: [],
    statsYear: new Date().getFullYear(),
    statsMonth: new Date().getMonth(),
    statsTab: 'calendar',
    // 可见性筛选
    visibilityFilter: 'all',  // 'all' | 'PUBLIC' | 'PROTECTED' | 'PRIVATE'
    hashView: false,           // 当前是否为单条链接视图
    hashViewMemo: null,        // 单条视图的 memo 数据
    // 后台分页补全:首屏只拉第一页立即渲染,剩余在后台异步拉取
    backgroundFetchPromise: null,
    // 下一页 token:loadMore 直接用此 token 调 API 拉下一页,不等后台补全
    nextPageToken: '',
    // 分页
    paginationPage: 1,
    paginationTotalPages: 1,
    // 批量操作
    batchMode: false,
    selectedMemos: new Set(),
    // 缓存状态
    cacheRestored: false,
  };

  // ==================== 智能缓存管理器 ====================
  const CACHE_KEY = 'moments-cache-v1';
  const CACHE_TTL = 5 * 60 * 1000; // 5分钟
  const CACHE_MAX_AGE = 30 * 60 * 1000; // 30分钟强制刷新

  const cacheManager = {
    get(key, maxAge = CACHE_TTL) {
      try {
        const raw = sessionStorage.getItem(`${CACHE_KEY}:${key}`);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        const age = Date.now() - entry.ts;
        if (age > maxAge) {
          sessionStorage.removeItem(`${CACHE_KEY}:${key}`);
          return null;
        }
        return entry.data;
      } catch { return null; }
    },
    set(key, data) {
      try {
        const entry = { ts: Date.now(), data };
        sessionStorage.setItem(`${CACHE_KEY}:${key}`, JSON.stringify(entry));
      } catch {
        // 存储满时清理旧缓存
        try {
          const keys = Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_KEY));
          keys.sort((a, b) => {
            const ea = JSON.parse(sessionStorage.getItem(a) || '{"ts":0}');
            const eb = JSON.parse(sessionStorage.getItem(b) || '{"ts":0}');
            return ea.ts - eb.ts;
          });
          // 删除最旧的50%
          keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => sessionStorage.removeItem(k));
          // 重试
          sessionStorage.setItem(`${CACHE_KEY}:${key}`, JSON.stringify({ ts: Date.now(), data }));
        } catch { /* ignore */ }
      }
    },
    clear() {
      try {
        Object.keys(sessionStorage).forEach(k => {
          if (k.startsWith(CACHE_KEY)) sessionStorage.removeItem(k);
        });
      } catch { /* ignore */ }
    },
    get memos() { return this.get('memos', CACHE_MAX_AGE); },
    set memos(data) { this.set('memos', data); },
    get tags() { return this.get('tags', CACHE_MAX_AGE); },
    set tags(data) { this.set('tags', data); },
    get reactions() { return this.get('reactions', CACHE_MAX_AGE); },
    set reactions(data) { this.set('reactions', data); },
    get linkPreviews() { return this.get('linkPreviews', CACHE_MAX_AGE); },
    set linkPreviews(data) { this.set('linkPreviews', data); },
    get userProfile() { return this.get('userProfile', CACHE_MAX_AGE); },
    set userProfile(data) { this.set('userProfile', data); },
    invalidateAll() {
      this.clear();
      state.allReactions = {};
      state.linkPreviewCache = {};
      state.allPublicMemos = [];
      state.allTags = [];
    },
  };

  // ==================== DOM 引用 ====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    readingProgress: $('#readingProgress'),
    navbarBrand: $('.navbar-brand'),
    siteIcon: $('#siteIcon'),
    siteName: $('#siteName'),
    navbar: $('#navbar'),
    btnSearch: $('#btnSearch'),
    btnStats: $('#btnStats'),
    btnAdmin: $('#btnAdmin'),
    btnBatch: $('#btnBatch'),
    btnTheme: $('#btnTheme'),
    searchBar: $('#searchBar'),
    searchInput: $('#searchInput'),
    searchClear: $('#searchClear'),
    tagsNav: $('#tagsNav'),
    visFilterBar: $('#visFilterBar'),
    hashBackBtn: $('#hashBackBtn'),
    tagsNavInner: $('.tags-nav-inner'),
    mainContent: $('#mainContent'),
    skeletonWrap: $('#skeletonWrap'),
    memoList: $('#memoList'),
    loadMore: $('#loadMore'),
    emptyState: $('#emptyState'),
    searchEmpty: $('#searchEmpty'),
    endState: $('#endState'),
    statsModal: $('#statsModal'),
    statsClose: $('#statsClose'),
    statsBody: $('#statsBody'),
    lightbox: $('#lightbox'),
    lightboxClose: $('#lightboxClose'),
    lightboxPrev: $('#lightboxPrev'),
    lightboxNext: $('#lightboxNext'),
    lightboxImg: $('#lightboxImg'),
    lightboxImgWrap: $('#lightboxImgWrap'),
    lightboxCounter: $('#lightboxCounter'),
    reactionPicker: $('#reactionPicker'),
    reactionPickerInner: $('#reactionPickerInner'),
    backToTop: $('#backToTop'),
    toastContainer: $('#toastContainer'),
    publishModal: $('#publishModal'),
    publishClose: $('#publishClose'),
    loginPanel: $('#loginPanel'),
    publishPanel: $('#publishPanel'),
    publishTokenInput: $('#publishTokenInput'),
    publishLoginBtn: $('#publishLoginBtn'),
    publishLogoutBtn: $('#publishLogoutBtn'),
    publishContent: $('#publishContent'),
    publishVisibility: $('#publishVisibility'),
    publishPinned: $('#publishPinned'),
    publishCreateTime: $('#publishCreateTime'),
    publishLocation: $('#publishLocation'),
    publishFiles: $('#publishFiles'),
    publishFileList: $('#publishFileList'),
    publishCharCount: $('#publishCharCount'),
    publishSubmit: $('#publishSubmit'),
    publishDraftHint: $('#publishDraftHint'),
    publishDraftClear: $('#publishDraftClear'),
    paginationNav: $('#paginationNav'),
    pagPrev: $('#pagPrev'),
    pagNext: $('#pagNext'),
    pagCurrent: $('#pagCurrent'),
    pagTotal: $('#pagTotal'),
    pagJumpInput: $('#pagJumpInput'),
    pagJumpToggle: $('#pagJumpToggle'),
    pagJumpWrap: $('#pagJumpWrap'),
    pagJumpGo: $('#pagJumpGo'),
    loadMoreClick: $('#loadMoreClick'),
    loadMoreClickBtn: $('#loadMoreClickBtn'),
    batchToolbar: $('#batchToolbar'),
    batchCount: $('#batchCount'),
    batchPublic: $('#batchPublic'),
    batchProtected: $('#batchProtected'),
    batchPrivate: $('#batchPrivate'),
    batchDelete: $('#batchDelete'),
    batchCancel: $('#batchCancel'),
  };

  // ==================== 工具函数 ====================

  // 根据平台获取代理基础路径
  function getProxyBase() {
    if (CONFIG.PLATFORM === 'custom') return CONFIG.CUSTOM_PROXY_PATH;
    // Vercel / Cloudflare / Netlify 统一走 /api/proxy
    return '/api/proxy';
  }

  function apiUrl(path, queryStr) {
    if (state.directApiMode) {
      let url = CONFIG.MEMOS_URL + CONFIG.API_PREFIX + path;
      if (queryStr) url += '?' + queryStr;
      return url;
    }
    if (CONFIG.USE_PROXY) {
      const proxyBase = getProxyBase();
      let url = `${proxyBase}?path=` + encodeURIComponent(path);
      if (queryStr) url += '&' + queryStr;
      return url;
    }
    // 直连模式
    let url = CONFIG.MEMOS_URL + CONFIG.API_PREFIX + path;
    if (queryStr) url += '?' + queryStr;
    return url;
  }

  async function apiFetch(path, options = {}, queryStr = '') {
    const url = apiUrl(path, queryStr);
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const token = state.publishToken || '';
    if (state.directApiMode && token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (token) {
      // 非直连模式：所有请求（含 GET）都传 X-Publish-Token
      // 代理收到后用 MEMOS_API_KEY 或 X-Publish-Token 本身作为 Bearer 凭证
      headers['X-Publish-Token'] = token;
    }
    const resp = await fetch(url, {
      ...options,
      headers,
    });
    const text = await resp.text();
    if (!resp.ok) {
      let message = text;
      try {
        const data = text ? JSON.parse(text) : {};
        message = data.message || data.error || text;
      } catch { /* ignore */ }
      throw new Error(`API error: ${resp.status} ${resp.statusText}${message ? ` - ${message}` : ''}`);
    }
    return text ? JSON.parse(text) : {};
  }

  // 获取图片/文件 URL（支持代理模式）
  function fileUrl(attachmentName, filename, options = {}) {
    const params = options.thumbnail ? '&thumbnail=true' : '';
    if (!state.directApiMode && CONFIG.USE_PROXY && CONFIG.PROXY_FILES) {
      const proxyBase = getProxyBase();
      return `${proxyBase}?path=` + encodeURIComponent(`/file/${attachmentName}/${filename}`) + params;
    }
    const suffix = options.thumbnail ? '?thumbnail=true' : '';
    return CONFIG.MEMOS_URL + '/file/' + attachmentName + '/' + encodeURIComponent(filename) + suffix;
  }

  // 获取附件的 R2 原链接(externalLink),用于原图/音视频/文件直接访问
  // 优于经过 memos /file/ 代理:直连 R2 更快,且不消耗 memos/vercel 带宽
  // 若无 externalLink(如本地存储模式),回退到 fileUrl
  function attachmentOriginalUrl(attachment) {
    if (attachment && attachment.externalLink) return attachment.externalLink;
    return fileUrl(attachment.name, attachment.filename);
  }

  function normalizeMemosUrl(url) {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    if (url.startsWith('/')) return CONFIG.MEMOS_URL.replace(/\/$/, '') + url;
    return url;
  }

  function memoId(name) {
    return name.split('/').pop();
  }

  function userName(name) {
    return name.split('/').pop();
  }

  function timeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (Number.isNaN(date.getTime()) || diff < 0) return '刚刚';
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + ' 天前';
    return formatDate(dateStr);
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function toDateTimeLocal(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getField(obj, camel, snake) {
    return obj?.[camel] ?? obj?.[snake];
  }

  function getMemoTime(memo, field = 'create') {
    return getField(memo, field + 'Time', field + '_time');
  }

  function getMemoTags(memo) {
    return Array.isArray(memo.tags) ? memo.tags : [];
  }

  function getMemoVisibility(memo) {
    return memo?.visibility || memo?.Visibility || '';
  }

  function isPublicMemo(memo) {
    return getMemoVisibility(memo) === 'PUBLIC';
  }

  function hideContentTags(text) {
    if (!text) return '';
    return text
      .split('\n')
      .map(line => line.replace(/(^|[\s，。；、])#[\p{L}\p{N}_/-]+/gu, '$1').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getMemoOriginalUrl(memo) {
    const id = memoId(memo.name);
    const template = CONFIG.MEMO_DETAIL_URL_TEMPLATE || `${CONFIG.MEMOS_URL}/m/{id}`;
    return template
      .replace('{id}', encodeURIComponent(id))
      .replace('{name}', encodeURIComponent(memo.name));
  }

  function renderMarkdown(text, highlight) {
    if (!text) return '';
    text = normalizeRawHtmlLinks(hideContentTags(text));
    let html = escapeHtml(text);

    // 搜索高亮（在 markdown 解析之前）
    if (highlight) {
      const escaped = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="highlight">$1</mark>');
    }

    // 代码块
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = renderListBlocks(html);
    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, url) => {
      return `<img src="${sanitizeUrl(url)}" alt="${alt}" loading="lazy">`;
    });
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, url) => {
      const safeUrl = sanitizeUrl(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html
      .replace(/<p>(?:<br>|\s)*<(ul|ol)([^>]*)>/g, '<$1$2>')
      .replace(/<\/(ul|ol)>(?:<br>|\s)*<\/p>/g, '</$1>')
      .replace(/<br>\s*<(ul|ol)([^>]*)>/g, '<$1$2>')
      .replace(/<\/(ul|ol)>\s*<br>/g, '</$1>')
      .replace(/<\/p>\s*<br>\s*<(ul|ol)([^>]*)>/g, '</p><$1$2>')
      .replace(/<\/(ul|ol)>\s*<br>\s*<p>/g, '</$1><p>');
    html = html.replace(/<p>\s*<\/p>/g, '');
    return html;
  }

  function renderListBlocks(html) {
    const lines = html.split('\n');
    const out = [];
    let listType = '';
    const closeList = () => {
      if (listType) {
        out[out.length - 1] = `${out[out.length - 1]}</${listType}>`;
        listType = '';
      }
    };

    lines.forEach(line => {
      const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (task) {
        if (listType !== 'ul') {
          closeList();
          out.push('<ul class="task-list">');
          listType = 'ul';
        }
        const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
        out.push(`<li class="task-list-item"><input type="checkbox" disabled${checked}>${task[2]}</li>`);
      } else if (unordered) {
        if (listType !== 'ul') {
          closeList();
          out.push('<ul>');
          listType = 'ul';
        }
        out.push(`<li>${unordered[1]}</li>`);
      } else if (ordered) {
        if (listType !== 'ol') {
          closeList();
          out.push('<ol>');
          listType = 'ol';
        }
        out.push(`<li>${ordered[1]}</li>`);
      } else {
        closeList();
        out.push(line);
      }
    });
    closeList();
    return out.join('\n')
      .replace(/<(ul|ol)([^>]*)>\n/g, '<$1$2>')
      .replace(/\n<\/(ul|ol)>/g, '</$1>')
      .replace(/<\/li>\n<li/g, '</li><li');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sanitizeUrl(url) {
    const decoded = String(url || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    if (/^(https?:|mailto:|tel:)/i.test(decoded) || decoded.startsWith('/') || decoded.startsWith('#')) {
      return escapeHtml(decoded);
    }
    return '#';
  }

  function normalizeRawHtmlLinks(text) {
    return String(text || '').replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, label) => {
      const cleanLabel = label.replace(/<[^>]+>/g, '').trim() || url;
      return `[${cleanLabel}](${url})`;
    });
  }

  function extractUrls(text) {
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
    return text.match(urlRegex) || [];
  }

  function canPreviewUrl(url) {
    try {
      const u = new URL(url);
      // 跳过非 HTML 页面：常见的文件扩展名
      const noPreview = /\.(css|js|json|xml|svg|png|jpg|jpeg|gif|webp|bmp|ico|pdf|zip|rar|7z|gz|tar|mp3|mp4|avi|mov|wmv|flv|woff|woff2|ttf|eot|otf|doc|docx|xls|xlsx|ppt|pptx|apk|ipa|dmg|exe)$/i;
      if (noPreview.test(u.pathname)) return false;
      // 跳过已知 CDN 纯资源域名
      const staticDomains = /cdn\.|staticfile|unpkg|jsdelivr|cloudfront|bootstrapcdn/i;
      if (staticDomains.test(u.hostname)) return false;
      return true;
    } catch { return false; }
  }

  function extractPreviewUrls(text) {
    const cleaned = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[[^\]]*\]\([^)]+\)/g, '');
    return extractUrls(cleaned);
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ==================== Toast 多级提示 ====================

  function showToast(msg, type = 'success', duration = 2500) {
    const container = dom.toastContainer;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);

    // 触发 reflow 让动画生效
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ==================== 导航栏滚动效果 ====================

  // 滚动事件节流（16ms ≈ 60fps）
  let scrollTicking = false;
  function handleScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      const scrollY = window.scrollY;
      const delta = scrollY - state.lastScrollY;

      // 磨砂玻璃
      if (scrollY > 10 && !state.navScrolled) {
        dom.navbar.classList.add('scrolled');
        state.navScrolled = true;
      } else if (scrollY <= 10 && state.navScrolled) {
        dom.navbar.classList.remove('scrolled');
        state.navScrolled = false;
      }

      // 收缩导航栏（快速下滑时）
      if (scrollY > 150 && delta > 5 && !state.navCompact) {
        dom.navbar.classList.add('compact');
        state.navCompact = true;
      } else if ((scrollY <= 150 || delta < -5) && state.navCompact) {
        dom.navbar.classList.remove('compact');
        state.navCompact = false;
      }

      // 回到顶部按钮
      if (scrollY > 400) {
        dom.backToTop.classList.add('visible');
      } else {
        dom.backToTop.classList.remove('visible');
      }

      state.lastScrollY = scrollY;
      scrollTicking = false;
    });
  }

  // ==================== 主题管理 ====================

  function initTheme() {
    document.documentElement.setAttribute('data-palette', CONFIG.THEME_PRESET || 'nordic');
    const saved = CONFIG.THEME_ALLOW_USER_OVERRIDE ? (localStorage.getItem('moments-theme') || normalizeThemeStrategy()) : normalizeThemeStrategy();
    applyTheme(saved);
  }

  function normalizeThemeStrategy() {
    const strategy = CONFIG.DARK_MODE_STRATEGY || CONFIG.DEFAULT_THEME || 'auto';
    if (strategy === 'system') return 'auto';
    return strategy;
  }

  function isScheduleDark() {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const parse = (value, fallback) => {
      const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return fallback;
      return Number(match[1]) * 60 + Number(match[2]);
    };
    const start = parse(CONFIG.DARK_MODE_START, 19 * 60);
    const end = parse(CONFIG.DARK_MODE_END, 7 * 60);
    return start > end ? (minutes >= start || minutes < end) : (minutes >= start && minutes < end);
  }

  function applyTheme(theme) {
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else if (theme === 'schedule') {
      document.documentElement.setAttribute('data-theme', isScheduleDark() ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (CONFIG.THEME_ALLOW_USER_OVERRIDE) localStorage.setItem('moments-theme', theme);
  }

  function toggleTheme() {
    const current = CONFIG.THEME_ALLOW_USER_OVERRIDE ? (localStorage.getItem('moments-theme') || normalizeThemeStrategy()) : document.documentElement.getAttribute('data-theme');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = current === 'auto' ? (isDark ? 'light' : 'dark') : (current === 'dark' ? 'light' : 'dark');
    applyTheme(next);

    // 按钮涟漪反馈
    addRipple(dom.btnTheme);
    showToast(next === 'dark' ? '已切换到暗色模式' : '已切换到亮色模式', 'success', 1500);
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const saved = CONFIG.THEME_ALLOW_USER_OVERRIDE ? (localStorage.getItem('moments-theme') || normalizeThemeStrategy()) : normalizeThemeStrategy();
    if (saved === 'auto') applyTheme('auto');
  });

  setInterval(() => {
    try {
      const saved = CONFIG.THEME_ALLOW_USER_OVERRIDE ? (localStorage.getItem('moments-theme') || normalizeThemeStrategy()) : normalizeThemeStrategy();
      if (saved === 'schedule') applyTheme('schedule');
    } catch { /* localStorage 不可用时跳过 */ }
  }, 60000);

  // ==================== 按钮涟漪效果 ====================

  function addRipple(el) {
    el.classList.remove('ripple');
    void el.offsetWidth; // reflow
    el.classList.add('ripple');
    setTimeout(() => el.classList.remove('ripple'), 400);
  }

  // ==================== Memos API ====================

  async function fetchMemos(pageToken, pageSize = 200) {
    const params = new URLSearchParams();
    // 游客只获取公开内容；登录后不设 filter 让 API 返回所有可见性内容
    if (state.isGuest) {
      params.set('filter', 'visibility == "PUBLIC"');
    }
    params.set('page_size', String(pageSize));
    params.set('order_by', 'pinned desc, create_time desc');
    if (pageToken) params.set('page_token', pageToken);
    return apiFetch('/memos', {}, params.toString());
  }

  // 后台分页补全:从指定 pageToken 继续拉取剩余 memo,填充 allPublicMemos
  // 用于搜索/统计/翻页,不阻塞首屏渲染
  function startBackgroundFetch(pageToken) {
    if (state.backgroundFetchPromise || !pageToken) return;
    state.backgroundFetchPromise = (async () => {
      try {
        let token = pageToken;
        let maxPages = 10;
        while (token && maxPages > 0) {
          maxPages--;
          const data = await fetchMemos(token);
          const more = (data.memos || []).filter(m => state.isGuest ? isPublicMemo(m) : true);
          // 去重(防止 silentRefresh 已 unshift 的新内容重复)
          const existing = new Set(state.allPublicMemos.map(m => m.name));
          const fresh = more.filter(m => !existing.has(m.name));
          state.allPublicMemos.push(...fresh);
          fresh.forEach(m => existing.add(m.name));
          token = data.nextPageToken || data.next_page_token || '';
        }
        collectTags();
        cacheManager.memos = state.allPublicMemos;
      } catch (e) {
        console.warn('Background fetch failed:', e);
      } finally {
        state.backgroundFetchPromise = null;
      }
    })();
  }

  async function fetchAllPublicMemos(force = false) {
    // 尝试从缓存恢复
    if (!force && state.allPublicMemos.length === 0) {
      const cached = cacheManager.memos;
      if (cached && Array.isArray(cached) && cached.length > 0) {
        state.allPublicMemos = cached;
        // 同时恢复标签缓存
        const cachedTags = cacheManager.tags;
        if (cachedTags) {
          state.allTags = cachedTags;
          renderTagsNav();
        } else {
          collectTags();
        }
        state.cacheRestored = true;
        return state.allPublicMemos;
      }
    }
    if (!force && state.allPublicMemos.length > 0) return state.allPublicMemos;

    // 首屏快速模式:只拉第一页(PAGE_SIZE 条)立即返回,剩余后台补全
    // 首屏只等 ~20 条而非全量(可能数百~数千条),显著提速
    const firstParams = new URLSearchParams();
    if (state.isGuest) firstParams.set('filter', 'visibility == "PUBLIC"');
    firstParams.set('page_size', String(CONFIG.PAGE_SIZE));
    firstParams.set('order_by', 'pinned desc, create_time desc');
    const firstData = await apiFetch('/memos', {}, firstParams.toString());
    const firstMemos = (firstData.memos || []).filter(memo => state.isGuest ? isPublicMemo(memo) : true);
    state.allPublicMemos = firstMemos;
    // 保存下一页 token,loadMore 直接用它调 API,不等后台补全
    state.nextPageToken = firstData.nextPageToken || firstData.next_page_token || '';
    collectTags();
    cacheManager.memos = state.allPublicMemos;

    // 后台补全剩余(用于搜索/统计/翻页),不阻塞首屏,也不阻塞 loadMore
    if (state.nextPageToken) {
      startBackgroundFetch(state.nextPageToken);
    }
    return state.allPublicMemos;
  }

  function getFilteredMemos() {
    const query = state.searchQuery.trim().toLowerCase();
    return state.allPublicMemos.filter(memo => {
      const tags = getMemoTags(memo);
      const tagMatched = state.activeTag === 'all' || tags.includes(state.activeTag);
      const contentMatched = !query || (memo.content || '').toLowerCase().includes(query);
      const dateMatched = !state.activeDate || formatDate(getMemoTime(memo, 'create')) === state.activeDate;
      // 可见性筛选：登录后可用
      const visMatched = state.visibilityFilter === 'all' || getMemoVisibility(memo).toUpperCase() === state.visibilityFilter;
      return tagMatched && contentMatched && dateMatched && visMatched;
    });
  }

  function escapeFilter(str) {
    return str.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
  }

  async function fetchReactions(memoName) {
    try {
      // memoName 形如 "memos/xxx",reactions 路径为 /memos/{name}/reactions
      // 需先去掉前缀 "memos/",避免拼成 /memos/memos/xxx/reactions (404)
      const id = memoName.startsWith('memos/') ? memoName.slice(6) : memoName;
      const data = await apiFetch(`/memos/${id}/reactions`);
      state.allReactions[memoName] = data.reactions || [];
      return data.reactions || [];
    } catch { return []; }
  }

  async function addReaction(memoName, emoji, clickEvent) {
    if (state.isGuest) {
      showToast('登录后才能添加反应', 'warning');
      return;
    }
    try {
      // 去掉 "memos/" 前缀,避免路径 /memos/memos/xxx/reactions (404)
      const id = memoName.startsWith('memos/') ? memoName.slice(6) : memoName;
      await apiFetch(`/memos/${id}/reactions`, {
        method: 'POST',
        body: JSON.stringify({
          reaction: {
            contentId: memoName,
            reactionType: emoji,
          },
        }),
      });
      showToast('已添加反应', 'success', 1500);
      // 粒子效果
      spawnParticles(emoji, clickEvent?.target);
      const reactions = await fetchReactions(memoName);
      updateReactionsUI(memoName, reactions);
    } catch (err) {
      if (err.message?.includes('401') || err.message?.includes('403')) {
        state.isGuest = true;
        hideReactionAddButtons();
        showToast('登录后才能添加反应', 'warning');
      } else {
        showToast(err.message || '操作失败', 'error', 3000);
      }
    }
  }

  function hideReactionAddButtons() {
    document.querySelectorAll('.reaction-add').forEach(el => el.style.display = 'none');
  }

  // Reaction 粒子效果
  function spawnParticles(emoji, targetEl) {
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    for (let i = 0; i < 5; i++) {
      const particle = document.createElement('span');
      particle.className = 'reaction-particle';
      particle.textContent = emoji;
      particle.style.left = (rect.left + Math.random() * rect.width) + 'px';
      particle.style.top = (rect.top - 10) + 'px';
      particle.style.animationDelay = (Math.random() * 0.2) + 's';
      document.body.appendChild(particle);
      setTimeout(() => particle.remove(), 1000);
    }
  }

  async function fetchLinkMetadata(url) {
    try {
      const meta = await apiFetch('/memos/-/linkMetadata', {}, `url=${encodeURIComponent(url)}`);
      if (meta && meta.code) return null; // {code:3, message:"..."}
      return meta;
    } catch { return null; }
  }

  async function fetchStats() {
    try { return await apiFetch(`/users/${CONFIG.ADMIN_NAME}:getStats`); }
    catch { return null; }
  }

  async function verifyPublishToken(token) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async function verifyDirectMemosToken(token) {
    const url = `${CONFIG.MEMOS_URL}${CONFIG.API_PREFIX}/users/${CONFIG.ADMIN_NAME}/personalAccessTokens`;
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!resp.ok) {
      throw new Error(`Memos Token 验证失败：${resp.status}`);
    }
    return resp.json().catch(() => ({}));
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片读取失败'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  function replaceFileExtension(filename, ext) {
    return filename.includes('.') ? filename.replace(/\.[^.]+$/, ext) : filename + ext;
  }

  async function optimizeUploadFile(file) {
    if (!CONFIG.OPTIMIZE_UPLOAD_IMAGES || !file.type?.startsWith('image/')) return file;
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
    const minSize = Number(CONFIG.UPLOAD_IMAGE_MIN_COMPRESS_SIZE || 0);
    if (minSize && file.size < minSize) return file;

    try {
      const img = await loadImageFromFile(file);
      const maxSize = Number(CONFIG.UPLOAD_IMAGE_MAX_SIZE || 0);
      let { width, height } = img;
      if (maxSize > 0 && Math.max(width, height) > maxSize) {
        const ratio = maxSize / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const outputType = file.type === 'image/png' ? 'image/jpeg' : (file.type || 'image/jpeg');
      const blob = await canvasToBlob(canvas, outputType, Number(CONFIG.UPLOAD_IMAGE_QUALITY || 0.82));
      if (!blob || blob.size >= file.size) return file;
      const outputName = outputType === 'image/jpeg' ? replaceFileExtension(file.name, '.jpg') : file.name;
      return new File([blob], outputName, { type: outputType, lastModified: file.lastModified });
    } catch (err) {
      console.warn('图片压缩失败，使用原文件上传：', err);
      return file;
    }
  }

  async function uploadAttachment(file) {
    const uploadFile = await optimizeUploadFile(file);
    const content = await fileToBase64(uploadFile);
    const data = await apiFetch('/attachments', {
      method: 'POST',
      body: JSON.stringify({
        filename: uploadFile.name,
        type: uploadFile.type || 'application/octet-stream',
        content,
      }),
    });
    return data.attachment || data;
  }

  async function createMemo({ content, visibility, pinned, location, createTime, files }) {
    const attachments = [];
    for (const file of files) {
      attachments.push(await uploadAttachment(file));
    }
    const memo = {
      content,
      visibility,
      pinned,
      attachments,
    };
    if (createTime) {
      memo.createTime = createTime;
    }
    if (location) memo.location = { placeholder: location };
    return apiFetch('/memos', {
      method: 'POST',
      body: JSON.stringify(memo),
    });
  }

  async function updateMemo({ name, content, visibility, pinned, location, createTime, fields }) {
    // fields 可选，指定要更新的字段列表，默认全量更新
    const allowedFields = fields || ['content', 'visibility', 'pinned', 'location', 'createTime'];
    const memo = { name };
    if (allowedFields.includes('content')) memo.content = content ?? '';
    if (allowedFields.includes('visibility')) memo.visibility = visibility ?? 'PUBLIC';
    if (allowedFields.includes('pinned')) memo.pinned = !!pinned;
    if (allowedFields.includes('location') && location) memo.location = { placeholder: location };
    if (allowedFields.includes('createTime') && createTime) memo.createTime = createTime;
    const mask = allowedFields.map(f => f === 'createTime' ? 'create_time' : f).join('%2C');
    return apiFetch(`/${name}`, {
      method: 'PATCH',
      body: JSON.stringify(memo),
    }, `update_mask=${mask}`);
  }

  async function deleteMemo(name) {
    return apiFetch(`/${name}`, { method: 'DELETE' }, 'force=true');
  }

  async function fetchUser() {
    try {
      const data = await apiFetch(`/users/${CONFIG.ADMIN_NAME}`);
      return data.user || data;
    } catch { return null; }
  }

  async function loadUserProfile() {
    if (!CONFIG.AUTO_FETCH_MEMOS_USER_PROFILE) return;
    // 尝试从缓存恢复
    const cached = cacheManager.userProfile;
    if (cached) {
      state.userProfile = cached;
    }
    const user = await fetchUser();
    if (!user) return;
    state.userProfile = {
      displayName: getField(user, 'displayName', 'display_name') || user.username || CONFIG.ADMIN_NICKNAME || CONFIG.ADMIN_NAME,
      avatarUrl: normalizeMemosUrl(getField(user, 'avatarUrl', 'avatar_url') || ''),
    };
    cacheManager.userProfile = state.userProfile;
    // 后台加载完成:批量更新已渲染卡片的头像和昵称
    updateProfileInDOM();
  }

  // 用户画像后台加载完成后,批量更新 DOM 中已渲染卡片的头像/昵称
  // 避免首屏等待 fetchUser 网络请求,先用 fallback 渲染,加载完再补全
  function updateProfileInDOM() {
    if (!state.userProfile) return;
    const { displayName, avatarUrl } = state.userProfile;
    const avatarLetter = avatarUrl ? '' : (displayName || '').charAt(0).toUpperCase();
    const avatarHtml = avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" loading="lazy">`
      : avatarLetter;
    dom.memoList.querySelectorAll('[data-profile="avatar"]').forEach(el => {
      el.innerHTML = avatarHtml;
    });
    dom.memoList.querySelectorAll('[data-profile="author"]').forEach(el => {
      // 保留 pinned badge 和 visibility badge,只替换文本节点
      const badges = el.querySelectorAll('.pinned-badge, .memo-visibility-badge');
      el.textContent = displayName;
      badges.forEach(b => el.appendChild(b));
    });
  }

  // ==================== 渲染 ====================

  function renderMemoCard(memo) {
    const id = memoId(memo.name);
    const createTime = getMemoTime(memo, 'create');
    const time = timeAgo(createTime);
    const displayName = state.userProfile?.displayName || CONFIG.ADMIN_NICKNAME || CONFIG.ADMIN_NAME;
    const avatarUrl = state.userProfile?.avatarUrl || CONFIG.ADMIN_AVATAR;
    const avatarLetter = avatarUrl ? '' : displayName.charAt(0).toUpperCase();
    const avatarHtml = avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" loading="lazy">`
      : avatarLetter;

    const pinnedHtml = memo.pinned
      ? `<span class="pinned-badge" title="置顶"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.8 3.2 20.8 9.2 18.7 11.3 17.5 10.1 13.1 14.5 13.5 18.6 12.1 20 8.7 16.6 4.9 20.4 3.6 19.1 7.4 15.3 4 11.9 5.4 10.5 9.5 10.9 13.9 6.5 12.7 5.3 14.8 3.2Z"/></svg></span>`
      : '';

    const locationHtml = memo.location && memo.location.placeholder
      ? `<span class="memo-location"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(memo.location.placeholder)}</span>`
      : '';

    // 可见性 badge（登录后显示）
    const memoVisibility = (getMemoVisibility(memo) || '').toUpperCase();
    const visibilityBadge = !state.isGuest && memoVisibility !== 'PUBLIC'
      ? `<span class="memo-visibility-badge ${memoVisibility}">${memoVisibility === 'PRIVATE' ? '私密' : '登录可见'}</span>`
      : '';

    // 图片
    const attachments = memo.attachments || [];
    const imageAttachments = attachments.filter(a => a.type && a.type.startsWith('image/'));
    const mediaAttachments = attachments.filter(a => !(a.type && a.type.startsWith('image/')));
    let imagesHtml = '';
    const maxShow = CONFIG.MAX_IMAGES_PER_MEMO || 9;
    const shownImages = imageAttachments.slice(0, maxShow);
    if (shownImages.length > 0) {
      const shownCount = shownImages.length;
      const gridClass = `count-${shownCount}${shownCount === 1 ? ' single' : ''}`;
      imagesHtml = `<div class="memo-images ${gridClass}" data-total="${imageAttachments.length}">`;
      shownImages.forEach((img, idx) => {
        // 原图用 R2 原链接(externalLink),缩略图仍走 memos(小、快)
        const fullUrl = attachmentOriginalUrl(img);
        const thumbUrl = fileUrl(img.name, img.filename, { thumbnail: true });
        // 最后一张显示溢出指示
        const overflowHtml = (idx === maxShow - 1 && imageAttachments.length > maxShow)
          ? `<span class="overflow-indicator">+${imageAttachments.length - maxShow}</span>`
          : '';
        imagesHtml += `
          <div class="memo-image-wrap" data-src="${thumbUrl}" data-full-src="${fullUrl}" data-index="${idx}" data-memo-id="${id}">
            ${overflowHtml}
            <img class="lazy" data-src="${thumbUrl}" alt="${escapeHtml(img.filename || '')}" loading="lazy" decoding="async">
          </div>`;
      });
      imagesHtml += '</div>';
    }

    const attachmentsHtml = renderAttachmentCards(mediaAttachments);

    // 标签
    const tags = getMemoTags(memo);
    const tagsHtml = tags.length > 0
      ? `<div class="memo-tags">${tags.map(t => `<span class="memo-tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    // 链接预览占位
    const previewUrls = extractPreviewUrls(memo.content || '');
    let linkPreviewsHtml = '';
    if (previewUrls.length > 0) {
      linkPreviewsHtml = `<div class="link-previews" data-memo-name="${memo.name}">`;
      previewUrls.forEach(url => {
        linkPreviewsHtml += `
          <a class="link-preview" href="${escapeHtml(url)}" target="_blank" rel="noopener">
            <div class="link-preview-info">
              <div class="link-preview-domain">${escapeHtml(new URL(url).hostname)}</div>
            </div>
          </a>`;
      });
      linkPreviewsHtml += '</div>';
    }

    // Reactions
    const reactions = state.allReactions[memo.name] || [];
    const reactionsHtml = renderReactionsHtml(memo.name, reactions);

    // 分享
    const shareUrl = `${window.location.origin}${window.location.pathname}#memo-${id}`;
    const memoUrl = getMemoOriginalUrl(memo);

    // 展开收起（长内容）
    const visibleContent = hideContentTags(memo.content || '');
    const contentNeedsExpand = visibleContent.length > (CONFIG.CONTENT_COLLAPSE_THRESHOLD || 300);
    const expandBtnHtml = contentNeedsExpand
      ? `<button class="memo-expand-btn" data-memo-id="${id}">展开<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>`
      : '';

    const card = document.createElement('div');
    card.className = 'memo-card' + (memo.pinned ? ' pinned' : '');
    card.id = `memo-${id}`;
    card.dataset.memoName = memo.name;
    card.style.animationDelay = '0ms';

    card.innerHTML = `
      <span class="memo-checkbox" data-memo-name="${memo.name}" role="checkbox" aria-checked="false" tabindex="0"></span>
      <div class="memo-layout">
        <div class="memo-avatar" data-profile="avatar">${avatarHtml}</div>
        <div class="memo-main">
          <div class="memo-header">
            <div class="memo-meta">
              <div class="memo-author" data-profile="author">${escapeHtml(displayName)}${pinnedHtml}${visibilityBadge}</div>
            </div>
          </div>
          <div class="memo-content ${contentNeedsExpand ? 'collapsed' : ''}" data-memo-id="${id}">${renderMarkdown(memo.content || '', state.searchQuery)}</div>
          ${expandBtnHtml}
          ${imagesHtml}
          ${attachmentsHtml}
          ${tagsHtml}
          ${linkPreviewsHtml}
          <div class="memo-actions">
            <div class="memo-reactions" data-memo-name="${memo.name}">
              ${reactionsHtml}
            </div>
            <button class="memo-edit" title="编辑内容" data-memo-name="${memo.name}" style="${state.isGuest ? 'display:none;' : ''}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="memo-delete" title="删除内容" data-memo-name="${memo.name}" style="${state.isGuest ? 'display:none;' : ''}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
          <div class="memo-footer-meta">
            <div class="memo-footer-info"><a class="memo-time memo-time-link" href="${memoUrl}" target="_blank" rel="noopener noreferrer" title="在 Memos 中打开：${formatDate(createTime)}">${time}</a>${locationHtml}</div>
            <div class="memo-footer-tools">
              <button class="memo-more" title="更多操作" aria-label="更多操作" data-menu-for="${id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/>
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                  <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>
                </svg>
              </button>
              <div class="memo-more-menu" data-menu="${id}">
                <button class="memo-menu-share" type="button" data-url="${shareUrl}">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5"/></svg>
                  <span>复制分享</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    return card;
  }

  function renderReactionsHtml(memoName, reactions, options = {}) {
    const addBtn = options.includeAdd === false || state.isGuest ? '' : `<button class="reaction-add" title="添加反应" data-memo-name="${memoName}">☺</button>`;
    if (!reactions || reactions.length === 0) return addBtn;

    const grouped = {};
    reactions.forEach(r => {
      const emoji = r.emoji || r.reactionType || r.reaction_type;
      if (!emoji) return;
      if (!grouped[emoji]) grouped[emoji] = { count: 0 };
      grouped[emoji].count++;
    });

    let html = '';
    Object.entries(grouped).forEach(([emoji, info]) => {
      html += `<span class="reaction-item" title="${emoji} ${info.count}">
        <span class="reaction-emoji">${emoji}</span>
        <span class="reaction-count">${info.count > 1 ? info.count : ''}</span>
      </span>`;
    });
    html += addBtn;
    return html;
  }

  function renderAttachmentCards(attachments) {
    if (!attachments || attachments.length === 0) return '';
    const cards = attachments.map(file => {
      // 音视频/文件直接用 R2 原链接(externalLink),不经 memos 代理,更快且省带宽
      const url = attachmentOriginalUrl(file);
      const type = file.type || 'application/octet-stream';
      const name = escapeHtml(file.filename || file.name || '附件');
      const size = file.size ? `<span>${formatFileSize(Number(file.size))}</span>` : '';
      if (type.startsWith('video/')) {
        return `<div class="attachment-card attachment-video">
          <video src="${url}" controls controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture preload="metadata" playsinline></video>
          <div class="attachment-info"><strong>${name}</strong>${size}</div>
        </div>`;
      }
      if (type.startsWith('audio/')) {
        const audioId = `audio-${Math.random().toString(36).slice(2)}`;
        return `<div class="attachment-card attachment-audio">
          <div class="attachment-info audio-info">
            <strong>${name}</strong>
            <div class="audio-row" data-audio-id="${audioId}">
              <button class="audio-play" type="button" aria-label="播放音频" data-audio-id="${audioId}">
                <svg class="audio-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                <svg class="audio-pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
              </button>
              <span class="audio-time" data-audio-id="${audioId}">0:00/0:00</span>
              ${size}
              <audio id="${audioId}" src="${url}" preload="metadata" controlsList="nodownload noplaybackrate noremoteplayback"></audio>
            </div>
          </div>
        </div>`;
      }
      // 文件附件:直接打开 R2 原链接,而非下载(去掉 download 属性)
      return `<a class="attachment-card attachment-file" href="${url}" target="_blank" rel="noopener">
        <div class="attachment-icon attachment-icon-file"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg></div>
        <div class="attachment-info"><strong>${name}</strong><span>${escapeHtml(type)}</span>${size}</div>
      </a>`;
    }).join('');
    return `<div class="memo-attachments">${cards}</div>`;
  }

  function updateReactionsUI(memoName, reactions) {
    state.allReactions[memoName] = reactions;
    const container = document.querySelector(`.memo-reactions[data-memo-name="${memoName}"]`);
    if (container) {
      container.innerHTML = renderReactionsHtml(memoName, reactions);
      // 弹跳动画
      container.querySelectorAll('.reaction-item').forEach(el => {
        el.classList.add('pop');
        el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true });
      });
    }
  }

  // ==================== 内容展开收起 ====================

  function initExpandCollapse() {
    dom.memoList.addEventListener('click', (e) => {
      const btn = e.target.closest('.memo-expand-btn');
      if (!btn) return;

      const memoId = btn.dataset.memoId;
      const content = document.querySelector(`.memo-content[data-memo-id="${memoId}"]`);
      if (!content) return;

      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        btn.classList.add('expanded');
        btn.innerHTML = '收起<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      } else {
        content.classList.add('collapsed');
        content.classList.remove('expanded');
        btn.classList.remove('expanded');
        btn.innerHTML = '展开<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      }
    });
  }

  // ==================== 图片懒加载 ====================

  let lazyObserver = null;

  function initLazyLoad() {
    if (lazyObserver) lazyObserver.disconnect();

    lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const wrap = entry.target;
          const img = wrap.querySelector('img.lazy[data-src]') || wrap;
          if (img.dataset && img.dataset.src) {
            img.src = img.dataset.src;
            img.onload = () => {
              img.classList.add('loaded');
              wrap.classList.add('loaded');
            };
            img.onerror = () => {
              img.classList.add('loaded');
              wrap.classList.add('loaded');
            };
            img.removeAttribute('data-src');
          }
          lazyObserver.unobserve(wrap);
        }
      });
    }, { rootMargin: `${CONFIG.LAZY_LOAD_OFFSET}px` });

    document.querySelectorAll('.memo-image-wrap:not(.observed)').forEach(el => {
      el.classList.add('observed');
      lazyObserver.observe(el);
    });
  }

  // ==================== 图片点击灯箱（事件委托） ====================

  function initImageClicks() {
    dom.memoList.addEventListener('click', (e) => {
      const wrap = e.target.closest('.memo-image-wrap');
      if (!wrap) return;
      const memoId = wrap.dataset.memoId;
      const index = parseInt(wrap.dataset.index);
      openLightbox(memoId, index);
    });
  }

  // ==================== 无限滚动 ====================

  function initInfiniteScroll() {
    const sentinel = dom.loadMore;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.hasMore && !state.loading) {
        loadMore();
      }
    }, { rootMargin: '300px' });
    observer.observe(sentinel);
  }

  // ==================== 数据加载 ====================

  async function loadInitial(forceRefresh = false) {
    state.loading = true;
    state.firstLoad = true;
    state.loadedCount = 0;
    state.paginationPage = 1;

    // 判断是否可以从缓存快速渲染
    const canRestore = !forceRefresh && state.allPublicMemos.length === 0 && cacheManager.memos;
    const isCacheValid = canRestore && cacheManager.memos.length > 0;

    // 如果有缓存，先隐藏骨架屏，后续用缓存数据立即渲染
    if (isCacheValid) {
      dom.skeletonWrap.style.display = 'none';
    } else if (dom.memoList.children.length === 0) {
      dom.skeletonWrap.style.display = '';
    }

    dom.memoList.innerHTML = '';
    dom.loadMore.style.display = 'none';
    dom.loadMoreClick.style.display = 'none';
    dom.paginationNav.style.display = 'none';
    dom.emptyState.style.display = 'none';
    dom.searchEmpty.style.display = 'none';
    dom.endState.style.display = 'none';

    try {
      await fetchAllPublicMemos(forceRefresh);
      const filtered = getFilteredMemos();
      const totalPages = Math.ceil(filtered.length / CONFIG.PAGE_SIZE) || 1;
      state.paginationTotalPages = totalPages;
      state.memos = filtered.slice(0, CONFIG.PAGE_SIZE);
      state.loadedCount = state.memos.length;
      // hasMore:本地数据未显示完,或后端还有下一页(nextPageToken)
      state.hasMore = filtered.length > state.loadedCount || !!state.nextPageToken;

      dom.skeletonWrap.style.display = 'none';

      if (state.memos.length === 0) {
        if (state.searchQuery || state.activeTag !== 'all') {
          dom.searchEmpty.style.display = '';
        } else {
          dom.emptyState.style.display = '';
        }
        state.loading = false;
        return state.memos;
      }

      renderCards(state.memos);
      initLazyLoad();

      // 延迟发起 reactions / link previews 请求,避免与首屏图片加载竞争带宽
      // 首屏渲染完、浏览器空闲后再拉取这些次要数据
      const deferHeavyFetch = (fn) => {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => fn(), { timeout: 3000 });
        } else {
          setTimeout(fn, 600);
        }
      };
      deferHeavyFetch(() => {
        // reactions 默认不首屏拉取(20 条各发一个请求,拖慢首屏),改为点击时按需拉取
        if (CONFIG.ENABLE_REACTIONS_FETCH) loadReactions(state.memos);
        loadLinkPreviews(state.memos);
      });

      updatePaginationUI();

      // 缓存已渲染，尽早后台刷新以拉取新内容
      // 用 requestIdleCallback 避免与首屏渲染及 reactions/previews 请求竞争
      if (state.cacheRestored && !forceRefresh) {
        state.cacheRestored = false;
        const triggerRefresh = () => silentRefresh();
        if ('requestIdleCallback' in window) {
          requestIdleCallback(triggerRefresh, { timeout: 2000 });
        } else {
          setTimeout(triggerRefresh, 1000);
        }
      }
    } catch (e) {
      console.error('Failed to load memos:', e);
      // 如果缓存恢复失败且没有数据，才显示错误
      if (state.allPublicMemos.length === 0) {
        dom.skeletonWrap.style.display = 'none';
        dom.emptyState.style.display = '';
        showToast('加载失败，请检查配置', 'error');
      }
    }

    state.loading = false;
    state.firstLoad = false;
    return state.memos;
  }

  // 后台静默刷新：精确检测真正的新 memo 并增量插入
  async function silentRefresh() {
    try {
      const data = await fetchMemos('');
      const freshMemos = data.memos || [];

      // 如果后端还有更多历史分页未补全,触发后台补全(覆盖缓存不完整的情况)
      const nextToken = data.nextPageToken || data.next_page_token || '';
      if (nextToken && !state.backgroundFetchPromise) {
        startBackgroundFetch(nextToken);
      }

      if (freshMemos.length === 0 || state.allPublicMemos.length === 0) return;

      // 用 name 集合精确判断：只有之前完全不存在的 memo 才算"新增"
      const existingNames = new Set(state.allPublicMemos.map(m => m.name));
      const trulyNew = freshMemos.filter(m => !existingNames.has(m.name));

      if (trulyNew.length === 0) return; // 没有真正的新内容

      // 按 API 返回顺序（即 pinned desc, create_time desc）prepend 新 memo
      for (const m of trulyNew.reverse()) {
        state.allPublicMemos.unshift(m);
        existingNames.add(m.name);
      }

      // 重新过滤+分页
      const filtered = getFilteredMemos();
      state.paginationTotalPages = Math.ceil(filtered.length / CONFIG.PAGE_SIZE) || 1;

      // 如果在第一页且无搜索/标签过滤，prepend 新卡片到 DOM 顶部
      if (state.paginationPage === 1 && !state.searchQuery && state.activeTag === 'all' && !state.visibilityFilter) {
        const visibleNew = trulyNew.filter(m => {
          if (state.isGuest && !isPublicMemo(m)) return false;
          return true;
        });
        if (visibleNew.length > 0) {
          const frag = document.createDocumentFragment();
          visibleNew.reverse().forEach(m => {
            const card = renderMemoCard(m);
            if (card) {
              card.style.animation = 'none';
              card.style.opacity = '1';
              frag.prepend(card);
            }
          });
          dom.memoList.prepend(frag);
          state.memos = filtered.slice(0, CONFIG.PAGE_SIZE);
          state.loadedCount = state.memos.length;
          state.hasMore = filtered.length > state.loadedCount || !!state.nextPageToken;
          if (CONFIG.ENABLE_REACTIONS_FETCH) loadReactions(visibleNew);
          loadLinkPreviews(visibleNew);
        }
      }

      // 更新缓存
      cacheManager.memos = state.allPublicMemos;

      showToast(`${trulyNew.length} 条新内容`, 'info', 1500);
    } catch (err) {
      console.warn('Silent refresh failed:', err);
    }
  }

  async function loadMore() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    dom.loadMore.style.display = '';
    dom.loadMoreClickBtn.disabled = true;

    try {
      let newMemos = [];
      const filtered = getFilteredMemos();

      // 1) 优先用本地已有数据(缓存恢复或后台补全已完成的场景)
      if (filtered.length > state.loadedCount) {
        newMemos = filtered.slice(state.loadedCount, state.loadedCount + CONFIG.PAGE_SIZE);
      }
      // 2) 本地数据不够,且有 nextPageToken:直接调 API 拉下一页(不等后台补全)
      //    用 PAGE_SIZE 而非 200,只拉需要的一页,快速且省流量
      else if (state.nextPageToken) {
        // 取出当前 token,立即清空,避免后台补全用同一 token 重复拉取
        const tokenToUse = state.nextPageToken;
        state.nextPageToken = '';
        try {
          const data = await fetchMemos(tokenToUse, CONFIG.PAGE_SIZE);
          state.nextPageToken = data.nextPageToken || data.next_page_token || '';
          const fetched = (data.memos || []).filter(m => state.isGuest ? isPublicMemo(m) : true);
          // 去重后追加到 allPublicMemos(供搜索/统计使用)
          const existing = new Set(state.allPublicMemos.map(m => m.name));
          const fresh = fetched.filter(m => !existing.has(m.name));
          state.allPublicMemos.push(...fresh);
          // 重新过滤并切片(可能有 searchQuery/activeTag 过滤)
          const newFiltered = getFilteredMemos();
          newMemos = newFiltered.slice(state.loadedCount, state.loadedCount + CONFIG.PAGE_SIZE);
        } catch (fetchErr) {
          // 拉取失败:恢复 token,让用户可重试
          state.nextPageToken = tokenToUse;
          throw fetchErr;
        }
      }

      state.loadedCount += newMemos.length;
      // hasMore:后端还有下一页,或本地数据未显示完
      state.hasMore = !!state.nextPageToken || getFilteredMemos().length > state.loadedCount;

      if (newMemos.length === 0) {
        state.hasMore = false;
        dom.loadMore.style.display = 'none';
        dom.loadMoreClick.style.display = 'none';
        dom.endState.style.display = '';
        state.loading = false;
        return;
      }

      state.memos.push(...newMemos);
      renderCards(newMemos, true);
      if (CONFIG.ENABLE_REACTIONS_FETCH) loadReactions(newMemos);
      loadLinkPreviews(newMemos);
      initLazyLoad();

      updatePaginationUI();
    } catch (e) {
      console.error('Failed to load more:', e);
      showToast('加载更多失败', 'error');
    }

    dom.loadMoreClickBtn.disabled = false;
    state.loading = false;
  }

  function renderCards(memos, append = false) {
    if (!append) dom.memoList.innerHTML = '';
    memos.forEach((memo, idx) => {
      const card = renderMemoCard(memo);
      if (append) card.style.animationDelay = `${idx * 60}ms`;
      dom.memoList.appendChild(card);
    });
    initializeAudioMetadata();
  }

  function updatePaginationUI() {
    const mode = CONFIG.PAGINATION_MODE;
    const hasMore = state.hasMore;
    dom.loadMore.style.display = 'none';
    dom.loadMoreClick.style.display = 'none';
    dom.paginationNav.style.display = 'none';

    if (mode === 'pagination') {
      dom.paginationNav.style.display = 'flex';
      dom.pagCurrent.textContent = String(state.paginationPage);
      dom.pagTotal.textContent = String(state.paginationTotalPages);
      dom.pagPrev.disabled = state.paginationPage <= 1;
      dom.pagNext.disabled = state.paginationPage >= state.paginationTotalPages;
      if (state.memos.length === 0) dom.paginationNav.style.display = 'none';
    } else if (mode === 'loadmore') {
      if (hasMore) {
        dom.loadMoreClick.style.display = 'flex';
      } else {
        dom.endState.style.display = '';
      }
    } else {
      // infinite
      if (hasMore) {
        dom.loadMore.style.display = '';
      } else {
        dom.endState.style.display = '';
      }
    }
  }

  function goToPage(page) {
    const filtered = getFilteredMemos();
    const totalPages = Math.ceil(filtered.length / CONFIG.PAGE_SIZE) || 1;
    const targetPage = Math.max(1, Math.min(page, totalPages));
    state.paginationPage = targetPage;
    const start = (targetPage - 1) * CONFIG.PAGE_SIZE;
    const pageMemos = filtered.slice(start, start + CONFIG.PAGE_SIZE);
    state.memos = pageMemos;
    state.loadedCount = start + pageMemos.length;
    state.hasMore = filtered.length > state.loadedCount;

    dom.skeletonWrap.style.display = 'none';
    dom.memoList.innerHTML = '';
    if (pageMemos.length === 0) {
      dom.emptyState.style.display = '';
      updatePaginationUI();
      return;
    }
    renderCards(pageMemos);
    if (CONFIG.ENABLE_REACTIONS_FETCH) loadReactions(pageMemos);
    loadLinkPreviews(pageMemos);
    initLazyLoad();
    updatePaginationUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==================== 批量操作 ====================

  function enterBatchMode() {
    state.batchMode = true;
    state.selectedMemos = new Set();
    document.body.classList.add('batch-mode');
    dom.batchToolbar.classList.add('active');
    dom.memoList.querySelectorAll('.memo-checkbox').forEach(cb => cb.classList.add('visible'));
    updateBatchUI();
    showToast('点击卡片右上角勾选内容', 'success', 2000);
  }

  function exitBatchMode() {
    state.batchMode = false;
    state.selectedMemos = new Set();
    document.body.classList.remove('batch-mode');
    dom.batchToolbar.classList.remove('active');
    dom.memoList.querySelectorAll('.memo-card').forEach(card => {
      card.classList.remove('batch-selected');
    });
    dom.memoList.querySelectorAll('.memo-checkbox.checked').forEach(cb => {
      cb.classList.remove('checked');
      cb.setAttribute('aria-checked', 'false');
    });
  }

  function toggleMemoSelection(memoName) {
    if (!state.batchMode) return;
    if (state.selectedMemos.has(memoName)) {
      state.selectedMemos.delete(memoName);
    } else {
      state.selectedMemos.add(memoName);
    }
    const checkbox = dom.memoList.querySelector(`.memo-checkbox[data-memo-name="${memoName}"]`);
    const card = checkbox?.closest('.memo-card');
    const isChecked = state.selectedMemos.has(memoName);
    if (checkbox) {
      checkbox.classList.toggle('checked', isChecked);
      checkbox.setAttribute('aria-checked', String(isChecked));
    }
    if (card) card.classList.toggle('batch-selected', isChecked);
    updateBatchUI();
  }

  function updateBatchUI() {
    const count = state.selectedMemos.size;
    dom.batchCount.textContent = count > 0 ? `已选择 ${count} 项` : '选择内容';
  }

  async function batchSetVisibility(visibility) {
    const names = [...state.selectedMemos];
    if (names.length === 0) {
      showToast('请先勾选要操作的内容', 'warning');
      return;
    }
    if (!confirm(`确定将 ${names.length} 项设为${visibility === 'PUBLIC' ? '公开' : visibility === 'PRIVATE' ? '私密' : '登录可见'}吗？`)) return;
    dom.batchCount.textContent = '处理中...';
    let success = 0, fail = 0;
    for (const name of names) {
      try {
        await updateMemo({ name, visibility, fields: ['visibility'] });
        success++;
      } catch { fail++; }
    }
    showToast(`操作完成：${success} 成功${fail ? `，${fail} 失败` : ''}`, fail ? 'warning' : 'success');
    exitBatchMode();
    cacheManager.invalidateAll();
    await loadInitial(true);
  }

  async function batchDelete() {
    const names = [...state.selectedMemos];
    if (names.length === 0) {
      showToast('请先勾选要删除的内容', 'warning');
      return;
    }
    if (!confirm(`确定删除 ${names.length} 项吗？此操作不可撤销！`)) return;
    dom.batchCount.textContent = '删除中...';
    let success = 0, fail = 0;
    for (const name of names) {
      try {
        await deleteMemo(name);
        success++;
      } catch { fail++; }
    }
    showToast(`删除完成：${success} 成功${fail ? `，${fail} 失败` : ''}`, fail ? 'warning' : 'success');
    exitBatchMode();
    cacheManager.invalidateAll();
    await loadInitial(true);
  }

  function initializeAudioMetadata() {
    dom.memoList.querySelectorAll('.audio-row audio').forEach(audio => {
      if (audio.dataset.metadataInit) return;
      audio.dataset.metadataInit = '1';
      audio.addEventListener('loadedmetadata', () => syncAudioPlayer(audio), { once: true });
      audio.load();
      syncAudioPlayer(audio);
      setTimeout(() => syncAudioPlayer(audio), 500);
      setTimeout(() => syncAudioPlayer(audio), 1500);
    });
  }

  async function renderUntilMemo(targetId) {
    await fetchAllPublicMemos(false);
    const filtered = getFilteredMemos();
    const targetIndex = filtered.findIndex(memo => memoId(memo.name) === targetId);
    if (targetIndex < 0) return null;

    const neededCount = Math.ceil((targetIndex + 1) / CONFIG.PAGE_SIZE) * CONFIG.PAGE_SIZE;
    state.memos = filtered.slice(0, neededCount);
    state.loadedCount = state.memos.length;
    state.hasMore = filtered.length > state.loadedCount;
    renderCards(state.memos);
    if (CONFIG.ENABLE_REACTIONS_FETCH) loadReactions(state.memos);
    loadLinkPreviews(state.memos);
    initLazyLoad();
    dom.loadMore.style.display = state.hasMore ? '' : 'none';
    dom.endState.style.display = state.hasMore ? 'none' : '';
    return document.getElementById(`memo-${targetId}`);
  }

  async function scrollToHashMemo() {
    if (!window.location.hash.startsWith('#memo-')) return;
    const id = window.location.hash.replace('#memo-', '');
    state.hashView = true;
    // 隐藏筛选导航栏
    if (dom.tagsNav) dom.tagsNav.style.display = 'none';
    if (dom.visFilterBar) dom.visFilterBar.style.display = 'none';
    if (dom.hashBackBtn) dom.hashBackBtn.style.display = '';
    // 禁用无限滚动
    state.hasMore = false;
    dom.endState.style.display = 'none';
    dom.loadMore.style.display = 'none';
    // 加载所有内容找目标 memo
    await fetchAllPublicMemos(false);
    const filtered = getFilteredMemos();
    const target = filtered.find(memo => memoId(memo.name) === id);
    if (target) {
      state.hashViewMemo = target;
      state.memos = [target];
      state.loadedCount = 1;
      dom.memoList.innerHTML = '';
      renderCards(state.memos);
      if (CONFIG.ENABLE_REACTIONS_FETCH) loadReactions(state.memos);
      loadLinkPreviews(state.memos);
      initLazyLoad();
      // 平滑滚动到卡片
      setTimeout(() => {
        const card = document.getElementById(`memo-${id}`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    } else {
      // memo 未找到，退回到全部视图
      exitHashView();
    }
  }

  function exitHashView() {
    state.hashView = false;
    state.hashViewMemo = null;
    if (dom.hashBackBtn) dom.hashBackBtn.style.display = 'none';
    if (dom.tagsNav) dom.tagsNav.style.display = '';
    updatePublishAuthUI(); // 重新控制 visFilterBar 显示
    history.replaceState(null, '', window.location.pathname || '/');
    loadInitial(true);
  }

  async function loadReactions(memos) {
    // 尝试从缓存恢复所有反应
    const cachedReactions = cacheManager.reactions;
    if (cachedReactions && !state.allReactions.restored) {
      Object.assign(state.allReactions, cachedReactions);
      state.allReactions.restored = true;
    }

    // 分批并发拉取,避免一次性 20 个请求冲击 vercel serverless (并发限制/冷启动雪崩)
    // 每批 5 个并发,批间微延迟
    const CONCURRENCY = 5;
    const needFetch = memos.filter(memo => {
      if (state.allReactions[memo.name]) {
        updateReactionsUI(memo.name, state.allReactions[memo.name]);
        return false;
      }
      return true;
    });

    for (let i = 0; i < needFetch.length; i += CONCURRENCY) {
      const batch = needFetch.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(memo =>
        fetchReactions(memo.name).then(reactions => {
          state.allReactions[memo.name] = reactions;
          updateReactionsUI(memo.name, reactions);
        })
      ));
    }

    cacheManager.reactions = state.allReactions;
  }

  async function loadLinkPreviews(memos) {
    // 从缓存恢复链接预览数据
    const cachedPreviews = cacheManager.linkPreviews;
    if (cachedPreviews) {
      Object.assign(state.linkPreviewCache, cachedPreviews);
    }

    for (const memo of memos) {
      const urls = extractPreviewUrls(memo.content || '');
      if (urls.length === 0) continue;
      const container = document.querySelector(`.link-previews[data-memo-name="${memo.name}"]`);
      if (!container) continue;

      const results = await Promise.allSettled(
        urls.filter(canPreviewUrl).map(url => {
          // 检查缓存
          if (state.linkPreviewCache[url]) {
            return Promise.resolve({ url, meta: state.linkPreviewCache[url] });
          }
          return fetchLinkMetadata(url).then(meta => ({ url, meta }));
        })
      );
      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const { url, meta } = result.value;
        if (!meta || !(meta.title || meta.description || meta.image)) continue;
        // 缓存结果
        state.linkPreviewCache[url] = meta;
        const linkEl = container.querySelector(`a[href="${url}"]`);
        if (linkEl) {
          let imgUrl = '';
          if (meta.image) {
            imgUrl = meta.image.startsWith('http') ? meta.image : (CONFIG.USE_PROXY ? '/api/proxy?path=' + encodeURIComponent(meta.image) : CONFIG.MEMOS_URL + meta.image);
          }
          linkEl.innerHTML = `
            ${imgUrl ? `<img class="link-preview-img" src="${imgUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="link-preview-info">
              <div class="link-preview-title">${escapeHtml(meta.title || '')}</div>
              ${meta.description ? `<div class="link-preview-desc">${escapeHtml(meta.description)}</div>` : ''}
              <div class="link-preview-domain">${escapeHtml(new URL(url).hostname)}</div>
            </div>`;
        }
      }
    }

    // 缓存链接预览数据
    cacheManager.linkPreviews = state.linkPreviewCache;
  }

  // ==================== 标签管理 ====================

  function collectTags() {
    const tagSet = new Set();
    state.allPublicMemos.forEach(m => getMemoTags(m).forEach(t => tagSet.add(t)));
    state.allTags = [...tagSet].sort();
    cacheManager.tags = state.allTags;
    renderTagsNav();
  }

  function renderTagsNav() {
    dom.tagsNavInner.innerHTML = `<button class="tag-chip ${state.activeTag === 'all' ? 'active' : ''}" data-tag="all">全部</button>`;
    state.allTags.forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'tag-chip' + (state.activeTag === tag ? ' active' : '');
      btn.dataset.tag = tag;
      btn.textContent = '#' + tag;
      dom.tagsNavInner.appendChild(btn);
    });
  }

  function setActiveTag(tag) {
    state.activeTag = tag;
    state.activeDate = '';
    renderTagsNav();
    // 滚动到激活标签可见
    const activeChip = dom.tagsNavInner.querySelector('.tag-chip.active');
    if (activeChip) {
      activeChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    loadInitial();
  }

  // ==================== 搜索 ====================

  const debouncedSearch = debounce((query) => {
    state.searchQuery = query.trim();
    state.activeDate = '';
    // 更新清除按钮可见性
    dom.searchClear.classList.toggle('visible', query.trim().length > 0);
    loadInitial();
  }, CONFIG.SEARCH_DEBOUNCE);

  function toggleSearch(forceClose) {
    const isOpen = forceClose ? false : dom.searchBar.classList.toggle('open');
    if (forceClose) dom.searchBar.classList.remove('open');
    dom.btnSearch.classList.toggle('active', isOpen);
    if (isOpen) {
      dom.searchInput.focus();
    } else {
      dom.searchInput.value = '';
      dom.searchClear.classList.remove('visible');
      state.searchQuery = '';
      // 如果有关闭搜索框且之前有搜索结果，刷新列表
      if (forceClose) loadInitial();
    }
  }

  function closeSearch() {
    if (dom.searchBar.classList.contains('open')) {
      toggleSearch(true);
    }
  }

  // ==================== 统计面板 ====================

  function collectStatsData() {
    const computedTagCounts = {};
    const media = { images: 0, audio: 0, video: 0, files: 0 };
    const timestamps = state.allPublicMemos
      .map(memo => getMemoTime(memo, 'create'))
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b));
    state.allPublicMemos.forEach(memo => {
      getMemoTags(memo).forEach(tag => {
        computedTagCounts[tag] = (computedTagCounts[tag] || 0) + 1;
      });
      (memo.attachments || memo.resources || []).forEach(file => {
        const type = file.type || '';
        if (type.startsWith('image/')) media.images++;
        else if (type.startsWith('audio/')) media.audio++;
        else if (type.startsWith('video/')) media.video++;
        else media.files++;
      });
    });
    const activeDays = new Set(timestamps.map(ts => formatDate(ts)));
    const latestTime = timestamps.length > 0
      ? timestamps.slice().sort((a, b) => new Date(b) - new Date(a))[0]
      : '';
    return {
      memoCount: state.allPublicMemos.length,
      tagCounts: computedTagCounts,
      timestamps,
      activeDays,
      latestTime,
      media,
    };
  }

  function renderStatsTabs() {
    return `<div class="stats-tabs" role="tablist" aria-label="统计分类">
      ${[
        ['calendar', '日历'],
        ['tags', '标签'],
        ['overview', '统计'],
      ].map(([key, label]) => `<button class="stats-tab ${state.statsTab === key ? 'active' : ''}" data-tab="${key}" role="tab" aria-selected="${state.statsTab === key}">${label}</button>`).join('')}
    </div>`;
  }

  function renderCalendarPanel(timestamps) {
    const viewDate = new Date(state.statsYear, state.statsMonth, 1);
    const monthLabel = `${viewDate.getFullYear()} 年 ${String(viewDate.getMonth() + 1).padStart(2, '0')} 月`;
    const heatMapData = {};
    timestamps.forEach(ts => {
      const d = formatDate(ts);
      heatMapData[d] = (heatMapData[d] || 0) + 1;
    });
    let html = `<div class="stats-panel active" data-panel="calendar">
      <div class="calendar-title"><span>发布日历</span><div class="calendar-controls"><button class="calendar-nav" data-dir="-1" aria-label="上个月">‹</button><strong>${monthLabel}</strong><button class="calendar-nav" data-dir="1" aria-label="下个月">›</button></div></div>
      <div class="month-calendar"><div class="month-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div class="month-days">`;
    const firstDay = new Date(state.statsYear, state.statsMonth, 1);
    const daysInMonth = new Date(state.statsYear, state.statsMonth + 1, 0).getDate();
    const leadingBlanks = firstDay.getDay();
    for (let i = 0; i < leadingBlanks; i++) html += '<span class="month-day empty" aria-hidden="true"></span>';
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(state.statsYear, state.statsMonth, day);
      const dateStr = formatDate(d.toISOString());
      const count = heatMapData[dateStr] || 0;
      const tip = `${dateStr} · ${count} 条`;
      html += `<button class="month-day ${count ? 'has-count' : ''}" data-date="${dateStr}" data-count="${count}" aria-label="${tip}" title="${tip}"><span>${day}</span>${count ? `<em>${count}</em>` : ''}</button>`;
    }
    html += '</div></div></div>';
    return html;
  }

  function renderTagsPanel(tagCounts) {
    let html = `<div class="stats-panel active" data-panel="tags"><div class="stats-section-title">标签分类</div><div class="tag-cloud">`;
    html += `<span class="tag-cloud-item ${state.activeTag === 'all' ? 'active' : ''}" data-tag="all">全部</span>`;
    Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
      const isActive = state.activeTag === tag ? 'active' : '';
      html += `<span class="tag-cloud-item ${isActive}" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}<span class="tag-cloud-count">${count}</span></span>`;
    });
    html += '</div></div>';
    return html;
  }

  function renderOverviewPanel(data) {
    const { memoCount, tagCounts, activeDays, latestTime, media } = data;
    return `<div class="stats-panel active" data-panel="overview">
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${memoCount}</div><div class="stat-label">Memo 总数</div></div>
        <div class="stat-card"><div class="stat-value">${activeDays.size}</div><div class="stat-label">活跃天数</div></div>
        <div class="stat-card"><div class="stat-value">${Object.keys(tagCounts).length}</div><div class="stat-label">标签数</div></div>
        <div class="stat-card"><div class="stat-value">${latestTime ? timeAgo(latestTime) : '-'}</div><div class="stat-label">最新发布</div></div>
      </div>
      <div class="stats-section-title">媒体统计</div>
      <div class="stats-grid compact">
        <div class="stat-card"><div class="stat-value">${media.images}</div><div class="stat-label">图片</div></div>
        <div class="stat-card"><div class="stat-value">${media.audio}</div><div class="stat-label">音频</div></div>
        <div class="stat-card"><div class="stat-value">${media.video}</div><div class="stat-label">视频</div></div>
        <div class="stat-card"><div class="stat-value">${media.files}</div><div class="stat-label">文件</div></div>
      </div>
    </div>`;
  }

  async function openStats() {
    dom.statsModal.classList.add('open');
    dom.statsClose.focus();
    dom.statsBody.innerHTML = '<div class="load-more" style="padding:30px 0"><div class="loader"><div class="loader-dot"></div><div class="loader-dot"></div><div class="loader-dot"></div></div></div>';
    dom.btnStats.classList.add('active');

    try {
      await fetchAllPublicMemos(false);
      const data = collectStatsData();
      let html = renderStatsTabs();
      if (state.statsTab === 'calendar') html += renderCalendarPanel(data.timestamps);
      if (state.statsTab === 'tags') html += renderTagsPanel(data.tagCounts);
      if (state.statsTab === 'overview') html += renderOverviewPanel(data);
      dom.statsBody.innerHTML = html;

      dom.statsBody.querySelectorAll('.stats-tab').forEach(el => {
        el.addEventListener('click', async () => {
          state.statsTab = el.dataset.tab;
          await openStats();
        });
      });
      dom.statsBody.querySelectorAll('.tag-cloud-item').forEach(el => {
        el.addEventListener('click', () => {
          closeStats();
          state.activeDate = '';
          setActiveTag(el.dataset.tag);
        });
      });
      dom.statsBody.querySelectorAll('.calendar-nav').forEach(btn => {
        btn.addEventListener('click', async () => {
          state.statsMonth += Number(btn.dataset.dir);
          if (state.statsMonth < 0) {
            state.statsMonth = 11;
            state.statsYear -= 1;
          } else if (state.statsMonth > 11) {
            state.statsMonth = 0;
            state.statsYear += 1;
          }
          await openStats();
        });
      });
      dom.statsBody.querySelectorAll('.month-day[data-date]').forEach(el => {
        el.addEventListener('click', () => {
          closeStats();
          state.activeDate = el.dataset.date;
          state.activeTag = 'all';
          state.searchQuery = '';
          dom.searchInput.value = '';
          dom.searchClear.classList.remove('visible');
          renderTagsNav();
          loadInitial().then(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showToast(`已筛选 ${state.activeDate} 的内容`, 'success', 1800);
          });
        });
      });
    } catch {
      dom.statsBody.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">无法加载统计数据</p>';
    }
  }

  function closeStats() {
    dom.statsModal.classList.remove('open');
    dom.btnStats.classList.remove('active');
  }

  // ==================== 灯箱（增强：触摸手势、加载过渡） ====================

  function buildLightboxMap() {
    const map = {};
    state.memos.forEach(memo => {
      const mid = memoId(memo.name);
      map[mid] = (memo.attachments || [])
        .filter(a => a.type && a.type.startsWith('image/'))
        .map((img, index) => ({
          src: attachmentOriginalUrl(img),
          index,
        }));
    });
    return map;
  }

  function openLightbox(memoId, index) {
    const map = buildLightboxMap();
    state.lightboxImages = map[memoId] || [];
    state.lightboxIndex = index;
    if (state.lightboxImages.length === 0) return;

    showLightboxImage();
    dom.lightbox.style.display = '';
    document.body.style.overflow = 'hidden';
  }

  function showLightboxImage() {
    const img = state.lightboxImages[state.lightboxIndex];
    if (!img) return;

    // 加载过渡
    dom.lightboxImg.style.opacity = '0';
    dom.lightboxImg.src = img.src;
    dom.lightboxImg.onload = () => { dom.lightboxImg.style.opacity = '1'; };

    dom.lightboxCounter.textContent = `${state.lightboxIndex + 1} / ${state.lightboxImages.length}`;
    dom.lightboxPrev.style.display = state.lightboxImages.length > 1 ? '' : 'none';
    dom.lightboxNext.style.display = state.lightboxImages.length > 1 ? '' : 'none';
  }

  function closeLightbox() {
    dom.lightbox.style.display = 'none';
    document.body.style.overflow = '';
  }

  function lightboxPrev() {
    if (state.lightboxImages.length <= 1) return;
    state.lightboxIndex = (state.lightboxIndex - 1 + state.lightboxImages.length) % state.lightboxImages.length;
    dom.lightboxImgWrap.style.transform = 'translateX(-20px)';
    setTimeout(() => {
      showLightboxImage();
      dom.lightboxImgWrap.style.transform = 'translateX(20px)';
      requestAnimationFrame(() => { dom.lightboxImgWrap.style.transform = 'translateX(0)'; });
    }, 100);
  }

  function lightboxNext() {
    if (state.lightboxImages.length <= 1) return;
    state.lightboxIndex = (state.lightboxIndex + 1) % state.lightboxImages.length;
    dom.lightboxImgWrap.style.transform = 'translateX(20px)';
    setTimeout(() => {
      showLightboxImage();
      dom.lightboxImgWrap.style.transform = 'translateX(-20px)';
      requestAnimationFrame(() => { dom.lightboxImgWrap.style.transform = 'translateX(0)'; });
    }, 100);
  }

  // 灯箱触摸手势
  function initLightboxTouch() {
    const lb = dom.lightbox;
    lb.addEventListener('touchstart', (e) => {
      state.lightboxTouchStartX = e.touches[0].clientX;
      state.lightboxTouchStartY = e.touches[0].clientY;
      state.lightboxSwipeHandled = false;
    }, { passive: true });

    lb.addEventListener('touchmove', (e) => {
      if (state.lightboxSwipeHandled) return;
      const dx = e.touches[0].clientX - state.lightboxTouchStartX;
      const dy = e.touches[0].clientY - state.lightboxTouchStartY;
      // 水平滑动为主
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        state.lightboxSwipeHandled = true;
        if (dx < 0) lightboxNext(); else lightboxPrev();
      }
    }, { passive: true });

    // 双击放大/还原
    let lastTapTime = 0;
    lb.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTapTime < 300 && !state.lightboxSwipeHandled) {
        // 双击
        const currentScale = dom.lightboxImg.style.transform.includes('scale(') ? 2 : 1;
        dom.lightboxImg.style.transform = currentScale === 1 ? 'scale(2)' : 'scale(1)';
      }
      lastTapTime = now;
    }, { passive: true });
  }

  // ==================== Reactions Picker（增强：自适应定位） ====================

  function showReactionPicker(event, memoName) {
    event.stopPropagation();
    const picker = dom.reactionPicker;
    const inner = dom.reactionPickerInner;
    inner.innerHTML = '';

    CONFIG.REACTION_EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'reaction-picker-btn';
      btn.textContent = emoji;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addReaction(memoName, emoji, e);
        hideReactionPicker();
      });
      inner.appendChild(btn);
    });

    picker.style.display = '';
    // 自适应定位：优先在按钮上方，空间不够则在下方
    const rect = event.target.getBoundingClientRect();
    const pickerHeight = 56;
    if (rect.top > pickerHeight + 10) {
      // 在上方
      picker.style.top = (rect.top - pickerHeight - 8) + 'px';
    } else {
      // 在下方
      picker.style.top = (rect.bottom + 8) + 'px';
    }
    picker.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - CONFIG.REACTION_EMOJIS.length * 44 - 20)) + 'px';
  }

  function hideReactionPicker() {
    dom.reactionPicker.style.display = 'none';
  }

  // ==================== 分享（事件委托） ====================

  function initShare() {
    dom.memoList.addEventListener('click', (e) => {
      const moreBtn = e.target.closest('.memo-more');
      if (moreBtn) {
        e.stopPropagation();
        const menu = moreBtn.parentElement.querySelector('.memo-more-menu');
        document.querySelectorAll('.memo-more-menu.open').forEach(item => {
          if (item !== menu) {
            item.classList.remove('open');
            item.parentElement.querySelector('.memo-more')?.classList.remove('is-open');
          }
        });
        menu?.classList.toggle('open');
        moreBtn.classList.toggle('is-open', menu?.classList.contains('open'));
        return;
      }
      const shareBtn = e.target.closest('.memo-menu-share');
      if (!shareBtn) return;
      e.stopPropagation();
      const url = shareBtn.dataset.url;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast('链接已复制到剪贴板', 'success');
        }).catch(() => {
          fallbackCopy(url);
        });
      } else {
        fallbackCopy(url);
      }
      const menu = shareBtn.closest('.memo-more-menu');
      menu?.classList.remove('open');
      menu?.parentElement.querySelector('.memo-more')?.classList.remove('is-open');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.memo-footer-tools')) {
        document.querySelectorAll('.memo-more-menu.open').forEach(item => {
          item.classList.remove('open');
          item.parentElement.querySelector('.memo-more')?.classList.remove('is-open');
        });
      }
    });
  }

  function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
      showToast('链接已复制到剪贴板', 'success');
    } catch {
      showToast('复制失败', 'error');
    }
    document.body.removeChild(input);
  }

  // ==================== SSE / 轮询 ====================

  function initRealTimeUpdates() {
    // 代理模式下 SSE 不可用，直接回退到轮询
    if (CONFIG.USE_PROXY || !CONFIG.ENABLE_SSE) {
      if (CONFIG.SSE_POLL_INTERVAL > 0) {
        state.pollTimer = setInterval(pollNewMemos, CONFIG.SSE_POLL_INTERVAL);
      }
      return;
    }
    try {
      const sseUrl = CONFIG.MEMOS_URL + CONFIG.API_PREFIX + '/sse';
      const eventSource = new EventSource(sseUrl);
      state.sseConnection = eventSource;
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'memo.created' || data.type === 'memo.updated') {
            pollNewMemos();
          }
        } catch { /* ignore */ }
      };
      eventSource.onerror = () => {
        eventSource.close();
        if (!state.pollTimer) {
          state.pollTimer = setInterval(pollNewMemos, CONFIG.SSE_POLL_INTERVAL);
        }
      };
    } catch {
      state.pollTimer = setInterval(pollNewMemos, CONFIG.SSE_POLL_INTERVAL);
    }
  }

  async function pollNewMemos() {
    try {
      const data = await fetchMemos('');
      const latestMemos = data.memos || [];
      if (latestMemos.length === 0 || state.allPublicMemos.length === 0) return;

      // 用 name 集合精确判断是否有全新 memo
      const knownNames = new Set(state.allPublicMemos.map(m => m.name));
      const newMemos = latestMemos.filter(m => !knownNames.has(m.name));
      if (newMemos.length > 0) {
        // 用 silentRefresh 智能增量插入，而非粗暴 reload
        await silentRefresh();
      }
    } catch { /* silent */ }
  }

  // ==================== 前端登录 / 发布 ====================

  function updatePublishAuthUI() {
    const loggedIn = !!state.publishToken;
    state.isGuest = !loggedIn;
    if (!dom.loginPanel || !dom.publishPanel) return;
    dom.loginPanel.style.display = loggedIn ? 'none' : '';
    dom.publishPanel.style.display = loggedIn ? '' : 'none';
    if (loggedIn) {
      document.querySelectorAll('.footer-reaction-add').forEach(el => el.style.display = '');
      document.querySelectorAll('.memo-edit').forEach(el => el.style.display = '');
      document.querySelectorAll('.memo-delete').forEach(el => el.style.display = '');
      if (dom.btnBatch) dom.btnBatch.classList.remove('hidden');
      if (dom.visFilterBar) dom.visFilterBar.style.display = '';
    } else {
      hideReactionAddButtons();
      document.querySelectorAll('.memo-edit').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.memo-delete').forEach(el => el.style.display = 'none');
      if (dom.btnBatch) dom.btnBatch.classList.add('hidden');
      if (dom.visFilterBar) dom.visFilterBar.style.display = 'none';
    }
  }

  function openPublishModal() {
    if (!state.editingMemoName) setPublishMode('create');
    dom.publishModal.classList.add('open');
    dom.btnAdmin.classList.add('active');
    updatePublishAuthUI();
    setTimeout(() => {
      (state.publishToken ? dom.publishContent : dom.publishTokenInput)?.focus();
    }, 50);
  }

  function savePublishDraft() {
    // 保存发布草稿到 sessionStorage，防止意外关闭丢失
    try {
      const draft = {
        content: dom.publishContent.value,
        location: dom.publishLocation.value,
        visibility: dom.publishVisibility.value,
        pinned: dom.publishPinned.checked,
        createTime: dom.publishCreateTime.value,
        charCount: dom.publishContent.value.length,
        fileNames: state.selectedPublishFiles.map(f => f.name || f.fileName || 'file'),
        hasFiles: state.selectedPublishFiles.length > 0,
      };
      sessionStorage.setItem('moments-publish-draft', JSON.stringify(draft));
    } catch { /* silent */ }
  }

  function hasPublishDraft() {
    try {
      const raw = sessionStorage.getItem('moments-publish-draft');
      if (!raw) return false;
      const draft = JSON.parse(raw);
      return !!draft.content || !!draft.location || draft.hasFiles;
    } catch { return false; }
  }

  function clearPublishDraft() {
    sessionStorage.removeItem('moments-publish-draft');
  }

  function openCreatePublishModal() {
    // 仅在编辑模式下重置；创建模式下如果已有草稿则恢复
    const hasDraft = hasPublishDraft();
    if (!state.editingMemoName && !hasDraft) {
      resetPublishForm();
    }
    openPublishModal();
    // 恢复草稿
    if (!state.editingMemoName && hasDraft) {
      restorePublishDraft();
    }
    // 显示/隐藏草稿提示
    if (dom.publishDraftHint) {
      dom.publishDraftHint.classList.toggle('visible', hasPublishDraft());
    }
  }

  function restorePublishDraft() {
    try {
      const raw = sessionStorage.getItem('moments-publish-draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.content) {
        dom.publishContent.value = draft.content;
        dom.publishCharCount.textContent = String(draft.charCount || draft.content.length);
      }
      if (draft.location) dom.publishLocation.value = draft.location;
      if (draft.visibility) dom.publishVisibility.value = draft.visibility;
      if (draft.pinned) dom.publishPinned.checked = true;
      if (draft.createTime) dom.publishCreateTime.value = draft.createTime;
      // 文件无法完全恢复（File 对象不可序列化），但保留提示
    } catch { /* silent */ }
  }

  function closePublishModal() {
    // 关闭前自动保存草稿
    savePublishDraft();
    dom.publishModal.classList.remove('open');
    dom.btnAdmin.classList.remove('active');
  }

  function setPublishMode(mode) {
    const title = dom.publishModal.querySelector('.modal-header h2');
    if (title) title.textContent = mode === 'edit' ? '编辑内容' : '发布内容';
    dom.publishSubmit.textContent = mode === 'edit' ? '保存修改' : '发布';
    dom.publishFiles.disabled = mode === 'edit';
    dom.publishFiles.closest('.publish-file-picker')?.classList.toggle('disabled', mode === 'edit');
  }

  function logoutPublish() {
    state.publishToken = '';
    state.publishAuthMode = 'proxy';
    state.directApiMode = false;
    localStorage.removeItem('moments-publish-token');
    sessionStorage.removeItem('moments-publish-token');
    sessionStorage.removeItem('moments-publish-auth-mode');
    updatePublishAuthUI();
    state.allPublicMemos = [];
    loadInitial(true);
    showToast('已退出发布登录', 'success');
  }

  async function handlePublishLogin() {
    const token = dom.publishTokenInput.value.trim();
    if (!token) {
      showToast('请输入发布 Token', 'warning');
      return;
    }
    dom.publishLoginBtn.disabled = true;
    dom.publishLoginBtn.textContent = '验证中...';
    try {
      let mode = 'proxy';
      try {
        await verifyPublishToken(token);
      } catch (proxyErr) {
        await verifyDirectMemosToken(token);
        mode = 'direct';
      }
      state.publishToken = token;
      state.publishAuthMode = mode;
      state.directApiMode = mode === 'direct';
      // 持久化到 localStorage（7天过期），同时兼容旧版 sessionStorage
      localStorage.setItem('moments-publish-token', JSON.stringify({ v: token, m: mode, t: Date.now() }));
      sessionStorage.setItem('moments-publish-token', token);
      sessionStorage.setItem('moments-publish-auth-mode', mode);
      dom.publishTokenInput.value = '';
      updatePublishAuthUI();
      state.allPublicMemos = [];
      await loadInitial(true);
      showToast(mode === 'direct' ? '真实 Memos Token 登录成功，已切换直连模式' : '登录成功，可以发布内容了', 'success');
    } catch (err) {
      showToast(err.message?.includes('Failed to fetch') ? '真实 Token 直连失败，请确认 Memos 已允许跨域访问' : 'Token 不正确或未配置', 'error', 4500);
    } finally {
      dom.publishLoginBtn.disabled = false;
      dom.publishLoginBtn.textContent = '登录';
    }
  }

  function renderPublishFileList() {
    const files = state.selectedPublishFiles;
    dom.publishFileList.innerHTML = files.length
      ? files.map((file, index) => `<span>${escapeHtml(file.name)} <em>${formatFileSize(file.size)}</em><button type="button" class="publish-file-remove" data-index="${index}" aria-label="移除 ${escapeHtml(file.name)}">×</button></span>`).join('')
      : '';
  }

  function addPublishFiles(files) {
    Array.from(files || []).forEach(file => {
      const exists = state.selectedPublishFiles.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (!exists) state.selectedPublishFiles.push(file);
    });
    dom.publishFiles.value = '';
    renderPublishFileList();
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function resetPublishForm() {
    state.editingMemoName = '';
    setPublishMode('create');
    dom.publishContent.value = '';
    dom.publishLocation.value = '';
    dom.publishPinned.checked = false;
    dom.publishCreateTime.value = '';
    dom.publishFiles.value = '';
    state.selectedPublishFiles = [];
    dom.publishFileList.innerHTML = '';
    dom.publishCharCount.textContent = '0';
    clearPublishDraft();
  }

  async function handlePublishSubmit() {
    const content = dom.publishContent.value.trim();
    if (!content) {
      showToast('请输入要发布的内容', 'warning');
      return;
    }
    dom.publishSubmit.disabled = true;
    const wasEditing = !!state.editingMemoName;
    dom.publishSubmit.textContent = wasEditing ? '保存中...' : '发布中...';
    try {
      if (state.editingMemoName) {
        await updateMemo({
          name: state.editingMemoName,
          content,
          visibility: dom.publishVisibility.value || 'PUBLIC',
          pinned: dom.publishPinned.checked,
          location: dom.publishLocation.value.trim(),
          createTime: dom.publishCreateTime.value ? new Date(dom.publishCreateTime.value).toISOString() : '',
        });
      } else {
        await createMemo({
          content,
          visibility: dom.publishVisibility.value || 'PUBLIC',
          pinned: dom.publishPinned.checked,
          location: dom.publishLocation.value.trim(),
          createTime: dom.publishCreateTime.value ? new Date(dom.publishCreateTime.value).toISOString() : '',
          files: state.selectedPublishFiles,
        });
      }
      resetPublishForm();
      closePublishModal();
      cacheManager.invalidateAll();
      await loadInitial(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(wasEditing ? '修改成功' : '发布成功', 'success');
    } catch (err) {
      console.error('Publish failed:', err);
      showToast(err.message || '发布失败，请检查 Token 和 Memos API Key', 'error', 4500);
    } finally {
      dom.publishSubmit.disabled = false;
      dom.publishSubmit.textContent = state.editingMemoName ? '保存修改' : '发布';
    }
  }

  function startEditMemo(memoName) {
    const memo = state.allPublicMemos.find(item => item.name === memoName) || state.memos.find(item => item.name === memoName);
    if (!memo) {
      showToast('未找到要编辑的内容', 'error');
      return;
    }
    state.editingMemoName = memo.name;
    setPublishMode('edit');
    dom.publishContent.value = memo.content || '';
    dom.publishVisibility.value = getMemoVisibility(memo) || 'PUBLIC';
    dom.publishPinned.checked = !!memo.pinned;
    const createTime = getMemoTime(memo, 'create');
    dom.publishCreateTime.value = createTime ? toDateTimeLocal(createTime) : '';
    dom.publishLocation.value = memo.location?.placeholder || '';
    dom.publishFiles.value = '';
    state.selectedPublishFiles = [];
    dom.publishFileList.innerHTML = '<span>编辑模式暂不修改附件</span>';
    dom.publishCharCount.textContent = String(dom.publishContent.value.length);
    openPublishModal();
  }

  async function handleDeleteMemo(memoName) {
    const memo = state.allPublicMemos.find(item => item.name === memoName) || state.memos.find(item => item.name === memoName);
    const snippet = (memo?.content || '').trim().slice(0, 24);
    if (!confirm(`确定删除这条内容吗？${snippet ? `\n\n${snippet}` : ''}`)) return;
    try {
      await deleteMemo(memoName);
      showToast('已删除', 'success');
      cacheManager.invalidateAll();
      await loadInitial(true);
    } catch (err) {
      showToast(err.message || '删除失败', 'error', 4000);
    }
  }

  function formatAudioTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function syncAudioPlayer(audio) {
    const id = audio.id;
    const player = document.querySelector(`.audio-row[data-audio-id="${id}"]`);
    if (!player) return;
    const time = document.querySelector(`.audio-time[data-audio-id="${id}"]`);
    const button = player.querySelector('.audio-play');
    if (time) time.textContent = `${formatAudioTime(audio.currentTime || 0)}/${formatAudioTime(audio.duration || 0)}`;
    button.classList.toggle('is-playing', !audio.paused);
    button.setAttribute('aria-label', audio.paused ? '播放音频' : '暂停音频');
  }

  function bindAudioPlayerEvents() {
    dom.memoList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.audio-play');
      if (!btn) return;
      const audio = document.getElementById(btn.dataset.audioId);
      if (!audio) return;
      document.querySelectorAll('.audio-row audio').forEach(item => {
        if (item !== audio) item.pause();
      });
      if (audio.paused) await audio.play().catch(err => showToast(err.message || '音频播放失败', 'error', 3000));
      else audio.pause();
      syncAudioPlayer(audio);
    });
    dom.memoList.addEventListener('timeupdate', (e) => {
      if (e.target.matches('.audio-row audio')) syncAudioPlayer(e.target);
    }, true);
    dom.memoList.addEventListener('loadedmetadata', (e) => {
      if (e.target.matches('.audio-row audio')) syncAudioPlayer(e.target);
    }, true);
    dom.memoList.addEventListener('pause', (e) => {
      if (e.target.matches('.audio-row audio')) syncAudioPlayer(e.target);
    }, true);
    dom.memoList.addEventListener('play', (e) => {
      if (e.target.matches('.audio-row audio')) syncAudioPlayer(e.target);
    }, true);
  }

  function goHomeAndRefresh() {
    // 如果当前在单条链接视图，退出
    if (state.hashView) {
      exitHashView();
      return;
    }
    state.activeTag = 'all';
    state.searchQuery = '';
    state.activeDate = '';
    state.visibilityFilter = 'all';
    dom.searchInput.value = '';
    dom.searchClear.classList.remove('visible');
    dom.searchBar.classList.remove('open');
    dom.btnSearch.classList.remove('active');
    document.querySelectorAll('.vis-filter-chip.active').forEach(el => el.classList.remove('active'));
    const allVisChip = document.querySelector('.vis-filter-chip[data-vis="all"]');
    if (allVisChip) allVisChip.classList.add('active');
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    loadInitial(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==================== 事件绑定 ====================

  function bindEvents() {
    // 主题切换
    dom.btnTheme.addEventListener('click', toggleTheme);

    // 左上角 Logo：回首页并刷新列表
    dom.navbarBrand.addEventListener('click', goHomeAndRefresh);

    // 前端发布入口
    dom.btnAdmin.addEventListener('click', openCreatePublishModal);
    dom.publishClose.addEventListener('click', closePublishModal);
    dom.publishModal.addEventListener('click', (e) => {
      if (e.target === dom.publishModal) closePublishModal();
    });
    dom.publishLoginBtn.addEventListener('click', handlePublishLogin);
    dom.publishTokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePublishLogin();
    });
    dom.publishLogoutBtn.addEventListener('click', logoutPublish);
    dom.btnBatch.addEventListener('click', () => {
      if (state.batchMode) exitBatchMode();
      else enterBatchMode();
    });
    dom.publishContent.addEventListener('input', () => {
      dom.publishCharCount.textContent = String(dom.publishContent.value.length);
      // 防抖自动保存草稿
      clearTimeout(dom.publishContent._draftTimer);
      dom.publishContent._draftTimer = setTimeout(savePublishDraft, 500);
    });
    dom.publishFiles.addEventListener('change', () => addPublishFiles(dom.publishFiles.files));
    dom.publishFileList.addEventListener('click', (e) => {
      const btn = e.target.closest('.publish-file-remove');
      if (!btn) return;
      state.selectedPublishFiles.splice(Number(btn.dataset.index), 1);
      renderPublishFileList();
    });
    dom.publishSubmit.addEventListener('click', handlePublishSubmit);
    dom.publishDraftClear?.addEventListener('click', () => {
      clearPublishDraft();
      resetPublishForm();
      if (dom.publishDraftHint) dom.publishDraftHint.classList.remove('visible');
      dom.publishContent?.focus();
    });
    dom.memoList.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.memo-edit');
      if (editBtn) startEditMemo(editBtn.dataset.memoName);
      const deleteBtn = e.target.closest('.memo-delete');
      if (deleteBtn) handleDeleteMemo(deleteBtn.dataset.memoName);
    });
    bindAudioPlayerEvents();

    // 搜索
    dom.btnSearch.addEventListener('click', () => toggleSearch());
    dom.searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));
    dom.searchClear.addEventListener('click', () => {
      dom.searchInput.value = '';
      dom.searchClear.classList.remove('visible');
      state.searchQuery = '';
      loadInitial();
      dom.searchInput.focus();
    });

    // 点击搜索框外区域关闭搜索
    document.addEventListener('click', (e) => {
      if (dom.searchBar.classList.contains('open') &&
          !dom.searchBar.contains(e.target) &&
          !dom.btnSearch.contains(e.target)) {
        closeSearch();
      }
    });

    // 统计
    if (CONFIG.ENABLE_STATS) {
      dom.btnStats.addEventListener('click', openStats);
      dom.statsClose.addEventListener('click', closeStats);
      dom.statsModal.addEventListener('click', (e) => {
        if (e.target === dom.statsModal) closeStats();
      });
    } else {
      dom.btnStats.style.display = 'none';
    }

    // 卡片内标签点击
    dom.memoList.addEventListener('click', (e) => {
      const tag = e.target.closest('.memo-tag');
      if (tag) {
        setActiveTag(tag.dataset.tag);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    // 灯箱
    dom.lightboxClose.addEventListener('click', closeLightbox);
    dom.lightboxPrev.addEventListener('click', lightboxPrev);
    dom.lightboxNext.addEventListener('click', lightboxNext);
    dom.lightbox.addEventListener('click', (e) => {
      if (e.target === dom.lightbox || e.target === dom.lightboxImgWrap) closeLightbox();
    });

    // 灯箱触摸手势
    initLightboxTouch();

    // Reactions（事件委托）
    dom.memoList.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.reaction-add');
      if (addBtn) {
        showReactionPicker(e, addBtn.dataset.memoName);
      }
    });

    // 键盘事件
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLightbox();
        closeStats();
        closePublishModal();
        hideReactionPicker();
        if (dom.searchBar.classList.contains('open')) closeSearch();
      }
      if (dom.lightbox.style.display !== 'none') {
        if (e.key === 'ArrowLeft') lightboxPrev();
        if (e.key === 'ArrowRight') lightboxNext();
      }
    });

    // 回到顶部
    dom.backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      addRipple(dom.backToTop);
    });

    // 滚动事件（节流）
    let scrollTicking = false;
    window.addEventListener('scroll', () => {
      if (!scrollTicking) {
        requestAnimationFrame(() => {
          handleScroll();
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    });

    // 点击空白处关闭
    document.addEventListener('click', (e) => {
      if (!dom.reactionPicker.contains(e.target)) hideReactionPicker();
    });

    // 展开/收起
    initExpandCollapse();

    // 图片点击
    initImageClicks();

    // 分享按钮
    initShare();

    // 分页模式事件
    dom.pagPrev.addEventListener('click', () => goToPage(state.paginationPage - 1));
    dom.pagNext.addEventListener('click', () => goToPage(state.paginationPage + 1));
    dom.pagJumpToggle.addEventListener('click', () => {
      const wrap = dom.pagJumpWrap;
      if (wrap.style.display === 'none' || wrap.style.display === '') {
        wrap.style.display = 'flex';
        dom.pagJumpInput.focus();
        dom.pagJumpToggle.textContent = '关闭';
      } else {
        wrap.style.display = 'none';
        dom.pagJumpInput.value = '';
        dom.pagJumpToggle.textContent = '跳转';
      }
    });
    dom.pagJumpGo.addEventListener('click', () => {
      const page = parseInt(dom.pagJumpInput.value, 10);
      if (page >= 1 && page <= state.paginationTotalPages) {
        goToPage(page);
        dom.pagJumpInput.value = '';
        dom.pagJumpWrap.style.display = 'none';
        dom.pagJumpToggle.textContent = '跳转';
      } else {
        showToast(`请输入 1-${state.paginationTotalPages} 之间的页码`, 'warning');
      }
    });
    dom.pagJumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') dom.pagJumpGo.click();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.pagination-jump') && dom.pagJumpWrap.style.display !== 'none') {
        dom.pagJumpWrap.style.display = 'none';
        dom.pagJumpToggle.textContent = '跳转';
      }
    });

    // 加载更多（点击模式）
    dom.loadMoreClickBtn.addEventListener('click', loadMore);

    // 批量操作
    dom.batchPublic.addEventListener('click', () => batchSetVisibility('PUBLIC'));
    dom.batchProtected.addEventListener('click', () => batchSetVisibility('PROTECTED'));
    dom.batchPrivate.addEventListener('click', () => batchSetVisibility('PRIVATE'));
    dom.batchDelete.addEventListener('click', batchDelete);
    dom.batchCancel.addEventListener('click', exitBatchMode);

    // 卡片勾选（批量模式）
    dom.memoList.addEventListener('click', (e) => {
      const checkbox = e.target.closest('.memo-checkbox');
      if (checkbox) {
        toggleMemoSelection(checkbox.dataset.memoName);
      }
    });

    // Esc 退出批量模式
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.batchMode) {
        exitBatchMode();
      }
    });

    // 可见性筛选
    dom.visFilterBar.addEventListener('click', (e) => {
      const chip = e.target.closest('.vis-filter-chip');
      if (!chip) return;
      const vis = chip.dataset.vis;
      if (vis === state.visibilityFilter) return;
      state.visibilityFilter = vis;
      dom.visFilterBar.querySelectorAll('.vis-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      loadInitial();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 单条链接视图返回按钮
    dom.hashBackBtn.addEventListener('click', () => exitHashView());
  }

  // ==================== 初始化 ====================

  function init() {
    // 刷新时不恢复滚动位置,避免 DOM 异步重建导致滚动到错误位置
    // (loadInitial 清空 DOM 只重建第一页,浏览器恢复旧滚动位置会看到旧内容)
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    applyConfigStyles();
    dom.siteName.textContent = CONFIG.SITE_NAME;
    dom.siteIcon.style.display = CONFIG.SHOW_SITE_LOGO === false ? 'none' : '';
    dom.siteIcon.classList.remove('placeholder');
    dom.siteIcon.innerHTML = CONFIG.SHOW_SITE_LOGO !== false && CONFIG.SITE_LOGO_URL
      ? `<img src="${escapeHtml(CONFIG.SITE_LOGO_URL)}" alt="${escapeHtml(CONFIG.SITE_NAME)}">`
      : escapeHtml(CONFIG.SITE_ICON_TEXT || CONFIG.SITE_NAME.charAt(0).toUpperCase());
    document.title = CONFIG.BROWSER_TITLE || CONFIG.SITE_NAME;
    if (CONFIG.SITE_DESCRIPTION) {
      document.querySelector('meta[name="description"]').content = CONFIG.SITE_DESCRIPTION;
    }
    if (CONFIG.FAVICON_URL) {
      let favicon = document.querySelector('link[rel="icon"]');
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
      }
      favicon.href = CONFIG.FAVICON_URL;
    }

    initTheme();
    bindEvents();
    updatePublishAuthUI();

    // 首屏关键路径:只等内容列表(loadInitial),用户画像后台加载不阻塞
    // - loadInitial 优先渲染首屏(头像/昵称用 fallback)
    // - loadUserProfile 后台完成后批量更新 DOM
    // 这样首屏只依赖一个网络请求(/memos),而非两个(/memos + /users)
    loadInitial().then(() => {
      initInfiniteScroll();
      initRealTimeUpdates();
      scrollToHashMemo();
    });
    // 用户画像完全后台,不阻塞首屏
    loadUserProfile();
    window.addEventListener('hashchange', () => scrollToHashMemo());
    registerServiceWorker();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('PWA 注册失败：', err);
      });
    });
  }

  function applyConfigStyles() {
    const root = document.documentElement;
    root.style.setProperty('--site-logo-max-width', CONFIG.SITE_LOGO_MAX_WIDTH || '32px');
    root.style.setProperty('--site-logo-max-height', CONFIG.SITE_LOGO_MAX_HEIGHT || '32px');
    root.style.setProperty('--avatar-max-width', CONFIG.ADMIN_AVATAR_MAX_WIDTH || '40px');
    root.style.setProperty('--avatar-max-height', CONFIG.ADMIN_AVATAR_MAX_HEIGHT || '40px');
    root.style.setProperty('--single-image-max-width', CONFIG.SINGLE_IMAGE_MAX_WIDTH || '100%');
    root.style.setProperty('--single-image-max-height', CONFIG.SINGLE_IMAGE_MAX_HEIGHT || '520px');
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
