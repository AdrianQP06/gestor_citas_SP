-- Esquema inicial (MySQL 8 / MariaDB 10.4+). Todas las fechas/horas absolutas se guardan en UTC como
-- texto ISO 8601 de 24 caracteres ("2026-10-23T15:40:59.139Z"): se ordenan y comparan como cadenas.
-- Las horas de apertura ("HH:mm") y las fechas de excepciones ("YYYY-MM-DD") son locales a la zona
-- horaria del negocio (settings.data.timezone).
--
-- Los DDL de MySQL no son transaccionales: las sentencias usan IF NOT EXISTS para que una migración
-- interrumpida pueda repetirse.

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(190) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin', 'staff') NOT NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  expires_at CHAR(24) NOT NULL,
  created_at CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Una única fila (id = 1) con la configuración del negocio como JSON validado por la app.
CREATE TABLE IF NOT EXISTS settings (
  id   TINYINT UNSIGNED NOT NULL,
  data MEDIUMTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS working_hours (
  weekday     TINYINT UNSIGNED NOT NULL, -- 1 = lunes ... 7 = domingo (ISO)
  enabled     TINYINT(1) NOT NULL DEFAULT 0,
  open_time   CHAR(5) NOT NULL DEFAULT '09:00',
  close_time  CHAR(5) NOT NULL DEFAULT '18:00',
  break_start CHAR(5) NULL,
  break_end   CHAR(5) NULL,
  PRIMARY KEY (weekday),
  CONSTRAINT ck_working_hours_weekday CHECK (weekday BETWEEN 1 AND 7)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Excepciones por fecha: festivos (closed = 1) u horario especial.
CREATE TABLE IF NOT EXISTS exceptions (
  `date`      CHAR(10) NOT NULL,
  closed      TINYINT(1) NOT NULL DEFAULT 1,
  open_time   CHAR(5) NULL,
  close_time  CHAR(5) NULL,
  break_start CHAR(5) NULL,
  break_end   CHAR(5) NULL,
  label       VARCHAR(80) NOT NULL DEFAULT '',
  PRIMARY KEY (`date`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Bloqueos manuales de un tramo concreto.
CREATE TABLE IF NOT EXISTS blocks (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  starts_at CHAR(24) NOT NULL,
  ends_at   CHAR(24) NOT NULL,
  reason    VARCHAR(120) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_blocks_range (starts_at, ends_at),
  CONSTRAINT ck_blocks_range CHECK (ends_at > starts_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name  VARCHAR(100) NOT NULL,
  phone      VARCHAR(30) NOT NULL,
  email      VARCHAR(190) NOT NULL,
  notes      VARCHAR(2000) NOT NULL DEFAULT '',
  created_at CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  updated_at CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_token   CHAR(32) NOT NULL,
  customer_id    INT UNSIGNED NOT NULL,
  starts_at      CHAR(24) NOT NULL,
  ends_at        CHAR(24) NOT NULL,
  reason         VARCHAR(300) NOT NULL,
  internal_notes VARCHAR(1000) NOT NULL DEFAULT '',
  status         ENUM('pending', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending',
  source         ENUM('staff', 'portal') NOT NULL,
  cancelled_by   ENUM('staff', 'client') NULL,
  cancel_reason  VARCHAR(300) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  updated_at     CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  -- Red de seguridad frente a duplicados exactos: solo las citas activas ocupan el instante (NULL no choca).
  -- El solapamiento general se valida en una transacción con bloqueo (ver shared/db.ts, tx).
  active_start   CHAR(24) GENERATED ALWAYS AS (IF(status IN ('pending', 'confirmed', 'completed'), starts_at, NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_appointments_token (public_token),
  UNIQUE KEY uq_appointments_active_start (active_start),
  KEY idx_appointments_start (starts_at),
  KEY idx_appointments_customer (customer_id),
  KEY idx_appointments_status (status, starts_at),
  CONSTRAINT fk_appointments_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_appointments_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT ck_appointments_range CHECK (ends_at > starts_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_recipients (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(60) NOT NULL,
  phone      VARCHAR(20) NOT NULL, -- E.164, ej. +34600111222
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  PRIMARY KEY (id),
  UNIQUE KEY uq_recipients_phone (phone)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Cola de recordatorios (outbox). La unicidad evita enviar dos veces el mismo recordatorio.
CREATE TABLE IF NOT EXISTS notifications (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  appointment_id      INT UNSIGNED NOT NULL,
  recipient_id        INT UNSIGNED NOT NULL,
  kind                VARCHAR(20) NOT NULL DEFAULT 'reminder',
  scheduled_for       CHAR(24) NOT NULL,
  status              ENUM('pending', 'sending', 'sent', 'failed', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
  attempts            INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at     CHAR(24) NOT NULL,
  last_error          TEXT NULL,
  provider            VARCHAR(10) NULL,
  provider_message_id VARCHAR(190) NULL,
  sent_at             CHAR(24) NULL,
  created_at          CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  updated_at          CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_slot (appointment_id, recipient_id, kind, scheduled_for),
  KEY idx_notifications_due (status, next_attempt_at),
  KEY idx_notifications_recipient (recipient_id),
  CONSTRAINT fk_notifications_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES notification_recipients (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at CHAR(24) NOT NULL DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  actor      VARCHAR(190) NOT NULL, -- email del usuario, 'cliente (portal)' o 'sistema'
  action     VARCHAR(60) NOT NULL,
  entity     VARCHAR(40) NOT NULL,
  entity_id  VARCHAR(60) NULL,
  detail     TEXT NULL,             -- JSON
  ip         VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
