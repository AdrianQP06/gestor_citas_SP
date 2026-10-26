-- Registro de operaciones (depósitos y reembolsos) vinculado a cada cita.
-- IMPORTANTE: es solo un REGISTRO. La aplicación no mueve dinero ni se integra con pasarelas de pago:
-- registrar un importe no significa que el dinero haya sido recibido o devuelto.
--
-- · Importes en unidades menores enteras (centavos) + moneda explícita: sin decimales binarios.
-- · El método es siempre efectivo: la base de datos lo impone (ENUM de un único valor) además del backend.
-- · Las fechas se escriben desde la aplicación (no hay DEFAULT) para que nunca dependan del reloj del motor.
-- · Una operación no se edita ni se borra: se confirma o se anula, y cada cambio queda en operation_events.

CREATE TABLE IF NOT EXISTS operations (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           CHAR(14) NOT NULL,                          -- identificador único visible: SN-OP-XXXXXXXX
  appointment_id INT UNSIGNED NOT NULL,
  type           ENUM('deposit', 'refund') NOT NULL,
  product        ENUM('daily', 'master_business') NULL,      -- solo depósitos de solicitudes de tarjeta
  amount_minor   BIGINT UNSIGNED NOT NULL,
  currency       CHAR(3) NOT NULL,
  method         ENUM('cash') NOT NULL DEFAULT 'cash',
  reference      VARCHAR(60) NULL,
  status         ENUM('pending', 'confirmed', 'voided') NOT NULL DEFAULT 'pending',
  created_by     INT UNSIGNED NOT NULL,
  created_at     CHAR(24) NOT NULL,
  confirmed_by   INT UNSIGNED NULL,
  confirmed_at   CHAR(24) NULL,
  voided_by      INT UNSIGNED NULL,
  voided_at      CHAR(24) NULL,
  void_reason    VARCHAR(300) NULL,
  updated_at     CHAR(24) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operations_code (code),
  KEY idx_operations_appointment (appointment_id),
  KEY idx_operations_period (created_at, status),
  CONSTRAINT fk_operations_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id),
  CONSTRAINT fk_operations_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_operations_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id),
  CONSTRAINT fk_operations_voided_by FOREIGN KEY (voided_by) REFERENCES users (id),
  CONSTRAINT ck_operations_amount CHECK (amount_minor > 0),
  CONSTRAINT ck_operations_product CHECK ((type = 'deposit' AND product IS NOT NULL) OR (type = 'refund' AND product IS NULL)),
  CONSTRAINT ck_operations_void CHECK (status <> 'voided' OR (voided_by IS NOT NULL AND void_reason IS NOT NULL)),
  CONSTRAINT ck_operations_confirm CHECK (status <> 'confirmed' OR confirmed_by IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Historial de cambios de estado (trazabilidad de confirmaciones y anulaciones).
CREATE TABLE IF NOT EXISTS operation_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id INT UNSIGNED NOT NULL,
  occurred_at  CHAR(24) NOT NULL,
  action       ENUM('created', 'confirmed', 'voided') NOT NULL,
  from_status  ENUM('pending', 'confirmed', 'voided') NULL,
  to_status    ENUM('pending', 'confirmed', 'voided') NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  actor        VARCHAR(190) NOT NULL,                        -- correo del usuario en ese momento
  note         VARCHAR(300) NULL,
  PRIMARY KEY (id),
  KEY idx_operation_events_operation (operation_id, id),
  CONSTRAINT fk_operation_events_operation FOREIGN KEY (operation_id) REFERENCES operations (id),
  CONSTRAINT fk_operation_events_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
