const db = require("../db/postgres")

const ZONAS = ["norte", "sur", "centro", "periferico"]
const TIPOS = ["contador", "camara", "semaforo"]
const CAMERA_STATES = ["fluido", "congestionado", "accidente"]
const SIGNAL_STATES = ["verde", "amarillo", "rojo"]

function pick(values) {
  return values[Math.floor(Math.random() * values.length)]
}

function buildEvent(sequence, zona, tipo) {
  const base = {
    sensor_id: `local-${zona}-${tipo}`,
    zona,
    tipo_sensor: tipo,
    timestamp: new Date().toISOString()
  }

  if (tipo === "contador") {
    return { ...base, valor: Math.floor(15 + Math.random() * 85) }
  }

  if (tipo === "camara") {
    return { ...base, valor: pick(CAMERA_STATES) }
  }

  return { ...base, valor: SIGNAL_STATES[(sequence + ZONAS.indexOf(zona)) % SIGNAL_STATES.length] }
}

async function saveEvent(evento) {
  await db.query(
    `INSERT INTO eventos_trafico (sensor_id, zona, tipo_sensor, valor, timestamp)
     VALUES ($1, $2, $3, $4, $5)`,
    [evento.sensor_id, evento.zona, evento.tipo_sensor, JSON.stringify(evento.valor), evento.timestamp]
  )
}

function startLocalTrafficSimulator(pushEvento) {
  const intervalMs = Number(process.env.LOCAL_TRAFFIC_INTERVAL_MS || 1000)
  let sequence = 0

  const interval = setInterval(async () => {
    const events = ZONAS.flatMap(zona => TIPOS.map(tipo => buildEvent(sequence, zona, tipo)))
    sequence += 1

    for (const evento of events) {
      try {
        await saveEvent(evento)
        pushEvento(evento)
      } catch (err) {
        console.error("[local-traffic] event error:", err.message)
      }
    }
  }, Math.max(intervalMs, 250))

  console.log(`[local-traffic] enabled interval=${Math.max(intervalMs, 250)}ms`)
  return () => clearInterval(interval)
}

module.exports = { startLocalTrafficSimulator }
