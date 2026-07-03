# Moments · 朋友圈

> 基于 Memos 的静态朋友圈，支持发布、浏览、交互。

## 功能

- 浏览/发布 Memos（支持图片、音频、文件附件）
- 标签筛选、搜索、日期筛选
- 可见性筛选（全部 / 公开 / 登录可见 / 私密）
- 反应（Emoji 点赞）
- 批量操作（编辑可见性、删除）
- 统计面板（日历、标签云、概览）
- 链接预览 / 图片灯箱 / 音乐播放
- 深色模式自适应
- PWA 支持（可添加到桌面）
- 单条链接独占视图（`#memo-xxx`）

## 快速开始

```bash
# 1. 安装 Node.js（>=18）
# 2. 配置环境变量
cp .env.local.example .env.local   # 编辑配置文件

# 3. 启动本地服务
node dev-server.js

# 4. 浏览器访问
open http://localhost:3000
```

## 部署

部署文档见 [DEPLOY.md](./DEPLOY.md)。

支持的平台：
- **Vercel**（推荐）
- **Cloudflare Pages**
- **Netlify**
- 任意静态托管 + Node 后端

## 技术栈

- 纯前端 HTML + CSS + JavaScript（零依赖）
- Memos REST API v1
- Node.js 开发服务器（本地代理）

## 项目结构

```
/
├── index.html               ← 入口页面
├── config.js                ← 站点配置
├── .env.local               ← 本地环境变量（不上传部署）
├── manifest.webmanifest     ← PWA 清单
├── sw.js                    ← Service Worker
│
├── api/proxy.js             ← Vercel Serverless 代理
├── functions/api/proxy.js   ← Cloudflare Pages 代理
├── netlify/functions/proxy.js ← Netlify 代理
├── dev-server.js            ← 本地开发服务器
│
├── css/style.css            ← 全部样式
├── js/app.js                ← 前端逻辑
├── assets/                  ← 图片、图标等静态资源
│
├── DEPLOY.md                ← 部署文档
└── README.md                ← 本文件
```

## 维护

- 使用 200 条/页 + 最多 10 页分页，避免一次性加载过多内容
- 移除 Google Fonts 外链，使用系统字体栈，无网络依赖
- 所有用户输入通过 `escapeHtml()` 转义，防止 XSS

## 许可

MIT
