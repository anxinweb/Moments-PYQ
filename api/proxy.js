/**
 * Vercel Serverless Function - Memos API 代理
 * 解决 CORS 问题，同时隐藏 Memos 实例地址
 *
 * 用法:
 * /api/proxy?path=/memos          →  代理到 https://memos.ahxin.cn/api/v1/memos
 * /api/proxy?path=/memos/123      →  代理到 https://memos.ahxin.cn/api/v1/memos/123
 * /api/proxy?path=/users/xxx      →  代理到 https://memos.ahxin.cn/api/v1/users/xxx
 * /api/proxy?path=/memos/-/linkMetadata&url=xxx  →  代理链接元数据
 *
 * 环境变量:
 * MEMOS_URL      - Memos 实例地址，如 https://memos.ahxin.cn
 * MEMOS_API_KEY  - 可选，PAT 认证令牌
 */

const MEMOS_URL = process.env.MEMOS_URL || 'https://memos.ahxin.cn';
const MEMOS_API_KEY = process.env.MEMOS_API_KEY || '';
const FRONTEND_PUBLISH_TOKEN = process.env.FRONTEND_PUBLISH_TOKEN || process.env.PUBLISH_TOKEN || '';
const API_PREFIX = '/api/v1';

function isPublishTokenValid(req) {
  const token = req.headers['x-publish-token'];
  return !!FRONTEND_PUBLISH_TOKEN && token === FRONTEND_PUBLISH_TOKEN;
}

module.exports = async (req, res) => {
  // 设置 CORS 头，允许前端访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Publish-Token');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { path: apiPath, ...queryParams } = req.query;

  if (!apiPath) {
    res.status(400).json({ error: 'Missing path parameter' });
    return;
  }

  // 构建目标 URL（文件路径 /file/... 不走 /api/v1 前缀）
  const decodedPath = decodeURIComponent(apiPath);

  // 前端发布登录：只验证部署平台配置的发布 Token，不暴露 Memos API Key
  if (decodedPath === '/auth/login') {
    const inputToken = req.body?.token;
    if (!FRONTEND_PUBLISH_TOKEN) {
      res.status(500).json({ error: 'FRONTEND_PUBLISH_TOKEN is not configured' });
      return;
    }
    if (inputToken === FRONTEND_PUBLISH_TOKEN) {
      res.status(200).json({ ok: true });
      return;
    }
    res.status(401).json({ error: 'Invalid publish token' });
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    // 仅当配置了 FRONTEND_PUBLISH_TOKEN 时才验证前端口令
    // 未配置时放行，由 Memos 后端自行验证 token
    if (FRONTEND_PUBLISH_TOKEN && !isPublishTokenValid(req)) {
      res.status(401).json({ error: 'Invalid or missing publish token' });
      return;
    }
  }

  const prefix = decodedPath.startsWith('/file/') ? '' : API_PREFIX;
  const targetUrl = new URL(`${MEMOS_URL}${prefix}${decodedPath}`);
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined) targetUrl.searchParams.set(k, v);
  });

  try {
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Accept': req.headers['accept'] || 'application/json',
    };
    if (req.headers.range) headers.Range = req.headers.range;
    // 优先使用后端环境变量 MEMOS_API_KEY；如果未配置，则使用前端传来的 X-Publish-Token
    // 这样即使本地测试时只传 FRONTEND_PUBLISH_TOKEN 也能正常工作
    if (MEMOS_API_KEY) {
      headers['Authorization'] = `Bearer ${MEMOS_API_KEY}`;
    } else if (req.headers['x-publish-token']) {
      headers['Authorization'] = `Bearer ${req.headers['x-publish-token']}`;
    }

    const fetchOptions = {
      method: req.method,
      headers,
    };

    // 转发 body（非 GET 请求）
    if (req.method !== 'GET' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    ['content-length', 'content-range', 'accept-ranges', 'cache-control', 'content-disposition'].forEach(key => {
      const value = response.headers.get(key);
      if (value) res.setHeader(key, value);
    });

    const isTextLike = contentType && (contentType.includes('application/json') || contentType.includes('text/') || contentType.includes('html'));
    if (!isTextLike) {
      res.status(response.status);
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
      return;
    }

    const data = await response.text();
    res.status(response.status).send(data);

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy request failed', message: err.message });
  }
};
