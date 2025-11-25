import fetch from "node-fetch"
import https from "https"
import amqp from "amqplib"
import { WebSocketServer } from "ws"

const AUTH_URL = process.env.AUTH_URL || "http://172.31.33.47:8080/token"
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://172.31.6.99:5672"
const WS_PORT = process.env.WS_PORT || 8080

async function run() {
  console.log("[dashboard] starting")
  console.log(`[dashboard] ws port ${WS_PORT}`)
  console.log(`[dashboard] rabbitmq ${RABBITMQ_URL}`)

  // 🟢 USAR SIEMPRE USUARIO/PASS HASTA QUE ACTIVEMOS OAUTH2
  const user = process.env.RABBITMQ_USER || "user"
  const pass = process.env.RABBITMQ_PASS || "user"

  console.log(`[dashboard] connecting with user/pass (${user})`)

  const wss = new WebSocketServer({ port: WS_PORT })

  wss.on("connection", (ws) => {
    console.log(`[dashboard] ws client connected clients=${wss.clients.size}`)
    ws.on("close", () => console.log(`[dashboard] ws client disconnected clients=${wss.clients.size}`))
  })

  const conn = await amqp.connect(`amqp://${user}:${pass}@172.31.6.99:5672`)
  conn.on("error", (e) => console.error("[dashboard] amqp conn error", e))
  conn.on("close", () => console.error("[dashboard] amqp conn closed"))

  const ch = await conn.createChannel()
  ch.on("error", (e) => console.error("[dashboard] amqp channel error", e))

  await ch.assertExchange("traffic_updates", "fanout", { durable: true })
  const q = await ch.assertQueue("", { exclusive: true })
  await ch.bindQueue(q.queue, "traffic_updates", "")

  console.log(`[dashboard] consuming updates from ${q.queue}`)

  ch.consume(q.queue, (msg) => {
    const data = msg ? msg.content.toString() : ""
    if (msg) console.log(`[dashboard] update received clients=${wss.clients.size}`)

    wss.clients.forEach((c) => {
      if (c.readyState === 1) c.send(data)
    })

    if (msg) ch.ack(msg)
  })
}

run().catch((err) => {
  console.error("[dashboard] fatal", err)
  process.exit(1)
})
