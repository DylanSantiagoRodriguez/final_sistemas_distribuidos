import fetch from "node-fetch"
import https from "https"
import { Kafka } from "kafkajs"

const AUTH_URL = process.env.AUTH_URL || "https://10.10.0.10/token"
const KAFKA_BROKER = process.env.KAFKA_BROKER || "10.10.0.20:9092"

console.log("=== INICIANDO SENSOR SIMULATOR ===")
console.log("AUTH_URL:", AUTH_URL)
console.log("KAFKA_BROKER:", KAFKA_BROKER)

async function run() {
  try {
    console.log("🔌 Configurando cliente Kafka (sin SASL)...")
    
    // Configuración simple sin SASL
    const kafka = new Kafka({
      brokers: [KAFKA_BROKER],
      ssl: false, // Sin SSL
      // Sin sección sasl
    })
    
    const producer = kafka.producer()
    console.log("🚀 Conectando a Kafka...")
    
    await producer.connect()
    console.log("✅ Conectado a Kafka exitosamente!")
    
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
        console.log("   Offset:", result[0]?.baseOffset)
        
      } catch (error) {
        console.error(`❌ Error enviando mensaje ${counter}:`, error.message)
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