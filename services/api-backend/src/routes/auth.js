const express = require("express")
const bcrypt = require("bcryptjs")
const db = require("../db/postgres")
const { generarTokens, verificarToken } = require("../auth/jwt")
const { verificarTOTP, generarSecretTOTP, generarQR } = require("../auth/totp")
const { autenticarJWT } = require("../auth/middleware")
const { rateLimiterOTP } = require("../auth/rateLimiter")
const tempTokens = require("../auth/tempTokens")

const router = express.Router()

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
    if (operador.totp_habilitado) {
      return res.json({ requiere_2fa: true, temp_token: tempTokens.crear(operador.id) })
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
    if (!verificarTOTP(operador.totp_secret, codigo_otp)) {
      await db.query(
        "UPDATE operadores SET intentos_otp = intentos_otp + 1, ultimo_intento_otp = NOW() WHERE id = $1",
        [operador.id]
      )
      return res.status(401).json({ error: "Código OTP inválido" })
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

router.post("/2fa/setup", autenticarJWT, async (req, res) => {
  try {
    const secret = generarSecretTOTP(req.operador.username)
    await db.query(
      "UPDATE operadores SET totp_secret = $1, totp_habilitado = FALSE WHERE id = $2",
      [secret.base32, req.operador.sub]
    )
    const qrUrl = await generarQR(secret)
    res.json({ qr_code: qrUrl, secret_manual: secret.base32 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post("/2fa/confirm", autenticarJWT, async (req, res) => {
  const { codigo_otp } = req.body || {}
  try {
    const result = await db.query("SELECT totp_secret FROM operadores WHERE id = $1", [req.operador.sub])
    if (!verificarTOTP(result.rows[0].totp_secret, codigo_otp)) {
      return res.status(401).json({ error: "Código OTP inválido" })
    }
    await db.query("UPDATE operadores SET totp_habilitado = TRUE WHERE id = $1", [req.operador.sub])
    res.json({ ok: true })
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
