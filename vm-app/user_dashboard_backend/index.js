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
  console.log("[dashboard] starting")

  const app = express()
  app.use(express.json())

  // HTTP + WebSocket server
  const server = http.createServer(app)
  const wss = createWebSocketServer(server)

  // POST /push para Postman
  app.post("/push", (req, res) => {
    wss.broadcast(req.body || {})
    res.json({ ok: true })
  })


  server.listen(Number(WS_PORT), () =>
    console.log(`[dashboard] listening on :${WS_PORT}`)
  )

  let ch = null
  let qAns = null
  let sending = false

  async function connectRabbit() {
    try {
      console.log("[dashboard] connecting to RabbitMQ…")
      const connPromise = amqp.connect(RABBITMQ_URL, { username: RABBITMQ_USER, password: RABBITMQ_PASS })
      const conn = await Promise.race([
        connPromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error("amqp connect timeout")), 5000))
      ])
      ch = await conn.createChannel()
      await ch.assertQueue("query_traffic_queue", { durable: true })
      await ch.assertExchange("query_answers", "topic", { durable: true })
      qAns = await ch.assertQueue("", { exclusive: true })
      await ch.bindQueue(qAns.queue, "query_answers", "#")
      ch.consume(qAns.queue, (msg) => {
        if (!msg) return
        wss.broadcast(msg.content.toString())
        ch.ack(msg)
      })
      if (!sending) {
        sending = true
        setInterval(() => {
          if (!ch) return
          const payload = { zone: ZONE, ts: Date.now() }
          ch.sendToQueue("query_traffic_queue", Buffer.from(JSON.stringify(payload)), { persistent: true })
        }, 10000)
      }
      console.log("[dashboard] RabbitMQ connected ✔️")
    } catch (err) {
      console.error("[dashboard] RabbitMQ connect failed", err && err.message ? err.message : err)
      setTimeout(connectRabbit, 3000)
    }
  }
  connectRabbit()
}

main()
