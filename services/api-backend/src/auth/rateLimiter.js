const rateLimit = require("express-rate-limit")
const db = require("../db/postgres")
const { validar: validarTempToken } = require("./tempTokens")
const { Kafka } = require("kafkajs")

const kafkaEnabled = process.env.KAFKA_ENABLED !== "false"
let alertProducer = null

if (kafkaEnabled) {
  const kafka = new Kafka({ brokers: [(process.env.KAFKA_BROKER || "10.0.2.10:9092")] })
  alertProducer = kafka.producer()
  alertProducer.connect().catch(err => console.error("[rateLimiter] kafka connect error", err.message))
}

const rateLimiterOTP = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.body.temp_token || req.ip,
  handler: async (req, res) => {
    try {
      const operador = await validarTempToken(req.body.temp_token)
      await db.query("UPDATE operadores SET cuenta_bloqueada = TRUE WHERE id = $1", [operador.id])
      if (alertProducer) {
        await alertProducer.send({
          topic: "alertas.admin",
          messages: [{
            value: JSON.stringify({
              tipo: "bloqueo_cuenta",
              operador_id: operador.id,
              username: operador.username,
              ip: req.ip,
              timestamp: new Date().toISOString(),
              mensaje: "Cuenta bloqueada tras 5 intentos OTP fallidos",
            })
          }]
        })
      }
    } catch (err) {
      console.error("[rateLimiter] error on block:", err.message)
    }
    res.status(429).json({ error: "Cuenta bloqueada por exceso de intentos. Contacte al administrador." })
  }
})

module.exports = { rateLimiterOTP }
