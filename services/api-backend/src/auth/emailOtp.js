const { Resend } = require("resend")

const FROM = process.env.RESEND_FROM || "onboarding@resend.dev"
const APP_NAME = process.env.OTP_APP_NAME || "Panel de Trafico Urbano"
const CONFIGURED_OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000)
const OTP_TTL_MS = Number.isFinite(CONFIGURED_OTP_TTL_MS) && CONFIGURED_OTP_TTL_MS > 0
  ? CONFIGURED_OTP_TTL_MS
  : 5 * 60 * 1000
const OTP_TTL_MINUTES = Math.max(1, Math.round(OTP_TTL_MS / 60000))

let resend = null
const store = new Map()

function validarRemitente() {
  if (!FROM || FROM.includes("tudominio.com") || FROM.includes("correo_verificado")) {
    throw new Error("RESEND_FROM debe ser un remitente verificado en Resend")
  }
}

function getResend() {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error("RESEND_API_KEY requerido")
  if (!resend) resend = new Resend(apiKey)
  return resend
}

function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function crearEmail(otp) {
  return {
    subject: `Codigo de verificacion - ${APP_NAME}`,
    text: `Tu codigo de verificacion es ${otp}. Es valido por ${OTP_TTL_MINUTES} minutos. No compartas este codigo.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d1117;color:#c9d1d9;border-radius:8px">
        <h2 style="color:#58a6ff;margin:0 0 16px">${APP_NAME}</h2>
        <p style="margin:0 0 16px">Tu codigo de verificacion es:</p>
        <div style="font-family:monospace;font-size:40px;letter-spacing:10px;font-weight:bold;color:#3fb950;margin:24px 0;text-align:center">
          ${otp}
        </div>
        <p style="color:#8b949e;font-size:13px;margin:0">Valido por ${OTP_TTL_MINUTES} minutos. No compartas este codigo.</p>
      </div>
    `
  }
}

async function enviarOTP(operadorId, email) {
  validarRemitente()
  const otp = generarCodigo()
  const exp = Date.now() + OTP_TTL_MS
  const message = crearEmail(otp)
  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: [email],
    subject: message.subject,
    text: message.text,
    html: message.html
  })

  if (error) {
    throw new Error(error.message || "No se pudo enviar el codigo OTP")
  }

  store.set(String(operadorId), { otp, exp })
  return { id: data?.id, exp }
}

function verificarOTP(operadorId, codigo) {
  const key = String(operadorId)
  const entry = store.get(key)
  if (!entry || entry.exp < Date.now()) {
    store.delete(key)
    return false
  }
  if (entry.otp !== String(codigo || "").trim()) return false
  store.delete(key)
  return true
}

module.exports = { enviarOTP, verificarOTP }
