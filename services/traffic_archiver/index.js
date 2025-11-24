import fetch from "node-fetch"
import https from "https"
import { Kafka } from "kafkajs"

const AUTH_URL = process.env.AUTH_URL || "https://10.10.0.10/token"
const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.10.0.20:9092"

async function getToken() {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: "archiver", client_secret: "archiver-secret" }),
    agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined
  })
  const data = await res.json()
  return data.access_token
}

async function run() {
  const token = await getToken()
  const kafka = new Kafka({ brokers: [KAFKA_BROKER], sasl: { mechanism: "oauthbearer", oauthBearerProvider: async () => ({ value: token }) } })
  const consumer = kafka.consumer({ groupId: "traffic-archiver" })
  await consumer.connect()
  await consumer.subscribe({ topic: "traffic_raw", fromBeginning: false })
  await consumer.run({
    eachMessage: async ({ message }) => {
      const m = message.value.toString()
      process.stdout.write(m + "\n")
    }
  })
}

run()

