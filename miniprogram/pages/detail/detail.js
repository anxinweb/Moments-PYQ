/**
 * 单条动态详情页
 * 进入方式：信息流点头像/昵称，或好友点开分享卡片（path 带 uid 冷启动）。
 * 数据与网页版 ?memo=<uid> 同源：GET /api/memo?uid=<uid>。
 * 分享入口收在时间行的「两点」菜单里：① 复制网页版链接 ② 转发给好友。
 * 两者都是小程序基础能力，无需申请权限、无需用户授权。
 */
const { CONFIG } = require('../../utils/config.js');
const { getProfile, getMemo } = require('../../utils/api.js');
const fmt = require('../../utils/format.js');

const GAP = 4;

Page({
  data: {
    statusBarHeight: 20,
    contentTop: 64,
    fontPx: '16px',
    uid: '',
    shareUrl: '',
    shareImage: '',
    profile: { name: CONFIG.NICKNAME, avatar: '', bio: '' },
    viewState: 'loading',
    moment: null,
    playingKey: '',
    audioProgress: 0,
    audioTimeText: '0:00',
    shareMenuOpen: false,

    cell3Px: '90px',
    cell2Px: '140px',
    grid2WidthPx: '280px',
    singleWidthPx: '200px',
  },

  onLoad: function (options) {
    // 分享卡片的 query 由微信解码后传入，按 Memos uid 字符集清洗，
    // 避免被篡改的参数污染复制链接与详情接口
    const uid = String((options && options.uid) || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const bar = sys.statusBarHeight || 20;
    const width = sys.windowWidth || 375;
    const contentW = width - 84;
    const cell3 = Math.max(60, Math.floor((contentW - GAP * 2) / 3));
    const grid2W = Math.max(140, Math.floor(contentW * 0.666));
    const cell2 = Math.max(60, Math.floor((grid2W - GAP) / 2));
    const singleW = Math.max(120, Math.min(Math.floor(contentW * 0.66), 208));

    this.audioCtx = null;
    this.lastAudioSec = -1;
    this.audioDurationSec = 0;
    this.setData({
      uid: uid,
      shareUrl: CONFIG.SHARE_BASE + uid,
      // 数据还没回来时（用户立刻点「…」转发）也有一张可用封面
      shareImage: CONFIG.FALLBACK_SHARE_IMAGE,
      statusBarHeight: bar,
      contentTop: bar + 44 + 12,
      fontPx: (16 * fmt.fontScale()).toFixed(1) + 'px',
      cell3Px: cell3 + 'px',
      cell2Px: cell2 + 'px',
      grid2WidthPx: grid2W + 'px',
      singleWidthPx: singleW + 'px',
    });
    this.load();
  },

  onHide: function () {
    this.destroyAudio();
    this.setData({ playingKey: '', audioProgress: 0, audioTimeText: '0:00', shareMenuOpen: false });
  },

  onUnload: function () {
    this._unloaded = true;
    this.destroyAudio();
  },

  load: function () {
    const uid = this.data.uid;
    if (!uid) {
      this.setData({ viewState: 'error' });
      return;
    }
    this.setData({ viewState: 'loading', shareMenuOpen: false });
    Promise.all([
      getProfile().catch(function () { return null; }),
      getMemo(uid),
    ])
      .then(function (results) {
        if (this._unloaded) return;
        const patch = { viewState: 'ready' };
        if (results[0]) patch.profile = results[0];
        const m = fmt.buildMoment(results[1], this.momentOptions());
        patch.moment = m;
        // 转发卡片封面用缩略图（原图实测约 1.7MB，缩略图约 37KB）；
        // 纯文字动态优先用接口返回的真实头像，接口失败再用内置兜底
        const avatar = results[0] && results[0].avatar;
        patch.shareImage = m.images.length
          ? m.images[0].thumb
          : (avatar || CONFIG.FALLBACK_SHARE_IMAGE);
        this.setData(patch);
      }.bind(this))
      .catch(function () {
        if (this._unloaded) return;
        this.setData({ viewState: 'error' });
      }.bind(this));
  },

  /** 与首页共用 utils/format.js#buildMoment；差异只是详情页正文不折叠 */
  momentOptions: function () {
    return {
      hideTags: CONFIG.HIDE_TAGS,
      foldable: false,
      layout: {
        cell3Px: this.data.cell3Px,
        cell2Px: this.data.cell2Px,
        grid2WidthPx: this.data.grid2WidthPx,
        singleWidthPx: this.data.singleWidthPx,
      },
    };
  },

  onPreviewImage: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const m = this.data.moment;
    const img = m && m.images[index];
    if (!img || !m.allOrigins.length) return;
    wx.previewImage({ current: img.origin, urls: m.allOrigins });
  },

  onImageError: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const m = this.data.moment;
    const img = m && m.images[index];
    if (!img || img.thumb === img.origin) return;
    const patch = {};
    patch['moment.images[' + index + '].thumb'] = img.origin;
    this.setData(patch);
  },

  onAvatarError: function () {
    this.setData({ 'profile.avatar': '' });
  },

  /** 音频播放：互斥、时长、当前时间与进度条 */
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
    // 与首页一致：旧实例销毁后到达的回调一律忽略
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
      if (sec === this.lastAudioSec) return;
      this.lastAudioSec = sec;
      const dur = this.audioDurationSec || Number(ctx.duration) || 0;
      this.setData({
        audioTimeText: fmt.clockText(cur) + ' / ' + fmt.clockText(dur),
        audioProgress: dur ? Math.min(100, Math.round((cur / dur) * 100)) : 0,
      });
    }.bind(this));
    ctx.onEnded(function () { if (alive()) this.resetAudioState(); }.bind(this));
    ctx.onError(function () { if (alive()) this.resetAudioState(); }.bind(this));
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
    this.audioCtx = null; // 先置空，避免 stop/destroy 派发的回调重入
    try {
      ctx.stop();
      ctx.destroy();
    } catch (err) {
      /* ignore */
    }
  },

  goBack: function () {
    // 好友从分享卡片直接打开时本页就是首页，没有上一层，回落到信息流
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  /* ------------------------------------------------------------ 两点菜单 */

  toggleShareMenu: function () {
    this.setData({ shareMenuOpen: !this.data.shareMenuOpen });
  },

  closeShareMenu: function () {
    this.setData({ shareMenuOpen: false });
  },

  /** 只复制网页版链接，不跳转、不内嵌网页 */
  onCopyShare: function () {
    this.setData({ shareMenuOpen: false });
    wx.setClipboardData({ data: this.data.shareUrl });
  },

  onRetry: function () {
    this.load();
  },

  /** 转发给微信好友：标题跳过分割线/空行，好友点开直达本条详情 */
  onShareAppMessage: function () {
    const m = this.data.moment;
    const res = {
      title: fmt.shareTitle(m && m.content, CONFIG.SITE_TITLE),
      path: '/pages/detail/detail?uid=' + this.data.uid,
    };
    if (this.data.shareImage) res.imageUrl = this.data.shareImage;
    return res;
  },
});
