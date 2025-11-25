import fetch from "node-fetch"
import https from "https"
import amqp from "amqplib"
import { WebSocketServer } from "ws"

const AUTH_URL = process.env.AUTH_URL || "http://172.31.33.47:8080/token"
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || "172.31.6.99"
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672
const WS_PORT = process.env.WS_PORT || 8080

async function getToken() {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: "dashboard",
      client_secret: "dashboard-secret"
    }),
    agent: process.env.ALLOW_INSECURE_TLS
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined
  })
  const data = await res.json()
  return data.access_token
}

async function run() {
  console.log("[dashboard] starting")
  console.log(`[dashboard] ws port ${WS_PORT}`)
  console.log(`[dashboard] rabbitmq ${RABBITMQ_HOST}:${RABBITMQ_PORT}`)

  // 1. Obtener token JWT
  const token = await getToken()
  console.log(`[dashboard] token obtained`)

  // 2. Iniciar WebSocket Server
  const wss = new WebSocketServer({ port: WS_PORT })
  wss.on("connection", (ws) => {
    console.log(`[dashboard] ws client connected clients=${wss.clients.size}`)
    ws.on("close", () =>
      console.log(`[dashboard] ws client disconnected clients=${wss.clients.size}`)
    )
  })

  // 3. Conectar RabbitMQ con OAuth2
  console.log("[dashboard] connecting with OAuth2…")

  const conn = await amqp.connect({
    protocol: "amqp",
    hostname: RABBITMQ_HOST,
    port: RABBITMQ_PORT,
    username: "oauth2",
    password: token,
    authMechanism: ["OAUTH2"]
  })

  conn.on("error", (e) => console.error("[dashboard] amqp conn error", e))
  conn.on("close", () => console.error("[dashboard] amqp conn closed"))

  const ch = await conn.createChannel()
  ch.on("error", (e) => console.error("[dashboard] amqp channel error", e))

  // 4. Suscribirse al exchange traffic_updates
  await ch.assertExchange("traffic_updates", "fanout", { durable: true })
  
  const q = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(q.queue, "traffic_updates", "")

  console.log(`[dashboard] consuming updates from ${q.queue}`)

  // 5. Consumir y reenviar por WebSocket
  ch.consume(q.queue, (msg) => {
    if (!msg) return

    const data = msg.content.toString()
    console.log(`[dashboard] update received: ${data}`)

    // Enviar a todos los clientes
    wss.clients.forEach((c) => {
      if (c.readyState === 1) c.send(data)
    })

    if (wss.clients.size === 0) {
      console.log(`[dashboard] no ws clients to broadcast`)
    }

    ch.ack(msg)
  })
}

run().catch((err) => {
  console.error("[dashboard] fatal", err)
  process.exit(1)
})
