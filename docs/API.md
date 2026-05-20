# API — Panel de Tráfico Urbano

**Base URL:** `https://powmlk.abrdns.com`  
**WebSocket:** `wss://powmlk.abrdns.com/ws`  
**Panel:** `https://powmlk.abrdns.com/`

> Todo el tráfico pasa por nginx-proxy (`18.225.226.38`), que distribuye entre api-backend-1 (`172.31.44.56:3000`) y api-backend-2 (`172.31.35.34:3000`). No llamar a los backends directamente desde el frontend.

---

## Autenticación

### `POST https://powmlk.abrdns.com/auth/login`

Login con usuario y contraseña. Si el operador tiene 2FA activado, el sistema envía un OTP al email y devuelve `requiere_2fa: true` en vez del token.

**Request:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response — sin 2FA (200):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```
La cookie `refresh_token` (httpOnly, Secure, SameSite=Strict) se setea automáticamente.

**Response — con 2FA (200):**
```json
{
  "requiere_2fa": true,
  "temp_token": "mpcahnff-f9alv0jder8",
  "mensaje": "Código enviado a dylan.rodriguez@campusucc.edu.co"
}
```

**Response — error (401):**
```json
{
  "error": "Credenciales inválidas"
}
```

**Response — cuenta bloqueada (403):**
```json
{
  "error": "Cuenta bloqueada. Contacte al administrador."
}
```

---

### `POST https://powmlk.abrdns.com/auth/2fa/verify`

Verifica el OTP enviado al email. Máximo 5 intentos / 10 min (rate limit por IP).

**Request:**
```json
{
  "temp_token": "mpcahnff-f9alv0jder8",
  "codigo_otp": "483921"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```
La cookie `refresh_token` se setea automáticamente.

**Response — error (401):**
```json
{
  "error": "Código inválido o expirado"
}
```

---

### `POST https://powmlk.abrdns.com/auth/refresh`

Renueva el `access_token` usando la cookie `refresh_token`. No requiere body ni header Authorization.

```
credentials: "include"   ← necesario para que el browser envíe la cookie
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response — sin cookie o expirada (401):**
```json
{
  "error": "refresh token inválido"
}
```

---

### `POST https://powmlk.abrdns.com/auth/2fa/setup`

Activa 2FA por email para el operador autenticado. Requiere `access_token`.

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request:**
```json
{
  "email": "operador@ejemplo.com"
}
```

**Response (200):**
```json
{
  "ok": true,
  "mensaje": "2FA activado. Código se enviará a operador@ejemplo.com"
}
```

---

## API de datos

> Todos los endpoints de `/api` requieren `Authorization: Bearer <access_token>`.

### `GET https://powmlk.abrdns.com/api/historico`

Devuelve eventos de tráfico almacenados. Máximo 100 por consulta, ordenados por `timestamp DESC`.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query params (todos opcionales):**

| Param | Tipo | Ejemplo | Descripción |
|-------|------|---------|-------------|
| `zona` | string | `norte` | Filtra por zona. Debe estar en `zonas_asignadas` del JWT |
| `tipo` | string | `contador` | Tipo de sensor: `camara`, `contador`, `semaforo` |
| `fecha` | string | `2026-05-20` | Fecha exacta formato `YYYY-MM-DD` |

**Ejemplos:**
```
GET /api/historico
GET /api/historico?zona=norte
GET /api/historico?zona=sur&tipo=contador
GET /api/historico?zona=centro&fecha=2026-05-20
GET /api/historico?zona=periferico&tipo=camara&fecha=2026-05-20
```

**Response (200):**
```json
[
  {
    "id": 1,
    "sensor_id": "sensor-norte-001",
    "zona": "norte",
    "tipo_sensor": "contador",
    "valor": 73,
    "timestamp": "2026-05-20T06:45:12.000Z"
  }
]
```

**Response — zona no asignada al operador (403):**
```json
{
  "error": "Zona no autorizada"
}
```

**Response — sin token (401):**
```json
{
  "error": "Token requerido"
}
```

---

### `GET https://powmlk.abrdns.com/health`

Health check. Sin autenticación.

**Response (200):**
```json
{
  "ok": true,
  "sqli_demo": false
}
```

