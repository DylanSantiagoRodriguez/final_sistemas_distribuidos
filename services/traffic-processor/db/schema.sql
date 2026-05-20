-- Runs inside trafico_db (set via POSTGRES_DB env var)

CREATE TABLE IF NOT EXISTS eventos_trafico (
  id            SERIAL PRIMARY KEY,
  sensor_id     VARCHAR(50)  NOT NULL,
  zona          VARCHAR(20)  NOT NULL,
  tipo_sensor   VARCHAR(20)  NOT NULL,
  valor         JSONB        NOT NULL,
  timestamp     TIMESTAMPTZ  NOT NULL,
  procesado_en  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anomalias (
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

CREATE TABLE IF NOT EXISTS operadores (
  id                  SERIAL PRIMARY KEY,
  username            VARCHAR(50)  UNIQUE NOT NULL,
  email               VARCHAR(255),
  password_hash       VARCHAR(255) NOT NULL,
  zonas_asignadas     TEXT[]       NOT NULL,
  totp_secret         VARCHAR(100),
  totp_habilitado     BOOLEAN      DEFAULT FALSE,
  refresh_token_hash  VARCHAR(255),
  cuenta_bloqueada    BOOLEAN      DEFAULT FALSE,
  intentos_otp        INTEGER      DEFAULT 0,
  ultimo_intento_otp  TIMESTAMPTZ,
  otp_code            VARCHAR(6),
  otp_exp             TIMESTAMPTZ,
  temp_token          TEXT,
  temp_token_exp      TIMESTAMPTZ,
  creado_en           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eventos_zona      ON eventos_trafico(zona);
CREATE INDEX IF NOT EXISTS idx_eventos_timestamp ON eventos_trafico(timestamp);
CREATE INDEX IF NOT EXISTS idx_anomalias_activo  ON anomalias(activo);
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6);
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS otp_exp TIMESTAMPTZ;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS temp_token TEXT;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS temp_token_exp TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_operadores_email ON operadores(email) WHERE email IS NOT NULL;

-- Default operator: admin / admin123
INSERT INTO operadores (username, password_hash, zonas_asignadas)
VALUES (
  'admin',
  '$2a$10$vC2hUvKoZWvukn14oYk2FOS54Kz3Owak.SPhICh4UgOYesirTeppe',
  ARRAY['norte','sur','centro','periferico']
) ON CONFLICT (username) DO NOTHING;
