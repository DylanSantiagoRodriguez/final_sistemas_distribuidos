import { WebSocketServer } from "ws"

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server })
  wss.broadcast = (data) => {
    const payload = typeof data === "string" ? data : JSON.stringify(data)
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(payload)
    })
  }
  return wss
}