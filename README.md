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

### 环境变量（Vercel → Settings → Environment Variables）

| 变量 | 用途 |
|---|---|
| `MEMOS_TOKEN` | 评论以 guest 账号身份写入 Memos（评论者≠动态作者，站主才能收到通知） |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 点赞存储 |
| `SMTP_USER` / `SMTP_PASS` | 评论通知发件邮箱（QQ 邮箱填「授权码」，非登录密码） |
| `NOTIFY_TO` | 通知收件邮箱，默认同 `SMTP_USER` |
| `NOTIFY_KEY` | 内部接口密钥（随机字符串即可），`/api/notify`、`/api/backup-likes` 手动触发时校验 |
| `CRON_SECRET`（可选） | Vercel Cron 调用 `/api/backup-likes` 时的鉴权 |

- 评论邮件通知：`/api/notify`（Node 运行时，直连 smtp.qq.com:465），评论落地后异步发送，失败不影响评论
- 点赞备份：Vercel Cron 每天 04:00（北京时间）把 Redis 里的点赞快照成一条私有 memo 存进 Memos，搜 `#like-backup` 可查（每天一条，定期清理旧快照即可）
- 分享卡片：`middleware.js` 在边缘给 `/?memo=uid` 注入 OG 标签（标题/摘要/首图缩略）

### 点赞备份怎么恢复

1. 在 Memos 里搜 `#like-backup`，打开最近一条快照，复制 ```json 代码块里的内容
2. 本地存成 `backup.json`，在项目根目录执行（需要 `.env.local` 里有 Upstash 凭据）：

```bash
node -e '
const fs=require("fs");const env=fs.readFileSync(".env.local","utf8");
const U=(env.match(/UPSTASH_REDIS_REST_URL="(.*)"/)||[])[1];
const T=(env.match(/UPSTASH_REDIS_REST_TOKEN="(.*)"/)||[])[1];
const {likes}=JSON.parse(fs.readFileSync("backup.json","utf8"));
const cmds=[];
for(const [uid,obj] of Object.entries(likes)) for(const [visitor,val] of Object.entries(obj)) cmds.push(["HSET","like:"+uid,visitor,val]);
fetch(U.replace(/\/$/,"")+"/pipeline",{method:"POST",headers:{authorization:"Bearer "+T,"content-type":"application/json"},body:JSON.stringify(cmds)})
  .then(r=>r.json()).then(d=>console.log("已恢复",cmds.length,"条点赞")).catch(console.error);
'
```

## 常用配置（js/config.js）

| 想改什么 | 改哪里 |
|---|---|
| 换封面 | ① 替换 `assets/cover.jpg`（小程序同步替换 `miniprogram/images/cover.jpg`）② 把 `index.html` 里 preload 和 `COVER.URL` 的 `?v=` 改成新日期 ③ 提交推送，否则 CDN 会缓存旧图 |
| 封面用外链 | `COVER.URL` 直接填图片网址（同样建议带 `?v=`） |
| 封面裁切重心 | `COVER.MOBILE_POS` / `COVER.DESKTOP_POS` |
| 封面改成自动取最新配图 | `COVER.MODE: 'memo'` |
| 每页条数 | `PAGE_SIZE` |
| 隐藏/显示 #标签 | `HIDE_TAGS` |

## 路线图

- [x] P0 数据层重写 + 首页视觉还原
- [x] P0.5 分页改造、Memos 原生缩略图、固定封面、响应式
- [x] P1 单条详情页、分享/复制链接、资料页、PWA
- [x] P2 评论（两级回复/超链接/审核流）+ 真实点赞
- [x] P3 上线（Vercel + EdgeOne CDN）
- [x] P4 首屏快照秒开、OG 分享卡片、评论邮件通知、点赞每日备份、表情面板、深色打磨
