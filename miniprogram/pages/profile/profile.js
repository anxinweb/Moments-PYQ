/**
 * 资料页（封面头像 / 昵称进入）
 * 只展示资料 + 两条可复制链接，不打开任何外链，避免 web-view 的业务域名资质要求。
 */
const { CONFIG } = require('../../utils/config.js');
const { getProfile } = require('../../utils/api.js');
const fmt = require('../../utils/format.js');

Page({
  data: {
    statusBarHeight: 20,
    contentTop: 64,
    fontPx: '16px',
    version: CONFIG.VERSION,
    profile: { name: CONFIG.NICKNAME, avatar: '', bio: '' },
    links: [
      { key: 'memos', label: 'Memos 主页', url: CONFIG.MEMOS_HOME },
      { key: 'site', label: '朋友圈网页版', url: CONFIG.SITE_HOME },
    ],
  },

  onLoad: function () {
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const bar = sys.statusBarHeight || 20;
    this.setData({
      statusBarHeight: bar,
      contentTop: bar + 44 + 24,
      fontPx: (16 * fmt.fontScale()).toFixed(1) + 'px',
    });
    getProfile()
      .then(function (p) { this.setData({ profile: p }); }.bind(this))
      .catch(function () { /* 保留兜底资料 */ });
  },

  goBack: function () {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onAvatarError: function () {
    this.setData({ 'profile.avatar': '' });
  },

  /** wx.setClipboardData 是基础能力：无授权弹窗、无类目、无需申请 */
  onCopy: function (e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({ data: url });
  },

  onShareAppMessage: function () {
    return { title: CONFIG.SITE_TITLE, path: '/pages/index/index' };
  },
});
