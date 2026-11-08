import { CONFIG } from './config.js';
import {
  getProfile,
  getMemos,
  getMemo,
  getLikes,
  toggleLike,
  getComments,
  postComment,
  getNickname,
  setNickname,
  getHomepage,
  setHomepage,
  getPendingComments,
  addPendingComment,
  removePendingComments,
  PLACEHOLDER_AVATAR,
} from './api.js';
import { renderMoment, imagesOf, drawerHtml, linkifyText } from './render.js';

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
  backBtn: $('backBtn'),
  shareBtn: $('shareBtn'),
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
  firstIds: '',
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

function bindMoment(node, opts = {}) {
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

  // 头像 → 单条详情（微信点头像进详情；封面头像才进资料页）
  node.querySelectorAll('.moment-avatar').forEach((img) => {
    img.classList.add('is-link');
    img.addEventListener('click', () => {
      const uid = (node.dataset.name || '').split('/')[1];
      if (uid) location.href = '/?memo=' + uid;
    });
  });

  // 列表页：仅昵称可点进单条详情（正文/评论区/媒体均不可点，避免误触）
  if (opts.linkDetail !== false) {
    const nameEl = node.querySelector('.moment-name');
    const uid = (node.dataset.name || '').split('/')[1];
    if (nameEl && uid) {
      nameEl.classList.add('is-link');
      nameEl.addEventListener('click', () => {
        location.href = '/?memo=' + uid;
      });
    }
  }

  // 「…」→ 赞 / 评论浮层（同微信：点空白处或滚动即收起）
  const moreBtn = node.querySelector('.more-btn');
  const pop = node.querySelector('.popover');
  if (moreBtn && pop) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      closePopover();
      if (!willOpen) return;
      // 打开时按当前状态切换文案：已赞 →「取消」
      const uid = (node.dataset.name || '').split('/')[1];
      const liked = engaged.get(uid)?.likes?.liked;
      const txt = pop.querySelector('[data-act="like"] .pop-txt');
      if (txt) txt.textContent = liked ? '取消' : '赞';
      pop.hidden = false;
      openPopover = pop;
    });
    pop.addEventListener('click', async (e) => {
      const btn = e.target.closest('.pop-btn');
      if (!btn) return;
      const act = btn.dataset.act;
      const uid = (node.dataset.name || '').split('/')[1];
      closePopover();
      if (!uid) return;

      if (act === 'like') {
        const liked = engaged.get(uid)?.likes?.liked || false;
        btn.disabled = true;
        try {
          const r = await toggleLike(uid, !liked, getNickname() || '访客', getHomepage());
          const item = engaged.get(uid) || { comments: [] };
          item.likes = { count: r.count, names: r.names, liked: r.liked };
          engaged.set(uid, item);
          paintDrawer(node);
        } catch (err) {
          console.warn('[like]', err);
          toast('网络开小差了，稍后再试');
        } finally {
          btn.disabled = false;
        }
      } else {
        openInlineComment(node, uid);
      }
    });
  }

  // 点灰底框：点赞行/空白 = 直接评论；点某条评论 = 回复它（同微信）
  const drawer = node.querySelector('.drawer');
  if (drawer) {
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // 点昵称/链接是跳转，不是回复
      const uid = (node.dataset.name || '').split('/')[1];
      if (!uid) return;
      const row = e.target.closest('.comment');
      if (!row) {
        openInlineComment(node, uid);
        return;
      }
      if (row.classList.contains('is-pending')) {
        toast('这条还在审核中，暂时不能回复');
        return;
      }
      // 二级评论：挂回它所属的一级评论下（层级最多 2 级）
      let top = row;
      if (row.classList.contains('is-reply')) {
        const wrap = row.closest('.comment-replies') || row.parentElement;
        top = (wrap && wrap.closest('.comment')) || row;
      }
      openInlineComment(node, uid, {
        attachUid: top.dataset.cuid || '',
        replyName: row.dataset.cname || '',
        chipName: row.dataset.cname || '',
      });
    });
  }

  node.querySelectorAll('.media-audio').forEach(bindAudio);
  bindCommentInline(node);
}

