const CACHE_NAME = 'ahxin-moments-v9';
// 首次访问只预缓存最核心的 HTML,其余资源靠运行时缓存自动积累
// 避免 install 阶段并发 fetch 9 个文件,与首屏资源竞争带宽
const APP_SHELL = [
  './',
  './index.html'
];

self.addEventListener('install', event => {
  // 只缓存 HTML 外壳,其余资源(JS/CSS/图标)由 fetch 事件运行时缓存
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        APP_SHELL.map(url =>
          fetch(url, { cache: 'no-cache' })
            .then(resp => {
              if (resp && resp.status < 400) cache.put(url, resp);
            })
            .catch(() => { /* 忽略单个资源失败 */ })
        )
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // API 和外部请求不缓存
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/file/')) return;
  if (url.origin !== self.location.origin) return;

  // 导航请求（HTML 页面）：Network First，失败回退缓存首页
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静态资源:Cache First(命中即返回,毫秒级),后台静默更新
  // 比 Network First 更快,适合静态资源(JS/CSS/图标/字体)
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy).catch(() => {}));
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
