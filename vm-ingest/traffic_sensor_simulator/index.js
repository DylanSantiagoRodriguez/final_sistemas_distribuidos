import fetch from "node-fetch"
import https from "https"
import { Kafka } from "kafkajs"

const AUTH_URL = process.env.AUTH_URL || "https://10.10.0.10/token"
const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.10.0.20:9092"

console.log("=== INICIANDO SENSOR SIMULATOR ===")
console.log("AUTH_URL:", AUTH_URL)
console.log("KAFKA_BROKER:", KAFKA_BROKER)
console.log("ALLOW_INSECURE_TLS:", process.env.ALLOW_INSECURE_TLS)

async function getToken() {
  try {
    console.log("🔐 Solicitando token a:", AUTH_URL)
    
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "sensor", client_secret: "sensor-secret" }),
      agent: process.env.ALLOW_INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined
    })
    
    console.log("📡 Status respuesta auth:", res.status)
    console.log("📡 Headers respuesta:", JSON.stringify(res.headers.raw(), null, 2))
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    
    const data = await res.json()
    console.log("✅ Token recibido:", data)
    
    if (!data.access_token) {
      throw new Error("No se recibió access_token en la respuesta")
    }
    
    return data.access_token
  } catch (error) {
    console.error("❌ Error obteniendo token:", error.message)
    console.error("Stack trace:", error.stack)
    throw error
  }
}

async function run() {
  try {
    const token = await getToken()
    console.log("✅ Token obtenido exitosamente, longitud:", token.length)
    
    console.log("🔌 Configurando cliente Kafka...")
    const kafka = new Kafka({
      brokers: [KAFKA_BROKER],
      ssl: false, // Temporalmente sin SSL para debug
      sasl: {
        mechanism: "oauthbearer",
        oauthBearerProvider: async () => {
          console.log("🔑 Usando token para autenticación Kafka")
          return { value: token }
        }
      },
      logLevel: 1, // DEBUG
      retry: {
        retries: 3
      }
    })
    
    const producer = kafka.producer()
    console.log("🚀 Conectando a Kafka...")
    
    await producer.connect()
    console.log("✅ Conectado a Kafka exitosamente")
    
    let counter = 0
    console.log("🔄 Iniciando envío de mensajes cada 5 segundos...")
    
    const interval = setInterval(async () => {
      try {
        counter++
        const payload = { 
          zone_id: "C", 
          vehicles: Math.floor(Math.random() * 100), 
          ts: Date.now() 
        }
        console.log(`📤 Enviando mensaje ${counter}:`, payload)
        
        const result = await producer.send({ 
          topic: "traffic_raw", 
          messages: [{ value: JSON.stringify(payload) }] 
        })
        
        console.log(`✅ Mensaje ${counter} enviado exitosamente`)
        console.log("   Resultado:", result)
        
      } catch (error) {
        console.error(`❌ Error enviando mensaje ${counter}:`, error.message)
        console.error("   Stack trace:", error.stack)
      }
    }, 5000)
    
    // Manejar graceful shutdown
    process.on('SIGINT', () => {
      console.log("🛑 Recibido SIGINT, apagando sensor...")
      clearInterval(interval)
      producer.disconnect().then(() => {
        console.log("👋 Sensor apagado correctamente")
        process.exit(0)
      })
    })
    
    process.on('SIGTERM', () => {
      console.log("🛑 Recibido SIGTERM, apagando sensor...")
      clearInterval(interval)
      producer.disconnect().then(() => {
        console.log("👋 Sensor apagado correctamente")
        process.exit(0)
      })
    })
    
  } catch (error) {
    console.error("💥 Error crítico en run():", error.message)
    console.error("Stack trace completo:", error.stack)
    process.exit(1)
  }
}

// Capturar promesas no manejadas
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  process.exit(1)
})

console.log("🎯 Iniciando aplicación...")
run()