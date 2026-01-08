// Firebase Messaging Service Worker
// This file is required for FCM to work in the browser

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Firebase Configuration (must match firebase-config.js)
firebase.initializeApp({
    apiKey: "AIzaSyC2tsKeBheL6LOWhHwMvYBL4b89m0SVoFs",
    authDomain: "habit-improvement-tracker.firebaseapp.com",
    projectId: "habit-improvement-tracker",
    storageBucket: "habit-improvement-tracker.firebasestorage.app",
    messagingSenderId: "175411542830",
    appId: "1:175411542830:web:bed0aad530a153b88718bf"
});

// Initialize Firebase Messaging
const messaging = firebase.messaging();

// Handle background messages (data-only messages from FCM)
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Background message received:', payload);

    // Read from data field (data-only messages don't have notification field)
    const notificationTitle = payload.data?.title || '習慣改善トラッカー';
    const notificationOptions = {
        body: payload.data?.body || '今日の習慣改善を記録しましょう！',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        data: {
            url: payload.data?.url || './index.html?view=record'
        }
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    console.log('[firebase-messaging-sw.js] Notification click received.');
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('index.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data?.url || './index.html?view=record');
            }
        })
    );
});
