# 朋友圈 · Moments

一个 1:1 还原微信朋友圈视觉的静态页面，内容来自 Memos 公开接口，托管在 Vercel。

- 线上：<https://pyq.ahxin.cn/>
- 数据源：<https://memos.ahxin.cn/>（只读公开 memo，无需登录）
- 技术栈：原生 HTML / CSS / JavaScript（零构建），Vercel Edge Functions

## 功能

- 封面视差滚动、头像昵称压边排版、固定封面可随时更换
- 正文超 6 行折叠「全文 / 收起」
- 九宫格：单图自然比例、2/4 图两列、3+ 图三列，超 9 张显示「+N」
- 图片双层加载：列表用 Memos 原生缩略图（`?thumbnail=true`，约 60-100KB），
  点开灯箱才加载原图；支持左右滑、双击缩放拖动、键盘方向键、ESC
- 分页加载：每页 20 条 + 「加载更多」，当前页写入地址栏（`?page=2`），刷新/分享可回退
- 微信式相对时间（刚刚 / n分钟前 / n小时前 / 昨天 / M月D日 / YYYY年M月D日）
- 骨架屏、失败重试、回到顶部
- 深色 / 浅色主题，跟随系统可手动切换
- 响应式：手机全宽，平板/桌面单列居中（最宽 720px），与微信 iPad 版朋友圈一致

## 目录结构

```
index.html          页面入口
css/styles.css      全部样式（浅色/深色两套变量 + 桌面自适应）
js/config.js        站点配置，改这里即可换站点信息
js/api.js           数据层：profile / feed / 缩略图地址
js/render.js        渲染：Markdown 精简、九宫格、时间
js/app.js           入口：分页、主题、灯箱、视差
api/feed.js         Edge 函数：转发 Memos 信息流（30s 边缘缓存，按作者过滤）
api/profile.js      Edge 函数：转发用户资料
assets/cover.jpg    封面图（直接替换此文件即可换封面）
dev-server.mjs      本地预览服务器（仅开发用，不部署）
```

## 本地预览

```bash
node dev-server.mjs
# 打开 http://127.0.0.1:5173
```

## 部署

1. 仓库推送到 GitHub
2. Vercel 导入仓库（框架预设选 Other，无需构建命令）
3. 绑定域名 `pyq.ahxin.cn`

## 常用配置（js/config.js）

| 想改什么 | 改哪里 |
|---|---|
| 换封面 | 替换 `assets/cover.jpg`，或 `COVER.URL` 指向新图/外链 |
| 封面裁切重心 | `COVER.MOBILE_POS` / `COVER.DESKTOP_POS` |
| 封面改成自动取最新配图 | `COVER.MODE: 'memo'` |
| 每页条数 | `PAGE_SIZE` |
| 隐藏/显示 #标签 | `HIDE_TAGS` |

## 路线图

- [x] P0 数据层重写 + 首页视觉还原
- [x] P0.5 分页改造、Memos 原生缩略图、固定封面、响应式
- [ ] P1 单条详情页、分享/复制链接
- [ ] P2 评论（专用账号，可见性=审核开关）+ 真实点赞（Upstash Redis）
- [ ] P3 环境变量、上线核对
