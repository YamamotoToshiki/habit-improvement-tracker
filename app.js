import { auth, db, googleProvider, messaging, getToken, onMessage, VAPID_KEY, signInWithRedirect, getRedirectResult, deleteField } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { collection, query, where, getDocs, getDoc, addDoc, updateDoc, setDoc, doc, Timestamp, serverTimestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Web Vitals - Performance Monitoring
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'https://unpkg.com/web-vitals@4/dist/web-vitals.attribution.js?module';

// Log Web Vitals metrics
function logWebVitals(metric) {
    console.log(`[Web Vitals] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`);
}

onCLS(logWebVitals);
onINP(logWebVitals);
onLCP(logWebVitals);
onFCP(logWebVitals);
onTTFB(logWebVitals);

// =========================================
// State Management
// =========================================
const state = {
    currentUser: null,
    currentExperiment: null,
    currentLang: localStorage.getItem('appLang') || 'ja'
};

// Simple memory cache for experiment results
const experimentCache = {};
let calendarInstance = null;
let chartInstances = {}; // Store chart instances by ID

// =========================================
// DOM Elements
// =========================================
const views = {
    loading: document.getElementById('view-loading'),
    login: document.getElementById('view-login'),
    settings: document.getElementById('view-settings'),
    record: document.getElementById('view-record'),
    results: document.getElementById('view-results'),
    library: document.getElementById('view-library')
};

const navButtons = {
    settings: document.getElementById('nav-settings'),
    record: document.getElementById('nav-record'),
    results: document.getElementById('nav-results'),
    library: document.getElementById('nav-library')
};

// =========================================
// Initialization Logic
// =========================================

// Detect iOS (iPhone, iPad, iPod)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
// Detect if running as installed PWA (standalone mode)
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

async function initApp() {
    applyTranslations(state.currentLang);

    // Listen for auth state changes
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            state.currentUser = user;
            // Show header nav and FABs when logged in
            document.getElementById('app-header').classList.remove('hidden');
            document.getElementById('fab-help').classList.remove('hidden');
            document.getElementById('fab-notification').classList.remove('hidden');
            updateNotificationFabState();

            // Check if notification permission was changed while app was closed
            const storedPermission = localStorage.getItem('notificationPermission');
            const currentPermission = Notification.permission;
            if (currentPermission === 'granted' && storedPermission !== 'granted') {
                console.log('🔔 Permission change detected on app startup (granted)');
                localStorage.setItem('notificationPermission', 'granted');
                updateNotificationFabState();
                registerFcmToken(user.uid)
                    .then(() => console.log('✅ FCM token registered (app startup)'))
                    .catch((error) => console.error('FCM registration error:', error));
            } else if (currentPermission === 'denied' && storedPermission !== 'denied') {
                console.log('🔔 Permission change detected on app startup (denied)');
                localStorage.setItem('notificationPermission', 'denied');
                updateNotificationFabState();
            }

            // Hide loading view
            views.loading.classList.add('hidden');
            await checkActiveExperiment(user.uid);

            // NOTE: Do NOT auto-request notification permission here
            // iOS requires user interaction (button tap) for notification permission
            // Permission will be requested when user saves experiment settings
            // or taps the notification enable button
        } else {
            state.currentUser = null;
            // Hide header nav and FABs when not logged in
            document.getElementById('app-header').classList.add('hidden');
            document.getElementById('fab-help').classList.add('hidden');
            document.getElementById('fab-notification').classList.add('hidden');
            switchView('login');
        }
    });

    // Google Login Button
    const loginBtn = document.getElementById('btn-google-login');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {

            // Show loading state
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ログイン中...';

            try {
                // Use signInWithPopup for all platforms
                // Note: On iOS PWA, popup may open in Safari if needed
                const result = await signInWithPopup(auth, googleProvider);

                // Show welcome modal on login
                const t = translations[state.currentLang];
                showModal(t.login.welcomeMessage, true);
            } catch (error) {

                // Reset button state
                loginBtn.disabled = false;
                loginBtn.innerHTML = '<i class="fa-brands fa-google"></i> Googleでログイン';

                // Handle specific error codes
                if (error.code === 'auth/popup-closed-by-user') {
                    // User closed popup, don't show error
                } else if (error.code === 'auth/popup-blocked') {
                    showModal('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
                } else if (error.code === 'auth/cancelled-popup-request') {
                    // Multiple popup requests, ignore
                } else {
                    showModal(translations[state.currentLang].common.error + ': ' + error.message);
                }
            }
        });
    }

    // Logout Button
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const t = translations[state.currentLang];
            if (!confirm(t.nav.messages.logoutConfirm)) return;
            try {
                await signOut(auth);
                showModal(t.nav.messages.logoutSuccess);
            } catch (error) {
                showModal(t.common.error);
            }
        });
    }

    // Notification FAB Button
    const fabNotification = document.getElementById('fab-notification');
    if (fabNotification) {
        fabNotification.addEventListener('click', async () => {
            const t = translations[state.currentLang];

            // If already granted, check if FCM token needs to be registered
            if (Notification.permission === 'granted') {
                // Sync localStorage with actual permission
                const storedPermission = localStorage.getItem('notificationPermission');
                if (storedPermission !== 'granted') {
                    // User changed permission externally - register FCM token
                    localStorage.setItem('notificationPermission', 'granted');
                    updateNotificationFabState();

                    if (state.currentUser) {
                        showModal(t.common.notificationEnabled);
                        registerFcmToken(state.currentUser.uid)
                            .then(() => console.log('✅ FCM token registration completed (re-enabled)'))
                            .catch((error) => console.error('FCM registration error:', error));
                    }
                } else {
                    showModal(t.common.notificationEnabled);
                }
                return;
            }

            // If denied in browser, show message
            if (Notification.permission === 'denied') {
                // Sync localStorage with actual permission
                localStorage.setItem('notificationPermission', 'denied');
                updateNotificationFabState();
                showModal(t.common.notificationDisabled, true);
                return;
            }

            // Request permission (only the permission prompt)
            if (state.currentUser) {
                const permission = await Notification.requestPermission();
                localStorage.setItem('notificationPermission', permission);

                // Immediately update FAB state after permission decision
                updateNotificationFabState();

                if (permission === 'granted') {
                    showModal(t.common.notificationEnabled);
                    // Run FCM token registration in background (non-blocking)
                    registerFcmToken(state.currentUser.uid)
                        .then(() => console.log('✅ FCM token registration completed (background)'))
                        .catch((error) => console.error('FCM registration error:', error));
                }
            }
        });
    }

    // Help FAB Button
    const fabHelp = document.getElementById('fab-help');
    if (fabHelp) {
        fabHelp.addEventListener('click', () => {
            const t = translations[state.currentLang];
            showModal(t.login.welcomeMessage, true);
        });
    }

    // =========================================
    // Notification Permission Change Detection
    // =========================================

    // Method 1: Permissions API (Chrome, Edge, Firefox - not Safari)
    if ('permissions' in navigator) {
        navigator.permissions.query({ name: 'notifications' }).then(permission => {
            permission.onchange = () => {
                console.log('🔔 Notification permission changed:', permission.state);
                const storedPermission = localStorage.getItem('notificationPermission');

                if (permission.state === 'granted' && storedPermission !== 'granted') {
                    // Permission was re-enabled externally
                    localStorage.setItem('notificationPermission', 'granted');
                    updateNotificationFabState();

                    if (state.currentUser) {
                        registerFcmToken(state.currentUser.uid)
                            .then(() => console.log('✅ FCM token registered (permission change detected)'))
                            .catch((error) => console.error('FCM registration error:', error));
                    }
                } else if (permission.state === 'denied') {
                    localStorage.setItem('notificationPermission', 'denied');
                    updateNotificationFabState();
                }
            };
        }).catch(err => {
            console.log('Permissions API not fully supported:', err);
        });
    }

    // Method 2: visibilitychange event (fallback for iOS/Safari)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.currentUser) {
            const storedPermission = localStorage.getItem('notificationPermission');
            const currentPermission = Notification.permission;

            // Check if permission changed while app was in background
            if (currentPermission === 'granted' && storedPermission !== 'granted') {
                console.log('🔔 Permission change detected on visibility (granted)');
                localStorage.setItem('notificationPermission', 'granted');
                updateNotificationFabState();

                registerFcmToken(state.currentUser.uid)
                    .then(() => console.log('✅ FCM token registered (visibility change)'))
                    .catch((error) => console.error('FCM registration error:', error));
            } else if (currentPermission === 'denied' && storedPermission !== 'denied') {
                console.log('🔔 Permission change detected on visibility (denied)');
                localStorage.setItem('notificationPermission', 'denied');
                updateNotificationFabState();
            }
        }
    });
}

