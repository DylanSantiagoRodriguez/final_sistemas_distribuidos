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
const AUDIENCE = "smarttraffic"

app.post("/token", (req, res) => {
  const { client_id, client_secret } = req.body || {}
  const client = clients[client_id]
  if (!client || client.secret !== client_secret) return res.status(401).json({ error: "invalid_client" })
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: client_id,
    iat: now,
    exp: now + 900,
    scope: (client.scopes || []).join(" ")
  }
  const token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", keyid: KEY_ID })
  res.json({ access_token: token, token_type: "Bearer", expires_in: 900 })
})

app.post("/introspect", (req, res) => {
  const { token, client_id, client_secret } = req.body || {}
  const broker = clients[client_id]
  if (!broker || broker.secret !== client_secret) return res.status(401).json({ active: false })
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })
    res.json({
      active: true,
      iss: decoded.iss,
      aud: decoded.aud,
      sub: decoded.sub,
      exp: decoded.exp,
      scope: decoded.scope
    })
  } catch (e) {
    res.json({ active: false })
  }
})

app.get("/health", (req, res) => res.json({ ok: true }))

app.get("/.well-known/jwks.json", (req, res) => {
  const k = Buffer.from(JWT_SECRET).toString("base64url")
  res.json({ keys: [{ kty: "oct", alg: "HS256", k, kid: KEY_ID }] })
})

const port = process.env.PORT || 443
const certPath = process.env.TLS_CERT_PATH || "/cert.pem"
const keyPath = process.env.TLS_KEY_PATH || "/key.pem"
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const cert = fs.readFileSync(certPath)
  const key = fs.readFileSync(keyPath)
  https.createServer({ key, cert }, app).listen(port)
}
const httpPort = process.env.HTTP_PORT
if (httpPort) {
  http.createServer(app).listen(Number(httpPort))
}
