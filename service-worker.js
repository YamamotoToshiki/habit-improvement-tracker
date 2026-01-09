// =========================================
// PWA Service Worker
// =========================================
// オフラインサポートのためのキャッシュを管理
// =========================================

// -----------------------------------------
// キャッシュ設定
// -----------------------------------------
const CACHE_NAME = 'habit-tracker-v2';

// キャッシュ対象アセット
const ASSETS_TO_CACHE = [
    // ローカルファイル
    './',
    './index.html',
    './style.css',
    './app.js',
    './translations.js',
    './firebase-config.js',
    './manifest.json',

    // 外部ライブラリ (CDN)
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
    'https://cdn.jsdelivr.net/npm/flatpickr',
    'https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/ja.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0',
    'https://unpkg.com/chartjs-chart-error-bars@4.1.0/build/index.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/regression/2.0.1/regression.min.js'
];

// -----------------------------------------
// インストールイベント
// -----------------------------------------
self.addEventListener('install', (event) => {
    console.log('[Service Worker] インストール中...', event);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] アプリシェルをキャッシュ中');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// -----------------------------------------
// アクティベートイベント（古いキャッシュの削除）
// -----------------------------------------
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] アクティベート中...', event);
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] 古いキャッシュを削除:', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

// -----------------------------------------
// フェッチイベント（キャッシュ優先戦略）
// -----------------------------------------
self.addEventListener('fetch', (event) => {
    // Firebase関連のリクエストはキャッシュしない（CORS問題回避）
    if (event.request.url.indexOf('firestore.googleapis.com') !== -1 ||
        event.request.url.indexOf('googleapis.com') !== -1) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // キャッシュにあればそれを返す、なければネットワークから取得
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

// -----------------------------------------
// 通知クリックイベント（PWA通知ハンドリング）
// -----------------------------------------
self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] 通知クリックを受信');
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            // 既に開いているウィンドウ/タブがあればフォーカス
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url === event.notification.data?.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // なければ新しいウィンドウ/タブで開く
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data?.url || './index.html');
            }
        })
    );
});