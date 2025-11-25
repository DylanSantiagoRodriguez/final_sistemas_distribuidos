import express from "express";
import http from "http";
import { createWebSocketServer } from "./wsServer.js";

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = createWebSocketServer(server);

app.post("/push", (req, res) => {
    const event = req.body;
    console.log("[dashboard] recibido evento:", event);
    wss.broadcast(event);
    res.json({ ok: true });
});

server.listen(8080, () => {
    console.log("[dashboard] WebSocket server escuchando en puerto 8080");
});
