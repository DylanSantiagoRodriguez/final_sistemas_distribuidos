const { Resend } = require("resend")
const db = require("../db/postgres")

const FROM = process.env.RESEND_FROM || "onboarding@resend.dev"
let resend = null
function getResend() {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY)
  return resend
}

function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function enviarOTP(operadorId, email) {
  const otp = generarCodigo()
  const exp = new Date(Date.now() + 5 * 60 * 1000)
  await db.query(
    "UPDATE operadores SET otp_code = $1, otp_exp = $2 WHERE id = $3",
    [otp, exp, operadorId]
  )

  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: "Código de acceso — Panel de Tráfico Urbano",
    html: `
      <div style="font-family:monospace;max-width:400px;margin:0 auto;padding:32px;background:#0d1117;color:#c9d1d9;border-radius:8px">
        <h2 style="color:#58a6ff;margin-top:0">Panel de Control — Tráfico Urbano</h2>
        <p>Tu código de verificación es:</p>
        <div style="font-size:40px;letter-spacing:12px;font-weight:bold;color:#3fb950;margin:24px 0;text-align:center">
          ${otp}
        </div>
        <p style="color:#8b949e;font-size:13px">Válido por 5 minutos. No compartas este código.</p>
      </div>
    `
  })
}

async function verificarOTP(operadorId, codigo) {
  const result = await db.query(
    "SELECT otp_code, otp_exp FROM operadores WHERE id = $1",
    [operadorId]
  )
  const row = result.rows[0]
  if (!row || !row.otp_code || new Date(row.otp_exp) < new Date()) return false
  if (row.otp_code !== String(codigo)) return false
  await db.query(
    "UPDATE operadores SET otp_code = NULL, otp_exp = NULL WHERE id = $1",
    [operadorId]
  )
  return true
}

module.exports = { enviarOTP, verificarOTP }
