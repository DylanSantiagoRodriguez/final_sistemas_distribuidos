const express = require("express")
const http = require("http")
const cookieParser = require("cookie-parser")
const cors = require("cors")

const authRoutes = require("./routes/auth")
const { autenticarJWT } = require("./auth/middleware")
const { createWSServer } = require("./websocket/server")
const { startKafkaConsumer } = require("./kafka/consumer")

const SQLI_DEMO = process.env.SQLI_DEMO === "true"
const historicoRoutes = SQLI_DEMO
  ? require("./routes/historico.insecure")
  : require("./routes/historico")

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(cookieParser())
app.use(express.json())

app.use("/auth", authRoutes)
app.use("/api/historico", historicoRoutes)

app.get("/health", (_, res) => res.json({ ok: true, sqli_demo: SQLI_DEMO }))

const server = http.createServer(app)
const { pushEvento } = createWSServer(server)

startKafkaConsumer(pushEvento).catch(err => {
  console.error("[kafka] startup error:", err.message)
})

const PORT = Number(process.env.PORT) || 3000
server.listen(PORT, () =>
  console.log(`[api-backend] :${PORT} sqli_demo=${SQLI_DEMO}`)
)
