// 屏東縣屏東市復興國小 3D 數位校園 (Service Worker)
// Version: fuxing-3d-campus-v2.5.1

const CACHE_NAME = 'fuxing-3d-campus-v2.5.1';

// 核心極速快取清單 (App Shell + 3D 引擎 + 1:1 2.5D 高清預覽底圖 + 核心平面圖 + 離線 QR Code)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './campus-ui.js',
  './campus-3d.js',
  './vendor/qrcode.min.js',
  './vendor/three/three.module.js',
  './vendor/three/addons/controls/OrbitControls.js',
  './assets/campus_overview_preview.webp',
  './assets/campus_overview_preview.jpg',
  './assets/plans/all.jpg',
  './assets/plans/1f.jpg',
  './assets/plans/2f.jpg',
  './assets/plans/3f.jpg',
  './assets/plans/bf.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 僅處理同源 GET 請求
  if (req.method !== 'GET' || url.origin !== location.origin) {
    return;
  }

  // 1. 核心程式碼 (index.html, campus-ui.js, campus-3d.js 及帶版本號請求) 採 Network-First 策略：
  // 優先向網路獲取最新程式碼與 3D 模型；若網路失敗或離線時，則自快取還原
  if (
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('campus-3d.js') ||
    url.pathname.endsWith('campus-ui.js') ||
    url.pathname.endsWith('sw.js') ||
    url.search.includes('v=')
  ) {
    event.respondWith(
      fetch(req).then(networkRes => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, resClone);
          });
        }
        return networkRes;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 2. 第三方靜態函式庫與大型圖像 (vendor, assets, plans, webp) 採 Cache-First 策略
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(networkRes => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, resClone);
          });
        }
        return networkRes;
      });
    })
  );
});
