/**
 * 朋友圈小程序 · 只读数据层
 * 复用网页版已经在跑的 Vercel Edge 代理，没有任何写操作 / 令牌 / 登录。
 */
const { CONFIG } = require('./config.js');

function getJSON(url) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      header: { accept: 'application/json' },
      timeout: CONFIG.REQUEST_TIMEOUT,
      success: function (res) {
        if (res.statusCode === 200 && res.data && typeof res.data === 'object') {
          resolve(res.data);
        } else {
          reject(new Error('HTTP ' + res.statusCode));
        }
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || 'network_error'));
      },
    });
  });
}

function absolute(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return CONFIG.MEMOS_URL + (url.charAt(0) === '/' ? url : '/' + url);
}

function normalizeProfile(raw) {
  return {
    name: (raw && (raw.displayName || raw.username)) || CONFIG.NICKNAME,
    avatar: raw && raw.avatarUrl ? absolute(raw.avatarUrl) : '',
    bio: (raw && raw.description) || '',
  };
}

function getProfile() {
  return getJSON(
    CONFIG.API_BASE + '/profile?user=' + encodeURIComponent(CONFIG.ADMIN_USER)
  ).then(normalizeProfile);
}

function getMemos(pageToken) {
  let url = CONFIG.API_BASE + '/feed?pageSize=' + CONFIG.PAGE_SIZE;
  if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
  return getJSON(url).then(function (data) {
    const memos = (data.memos || [])
      .filter(function (m) {
        return m.state !== 'ARCHIVED';
      })
      .filter(function (m) {
        return m.creator === 'users/' + CONFIG.ADMIN_USER;
      });
    return { memos: memos, nextPageToken: data.nextPageToken || '' };
  });
}

module.exports = { getProfile: getProfile, getMemos: getMemos };
