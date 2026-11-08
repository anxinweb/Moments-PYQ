/**
 * 朋友圈 · 展示页
 * 拉公开内容、按微信朋友圈排版渲染、点图看大图。
 * 入口：封面头像/昵称 → 资料页；信息流头像/昵称 → 详情页；右上角菜单可转发。
 * 仍然没有评论、点赞、外链跳转、登录与令牌。
 */
const { CONFIG } = require('../../utils/config.js');
const { getProfile, getMemos } = require('../../utils/api.js');
const fmt = require('../../utils/format.js');

const GAP = 4;
const TOP_THRESHOLD = 600;

Page({
  data: {
    statusBarHeight: 20,
    coverHeight: 300,
    navSolid: false,
    showTop: false,
    fontPx: '16px',
    foldLines: CONFIG.FOLD_LINES,
    charsPerLine: 18,

    profile: { name: CONFIG.NICKNAME, avatar: '' },
    coverUrl: CONFIG.COVER_URL,
    coverMode: CONFIG.COVER_MODE,

    // loading | ready | empty | error
    viewState: 'loading',
    skeletons: [1, 2, 3],
    moments: [],
    nextPageToken: '',
    loadingMore: false,
    loadError: false,
    done: false,
    playingKey: '',
    audioProgress: 0,
    audioTimeText: '0:00',

    cell3Px: '90px',
    cell2Px: '140px',
    grid2WidthPx: '280px',
    singleWidthPx: '200px',
  },

  onLoad: function () {
    // 新基础库优先 getWindowInfo（getSystemInfoSync 已标记弃用，会打警告）
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = sys.windowWidth || 375;
    const height = sys.windowHeight || 700;
    const scale = fmt.fontScale();
    // 与 WXSS 的固定 px 布局对应：左右 16 + 头像 40 + 间距 12
    const contentW = width - 84;
    // 正文每行约可容纳的中文字数，供「是否折叠」的估算使用
    const charsPerLine = Math.max(8, Math.floor(contentW / (16 * scale)));
    const cell3 = Math.max(60, Math.floor((contentW - GAP * 2) / 3));
    const grid2W = Math.max(140, Math.floor(contentW * 0.666));
    const cell2 = Math.max(60, Math.floor((grid2W - GAP) / 2));
    const singleW = Math.max(120, Math.min(Math.floor(contentW * 0.66), 208));
    const coverHeight = Math.min(380, Math.max(240, Math.round(height * 0.46)));

    this.audioCtx = null;
    this.lastAudioSec = -1;
    this.audioDurationSec = 0;
    // 首屏/每次刷新递增，作废旧分页请求的回调
    this.pageGeneration = 0;
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      coverHeight: coverHeight,
      fontPx: (16 * scale).toFixed(1) + 'px',
      charsPerLine: charsPerLine,
      cell3Px: cell3 + 'px',
      cell2Px: cell2 + 'px',
      grid2WidthPx: grid2W + 'px',
      singleWidthPx: singleW + 'px',
    });
    this.loadFirst();
  },

  onHide: function () {
    this.destroyAudio();
    this.setData({ playingKey: '', audioProgress: 0, audioTimeText: '0:00' });
  },

  onUnload: function () {
    this._unloaded = true;
    this.destroyAudio();
  },

  onPageScroll: function (e) {
    // 只在状态真正改变时 setData，避免滚动过程频繁触发渲染
    const threshold = this.data.coverHeight - 44 - this.data.statusBarHeight;
    const patch = {};
    const solid = e.scrollTop > threshold;
    if (solid !== this.data.navSolid) patch.navSolid = solid;
    const showTop = e.scrollTop > TOP_THRESHOLD;
    if (showTop !== this.data.showTop) patch.showTop = showTop;
    if (Object.keys(patch).length) this.setData(patch);
  },

  onPullDownRefresh: function () {
    this.loadFirst(function () {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom: function () {
    this.loadMore();
  },

  /* ------------------------------------------------------------ 数据 */

  loadFirst: function (callback) {
    const finish = function () {
      if (callback) callback();
    };
    // 作废所有进行中的分页请求，避免旧第二页回来覆盖刷新后的列表
    this.pageGeneration = (this.pageGeneration || 0) + 1;
    const hasContent = this.data.moments.length > 0;
    this.destroyAudio();
    this.setData({
      // 已有内容时保持原视图（下拉刷新自带原生指示器），弱网失败也不会卡在骨架屏
      viewState: hasContent ? this.data.viewState : 'loading',
      loadingMore: false,
      loadError: false,
      showTop: false,
      playingKey: '',
      audioProgress: 0,
      audioTimeText: '0:00',
    });

    Promise.all([
      getProfile().catch(function () { return null; }),
      getMemos('').catch(function () { return null; }),
    ])
      .then(function (results) {
        if (this._unloaded) return; // 页面已销毁，不再 setData
        const profile = results[0];
        const page = results[1];
        const patch = {};
        if (profile) patch.profile = profile;

        if (!page) {
          if (!this.data.moments.length) {
            patch.viewState = 'error';
          } else {
            patch.viewState = 'ready';
            wx.showToast({ title: '刷新失败，已保留现有内容', icon: 'none' });
          }
          this.setData(patch);
          return;
        }

        const opts = this.momentOptions();
        const list = page.memos.map(function (m) { return fmt.buildMoment(m, opts); });
        patch.moments = list;
        patch.nextPageToken = page.nextPageToken;
        patch.done = !page.nextPageToken;
        patch.viewState = list.length ? 'ready' : 'empty';
        this.setData(patch);
      }.bind(this))
      .catch(function () {
        if (this._unloaded) return;
        this.setData({ viewState: this.data.moments.length ? 'ready' : 'error' });
      }.bind(this))
      .then(finish);
  },

  loadMore: function () {
    const d = this.data;
    if (d.loadingMore || d.done || d.viewState !== 'ready' || !d.nextPageToken) return;
    const gen = this.pageGeneration || 0;
    this.setData({ loadingMore: true, loadError: false });

    getMemos(d.nextPageToken)
      .then(function (page) {
        if (gen !== this.pageGeneration || this._unloaded) return; // 期间刷新过或已销毁，丢弃旧结果
        const opts = this.momentOptions();
        const list = page.memos.map(function (m) { return fmt.buildMoment(m, opts); });
        // 只下发新增项：翻得越深，整份列表（含全部图片地址）重复传输的开销越大
        const patch = {};
        const start = this.data.moments.length;
        list.forEach(function (m, i) {
          patch['moments[' + (start + i) + ']'] = m;
        });
        patch.nextPageToken = page.nextPageToken;
        patch.done = !page.nextPageToken;
        patch.loadingMore = false;
        this.setData(patch);
      }.bind(this))
      .catch(function () {
        if (gen !== this.pageGeneration || this._unloaded) return;
        this.setData({ loadingMore: false, loadError: true });
      }.bind(this));
  },

  /** 展示对象统一由 utils/format.js#buildMoment 生成，这里只提供页面差异参数 */
  momentOptions: function () {
    return {
      hideTags: CONFIG.HIDE_TAGS,
      foldable: true,
      foldLines: CONFIG.FOLD_LINES,
      charsPerLine: this.data.charsPerLine,
      layout: {
        cell3Px: this.data.cell3Px,
        cell2Px: this.data.cell2Px,
        grid2WidthPx: this.data.grid2WidthPx,
        singleWidthPx: this.data.singleWidthPx,
      },
    };
  },

  /* ------------------------------------------------------------ 交互（仅浏览） */

  toggleFold: function (e) {
    const i = Number(e.currentTarget.dataset.index);
    const m = this.data.moments[i];
    if (!m) return;
    const patch = {};
    patch['moments[' + i + '].folded'] = !m.folded;
    this.setData(patch);
  },

  onPreviewImage: function (e) {
    const mid = Number(e.currentTarget.dataset.mid);
    const index = Number(e.currentTarget.dataset.index);
    const m = this.data.moments[mid];
    const img = m && m.images[index];
    if (!img || !m.allOrigins.length) return;
    wx.previewImage({ current: img.origin, urls: m.allOrigins });
  },

  onImageError: function (e) {
    const mid = Number(e.currentTarget.dataset.mid);
    const index = Number(e.currentTarget.dataset.index);
    const m = this.data.moments[mid];
    const img = m && m.images[index];
    // 老附件可能没有缩略图，退回原图，且只回退一次
    if (!img || img.thumb === img.origin) return;
    const patch = {};
    patch['moments[' + mid + '].images[' + index + '].thumb'] = img.origin;
    this.setData(patch);
  },

  onAvatarError: function () {
    this.setData({ 'profile.avatar': '' });
  },

  /** 音频播放：同时维护互斥播放、时长、当前时间与进度条 */
  onToggleAudio: function (e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    if (this.data.playingKey === url) {
      if (this.audioCtx) this.audioCtx.pause();
      this.setData({ playingKey: '', audioProgress: 0, audioTimeText: '0:00' });
      return;
    }
    if (!wx.createInnerAudioContext) {
      wx.showToast({ title: '当前环境不支持音频播放', icon: 'none' });
      return;
    }
    this.destroyAudio();
    const ctx = wx.createInnerAudioContext();
    ctx.src = url;
    this.lastAudioSec = -1;
    this.audioDurationSec = 0;
    // 旧实例 destroy 后回调仍可能到达（onError → destroy → stop 尤其容易），
    // 统一校验当前实例，避免旧回调覆盖新播放状态
    const alive = function () { return this.audioCtx === ctx; }.bind(this);
    ctx.onCanplay(function () {
      if (!alive()) return;
      this.audioDurationSec = Number(ctx.duration) || 0;
      this.setData({ audioTimeText: '0:00 / ' + fmt.clockText(this.audioDurationSec) });
    }.bind(this));
    ctx.onTimeUpdate(function () {
      if (!alive()) return;
      const cur = Number(ctx.currentTime) || 0;
      const sec = Math.floor(cur);
      if (sec === this.lastAudioSec) return; // 每秒最多刷新一次
      this.lastAudioSec = sec;
      const dur = this.audioDurationSec || Number(ctx.duration) || 0;
      this.setData({
        audioTimeText: fmt.clockText(cur) + ' / ' + fmt.clockText(dur),
        audioProgress: dur ? Math.min(100, Math.round((cur / dur) * 100)) : 0,
      });
    }.bind(this));
    ctx.onEnded(function () { if (alive()) this.resetAudioState(); }.bind(this));
    ctx.onError(function () { if (alive()) this.resetAudioState(); }.bind(this));
    // 先挂实例再 play，避免基础库同步触发 onCanplay 时被校验误挡
    this.audioCtx = ctx;
    this.setData({ playingKey: url, audioProgress: 0, audioTimeText: '0:00 / --:--' });
    ctx.play();
  },

  resetAudioState: function () {
    this.destroyAudio();
    this.setData({ playingKey: '', audioProgress: 0, audioTimeText: '0:00' });
  },

  destroyAudio: function () {
    const ctx = this.audioCtx;
    if (!ctx) return;
    this.audioCtx = null; // 先置空：stop/destroy 期间触发的回调会被 alive() 挡掉
    try {
      ctx.stop();
      ctx.destroy();
    } catch (err) {
      /* ignore */
    }
  },

  onRetry: function () {
    this.loadFirst();
  },

  onRetryMore: function () {
    this.loadMore();
  },

  /** 回到顶部：wx.pageScrollTo 是基础能力，零权限 */
  onBackTop: function () {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  /* ------------------------------------------------------------ 页面入口与转发 */

  /** 封面头像 / 昵称 → 资料页（Memos 与朋友圈链接，仅可复制） */
  openProfile: function () {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  /** 信息流头像 / 昵称 → 单条详情页 */
  openDetail: function (e) {
    const uid = e.currentTarget.dataset.uid;
    if (!uid) return;
    wx.navigateTo({ url: '/pages/detail/detail?uid=' + uid });
  },

  /** 右上角「…」→ 转发给微信好友：基础能力，无需申请任何权限 */
  onShareAppMessage: function () {
    return {
      title: CONFIG.SITE_TITLE,
      path: '/pages/index/index',
      // 不指定时微信会自动截屏，弱网或首屏未加载完容易得到白卡片
      imageUrl: CONFIG.FALLBACK_SHARE_IMAGE,
    };
  },
});