---

## WebSocket

### `wss://powmlk.abrdns.com/ws`

Conexión en tiempo real para recibir eventos de tráfico. El token va en el **query param** `token` (no en header — limitación del browser WebSocket API).

**Conexión:**
```js
const ws = new WebSocket(
  `wss://powmlk.abrdns.com/ws?token=${encodeURIComponent(accessToken)}`
)
```

Si el token es inválido o falta → el servidor cierra el socket con HTTP 401 antes de completar el handshake.

---

**Mensaje 1 — Suscribirse a zonas:**

El cliente envía esto tras `onopen`. Solo llegan eventos de las zonas suscritas Y que estén en el `zonas_asignadas` del JWT (intersección).

```json
{
  "action": "subscribe",
  "zonas": ["norte", "sur", "centro", "periferico"]
}
```

**Respuesta del servidor:**
```json
{
  "tipo": "subscripcion_ok",
  "zonas": ["norte", "sur", "centro", "periferico"]
}
```

---

**Eventos entrantes (push del servidor):**

```json
{
  "zona": "norte",
  "tipo_sensor": "contador",
  "valor": 73,
  "sensor_id": "sensor-norte-001",
  "timestamp": "2026-05-20T06:45:12.000Z"
}
```

| `tipo_sensor` | `valor` | Interpretación |
|---------------|---------|----------------|
| `contador` | número (0-100) | Vehículos/min. `> 70` = congestión |
| `camara` | `"fluido"` / `"congestionado"` / `"accidente"` | Estado visual de la vía |
| `semaforo` | `"verde"` / `"rojo"` / `"amarillo"` | Estado del semáforo |

---

**Reconexión — código 4001:**

El servidor cierra con `code: 4001` cuando el token expiró. El cliente debe renovar el token con `/auth/refresh` y reconectar.

```js
ws.onclose = async (e) => {
  if (e.code === 4001) {
    await silentRefresh()   // llama /auth/refresh
    connectWS()             // reconecta con nuevo token
  } else {
    setTimeout(connectWS, 3000)
  }
}
```

---

**Ejemplo completo de flujo WebSocket:**
```js
async function conectar(accessToken) {
  const ws = new WebSocket(
    `wss://powmlk.abrdns.com/ws?token=${encodeURIComponent(accessToken)}`
  )

  ws.onopen = () => {
    ws.send(JSON.stringify({
      action: "subscribe",
      zonas: ["norte", "sur", "centro", "periferico"]
    }))
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.tipo === "subscripcion_ok") {
      console.log("Suscrito a:", msg.zonas)
      return
    }
    // evento de tráfico
    console.log(msg.zona, msg.tipo_sensor, msg.valor)
  }

  ws.onclose = async (e) => {
    if (e.code === 4001) {
      const res = await fetch("https://powmlk.abrdns.com/auth/refresh", {
        method: "POST",
        credentials: "include"
      })
      const { access_token } = await res.json()
      conectar(access_token)
    } else {
      setTimeout(() => conectar(accessToken), 3000)
    }
  }
}
```

---

## JWT — estructura del access_token

El token es RS256. El payload contiene:

```json
{
  "sub": 1,
  "username": "admin",
  "zonas_asignadas": ["norte", "sur", "centro", "periferico"],
  "iat": 1716192000,
  "exp": 1716192900
}
```

- Expira en **15 minutos**
- Renovar con `POST /auth/refresh` (cookie httpOnly) **30 segundos antes de `exp`**
- `zonas_asignadas` define qué zonas puede consultar y suscribirse el operador

---

## Resumen de servidores

| Componente | Dirección | Acceso |
|------------|-----------|--------|
| Panel + API (público) | `https://powmlk.abrdns.com` | Internet |
| WebSocket (público) | `wss://powmlk.abrdns.com/ws` | Internet |
| nginx-proxy | `18.225.226.38` | Internet |
| api-backend-1 | `172.31.44.56:3000` | Solo VPC |
| api-backend-2 | `172.31.35.34:3000` | Solo VPC |
| PostgreSQL | `172.31.34.80:5432` | Solo VPC |
| Kafka broker | `172.31.35.145:9092` | Solo VPC |
