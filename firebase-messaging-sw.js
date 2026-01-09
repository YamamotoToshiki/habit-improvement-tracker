// =========================================
// Firebase Cloud Messaging Service Worker
// =========================================
// FCMバックグラウンドメッセージの受信・通知表示を担当
// 注意: このファイルはService Worker環境で動作するため、
//       firebase-config.jsからimportできず、設定を重複定義しています
// =========================================

// -----------------------------------------
// Firebase SDK インポート（compat版）
// -----------------------------------------
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// -----------------------------------------
// Firebase 設定（firebase-config.jsと同期必須）
// -----------------------------------------
firebase.initializeApp({
    apiKey: "AIzaSyC2tsKeBheL6LOWhHwMvYBL4b89m0SVoFs",
    authDomain: "habit-improvement-tracker.firebaseapp.com",
    projectId: "habit-improvement-tracker",
    storageBucket: "habit-improvement-tracker.firebasestorage.app",
    messagingSenderId: "175411542830",
    appId: "1:175411542830:web:bed0aad530a153b88718bf"
});

// Firebase Messaging 初期化
const messaging = firebase.messaging();

// -----------------------------------------
// 通知設定
// -----------------------------------------
const DEFAULT_NOTIFICATION = {
    title: '習慣改善トラッカー',
    body: '今日の習慣改善を記録しましょう！',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    defaultUrl: './index.html?view=record'
};

// -----------------------------------------
// バックグラウンドメッセージ受信ハンドラ
// -----------------------------------------
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM-SW] バックグラウンドメッセージを受信:', payload);

    // data フィールドから読み取り（data-onlyメッセージ対応）
    const notificationTitle = payload.data?.title || DEFAULT_NOTIFICATION.title;
    const notificationOptions = {
        body: payload.data?.body || DEFAULT_NOTIFICATION.body,
        icon: DEFAULT_NOTIFICATION.icon,
        badge: DEFAULT_NOTIFICATION.badge,
        data: {
            url: payload.data?.url || DEFAULT_NOTIFICATION.defaultUrl
        }
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// -----------------------------------------
// 通知クリックイベント
// -----------------------------------------
self.addEventListener('notificationclick', (event) => {
    console.log('[FCM-SW] 通知クリックを受信');
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            // 既に開いているウィンドウ/タブがあればフォーカス
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('index.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            // なければ新しいウィンドウ/タブで開く
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data?.url || DEFAULT_NOTIFICATION.defaultUrl);
            }
        })
    );
});
