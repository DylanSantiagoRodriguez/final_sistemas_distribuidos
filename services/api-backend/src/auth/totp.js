const speakeasy = require("speakeasy")
const QRCode = require("qrcode")

function generarSecretTOTP(username) {
  return speakeasy.generateSecret({ name: `TraficoApp:${username}`, length: 20 })
}

async function generarQR(secret) {
  return QRCode.toDataURL(secret.otpauth_url)
}

function verificarTOTP(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  })
}

module.exports = { generarSecretTOTP, generarQR, verificarTOTP }