// =========================================
// FCM Push Notification Setup
// =========================================
async function requestNotificationPermission(userId) {
    // Check if messaging is supported
    if (!messaging) {
        console.log('FCM: messaging not supported');
        return;
    }

    // Check if Service Worker is supported
    if (!('serviceWorker' in navigator)) {
        console.log('FCM: serviceWorker not supported');
        return;
    }

    // Check localStorage for permission status
    const permissionStatus = localStorage.getItem('notificationPermission');

    // If already denied, don't ask again
    if (permissionStatus === 'denied') {
        console.log('FCM: permission already denied');
        return;
    }

    try {
        // Request permission
        const permission = await Notification.requestPermission();
        localStorage.setItem('notificationPermission', permission);

        if (permission === 'granted') {
            await registerFcmToken(userId);
        } else {
            console.log('FCM: permission not granted:', permission);
        }
    } catch (error) {
        console.error('FCM: requestNotificationPermission error:', error);
    }
}

// Register FCM token without requesting permission (for when permission is already granted)
async function registerFcmToken(userId) {
    // Check if messaging is supported
    if (!messaging) {
        console.log('FCM: messaging not supported');
        return;
    }

    // Check if Service Worker is supported
    if (!('serviceWorker' in navigator)) {
        console.log('FCM: serviceWorker not supported');
        return;
    }

    try {
        // Register service worker explicitly for GitHub Pages subdirectory hosting
        console.log('FCM: Registering service worker...');
        const swRegistration = await navigator.serviceWorker.register(
            './firebase-messaging-sw.js',
            { scope: './' }
        );
        console.log('FCM: Service worker registered');

        // Wait for service worker to be ready (important for iOS)
        await navigator.serviceWorker.ready;
        console.log('FCM: Service worker ready');

        // If the SW is installing or waiting, wait for it to become active
        if (swRegistration.installing || swRegistration.waiting) {
            console.log('FCM: Waiting for service worker activation...');
            await new Promise((resolve) => {
                const sw = swRegistration.installing || swRegistration.waiting;
                sw.addEventListener('statechange', (e) => {
                    if (e.target.state === 'activated') {
                        console.log('FCM: Service worker activated');
                        resolve();
                    }
                });
                // Timeout after 10 seconds
                setTimeout(() => {
                    console.log('FCM: Service worker activation timeout');
                    resolve();
                }, 10000);
            });
        }

        // Get FCM token with the registered service worker
        console.log('FCM: Getting token...');
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swRegistration
        });

        if (token) {
            console.log('FCM: Token obtained:', token.substring(0, 20) + '...');

            // Save token to Firestore for this user
            await saveFcmToken(userId, token);
            console.log('FCM: Token saved to Firestore');

            // Set up foreground message handler
            setupForegroundMessageHandler();

            // Update notification FAB to show enabled state
            updateNotificationFabState();
        } else {
            console.log('FCM: No token obtained');
        }
    } catch (error) {
        console.error('FCM: registerFcmToken error:', error);
        throw error; // Re-throw for caller to handle
    }
}

async function saveFcmToken(userId, token) {
    try {
        // Save FCM token to user's document in Firestore
        // Using arrayUnion to support multiple devices per user
        const userTokenRef = doc(db, "userTokens", userId);
        await setDoc(userTokenRef, {
            fcmTokens: arrayUnion(token),  // Array of tokens (one per device)
            updatedAt: serverTimestamp(),
            userId: userId
        }, { merge: true });
        console.log("FCM token saved to Firestore (multi-device support)");
    } catch (error) {
        console.error("Error saving FCM token:", error);
    }
}

function setupForegroundMessageHandler() {
    if (!messaging) return;

    onMessage(messaging, (payload) => {
        console.log("Foreground message received:", payload);

        // Show notification manually when app is in foreground
        const title = payload.notification?.title || '習慣改善トラッカー';
        const body = payload.notification?.body || '今日の習慣改善を記録しましょう！';

        // Use the app's modal to show the notification
        showModal(body);
    });
}

// Update notification FAB state based on permission status
function updateNotificationFabState() {
    const fabNotification = document.getElementById('fab-notification');
    if (!fabNotification) return;

    const icon = fabNotification.querySelector('i');
    if (!icon) return;

    // Check notification permission status
    const permission = Notification.permission;

    if (permission === 'granted') {
        // Enabled state - primary color with bell icon
        fabNotification.classList.remove('fab-secondary');
        icon.classList.remove('fa-bell-slash');
        icon.classList.add('fa-bell');
        fabNotification.title = '通知: 有効';
    } else {
        // Disabled state - danger color with bell-slash icon
        fabNotification.classList.add('fab-secondary');
        icon.classList.remove('fa-bell');
        icon.classList.add('fa-bell-slash');
        fabNotification.title = '通知: 無効（タップで許可）';
    }
}

// =========================================
// Navigation & View Switching
// =========================================
function switchView(viewName) {
    // Hide all views
    Object.values(views).forEach(el => el.classList.add('hidden'));

    // Show target view
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
    }

    // Update nav buttons
    Object.values(navButtons).forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`nav-${viewName.replace('view-', '')}`); // heuristic
    if (activeBtn) activeBtn.classList.add('active'); // This might need adjustment if IDs don't match perfectly

    // Manual mapping for nav buttons since IDs are 'nav-settings' but view is 'settings' (mapped in views object keys)
    if (viewName === 'settings') {
        navButtons.settings.classList.add('active');
        refreshSettingsView();
    }
    if (viewName === 'record') {
        navButtons.record.classList.add('active');
        loadDailyRecord();
    }
    if (viewName === 'results') {
        navButtons.results.classList.add('active');
        loadResultsView();
    }
    if (viewName === 'library') {
        navButtons.library.classList.add('active');
        // Close all details
        document.querySelectorAll('#view-library details').forEach(el => el.removeAttribute('open'));
    }

    // Close Results View calendar and accordions when navigating away
    if (viewName !== 'results') {
        // Close calendar
        const calendarContainer = document.getElementById('result-calendar-container');
        if (calendarContainer) calendarContainer.classList.add('hidden');
        // Close all graph accordions
        document.querySelectorAll('#view-results details.accordion-item').forEach(el => el.removeAttribute('open'));
        // Clear date input and selected record
        const dateInput = document.getElementById('record-date-input');
        if (dateInput) {
            dateInput.value = '';
            // Close flatpickr if open
            if (calendarInstance) calendarInstance.close();
        }
        selectedRecordForView = null;
    }
}

async function refreshSettingsView() {
    if (!state.currentUser) return;
    try {
        await checkActiveExperiment(state.currentUser.uid, false); // Pass false to avoid recursion/redirection
    } catch (e) {
        console.error("Error refreshing settings:", e);
    }
}

// =========================================
// Logic: Check Active Experiment
// =========================================
async function checkActiveExperiment(userId, performNavigation = true) {
    try {
        const experimentsRef = collection(db, "experiments");
        // Query for active experiments: userId matches AND endAt > now
        const q = query(
            experimentsRef,
            where("userId", "==", userId),
            where("endAt", ">", Timestamp.now())
        );

        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            // Active experiment found
            const doc = querySnapshot.docs[0];
            state.currentExperiment = { id: doc.id, ...doc.data() };
            console.log("Active experiment found:", state.currentExperiment);
            updateSettingsViewState(true);

            if (performNavigation) {
                switchView('record');
                loadDailyRecord();
            }
        } else {
            // No active experiment
            console.log("No active experiment found.");
            state.currentExperiment = null;
            updateSettingsViewState(false);

            if (performNavigation) {
                switchView('settings');
            }
        }
    } catch (error) {
        console.error("Error checking experiment:", error);
        showModal(translations[state.currentLang].common.error);
        if (performNavigation) {
            switchView('settings');
        }
    }
}

