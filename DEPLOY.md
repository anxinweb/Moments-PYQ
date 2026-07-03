# Moments · 朋友圈 — 完整部署指南

## 目录

1. [项目概述](#1-项目概述)
2. [网站逻辑与特色](#2-网站逻辑与特色)
3. [鉴权链路详解](#3-鉴权链路详解)
4. [代理模式 vs 直连模式 + 流量分析](#4-代理模式-vs-直连模式--流量分析)
5. [配置详解](#5-配置详解)
6. [项目目录与平台文件清单](#6-项目目录与平台文件清单)
7. [各平台部署](#7-各平台部署)
8. [部署环境变量](#8-部署环境变量)
9. [不部署的文件](#9-不部署的文件)
10. [CORS 跨域配置](#10-cors-跨域配置)
11. [常见问题](#11-常见问题)

---

## 1. 项目概述

基于 **Memos REST API v1** 的静态朋友圈展示站。

- **纯前端**：零 npm 依赖，HTML + CSS + JS 直接运行
- **代理转发**：通过 Vercel / Cloudflare / Netlify 的 Serverless Function 把 API 请求转发到 Memos
- **可选直连**：如果 Memos 配置了 CORS，也可以直接浏览器访问 Memos 的 API
- **部署平台**：Vercel（推荐）/ Cloudflare Pages / Netlify / 任意静态托管

---

## 2. 网站逻辑与特色

### 2.1 风格

- **WeChat 朋友圈风格**：卡片式布局、圆角 10px、极淡阴影、紧凑间距
- **头像 + 昵称 + 时间 + 位置** 的头部样式致敬微信
- 底部工具栏：编辑、删除按钮 + `···` 更多菜单
- 反应条（Emoji 点赞）在卡片底部
- 置顶卡片加置顶图标

### 2.2 内容展示

| 功能 | 说明 |
|------|------|
| 文字渲染 | 支持 Markdown 基础语法（标题、粗斜体、代码、链接、列表） |
| 图片 | 单图最大 260×360px，多图九宫格，点击灯箱浏览 |
| 音频 | 内嵌播放器，显示文件名/时长/大小 |
| 文件 | 显示文件名和大小，可下载 |
| 链接预览 | 自动识别 Memo 中的 URL，调用 Memos linkMetadata API 展示标题+描述+缩略图 |
| 长文折叠 | 超过 300 字自动截断，可点击展开 |
| 标签 | 自动从 Memo 内容提取 `#标签` |
| 标签筛选 | 点击标签栏过滤，支持"全部"回到原状 |
| 搜索 | 输入关键词实时搜索，高亮匹配文本 |
| 日期筛选 | 选择日期范围只看该时间段内容 |
| 可见性筛选 | 登录后出现 [全部/公开/登录可见/私密] 筛选栏 |

### 2.3 交互

| 功能 | 说明 |
|------|------|
| 无限滚动 / 加载更多 / 翻页 | 由 `config.js` 中 `PAGINATION_MODE` 控制 |
| 反应（点赞） | 点击 Emoji 添加反应，带粒子动画 |
| 批量操作 | 长按/点击卡片进入选择模式 → 批量删除或修改可见性 |
| 统计面板 | 日历热力图 + 标签云 + 概览（Memo 总数/活跃天数等） |
| 图片灯箱 | 点击图片放大，左右切换，Pinch Zoom |
| 深色模式 | 跟随系统 / 固定亮暗 / 定时切换 |
| 自动获取头像 | 从 Memos API 获取用户头像和昵称 |
| 实时更新 | 可选 SSE 推送或轮询（默认 30s 检查一次） |
| PWA | 可添加到桌面，离线缓存静态壳 |
| 链接独占视图 | 点击 `#memo-xxx` 链接只展示该条内容 |
| 复制分享链接 | `···` 菜单 → "复制分享" → 复制当前 Memo 的链接 |

### 2.4 分页模式

支持三种分页，在 `config.js` 中通过 `PAGINATION_MODE` 切换：

| 模式 | 行为 | 适用 |
|------|------|------|
| `infinite` | 滚动到底部自动加载下一页 | 内容多的长站点 |
| `loadmore` | 底部显示"加载更多"按钮 | 不想自动加载 |
| `pagination` | 底部翻页 + 输入页码跳转 | 逐页浏览 |

---

## 3. 鉴权链路详解

整个项目中**只有一个地方需要密码/Token** —— 就是 Memos Personal Access Token。

### 3.1 两条鉴权路径

```
用户浏览器                   部署平台 Serverless                 Memos 服务器
  │                            │                                 │
  ├─ [1] 登录弹窗输入 Token ──→│                                 │
  │   (向 /auth/login 发 POST) │                                 │
  │                            ├─ 验证 Token 与 FRONTEND_PUBLISH_TOKEN 是否一致
  │                            │   一致 → 200，用户"已登录"
  │                            │   不一致 → 401（见下方回退逻辑）
  │                            │
  ├─ [2] 登录后所有请求都附带 ─→│                                 │
  │   X-Publish-Token 头       │                                 │
  │                            ├─ 判断 MEMOS_API_KEY 是否设置    │
  │                            │   ├─ 设置了 → Bearer MEMOS_API_KEY ──→ 认证通过 ✓
  │                            │   └─ 未设置 → Bearer X-Publish-Token ──→ 需要该值是真实PAT
  │                            │                                     ↓
  │                            │                              认证通过 ✓
  │                            │                              返回数据
  │  ←─────────────────────────┼─────────────────────────────────┘
  │   200 + JSON 响应          │
```

### 3.2 两种 Token 的概念

| Token 名称 | 配置文件位置 | 是什么 | 用途 |
|-------------|-------------|--------|------|
| `MEMOS_API_KEY` | 部署平台环境变量 | Memos 的真实 PAT | 代理用它作为 Bearer 调 Memos API。**生产环境务必设置** |
| `FRONTEND_PUBLISH_TOKEN` | 部署平台环境变量 | 你自己设的口令 | 前端登录时验证。可以设任意字符串如 `abc123`。用户在前端输入这个值后，代理才允许发布/编辑/删除 |

### 3.3 本地开发时的便捷模式

如果你把 `FRONTEND_PUBLISH_TOKEN` 设为你的**真实 Memos PAT**，同时 `MEMOS_API_KEY` 留空，那么：

1. 前端登录时输入这个 PAT → 代理验证通过（本地 `auth/login` 检查 `FRONTEND_PUBLISH_TOKEN`）
2. 之后的 API 请求：代理看到 `MEMOS_API_KEY` 为空 → 自动使用 `X-Publish-Token`（就是你的真实 PAT）作为 Bearer 凭证 → Memos 认证通过

这样本地开发只需要配一个值（`FRONTEND_PUBLISH_TOKEN=你的真实PAT`），无需 `MEMOS_API_KEY`。

**.env.local 中的 `MEMOS_API_KEY` 是明文存储的！** 禁止提交到 Git，部署时也不要把 `.env.local` 传上部署平台。

---

## 4. 代理模式 vs 直连模式 + 流量分析

### 4.1 代理模式（`USE_PROXY: true`，默认推荐）

```
用户浏览器 ──→ 部署平台域名 (pyq.ahxin.cn) ──→ 平台 Serverless Function ──→ Memos 服务器
```

所有 `/api/proxy?path=...` 请求发给部署平台，平台函数收到后转发到 Memos。

### 4.2 流量分析：什么消耗 Vercel 带宽？

**仅当 ①使用口令登录 且 ②PROXY_FILES:true 时，所有流量都走 Vercel。**

你的预期配置：`USE_PROXY: true` + `PROXY_FILES: false` —— 这是最省流量的方案。

| 用户操作 | 口令登录（推荐） | 真实 PAT 登录（直连） |
|----------|-----------------|----------------------|
| **浏览内容** | 图片直连 `memos.ahxin.cn/file/` → **不消耗 Vercel** | 同左 → **不消耗 Vercel** |
| **发布文字** | API 走代理 → **少量消耗**（几千字节） | API 直连 → **不消耗 Vercel** |
| **发布图片/附件** | API 走代理 → **少量消耗**（API 请求本身小）<br>图片实际上传也走代理 | API 直连 → **不消耗 Vercel** |
| **登录操作** | 代理验证 Token → **不消耗**（极少量） | 直连验证 → **不消耗** |
| **批量操作** | 代理转发 → **少量消耗** | 直连 → **不消耗** |

**关键结论**：
- 图片/音频的**显示和查看原图**，始终直连 `memos.ahxin.cn/file/`，**不消耗 Vercel**
- 口令登录发布时，只有**API 请求本身**走代理（每次几百字节到几 KB），不是文件本身
- Vercel Hobby 套餐每月 100GB 带宽，纯文本 API 请求几乎用不完
- **强烈推荐一直用口令登录** —— 安全（PAT 不暴露给用户）+ 省心（Vercel 负责转发）

### 4.3 附件直连详解（理解图片怎么加载的）

```
┌─ 用户浏览器 ─────────────────────────────┐
│                                           │
│  卡片展示 <img src="memos.ahxin.cn/file/xxx/yyy?thumbnail=true">     │
│  灯箱原图 <img src="memos.ahxin.cn/file/xxx/yyy">                    │
│  音频     <audio src="memos.ahxin.cn/file/xxx/yyy.mp3">              │
│                                           │
└──────────────────┬────────────────────────┘
                   │ 直接请求 memos.ahxin.cn
                   ▼
┌─ Memos 服务器（由 1Panel/Nginx 反代）───┐
│  ／api/   → 转发到 127.0.0.1:5230        │
│  ／file/  → 转发到 127.0.0.1:5230        │
│  （加了 CORS 头，允许来自 pyq.ahxin.cn） │
└───────────────────────────────────────────┘
```

### 4.4 直连模式（`USE_PROXY: false`）

```
用户浏览器 ──→ Memos 服务器 (memos.ahxin.cn/api/v1/...)
```

- 完全不经过代理
- **必须**在 Memos 反向代理上配置 CORS
- 输入真实 PAT 登录后前端自动切换为直连模式

### 4.5 什么时候走代理 / 直连

| 请求 | 代理模式 + 口令登录 | 直连模式 + 真实PAT登录 |
|------|--------------------|---------------------|
| `GET /api/proxy?path=/memos` | 走代理 → Memos | 直连 Memos |
| `POST /api/proxy?path=/memos`（发布） | 走代理 | 直连 |
| `POST /api/proxy?path=/auth/login` | 走代理验证 | 走代理验证 |
| 图片 `<img src="memos.ahxin.cn/file/xxx">` | **直连**（`PROXY_FILES: false`） | **直连** |
| 图片 `<img src="pyq.ahxin.cn/api/proxy?path=/file/xxx">` | 走代理（`PROXY_FILES: true`） | 不适用 |

---

## 5. 配置详解

所有配置集中在 `config.js` 中，每个选项都有行尾注释。以下是详细说明：

### 5.1 Memos 连接（标 ★ 必改）

```js
MEMOS_URL: 'https://memos.ahxin.cn',        // Memos 实例根 URL，不要加末尾斜杠
ADMIN_NAME: 'ahxin',                          // ★ Memos 用户名，用于获取用户资料
USE_PROXY: true,                              // ★ true=走代理 | false=浏览器直连 Memos API
PLATFORM: 'vercel',                           // ★ 部署平台：vercel | cloudflare | netlify | custom
CUSTOM_PROXY_PATH: '/api/proxy',              // PLATFORM='custom' 时的代理路径
PROXY_FILES: false,                           // 附件是否也走代理（节省带宽建议 false）
```

### 5.2 站点信息（标 ★ 必改）

```js
SITE_NAME: 'Moments',                         // 导航栏左侧文字
BROWSER_TITLE: 'Ah新的朋友圈',                // ★ 浏览器标签页标题
SITE_DESCRIPTION: '记录生活中的每一刻',       // meta description，影响搜索引擎摘要

// Logo 配置
SHOW_SITE_LOGO: false,                        // 是否显示图片 Logo
SITE_LOGO_URL: './assets/faviconpyq.ico',     // Logo 图片路径
SITE_LOGO_MAX_WIDTH: '32px',                  // Logo 最大宽
SITE_LOGO_MAX_HEIGHT: '32px',                 // Logo 最大高
FAVICON_URL: './assets/faviconpyq.ico',        // 浏览器标签栏图标

// 用户配置
ADMIN_NICKNAME: 'ah新',                       // ◆ 前台显示的名称
ADMIN_AVATAR: './assets/avatar.png',          // 头像路径（留空用首字母圆圈）
ADMIN_AVATAR_MAX_WIDTH: '38px',
ADMIN_AVATAR_MAX_HEIGHT: '38px',
AUTO_FETCH_MEMOS_USER_PROFILE: true,          // 自动从 Memos API 拉取真实头像/昵称

// Memos 外链
MEMOS_ADMIN_URL: 'https://memos.ahxin.cn/auth',              // 后台管理链接
MEMO_DETAIL_URL_TEMPLATE: 'https://memos.ahxin.cn/memos/{id}', // Memo 详情页
```

### 5.3 分页模式

```js
PAGINATION_MODE: 'pagination',                // infinite | loadmore | pagination
PAGE_SIZE: 20,                                // 每页条目数
```

### 5.4 主题（可运行中切换，不修改也生效）

```js
THEME_PRESET: 'luxury',                       // 主题色预设
// 可选：luxury(蓝紫奢华)、atelier(红棕工坊)、graphite(灰调)、paper(纸白)
//        parchment(羊皮纸)、linen(亚麻)、wechat(微信绿)、qzone(QQ空间蓝)

DARK_MODE_STRATEGY: 'system',                 // system | light | dark | schedule
THEME_ALLOW_USER_OVERRIDE: true,              // 是否允许用户手动切换
DARK_MODE_START: '19:00',                     // schedule 模式的暗色开始时间
DARK_MODE_END: '07:00',                       // schedule 模式的暗色结束时间
```

### 5.5 上传 & 附件

```js
OPTIMIZE_UPLOAD_IMAGES: true,                 // 发布前压缩大图
UPLOAD_IMAGE_MAX_SIZE: 1920,                  // 最长边 px，0 不限制
UPLOAD_IMAGE_QUALITY: 0.82,                   // 压缩质量 0.1~1
UPLOAD_IMAGE_MIN_COMPRESS_SIZE: 600*1024,     // 低于此体积不压缩（600KB）
```

### 5.6 卡片展示

```js
MAX_IMAGES_PER_MEMO: 9,                       // 最多显示几张图片
SINGLE_IMAGE_MAX_WIDTH: '260px',              // 单图最大宽
SINGLE_IMAGE_MAX_HEIGHT: '360px',             // 单图最大高
CONTENT_COLLAPSE_THRESHOLD: 300,              // 超此字符数折叠（0=不折叠）
LAZY_LOAD_OFFSET: 200,                        // 懒加载提前像素
```

### 5.7 交互

```js
REACTION_EMOJIS: ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '💯'],  // 可用 Emoji
SEARCH_DEBOUNCE: 300,                         // 搜索防抖 ms
ENABLE_STATS: true,                           // 统计面板开关
```

### 5.8 实时更新

```js
ENABLE_SSE: false,                            // SSE 推送（需 Memos 配置支持）
SSE_POLL_INTERVAL: 30000,                     // 轮询间隔 ms，0=不轮询
```

---

## 6. 项目目录与平台文件清单

### 6.1 完整目录结构（每个文件的作用）

```
moments/                           # 项目根目录（上传到你的 Git 仓库）
│
├── index.html                     # ★ 入口页面（必传）
├── config.js                      # ★ 站点配置（必传，部署前改好）
├── manifest.webmanifest           # ★ PWA 清单（必传）
├── sw.js                          # ★ Service Worker（必传，离线缓存）
├── vercel.json                    # ★ 仅 Vercel 需要（路由规则）
├── netlify.toml                   # ★ 仅 Netlify 需要（路由规则）
│
├── api/                           # ★ 仅 Vercel 需要
│   └── proxy.js                   #     Vercel Serverless Function（API 代理转发）
│
├── functions/                     # ★ 仅 Cloudflare Pages 需要
│   └── api/
│       └── proxy.js               #     Cloudflare Pages Function
│
├── netlify/                       # ★ 仅 Netlify 需要
│   └── functions/
│       └── proxy.js               #     Netlify Function
│
├── css/
│   └── style.css                  # ★ 全部样式（必传）
│
├── js/
│   └── app.js                     # ★ 前端逻辑（必传）
│
├── assets/                        # ★ 静态资源（必传）
│   ├── faviconpyq.ico             #     浏览器标签页图标
│   ├── pwa-192.png                #     PWA 图标 192×192
│   ├── pwa-384.png                #     PWA 图标 384×384
│   └── pva-512.png                #     PWA 图标 512×512（原文件名如此，无需改名）
│
├── .gitignore                     # ○ 可上传也可不上传（不影响部署）
├── README.md                      # ○ 可不上传（项目说明）
├── DEPLOY.md                      # ○ 可不上传（本部署指南）
│
├── .env.local                     # ✗ 禁止上传（含本地 Token 明文）
└── dev-server.js                  # ✗ 禁止上传（仅本地开发使用）
```

**图例说明**：

| 标记 | 含义 |
|------|------|
| `★` | 必须上传到部署平台 |
| `○` | 可选，上传无害 |
| `✗` | 禁止上传 |

### 6.2 各平台上传清单

#### Vercel

| 上传 | 不上传 |
|------|--------|
| `index.html`、`config.js`、`manifest.webmanifest`、`sw.js`、`vercel.json` | `functions/`（整个目录） |
| `css/style.css`、`js/app.js` | `netlify/`（整个目录） |
| `assets/`（全部文件） | `.env.local`、`dev-server.js` |
| `api/proxy.js` | `README.md`、`DEPLOY.md`（可选） |

**上传到 Git 的最小文件集合**（其他文件可以删掉或忽略）：
```
/
├── index.html
├── config.js
├── manifest.webmanifest
├── sw.js
├── vercel.json
├── css/style.css
├── js/app.js
├── assets/
│   ├── faviconpyq.ico
│   ├── pwa-192.png
│   ├── pwa-384.png
│   └── pva-512.png
└── api/proxy.js
```

#### Cloudflare Pages

| 上传 | 不上传 |
|------|--------|
| `index.html`、`config.js`、`manifest.webmanifest`、`sw.js` | `api/`（整个目录） |
| `css/style.css`、`js/app.js` | `netlify/`（整个目录） |
| `assets/`（全部文件） | `vercel.json`、`netlify.toml` |
| `functions/api/proxy.js` | `.env.local`、`dev-server.js` |

**上传到 Git 的最小文件集合**：
```
/
├── index.html
├── config.js
├── manifest.webmanifest
├── sw.js
├── css/style.css
├── js/app.js
├── assets/
│   ├── faviconpyq.ico
│   ├── pwa-192.png
│   ├── pwa-384.png
│   └── pva-512.png
└── functions/api/proxy.js
```

#### Netlify

| 上传 | 不上传 |
|------|--------|
| `index.html`、`config.js`、`manifest.webmanifest`、`sw.js`、`netlify.toml` | `api/`（整个目录） |
| `css/style.css`、`js/app.js` | `functions/`（整个目录） |
| `assets/`（全部文件） | `vercel.json` |
| `netlify/functions/proxy.js` | `.env.local`、`dev-server.js` |

**上传到 Git 的最小文件集合**：
```
/
├── index.html
├── config.js
├── manifest.webmanifest
├── sw.js
├── netlify.toml
├── css/style.css
├── js/app.js
├── assets/
│   ├── faviconpyq.ico
│   ├── pwa-192.png
│   ├── pwa-384.png
│   └── pva-512.png
└── netlify/functions/proxy.js
```

### 6.3 ⚠️ 部署前必读

1. **`config.js` 必须在上传前改好**（`PLATFORM` 要匹配你的部署平台，`BROWSER_TITLE` / `MEMOS_URL` / `ADMIN_NAME` 改对）
2. **`.env.local` 禁止上传到 Git** — `.gitignore` 已将其排除，`git add .` 时不会包含它
3. **不要把你不需要的代理目录也上传** —— 例如用 Vercel 就删掉 `functions/` 和 `netlify/`，不然 Git 仓库里不必要的文件占位置
4. **三个 Token 环境的配置**：
   - 真正的 Memos PAT → 放进部署平台（Vercel/Cloudflare/Netlify）的环境变量 `MEMOS_API_KEY`
   - 前端登录口令 → 放进部署平台环境变量 `FRONTEND_PUBLISH_TOKEN`
   - `~/.env.local`（本地开发用）含 PAT 但**不上传到部署平台**

---

## 7. 各平台部署

### 7.1 Vercel（推荐）— GitHub → Vercel 完整图文教程

**准备工作**：
- 一个 GitHub 账号（如果没有，去 https://github.com 注册）
- 一个 Vercel 账号（用 GitHub 账号登录 https://vercel.com）
- 你的 Memos 服务器已运行

---

#### 第一步：在 GitHub 上创建仓库

1. 打开 https://github.com → 点右上角 `+` → `New repository`
2. 仓库名填 `moments`（或其他名字），选 **Public**（免费）
3. 不要勾选任何初始化选项（Add a README、.gitignore 等），直接点 **Create repository**
4. 创建后你会看到一个空仓库页面，里面有一段命令

---

#### 第二步：初始化本地 Git 并推送

在本地 `e:\朋友圈-可前台发布` 目录下（或你放项目的目录），**右键 → 打开终端（PowerShell）**，执行：

```powershell
# 1. 初始化 Git
git init

# 2. 添加所有文件（.gitignore 已排除 .env.local）
git add .

# 3. 第一次提交
git commit -m "init: Moments 朋友圈"

# 4. 关联你的 GitHub 仓库（把 YOUR_USER 换成你的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USER/moments.git

# 5. 推送到 GitHub
git branch -M main
git push -u origin main
```

如果你没有装 Git，先去 https://git-scm.com/downloads 下载安装，安装时一路 **Next** 即可。

完成后刷新 GitHub 仓库页面，文件应该都已经上传。

⚠️ **推送前确认 `.gitignore` 存在且包含 `.env.local`**，避免将真实 PAT 推送到 GitHub。

---

#### 第三步：在 Vercel 导入项目

1. 打开 https://vercel.com 并用 GitHub 登录
2. 点 **Add New... → Project**
3. 在 "Import Git Repository" 列表中找到你刚创建的 `moments` 仓库，点 **Import**
4. **Framework Preset** 选择 **Other**（重要！不要选任何框架）
5. **Root Directory** 保持默认 `./`
6. 在 **Environment Variables** 部分添加三个变量（点 "Add" 三次）：

   | 变量名 | 值 | 说明 |
   |--------|-----|------|
   | `MEMOS_URL` | `https://memos.ahxin.cn` | Memos 实例地址 |
   | `MEMOS_API_KEY` | 你的 Memos PAT（如 `memos_pat_xxxx`） | 代理的后端认证凭据 |
   | `FRONTEND_PUBLISH_TOKEN` | 自己设的口令（如 `abc123`） | 前端登录口令 |

   ⚠️ **特别注意**：
   - `MEMOS_API_KEY` 设为你的真实 PAT，它会被 Vercel 加密存储，**没人能看到**
   - `FRONTEND_PUBLISH_TOKEN` 设一个简单的口令就行（如 `abc123`），**不要和 MEMOS_API_KEY 相同**
   - 两个值都填好后，Vercel 会在构建时注入成环境变量，前端代码读不到 `MEMOS_API_KEY`

7. 其他设置保持默认，点 **Deploy**

---

#### 第四步：等待部署完成

- Vercel 会自动运行几十秒，显示 `Congratulations` 绿屏即成功
- 页面会给你一个 `vercel.app` 域名（如 `moments-xxx.vercel.app`），**先别急着用**
- 因为这个域名访问时，Memos 反代收到的 `Origin` 可能是虚拟域名，跨域可能不通过
- **先绑定自己的域名**（见下一步）

---

#### 第五步：绑定自定义域名 `pyq.ahxin.cn`

1. 在 Vercel 项目页面 → **Settings → Domains**
2. 输入 `pyq.ahxin.cn` → **Add**
3. Vercel 会提示你添加 DNS 记录，按照提示操作：

   **一般在你的域名管理后台（阿里云/腾讯云/Cloudflare）操作**：
   - **记录类型**：CNAME
   - **主机记录**：`pyq`
   - **记录值**：`cname.vercel-dns.com`
   - **TTL**：默认（600 或 自动）

4. 回到 Vercel，等几分钟状态从 `Pending` 变成 `Valid`（绿色勾）
5. 访问 `https://pyq.ahxin.cn`，应该能正常看到页面

---

#### 第六步：配置 1Panel CORS（见下方第 10.5 节）

部署完成后，在 1Panel 的 Memos 反代配置中加入 CORS 头，否则图片加载会跨域报错。

---

### 7.2 Cloudflare Pages

**文件结构**：`functions/api/proxy.js` 是 Cloudflare 识别的 Serverless Function。上传清单见[第 6.2 节](#62-各平台上传清单)。

**部署步骤**：

1. `config.js` → `PLATFORM: 'cloudflare'`
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. Framework preset → **None**
4. Environment variables（见第 8 章）
5. Deploy → 自动绑定分配的域名

### 7.3 Netlify

**文件结构**：`netlify/functions/proxy.js` 是 Netlify 识别的函数。上传清单见[第 6.2 节](#62-各平台上传清单)。

**部署步骤**：

1. `config.js` → `PLATFORM: 'netlify'`
2. Netlify → Add new site → Import existing project → Git
3. Build settings → leave empty（无构建步骤）
4. Environment variables（见第 8 章）
5. Deploy

---

## 8. 部署环境变量

部署平台配置环境变量时，参考以下表格：

### 8.1 所有平台通用

| 变量 | 必填 | 说明 | 示例值 |
|------|------|------|--------|
| `MEMOS_URL` | **是** | Memos 实例完整 URL（无末尾斜杠） | `https://memos.ahxin.cn` |
| `MEMOS_API_KEY` | **是** | Memos Personal Access Token（生产环境必设） | `memos_pat_xxxxx` |
| `FRONTEND_PUBLISH_TOKEN` | **是** | 前端登录口令（自己设的，与 MEMOS_API_KEY 不同） | `abc123` |

### 8.2 各平台操作路径

#### Vercel

Settings → Environment Variables → 添加三个变量：

| 变量 | 值 |
|------|------|
| `MEMOS_URL` | `https://memos.ahxin.cn` |
| `MEMOS_API_KEY` | 你的 Memos PAT |
| `FRONTEND_PUBLISH_TOKEN` | 自己设的发布口令 |

⚠️ **重要安全提示**：
- `MEMOS_API_KEY` 是你 Memos 账户的完整权限 Token，**仅设置到 Vercel 环境变量中**
- 前端代码永远接触不到这个值 — 只有 Vercel 的 serverless function 能读到
- `FRONTEND_PUBLISH_TOKEN` 可以设任意字符串（如 `abc123` 甚至 `123456`）
- 两个 Token **不要相同**，这样即使 `FRONTEND_PUBLISH_TOKEN` 泄露，攻击者也无法直接操作 API

#### Cloudflare Pages

Pages → 项目 → Settings → Environment variables → Add variable：

| 变量名 | 值 | 勾选"加密" |
|--------|-----|-----------|
| `MEMOS_URL` | `https://memos.ahxin.cn` | ❌ |
| `MEMOS_API_KEY` | 你的 Memos PAT | ✅ |
| `FRONTEND_PUBLISH_TOKEN` | 自己设的口令 | ✅ |

#### Netlify

Site settings → Environment variables → Add a variable：

| Key | Value | Scope |
|-----|-------|-------|
| `MEMOS_URL` | `https://memos.ahxin.cn` | All |
| `MEMOS_API_KEY` | 你的 Memos PAT | All |
| `FRONTEND_PUBLISH_TOKEN` | 自己设的口令 | All |

---

## 9. 不部署的文件

以下文件**禁止上传**到部署平台：

| 文件 | 原因 |
|------|------|
| `.env.local` | 含本地配置，可能含 Token 明文 |
| `dev-server.js` | 本地开发服务，部署平台不需要 |
| `README.md` | 项目说明，部署平台不会使用 |
| `DEPLOY.md` | 本部署说明，部署平台不会使用 |

以下部署相关文件**不需要上传**，上传也无害：

| 文件 | 说明 |
|------|------|
| `.gitignore` | Git 忽略规则，不影响部署 |
| `node_modules/` | 本项目无需 node_modules |

另外，如果确定使用某平台，可以删除其他两个平台的代理目录以精简文件：

| 确定平台 | 可删除的目录 |
|---------|------------|
| Vercel | `functions/`、`netlify/` |
| Cloudflare | `api/`、`netlify/` |
| Netlify | `api/`、`functions/` |

---

## 10. CORS 跨域配置

### 10.1 什么情况需要 CORS？

| 配置 | 是否需要 CORS |
|------|-------------|
| `USE_PROXY: true` + `PROXY_FILES: true` | **不需要** — 全部走代理，浏览器只请求自己的域名 |
| `USE_PROXY: true` + `PROXY_FILES: false`（推荐） | **附件需要** — 图片/音频/文件直连 `memos.ahxin.cn/file/` |
| `USE_PROXY: false`（直连模式） | **全部需要** — API 请求直连 `memos.ahxin.cn/api/` |

### 10.2 Nginx 配置（如果你的 Memos 通过 Nginx 反代）

```nginx
server {
    listen 443 ssl;
    server_name memos.ahxin.cn;

    # （SSL 证书配置保持不变）

    # ── API 跨域（直连模式、授权请求时使用） ──
    location /api/ {
        if ($http_origin ~ "^https?://(pyq\.ahxin\.cn|localhost:\d+)$") {
            add_header Access-Control-Allow-Origin $http_origin always;
            add_header Access-Control-Allow-Credentials true always;
            add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Publish-Token" always;
            add_header Access-Control-Allow-Methods "GET, POST, PATCH, DELETE, OPTIONS" always;
        }
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $http_origin;
            add_header Access-Control-Allow-Methods "GET, POST, PATCH, DELETE, OPTIONS";
            add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Publish-Token";
            add_header Content-Length 0;
            return 204;
        }
        proxy_pass http://127.0.0.1:5230;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ── 文件跨域（附件直连时需要） ──
    location /file/ {
        if ($http_origin ~ "^https?://(pyq\.ahxin\.cn|localhost:\d+)$") {
            add_header Access-Control-Allow-Origin $http_origin always;
            add_header Access-Control-Allow-Headers "Authorization, Content-Type, Range" always;
            add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
            add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges, Content-Disposition" always;
        }
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $http_origin;
            add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS";
            add_header Access-Control-Allow-Headers "Range, Authorization";
            return 204;
        }
        proxy_pass http://127.0.0.1:5230;
    }

    # ── 其余请求 ──
    location / {
        proxy_pass http://127.0.0.1:5230;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```}

### 10.4 1Panel 操作教程（你用的面板）

**因为 1Panel 底层的反代引擎也是 Nginx**，所以配置方式和上面的 Nginx 配置本质一样，只是入口在面板里。

#### 步骤一：找到 Memos 的配置文件

1. 登录 1Panel 后台
2. 左侧菜单 → **网站**（或 Websites）
3. 找到你的 `memos.ahxin.cn` 网站条目 → 点击 **配置**（或 Settings） → **配置文件**（或 Config file）

#### 步骤二：定位要修改的位置

配置文件打开后，找到 `server` 块内部、`location` 块之前或之后的位置。典型的 1Panel 配置文件长这样：

```nginx
server {
    listen 443 ssl;
    server_name memos.ahxin.cn;
    # ... SSL 证书 ...
    
    # 1Panel 自动生成的反代配置
    location / {
        proxy_pass http://127.0.0.1:5230;
        proxy_set_header Host $host;
        # ...
    }
}
```

#### 步骤三：替换整个配置

把 `server { }` 块里的内容全部替换为以下配置（SSL 证书部分保留不动）：

```nginx
server {
    listen 443 ssl;
    server_name memos.ahxin.cn;

    # ★ SSL 配置——保留你 1Panel 自动生成的这两行 ★
    # ssl_certificate ...
    # ssl_certificate_key ...

    # ── 文件跨域（附件直连时需要：图片/音频/文件显示） ──
    location /file/ {
        add_header Access-Control-Allow-Origin 'https://pyq.ahxin.cn' always;
        add_header Access-Control-Allow-Methods 'GET, HEAD, OPTIONS' always;
        add_header Access-Control-Allow-Headers 'Range, Authorization' always;
        add_header Access-Control-Expose-Headers 'Content-Length, Content-Range, Content-Disposition' always;

        if ($request_method = OPTIONS) {
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }

        proxy_pass http://127.0.0.1:5230;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ── API 跨域（如果你以后用直连模式或真实 PAT 登录时需要） ──
    location /api/ {
        add_header Access-Control-Allow-Origin 'https://pyq.ahxin.cn' always;
        add_header Access-Control-Allow-Methods 'GET, POST, PATCH, DELETE, OPTIONS' always;
        add_header Access-Control-Allow-Headers 'Authorization, Content-Type, X-Publish-Token' always;

        if ($request_method = OPTIONS) {
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }

        proxy_pass http://127.0.0.1:5230;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ── 其余所有请求 ──
    location / {
        proxy_pass http://127.0.0.1:5230;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**如果你只有 `location /` 一个块**，也可以直接在已有的 `location /` 块**上方**插入 `location /file/` 和 `location /api/` 两个新块，原 `location /` 保持不变。

#### 步骤四：保存并重载

1. 点 **保存**（或 Ctrl+S）
2. 1Panel 会自动检测语法并重载 Nginx
3. 如果报语法错误，检查有没有多余的括号或缺少分号

#### 步骤五：验证（见下方第 9.6 节）

#### 1Panel 操作示例图（文字描述）

```
1Panel 后台
  ├─ ⚙ 网站
  │   └─ memos.ahxin.cn
  │       ├─ 配置
  │       │   └─ 配置文件      ← 点这里
  │       │       └─ 编辑配置    ← 粘贴上面代码
  │       ├─ 重载配置          ← 点一下
  │       └─ 访问验证          ← 打开 https://pyq.ahxin.cn
  └─ ✓ 完成
```

### 10.5 Caddy 配置（供参考，你用 1Panel 不需要配这个）

如果你用 Caddy 而不是 1Panel 反代 Memos，配置如下：

```caddy
memos.ahxin.cn {
    @cors_preflight method OPTIONS
    handle @cors_preflight {
        header Access-Control-Allow-Origin "https://pyq.ahxin.cn"
        header Access-Control-Allow-Methods "GET, POST, PATCH, DELETE, OPTIONS"
        header Access-Control-Allow-Headers "Authorization, Content-Type, X-Publish-Token"
        respond "" 204
    }
    header /api/* Access-Control-Allow-Origin "https://pyq.ahxin.cn"
    header /api/* Access-Control-Allow-Headers "Authorization, Content-Type, X-Publish-Token"
    header /api/* Access-Control-Allow-Methods "GET, POST, PATCH, DELETE, OPTIONS"
    header /file/* Access-Control-Allow-Origin "https://pyq.ahxin.cn"
    header /file/* Access-Control-Expose-Headers "Content-Length, Content-Range, Content-Disposition"
    reverse_proxy 127.0.0.1:5230
}
```

### 10.6 验证 CORS

在 `pyq.ahxin.cn` 的浏览器控制台中执行：

```js
// 测试 API 跨域
fetch('https://memos.ahxin.cn/api/v1/memos?page_size=1')
  .then(r => r.json())
  .then(d => console.log('API CORS OK, memos:', d.memos?.length))
  .catch(e => console.error('API CORS 失败:', e));

// 测试附件跨域
fetch('https://memos.ahxin.cn/file/', { method: 'HEAD' })
  .then(r => console.log('FILE CORS OK:', r.status))
  .catch(e => console.error('FILE CORS 失败:', e));
```

两条都返回成功即配置正确。

---

## 11. 常见问题

### Google Fonts 加载失败（ERR_CONNECTION_RESET）

项目已移除 Google Fonts 外链，使用系统字体栈：

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
             'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
```

macOS / iOS → San Francisco + PingFang，
Windows → Segoe UI + Microsoft YaHei，
Android → Roboto + Noto Sans SC。
零网络请求，永不报错。

### 401 Unauthorized - user not authenticated

Memos API 返回 401，表示请求未携带有效认证。

**排查步骤**：
1. 检查部署平台环境变量中的 `MEMOS_API_KEY` 是否已正确填写
2. 检查 `FRONTEND_PUBLISH_TOKEN` 是否与用户在前端登录时输入的一致
3. 如果是本地开发，检查 `MEMOS_API_KEY` 或 `FRONTEND_PUBLISH_TOKEN`（当用作 fallback 时）是否设为了真实 PAT
4. 重新启动 dev-server 或重新部署

### 发布/编辑/删除失败

1. 确认已在前端登录弹窗中输入正确的 Token
2. 检查浏览器 Network 面板中具体请求的状态码
3. 如为 401 → 检查上一条
4. 如为 403 → 你的 Memos PAT 可能没有写权限

### PWA 桌面图标有白色边框

项目已做以下处理：
- 所有图标使用不透明背景（青绿圆形底 + favicon 图案）
- `purpose` 不设 `maskable`，避免 Android 白色安全区遮罩
- `background_color` 与图标背景色一致
- 如果之前已添加到桌面，请先移除再重新添加

### 链接预览在控制台报 400 Bad Request

某些链接（如下载链接、CSS/JS URL、API 端点）不是 HTML 页面，Memos linkMetadata API 无法解析。前端已过滤掉非 HTML 链接和 CDN 域名，不会请求这些 URL。如果仍有 400，该链接可能是 Memos API 本身的限制。
