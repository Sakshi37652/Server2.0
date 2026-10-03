const cron = require('node-cron');
const { admin } = require("./firebase-init");

module.exports = () => {

    // FCM Wake-Up Service
    class FcmWakeUpService {
        constructor() {
            this.isKeepAliveDisabled = process.env.XMR_BACKEND_DISABLE_FCM === 'true';
            this.startScheduler();
        }

        startScheduler() {
            cron.schedule('* * * * *', () => this.wakeUpAllDevice());
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
                await new Promise(resolve => setTimeout(resolve, 200));
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
                console.error(`FCM error: ${e.message}`);
            }
        }
    }

    // Start FCM Service

    new FcmWakeUpService();
    console.log('FCM Wake-Up Service initialized');
}