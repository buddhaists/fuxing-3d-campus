// 屏東縣屏東市復興國小 3D 數位校園 (Service Worker)
// Version: fuxing-3d-campus-v2.0

const CACHE_NAME = 'fuxing-3d-campus-v2';

// 核心極速快取清單 (App Shell + 3D 引擎 + 1:1 2.5D 高清預覽底圖 + 核心平面圖)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './campus-3d.js',
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

  // index.html 採 Stale-While-Revalidate 策略（確保隨時取得最新版本，同時 0ms 讀取本機快取）
  if (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req).then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            cache.put(req, networkRes.clone());
          }
          return networkRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 靜態資源（vendor, assets, tex）採 Cache-First 策略，大幅消除重複下載
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
