const db = require("../db/postgres")

function generarToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function crear(operadorId) {
  const token = generarToken()
  const exp = new Date(Date.now() + 5 * 60 * 1000)
  await db.query(
    "UPDATE operadores SET temp_token = $1, temp_token_exp = $2 WHERE id = $3",
    [token, exp, operadorId]
  )
  return token
}

async function validar(token) {
  if (!token) throw new Error("temp token requerido")
  const result = await db.query(
    "SELECT * FROM operadores WHERE temp_token = $1",
    [token]
  )
  const operador = result.rows[0]
  if (!operador) throw new Error("temp token expirado")
  if (new Date(operador.temp_token_exp) < new Date()) throw new Error("temp token expirado")
  return operador
}

async function eliminar(token) {
  await db.query(
    "UPDATE operadores SET temp_token = NULL, temp_token_exp = NULL WHERE temp_token = $1",
    [token]
  )
}

module.exports = { crear, validar, eliminar }
