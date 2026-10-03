const cron = require('node-cron');
const { admin } = require("./firebase-init");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = () => {

    // FCM Wake-Up Service
    class FcmWakeUpService {
        constructor() {
            this.isKeepAliveDisabled = process.env.XMR_BACKEND_DISABLE_FCM === 'true';
            this.isRunning = false;
            this.startScheduler();
        }

        startScheduler() {
            cron.schedule('* * * * *', async () => {
                // Skip a tick instead of stacking runs if the previous
                // broadcast is still in flight.
                if (this.isRunning) {
                    console.warn('FCM wake-up skipped: previous run still in progress');
                    return;
                }

                this.isRunning = true;

                try {
                    await this.wakeUpAllDevice();
                } catch (e) {
                    console.error(`FCM wake-up failed: ${e.message}`);
                } finally {
                    this.isRunning = false;
                }
            });
        }

        async wakeUpAllDevice() {
            if (this.isKeepAliveDisabled) {
                console.debug('FCM keep-alive disabled (set XMR_BACKEND_DISABLE_FCM=false to enable)');
                return;
            }

            await this.broadcastMessageToTopic('all');
            await this.broadcastMessageToTopic('all-2');

            for (let i = 0; i < 10; i++) {
                await this.broadcastMessageToTopic(`topic${i}`);
                await delay(200);
            }
        }

        async broadcastMessageToTopic(topic) {
            const message = {
                data: { data: new Date().toString() },
                topic,
                android: {
                    priority: 'high'
                }
            };

            try {
                await admin.messaging().send(message);
                console.info(`FCM wake-up sent to topic: ${topic}`);
            } catch (e) {
                console.error(`FCM error [${topic}]: ${e.message}`);
            }
        }
    }

    // Start FCM Service

    new FcmWakeUpService();
    console.log('FCM Wake-Up Service initialized');
}
