// =========================================
// Firebase 設定・初期化
// =========================================

// -----------------------------------------
// Firebase SDK インポート
// -----------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, deleteField } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

// -----------------------------------------
// Firebase プロジェクト設定
// -----------------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyC2tsKeBheL6LOWhHwMvYBL4b89m0SVoFs",
    authDomain: "habit-improvement-tracker.firebaseapp.com",
    projectId: "habit-improvement-tracker",
    storageBucket: "habit-improvement-tracker.firebasestorage.app",
    messagingSenderId: "175411542830",
    appId: "1:175411542830:web:bed0aad530a153b88718bf"
};

// FCM Web Push 用 VAPID キー
// 取得元: Firebase Console > プロジェクト設定 > Cloud Messaging > ウェブプッシュ証明書
const VAPID_KEY = "BJppLOdKhn-xu1CMa2th8QGguAWYYucdTdvzfBgKGWICr2grMK2m7k0ISOdjI-zzBNSIh-6Y1PqTx16WZYPdQb8";

// -----------------------------------------
// Firebase 初期化
// -----------------------------------------
const app = initializeApp(firebaseConfig);

// Firestore データベース
const db = getFirestore(app);

// Firebase Authentication
const auth = getAuth(app);

// Google 認証プロバイダ
const googleProvider = new GoogleAuthProvider();

// Firebase Cloud Messaging（非対応ブラウザではnull）
let messaging = null;
try {
    messaging = getMessaging(app);
} catch (error) {
    console.warn("このブラウザではFirebase Messagingがサポートされていません:", error);
}

// -----------------------------------------
// エクスポート
// -----------------------------------------
export {
    app,
    db,
    auth,
    googleProvider,
    messaging,
    getToken,
    onMessage,
    VAPID_KEY,
    signInWithRedirect,
    getRedirectResult,
    deleteField
};