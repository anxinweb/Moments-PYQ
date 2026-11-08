/**
 * 朋友圈小程序 · 只读数据层
 * 复用网页版已经在跑的 Vercel Edge 代理，没有任何写操作 / 令牌 / 登录。
 */
const { CONFIG } = require('./config.js');

/** 单次 GET；4xx 视为不可重试（如详情页 uid 不存在），网络错误 / 5xx 可重试 */
function requestOnce(url) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      header: { accept: 'application/json' },
      timeout: CONFIG.REQUEST_TIMEOUT,
      success: function (res) {
        if (res.statusCode === 200 && res.data && typeof res.data === 'object') {
          resolve(res.data);
          return;
        }
        const err = new Error('HTTP ' + res.statusCode);
        err.noRetry = res.statusCode >= 400 && res.statusCode < 500;
        reject(err);
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || 'network_error'));
      },
    });
  });
}

/** 弱网兜底：与网页版一致，失败后延迟自动重试，避免首屏因一次抖动直接进错误态 */
function getJSON(url) {
  return requestOnce(url).catch(function (err) {
    if (err && err.noRetry) throw err;
    if (!CONFIG.REQUEST_RETRY) throw err;
    return new Promise(function (resolve) {
      setTimeout(resolve, CONFIG.RETRY_DELAY || 400);
    }).then(function () {
      return requestOnce(url);
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
    // /api/feed 是上游原样转发，未做可见性过滤；这里与 /api/memo 的契约保持一致。
    // 字段缺失/结构异常必须判为失败，否则会被误显示成「还没有内容」
    if (!Array.isArray(data.memos)) throw new Error('bad_feed');
    const memos = data.memos
      .filter(function (m) {
        return m.state !== 'ARCHIVED';
      })
      .filter(function (m) {
        return !m.visibility || m.visibility === 'PUBLIC';
      })
      .filter(function (m) {
        return m.creator === 'users/' + CONFIG.ADMIN_USER;
      });
    return { memos: memos, nextPageToken: data.nextPageToken || '' };
  });
}

/** 单条动态（详情页 / 分享卡片冷启动）：仅本站作者的公开发布内容 */
function getMemo(uid) {
  const safe = String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return Promise.reject(new Error('invalid_uid'));
  return getJSON(CONFIG.API_BASE + '/memo?uid=' + encodeURIComponent(safe)).then(function (data) {
    const memo = data && data.memo;
    if (!memo || memo.state === 'ARCHIVED' || memo.creator !== 'users/' + CONFIG.ADMIN_USER) {
      throw new Error('not_found');
    }
    return memo;
  });
}

module.exports = { getProfile: getProfile, getMemos: getMemos, getMemo: getMemo };
