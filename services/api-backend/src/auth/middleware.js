const { verificarToken } = require("./jwt")

function autenticarJWT(req, res, next) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requerido" })
  }
  try {
    req.operador = verificarToken(auth.slice(7))
    next()
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" })
  }
}

module.exports = { autenticarJWT }
