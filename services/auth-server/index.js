import express from "express"
import jwt from "jsonwebtoken"
import bodyParser from "body-parser"
import cors from "cors"
import fs from "fs"
import https from "https"
import http from "http"

const app = express()
app.use(cors())
app.use(bodyParser.json())

const clients = JSON.parse(fs.readFileSync(new URL("./clients.json", import.meta.url)))
const JWT_SECRET = process.env.JWT_SECRET || "smarttraffic-secret"
const ISSUER = "smarttraffic-auth"
const KEY_ID = process.env.JWT_KEY_ID || "smart-key"

app.post("/token", (req, res) => {
  const { client_id, client_secret } = req.body || {}
  const client = clients[client_id]
  if (!client || client.secret !== client_secret) {
    return res.status(401).json({ error: "invalid_client" })
  }
  const now = Math.floor(Date.now() / 1000)
  const token = jwt.sign(
    { iss: ISSUER, sub: client_id, iat: now, exp: now + 900 },
    JWT_SECRET,
    { algorithm: "HS256", keyid: KEY_ID }
  )
  res.json({ access_token: token, token_type: "Bearer", expires_in: 900 })
})

app.post("/introspect", (req, res) => {
  const { token, client_id, client_secret } = req.body || {}
  const client = clients[client_id]
  if (!client || client.secret !== client_secret) return res.status(401).json({ active: false })
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })
    res.json({ active: true, sub: decoded.sub, exp: decoded.exp })
  } catch {
    res.json({ active: false })
  }
})

app.get("/health", (_, res) => res.json({ ok: true }))

const port = process.env.PORT || 443
const certPath = process.env.TLS_CERT_PATH || "/cert.pem"
const keyPath  = process.env.TLS_KEY_PATH  || "/key.pem"

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app).listen(port)
  console.log(`[auth-server] HTTPS :${port}`)
}

const httpPort = process.env.HTTP_PORT
if (httpPort) {
  http.createServer(app).listen(Number(httpPort))
  console.log(`[auth-server] HTTP :${httpPort}`)
}