/* --------------------------------------------------------------- 赞/评论浮层 */

let openPopover = null;

function closePopover() {
  if (!openPopover) return;
  openPopover.hidden = true;
  openPopover = null;
}

/* --------------------------------------------------------------- 赞与评论数据 */

/** uid -> { likes: {count, names, liked}, comments: [{name, text, time}] } */
const engaged = new Map();

/** 渲染一组动态后拉取它们的点赞/评论（失败静默，不影响正文）；管理员模式下附带待审列表 */
async function loadEngagement(nodes) {
  const uids = nodes
    .map((n) => (n.dataset.name || '').split('/')[1])
    .filter(Boolean);
  if (!uids.length) return;
  try {
    const [likes, comments] = await Promise.all([getLikes(uids), getComments(uids)]);
    nodes.forEach((n) => {
      const uid = (n.dataset.name || '').split('/')[1];
      if (!uid) return;
      engaged.set(uid, {
        likes: likes[uid] || { count: 0, names: [], liked: false },
        comments: comments[uid] || [],
      });
      paintDrawer(n);
    });
  } catch (err) {
    console.warn('[engagement]', err);
  }
}

function paintDrawer(node) {
  const uid = (node.dataset.name || '').split('/')[1];
  const data = engaged.get(uid);
  const drawer = node.querySelector('.drawer');
  if (!drawer || !data) return;
  drawer.innerHTML = drawerHtml(data.likes, withPending(uid, data.comments));
}

/**
 * 待审评论合并渲染：
 *  - 提交后立即以灰色「审核中」显示（只有评论者自己的浏览器可见）
 *  - 每次拉取时比对：API 里出现同 uid（或同昵称+内容）= 已过审 → 清掉本地记录
 *  - 待审的回复挂到对应一级评论下；父级还在待审就先挂在它下面
 */
function withPending(uid, comments) {
  const pend = getPendingComments().filter((p) => p.memoUid === uid);
  if (!pend.length) return comments;

  const approvedUids = new Set();
  const approvedKeys = new Set();
  const walk = (arr) =>
    (arr || []).forEach((c) => {
      if (c.uid) approvedUids.add(c.uid);
      approvedKeys.add(c.name + '\u0000' + c.text);
      if (c.replies) walk(c.replies);
    });
  walk(comments);

  const still = pend.filter(
    (p) => !(p.uid && approvedUids.has(p.uid)) && !approvedKeys.has(p.name + '\u0000' + p.text)
  );
  const done = pend.filter((p) => !still.includes(p));
  if (done.length) removePendingComments(done.map((p) => p.uid).filter(Boolean));
  if (!still.length) return comments;

  const out = (comments || []).map((c) => ({ ...c, replies: (c.replies || []).map((r) => ({ ...r })) }));
  const pendingTopMap = new Map(); // attachUid -> 待审一级评论对象
  for (const p of still) {
    const item = {
      uid: p.uid,
      name: p.name,
      url: p.url,
      text: p.text,
      replyName: p.replyName,
      pending: true,
      replies: [],
    };
    if (!p.attachUid) {
      out.push(item);
      pendingTopMap.set(p.uid, item);
    } else {
      const top = out.find((c) => c.uid === p.attachUid) || pendingTopMap.get(p.attachUid);
      if (top) top.replies.push(item);
      else out.push(item); // 父评论不存在了（被删），降级成一级显示
    }
  }
  return out;
}

/* --------------------------------------------------------------- 内联评论输入
   微信同款：点「评论」后输入框在【那条动态下方】就地展开，不是底部弹条 */

let commentNode = null; // 当前展开输入框的 .moment 节点
let replyCtx = null; // 回复上下文 { attachUid, replyName, chipName }，空 = 普通评论

