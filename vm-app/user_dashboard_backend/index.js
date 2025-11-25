const amqp = require("amqplib")
const express = require("express")
const http = require("http")
const https = require("https")
const axios = require("axios")
const { createWebSocketServer } = require("./wsServer")

const WS_PORT = process.env.WS_PORT || 8080
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://172.31.6.99:5672"
const RABBITMQ_USER = process.env.RABBITMQ_USER || "dylan"
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || "dylan"
const ZONE = process.env.ZONE || "C"
const AUTH_URL = process.env.AUTH_URL || "https://172.31.35.24/token"
const ALLOW_INSECURE_TLS = String(process.env.ALLOW_INSECURE_TLS || "false").toLowerCase() === "true"
const QUIET = String(process.env.QUIET || "true").toLowerCase() === "true"
const log = (...a) => { if (!QUIET) console.log(...a) }
const error = (...a) => { if (!QUIET) console.error(...a) }

async function main() {
  log("[dashboard] starting")

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
    log(`[dashboard] listening on :${WS_PORT}`)
  )

  let last = null
  let ch = null
  let qAns = null
  let sending = false

  async function connectRabbit() {
    try {
      log("[dashboard] connecting to RabbitMQ…")
      const opts = {}
      if (ALLOW_INSECURE_TLS) opts.httpsAgent = new https.Agent({ rejectUnauthorized: false })
      const tokRes = await axios.post(AUTH_URL, { client_id: "dashboard", client_secret: "dashboard-secret" }, opts)
      const token = tokRes.data && tokRes.data.access_token ? tokRes.data.access_token : ""
      const urlBase = RABBITMQ_URL.replace(/amqp:\/\/[^@]+@/, "amqp://")
      const connPromise = amqp.connect(urlBase, { username: "oauth2", password: token })
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
        last = msg.content.toString()
        wss.broadcast(last)
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
      log("[dashboard] RabbitMQ connected ✔️")
    } catch (err) {
      error("[dashboard] RabbitMQ connect failed", err && err.message ? err.message : err)
      setTimeout(connectRabbit, 3000)
    }
  }
  connectRabbit()

  app.get("/latest", (req, res) => {
    if (!last) return res.status(404).json({ error: "no_data" })
    try {
      const obj = typeof last === "string" ? JSON.parse(last) : last
      res.json(obj)
    } catch {
      res.setHeader("content-type", "application/json")
      res.end(last)
    }
  })

  app.get("/query", async (req, res) => {
    if (!ch) return res.status(503).json({ error: "unavailable" })
    const zone = req.query.zone || ZONE
    const cid = Math.random().toString(16).slice(2, 10)
    const rk = `query.ws.${cid}`
    const tmp = await ch.assertQueue("", { exclusive: true })
    await ch.bindQueue(tmp.queue, "query_answers", rk)
    const timer = setTimeout(async () => {
      await ch.deleteQueue(tmp.queue)
      res.status(504).json({ error: "timeout" })
    }, 5000)
    ch.consume(tmp.queue, async (msg) => {
      if (!msg) return
      clearTimeout(timer)
      const data = msg.content.toString()
      wss.broadcast(data)
      ch.ack(msg)
      await ch.deleteQueue(tmp.queue)
      res.setHeader("content-type", "application/json")
      res.end(data)
    }, { noAck: false })
    const payload = { zone, replyTo: rk }
    ch.sendToQueue("query_traffic_queue", Buffer.from(JSON.stringify(payload)), { persistent: true })
  })
}

main()
