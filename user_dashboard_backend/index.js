import fetch from "node-fetch"
import https from "https"
import amqp from "amqplib"
import { WebSocketServer } from "ws"

const AUTH_URL = process.env.AUTH_URL || "http://172.31.33.47:8080/token"
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://10.10.0.20:5672"
const WS_PORT = process.env.WS_PORT || 8080

async function getToken() {
  const res = await fetch(AUTH_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: "dashboard", client_secret: "dashboard-secret" }), agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined })
  const data = await res.json()
  return data.access_token
}

async function run() {
  const user = process.env.RABBITMQ_USER || "oauth2"
  const pass = process.env.RABBITMQ_PASS || await getToken()
  const wss = new WebSocketServer({ port: WS_PORT })
  const conn = await amqp.connect(RABBITMQ_URL, { username: user, password: pass })
  const ch = await conn.createChannel()
  await ch.assertExchange("traffic_updates", "fanout", { durable: true })
  const q = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(q.queue, "traffic_updates", "")
  ch.consume(q.queue, msg => {
    const data = msg ? msg.content.toString() : ""
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(data) })
    if (msg) ch.ack(msg)
  })
}

run()