function openInlineComment(node, uid, reply) {
  if (commentNode && commentNode !== node) closeInlineComment();
  const box = node.querySelector('.comment-inline');
  if (!box) return;
  commentNode = node;
  replyCtx = reply || null;
  const nick = box.querySelector('.comment-nick');
  const link = box.querySelector('.comment-link');
  const input = box.querySelector('.comment-input');
  const send = box.querySelector('.comment-send');
  const bar = box.querySelector('.comment-reply-bar');
  // 昵称/主页行常显：填过就直接带出，随时可以改
  nick.value = getNickname();
  link.value = getHomepage();
  if (replyCtx) {
    box.querySelector('.comment-reply-txt').textContent = '回复 ' + replyCtx.chipName;
    bar.hidden = false;
    input.placeholder = '回复 ' + replyCtx.chipName + '…';
  } else {
    bar.hidden = true;
    input.placeholder = '评论';
  }
  // 草稿保留：输入过的文字不清空（发送成功才清），取消只是收起
  send.disabled = input.value.trim().length === 0;
  box.hidden = false;
  // 移动端需要用户手势内 focus 才能唤起键盘，这里在同一次点击里聚焦
  input.focus();
  // 确保输入框出现在可视区域内（键盘弹起时不被遮挡）
  setTimeout(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 120);
}

function closeInlineComment() {
  if (!commentNode) return;
  const box = commentNode.querySelector('.comment-inline');
  if (box) {
    box.hidden = true;
    // 顺手收起表情面板（下次打开是干净状态）
    const panel = box.querySelector('.emoji-panel');
    const toggle = box.querySelector('.emoji-toggle');
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  commentNode = null;
  replyCtx = null;
}

/** 回复条上的 ×：退出回复模式，回到普通评论（已输入文字保留） */
function clearReplyCtx() {
  replyCtx = null;
  if (!commentNode) return;
  const box = commentNode.querySelector('.comment-inline');
  if (!box) return;
  box.querySelector('.comment-reply-bar').hidden = true;
  box.querySelector('.comment-input').placeholder = '评论';
}

async function sendComment(node, uid) {
  const box = node.querySelector('.comment-inline');
  if (!box) return;
  const nick = box.querySelector('.comment-nick');
  const link = box.querySelector('.comment-link');
  const input = box.querySelector('.comment-input');
  const send = box.querySelector('.comment-send');
  const name = nick.value.trim();
  const url = link.value.trim();
  const text = input.value.trim();
  if (!name) {
    toast('先给自己起个昵称吧');
    nick.focus();
    return;
  }
  if (url && !/^https?:\/\//i.test(url)) {
    toast('主页链接要以 http:// 或 https:// 开头');
    link.focus();
    return;
  }
  if (!text) {
    toast('说点什么再发送吧');
    input.focus();
    return;
  }
  send.disabled = true;
  try {
    setNickname(name);
    setHomepage(url);
    const ctx = replyCtx;
    const r = await postComment(uid, name, url, text, ctx);
    // 本地记一条「审核中」，自己可见；过审后拉到同 uid 自动转正
    addPendingComment({
      memoUid: uid,
      uid: r.uid || '',
      name,
      url,
      text,
      replyName: ctx?.replyName || '',
      attachUid: ctx?.attachUid || '',
      ts: Date.now(),
    });
    input.value = ''; // 发送成功才清草稿
    closeInlineComment();
    paintDrawer(node); // 立刻以「审核中」样式显示
    toast('已提交，过审后公开显示');
  } catch (err) {
    console.warn('[comment]', err);
    toast('发送失败，稍后再试');
    send.disabled = false;
  }
}

/** 每条动态渲染后绑定各自的内联评论输入 */
function bindCommentInline(node) {
  const box = node.querySelector('.comment-inline');
  if (!box) return;
  const uid = () => (node.dataset.name || '').split('/')[1];
  const input = box.querySelector('.comment-input');
  const send = box.querySelector('.comment-send');
  send.addEventListener('click', () => sendComment(node, uid()));
  // 「取消」：收起输入框，草稿保留（下次点开还在）
  box.querySelector('.comment-cancel').addEventListener('click', closeInlineComment);
  // 回复条上的 ×：退出回复模式
  box.querySelector('.comment-reply-x').addEventListener('click', clearReplyCtx);
  // 有字才亮「发送」（同微信）
  input.addEventListener('input', () => {
    send.disabled = input.value.trim().length === 0;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendComment(node, uid());
    }
  });
  box.querySelector('.comment-nick').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      box.querySelector('.comment-link').focus();
    }
  });
  box.querySelector('.comment-link').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.focus();
    }
  });
  // 表情：打开面板可连续点选多个，面板只在点外部/再点图标/收起评论框时关闭
  const panel = box.querySelector('.emoji-panel');
  const toggle = box.querySelector('.emoji-toggle');
  const closePanel = () => {
    if (!panel) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  if (toggle && panel) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) {
        // 面板展开时把光标放回输入框，插入位置才正确
        input.focus();
      }
    });
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('.emoji-item');
      if (!btn) return;
      e.stopPropagation();
      const emoji = btn.textContent || '';
      // 每次插入前重新读光标位置（连续点选时上一次的选区已经更新）
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
      const pos = start + emoji.length;
      input.focus();
      try {
        input.setSelectionRange(pos, pos);
      } catch (err) {
        /* ignore */
      }
      send.disabled = input.value.trim().length === 0;
      // 不收起面板：方便连续插入多个表情
    });
    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (e.target.closest('.emoji-panel') || e.target.closest('.emoji-toggle')) return;
      closePanel();
    });
  }
}