// =========================================
// UI Logic: Settings View
// =========================================
function updateSettingsViewState(hasActiveExperiment) {
    const form = document.getElementById('form-settings');
    const inputs = form.querySelectorAll('input, select, textarea');
    const saveBtn = document.getElementById('btn-save-experiment');
    const endBtn = document.getElementById('btn-end-experiment');

    if (hasActiveExperiment) {
        // Populate form with current experiment data
        const exp = state.currentExperiment;
        if (exp) {
            document.getElementById('setting-strategy').value = exp.strategy; // Note: if custom, this needs handling
            // Check if strategy is in the list, if not it's custom (or handled by logic below)
            const strategySelect = document.getElementById('setting-strategy');
            const options = Array.from(strategySelect.options).map(o => o.value);
            if (!options.includes(exp.strategy)) {
                strategySelect.value = "（その他）";
                document.getElementById('setting-strategy-custom').value = exp.strategy;
            } else {
                strategySelect.value = exp.strategy;
            }

            document.getElementById('setting-action').value = exp.action;
            document.getElementById('setting-duration').value = exp.durationDays;
            document.getElementById('setting-notification').value = exp.notificationTime;

            // Trigger change event to handle custom field visibility if needed (though disabled)
            strategySelect.dispatchEvent(new Event('change'));

            // Lock inputs
            inputs.forEach(input => input.disabled = true);
            saveBtn.disabled = true;
            endBtn.disabled = false;
        }
    } else {
        // Unlock inputs
        inputs.forEach(input => input.disabled = false);
        saveBtn.disabled = false;
        endBtn.disabled = true;

        // Reset form
        form.reset();
        // Re-trigger strategy change to set initial state of custom field
        document.getElementById('setting-strategy').dispatchEvent(new Event('change'));
    }
}

// Settings Form Event Listeners
const strategySelect = document.getElementById('setting-strategy');
const strategyCustomInput = document.getElementById('setting-strategy-custom');
const actionInput = document.getElementById('setting-action');
const actionCharCount = document.getElementById('action-char-count');

strategySelect.addEventListener('change', (e) => {
    if (e.target.value === "（その他）") {
        document.getElementById('view-settings-custom').classList.remove('disabled-section');
        strategyCustomInput.disabled = false;
        strategyCustomInput.focus();
    } else {
        document.getElementById('view-settings-custom').classList.add('disabled-section');
        strategyCustomInput.disabled = true;
        strategyCustomInput.value = "";
    }
});

// Auto-resize textarea helper function
function autoResizeTextarea(textarea) {
    // Store the initial height based on rows attribute
    if (!textarea.dataset.initialHeight) {
        textarea.dataset.initialHeight = textarea.scrollHeight;
    }
    // Reset to auto to get proper scrollHeight
    textarea.style.height = 'auto';
    // Set height to scrollHeight, but not less than initial height
    const minHeight = parseInt(textarea.dataset.initialHeight) || textarea.scrollHeight;
    textarea.style.height = Math.max(textarea.scrollHeight, minHeight) + 'px';
}

actionInput.addEventListener('input', (e) => {
    actionCharCount.textContent = e.target.value.length;
    autoResizeTextarea(e.target);
});

// Save Experiment
document.getElementById('btn-save-experiment').addEventListener('click', async () => {
    const t = translations[state.currentLang];

    // Validation
    const strategyVal = strategySelect.value;
    const customStrategyVal = strategyCustomInput.value.trim();
    const actionVal = actionInput.value.trim();
    const durationVal = document.getElementById('setting-duration').value;
    const notificationVal = document.getElementById('setting-notification').value;

    // Clear previous errors
    clearValidationErrors();

    let finalStrategy = strategyVal;
    let hasError = false;

    if (strategyVal === "（その他）") {
        if (!customStrategyVal) {
            showValidationError(strategyCustomInput, "必須項目です");
            hasError = true;
        }
        finalStrategy = customStrategyVal;
    }

    if (!actionVal) {
        showValidationError(actionInput, "必須項目です");
        hasError = true;
    }

    if (!durationVal) {
        showValidationError(document.getElementById('setting-duration'), "必須項目です");
        hasError = true;
    } else {
        const durationNum = parseInt(durationVal, 10);
        if (isNaN(durationNum) || durationNum < 1 || durationNum > 90) {
            showValidationError(document.getElementById('setting-duration'), "1から90までの数値を入力してください");
            hasError = true;
        }
    }

    if (!notificationVal) {
        showValidationError(document.getElementById('setting-notification'), "必須項目です");
        hasError = true;
    }

    if (hasError) return;

    // Confirm
    if (!confirm(t.settings.messages.saveConfirm)) return;

    // ========== Performance Measurement Start ==========
    const metrics = {};
    const totalStart = performance.now();

    try {
        // --- addDoc timing ---
        const addDocStart = performance.now();
        const docRef = await addDoc(collection(db, "experiments"), {
            strategy: finalStrategy,
            action: actionVal,
            durationDays: parseInt(durationVal, 10),
            startAt: Timestamp.now(),
            endAt: Timestamp.fromDate(new Date(Date.now() + parseInt(durationVal, 10) * 24 * 60 * 60 * 1000)), // Approximate
            notificationTime: notificationVal,
            createdAt: serverTimestamp(),
            userId: state.currentUser.uid
        });
        metrics.addDoc = Math.round(performance.now() - addDocStart);

        showModal(t.settings.messages.saveSuccess);

        // --- requestNotificationPermission (async, non-blocking) ---
        // Run in background to avoid blocking UI
        requestNotificationPermission(state.currentUser.uid)
            .then(() => {
                updateNotificationFabState();
                console.log('✅ Notification permission processing completed (background)');
            })
            .catch((error) => console.error('Notification error:', error));

        // --- Optimistic UI Update (no Firestore query) ---
        const optimisticStart = performance.now();
        const durationNum = parseInt(durationVal, 10);
        const startAt = Timestamp.now();
        const endAt = Timestamp.fromDate(new Date(Date.now() + durationNum * 24 * 60 * 60 * 1000));

        // Set state directly from saved data (skip query)
        state.currentExperiment = {
            id: docRef.id,
            strategy: finalStrategy,
            action: actionVal,
            durationDays: durationNum,
            startAt: startAt,
            endAt: endAt,
            notificationTime: notificationVal,
            userId: state.currentUser.uid
        };

        // Update UI synchronously
        updateSettingsViewState(true);
        switchView('record');
        await loadDailyRecord();
        metrics.optimisticUI = Math.round(performance.now() - optimisticStart);

        // ========== Performance Measurement Result ==========
        metrics.total = Math.round(performance.now() - totalStart);
        console.log('🔍 Save Button Performance Metrics (ms):');
        console.table(metrics);

    } catch (e) {
        console.error("Error adding document: ", e);
        showModal(t.common.error);
    }
});

// End Experiment
document.getElementById('btn-end-experiment').addEventListener('click', async () => {
    const t = translations[state.currentLang];

    if (!confirm(t.settings.messages.endConfirm)) return;

    try {
        if (!state.currentExperiment) return;

        const expRef = doc(db, "experiments", state.currentExperiment.id);
        await updateDoc(expRef, {
            endAt: Timestamp.now()
        });

        showModal(t.settings.messages.endSuccess);

        // Refresh state
        if (state.currentUser) {
            await checkActiveExperiment(state.currentUser.uid, false);
            // Also refresh results view if active
            if (!document.getElementById('view-results').classList.contains('hidden')) {
                loadResultsView();
            }
        }

    } catch (e) {
        console.error("Error updating document: ", e);
        showModal(t.common.error);
    }
});

// =========================================
// Logic: Daily Record View
// =========================================
let currentRecordId = null;

