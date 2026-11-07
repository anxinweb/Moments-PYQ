# 朋友圈网页 · 项目记忆

## 项目概况
- 目标：把 pyq.ahxin.cn 重做成与微信朋友圈视觉 1:1 的页面，数据来自 Memos 公开接口
- 技术栈：原生 HTML/CSS/JS（零构建）+ Vercel Edge Functions
- 本地目录：D:\Downloads\朋友圈网页；本地预览：node dev-server.mjs → 127.0.0.1:5173

## 关键事实（踩坑记录）
- Memos 新接口 `GET /api/memos?pageSize=&pageToken=`；评论 `POST /api/memos/{uid}/comments`，**评论的评论原生支持**（POST 到评论 uid 上，层级存 relations）
- 评论类型 memo 不会出现在信息流列表接口（主号发评论也不污染 feed）；但**主号 PAT 列表看不到 guest 的 PRIVATE 评论**，guest 自己 PAT 可以
- Memos 网页 UI 改不了他人评论可见性（前端限制），API PATCH /api/memos/{uid} 可以
- **Memos 原生缩略图可用**：`?thumbnail=true`；列表用缩略图、灯箱用原图
- feed 需按 creator==users/ahxin 过滤；CORS 仅放行 pyq.ahxin.cn → 同源 Edge 代理
- 仓库 anxinweb/Moments-PYQ：GitHub MCP unauthorized，用本地 git push；远端 main 分支 2026-11-08 重建过

## 当前方案（用户拍板）
- 评论存 Memos（令牌在 Vercel MEMOS_TOKEN，**待用户换成主号令牌**），可见性=审核开关（PRIVATE=待审，PUBLIC=过审）
- 评论内容格式：`[昵称](主页链接) 回复@某某： 正文`（链接选填、兼容旧 `[昵称] 正文`）；回复最多 2 级，回复二级时挂回一级
- 点赞：Upstash Redis Hash like:<uid>，field=visitorUUID，value=昵称或 JSON {"n","u"}
- 前端访客资料存 localStorage（pyq-nick/pyq-link）；待审评论 pyq-pending，uid 或昵称+内容匹配过审即转正清除
- 评论框：昵称+主页+内容，取消收起保留草稿；点评论行=回复；详情入口仅昵称文字(fit-content)+头像

## 阶段进度
- P0/P1 完成：首页还原+分页+缩略图+灯箱+详情页+分享+PWA（v20261108s）
- P2 完成（2026-11-08，提交 40bdc02，v20261109a）：点赞+两级评论+超链接+审核中本地可见+取消+详情入口收窄，puppeteer 全流程测试通过
- **待用户操作：Vercel 环境变量 MEMOS_TOKEN 换主号令牌并 redeploy**；用户自己 3 条待审评论需在 Memos 过审
- 测试脚本：.preview/test-p2.mjs、test-p2b.mjs（puppeteer-core + 系统 Edge）；旧测试 check7/check9 已过时