function initCommentBar() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 表情面板开着就先收面板，再按一次才收评论框
    if (commentNode) {
      const panel = commentNode.querySelector('.emoji-panel');
      const toggle = commentNode.querySelector('.emoji-toggle');
      if (panel && !panel.hidden) {
        panel.hidden = true;
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        return;
      }
    }
    closeInlineComment();
  });
  // 点输入框以外的空白处收起（点浮层/评论区/九宫格等正常交互不受影响）
  document.addEventListener('click', (e) => {
    if (!commentNode) return;
    if (e.target.closest('.comment-inline, .popover, .more-btn, .drawer')) return;
    closeInlineComment();
  });
}

/* --------------------------------------------------------------- 分页加载 */

/** 首屏请求预热占位：boot 时发起，loadOnePage 直接复用 */
let firstPageTask = null;

/** 下一页预取：当前页渲染完就提前拉下一页，点「加载更多」几乎无等待 */
let nextPageTask = null;

/* --------------------------------------------------------------- 首屏快照
   首次打开要等 /api/feed 绕到海外 Vercel 回源（1.5~3s），骨架会空一会儿。
   把上一页数据存本地，下次打开先用旧数据秒渲染，再后台换新（前端版 stale-while-revalidate）。 */

const SNAPSHOT_KEY = 'pyq-feed-v1';
const SNAPSHOT_TTL = 7 * 24 * 3600 * 1000;

function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.memos) || !s.memos.length) return null;
    if (!s.t || Date.now() - s.t > SNAPSHOT_TTL) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function writeSnapshot(memos, nextPageToken) {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        t: Date.now(),
        memos: (memos || []).slice(0, CONFIG.PAGE_SIZE),
        nextPageToken: nextPageToken || '',
      })
    );
  } catch (e) {
    /* 本地存储满了就放弃，不影响主流程 */
  }
}

function readCachedProfile() {
  try {
    return JSON.parse(localStorage.getItem('pyq-profile-v1') || 'null');
  } catch (e) {
    return null;
  }
}

function cacheProfile(profile) {
  try {
    localStorage.setItem('pyq-profile-v1', JSON.stringify(profile));
  } catch (e) {
    /* ignore */
  }
}

/** 用快照垫一屏，返回是否垫上了 */
function paintSnapshot() {
  const snap = readSnapshot();
  if (!snap) return false;
  el.feed.innerHTML = '';
  state.count = 0;
  appendMoments(snap.memos);
  state.loadedPages = 1;
  state.tokens[1] = snap.nextPageToken || '';
  state.done = !snap.nextPageToken;
  state.firstIds = snap.memos.map((m) => m.name || m.uid || '').join(',');
  pickCoverFromMemos(snap.memos);
  return true;
}