async function loadDailyRecord() {
    const t = translations[state.currentLang];

    // Always update date
    const today = new Date();
    document.getElementById('record-date').textContent = today.toLocaleDateString(state.currentLang);

    if (!state.currentExperiment) {
        // Disable Form
        document.getElementById('record-experiment-name').textContent = '---';
        document.getElementById('record-days-elapsed').textContent = '---';

        const carriedOutCheckbox = document.getElementById('record-carried-out');
        const memoTextarea = document.getElementById('record-memo');
        const saveBtn = document.getElementById('btn-save-record');
        const editBtn = document.getElementById('btn-edit-record'); // Ensure this is also handled

        carriedOutCheckbox.disabled = true;
        memoTextarea.disabled = true;
        saveBtn.disabled = true;
        editBtn.disabled = true;

        // Gray out labels
        const labels = [
            document.querySelector('label[for="record-carried-out"]'),
            document.querySelector('label[for="record-memo"]')
        ];
        labels.forEach(l => { if (l) l.style.opacity = '0.5'; });

        // Disable details container just in case
        document.getElementById('record-details-container').classList.add('disabled-section');
        document.querySelectorAll('#record-details-container input, #record-details-container select').forEach(el => el.disabled = true);

        return;
    }

    // Note: Form inputs (carried-out, memo) will be enabled/disabled
    // AFTER checking for existing records below.

    const exp = state.currentExperiment;

    // Update Info Area
    document.getElementById('record-experiment-name').textContent = exp.strategy;

    // Calculate days elapsed
    const start = exp.startAt.toDate();
    const now = new Date();
    const diffTime = Math.abs(now - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    document.getElementById('record-days-elapsed').textContent = diffDays;

    // Reset Form first
    document.getElementById('form-record').reset();
    document.getElementById('record-details-container').classList.add('disabled-section');
    document.querySelectorAll('#record-details-container input, #record-details-container select').forEach(el => el.disabled = true);

    // Set default notification time for "Started Time" logic
    const notifTime = exp.notificationTime; // "HH:MM"
    if (notifTime) {
        const hour = parseInt(notifTime.split(':')[0], 10);
        let timeOfDay = '–é'; // Default fallback
        if (hour >= 0 && hour < 3) timeOfDay = '深夜';
        else if (hour >= 3 && hour < 6) timeOfDay = '早朝';
        else if (hour >= 6 && hour < 9) timeOfDay = '朝';
        else if (hour >= 9 && hour < 15) timeOfDay = '昼';
        else if (hour >= 15 && hour < 18) timeOfDay = '夕方';
        else timeOfDay = '夜';

        // Map to value
        document.getElementById('record-started-time').value = timeOfDay;
    }

    // Check for existing record for TODAY
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = Timestamp.fromDate(todayStart);

    try {
        const q = query(
            collection(db, "records"),
            where("userId", "==", state.currentUser.uid),
            where("experimentId", "==", exp.id),
            where("recordedDate", "==", todayTimestamp)
        );

        const querySnapshot = await getDocs(q);

        const saveBtn = document.getElementById('btn-save-record');
        const editBtn = document.getElementById('btn-edit-record');
        const carriedOutCheckbox = document.getElementById('record-carried-out');
        const memoTextarea = document.getElementById('record-memo');
        const carriedOutLabel = document.querySelector('label[for="record-carried-out"]');
        const memoLabel = document.querySelector('label[for="record-memo"]');

        if (!querySnapshot.empty) {
            // Record exists for today - LOCK the form, only allow editing
            const doc = querySnapshot.docs[0];
            const data = doc.data();
            currentRecordId = doc.id;

            // Populate Form
            carriedOutCheckbox.checked = data.carriedOut;
            if (data.carriedOut) {
                document.getElementById('record-started-time').value = data.startedTime;
                document.getElementById('record-duration').value = data.durationTime;
                document.getElementById('record-interrupted').checked = data.interrupted;
                if (data.interrupted) {
                    document.getElementById('record-interruption-reason').value = data.interruptionReason || "";
                }
                document.getElementById('record-concentration').value = data.concentration;
                document.getElementById('val-concentration').textContent = data.concentration;
                document.getElementById('record-accomplishment').value = data.accomplishment;
                document.getElementById('val-accomplishment').textContent = data.accomplishment;
                document.getElementById('record-fatigue').value = data.fatigue;
                document.getElementById('val-fatigue').textContent = data.fatigue;
            }
            memoTextarea.value = data.memo || "";
            document.getElementById('memo-char-count').textContent = (data.memo || "").length;

            // Update UI State for details container
            toggleRecordInputs(data.carriedOut);
            toggleInterruptionInput(data.interrupted);

            // Lock Form - disable ALL inputs including carried-out and memo
            lockRecordForm(true);
            saveBtn.disabled = true;
            editBtn.disabled = false;

            // Ensure labels are normal (not grayed out) but inputs are disabled
            if (carriedOutLabel) carriedOutLabel.style.opacity = '1';
            if (memoLabel) memoLabel.style.opacity = '1';
        } else {
            // No record for today - UNLOCK the form for new entry
            currentRecordId = null;

            // Enable carried-out and memo inputs
            carriedOutCheckbox.disabled = false;
            memoTextarea.disabled = false;
            if (carriedOutLabel) carriedOutLabel.style.opacity = '1';
            if (memoLabel) memoLabel.style.opacity = '1';

            // Enable save, disable edit
            saveBtn.disabled = false;
            editBtn.disabled = true;

            // Trigger initial UI state (details container stays disabled until checkbox is checked)
            toggleRecordInputs(false);
        }

    } catch (e) {
        console.error("Error fetching record:", e);
    }
}

// UI Helpers
function toggleRecordInputs(isCarriedOut) {
    const container = document.getElementById('record-details-container');
    const inputs = container.querySelectorAll('input, select');

    if (isCarriedOut) {
        container.classList.remove('disabled-section');
        inputs.forEach(el => {
            // Keep interruption reason disabled if interruption is unchecked
            if (el.id === 'record-interruption-reason') {
                el.disabled = !document.getElementById('record-interrupted').checked;
            } else {
                el.disabled = false;
            }
        });
    } else {
        container.classList.add('disabled-section');
        inputs.forEach(el => el.disabled = true);
    }
}

function toggleInterruptionInput(isInterrupted) {
    const input = document.getElementById('record-interruption-reason');
    input.disabled = !isInterrupted;
    if (!isInterrupted) {
        document.getElementById('interruption-custom').classList.add('disabled-section')
        input.value = "";
    } else {
        document.getElementById('interruption-custom').classList.remove('disabled-section')
    }
}

function lockRecordForm(locked) {
    const form = document.getElementById('form-record');
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(el => el.disabled = locked);
}

// Event Listeners: Record View
document.getElementById('record-carried-out').addEventListener('change', (e) => {
    toggleRecordInputs(e.target.checked);
});

document.getElementById('record-interrupted').addEventListener('change', (e) => {
    toggleInterruptionInput(e.target.checked);
});

// Sliders
['concentration', 'accomplishment', 'fatigue'].forEach(key => {
    const input = document.getElementById(`record-${key}`);
    const display = document.getElementById(`val-${key}`);
    input.addEventListener('input', (e) => {
        display.textContent = e.target.value;
    });
});

document.getElementById('record-memo').addEventListener('input', (e) => {
    document.getElementById('memo-char-count').textContent = e.target.value.length;
    autoResizeTextarea(e.target);
});

document.getElementById('btn-edit-record').addEventListener('click', () => {
    lockRecordForm(false);
    document.getElementById('btn-save-record').disabled = false;
    document.getElementById('btn-edit-record').disabled = true;
    // Re-apply toggle logic to ensure correct state of sub-inputs
    toggleRecordInputs(document.getElementById('record-carried-out').checked);
});

document.getElementById('btn-save-record').addEventListener('click', async () => {
    const t = translations[state.currentLang];
    if (!confirm(t.record.messages.saveConfirm)) return;

    const carriedOut = document.getElementById('record-carried-out').checked;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = Timestamp.fromDate(todayStart);

    const recordData = {
        experimentId: state.currentExperiment.id,
        recordedDate: todayTimestamp,
        carriedOut: carriedOut,
        memo: document.getElementById('record-memo').value.trim(),
        userId: state.currentUser.uid
    };

    if (carriedOut) {
        recordData.startedTime = document.getElementById('record-started-time').value;
        recordData.durationTime = parseInt(document.getElementById('record-duration').value, 10);
        recordData.interrupted = document.getElementById('record-interrupted').checked;
        if (recordData.interrupted) {
            recordData.interruptionReason = document.getElementById('record-interruption-reason').value.trim();
        }
        recordData.concentration = parseInt(document.getElementById('record-concentration').value, 10);
        recordData.accomplishment = parseInt(document.getElementById('record-accomplishment').value, 10);
        recordData.fatigue = parseInt(document.getElementById('record-fatigue').value, 10);
    }

    try {
        // ALWAYS check Firestore for existing record for today (don't rely on in-memory currentRecordId)
        const existingQuery = query(
            collection(db, "records"),
            where("userId", "==", state.currentUser.uid),
            where("experimentId", "==", state.currentExperiment.id),
            where("recordedDate", "==", todayTimestamp)
        );
        const existingSnapshot = await getDocs(existingQuery);

        if (!existingSnapshot.empty) {
            // Record exists for today - UPDATE it
            const existingDocId = existingSnapshot.docs[0].id;
            const existingData = existingSnapshot.docs[0].data();

            // Check if carriedOut changed from true to false - delete related fields
            if (existingData.carriedOut === true && carriedOut === false) {
                recordData.startedTime = deleteField();
                recordData.durationTime = deleteField();
                recordData.interrupted = deleteField();
                recordData.interruptionReason = deleteField();
                recordData.concentration = deleteField();
                recordData.accomplishment = deleteField();
                recordData.fatigue = deleteField();
            }
            // Check if interrupted changed from true to false - delete interruptionReason
            else if (carriedOut && existingData.interrupted === true && !document.getElementById('record-interrupted').checked) {
                recordData.interruptionReason = deleteField();
            }

            await updateDoc(doc(db, "records", existingDocId), recordData);
            currentRecordId = existingDocId;
            console.log("Record updated:", existingDocId);
        } else {
            // No record for today - CREATE new one
            const docRef = await addDoc(collection(db, "records"), recordData);
            currentRecordId = docRef.id;
            console.log("Record created:", docRef.id);
        }

        // Clear cache so Results view updates
        if (experimentCache[state.currentExperiment.id]) {
            delete experimentCache[state.currentExperiment.id];
        }

        showModal(t.record.messages.saveSuccess);

        // Lock UI
        lockRecordForm(true);
        document.getElementById('btn-save-record').disabled = true;
        document.getElementById('btn-edit-record').disabled = false;

    } catch (e) {
        console.error("Error saving record:", e);
        showModal(t.common.error);
    }
});

// =========================================
// Logic: Results View
// =========================================

async function loadResultsView() {
    if (!state.currentUser) return;

    const t = translations[state.currentLang];
    const select = document.getElementById('result-experiment-select');
    select.innerHTML = '<option value="">Loading...</option>';

    try {
        // Fetch all experiments for user
        const q = query(
            collection(db, "experiments"),
            where("userId", "==", state.currentUser.uid)
        );

        const querySnapshot = await getDocs(q);
        const experiments = [];
        querySnapshot.forEach(doc => {
            experiments.push({ id: doc.id, ...doc.data() });
        });

        // Sort in memory (descending)
        experiments.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);

        select.innerHTML = '';
        if (experiments.length === 0) {
            select.innerHTML = `<option value="">${t.results.labels.noExperiments || "No experiments found"}</option>`;
            return;
        }

        experiments.forEach(exp => {
            const opt = document.createElement('option');
            opt.value = exp.id;
            opt.textContent = `${exp.strategy} (${exp.startAt.toDate().toLocaleDateString()})`;
            select.appendChild(opt);
        });

        // Select current or latest
        if (state.currentExperiment) {
            select.value = state.currentExperiment.id;
        } else if (experiments.length > 0) {
            select.value = experiments[0].id;
        }

        // Load data for selected
        loadExperimentResults(select.value);

        // Change listener
        select.onchange = () => loadExperimentResults(select.value);

    } catch (e) {
        console.error("Error loading experiments:", e);
        select.innerHTML = '<option value="">Error</option>';
    }
}

