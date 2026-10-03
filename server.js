require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

require("./firebase-init");
const socketHandler = require("./socketHandler");
const all = require("./all");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ["polling", "websocket"],
    allowEIO3: true,
    pingInterval: 25000,
    pingTimeout: 60000,
    // Drop oversized frames instead of buffering unbounded data.
    maxHttpBufferSize: 1e6,
    // Allow a client to reconnect within this window without losing its
    // rooms/data (and to replay any missed packets).
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
    }
});

app.disable("x-powered-by");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));


app.get("/", (req, res) => {
    res.send("Server Running");
});

app.get("/health", (req, res) => {

    res.json({
        success: true,
        socketClients: io.engine.clientsCount,
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

socketHandler(io);

all();


const PORT = process.env.PORT || 3000;

server.on("error", (err) => {
    console.error("HTTP server error:", err);
});

server.listen(PORT, () => {

    console.log("====================================");
    console.log(" Server Started");
    console.log(" Port :", PORT);
    console.log("====================================");

});


// Keep the process alive and observable instead of crashing on stray async
// errors. The socket layer already reports failures per-operation; these are
// a last-resort safety net.
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
});


// Graceful shutdown so in-flight requests and reconnecting clients are not
// dropped abruptly during deploys/restarts.
let isShuttingDown = false;

function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`${signal} received. Shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
        console.error("Graceful shutdown timed out. Forcing exit.");
        process.exit(1);
    }, 10000);

    forceExitTimer.unref();

    io.close(() => {
        server.close(() => {
            console.log("HTTP server closed.");
            process.exit(0);
        });
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
