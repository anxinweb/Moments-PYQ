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

Page({
  data: {
    statusBarHeight: 20,
    coverHeight: 300,
    navSolid: false,

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
    // 与 WXSS 的固定 px 布局对应：左右 16 + 头像 40 + 间距 12
    const contentW = width - 84;
    const cell3 = Math.max(60, Math.floor((contentW - GAP * 2) / 3));
    const grid2W = Math.max(140, Math.floor(contentW * 0.666));
    const cell2 = Math.max(60, Math.floor((grid2W - GAP) / 2));
    const singleW = Math.max(120, Math.min(Math.floor(contentW * 0.66), 208));
    const coverHeight = Math.min(380, Math.max(240, Math.round(height * 0.46)));

    this.audioCtx = null;
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      coverHeight: coverHeight,
      cell3Px: cell3 + 'px',
      cell2Px: cell2 + 'px',
      grid2WidthPx: grid2W + 'px',
      singleWidthPx: singleW + 'px',
    });
    this.loadFirst();
  },

  onHide: function () {
    this.destroyAudio();
    this.setData({ playingKey: '' });
  },

  onUnload: function () {
    this.destroyAudio();
  },

  onPageScroll: function (e) {
    const threshold = this.data.coverHeight - 44 - this.data.statusBarHeight;
    const solid = e.scrollTop > threshold;
    if (solid !== this.data.navSolid) this.setData({ navSolid: solid });
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
    this.destroyAudio();
    this.setData({ viewState: 'loading', loadError: false, playingKey: '' });

    Promise.all([
      getProfile().catch(function () { return null; }),
      getMemos('').catch(function () { return null; }),
    ])
      .then(function (results) {
        const profile = results[0];
        const page = results[1];
        const patch = {};
        if (profile) patch.profile = profile;

        if (!page) {
          if (!this.data.moments.length) {
            patch.viewState = 'error';
          } else {
            wx.showToast({ title: '刷新失败，已保留现有内容', icon: 'none' });
          }
          this.setData(patch);
          return;
        }

        const list = page.memos.map(this.buildMoment, this);
        patch.moments = list;
        patch.nextPageToken = page.nextPageToken;
        patch.done = !page.nextPageToken;
        patch.viewState = list.length ? 'ready' : 'empty';
        this.setData(patch);
      }.bind(this))
      .catch(function () {
        this.setData({ viewState: 'error' });
      }.bind(this))
      .then(finish);
  },

  loadMore: function () {
    const d = this.data;
    if (d.loadingMore || d.done || d.viewState !== 'ready' || !d.nextPageToken) return;
    this.setData({ loadingMore: true, loadError: false });

    getMemos(d.nextPageToken)
      .then(function (page) {
        const list = page.memos.map(this.buildMoment, this);
        this.setData({
          moments: d.moments.concat(list),
          nextPageToken: page.nextPageToken,
          done: !page.nextPageToken,
          loadingMore: false,
        });
      }.bind(this))
      .catch(function () {
        this.setData({ loadingMore: false, loadError: true });
      }.bind(this));
  },

  /** Memos 原始 memo → WXML 可直接绑定的展示对象（复杂计算全部在此完成） */
  buildMoment: function (memo) {
    const content = fmt.renderContent(memo.content, { hideTags: CONFIG.HIDE_TAGS });
    const media = fmt.mediaOf(memo);
    const total = media.images.length;
    const shown = media.images.slice(0, 9);
    const images = shown.map(function (img, i) {
      return {
        thumb: img.thumb,
        origin: img.url,
        more: i === 8 && total > 9,
        moreCount: total - 9,
      };
    });
    const gridType = total === 1 ? 1 : (total === 2 || total === 4) ? 2 : 3;
    const lineCount = (content.match(/\n/g) || []).length + 1;
    const needFold = content.length > 150 || lineCount > CONFIG.FOLD_LINES;

    return {
      uid: String(memo.name || '').split('/')[1] || String(memo.name || ''),
      content: content,
      needFold: needFold,
      folded: true,
      timeText: fmt.timeText(memo.createTime),
      images: images,
      // +N 折叠的图片也能在预览里左右滑到，与微信一致
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

  onToggleAudio: function (e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    if (this.data.playingKey === url) {
      if (this.audioCtx) this.audioCtx.pause();
      this.setData({ playingKey: '' });
      return;
    }
    if (!wx.createInnerAudioContext) {
      wx.showToast({ title: '当前环境不支持音频播放', icon: 'none' });
      return;
    }
    this.destroyAudio();
    const ctx = wx.createInnerAudioContext();
    ctx.src = url;
    ctx.onEnded(function () { this.setData({ playingKey: '' }); }.bind(this));
    ctx.onError(function () { this.setData({ playingKey: '' }); }.bind(this));
    ctx.play();
    this.audioCtx = ctx;
    this.setData({ playingKey: url });
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

  onRetry: function () {
    this.loadFirst();
  },

  onRetryMore: function () {
    this.loadMore();
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
    };
  },
});
