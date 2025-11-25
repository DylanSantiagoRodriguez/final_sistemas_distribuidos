import fetch from "node-fetch"
import https from "https"
import amqp from "amqplib"
import { WebSocketServer } from "ws"

const AUTH_URL = process.env.AUTH_URL || "http://172.31.33.47:8080/token"
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://user:user@10.10.0.20:5672"
const WS_PORT = process.env.WS_PORT || 8080

async function getToken() {
  const res = await fetch(AUTH_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: "dashboard", client_secret: "dashboard-secret" }), agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined })
  const data = await res.json()
  return data.access_token
}

async function run() {
  console.log("[dashboard] starting")
  console.log(`[dashboard] ws port ${WS_PORT}`)
  console.log(`[dashboard] rabbitmq ${RABBITMQ_URL}`)
  const user = process.env.RABBITMQ_USER || "oauth2"
  const pass = process.env.RABBITMQ_PASS || await getToken()
  console.log(`[dashboard] connecting as ${user}`)
  const wss = new WebSocketServer({ port: WS_PORT })
  wss.on("connection", (ws) => {
    console.log(`[dashboard] ws client connected clients=${wss.clients.size}`)
    ws.on("close", () => console.log(`[dashboard] ws client disconnected clients=${wss.clients.size}`))
  })
  const conn = await amqp.connect(RABBITMQ_URL, { username: user, password: pass })
  conn.on("error", (e) => console.error("[dashboard] amqp conn error", e))
  conn.on("close", () => console.error("[dashboard] amqp conn closed"))
  const ch = await conn.createChannel()
  ch.on("error", (e) => console.error("[dashboard] amqp channel error", e))
  await ch.assertExchange("traffic_updates", "fanout", { durable: true })
  const q = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(q.queue, "traffic_updates", "")
  console.log(`[dashboard] consuming updates from ${q.queue}`)
  ch.consume(q.queue, msg => {
    const data = msg ? msg.content.toString() : ""
    if (msg) console.log(`[dashboard] update received clients=${wss.clients.size}`)
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(data) })
    if (wss.clients.size === 0 && msg) console.log(`[dashboard] no ws clients to broadcast`)
    if (msg) ch.ack(msg)
  })
}

run().catch(err => {
  console.error("[dashboard] fatal", err)
  process.exit(1)
})
