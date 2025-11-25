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
  app.get("/", (req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8")
    res.end(`<!doctype html><html><head><meta charset=\"utf-8\"><title>SmartTraffic</title><style>body{font-family:system-ui,sans-serif;padding:20px}h1{margin:0 0 10px}#conn{margin:6px 0;color:#888}.ok{color:#0a0}.bad{color:#c00}.warn{color:#c90}.card{border:1px solid #ddd;padding:16px;border-radius:8px;max-width:420px}</style></head><body><div class=\"card\"><h1>Zona C</h1><div id=\"conn\">Conectando…</div><div id=\"status\" class=\"warn\">Esperando datos</div><div id=\"ts\" style=\"margin-top:8px;color:#666\"></div></div><script>const ws=new WebSocket('ws://'+location.host);const conn=document.getElementById('conn');const status=document.getElementById('status');const ts=document.getElementById('ts');ws.addEventListener('open',()=>{conn.textContent='Conectado';conn.className='ok'});ws.addEventListener('close',()=>{conn.textContent='Desconectado';conn.className='bad'});ws.addEventListener('error',()=>{conn.textContent='Error';conn.className='bad'});ws.addEventListener('message',(e)=>{try{const m=typeof e.data==='string'?JSON.parse(e.data):e.data;if(!m||m.zone!=='C')return;status.textContent='Estado: '+m.status;status.className=(m.status==='CONGESTIONADA')?'bad':(m.status==='FLUIDA')?'ok':'warn';ts.textContent=new Date(m.ts||Date.now()).toLocaleString()}catch{}}</script></body></html>`)
  })

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