const { Resend } = require("resend")

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.RESEND_FROM || "onboarding@resend.dev"

// operadorId -> { otp, exp }
const store = new Map()

function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function enviarOTP(operadorId, email) {
  const otp = generarCodigo()
  store.set(String(operadorId), { otp, exp: Date.now() + 5 * 60 * 1000 })

  await resend.emails.send({
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

function verificarOTP(operadorId, codigo) {
  const entry = store.get(String(operadorId))
  if (!entry || entry.exp < Date.now()) return false
  if (entry.otp !== String(codigo)) return false
  store.delete(String(operadorId))
  return true
}

module.exports = { enviarOTP, verificarOTP }