async function loadExperimentResults(experimentId) {
    if (!experimentId) return;

    try {
        let records = [];

        // Check Cache
        if (experimentCache[experimentId]) {
            console.log("Using cached records for:", experimentId);
            records = experimentCache[experimentId];
        } else {
            // Fetch records
            const q = query(
                collection(db, "records"),
                where("userId", "==", state.currentUser.uid),
                where("experimentId", "==", experimentId)
            );

            const querySnapshot = await getDocs(q);
            querySnapshot.forEach(doc => {
                records.push(doc.data());
            });

            // Sort
            records.sort((a, b) => a.recordedDate.seconds - b.recordedDate.seconds);

            // Store in Cache
            experimentCache[experimentId] = records;
        }

        // Update Info Area
        await updateResultInfo(experimentId, records);

        // Render Calendar
        renderCalendar(records);

        // Render Charts
        renderChart1(records);
        renderChart2(records);
        renderChart3(records);
        renderChart4(records);
        renderChart5(records);

    } catch (e) {
        console.error("Error loading results:", e);
    }
}

async function updateResultInfo(experimentId, records) {
    try {
        const expDoc = await getDoc(doc(db, "experiments", experimentId));
        if (!expDoc.exists()) return;
        const exp = expDoc.data();

        document.getElementById('res-strategy').textContent = exp.strategy || '-';
        document.getElementById('res-action').textContent = exp.action || '-';

        const start = exp.startAt.toDate();
        const duration = exp.durationDays || 0;
        const end = new Date(start.getTime() + duration * 24 * 60 * 60 * 1000);

        const startStr = start.toLocaleDateString(state.currentLang);
        const endStr = end.toLocaleDateString(state.currentLang);
        document.getElementById('res-period').textContent = `${startStr} ～ ${endStr} (${duration}日間)`;

        const recordCount = records.length;
        const rate = duration > 0 ? Math.round((recordCount / duration) * 100) : 0;
        document.getElementById('res-rate').textContent = `${recordCount} / ${duration}日 (${rate}%)`;

        // Check Status
        // Logic: if endAt < now, it's finished.
        const now = new Date();
        const endDate = exp.endAt.toDate();
        const statusEl = document.getElementById('res-status');

        if (endDate < now) {
            statusEl.textContent = '終了';
            statusEl.className = 'text-warning'; // Add warning class
        } else {
            statusEl.textContent = '進行中';
            statusEl.className = ''; // Reset class
        }

    } catch (e) {
        console.error("Error updating result info:", e);
    }
}

// Calendar Logic (triggered by date input field)
const recordDateInput = document.getElementById('record-date-input');
const viewRecordBtn = document.getElementById('btn-view-record');

// Store selected record for view button
let selectedRecordForView = null;

// View record button click handler
if (viewRecordBtn) {
    viewRecordBtn.addEventListener('click', () => {
        // Clear previous error tooltip
        const existingTooltip = viewRecordBtn.parentElement.querySelector('.tooltip-error');
        if (existingTooltip) existingTooltip.remove();

        // Validate: check if date is selected
        if (!recordDateInput || !recordDateInput.value.trim()) {
            showValidationError(recordDateInput, "日付を入力してください", 3000);
            return;
        }

        // Show record modal if record exists
        if (selectedRecordForView) {
            showRecordDetail(selectedRecordForView);
        }
    });
}

