# 朋友圈网页 · 项目记忆

## 项目概况
- 目标：把 pyq.ahxin.cn 重做成与微信朋友圈视觉 1:1 的页面，数据来自 Memos 公开接口
- 技术栈：原生 HTML/CSS/JS（零构建）+ Vercel Edge Functions
- 本地目录：D:\Downloads\朋友圈网页；本地预览：node dev-server.mjs → 127.0.0.1:5173

## 关键事实（踩坑记录）
- Memos 已升级，`/api/v1` 移除，新接口 `GET /api/memos?pageSize=&pageToken=`（nextPageToken 分页）
- **Memos 原生缩略图可用**：`/file/attachments/<id>/<file>?thumbnail=true`（61-95KB/0.3s），原图 2MB+；列表用缩略图、灯箱用原图
- 附件地址 `/file/attachments/<id>/<filename>`，头像 `/file/users/ahxin/avatar`，资料 `GET /api/users/ahxin`
- CORS 仅放行 pyq.ahxin.cn → 前端走同源 Edge 代理 /api/feed（30s 缓存）；wsrv.nl 不通已弃用第三方压缩
- feed 需按 creator==users/ahxin 过滤（为评论专用账号做准备，避免 bot 的评论混进动态流）
- 仓库 anxinweb/Moments-PYQ：GitHub MCP 一直 unauthorized（重连后仍失败），需用户重新授权或转公开

## 已确认的方案决策（用户拍板）
- 原生 HTML/CSS/JS；评论存 Memos 专用账号（新建 bot 账号），**可见性=审核开关**（私有=待审，公开=通过）
- 点赞：Upstash Redis 真实计数（访客 localStorage UUID 去重）
- 评论身份：昵称+内容（昵称存 localStorage）
- 不做无限滚动：每页 20 条 + 「加载更多」按钮，当前页写地址栏 ?page=N（累计页语义）
- 封面：固定 assets/cover.jpg（AI 生成占位图，已裁水印），config 支持 fixed/memo/none + 双端裁切重心
- 自适应：单列流式，手机全宽、≥768px 内容列 720px 居中，字号/头像/九宫格等比放大（对标微信 iPad 版）
- 主题只留浅/深色；#标签默认隐藏；正文 6 行折叠

## 阶段进度
- P0 完成（2026-11-07 晚）：首页还原 + 分页 + 原生缩略图 + 灯箱（滑动/双击缩放）+ 响应式，自动化测试全过（133 条 7 页、?page 直达、原图灯箱）
- P1 进行中：剩单条详情页、分享/复制链接
- P2 待做：评论+点赞后端（需用户提供 bot 账号 Token、装 Upstash）
- P3 待做：部署交接（GitHub 授权未解决）
