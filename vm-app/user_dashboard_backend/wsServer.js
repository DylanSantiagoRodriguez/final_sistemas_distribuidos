import WebSocket from "ws";

export function createWebSocketServer(server) {
    const wss = new WebSocket.Server({ server });

    wss.broadcast = (data) => {
        for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        }
    };

    return wss;
}
