const { Kafka, logLevel } = require("kafkajs")

const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.0.2.10:9092"
const ZONAS = ["norte", "sur", "centro", "periferico"]

async function startKafkaConsumer(pushEvento) {
  const kafka = new Kafka({ brokers: [KAFKA_BROKER], logLevel: logLevel.WARN })
  const consumer = kafka.consumer({ groupId: "api-backend-ws", readUncommitted: false })

  await consumer.connect()
  await consumer.subscribe({ topics: ZONAS.map(z => `trafico.${z}`), fromBeginning: false })

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const evento = JSON.parse(message.value.toString())
        pushEvento(evento)
      } catch {}
    }
  })

  console.log("[kafka-consumer] started, topics:", ZONAS.map(z => `trafico.${z}`).join(", "))
  return consumer
}

module.exports = { startKafkaConsumer }
