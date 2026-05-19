import { Kafka, logLevel } from "kafkajs"
import pg from "pg"

const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.0.2.10:9092"
const PGHOST = process.env.PGHOST || "localhost"
const PGDATABASE = process.env.PGDATABASE || "trafico_db"
const PGUSER = process.env.PGUSER || "postgres"
const PGPASSWORD = process.env.PGPASSWORD || "postgres"

const ZONAS = ["norte", "sur", "centro", "periferico"]

const pool = new pg.Pool({ host: PGHOST, database: PGDATABASE, user: PGUSER, password: PGPASSWORD })

const kafka = new Kafka({ brokers: [KAFKA_BROKER], logLevel: logLevel.WARN })
const consumer = kafka.consumer({ groupId: "traffic-processor", readUncommitted: false })
const producer = kafka.producer()

// Track last event per sensor for anomaly detection
const ultimoEvento = new Map()

async function guardarEvento(evento) {
  await pool.query(
    `INSERT INTO eventos_trafico (sensor_id, zona, tipo_sensor, valor, timestamp)
     VALUES ($1, $2, $3, $4, $5)`,
    [evento.sensor_id, evento.zona, evento.tipo_sensor, JSON.stringify(evento.valor), evento.timestamp]
  )
}

async function detectarAnomalias(evento) {
  const anomalias = []

  if (evento.tipo_sensor === "contador" && typeof evento.valor === "number" && evento.valor > 50) {
    anomalias.push({ tipo: "congestion", severidad: "media" })
  }

  if (evento.tipo_sensor === "semaforo" && evento.valor === "rojo") {
    const prev = ultimoEvento.get(evento.sensor_id)
    if (prev && prev.valor === "rojo" && (Date.now() - prev.ts) > 180000) {
      anomalias.push({ tipo: "accidente", severidad: "alta" })
    }
  }

  for (const [sensorId, data] of ultimoEvento.entries()) {
    if (data.tipo === "camara" && (Date.now() - data.ts) > 30000) {
      anomalias.push({ tipo: "falla_sensor", severidad: "baja", sensor_id: sensorId })
    }
  }

  ultimoEvento.set(evento.sensor_id, {
    valor: evento.valor,
    tipo: evento.tipo_sensor,
    ts: Date.now()
  })

  for (const anomalia of anomalias) {
    const sensorId = anomalia.sensor_id || evento.sensor_id
    await pool.query(
      `INSERT INTO anomalias (sensor_id, zona, tipo_anomalia, severidad, datos_raw)
       VALUES ($1, $2, $3, $4, $5)`,
      [sensorId, evento.zona, anomalia.tipo, anomalia.severidad, JSON.stringify(evento)]
    )
    console.log(`[processor] anomalia zona=${evento.zona} tipo=${anomalia.tipo} sev=${anomalia.severidad}`)

    await producer.send({
      topic: "alertas.admin",
      messages: [{
        value: JSON.stringify({
          tipo: anomalia.tipo,
          zona: evento.zona,
          sensor_id: sensorId,
          severidad: anomalia.severidad,
          timestamp: new Date().toISOString()
        })
      }]
    })
  }
}

async function run() {
  console.log(`[processor] broker=${KAFKA_BROKER} db=${PGHOST}/${PGDATABASE}`)
  await consumer.connect()
  await producer.connect()

  const topics = ZONAS.map(z => `trafico.${z}`)
  await consumer.subscribe({ topics, fromBeginning: false })
  console.log(`[processor] subscribed to ${topics.join(", ")}`)

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const evento = JSON.parse(message.value.toString())
        await guardarEvento(evento)
        await detectarAnomalias(evento)
      } catch (err) {
        console.error("[processor] error", err.message)
      }
    }
  })
}

run().catch(err => {
  console.error("[processor] fatal", err)
  process.exit(1)
})
