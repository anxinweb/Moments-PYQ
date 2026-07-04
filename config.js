/**
 * Moments - 朋友圈静态站配置文件
 * ──────────────────────────────────────
 * 部署前必改项标有 ★，常用项标有 ◆
 * 所有配置集中在此文件，部署时只需改这里
 */
const CONFIG = {

  // ╔══════════════════════════════════════╗
  // ║  ★ 1. Memos 连接                    ║
  // ╚══════════════════════════════════════╝

  MEMOS_URL: 'https://memos.ahxin.cn',         // Memos 实例地址（无末尾斜杠）
  API_PREFIX: '/api/v1',                        // Memos API 路径前缀（通常就是 /api/v1）
  ADMIN_NAME: 'ahxin',                           // ★ Memos 用户名，API 身份标识

  USE_PROXY: true,                               // ★ true=走代理 | false=直连(CORS 需配置)
  PLATFORM: 'vercel',                            // ★ 'vercel' | 'cloudflare' | 'netlify' | 'custom'
  CUSTOM_PROXY_PATH: '/api/proxy',               //   PLATFORM='custom' 时的代理路径
  PROXY_FILES: false,                            //   true=附件也走代理 | false=附件直连
  // 游客 GET 请求直连 memos,绕过 Vercel Serverless 冷启动(可达 12 秒)
  // 需 memos 后端配置 CORS 允许前端域名(已在 Nginx 配置 /api/ CORS)
  // 登录用户的请求(含 token)仍走 proxy,保护凭证不暴露
  DIRECT_GET_FOR_GUEST: true,

  // ╔══════════════════════════════════════╗
  // ║  ★ 2. 站点信息                      ║
  // ╚══════════════════════════════════════╝

  SITE_NAME: 'Moments',                          //   导航栏标题
  BROWSER_TITLE: 'Ah新的朋友圈',  // ★ 浏览器标签页标题
  SITE_DESCRIPTION: '记录生活中的每一刻',           //   meta description

  // -- Logo ——
  SHOW_SITE_LOGO: false,                         //   是否显示左上角图片 Logo
  SITE_LOGO_URL: './assets/favicon.ico',       //   左上角 Logo 图片
  SITE_LOGO_MAX_WIDTH: '32px',
  SITE_LOGO_MAX_HEIGHT: '32px',
  SITE_ICON_TEXT: '',                            //   Logo 文字（Logo 图片为空时显示）
  FAVICON_URL: './assets/favicon.ico',        //   浏览器标签页图标

  // -- 用户 ——
  ADMIN_NICKNAME: 'ah新',                         // ◆ 前台展示昵称（留空则用 ADMIN_NAME）
  ADMIN_AVATAR: './assets/avatar.png',            //   卡片头像 URL（留空用昵称首字母）
  ADMIN_AVATAR_MAX_WIDTH: '38px',
  ADMIN_AVATAR_MAX_HEIGHT: '38px',
  AUTO_FETCH_MEMOS_USER_PROFILE: true,            // ◆ 自动从 Memos API 获取头像和昵称

  // -- Memos 链接 ——
  MEMOS_ADMIN_URL: 'https://memos.ahxin.cn/auth', //   导航栏管理后台入口
  MEMO_DETAIL_URL_TEMPLATE: 'https://memos.ahxin.cn/memos/{id}',  // 点击时间跳转

  // ╔══════════════════════════════════════╗
  // ║  ◆ 3. 分页模式                      ║
  // ╚══════════════════════════════════════╝

  // 'infinite'   无限滚动（默认，目前行为）
  // 'loadmore'   底部显示"加载更多"按钮，点击才加载
  // 'pagination' 显示翻页导航 + 输入页码跳转
  PAGINATION_MODE: 'loadmore',
  PAGE_SIZE: 20,                                 //   每页条目数

  // ╔══════════════════════════════════════╗
  // ║  ◆ 4. 主题                          ║
  // ╚══════════════════════════════════════╝

  // 'luxury' | 'atelier' | 'graphite' | 'paper' | 'parchment' | 'linen' | 'wechat' | 'qzone'
  THEME_PRESET: 'luxury',

  // 'system' 跟随系统 | 'light' 固定亮色 | 'dark' 固定暗色 | 'schedule' 按时间
  DARK_MODE_STRATEGY: 'system',
  THEME_ALLOW_USER_OVERRIDE: true,                //   是否允许用户前台手动切换明暗
  DARK_MODE_START: '19:00',                       //   schedule 模式：暗色开始时间
  DARK_MODE_END: '07:00',                         //   schedule 模式：暗色结束时间

  // ╔══════════════════════════════════════╗
  // ║  5. 上传 & 附件                      ║
  // ╚══════════════════════════════════════╝

  OPTIMIZE_UPLOAD_IMAGES: true,                  //   发布前压缩大图
  UPLOAD_IMAGE_MAX_SIZE: 1920,                   //   最长边 px，0 不限制
  UPLOAD_IMAGE_QUALITY: 0.82,                    //   压缩质量 0.1~1
  UPLOAD_IMAGE_MIN_COMPRESS_SIZE: 600 * 1024,    //   低于此体积不压缩

  // ╔══════════════════════════════════════╗
  // ║  6. 卡片展示                          ║
  // ╚══════════════════════════════════════╝

  MAX_IMAGES_PER_MEMO: 9,                        //   每条最多显示几张图片
  SINGLE_IMAGE_MAX_WIDTH: '260px',               //   单图最大宽度
  SINGLE_IMAGE_MAX_HEIGHT: '360px',              //   单图最大高度
  CONTENT_COLLAPSE_THRESHOLD: 300,               //   超此字符数自动折叠，0 不折叠
  LAZY_LOAD_OFFSET: 200,                         //   图片懒加载提前像素

  // ╔══════════════════════════════════════╗
  // ║  7. 交互                              ║
  // ╚══════════════════════════════════════╝

  REACTION_EMOJIS: ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '💯'],
  ENABLE_REACTIONS_FETCH: false,                  //   是否首屏拉取 reactions(20条×1请求,慢),false=点击时才拉取
  SEARCH_DEBOUNCE: 300,                          //   搜索防抖 ms
  ENABLE_STATS: true,                            //   是否启用统计面板

  // ╔══════════════════════════════════════╗
  // ║  8. 实时更新                          ║
  // ╚══════════════════════════════════════╝

  ENABLE_SSE: false,                             //   SSE 实时推送（需 Memos 配置）
  SSE_POLL_INTERVAL: 30000,                      //   轮询间隔 ms，0 不轮询
};
