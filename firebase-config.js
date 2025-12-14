// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyC2tsKeBheL6LOWhHwMvYBL4b89m0SVoFs",
    authDomain: "habit-improvement-tracker.firebaseapp.com",
    projectId: "habit-improvement-tracker",
    storageBucket: "habit-improvement-tracker.firebasestorage.app",
    messagingSenderId: "175411542830",
    appId: "1:175411542830:web:bed0aad530a153b88718bf"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore and Auth
const db = getFirestore(app);
const auth = getAuth(app);

// Initialize Google Auth Provider
const googleProvider = new GoogleAuthProvider();

// Export initialized instances for use in other modules
export { app, db, auth, googleProvider };
