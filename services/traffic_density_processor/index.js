import fetch from "node-fetch"
import https from "https"
import { Kafka } from "kafkajs"
import amqp from "amqplib"

const AUTH_URL = process.env.AUTH_URL || "https://10.10.0.10/token"
const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.10.0.20:9092"
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://10.10.0.20:5672"

async function getToken() {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: "processor", client_secret: "processor-secret" }),
    agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined
  })
  const data = await res.json()
  return data.access_token
}

async function run() {
  const token = await getToken()
  const kafka = new Kafka({
    brokers: [KAFKA_BROKER],
    sasl: { mechanism: "oauthbearer", oauthBearerProvider: async () => ({ value: token }) }
  })
  const consumer = kafka.consumer({ groupId: "density-processor" })
  await consumer.connect()
  await consumer.subscribe({ topic: "traffic_raw", fromBeginning: false })

  const conn = await amqp.connect(RABBITMQ_URL, { username: "oauth2", password: token })
  const ch = await conn.createChannel()
  await ch.assertExchange("traffic_updates", "fanout", { durable: true })

  await consumer.run({
    eachMessage: async ({ message }) => {
      const m = JSON.parse(message.value.toString())
      const status = m.vehicles > 70 ? "CONGESTIONADA" : "FLUIDA"
      const payload = { zone: m.zone_id || "C", status, ts: Date.now() }
      ch.publish("traffic_updates", "", Buffer.from(JSON.stringify(payload)))
    }
  })
}

run()

