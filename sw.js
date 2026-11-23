// 屏東縣屏東市復興國小 3D 數位校園 (Service Worker)
// Version: fuxing-3d-campus-v2.12.111

const CACHE_NAME = 'fuxing-3d-campus-v2.12.111';

// 長效靜態快取：three.js、vendor、tex/ 實景貼圖照片等「幾乎不會隨每次改版變動」的資源。
// 與程式碼快取分開，改版時不會被清除，回訪使用者不必重新下載十幾 MB 的圖片。
// 若更換了 vendor/ 或 tex/ 內的檔案內容但檔名不變，請遞增這個版本號才會讓使用者更新。
const STATIC_CACHE = 'fuxing-3d-campus-static-v1';
const isStaticAsset = pathname => /\/(vendor|tex)\//.test(pathname);

// 核心極速快取清單 (App Shell + 3D 引擎 + 1:1 2.5D 高清預覽底圖 + 核心平面圖 + 離線 QR Code)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './campus-ui.js',
  './campus-3d.js',
  './campus-batch.js',
  './data/spots.js',
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
    Promise.all([
      // vendor/ 放長效快取（跨版本保留），其餘 App Shell 放隨版本更新的快取
      caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_ASSETS.filter(u => isStaticAsset(u.replace(/^\./, ''))))),
      caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS.filter(u => !isStaticAsset(u.replace(/^\./, '')))))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME && key !== STATIC_CACHE) {
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

  // 管理頁永遠走網路（不快取），避免管理者用到舊版管理頁
  if (url.pathname.endsWith('/admin.html')) return;

  // 0. 景點資料 (data/) 採 Network-First：管理頁發布後，訪客下一次開啟即取得最新資料；離線時才用快取
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' }).then(networkRes => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
        }
        return networkRes;
      }).catch(() => caches.match(req).then(r => r || Response.error()))
    );
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
        return cachedRes || fetchPromise.then(res => res || Response.error());
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
          // vendor/、tex/ 進長效快取；assets/ 等仍隨版本更新
          caches.open(isStaticAsset(url.pathname) ? STATIC_CACHE : CACHE_NAME).then(cache => {
            cache.put(req, resClone);
          });
        }
        return networkRes;
      });
    })
  );
});
