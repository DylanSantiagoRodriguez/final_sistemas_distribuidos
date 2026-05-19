import { Kafka } from "kafkajs"

const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.0.2.10:9092"
const NODE_ENV = process.env.NODE_ENV || "production"
const INTERVAL_MS = NODE_ENV === "staging" ? 10000 : 200
const SENSOR_ID = process.env.SENSOR_ID || `sensor-${Date.now().toString(36)}`

const ZONAS = ["norte", "sur", "centro", "periferico"]
const TIPOS = ["camara", "contador", "semaforo"]

function generarEvento(sensorId, zona, tipo) {
  return {
    sensor_id: sensorId,
    zona,
    tipo_sensor: tipo,
    timestamp: new Date().toISOString(),
    valor:
      tipo === "contador" ? Math.floor(Math.random() * 100) :
      tipo === "semaforo" ? ["rojo", "verde", "amarillo"][Math.floor(Math.random() * 3)] :
      { estado: "activo", fps: 30 },
    metadata: {
      interseccion: `INT-${zona.toUpperCase()}-${Math.floor(Math.random() * 20) + 1}`
    }
  }
}

async function run() {
  console.log(`[sensor] mode=${NODE_ENV} interval=${INTERVAL_MS}ms broker=${KAFKA_BROKER} id=${SENSOR_ID}`)

  const kafka = new Kafka({ brokers: [KAFKA_BROKER] })
  const producer = kafka.producer({
    transactionalId: `sensor-productor-${SENSOR_ID}`,
    maxInFlightRequests: 1,
    idempotent: true,
  })
  await producer.connect()
  console.log("[sensor] connected")

  const sensors = ZONAS.flatMap(zona => TIPOS.map(tipo => ({ zona, tipo })))
  let idx = 0

  const interval = setInterval(async () => {
    const { zona, tipo } = sensors[idx % sensors.length]
    idx++
    const sensorId = `${SENSOR_ID}-${zona}-${tipo}`
    const evento = generarEvento(sensorId, zona, tipo)

    const transaction = await producer.transaction()
    try {
      await transaction.send({
        topic: `trafico.${zona}`,
        messages: [{ key: sensorId, value: JSON.stringify(evento) }]
      })
      await transaction.send({
        topic: `sensor.${tipo}`,
        messages: [{ key: sensorId, value: JSON.stringify(evento) }]
      })
      await transaction.commit()
    } catch (err) {
      await transaction.abort()
      console.error("[sensor] tx abort", err.message)
    }
  }, INTERVAL_MS)

  const shutdown = async () => {
    clearInterval(interval)
    await producer.disconnect()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

run().catch(err => {
  console.error("[sensor] fatal", err)
  process.exit(1)
})