/** 后台拉最新首页：用户还没滚动就原地换新，滚下去了只更新本地快照 */
async function refreshFirstPage(reqPromise) {
  try {
    const { memos, nextPageToken } = await (reqPromise || getMemos({ pageToken: '' }));
    writeSnapshot(memos, nextPageToken);
    const ids = memos.map((m) => m.name || m.uid || '').join(',');
    if (state.loadedPages === 1 && !state.loading && window.scrollY < 400 && ids !== state.firstIds) {
      el.feed.innerHTML = '';
      state.count = 0;
      appendMoments(memos);
      state.tokens[1] = nextPageToken || '';
      state.done = !nextPageToken;
      state.firstIds = ids;
      updatePager();
    }
  } catch (err) {
    console.warn('[feed refresh]', err);
  }
}

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
  const nodes = Array.from(frag.children);
  nodes.forEach((n) => {
    el.feed.appendChild(n);
    hydrateImages(n);
    setupFolding(n);
    bindMoment(n);
  });
  state.count += memos.length;
  loadEngagement(nodes); // 点赞/评论异步补位，不阻塞正文
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
    // 第一页落盘，下次打开可秒开
    if (state.loadedPages === 1) {
      state.firstIds = memos.map((m) => m.name || m.uid || '').join(',');
      writeSnapshot(memos, nextPageToken);
    }
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

/* --------------------------------------------------------------- 路由与子页面 */

/**
 * 路由：
 *   /memo/<uid> 或 /?memo=<uid> → 单条详情（查询参数版不依赖服务器 rewrite，分享链接用它）
 *   /about 或 /?about=1 → 资料页
 *   其余为信息流（?page=N 翻页）
 */
function parseRoute() {
  const qs = new URLSearchParams(location.search);
  const pathUid = location.pathname.match(/^\/memo\/([A-Za-z0-9_-]+)\/?$/);
  if (pathUid) return { view: 'memo', uid: pathUid[1] };
  if (/^\/about\/?$/.test(location.pathname) || qs.get('about') === '1') {
    return { view: 'about' };
  }
  const qUid = (qs.get('memo') || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (qUid) return { view: 'memo', uid: qUid };
  return { view: 'feed' };
}

/** 子页面的外壳：无封面、隐藏分页/回顶，导航换成 返回 + 标题 + 分享 */
function setupChrome(route) {
  document.body.classList.add('is-sub');
  el.cover.hidden = true;
  el.pager.hidden = true;
  el.topBtn.hidden = true;
  el.backBtn.hidden = false;
  el.themeBtn.hidden = true;
  el.postBtn.hidden = route.view !== 'feed';
  el.shareBtn.hidden = route.view !== 'memo';
  el.navTitle.textContent = route.view === 'memo' ? '详情' : '资料';
  document.title = route.view === 'memo' ? '详情' : '资料';
  el.backBtn.addEventListener('click', () => {
    if (document.referrer && new URL(document.referrer).origin === location.origin) {
      history.back();
    } else {
      location.href = './';
    }
  });
}

async function loadDetailView(uid) {
  try {
    const [memo] = await Promise.all([getMemo(uid), ensureProfile()]);
    el.feed.innerHTML = '';
    const frag = document.createElement('div');
    frag.innerHTML = renderMoment(memo, state.profile, { folded: false });
    const node = frag.firstElementChild;
    el.feed.appendChild(node);
    hydrateImages(node);
    bindMoment(node, { linkDetail: false });
    loadEngagement([node]);
    bindShare(memo);
    onScroll();
  } catch (err) {
    console.error('[memo]', err);
    el.feed.innerHTML = '<p class="empty">这条动态不存在，或已设为不可见</p>';
  }
}

/** 详情页右上角：系统分享面板优先，没有就复制链接 */
function bindShare(memo) {
  const uid = (memo.name || '').split('/')[1];
  const url = location.origin + '/?memo=' + uid;
  const text = (memo.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  el.shareBtn.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: CONFIG.SITE_TITLE, text, url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // 用户取消
      }
    }
    copyText(url);
  });
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => toast('链接已复制'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-99px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  ta.remove();
  toast(ok ? '链接已复制' : '复制失败，请手动复制地址栏链接');
}

