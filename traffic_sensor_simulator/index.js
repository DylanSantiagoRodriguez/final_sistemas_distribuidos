import fetch from "node-fetch"
import https from "https"
import { Kafka } from "kafkajs"

const AUTH_URL = process.env.AUTH_URL || "https://10.10.0.10/token"
const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.10.0.20:9092"

async function getToken() {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: "sensor", client_secret: "sensor-secret" }),
    agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined
  })
  const data = await res.json()
  return data.access_token
}

async function run() {
  const token = await getToken()
  const kafka = new Kafka({
    brokers: [KAFKA_BROKER],
    sasl: {
      mechanism: "oauthbearer",
      oauthBearerProvider: async () => ({ value: token })
    }
  })
  const producer = kafka.producer()
  await producer.connect()
  setInterval(async () => {
    const payload = { zone_id: "C", vehicles: Math.floor(Math.random() * 100), ts: Date.now() }
    await producer.send({ topic: "traffic_raw", messages: [{ value: JSON.stringify(payload) }] })
  }, 5000)
}

run()

