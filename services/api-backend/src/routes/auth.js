const express = require("express")
const bcrypt = require("bcryptjs")
const db = require("../db/postgres")
const { generarTokens, verificarToken } = require("../auth/jwt")
const { autenticarJWT } = require("../auth/middleware")
const { rateLimiterOTP } = require("../auth/rateLimiter")
const tempTokens = require("../auth/tempTokens")
const { enviarOTP, verificarOTP } = require("../auth/emailOtp")

const router = express.Router()

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body || {}
  if (!username || !email || !password) {
    return res.status(400).json({ error: "username, email y password son requeridos" })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "password debe tener al menos 6 caracteres" })
  }
  try {
    const password_hash = bcrypt.hashSync(password, 10)
    const result = await db.query(
      `INSERT INTO operadores (username, password_hash, email, totp_habilitado, zonas_asignadas)
       VALUES ($1, $2, $3, TRUE, ARRAY['norte','sur','centro','periferico'])
       RETURNING id, username, email`,
      [username, password_hash, email]
    )
    res.status(201).json({ ok: true, operador: result.rows[0] })
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "El usuario ya existe" })
    }
    console.error("[auth] register error", err.message)
    res.status(500).json({ error: "Error interno" })
  }
})

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {}
  try {
    const result = await db.query("SELECT * FROM operadores WHERE username = $1", [username])
    const operador = result.rows[0]
    if (!operador || !bcrypt.compareSync(password, operador.password_hash)) {
      return res.status(401).json({ error: "Credenciales inválidas" })
    }
    if (operador.cuenta_bloqueada) {
      return res.status(403).json({ error: "Cuenta bloqueada. Contacte al administrador." })
    }
    if (operador.totp_habilitado && operador.email) {
      await enviarOTP(operador.id, operador.email)
      const tempToken = await tempTokens.crear(operador.id)
      return res.json({
        requiere_2fa: true,
        temp_token: tempToken,
        mensaje: `Código enviado a ${operador.email}`
      })
    }
    const { accessToken, refreshToken } = generarTokens(operador)
    res.cookie("refresh_token", refreshToken, { httpOnly: true, secure: true, sameSite: "Strict" })
    res.json({ access_token: accessToken })
  } catch (err) {
    console.error("[auth] login error", err.message)
    res.status(500).json({ error: "Error interno" })
  }
})

router.post("/2fa/verify", rateLimiterOTP, async (req, res) => {
  const { temp_token, codigo_otp } = req.body || {}
  try {
    const operador = await tempTokens.validar(temp_token)
    if (!await verificarOTP(operador.id, codigo_otp)) {
      await db.query(
        "UPDATE operadores SET intentos_otp = intentos_otp + 1, ultimo_intento_otp = NOW() WHERE id = $1",
        [operador.id]
      )
      return res.status(401).json({ error: "Código inválido o expirado" })
    }
    await db.query("UPDATE operadores SET intentos_otp = 0 WHERE id = $1", [operador.id])
    tempTokens.eliminar(temp_token)
    const { accessToken, refreshToken } = generarTokens(operador)
    res.cookie("refresh_token", refreshToken, { httpOnly: true, secure: true, sameSite: "Strict" })
    res.json({ access_token: accessToken })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Enable email 2FA for an operator
router.post("/2fa/setup", autenticarJWT, async (req, res) => {
  const { email } = req.body || {}
  if (!email) return res.status(400).json({ error: "email requerido" })
  try {
    await db.query(
      "UPDATE operadores SET email = $1, totp_habilitado = TRUE WHERE id = $2",
      [email, req.operador.sub]
    )
    res.json({ ok: true, mensaje: `2FA activado. Código se enviará a ${email}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies.refresh_token
  if (!refreshToken) return res.status(401).json({ error: "refresh token requerido" })
  try {
    const payload = verificarToken(refreshToken)
    if (payload.tipo !== "refresh") throw new Error("tipo incorrecto")
    const result = await db.query("SELECT * FROM operadores WHERE id = $1", [payload.sub])
    const operador = result.rows[0]
    if (!operador || operador.cuenta_bloqueada) return res.status(401).json({ error: "no autorizado" })
    const { accessToken } = generarTokens(operador)
    res.json({ access_token: accessToken })
  } catch {
    res.status(401).json({ error: "refresh token inválido" })
  }
})

module.exports = router