// Calendar Logic - attaches flatpickr to date input field
function renderCalendar(records) {
    if (!recordDateInput) return;

    // Helper to get YYYY-MM-DD in local time
    const getLocalYYYYMMDD = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    // Map records to a dictionary for easy lookup by date string "YYYY-MM-DD"
    const recordMap = {};
    records.forEach(r => {
        const dateStr = getLocalYYYYMMDD(r.recordedDate.toDate());
        recordMap[dateStr] = r;
    });

    if (calendarInstance) {
        calendarInstance.destroy();
    }

    // Calendar Display Range (Extract start/end dates from the period text in resultsInfo)
    const periodText = document.getElementById('res-period')?.textContent || '';
    let minDateOpt = null, maxDateOpt = null;
    const parts = periodText.split('～');
    if (parts.length === 2) {
        const parseLocal = s => {
            s = s.split('(')[0].trim();
            const nums = s.match(/\d{1,4}/g) || [];
            if (nums.length >= 3) {
                if (nums[0].length === 4) return `${nums[0]}-${nums[1].padStart(2, '0')}-${nums[2].padStart(2, '0')}`;
                if (nums[2].length === 4) return `${nums[2]}-${nums[0].padStart(2, '0')}-${nums[1].padStart(2, '0')}`;
            }
            return null;
        };
        minDateOpt = parseLocal(parts[0]);
        maxDateOpt = parseLocal(parts[1]);
    }

    // Get list of dates that have records (for enabling only those dates)
    const enabledDates = Object.keys(recordMap);

    // Attach flatpickr directly to date input (standard overlay mode)
    calendarInstance = flatpickr(recordDateInput, {
        locale: 'ja',
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "Y/m/d",
        minDate: minDateOpt,
        maxDate: maxDateOpt,
        enable: enabledDates,  // Only allow selecting dates with records
        onDayCreate: function (dObj, dStr, fp, dayElem) {
            const dateStr = getLocalYYYYMMDD(dayElem.dateObj);
            if (recordMap[dateStr]) {
                const r = recordMap[dateStr];
                if (r.carriedOut) {
                    dayElem.classList.add('day-success');
                    dayElem.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
                    dayElem.style.borderColor = 'var(--color-success)';
                } else {
                    dayElem.classList.add('day-failure');
                    dayElem.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                    dayElem.style.borderColor = 'var(--color-danger)';
                }
            }
        },
        onChange: function (selectedDates, dateStr, instance) {
            // Store the record for view button
            if (recordMap[dateStr]) {
                selectedRecordForView = recordMap[dateStr];
            } else {
                selectedRecordForView = null;
            }
        }
    });
}

function showRecordDetail(record) {
    const t = translations[state.currentLang];
    const date = record.recordedDate.toDate().toLocaleDateString();

    // Determine display values based on conditions
    const carriedOut = record.carriedOut;
    const interrupted = record.interrupted;

    // If carriedOut is false, show '-' for all items except 実施可否 and メモ
    const startedTime = carriedOut ? (record.startedTime || '-') : '-';
    const durationTime = carriedOut ? (record.durationTime ? `${record.durationTime}分` : '-') : '-';
    const interruptedDisplay = carriedOut ? (interrupted ? 'あり' : 'なし') : '-';
    const concentration = carriedOut ? (record.concentration || '-') : '-';
    const accomplishment = carriedOut ? (record.accomplishment || '-') : '-';
    const fatigue = carriedOut ? (record.fatigue || '-') : '-';

    // 中断理由: '-' if carriedOut is false, or interrupted is false, or interruptionReason is empty
    let interruptionReason = '-';
    if (carriedOut && interrupted && record.interruptionReason && record.interruptionReason.length > 0) {
        interruptionReason = `"${record.interruptionReason}"`.replace(/\n/g, '<br>');
    }

    // メモ: '-' if memo is empty (regardless of carriedOut)
    let memo = '-';
    if (record.memo && record.memo.length > 0) {
        memo = `"${record.memo}"`.replace(/\n/g, '<br>');
    }

    let content = `<h3>${date} の記録</h3>`;
    content += `<div style="text-align:left; margin-top:16px;">`;
    content += `<p><strong>実施可否:</strong> ${carriedOut ? 'はい' : 'いいえ'}</p>`;
    content += `<p><strong>開始時間帯:</strong> ${startedTime}</p>`;
    content += `<p><strong>継続時間:</strong> ${durationTime}</p>`;
    content += `<p><strong>中断:</strong> ${interruptedDisplay}</p>`;
    content += `<p><strong>中断理由:</strong><br>${interruptionReason}</p>`;
    content += `<p><strong>集中度:</strong> ${concentration}</p>`;
    content += `<p><strong>達成感:</strong> ${accomplishment}</p>`;
    content += `<p><strong>疲労感:</strong> ${fatigue}</p>`;
    content += `<p><strong>メモ:</strong><br>${memo}</p>`;
    content += `</div>`;

    const detailContainer = document.getElementById('modal-record-detail');
    detailContainer.innerHTML = content;
    detailContainer.classList.remove('hidden');
    document.getElementById('modal-message').classList.add('hidden');

    modalOverlay.classList.remove('hidden');
}

// Chart 1: Completion Rate (Donut) - Per requirements
function renderChart1(records) {
    const ctx = document.getElementById('chart-1').getContext('2d');
    if (chartInstances['chart-1']) chartInstances['chart-1'].destroy();

    const carriedOutCount = records.filter(r => r.carriedOut).length;
    const notCarriedOutCount = records.filter(r => !r.carriedOut).length;
    const totalDays = records.length;
    const completionRate = totalDays > 0 ? Math.round((carriedOutCount / totalDays) * 100) : 0;

    // Get CSS variable colors
    const rootStyles = getComputedStyle(document.documentElement);
    const textPrimary = rootStyles.getPropertyValue('--text-primary').trim() || '#1F2937';
    const textSecondary = rootStyles.getPropertyValue('--text-secondary').trim() || '#4B5563';
    const colorSuccess = rootStyles.getPropertyValue('--color-success').trim() || '#16B981';
    const colorDanger = rootStyles.getPropertyValue('--color-danger').trim() || '#EF4444';

    // Plugin to draw center text with responsive font size
    const centerTextPlugin = {
        id: 'centerText',
        afterDraw: (chart) => {
            const { ctx, chartArea: { width, height, top, left } } = chart;
            ctx.save();
            // Responsive font size: base on chart width, min 14px, max 24px
            const fontSize = Math.max(14, Math.min(24, width * 0.08));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = textPrimary;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const centerX = left + width / 2;
            const centerY = top + height / 2;
            ctx.fillText(`実施率: ${completionRate}%`, centerX, centerY);
            ctx.restore();
        }
    };

    chartInstances['chart-1'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [`作業実施済: ${carriedOutCount}日`, `作業非実施: ${notCarriedOutCount}日`],
            datasets: [{
                data: [carriedOutCount, notCarriedOutCount],
                backgroundColor: [colorSuccess + '20', colorDanger + '20'],
                borderColor: [colorSuccess, colorDanger],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            cutout: '50%',
            plugins: {
                legend: { position: 'bottom', labels: { color: textSecondary } },
                datalabels: {
                    color: textSecondary,
                    font: (context) => {
                        // Responsive font size based on chart width
                        const chartWidth = context.chart.width;
                        const size = Math.max(12, Math.min(20, chartWidth * 0.05));
                        return { weight: 'bold', size: size };
                    },
                    formatter: (value, ctx) => {
                        const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                        if (total === 0 || value === 0) return '';
                        const percentage = Math.round((value / total) * 100);
                        return `${percentage}%`;
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.raw;
                            const total = context.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${label} (${percentage}%)`;
                        }
                    }
                }
            }
        },
        plugins: [ChartDataLabels, centerTextPlugin]
    });
}

// Chart 2: Duration over Time (Bar) - Per requirements
function renderChart2(records) {
    const ctx = document.getElementById('chart-2').getContext('2d');
    if (chartInstances['chart-2']) chartInstances['chart-2'].destroy();

    // Get CSS variable color
    const rootStyles = getComputedStyle(document.documentElement);
    const colorSecondary = rootStyles.getPropertyValue('--color-secondary').trim() || '#2BC8E4';
    const textSecondary = rootStyles.getPropertyValue('--text-secondary').trim() || '#4B5563';

    // Filter: only carriedOut records with durationTime
    const activeRecords = records.filter(r => r.carriedOut && r.durationTime);

    // Common Y-axis configuration (fixed 1-5 scale)
    const yAxisConfig = {
        beginAtZero: false,
        min: 1,
        max: 5,
        ticks: {
            stepSize: 1,
            callback: (value) => value,
            color: textSecondary
        },
        title: { display: true, text: 'スコア', color: textSecondary },
        grid: { color: textSecondary + '33' }
    };

    if (activeRecords.length === 0) {
        // No data to display - still show fixed 1-5 Y-axis
        chartInstances['chart-2'] = new Chart(ctx, {
            type: 'bar',
            data: { labels: [], datasets: [{ label: '作業継続スコア', data: [] }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'データがありません', color: textSecondary },
                    legend: { labels: { color: textSecondary } }
                },
                scales: {
                    x: { ticks: { color: textSecondary }, grid: { color: textSecondary + '33' } },
                    y: yAxisConfig
                }
            }
        });
        return;
    }

    const labels = activeRecords.map(r => r.recordedDate.toDate().toLocaleDateString());
    const durationData = activeRecords.map(r => r.durationTime);

    // Convert duration to score: 5→1, 15→2, 30→3, 60→4, 180→5
    const durationToScore = (duration) => {
        switch (duration) {
            case 5: return 1;
            case 15: return 2;
            case 30: return 3;
            case 60: return 4;
            case 180: return 5;
            default: return null;
        }
    };
    const scoreData = durationData.map(d => durationToScore(d));

    // Calculate average score
    const validScores = scoreData.filter(s => s !== null);
    const avgScore = validScores.length > 0 ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : 0;

    // Horizontal average line
    const avgLine = Array(scoreData.length).fill(parseFloat(avgScore));

    chartInstances['chart-2'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '作業継続スコア',
                    data: scoreData,
                    backgroundColor: colorSecondary + '20',
                    borderColor: colorSecondary,
                    borderWidth: 1,
                    order: 2
                },
                {
                    label: `平均: ${avgScore}`,
                    data: avgLine,
                    type: 'line',
                    borderColor: textSecondary,
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: textSecondary } },
                title: {
                    display: true,
                    text: ['平均作業継続スコア: ' + avgScore, '（5分→1 ～ 3時間→5）'],
                    font: { size: 14 },
                    color: textSecondary
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const idx = context.dataIndex;
                            const originalDuration = durationData[idx];
                            return `${context.dataset.label}: ${context.raw} (${originalDuration}分)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: textSecondary },
                    grid: { color: textSecondary + '33' }
                },
                y: yAxisConfig
            }
        }
    });
}

