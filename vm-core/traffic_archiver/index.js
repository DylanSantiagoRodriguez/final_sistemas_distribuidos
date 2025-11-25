import { Kafka, logLevel } from "kafkajs"

const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.10.0.20:9092"

async function run() {
  console.log("[archiver] starting")
  console.log(`[archiver] kafka broker ${KAFKA_BROKER}`)
  const kafka = new Kafka({ brokers: [KAFKA_BROKER], logLevel: logLevel.INFO })
  const consumer = kafka.consumer({ groupId: "traffic-archiver" })
  console.log("[archiver] connecting consumer")
  await consumer.connect()
  console.log("[archiver] subscribed to topic traffic_raw")
  await consumer.subscribe({ topic: "traffic_raw", fromBeginning: false })
  await consumer.run({
    eachMessage: async ({ message, topic, partition }) => {
      const m = message.value.toString()
      console.log(`[archiver] message ${topic}[${partition}] offset=${message.offset}`)
      process.stdout.write(m + "\n")
    }
  })
}

run().catch(err => {
  console.error("[archiver] fatal", err)
  process.exit(1)
})

