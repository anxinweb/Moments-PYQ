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
- 评论过多折叠（与微信一致）：首页只显示**最早的 5 条**（正序）+「查看全部 N 条评论」，点开全量可收起；详情页全量无按钮；待审条目始终可见

## 阶段进度
- P0/P1 完成：首页还原+分页+缩略图+灯箱+详情页+分享+PWA（v20261108s）
- P2 完成（2026-11-08，提交 40bdc02，v20261109a）：点赞+两级评论+超链接+审核中本地可见+取消+详情入口收窄，puppeteer 全流程测试通过
- 待用户操作：Vercel 环境变量 MEMOS_TOKEN 换主号令牌并 redeploy（通知链路排查时为触发邮件又换回 guest 令牌，详见 11-08 日志）
- 2026-11-08 已按用户明确要求清空 guest 的全部 21 条评论（含此前标注「勿删」的实测评论）；该 Memos 实例 DELETE 为硬删除，站内不可恢复
- 清理工具：`.preview/guest-comments.mjs`（默认只读列清单，`--apply` 才删并复查）；`DELETE /api/memos/{uid}` 一次即彻底删除，`?purge=true` 会 404
- 测试脚本：.preview/test-p2.mjs、test-p2b.mjs（puppeteer-core + 系统 Edge）；旧测试 check7/check9 已过时

## 微信小程序分支（2026-11-08 新建）
- 独立目录 `miniprogram/`，原生微信小程序，**纯展示**：无评论/点赞/详情/外链/分享/登录，与根目录网页版互不影响（用户明确要求不破坏已有文件）
- 数据：只读 `https://pyq.ahxin.cn/api/feed|profile` + `https://memos.ahxin.cn/file/...`；无写接口、无令牌
- 视觉与网页版同源：沉浸式自定义导航、封面、6 行折叠、九宫格、点图 wx.previewImage（含被 +N 折叠的图）
- 发布前必做：公众平台 request 白名单 `pyq.ahxin.cn`、downloadFile 白名单 `memos.ahxin.cn`；appid 换真实值、urlCheck 改 true
- 预览卡 appId：wbapp_qIhaUS8EW6TakWNQrLVtcp（未发布，面板右上角「分享」继续）
- 踩坑：mini-program scaffold 模板被写成 CRLF 导致哈希校验失败，需把模板基础文件规范化为 LF
- v2（2026-11-08 中午）：封面换用户竖图；新增资料页（两个可复制链接）与详情页（可复制 `?memo=` 链接 + 转发给好友）；封面头像→资料页、信息流头像/昵称→详情页
- **权限结论**：转发 `onShareAppMessage` / 复制 `wx.setClipboardData` 零申请；`web-view` 外链与 `onShareTimeline` 需资质，已避开；不能由代码指定好友，只能用户点转发按钮自己选
- 详情页用 `/api/memo?uid=` 冷启动可打开；分享 path=`/pages/detail/detail?uid=xxx`；`detail.wxss` 用 `@import` 复用首页样式
- 静态校验 + 真实接口链路全过；预览卡沿用 wbapp_qIhaUS8EW6TakWNQrLVtcp
- 真实 AppID `wx83865dd6608c01c3` 已写入 project.config.json；用户自己用微信开发者工具发布，不走 WorkBuddy 发布链路
- **导入目录必须是 `miniprogram/` 子目录**（不是项目根）；`urlCheck:false` 便于调试，上传前需配白名单并改回 true
- 发布前总检全 PASS（静态 + mock 三页面全链路 + 远程资源 206）；`getSystemInfoSync` 已改为优先 `getWindowInfo` 兼容
- 上传前平台侧必做：request 白名单 pyq.ahxin.cn、downloadFile 白名单 memos.ahxin.cn（真机只认白名单）
- 开发者工具实际装在 `D:\Application\微信web开发者工具`；日志在 `%LOCALAPPDATA%\微信开发者工具\User Data\<hash>\WeappLog\logs`
- 踩坑：`simulator launch failed` 多为**基础库首次下载 41MB 超时**（日志 `routeTo appLaunch timeout`），非代码问题；点「编译」/ 重启工具 / 切到已缓存的 3.17.5 即可
- 同一次首次加载还可能连带报渲染层 `__g is not defined`，重启后自愈；`project.private.config.json` 的 `libVersion` 已锁定非灰度稳定版 3.17.5（改完需完全重启工具；或在「详情→本地设置→调试基础库」界面切换）
- 日志里 `工具未校验合法域名…` 后的一长串 `api.js:9/getProfile/loadFirst` 堆栈是 warn 调用栈，不是异常
- 1.0.2：首页右下角回顶按钮（滚动 >600px 淡入，`wx.pageScrollTo` 平滑回顶）；README 有版本记录与两段发布简介文案
- 回顶图标重做为本地 PNG（顶部横线+带竖杆向上箭头，#7f7f7f，38px 半透明白圆+极淡阴影），不再用 CSS chevron；预览图 `.preview/backtop-preview.png`
- 搜索需求待定：建议先不加；若做优先前端本地过滤（A 轻量版），后端方案需新增 `api/search.js` + redeploy Vercel
- 详情页分享已收纳进时间行「两点」菜单（复制链接｜分享给好友，深色浮层+小三角，与网页版同款）；旧绿色大按钮、URL 文本框与说明文字全部删除
- 发布前总审全 PASS（静态 / 三页面真实链路 / 数据绑定 0 未定义 / 8 个远程资源 200-206）；README 与 .gitignore 一致性已修正；平台侧待办仍是白名单 / 备案 / 类目 / 上传