// Helper for Charts 3, 4, 5
function calculateCorrelationStats(records, metricKey) {
    const timeSlots = ['深夜', '早朝', '朝', '昼', '夕方', '夜'];
    const stats = timeSlots.map(slot => ({
        slot,
        count: 0,
        interruptedCount: 0,
        values: []
    }));

    // Filter: carriedOut && startedTime && interrupted defined && metric defined
    records.forEach(r => {
        if (!r.carriedOut || !r.startedTime || r.interrupted === undefined || r[metricKey] === undefined) return;
        const index = timeSlots.indexOf(r.startedTime);
        if (index !== -1) {
            stats[index].count++;
            if (r.interrupted) stats[index].interruptedCount++;
            stats[index].values.push(r[metricKey]);
        }
    });

    const labels = timeSlots;
    const interruptionRates = stats.map(s => s.count > 0 ? (s.interruptedCount / s.count) * 100 : null);

    // Calculate mean, median, sd
    const statResults = stats.map(s => {
        if (s.values.length === 0) return { mean: null, median: null, sd: null, count: 0, lowSample: false };
        const sum = s.values.reduce((a, b) => a + b, 0);
        const mean = sum / s.values.length;
        const sorted = [...s.values].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
        const variance = s.values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / s.values.length;
        const sd = Math.sqrt(variance);
        return { mean, median, sd, count: s.values.length, lowSample: s.values.length < 3 };
    });

    // Trend Line (Regression on Medians)
    const regressionPoints = [];
    statResults.forEach((s, i) => {
        if (s.median !== null) regressionPoints.push([i, s.median]);
    });

    let trendData = Array(6).fill(null);
    if (regressionPoints.length >= 2) {
        const result = regression.linear(regressionPoints);
        trendData = labels.map((_, i) => {
            const pred = result.predict(i);
            return pred ? pred[1] : null;
        });
    }

    return { labels, interruptionRates, statResults, trendData };
}

