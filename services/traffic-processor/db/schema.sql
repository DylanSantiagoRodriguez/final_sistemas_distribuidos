CREATE DATABASE trafico_db;

\c trafico_db;

CREATE TABLE eventos_trafico (
  id            SERIAL PRIMARY KEY,
  sensor_id     VARCHAR(50)  NOT NULL,
  zona          VARCHAR(20)  NOT NULL,
  tipo_sensor   VARCHAR(20)  NOT NULL,
  valor         JSONB        NOT NULL,
  timestamp     TIMESTAMPTZ  NOT NULL,
  procesado_en  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE anomalias (
  id            SERIAL PRIMARY KEY,
  sensor_id     VARCHAR(50)  NOT NULL,
  zona          VARCHAR(20)  NOT NULL,
  tipo_anomalia VARCHAR(50)  NOT NULL,
  severidad     VARCHAR(10)  NOT NULL,
  detectado_en  TIMESTAMPTZ  DEFAULT NOW(),
  resuelto_en   TIMESTAMPTZ,
  activo        BOOLEAN      DEFAULT TRUE,
  datos_raw     JSONB
);

CREATE TABLE operadores (
  id                  SERIAL PRIMARY KEY,
  username            VARCHAR(50)  UNIQUE NOT NULL,
  password_hash       VARCHAR(255) NOT NULL,
  zonas_asignadas     TEXT[]       NOT NULL,
  totp_secret         VARCHAR(100),
  totp_habilitado     BOOLEAN      DEFAULT FALSE,
  refresh_token_hash  VARCHAR(255),
  cuenta_bloqueada    BOOLEAN      DEFAULT FALSE,
  intentos_otp        INTEGER      DEFAULT 0,
  ultimo_intento_otp  TIMESTAMPTZ,
  creado_en           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_eventos_zona      ON eventos_trafico(zona);
CREATE INDEX idx_eventos_timestamp ON eventos_trafico(timestamp);
CREATE INDEX idx_anomalias_activo  ON anomalias(activo);

-- Operador de prueba: password = 'admin123'
-- bcrypt hash generado con saltRounds=10
INSERT INTO operadores (username, password_hash, zonas_asignadas)
VALUES (
  'admin',
  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
  ARRAY['norte','sur','centro','periferico']
);
