const WebSocket = require("ws")

function createWebSocketServer(server) {
    const wss = new WebSocket.Server({ server })
    wss.broadcast = function (data) {
        const payload = typeof data === "string" ? data : JSON.stringify(data)
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload) })
    }
    return wss
}

module.exports = { createWebSocketServer }