function renderComboChart(chartId, records, metricKey, metricLabel, color) {
    const ctx = document.getElementById(chartId).getContext('2d');
    if (chartInstances[chartId]) chartInstances[chartId].destroy();

    // Get CSS variable color
    const rootStyles = getComputedStyle(document.documentElement);
    const colorSecondary = rootStyles.getPropertyValue('--color-secondary').trim() || '#2BC8E4';
    const colorWarning = rootStyles.getPropertyValue('--color-warning').trim() || '#F59E0B';
    const colorDanger = rootStyles.getPropertyValue('--color-danger').trim() || '#EF4444';
    const textSecondary = rootStyles.getPropertyValue('--text-secondary').trim() || '#4B5563';

    const { labels, interruptionRates, statResults, trendData } = calculateCorrelationStats(records, metricKey);

    // Prepare median data - keep nulls for proper index alignment
    const medianData = statResults.map(s => s.median);

    // Point styling based on sample size (lowSample = warning color)
    const pointBackgroundColors = statResults.map(s => {
        if (s.median === null) return 'transparent';
        return s.lowSample ? colorDanger : colorSecondary;
    });
    const pointBorderColors = statResults.map(s => {
        if (s.median === null) return 'transparent';
        return s.lowSample ? colorDanger : colorSecondary;
    });
    const pointRadii = statResults.map(s => s.median !== null ? 8 : 0);

    chartInstances[chartId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '中断率 (%)',
                    data: interruptionRates,
                    backgroundColor: colorWarning + '22',
                    borderColor: colorWarning,
                    borderWidth: 1,
                    yAxisID: 'y1',
                    order: 3
                },
                {
                    type: 'scatter',
                    label: `${metricLabel} (中央値)`,
                    data: medianData,
                    pointBackgroundColor: pointBackgroundColors,
                    pointBorderColor: pointBorderColors,
                    pointRadius: pointRadii,
                    pointHoverRadius: 10,
                    showLine: true,
                    yAxisID: 'y',
                    order: 2,
                    spanGaps: false
                },
                {
                    type: 'line',
                    label: 'トレンド',
                    data: trendData,
                    borderColor: textSecondary,
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    yAxisID: 'y',
                    order: 1,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'category',
                    title: { display: true, text: '時間帯', color: textSecondary },
                    ticks: { color: textSecondary },
                    grid: { color: textSecondary + '33' }
                },
                y: {
                    beginAtZero: false,
                    min: 1,
                    max: 5,
                    title: { display: true, text: metricLabel, color: textSecondary },
                    position: 'right',
                    ticks: { color: textSecondary },
                    grid: { color: textSecondary + '33' }
                },
                y1: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: '中断率 (%)', color: textSecondary },
                    position: 'left',
                    ticks: { color: textSecondary },
                    grid: { drawOnChartArea: false }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: textSecondary,
                        generateLabels: (chart) => {
                            const defaultLabels = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                            return defaultLabels.map((label, index) => {
                                if (index === 1 && label.text.includes('中央値')) {
                                    const hasLowSample = statResults.some(s => s.median !== null && s.lowSample);
                                    const legendColor = hasLowSample ? colorDanger : colorSecondary;
                                    label.fillStyle = legendColor;
                                    label.strokeStyle = legendColor;
                                }
                                return label;
                            });
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        afterLabel: (context) => {
                            const datasetLabel = context.dataset.label || '';
                            if (datasetLabel.includes('中央値')) {
                                // Use dataIndex for correct lookup
                                const idx = context.dataIndex;
                                if (idx >= 0 && idx < statResults.length && statResults[idx]) {
                                    const s = statResults[idx];
                                    if (s.median === null) return '';
                                    let text = `平均: ${s.mean?.toFixed(2) ?? '-'}, 中央値: ${s.median?.toFixed(2) ?? '-'}, サンプル数: ${s.count}`;
                                    if (s.lowSample) {
                                        text += '\n⚠️ サンプル数が少ないため参考値です';
                                    }
                                    return text;
                                }
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

// Chart 3: Concentration
function renderChart3(records) {
    renderComboChart('chart-3', records, 'concentration', '集中度');
}

// Chart 4: Accomplishment
function renderChart4(records) {
    renderComboChart('chart-4', records, 'accomplishment', '達成感');
}

// Chart 5: Fatigue
function renderChart5(records) {
    renderComboChart('chart-5', records, 'fatigue', '疲労感');
}

// Export Data
document.getElementById('btn-export-data').addEventListener('click', async () => {
    const experimentId = document.getElementById('result-experiment-select').value;
    if (!experimentId) return;

    // Re-fetch or use cached data? For simplicity, re-fetch or assume we have records if we wanted to optimize.
    // Let's re-fetch to be safe and simple.
    try {
        // Fetch experiment details for header info
        const expDoc = await getDoc(doc(db, "experiments", experimentId));
        const expData = expDoc.exists() ? expDoc.data() : { strategy: '', action: '' };

        const q = query(
            collection(db, "records"),
            where("experimentId", "==", experimentId)
        );
        const querySnapshot = await getDocs(q);
        const records = [];
        querySnapshot.forEach(doc => records.push(doc.data()));
        records.sort((a, b) => a.recordedDate.seconds - b.recordedDate.seconds);

        // CSV Generation
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Date,Strategy,Action,CarriedOut,StartedTime,Duration,Interrupted,Reason,Concentration,Accomplishment,Fatigue,Memo\n";

        records.forEach(r => {
            const date = r.recordedDate.toDate().toLocaleDateString();
            const row = [
                date,
                `"${(expData.strategy || '').replace(/"/g, '""')}"`,
                `"${(expData.action || '').replace(/"/g, '""')}"`,
                r.carriedOut ? 'Yes' : 'No',
                r.startedTime || '',
                r.durationTime || '',
                r.interrupted ? 'Yes' : 'No',
                r.interruptionReason || '',
                r.concentration || '',
                r.accomplishment || '',
                r.fatigue || '',
                `"${(r.memo || '').replace(/"/g, '""')}"` // Escape quotes
            ].join(",");
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);

        // Generate filename with current date: experiment_data_YYYY-MM-DD.csv
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const filenameDate = `${yyyy}-${mm}-${dd}`;

        link.setAttribute("download", `experiment_data_${filenameDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (e) {
        console.error("Error exporting data:", e);
        showModal(translations[state.currentLang].common.error);
    }
});

// =========================================
// Validation Helpers
// =========================================
function showValidationError(inputElement, message, timeout) {
    inputElement.classList.add('input-error');

    // Create Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip-error';
    tooltip.textContent = message;

    // Add to parent (form-group)
    const parent = inputElement.parentElement;
    // Check if tooltip already exists
    if (!parent.querySelector('.tooltip-error')) {
        parent.appendChild(tooltip);
        // Ensure parent is relative
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }
    }
    if (timeout) {
        setTimeout(() => clearValidationErrors(), timeout);
    }
}

function clearValidationErrors() {
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    document.querySelectorAll('.tooltip-error').forEach(el => el.remove());
}

// =========================================
// Modal Logic
// =========================================
const modalOverlay = document.getElementById('modal-overlay');
const modalMessage = document.getElementById('modal-message');
const modalCloseBtn = document.getElementById('btn-modal-close');

function showModal(message, isHtml = false) {
    if (isHtml) {
        modalMessage.innerHTML = message;
    } else {
        modalMessage.textContent = message;
    }
    modalMessage.classList.remove('hidden');
    document.getElementById('modal-record-detail').classList.add('hidden');
    modalOverlay.classList.remove('hidden');
}

modalCloseBtn.addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
});

// Close modal on outside click
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
        modalOverlay.classList.add('hidden');
    }
});

// =========================================
// Translation Logic
// =========================================
function applyTranslations(lang) {
    const t = translations[lang];
    if (!t) return;

    // Header
    document.querySelector('.app-title').textContent = t.appTitle;
    navButtons.settings.innerHTML = `<i class="fa-solid fa-flask"></i><span class="nav-text">${t.nav.settings}</span>`;
    navButtons.record.innerHTML = `<i class="fa-solid fa-calendar-check"></i><span class="nav-text">${t.nav.record}</span>`;
    navButtons.results.innerHTML = `<i class="fa-solid fa-chart-line"></i><span class="nav-text">${t.nav.results}</span>`;
    navButtons.library.innerHTML = `<i class="fa-solid fa-book"></i><span class="nav-text">${t.nav.library}</span>`;

    // Settings View
    document.querySelector('#view-settings h2').innerHTML = `<i class="fa-solid fa-flask"></i>${t.settings.title}`;
    document.querySelector('label[for="setting-strategy"]').textContent = t.settings.labels.strategy;
    document.querySelector('label[for="setting-strategy-custom"]').textContent = t.settings.labels.strategyCustom;
    document.querySelector('label[for="setting-action"]').textContent = t.settings.labels.action;
    document.querySelector('label[for="setting-duration"]').textContent = t.settings.labels.duration;
    document.querySelector('label[for="setting-notification"]').textContent = t.settings.labels.notification;

    document.getElementById('setting-strategy-custom').placeholder = t.settings.placeholders.strategyCustom;
    document.getElementById('setting-action').placeholder = t.settings.placeholders.action;

    document.getElementById('btn-save-experiment').innerHTML = `<i class="fa-solid fa-floppy-disk"></i>${t.settings.buttons.save}`;
    document.getElementById('btn-end-experiment').innerHTML = `<i class="fa-solid fa-flag-checkered"></i>${t.settings.buttons.end}`;

    // Record View
    document.querySelector('#view-record h2').innerHTML = `<i class="fa-solid fa-calendar-check"></i>${t.record.title}`;
    // ... (Add more mappings as needed, covering the main labels)
    // Toggle switch labels use .toggle-label span instead of label[for=...]
    document.querySelector('#record-carried-out').closest('.toggle-group').querySelector('.toggle-label').textContent = t.record.labels.carriedOut;
    document.querySelector('label[for="record-started-time"]').textContent = t.record.labels.startedTime;
    document.querySelector('label[for="record-duration"]').textContent = t.record.labels.durationTime;
    document.querySelector('#record-interrupted').closest('.toggle-group').querySelector('.toggle-label').textContent = t.record.labels.interrupted;
    document.querySelector('label[for="record-interruption-reason"]').textContent = t.record.labels.interruptionReason;
    document.querySelector('label[for="record-concentration"]').textContent = t.record.labels.concentration;
    document.querySelector('label[for="record-accomplishment"]').textContent = t.record.labels.accomplishment;
    document.querySelector('label[for="record-fatigue"]').textContent = t.record.labels.fatigue;
    document.querySelector('label[for="record-memo"]').textContent = t.record.labels.memo;

    document.getElementById('btn-save-record').innerHTML = `<i class="fa-solid fa-floppy-disk"></i>${t.record.buttons.save}`;
    document.getElementById('btn-edit-record').innerHTML = `<i class="fa-solid fa-pen"></i>${t.record.buttons.edit}`;

    // Results View
    document.querySelector('#view-results h2').innerHTML = `<i class="fa-solid fa-chart-line"></i>${t.results.title}`;
    document.querySelector('label[for="result-experiment-select"]').textContent = t.results.labels.experimentSelect;
    document.getElementById('btn-export-data').innerHTML = `<i class="fa-solid fa-download"></i>${t.results.buttons.export}`;

    // Library View
    document.querySelector('#view-library h2').innerHTML = `<i class="fa-solid fa-book-open"></i>${t.library.title}`;
    // Note: Library items are details/summary, might need more specific selection if we want to translate them dynamically
    // For now, assuming static HTML matches 'ja' default.
}

// =========================================
// Event Listeners (Navigation)
// =========================================
Object.keys(navButtons).forEach(key => {
    navButtons[key].addEventListener('click', () => {
        // Simple navigation for now, logic might be restricted based on state
        switchView(key);
    });
});

// Start the app
initApp();

// =========================================
// PWA: Service Worker Registration
// =========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}