/**
 * =========================================
 * Cloud Functions - 習慣改善トラッカー
 * =========================================
 * プッシュ通知の定期送信とテスト送信を担当
 * =========================================
 */

// -----------------------------------------
// 依存関係インポート
// -----------------------------------------
const { setGlobalOptions } = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const logger = require("firebase-functions/logger");

// -----------------------------------------
// Firebase 初期化
// -----------------------------------------
initializeApp();
setGlobalOptions({ maxInstances: 10, region: "asia-northeast1" });

const db = getFirestore();
const messaging = getMessaging();

// -----------------------------------------
// 定数定義
// -----------------------------------------
const NOTIFICATION_DEFAULTS = {
    title: "習慣改善トラッカー",
    body: "今日の習慣改善を記録しましょう！",
    url: "./index.html?view=record"
};

const NOTIFICATION_TEST = {
    title: "習慣改善トラッカー（テスト）",
    body: "これはテスト通知です。",
    url: "./index.html?view=record"
};

// 無効なFCMトークンのエラーコード
const INVALID_TOKEN_CODES = [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered"
];

// -----------------------------------------
// ヘルパー関数: ユーザーのFCMトークンを取得
// -----------------------------------------
async function getUserFcmTokens(userId) {
    const tokenDoc = await db.collection("userTokens").doc(userId).get();
    if (!tokenDoc.exists) {
        return null;
    }
    const tokenData = tokenDoc.data();
    return tokenData.fcmTokens || [];
}

// -----------------------------------------
// ヘルパー関数: 通知を送信
// -----------------------------------------
async function sendNotificationToTokens(fcmTokens, notificationData, experimentId = null) {
    const invalidTokens = [];
    const results = await Promise.all(
        fcmTokens.map(async (fcmToken) => {
            const message = {
                token: fcmToken,
                data: {
                    title: notificationData.title,
                    body: notificationData.body,
                    url: notificationData.url,
                    ...(experimentId && { experimentId })
                }
            };

            try {
                const response = await messaging.send(message);
                logger.info(`通知送信成功: ${response}`);
                return { success: true, token: fcmToken, messageId: response };
            } catch (error) {
                logger.error(`通知送信エラー: ${error.code}`);
                if (INVALID_TOKEN_CODES.includes(error.code)) {
                    invalidTokens.push(fcmToken);
                }
                return { success: false, token: fcmToken, error: error.code };
            }
        })
    );

    return { results, invalidTokens };
}

// -----------------------------------------
// ヘルパー関数: 無効なトークンを削除
// -----------------------------------------
async function removeInvalidTokens(userId, invalidTokens) {
    if (invalidTokens.length === 0) return;

    logger.info(`ユーザー ${userId} の無効なトークン ${invalidTokens.length} 件を削除`);
    await db.collection("userTokens").doc(userId).update({
        fcmTokens: FieldValue.arrayRemove(...invalidTokens)
    });
}

// -----------------------------------------
// スケジュール関数: 定期通知送信
// -----------------------------------------
/**
 * 毎時0分に実行され、通知時刻が現在時刻と一致するユーザーに通知を送信
 * タイムゾーン: Asia/Tokyo (JST)
 */
exports.sendScheduledNotifications = onSchedule(
    {
        schedule: "0 * * * *",
        timeZone: "Asia/Tokyo"
    },
    async (event) => {
        logger.info("定期通知チェック開始...");

        try {
            // 現在時刻（JST）を取得
            const now = new Date();
            const jstHour = now.toLocaleString("en-US", {
                timeZone: "Asia/Tokyo",
                hour: "2-digit",
                hour12: false,
            });
            const currentHour = jstHour.padStart(2, "0");
            logger.info(`現在時刻 (JST): ${currentHour}:00`);

            // アクティブな実験を取得
            const experimentsSnapshot = await db.collection("experiments")
                .where("endAt", ">", Timestamp.now())
                .get();

            if (experimentsSnapshot.empty) {
                logger.info("アクティブな実験がありません");
                return;
            }

            logger.info(`アクティブな実験: ${experimentsSnapshot.size} 件`);

            // 各実験を処理
            let notificationCount = 0;

            for (const experimentDoc of experimentsSnapshot.docs) {
                const experiment = experimentDoc.data();
                const notificationTime = experiment.notificationTime;

                if (!notificationTime) continue;

                // 通知時刻が現在時刻と一致するか確認
                const notifHour = notificationTime.split(":")[0];
                if (notifHour !== currentHour) continue;

                const userId = experiment.userId;
                logger.info(`通知時刻一致: ユーザー ${userId}`);

                // FCMトークンを取得
                const fcmTokens = await getUserFcmTokens(userId);
                if (!fcmTokens || fcmTokens.length === 0) {
                    logger.warn(`FCMトークンなし: ユーザー ${userId}`);
                    continue;
                }

                // 今日すでに送信済みか確認
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const logDocId = `${userId}_${todayStart.toISOString().split("T")[0]}`;
                const logDoc = await db.collection("notificationLogs").doc(logDocId).get();

                if (logDoc.exists) {
                    logger.info(`本日送信済み: ユーザー ${userId}`);
                    continue;
                }

                // 通知送信
                logger.info(`通知送信: ${fcmTokens.length} デバイス`);
                const { results, invalidTokens } = await sendNotificationToTokens(
                    fcmTokens,
                    NOTIFICATION_DEFAULTS,
                    experimentDoc.id
                );

                // 無効なトークンを削除
                await removeInvalidTokens(userId, invalidTokens);

                // 送信ログを記録
                const successCount = results.filter(r => r.success).length;
                await db.collection("notificationLogs").doc(logDocId).set({
                    userId,
                    experimentId: experimentDoc.id,
                    sentAt: Timestamp.now(),
                    success: successCount > 0,
                    deviceCount: fcmTokens.length,
                    successCount
                });

                notificationCount++;
            }

            logger.info(`通知チェック完了: ${notificationCount} 件送信`);

        } catch (error) {
            logger.error("定期通知エラー:", error);
            throw error;
        }
    }
);

// -----------------------------------------
// HTTP関数: テスト通知送信（開発用）
// -----------------------------------------
/**
 * 手動でテスト通知を送信するためのHTTPエンドポイント
 * 本番環境では削除を推奨
 */
exports.testNotification = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        // POSTリクエストのみ許可
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }

        const { userId } = req.body;
        if (!userId) {
            res.status(400).send("userId is required");
            return;
        }

        try {
            // FCMトークンを取得
            const fcmTokens = await getUserFcmTokens(userId);
            if (!fcmTokens || fcmTokens.length === 0) {
                res.status(404).send("No FCM tokens found for user");
                return;
            }

            logger.info(`テスト通知送信: ${fcmTokens.length} デバイス`);

            // 通知送信
            const { results } = await sendNotificationToTokens(fcmTokens, NOTIFICATION_TEST);
            const successCount = results.filter(r => r.success).length;

            res.status(200).json({
                success: successCount > 0,
                deviceCount: fcmTokens.length,
                successCount,
                results
            });

        } catch (error) {
            logger.error("テスト通知エラー:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);