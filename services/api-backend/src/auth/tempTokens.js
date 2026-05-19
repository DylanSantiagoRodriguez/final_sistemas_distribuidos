const db = require("../db/postgres")

const store = new Map()

function crear(operadorId) {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  store.set(token, { id: operadorId, exp: Date.now() + 5 * 60 * 1000 })
  return token
}

async function validar(token) {
  const entry = store.get(token)
  if (!entry || entry.exp < Date.now()) throw new Error("temp token expirado")
  const result = await db.query("SELECT * FROM operadores WHERE id = $1", [entry.id])
  if (!result.rows[0]) throw new Error("operador no encontrado")
  return result.rows[0]
}

function eliminar(token) {
  store.delete(token)
}

module.exports = { crear, validar, eliminar }