async function loadAboutView() {
  await ensureProfile();
  const p = state.profile;
  const links = (CONFIG.PROFILE_LINKS || [])
    .filter((l) => l && l.url && l.label)
    .map(
      (l) =>
        `<a class="profile-btn" href="${escape(l.url)}" target="_blank" rel="noopener noreferrer">${escape(
          l.label
        )}</a>`
    )
    .join('');
  el.feed.innerHTML =
    `<section class="profile-page">` +
    `<img class="profile-avatar" src="${p.avatar || PLACEHOLDER_AVATAR}" alt="" decoding="async">` +
    `<h2 class="profile-name">${escape(p.name)}</h2>` +
    (p.bio ? `<p class="profile-bio">${linkifyText(p.bio)}</p>` : '') +
    `<div class="profile-actions">` +
    links +
    `<a class="profile-btn ghost" href="${CONFIG.MEMOS_URL}/u/${CONFIG.ADMIN_USER}" target="_blank" rel="noopener">Memos 主页</a>` +
    `<a class="profile-btn ghost" href="./">返回朋友圈</a>` +
    `</div>` +
    `</section>`;
  el.feed.querySelector('.profile-avatar').addEventListener('error', (e) => {
    e.target.src = PLACEHOLDER_AVATAR;
  });
  hydrateImages(el.feed);
  onScroll();
}

function escape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let profileReady = null;
function ensureProfile() {
  if (!profileReady) {
    profileReady = getProfile()
      .then((p) => {
        applyProfile(p);
        cacheProfile(p);
        return p;
      })
      .catch(() => {
        applyProfile({ name: CONFIG.NICKNAME, avatar: '', bio: '' });
        return state.profile;
      });
  }
  return profileReady;
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
  // 顶部「朋友圈」是普通链接：点击整页跳回首页刷新（导航逻辑交给浏览器）
  onScroll();
}

/* --------------------------------------------------------------- 启动 */

async function boot() {
  initTheme();
  initScroll();
  initViewer();
  initCommentBar();

  const route = parseRoute();
  const profileTask = ensureProfile();

  if (route.view === 'memo') {
    setupChrome(route);
    await loadDetailView(route.uid);
    return;
  }
  if (route.view === 'about') {
    setupChrome(route);
    await loadAboutView();
    return;
  }

  initCover();
  el.retry.addEventListener('click', () => gotoPage(Math.max(1, state.loadedPages + 1)));
  el.moreBtn.addEventListener('click', () => loadOnePage());
  window.addEventListener('popstate', () => gotoPage(pageFromUrl()));

  // 封面头像 → 资料页（同微信点头像看个人主页）
  el.coverAvatar.classList.add('is-link');
  el.coverAvatar.addEventListener('click', () => {
    location.href = '/?about=1';
  });

  // 赞/评论浮层：点空白处、滚动页面、按 Esc 都收起（同微信）
  document.addEventListener('click', closePopover);
  window.addEventListener('scroll', closePopover, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });

  // 资料与首屏动态并行请求
  const cachedProfile = readCachedProfile();
  if (cachedProfile) applyProfile(cachedProfile); // 昵称/头像先用缓存，不用等接口
  const hadSnapshot = paintSnapshot();
  const freshFirstPage = hadSnapshot ? getMemos({ pageToken: '' }) : null;
  if (!hadSnapshot) firstPageTask = getMemos({ pageToken: '' });
  await Promise.all([profileTask, gotoPage(pageFromUrl())]);
  if (freshFirstPage) refreshFirstPage(freshFirstPage);

  state.booting = false;
  syncUrl();
  onScroll();
}

boot();
