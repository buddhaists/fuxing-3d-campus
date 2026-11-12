// 屏東縣屏東市復興國小 3D 數位校園 (Service Worker)
// Version: fuxing-3d-campus-v2.8.0 (+pano runtime cache)

const CACHE_NAME = 'fuxing-3d-campus-v2.8.0';

// 360° 全景分塊圖（buddhaists.github.io/360fsps2026）執行期快取：看過的景點離線也能開，最多保留 PANO_CACHE_MAX 張
const PANO_CACHE = 'fuxing-pano-runtime-v1';
const PANO_CACHE_MAX = 600;   // 一個景點 L1+L2 約 30 張小圖，保留約 20 個景點
const PANO_HOSTS = ['buddhaists.github.io'];

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
          if (key !== CACHE_NAME && key !== PANO_CACHE) {
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

  // 360° 全景圖：Cache-First，僅快取 CORS 成功的 200 回應，超過上限淘汰最舊
  if (req.method === 'GET' && PANO_HOSTS.includes(url.hostname) && url.pathname.includes('/360fsps2026/tiles/') && req.mode === 'cors') {
    event.respondWith(
      caches.open(PANO_CACHE).then(cache =>
        cache.match(req).then(hit => {
          if (hit) return hit;
          return fetch(req).then(res => {
            if (res && res.ok && res.type === 'cors') {
              cache.put(req, res.clone()).then(() => cache.keys()).then(keys => {
                const extra = keys.length - PANO_CACHE_MAX;
                return Promise.all(keys.slice(0, Math.max(0, extra)).map(k => cache.delete(k)));
              }).catch(() => {});
            }
            return res;
          });
        })
      )
    );
    return;
  }

  // 僅處理同源 GET 請求
  if (req.method !== 'GET' || url.origin !== location.origin) {
    return;
  }

  // 1. 核心程式碼採 Stale-While-Revalidate 策略：
  //    若本機快取中已有資源，立即於 1ms 內直接返回（實現 0 秒秒開開屏）；
  //    同時在背景發起網路請求獲取最新版本，靜默更新快取供下次造訪使用，絕不阻塞首屏！
  if (
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('campus-3d.js') ||
    url.pathname.endsWith('campus-ui.js') ||
    url.pathname.endsWith('sw.js') ||
    url.search.includes('v=')
  ) {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        const fetchPromise = fetch(req).then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(req, resClone);
            });
          }
          return networkRes;
        }).catch(() => null);
        return cachedRes || fetchPromise;
      })
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
