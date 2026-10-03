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
    pingTimeout: 60000
});


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

server.listen(PORT, () => {

    console.log("====================================");
    console.log(" Server Started");
    console.log(" Port :", PORT);
    console.log("====================================");

});