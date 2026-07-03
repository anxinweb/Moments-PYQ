const CACHE_NAME = 'ahxin-moments-v8';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './config.js',
  './js/app.js',
  './manifest.webmanifest',
  './assets/faviconpyq.ico',
  './assets/pwa-180.png',
  './assets/pwa-192.png',
  './assets/pwa-512.png',
  './assets/pwa-192-maskable.png',
  './assets/pwa-512-maskable.png'
];

self.addEventListener('install', event => {
  // 逐个缓存，失败的跳过（不因单个资源 404 导致整个 SW 安装失败）
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
      .then(() => self.skipWaiting())
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

  // 静态资源：Network First
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy).catch(() => {}));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
