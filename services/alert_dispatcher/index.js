import fetch from "node-fetch"
import https from "https"
import amqp from "amqplib"

const AUTH_URL = process.env.AUTH_URL || "https://10.10.0.10/token"
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://10.10.0.20:5672"

async function getToken() {
  const res = await fetch(AUTH_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: "dispatcher", client_secret: "dispatcher-secret" }), agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined })
  const data = await res.json()
  return data.access_token
}

async function run() {
  const user = process.env.RABBITMQ_USER || "oauth2"
  const pass = process.env.RABBITMQ_PASS || await getToken()
  const conn = await amqp.connect(RABBITMQ_URL, { username: user, password: pass })
  const ch = await conn.createChannel()
  await ch.assertExchange("traffic_updates", "fanout", { durable: true })
  await ch.assertExchange("query_answers", "topic", { durable: true })
  await ch.assertQueue("query_traffic_queue", { durable: true })
  const qUpdates = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(qUpdates.queue, "traffic_updates", "")
  const state = new Map()
  ch.consume(qUpdates.queue, msg => {
    if (!msg) return
    const m = JSON.parse(msg.content.toString())
    state.set(m.zone, m.status)
    ch.ack(msg)
  })
  ch.consume("query_traffic_queue", async msg => {
    if (!msg) return
    const q = JSON.parse(msg.content.toString())
    const zone = q.zone
    const answer = { zone, status: state.get(zone) || "DESCONOCIDA", ts: Date.now() }
    const rk = q.replyTo || "query.default"
    ch.publish("query_answers", rk, Buffer.from(JSON.stringify(answer)))
    ch.ack(msg)
  })
}

run()
