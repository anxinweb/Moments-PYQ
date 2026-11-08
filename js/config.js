/**
 * 朋友圈 · 站点配置
 * 只保留真正需要改的项，其余走默认值
 */
export const CONFIG = {
  // Memos 实例（无末尾斜杠）
  MEMOS_URL: 'https://memos.ahxin.cn',

  // 站长用户名，用于拉取昵称与头像，同时作为信息流的作者过滤条件
  ADMIN_USER: 'ahxin',

  // 兜底昵称（接口拉不到时显示）
  NICKNAME: 'ah新',

  SITE_TITLE: 'Ah新的朋友圈',

  // 每页条数（Memos 上限 50）
  PAGE_SIZE: 20,

  // 站内接口前缀
  API_BASE: '/api',

  /* ---------------- 封面 ----------------
   * MODE:
   *   fixed → 使用 URL 指定的固定图片（本地 assets 或外链）
   *   memo  → 自动取最新一条带图动态的第一张图
   *   none  → 不放图，纯渐变
   * 换封面最简单的方式：替换 assets/cover.jpg
   * MOBILE_POS / DESKTOP_POS 控制两种屏幕下的裁切重心
   */
  COVER: {
    MODE: 'fixed',
    URL: '/assets/cover.jpg?v=20261108',
    MOBILE_POS: '50% 50%',
    DESKTOP_POS: '50% 45%',
  },

  // 是否隐藏正文里的 #标签（朋友圈没有标签体系）
  HIDE_TAGS: true,

  // 正文折叠行数
  FOLD_LINES: 6,

  // 骨架屏条数
  SKELETON_COUNT: 3,

  // 右上角相机按钮跳转地址
  POST_URL: 'https://memos.ahxin.cn',

  /* ---------------- 评论（P2 生效） ----------------
   * 建一个专用账号来发评论，其 Access Token 只放 Vercel 环境变量
   * MEMOS_BOT_TOKEN，绝不进前端代码。评论先写成「私有」= 待审，
   * 在 Memos 里改成「公开」即通过。
   */
  COMMENTS: {
    BOT_USER: '',
  },
};
