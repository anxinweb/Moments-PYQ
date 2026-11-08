/**
 * 朋友圈小程序 · 站点配置
 * 与网页版 js/config.js 对齐，只保留「只读展示」需要的项。
 * 小程序无任何写入接口：不含评论、点赞、登录、令牌等配置。
 */
const CONFIG = {
  // 现成的 Vercel Edge 只读代理（同源接口，返回 Memos 公开内容）
  API_BASE: 'https://pyq.ahxin.cn/api',

  // Memos 实例：用于拼接附件原图、缩略图与头像
  MEMOS_URL: 'https://memos.ahxin.cn',

  // 作者过滤条件，与 Edge 接口返回的 creator 对应
  ADMIN_USER: 'ahxin',

  // 资料接口拉不到时的兜底昵称
  NICKNAME: 'ah新',
  SITE_TITLE: 'Ah新的朋友圈',

  // 每页条数（Memos 上限 50）
  PAGE_SIZE: 20,

  // 朋友圈没有标签体系，隐藏正文里的 #标签
  HIDE_TAGS: true,

  // 正文折叠行数
  FOLD_LINES: 6,

  // 封面随包内置，不依赖额外域名；替换此图即可换封面
  COVER_URL: '/images/cover.jpg',
  // 封面是竖图：aspectFill=铺满居中裁切（微信同款）；aspectFit=完整显示（两侧留深色底）
  COVER_MODE: 'aspectFill',

  // 资料页可复制的两个链接（只复制、不打开外链，避开 web-view 业务域名资质）
  MEMOS_HOME: 'https://memos.ahxin.cn/u/ahxin',
  SITE_HOME: 'https://pyq.ahxin.cn/',

  // 详情页分享链接前缀，与网页版 ?memo=<uid> 一致
  SHARE_BASE: 'https://pyq.ahxin.cn/?memo=',

  REQUEST_TIMEOUT: 12000,
};

module.exports = { CONFIG };
