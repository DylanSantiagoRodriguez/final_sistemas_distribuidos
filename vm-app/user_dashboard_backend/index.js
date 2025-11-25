import amqp from "amqplib"
import express from "express"
import http from "http"
import { createWebSocketServer } from "./wsServer.js"

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://172.31.6.99:5672"
const WS_PORT = process.env.WS_PORT || 8080

async function run() {
  console.log("[dashboard] starting")
  console.log(`[dashboard] ws port ${WS_PORT}`)
  console.log(`[dashboard] rabbitmq ${RABBITMQ_URL}`)
  const user = process.env.RABBITMQ_USER || "user"
  const pass = process.env.RABBITMQ_PASS || "user"
  console.log(`[dashboard] connecting with user/pass (${user})`)

  const app = express()
  app.use(express.json())
  const server = http.createServer(app)
  const wss = createWebSocketServer(server)
  app.post("/push", (req, res) => {
    wss.broadcast(req.body || {})
    res.json({ ok: true })
  })

  const conn = await amqp.connect(RABBITMQ_URL, { username: user, password: pass })
  conn.on("error", (e) => console.error("[dashboard] amqp conn error", e))
  conn.on("close", () => console.error("[dashboard] amqp conn closed"))

  const ch = await conn.createChannel()
  ch.on("error", (e) => console.error("[dashboard] amqp channel error", e))

  await ch.assertExchange("query_answers", "topic", { durable: true })
  const qAns = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(qAns.queue, "query_answers", "#")
  console.log(`[dashboard] consuming query answers from ${qAns.queue}`)
  ch.consume(qAns.queue, (msg) => {
    if (!msg) return
    const data = msg.content.toString()
    wss.broadcast(data)
    ch.ack(msg)
  })

  server.listen(Number(WS_PORT), () => {
    console.log(`[WS] WebSocket server listening on ${WS_PORT}`)
  })
}

run().catch((err) => {
  console.error("[dashboard] fatal", err)
  process.exit(1)
})
