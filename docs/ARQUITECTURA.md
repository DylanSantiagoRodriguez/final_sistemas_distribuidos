# Plataforma de Monitoreo de Tráfico Urbano en Tiempo Real
## Grupo 8 — Sistemas Distribuidos

---

## Índice

1. [Visión General](#1-visión-general)
2. [Arquitectura y Flujo de Datos](#2-arquitectura-y-flujo-de-datos)
3. [Kafka — Exactly-Once Semantics (EOS)](#3-kafka--exactly-once-semantics-eos)
4. [EC2 — Staging y Producción](#4-ec2--staging-y-producción)
5. [Nginx — WebSockets y Proxy Inverso](#5-nginx--websockets-y-proxy-inverso)
6. [nftables — Rate Limiting de Conexiones WS](#6-nftables--rate-limiting-de-conexiones-ws)
7. [JWT — Claims de Zona](#7-jwt--claims-de-zona)
8. [TLS 1.3 — WSS vs WS](#8-tls-13--wss-vs-ws)
9. [SQL Injection — Demo y Corrección](#9-sql-injection--demo-y-corrección)
10. [2FA — Rate Limiting OTP](#10-2fa--rate-limiting-otp)
11. [Mapa de Infraestructura](#11-mapa-de-infraestructura)

---

## 1. Visión General

El sistema simula una red de sensores de tráfico instalados en intersecciones de una ciudad, distribuidos en cuatro zonas geográficas: **norte, sur, centro y periférico**. Cada zona tiene tres tipos de sensores:

| Tipo | Qué mide | Formato del valor |
|------|----------|-------------------|
| `contador` | Vehículos por minuto | Número entero (0–100+) |
| `camara` | Estado visual de la vía | `"fluido"` / `"congestionado"` / `"accidente"` |
| `semaforo` | Estado del semáforo | `"verde"` / `"rojo"` / `"amarillo"` |

Los eventos viajan desde los sensores hasta los operadores municipales a través de una cadena de servicios distribuidos, todos desplegados en instancias EC2 independientes.

---

## 2. Arquitectura y Flujo de Datos

```
┌─────────────────────────────────────────────────────────────────┐
│  sensor-simulator (EC2 staging o producción)                    │
│  4 zonas × 3 tipos = 12 combinaciones                           │
│  Produce a Kafka con EOS (transactionalId + idempotent)         │
└──────────────┬──────────────────────────────────────────────────┘
               │ Kafka topics:
               │   trafico.norte / trafico.sur
               │   trafico.centro / trafico.periferico
               │   sensor.camara / sensor.contador / sensor.semaforo
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  traffic-processor (EC2 traffic-processor)                      │
│  Consume con read_committed (solo mensajes EOS confirmados)     │
│  → Escribe en PostgreSQL (eventos_trafico, anomalias)           │
│  → Detecta: congestión >50 veh/min, accidente, falla_sensor     │
│  → Publica alertas en Kafka topic: alertas.admin                │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  api-backend ×2 (EC2 api-backend-1 + api-backend-2)            │
│  Consume Kafka → pushea eventos por WebSocket                   │
│  REST: /auth/register /auth/login /auth/2fa/verify              │
│         /api/historico /health                                  │
│  WebSocket: /ws?token=<jwt>                                     │
│  JWT RS256, 2FA por email (Resend), SQLi demo/seguro            │
└──────────────┬──────────────────────────────────────────────────┘
               │ HTTP/1.1 upstream (ip_hash)
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  nginx-proxy (EC2 nginx-proxy)                                  │
│  TLS 1.3, WSS, HSTS, X-Frame-Options                           │
│  Upstream: 172.31.44.56:3000 + 172.31.35.34:3000               │
│  Dominio: powmlk.abrdns.com                                     │
└──────────────┬──────────────────────────────────────────────────┘
               │ HTTPS/WSS
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Frontend React (EC2 frontend — 3.17.5.143)                     │
│  Login → 2FA → Dashboard con WebSocket en tiempo real           │
└─────────────────────────────────────────────────────────────────┘
```

### VMs en producción

| VM | IP Privada | IP Pública | Rol |
|----|-----------|-----------|-----|
| kafka-broker | 172.31.35.145 | — | Kafka KRaft (sin ZooKeeper) |
| traffic-processor | 172.31.34.80 | — | PostgreSQL 15 + processor |
| api-backend-1 | 172.31.44.56 | — | API Node.js :3000 |
| api-backend-2 | 172.31.35.34 | — | API Node.js :3000 |
| nginx-proxy | 172.31.41.121 | 18.225.226.38 | Nginx TLS + LB |
| frontend | — | 3.17.5.143 | React dashboard |

---

## 3. Kafka — Exactly-Once Semantics (EOS)

### El problema que resuelve EOS

Sin EOS, en una red con fallos de red o reinicios del productor, un mismo evento de sensor puede llegar duplicado al topic. Esto contamina el histórico: un vehículo que pasó una vez aparece contado dos veces, disparando falsas alertas de congestión.

### Cómo funciona EOS en Kafka

EOS combina tres garantías:

**1. Productor idempotente**
Kafka asigna un `Producer ID (PID)` único a cada productor y un número de secuencia a cada mensaje. Si el broker recibe el mismo mensaje dos veces (mismo PID + mismo sequence number), descarta el duplicado automáticamente.

```javascript
// sensor-simulator/index.js
const producer = kafka.producer({
  transactionalId: `sensor-${SENSOR_ID}`,   // ID único por instancia
  idempotent: true,                           // activa deduplicación
  maxInFlightRequests: 1,                     // un batch a la vez
})
```

**2. Transacciones**
El productor envía eventos de múltiples topics (trafico.norte Y sensor.contador) dentro de una transacción atómica. O se confirman todos, o ninguno.

```javascript
await producer.transaction(async (tx) => {
  await tx.send({ topic: `trafico.${zona}`, messages: [msg] })
  await tx.send({ topic: `sensor.${tipo}`,  messages: [msg] })
})
// Si falla aquí, AMBOS mensajes se descartan
```

**3. Consumidor read_committed**
El traffic-processor solo lee mensajes de transacciones ya **confirmadas (committed)**. Mensajes de transacciones en vuelo o abortadas son invisibles.

```javascript
// traffic-processor/processor.js
const consumer = kafka.consumer({
  groupId: 'traffic-processor',
  readUncommitted: false,   // solo leer transacciones committed
})
```

### Topics separados por zona y tipo

```
trafico.norte      ← todos los sensores de zona norte
trafico.sur        ← todos los sensores de zona sur
trafico.centro
trafico.periferico
sensor.camara      ← todas las cámaras, sin importar zona
sensor.contador
sensor.semaforo
```

Esta separación permite:
- Escalar consumidores por zona (más carga en centro = más consumidores en trafico.centro)
- Filtrar por tipo de sensor sin leer todo el stream
- El operador suscrito a "norte" solo consume `trafico.norte`

### Detección de anomalías

El traffic-processor evalúa cada evento al guardarlo en PostgreSQL:

| Condición | Anomalía detectada | Alerta en Kafka |
|-----------|-------------------|-----------------|
| contador > 50 vehículos/min | `congestion` | `alertas.admin` |
| semáforo en rojo > 3 minutos | `accidente` probable | `alertas.admin` |
| cámara sin datos > 30 segundos | `falla_sensor` | `alertas.admin` |

---

## 4. EC2 — Staging y Producción

### Diferencia entre ambientes

| Característica | Staging | Producción |
|---------------|---------|-----------|
| Frecuencia de sensores | 10 segundos entre eventos | 200ms entre eventos |
| Carga Kafka | Baja | Alta |
| Variable de control | `NODE_ENV=staging` | `NODE_ENV=production` |
| Propósito | Probar cambios sin saturar | Operación real |

```javascript
// sensor-simulator/index.js
const INTERVAL = process.env.NODE_ENV === 'staging' ? 10000 : 200
```

### Seguridad por capas

**Capa 1 — AWS Security Groups** (firewall a nivel de red AWS):

```
kafka-broker:       9092 desde 172.31.0.0/16 (solo VPC interna)
traffic-processor:  5432 desde 172.31.0.0/16 (solo VPC interna)
api-backend-1/2:    3000 desde 172.31.41.121/32 (solo nginx-proxy)
nginx-proxy:        80/443 desde 0.0.0.0/0 (internet)
```

**Capa 2 — nftables** (firewall en el SO de cada VM, ver sección 6)

**Capa 3 — Nginx** (TLS, headers de seguridad, proxy reverso)

**Capa 4 — Aplicación** (JWT, 2FA, prepared statements)

### Rolling update sin downtime

El script `scripts/rolling-update.sh` actualiza los api-backends uno a la vez:

1. Sacar api-backend-1 del upstream de nginx (nginx lo marca como down tras `max_fails=2`)
2. Hacer `git pull` + `docker build` + reiniciar contenedor en api-backend-1
3. Verificar health check: `curl http://172.31.44.56:3000/health`
4. Repetir para api-backend-2

Durante el proceso, nginx sigue enviando tráfico al backend que está vivo. Los usuarios no perciben interrupción.

---

## 5. Nginx — WebSockets y Proxy Inverso

### Por qué WebSocket necesita configuración especial en Nginx

HTTP estándar es un protocolo de request-response: el cliente pide, el servidor responde, conexión cerrada. WebSocket es una conexión persistente bidireccional que comienza con un **HTTP Upgrade handshake**:

```
Cliente → Servidor:
  GET /ws HTTP/1.1
  Upgrade: websocket
  Connection: Upgrade

Servidor → Cliente:
  HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
  Connection: Upgrade
```

Sin las cabeceras `Upgrade` y `Connection`, nginx descarta el handshake y WebSocket nunca se establece.

### Configuración de nginx

```nginx
upstream traffic_backend {
    ip_hash;                                          # sticky sessions (JWT RS256 por clave por instancia)
    server 172.31.44.56:3000 max_fails=2 fail_timeout=10s;
    server 172.31.35.34:3000 max_fails=2 fail_timeout=10s;
    keepalive 32;
}

# WebSocket — conexiones de larga duración
location /ws {
    proxy_pass http://traffic_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;       # ← clave para WS
    proxy_set_header Connection "Upgrade";        # ← clave para WS
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout  3600s;    # 1 hora sin datos antes de cerrar
    proxy_send_timeout  3600s;
    keepalive_timeout   3600s;
}

# API REST — timeouts cortos
location /api {
    proxy_pass http://traffic_backend;
    proxy_read_timeout 30s;
}
```

### Por qué `ip_hash`

Cada instancia de api-backend genera su propio par de claves RSA al arrancar (generadas en el Dockerfile). Un token JWT firmado por api-backend-1 solo puede ser verificado por api-backend-1. Sin `ip_hash`, una petición de login podría ir a api-backend-1 y la siguiente petición (con el token) ir a api-backend-2 → verificación fallida.

`ip_hash` garantiza que todas las peticiones de una misma IP van siempre al mismo backend.

### Headers de seguridad

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Frame-Options DENY always;
add_header X-Content-Type-Options nosniff always;
```

| Header | Qué previene |
|--------|-------------|
| HSTS | Que el browser use HTTP en vez de HTTPS |
| X-Frame-Options DENY | Clickjacking (embed en iframe de otro dominio) |
| X-Content-Type-Options nosniff | MIME sniffing attacks |

---

## 6. nftables — Rate Limiting de Conexiones WS

### El problema

Un atacante puede abrir miles de conexiones WebSocket simultáneas desde una misma IP, saturando los workers de Node.js y dejando sin servicio al sistema real. Los Security Groups de AWS no tienen capacidad de limitar conexiones por IP a nivel de aplicación.

### Solución con nftables

`nftables` opera en el kernel de Linux (antes del stack TCP/IP de la aplicación), lo que lo hace muy eficiente para este tipo de limitación.

```nftables
# infra/nftables/nginx-proxy.conf

table inet filter {
  # Set dinámico: IPs que superaron el umbral
  set ws_abusers {
    type ipv4_addr
    flags dynamic, timeout
    timeout 10m          # IP bloqueada por 10 minutos
  }

  chain input {
    type filter hook input priority 0; policy accept;

    # Puerto 443 (WSS) — rate limit por IP
    tcp dport 443 \
      meter ws_rate { ip saddr limit rate 10/minute } \
      accept

    # Si supera 10 conexiones/minuto → bloquear y loggear
    tcp dport 443 \
      add @ws_abusers { ip saddr } \
      log prefix "WS_ABUSE: " \
      drop
  }
}
```

### Cómo funciona

1. `meter ws_rate` mantiene un contador por IP fuente (`ip saddr`)
2. Máximo 10 nuevas conexiones por minuto hacia el puerto 443
3. Si se supera: la IP se agrega al set dinámico `ws_abusers` con TTL de 10 minutos
4. `log prefix "WS_ABUSE:"` escribe en el kernel log (`/var/log/kern.log`) la IP del atacante para análisis forense posterior
5. `drop` descarta el paquete sin respuesta (el atacante no sabe si fue bloqueado o si el servidor no existe)

### Análisis forense

```bash
# Ver IPs bloqueadas actualmente
sudo nft list set inet filter ws_abusers

# Ver intentos en el log del kernel
grep "WS_ABUSE" /var/log/kern.log
```

---

## 7. JWT — Claims de Zona

### Estructura del token

El access token es un JWT firmado con RSA-256 (clave privada en api-backend, clave pública para verificar). El payload incluye:

```json
{
  "sub": 1,
  "username": "admin",
  "zonas_asignadas": ["norte", "sur", "centro", "periferico"],
  "iat": 1716192000,
  "exp": 1716192900
}
```

`zonas_asignadas` define exactamente qué zonas puede ver el operador. Un operador del turno noche puede tener solo `["norte", "centro"]`.

### Por qué se valida sin consultar la DB

En un flujo de WebSocket en tiempo real, cada evento que llega debe pasar por un filtro de zona antes de enviarse al cliente. Si esta validación requiriera una consulta a PostgreSQL, el sistema tendría que hacer miles de queries por segundo (una por evento, por cliente conectado). Con el claim en el JWT, la validación es una simple operación en memoria:

```javascript
// websocket/server.js
ws.on("message", (data) => {
  const msg = JSON.parse(data)
  if (msg.action === "subscribe") {
    // Intersección: zonas pedidas ∩ zonas del JWT
    // Sin DB lookup — O(n) en memoria
    ws.zonasActivas = msg.zonas.filter(
      z => operador.zonas_asignadas.includes(z)
    )
    ws.send(JSON.stringify({ tipo: "subscripcion_ok", zonas: ws.zonasActivas }))
  }
})

function pushEvento(evento) {
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN &&
        ws.zonasActivas.includes(evento.zona)) {
      ws.send(JSON.stringify(evento))   // solo si la zona está activa
    }
  })
}
```

### Ciclo de vida del token

```
Login exitoso
    │
    ▼
access_token (JWT, 15 min) ──────────────────────┐
refresh_token (JWT, 7 días, cookie httpOnly)       │
    │                                              │
    │ El frontend calcula: exp - 30 segundos       │
    │ 30s antes de expirar → silentRefresh()        │
    ▼                                              │
POST /auth/refresh (cookie automática)             │
    │                                              │
    ▼                                              │
Nuevo access_token ────────────────────────────────┘
```

El refresh es silencioso: el usuario no ve ningún popup ni redirección. Si el refresh_token también expiró, la barra de estado muestra "Sesión expirada — recarga la página".

---

## 8. TLS 1.3 — WSS vs WS

### Diferencia entre WS y WSS

| Protocolo | Puerto | Cifrado | Uso |
|-----------|--------|---------|-----|
| `ws://` | 80 | Ninguno — texto plano | Desarrollo local |
| `wss://` | 443 | TLS 1.3 | Producción |

Con `ws://`, cualquier nodo en la red entre el cliente y el servidor (router, ISP, proxy corporativo) puede leer los tokens JWT y los eventos de tráfico en texto plano. Con `wss://`, todo está cifrado.

### Por qué solo TLS 1.3

TLS 1.2 tiene vulnerabilidades conocidas (BEAST, POODLE, LUCKY13) y soporta cipher suites débiles. TLS 1.3 elimina todos esos cipher suites vulnerables y reduce el handshake de 2 RTT a 1 RTT, mejorando también la latencia.

```nginx
ssl_protocols TLSv1.3;    # solo TLS 1.3, ninguna versión anterior
ssl_conf_command Ciphersuites \
  TLS_AES_128_GCM_SHA256:\
  TLS_AES_256_GCM_SHA384:\
  TLS_CHACHA20_POLY1305_SHA256;
```

Los tres cipher suites permitidos usan **AEAD (Authenticated Encryption with Associated Data)**: cifran y autentican al mismo tiempo, eliminando los ataques de padding oracle.

### Cómo el browser distingue WS de WSS

```javascript
// panel/index.html
const wsProto = location.protocol === "https:" ? "wss" : "ws"
const ws = new WebSocket(`${wsProto}://${location.host}/ws?token=${token}`)
```

Si el panel se carga desde `https://powmlk.abrdns.com`, el protocolo es `https:` → se usa `wss://`. Desde `http://localhost:5173` (desarrollo) → `ws://`.

### Certificado TLS

Para producción se usa un certificado autofirmado (self-signed). Los browsers muestran advertencia de seguridad la primera vez; el usuario debe aceptarlo. Para eliminar la advertencia se necesitaría un certificado de una CA reconocida (Let's Encrypt), lo cual requiere que el dominio resuelva correctamente y port 80 accesible para el challenge ACME.

```
CN = powmlk.abrdns.com
SAN = DNS:powmlk.abrdns.com, IP:18.225.226.38
Válido hasta: Mayo 2031
```

---

## 9. SQL Injection — Demo y Corrección

### El endpoint vulnerable

El endpoint `GET /api/historico` permite filtrar eventos por zona, fecha y tipo de sensor. La versión vulnerable (activada con `SQLI_DEMO=true`) concatena directamente el input del usuario en la query SQL:

```javascript
// routes/historico.insecure.js
router.get("/", async (req, res) => {
  const { zona, fecha, tipo } = req.query
  // VULNERABILITY: concatenación directa → SQLi
  const query = `
    SELECT * FROM eventos_trafico
    WHERE zona = '${zona}'
    AND DATE(timestamp) = '${fecha}'
    AND tipo_sensor = '${tipo}'`
  const result = await db.query(query)
  res.json(result.rows)
})
```

### Ataque — Extracción de esquema

El atacante inyecta un `UNION SELECT` para añadir filas extra al resultado. Primero necesita saber cuántas columnas tiene la tabla original (`id, sensor_id, zona, tipo_sensor, valor, timestamp` = 6 columnas):

```
GET /api/historico?zona=norte'%20UNION%20SELECT%20table_name,null,null,null,null,null%20FROM%20information_schema.tables--&fecha=2024-01-01&tipo=camara
```

La query resultante en el servidor:
```sql
SELECT * FROM eventos_trafico
WHERE zona = 'norte'
UNION SELECT table_name,null,null,null,null,null FROM information_schema.tables--'
AND DATE(timestamp) = '2024-01-01'
AND tipo_sensor = 'camara'
```

El `--` comenta el resto. La respuesta incluye los nombres de todas las tablas del esquema.

### Ataque — Extracción de credenciales

Una vez conocidas las tablas, el atacante extrae usuarios y hashes:

```
GET /api/historico?zona=norte'%20UNION%20SELECT%20username,password_hash,null,null,null,null%20FROM%20operadores--&fecha=2024-01-01&tipo=camara
```

Respuesta (campo `id` = username, campo `sensor_id` = hash bcrypt):
```json
[
  { "id": "admin", "sensor_id": "$2a$10$vC2hUvKo...", "zona": null, ... }
]
```

Con el hash bcrypt el atacante puede intentar un ataque de diccionario offline.

### La corrección — Prepared Statements

```javascript
// routes/historico.js (versión segura)
router.get("/", autenticarJWT, async (req, res) => {
  const { zona, fecha, tipo } = req.query

  // Validación de zona contra el JWT antes de tocar la DB
  if (zona && !req.operador.zonas_asignadas.includes(zona)) {
    return res.status(403).json({ error: "Zona no autorizada" })
  }

  const conditions = []
  const params = []
  if (zona)  { params.push(zona);  conditions.push(`zona = $${params.length}`) }
  if (fecha) { params.push(fecha); conditions.push(`DATE(timestamp) = $${params.length}`) }
  if (tipo)  { params.push(tipo);  conditions.push(`tipo_sensor = $${params.length}`) }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const query = `SELECT id, sensor_id, zona, tipo_sensor, valor, timestamp
                 FROM eventos_trafico ${where}
                 ORDER BY timestamp DESC LIMIT 100`

  // Los params se pasan SEPARADOS del SQL — PostgreSQL los escapa
  const result = await db.query(query, params)
  res.json(result.rows)
})
```

Con prepared statements, si el usuario envía `norte' UNION SELECT...`, PostgreSQL trata toda esa cadena como el **valor literal** del parámetro `$1`, no como SQL. La query queda:

```sql
SELECT ... FROM eventos_trafico WHERE zona = $1
-- $1 = "norte' UNION SELECT..." (string literal, nunca ejecutado como SQL)
```

### Diferencia clave

| Versión | Input del usuario | Rol en la query |
|---------|------------------|-----------------|
| Insegura | `norte' UNION SELECT...` | **Código SQL ejecutado** |
| Segura | `norte' UNION SELECT...` | **Dato string, no SQL** |

Además, la versión segura requiere JWT válido → un atacante no autenticado ni siquiera llega a la DB.

---

## 10. 2FA — Rate Limiting OTP

### Flujo completo de autenticación

```
1. POST /auth/login
   body: { username, password }
   
   ┌─ Password incorrecto ──→ 401 Credenciales inválidas
   ├─ Cuenta bloqueada ─────→ 403 Cuenta bloqueada
   └─ OK + 2FA habilitado ──→ 200 { requiere_2fa: true, temp_token, mensaje }
                                    │
                                    └─ Resend envía OTP al email registrado
                                       OTP: 6 dígitos, válido 5 minutos

2. POST /auth/2fa/verify
   body: { temp_token, codigo_otp }
   
   ┌─ OTP correcto ─────────→ 200 { access_token } + cookie refresh_token
   └─ OTP incorrecto ───────→ 401 + incrementa intentos_otp en DB
```

### Rate limiting con express-rate-limit

```javascript
// auth/rateLimiter.js
const rateLimiterOTP = rateLimit({
  windowMs: 10 * 60 * 1000,   // ventana de 10 minutos
  max: 5,                       // máximo 5 intentos por IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req, res) => {
    const { temp_token } = req.body || {}
    // Al lloquear: marcar cuenta como bloqueada en DB
    const operador = await tempTokens.validar(temp_token).catch(() => null)
    if (operador) {
      await db.query(
        "UPDATE operadores SET cuenta_bloqueada = TRUE WHERE id = $1",
        [operador.id]
      )
      // Enviar alerta al administrador por Kafka
      await producer.send({
        topic: 'alertas.admin',
        messages: [{
          value: JSON.stringify({
            tipo: 'bloqueo_cuenta',
            operador_id: operador.id,
            timestamp: new Date().toISOString()
          })
        }]
      })
    }
    res.status(429).json({ error: "Demasiados intentos. Cuenta bloqueada 10 minutos." })
  }
})
```

### Generación del OTP

```javascript
// auth/emailOtp.js
function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000))
  // Genera número entre 100000 y 999999 (siempre 6 dígitos)
}

async function enviarOTP(operadorId, email) {
  const otp = generarCodigo()
  // Almacenamiento en memoria: operadorId → { otp, expiry }
  store.set(String(operadorId), {
    otp,
    exp: Date.now() + 5 * 60 * 1000   // expira en 5 minutos
  })
  // Envío por email via Resend API
  await resend.emails.send({
    from: process.env.RESEND_FROM,
    to: email,
    subject: "Código de acceso — Panel de Tráfico Urbano",
    html: `<div>Tu código: <strong>${otp}</strong>. Válido 5 minutos.</div>`
  })
}
```

### Verificación y uso único

```javascript
function verificarOTP(operadorId, codigo) {
  const entry = store.get(String(operadorId))
  if (!entry) return false              // no existe
  if (entry.exp < Date.now()) return false  // expirado
  if (entry.otp !== String(codigo)) return false  // incorrecto
  store.delete(String(operadorId))      // ← uso único: se borra al verificar
  return true
}
```

El OTP se elimina del store al primer uso correcto, así no puede reutilizarse aunque el atacante intercepte la respuesta.

### Alerta al administrador

Cuando se bloquea una cuenta por exceso de intentos, se publica en el topic Kafka `alertas.admin`. El sistema de monitoreo (o un operador con más privilegios) puede suscribirse a este topic y recibir la alerta en tiempo real, sin necesidad de revisar logs o tablas de la DB.

### Tabla de estados de cuenta en DB

```sql
-- operadores
id              SERIAL PRIMARY KEY
username        VARCHAR(100) UNIQUE
password_hash   VARCHAR(255)
email           VARCHAR(255)
totp_habilitado BOOLEAN DEFAULT FALSE   -- 2FA activado
intentos_otp    INTEGER DEFAULT 0       -- intentos fallidos acumulados
ultimo_intento_otp TIMESTAMP           -- cuándo fue el último intento
cuenta_bloqueada BOOLEAN DEFAULT FALSE  -- bloqueada por admin o rate limit
zonas_asignadas TEXT[]                 -- zonas que puede ver
```

---

## 11. Mapa de Infraestructura

```
Internet
    │
    │ HTTPS/WSS (puerto 443)
    │ HTTP (puerto 80 → redirect 301)
    ▼
[nginx-proxy: 18.225.226.38]
 TLS 1.3 | HSTS | ip_hash upstream
 nftables: max 10 WS/min por IP
    │
    │ HTTP interno (VPC privada)
    ├──────────────────────────────────┐
    ▼                                  ▼
[api-backend-1: 172.31.44.56:3000]  [api-backend-2: 172.31.35.34:3000]
 JWT RS256 | 2FA email               JWT RS256 | 2FA email
 WebSocket server                    WebSocket server
 Express REST API                    Express REST API
    │                                  │
    └──────────────┬───────────────────┘
                   │
         ┌─────────┴──────────┐
         ▼                    ▼
[kafka-broker:          [PostgreSQL:
 172.31.35.145:9092]     172.31.34.80:5432]
 KRaft mode              Tablas: eventos_trafico,
 Topics: trafico.*,      anomalias, operadores
 sensor.*, alertas.admin
         ▲
         │
[traffic-processor: 172.31.34.80]
 Consume trafico.* (read_committed)
 Detecta anomalías
 Escribe en PostgreSQL
 Publica en alertas.admin
         ▲
         │
[sensor-simulator]
 4 zonas × 3 tipos
 EOS producer
 staging: 10s | prod: 200ms
```

---

*Documento generado para Grupo 8 — Sistemas Distribuidos UCC*
