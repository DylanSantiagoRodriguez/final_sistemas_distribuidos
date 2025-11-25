import fetch from "node-fetch"
import https from "https"
import amqp from "amqplib"
import { v4 as uuid } from "uuid"

const AUTH_URL = process.env.AUTH_URL || "https://10.10.0.10/token"
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://10.10.0.20:5672"
const ZONE = process.env.ZONE || "C"

async function getToken() {
  const res = await fetch(AUTH_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: "query", client_secret: "query-secret" }), agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined })
  const data = await res.json()
  return data.access_token
}

async function run() {
  console.log("[query] starting")
  console.log(`[query] zone ${ZONE}`)
  console.log(`[query] rabbitmq ${RABBITMQ_URL}`)
  const user = process.env.RABBITMQ_USER || "oauth2"
  const pass = process.env.RABBITMQ_PASS || await getToken()
  console.log(`[query] connecting as ${user}`)
  const conn = await amqp.connect(RABBITMQ_URL, { username: user, password: pass })
  const ch = await conn.createChannel()
  await ch.assertQueue("query_traffic_queue", { durable: true })
  await ch.assertExchange("query_answers", "topic", { durable: true })
  const cid = uuid().slice(0, 8)
  const rk = `query.${cid}`
  const qAns = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(qAns.queue, "query_answers", rk)
  console.log(`[query] waiting answer on ${rk}`)
  ch.consume(qAns.queue, msg => {
    if (!msg) return
    console.log(`[query] received answer`)
    process.stdout.write(msg.content.toString() + "\n")
    ch.ack(msg)
    process.exit(0)
  })
  const payload = { zone: ZONE, replyTo: rk }
  console.log(`[query] sending request`, payload)
  ch.sendToQueue("query_traffic_queue", Buffer.from(JSON.stringify(payload)), { persistent: true })
}

run().catch(err => {
  console.error("[query] fatal", err)
  process.exit(1)
})
