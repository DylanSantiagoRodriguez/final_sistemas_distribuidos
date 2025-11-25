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



  let conn = null
  let ch = null

  try {
    console.log("[dashboard] connecting to RabbitMQ…")

    conn = await amqp.connect(RABBITMQ_URL, {
      username: RABBITMQ_USER,
      password: RABBITMQ_PASS
    })

    ch = await conn.createChannel()
    await ch.assertQueue("query_traffic_queue", { durable: true })
    await ch.assertExchange("query_answers", "topic", { durable: true })

    const qAns = await ch.assertQueue("", { exclusive: true })
    await ch.bindQueue(qAns.queue, "query_answers", "#")

    console.log("[dashboard] RabbitMQ connected ✔️")

    // Enviar consulta cada 10s
    setInterval(() => {
      const payload = { zone: ZONE, ts: Date.now() }
      ch.sendToQueue(
        "query_traffic_queue",
        Buffer.from(JSON.stringify(payload)),
        { persistent: true }
      )
    }, 10000)

    // Recibir respuestas
    ch.consume(qAns.queue, (msg) => {
      if (!msg) return
      wss.broadcast(msg.content.toString())
      ch.ack(msg)
    })

  } catch (err) {
    console.error("[dashboard] RabbitMQ NO disponible ❌")
    console.error(err)
    console.log("[dashboard] Continuando solo con WebSocket y HTTP…")
  }

  server.listen(Number(WS_PORT), () =>
    console.log(`[dashboard] listening on :${WS_PORT}`)
  )
}

main()
