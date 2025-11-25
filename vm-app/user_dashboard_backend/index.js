const express = require("express");
const http = require("http");
const { createWebSocketServer } = require("./wsServer");

const app = express();
app.use(express.json());

// Crear servidor HTTP
const server = http.createServer(app);

// Crear WebSocket server sobre el mismo HTTP
const wss = createWebSocketServer(server);

// Endpoint para recibir eventos desde query_client
app.post("/push", (req, res) => {
    const event = req.body;
    console.log("[dashboard] recibido evento:", event);

    wss.broadcast(event);

    res.json({ ok: true });
});

server.listen(8080, () => {
    console.log("[dashboard] WebSocket escuchando en puerto 8080");
});
