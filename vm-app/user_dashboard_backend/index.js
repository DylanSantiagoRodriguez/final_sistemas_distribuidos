const amqp = require("amqplib")
const express = require("express")
const http = require("http")
const { createWebSocketServer } = require("./wsServer")

const WS_PORT = process.env.WS_PORT || 8080
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://172.31.6.99:5672"
const RABBITMQ_USER = process.env.RABBITMQ_USER || "user"
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || "user"
const ZONE = process.env.ZONE || "C"

async function main() {
  const app = express()
  app.use(express.json())
  const server = http.createServer(app)
  const wss = createWebSocketServer(server)
  app.post("/push", (req, res) => { wss.broadcast(req.body || {}); res.json({ ok: true }) })

  const conn = await amqp.connect(RABBITMQ_URL, { username: RABBITMQ_USER, password: RABBITMQ_PASS })
  const ch = await conn.createChannel()
  await ch.assertQueue("query_traffic_queue", { durable: true })
  await ch.assertExchange("query_answers", "topic", { durable: true })
  const qAns = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(qAns.queue, "query_answers", "#")

  setInterval(() => {
    const payload = { zone: ZONE, ts: Date.now() }
    ch.sendToQueue("query_traffic_queue", Buffer.from(JSON.stringify(payload)), { persistent: true })
  }, 10000)

  ch.consume(qAns.queue, (msg) => {
    if (!msg) return
    wss.broadcast(msg.content.toString())
    ch.ack(msg)
  })

  server.listen(Number(WS_PORT))
}

main()