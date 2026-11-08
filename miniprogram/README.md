# 朋友圈 · 微信小程序（纯展示版）

把 `pyq.ahxin.cn` 的朋友圈页面移植成原生微信小程序，**只做展示**：
没有评论、点赞、详情页、昵称/头像跳转、相机、分享、外链等任何入口，也没有登录、令牌和写接口。

与网页版是两套独立代码：网页版仍在项目根目录，本目录全是新建文件，互不影响。

## 目录

```
miniprogram/
├── app.js / app.json / app.wxss     小程序入口与全局配置
├── project.config.json             工程配置（appid 仍为 touristappid）
├── sitemap.json
├── images/cover.jpg                封面（复制自网页版 assets，随包内置）
├── utils/
│   ├── config.js                   站点与接口配置，改这里即可换站点
│   ├── api.js                      只读数据层（wx.request）
│   └── format.js                   Markdown 精简 / 相对时间 / 附件地址
└── pages/index/                    唯一的页面：封面 + 信息流 + 九宫格
```

## 功能对照（相对网页版）

| 保留 | 移除 |
|---|---|
| 沉浸式封面、昵称压边、滚动后导航变实心 | 点赞、评论、回复、审核中 |
| 正文 6 行折叠 / 全文 | 「…」赞评浮层、评论输入框 |
| 九宫格（1/2·4/3+ 布局、+N 折叠） | 单条详情页、头像/昵称跳转 |
| 点图全屏预览（含被折叠的图片） | 主页外链、相机、分享、复制链接 |
| 视频播放、音频播放、附件只读卡片 | 主题切换、PWA、地址栏分页 |
| 分页加载、触底自动加载、下拉刷新 | 任何写操作、任何登录/令牌 |
| 骨架屏、空态、错误重试 | |

正文中的 Markdown 会降级成纯文本：标签隐藏，链接只保留文字、**不可点**，符合"无入口"定位。

## 数据来源（架构决策）

**已采用 A：复用现成的 Vercel Edge 只读代理。**

- `GET https://pyq.ahxin.cn/api/profile?user=ahxin` → 昵称 / 头像
- `GET https://pyq.ahxin.cn/api/feed?pageSize=20&pageToken=...` → 公开信息流
- 小程序内按 `creator === users/ahxin` 过滤，与网页版一致
- 附件与缩略图直连 `https://memos.ahxin.cn/file/...`（`?thumbnail=true` 走缩略图，预览走原图）

选 A 的原因：后端零改动、无需新部署、接口已经处理了 Memos 的作者过滤与边缘缓存，且小程序不受浏览器 CORS 限制。

**备选 B：直连 `https://memos.ahxin.cn/api/memos`**，省掉一层代理，但要在小程序端自己做分页、作者过滤、缓存，并且 Memos 接口一旦变更需要同步改两端。仅在 A 的域名无法配置白名单时才考虑。

## 正式发布前必须做的两件事

1. **配置服务器域名**（微信公众平台 → 开发 → 开发管理 → 开发设置 → 服务器域名）：
   - `request` 合法域名：`https://pyq.ahxin.cn`
   - `downloadFile` 合法域名：`https://memos.ahxin.cn`（图片、头像、大图预览、视频、音频都走这里）
   - 域名需 HTTPS 且已备案。
2. **把 `project.config.json` 的 `appid` 换成自己的小程序 AppID，`urlCheck` 改回 `true`**。
   当前为 `touristappid` + `urlCheck: false`，仅用于本地开发与 WorkBuddy 内预览，微信开发者工具打开需要真实 AppID。

## 本地预览 / 发布

- WorkBuddy：直接打开本小程序的应用预览卡片。
- 微信开发者工具：导入本目录，填入真实 AppID；调试阶段可勾选「不校验合法域名」。
- 正式发布：在应用预览面板右上角点「分享」，选择试用小程序或绑定已有小程序，后续上传 / 提审 / 发布都在面板内完成，不需要从开发者工具手工上传。

## 常用配置（`utils/config.js`）

| 想改什么 | 改哪里 |
|---|---|
| 换数据源域名 | `API_BASE`、`MEMOS_URL` |
| 换作者 / 兜底昵称 | `ADMIN_USER`、`NICKNAME` |
| 每页条数 | `PAGE_SIZE`（Memos 上限 50） |
| 显示正文 #标签 | `HIDE_TAGS: false` |
| 换封面 | 替换 `images/cover.jpg`，或把 `COVER_URL` 改成外链（外链域名也要加白名单） |
