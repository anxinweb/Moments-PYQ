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
    const uid = (options && options.uid) || '';
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
        const patch = { viewState: 'ready' };
        if (results[0]) patch.profile = results[0];
        const m = this.buildMoment(results[1]);
        patch.moment = m;
        // 纯文字动态也有卡片封面：回退到已在白名单内的站长头像
        patch.shareImage = m.allOrigins.length ? m.allOrigins[0] : CONFIG.FALLBACK_SHARE_IMAGE;
        this.setData(patch);
      }.bind(this))
      .catch(function () {
        this.setData({ viewState: 'error' });
      }.bind(this));
  },

  /** 与首页同一套展示逻辑，但详情页正文不折叠 */
  buildMoment: function (memo) {
    const content = fmt.renderContent(memo.content, { hideTags: CONFIG.HIDE_TAGS });
    const media = fmt.mediaOf(memo);
    const total = media.images.length;
    const images = media.images.slice(0, 9).map(function (img, i) {
      return {
        thumb: img.thumb,
        origin: img.url,
        more: i === 8 && total > 9,
        moreCount: total - 9,
      };
    });
    const gridType = total === 1 ? 1 : (total === 2 || total === 4) ? 2 : 3;
    return {
      uid: String(memo.name || '').split('/')[1] || String(memo.name || ''),
      content: content,
      timeText: fmt.timeText(memo.createTime),
      images: images,
      allOrigins: media.images.map(function (img) { return img.url; }),
      gridType: gridType,
      gridStyle: gridType === 2 ? 'width:' + this.data.grid2WidthPx : '',
      cellStyle:
        gridType === 2
          ? 'width:' + this.data.cell2Px + ';height:' + this.data.cell2Px
          : 'width:' + this.data.cell3Px + ';height:' + this.data.cell3Px,
      singleStyle: 'width:' + this.data.singleWidthPx,
      extras: media.extras,
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
    ctx.onCanplay(function () {
      this.audioDurationSec = Number(ctx.duration) || 0;
      this.setData({ audioTimeText: '0:00 / ' + fmt.clockText(this.audioDurationSec) });
    }.bind(this));
    ctx.onTimeUpdate(function () {
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
    ctx.onEnded(function () { this.resetAudioState(); }.bind(this));
    ctx.onError(function () { this.resetAudioState(); }.bind(this));
    ctx.play();
    this.audioCtx = ctx;
    this.setData({ playingKey: url, audioProgress: 0, audioTimeText: '0:00 / --:--' });
  },

  resetAudioState: function () {
    this.destroyAudio();
    this.setData({ playingKey: '', audioProgress: 0, audioTimeText: '0:00' });
  },

  destroyAudio: function () {
    if (!this.audioCtx) return;
    try {
      this.audioCtx.stop();
      this.audioCtx.destroy();
    } catch (err) {
      /* ignore */
    }
    this.audioCtx = null;
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
