/**
 * Cloud Functions for Firebase - Habit Tracker Push Notifications
 * 
 * This function runs every hour and sends push notifications to users
 * whose notification time matches the current hour (JST).
 */

const { setGlobalOptions } = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const logger = require("firebase-functions/logger");

// Initialize Firebase Admin
initializeApp();

// Set global options
setGlobalOptions({ maxInstances: 10, region: "asia-northeast1" });

// Get Firestore and Messaging instances
const db = getFirestore();
const messaging = getMessaging();

/**
 * Scheduled function that runs every hour to send push notifications.
 * Checks for active experiments with matching notification times
 * and sends notifications to those users.
 * 
 * Schedule: Every hour at minute 0 (JST timezone)
 */
exports.sendScheduledNotifications = onSchedule(
    {
        schedule: "0 * * * *", // Every hour at minute 0
        timeZone: "Asia/Tokyo",
        retryCount: 3,
    },
    async (event) => {
        logger.info("Starting scheduled notification check...");

        try {
            // Get current hour in JST
            const now = new Date();
            const jstHour = now.toLocaleString("en-US", {
                timeZone: "Asia/Tokyo",
                hour: "2-digit",
                hour12: false,
            });
            const currentHour = jstHour.padStart(2, "0");

            logger.info(`Current hour (JST): ${currentHour}:00`);

            // Query for active experiments with matching notification time
            const experimentsRef = db.collection("experiments");
            const activeExperimentsQuery = experimentsRef
                .where("endAt", ">", Timestamp.now());

            const experimentsSnapshot = await activeExperimentsQuery.get();

            if (experimentsSnapshot.empty) {
                logger.info("No active experiments found.");
                return;
            }

            logger.info(`Found ${experimentsSnapshot.size} active experiments.`);

            // Process each experiment
            const notificationPromises = [];

            for (const experimentDoc of experimentsSnapshot.docs) {
                const experiment = experimentDoc.data();
                const notificationTime = experiment.notificationTime; // Format: "HH:MM"

                if (!notificationTime) {
                    continue;
                }

                // Extract hour from notification time
                const notifHour = notificationTime.split(":")[0];

                // Check if current hour matches notification hour
                if (notifHour === currentHour) {
                    const userId = experiment.userId;
                    logger.info(`Notification time match for user: ${userId}`);

                    // Get user's FCM tokens (supports multiple devices)
                    const tokenDoc = await db.collection("userTokens").doc(userId).get();

                    if (!tokenDoc.exists) {
                        logger.warn(`No FCM tokens found for user: ${userId}`);
                        continue;
                    }

                    const tokenData = tokenDoc.data();
                    const fcmTokens = tokenData.fcmTokens || [];

                    if (fcmTokens.length === 0) {
                        logger.warn(`No FCM tokens available for user: ${userId}`);
                        continue;
                    }

                    logger.info(`Sending notification to ${fcmTokens.length} device(s) for user: ${userId}`);

                    // Check if notification was already sent today
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);

                    const notificationLogRef = db.collection("notificationLogs")
                        .doc(`${userId}_${todayStart.toISOString().split("T")[0]}`);

                    const logDoc = await notificationLogRef.get();
                    if (logDoc.exists) {
                        logger.info(`Notification already sent today for user: ${userId}`);
                        continue;
                    }

                    // Send notification to all tokens
                    const invalidTokens = [];
                    const sendPromises = fcmTokens.map(async (fcmToken) => {
                        const message = {
                            token: fcmToken,
                            notification: {
                                title: "習慣改善トラッカー",
                                body: "今日の習慣改善を記録しましょう！",
                            },
                            data: {
                                url: "./index.html?view=record",
                                experimentId: experimentDoc.id,
                            },
                            webpush: {
                                fcmOptions: {
                                    link: "./index.html?view=record",
                                },
                            },
                        };

                        try {
                            const response = await messaging.send(message);
                            logger.info(`Notification sent to device: ${response}`);
                            return { success: true, token: fcmToken };
                        } catch (error) {
                            logger.error(`Error sending to token: ${error.code}`);
                            // If token is invalid, mark for removal
                            if (error.code === "messaging/invalid-registration-token" ||
                                error.code === "messaging/registration-token-not-registered") {
                                invalidTokens.push(fcmToken);
                            }
                            return { success: false, token: fcmToken, error: error.code };
                        }
                    });

                    const results = await Promise.all(sendPromises);
                    const successCount = results.filter(r => r.success).length;

                    // Remove invalid tokens
                    if (invalidTokens.length > 0) {
                        logger.info(`Removing ${invalidTokens.length} invalid token(s) for user: ${userId}`);
                        const { FieldValue } = require("firebase-admin/firestore");
                        await db.collection("userTokens").doc(userId).update({
                            fcmTokens: FieldValue.arrayRemove(...invalidTokens)
                        });
                    }

                    // Log the notification
                    await notificationLogRef.set({
                        userId: userId,
                        experimentId: experimentDoc.id,
                        sentAt: Timestamp.now(),
                        success: successCount > 0,
                        deviceCount: fcmTokens.length,
                        successCount: successCount,
                    });

                    notificationPromises.push(Promise.resolve());
                }
            }

            // Wait for all notifications to complete
            await Promise.all(notificationPromises);

            logger.info(`Notification check completed. Sent ${notificationPromises.length} notifications.`);

        } catch (error) {
            logger.error("Error in sendScheduledNotifications:", error);
            throw error;
        }
    }
);

/**
 * Optional: HTTP endpoint to manually trigger notifications (for testing)
 * Can be removed in production.
 */
const { onRequest } = require("firebase-functions/v2/https");

exports.testNotification = onRequest(
    { region: "asia-northeast1" },
    async (req, res) => {
        // Only allow POST requests
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
            // Get user's FCM tokens (supports multiple devices)
            const tokenDoc = await db.collection("userTokens").doc(userId).get();

            if (!tokenDoc.exists) {
                res.status(404).send("No FCM tokens found for user");
                return;
            }

            const tokenData = tokenDoc.data();
            const fcmTokens = tokenData.fcmTokens || [];

            if (fcmTokens.length === 0) {
                res.status(404).send("No FCM tokens available for user");
                return;
            }

            logger.info(`Sending test notification to ${fcmTokens.length} device(s)`);

            // Send test notification to all tokens
            const results = await Promise.all(fcmTokens.map(async (fcmToken) => {
                const message = {
                    token: fcmToken,
                    notification: {
                        title: "習慣改善トラッカー（テスト）",
                        body: "これはテスト通知です。",
                    },
                    data: {
                        url: "./index.html?view=record",
                    },
                };

                try {
                    const response = await messaging.send(message);
                    logger.info(`Test notification sent: ${response}`);
                    return { success: true, messageId: response };
                } catch (error) {
                    logger.error(`Error sending test notification: ${error.message}`);
                    return { success: false, error: error.message };
                }
            }));

            const successCount = results.filter(r => r.success).length;
            res.status(200).json({
                success: successCount > 0,
                deviceCount: fcmTokens.length,
                successCount: successCount,
                results: results
            });

        } catch (error) {
            logger.error("Error sending test notification:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);