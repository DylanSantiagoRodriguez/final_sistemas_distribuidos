const WebSocket = require("ws")
const { verificarToken } = require("../auth/jwt")

function createWSServer(server) {
  const wss = new WebSocket.Server({ noServer: true })

  server.on("upgrade", (request, socket, head) => {
    try {
      const url = new URL(request.url, "http://localhost")
      const token = url.searchParams.get("token") ||
                    (request.headers.authorization || "").replace("Bearer ", "")
      request.operador = verificarToken(token)
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request))
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
    }
  })

  wss.on("connection", (ws, request) => {
    const operador = request.operador
    ws.zonasActivas = []

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data)
        if (msg.action === "subscribe") {
          // Validate zones against JWT claim — no DB lookup needed
          ws.zonasActivas = msg.zonas.filter(z => operador.zonas_asignadas.includes(z))
          ws.send(JSON.stringify({ tipo: "subscripcion_ok", zonas: ws.zonasActivas }))
        }
      } catch {}
    })

    ws.on("error", () => {})
  })

  function pushEvento(evento) {
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN && ws.zonasActivas.includes(evento.zona)) {
        ws.send(JSON.stringify(evento))
      }
    })
  }

  return { wss, pushEvento }
}

module.exports = { createWSServer }
