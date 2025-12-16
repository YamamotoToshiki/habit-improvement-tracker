// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyC2tsKeBheL6LOWhHwMvYBL4b89m0SVoFs",
    authDomain: "habit-improvement-tracker.firebaseapp.com",
    projectId: "habit-improvement-tracker",
    storageBucket: "habit-improvement-tracker.firebasestorage.app",
    messagingSenderId: "175411542830",
    appId: "1:175411542830:web:bed0aad530a153b88718bf"
};

// VAPID Key for FCM Web Push (Replace with your actual key from Firebase Console)
// Firebase Console > Project Settings > Cloud Messaging > Web Push certificates
const VAPID_KEY = "BJppLOdKhn-xu1CMa2th8QGguAWYYucdTdvzfBgKGWICr2grMK2m7k0ISOdjI-zzBNSIh-6Y1PqTx16WZYPdQb8";

// Initialize Firebase
console.log("Firebase Config:", firebaseConfig);
const app = initializeApp(firebaseConfig);

// Initialize Firestore and Auth
const db = getFirestore(app);
const auth = getAuth(app);

// Initialize Google Auth Provider
const googleProvider = new GoogleAuthProvider();

// Initialize Firebase Messaging
let messaging = null;
try {
    messaging = getMessaging(app);
} catch (error) {
    console.warn("Firebase Messaging not supported in this browser:", error);
}

// Export initialized instances for use in other modules
export { app, db, auth, googleProvider, messaging, getToken, onMessage, VAPID_KEY };
