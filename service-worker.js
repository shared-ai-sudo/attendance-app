/**
 * Service Worker for VEXUM Attendance App
 * PWA対応 - オフライン動作、キャッシュ管理
 */

const CACHE_NAME = 'vexum-attendance-v1';
const urlsToCache = [
  '/attendance-app/',
  '/attendance-app/index.html',
  '/attendance-app/style.css',
  '/attendance-app/main.js',
  '/attendance-app/assets/vexum-logo.png',
  '/attendance-app/manifest.json'
];

// インストール時 - 静的リソースをキャッシュ
self.addEventListener('install', (event) => {
  console.log('[Service Worker] インストール中...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] キャッシュを開きました');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('[Service Worker] キャッシュ完了');
        return self.skipWaiting(); // 即座にアクティブ化
      })
  );
});

// アクティベーション時 - 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] アクティベーション中...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] 古いキャッシュを削除:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] アクティベーション完了');
      return self.clients.claim(); // 即座に制御開始
    })
  );
});

// フェッチ時 - キャッシュ優先戦略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // GAS API呼び出しは常にネットワーク経由
  if (request.url.includes('script.google.com')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            ok: false,
            message: 'オフラインです。ネットワーク接続を確認してください。'
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 503
          }
        );
      })
    );
    return;
  }

  // 静的リソース - キャッシュ優先、フォールバックでネットワーク
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[Service Worker] キャッシュから返却:', request.url);
          return cachedResponse;
        }

        console.log('[Service Worker] ネットワークから取得:', request.url);
        return fetch(request).then((response) => {
          // 有効なレスポンスのみキャッシュ
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        });
      })
      .catch(() => {
        // オフライン時のフォールバック
        return new Response(
          `<!DOCTYPE html>
          <html lang="ja">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>オフライン - VEXUM Attendance</title>
            <style>
              body {
                font-family: 'Noto Sans JP', sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                background: #f9fafb;
                color: #1f2937;
                text-align: center;
                padding: 1rem;
              }
              .offline-message {
                max-width: 400px;
              }
              h1 {
                color: #0ea5e9;
                font-size: 2rem;
                margin-bottom: 1rem;
              }
              p {
                font-size: 1rem;
                line-height: 1.6;
                color: #6b7280;
              }
            </style>
          </head>
          <body>
            <div class="offline-message">
              <h1>📡 オフライン</h1>
              <p>現在オフラインです。<br>ネットワーク接続を確認してください。</p>
              <p style="margin-top: 2rem;">
                <a href="/" style="color: #0ea5e9;">再読み込み</a>
              </p>
            </div>
          </body>
          </html>`,
          {
            headers: { 'Content-Type': 'text/html' },
            status: 503
          }
        );
      })
  );
});

// メッセージハンドラー - キャッシュクリア等
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        console.log('[Service Worker] キャッシュをクリアしました');
      })
    );
  }
});
