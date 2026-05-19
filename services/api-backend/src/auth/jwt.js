const jwt = require("jsonwebtoken")
const fs = require("fs")
const path = require("path")

const keysDir = path.join(__dirname, "../../keys")
const PRIVATE_KEY = fs.readFileSync(path.join(keysDir, "private.pem"))
const PUBLIC_KEY  = fs.readFileSync(path.join(keysDir, "public.pem"))

function generarTokens(operador) {
  const accessToken = jwt.sign(
    {
      sub: operador.id,
      username: operador.username,
      zonas_asignadas: operador.zonas_asignadas,
    },
    PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: "15m" }
  )
  const refreshToken = jwt.sign(
    { sub: operador.id, tipo: "refresh" },
    PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: "7d" }
  )
  return { accessToken, refreshToken }
}

function verificarToken(token) {
  return jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"] })
}

module.exports = { generarTokens, verificarToken }
