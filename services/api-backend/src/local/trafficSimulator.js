const db = require("../db/postgres")

const ZONAS = ["norte", "sur", "centro", "periferico"]
const SENSOR_TYPES = ["contador", "camara"]
const SIGNAL_PHASES = [
  {
    name: "vertical-green",
    durationMs: 7000,
    signals: { norte: "verde", sur: "verde", centro: "rojo", periferico: "rojo" }
  },
  {
    name: "vertical-yellow",
    durationMs: 1000,
    signals: { norte: "amarillo", sur: "amarillo", centro: "rojo", periferico: "rojo" }
  },
  {
    name: "horizontal-green",
    durationMs: 7000,
    signals: { norte: "rojo", sur: "rojo", centro: "verde", periferico: "verde" }
  },
  {
    name: "horizontal-yellow",
    durationMs: 1000,
    signals: { norte: "rojo", sur: "rojo", centro: "amarillo", periferico: "amarillo" }
  }
]

const zoneState = Object.fromEntries(
  ZONAS.map((zona, index) => [
    zona,
    {
      vehicles: 14 + index * 4,
      camera: "fluido",
      signal: SIGNAL_PHASES[0].signals[zona]
    }
  ])
)

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function updateTrafficState(sequence, zona) {
  const current = zoneState[zona]
  const zoneIndex = ZONAS.indexOf(zona)
  const wave = Math.sin((sequence + zoneIndex * 3) / 4) * 5
  const drift = Math.round((Math.random() - 0.5) * 6)
  current.vehicles = clamp(Math.round(current.vehicles + drift + wave * 0.25), 8, 38)

  if (current.vehicles >= 34 && Math.random() < 0.12) {
    current.camera = "congestionado"
  } else if (process.env.LOCAL_TRAFFIC_ACCIDENTS === "true" && Math.random() < 0.01) {
    current.camera = "accidente"
  } else {
    current.camera = "fluido"
  }

  return current
}

function trafficEvent(zona, tipo) {
  const current = zoneState[zona]
  return {
    sensor_id: `local-${zona}-${tipo}`,
    zona,
    tipo_sensor: tipo,
    timestamp: new Date().toISOString(),
    valor: tipo === "contador" ? current.vehicles : current.camera
  }
}

function signalEvent(zona, signal) {
  zoneState[zona].signal = signal
  return {
    sensor_id: `local-${zona}-semaforo`,
    zona,
    tipo_sensor: "semaforo",
    timestamp: new Date().toISOString(),
    valor: signal
  }
}

async function saveEvent(evento) {
  await db.query(
    `INSERT INTO eventos_trafico (sensor_id, zona, tipo_sensor, valor, timestamp)
     VALUES ($1, $2, $3, $4, $5)`,
    [evento.sensor_id, evento.zona, evento.tipo_sensor, JSON.stringify(evento.valor), evento.timestamp]
  )
}

async function publishEvents(events, pushEvento) {
  for (const evento of events) {
    try {
      await saveEvent(evento)
      pushEvento(evento)
    } catch (err) {
      console.error("[local-traffic] event error:", err.message)
    }
  }
}

function startLocalTrafficSimulator(pushEvento) {
  const trafficIntervalMs = Math.max(Number(process.env.LOCAL_TRAFFIC_INTERVAL_MS || 5000), 5000)
  let sequence = 0
  let phaseIndex = -1

  function publishCurrentSignalPhase() {
    phaseIndex = (phaseIndex + 1) % SIGNAL_PHASES.length
    const phase = SIGNAL_PHASES[phaseIndex]
    publishEvents(ZONAS.map(zona => signalEvent(zona, phase.signals[zona])), pushEvento)
    signalTimer = setTimeout(publishCurrentSignalPhase, phase.durationMs)
  }

  const trafficTimer = setInterval(() => {
    for (const zona of ZONAS) updateTrafficState(sequence, zona)
    sequence += 1
    const events = ZONAS.flatMap(zona => SENSOR_TYPES.map(tipo => trafficEvent(zona, tipo)))
    publishEvents(events, pushEvento)
  }, trafficIntervalMs)

  let signalTimer = null
  publishCurrentSignalPhase()

  console.log(`[local-traffic] enabled traffic_interval=${trafficIntervalMs}ms yellow=1000ms phases=vertical|horizontal max_vehicles=38`)
  return () => {
    clearInterval(trafficTimer)
    if (signalTimer) clearTimeout(signalTimer)
  }
}

module.exports = { startLocalTrafficSimulator }
