const express = require("express")
const db = require("../db/postgres")
const { autenticarJWT } = require("../auth/middleware")

const router = express.Router()

// SECURE: prepared statements — zona validated against JWT claim
router.get("/", autenticarJWT, async (req, res) => {
  const { zona, fecha, tipo } = req.query

  if (zona && !req.operador.zonas_asignadas.includes(zona)) {
    return res.status(403).json({ error: "Zona no autorizada" })
  }

  const conditions = []
  const params = []
  if (zona)  { params.push(zona);  conditions.push(`zona = $${params.length}`) }
  if (fecha) { params.push(fecha); conditions.push(`DATE(timestamp) = $${params.length}`) }
  if (tipo)  { params.push(tipo);  conditions.push(`tipo_sensor = $${params.length}`) }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const query = `SELECT id, sensor_id, zona, tipo_sensor, valor, timestamp
                 FROM eventos_trafico ${where}
                 ORDER BY timestamp DESC LIMIT 100`
  try {
    const result = await db.query(query, params)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: "Error de consulta" })
  }
})

module.exports = router
