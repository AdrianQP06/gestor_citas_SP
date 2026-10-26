-- Solicitudes de atención al cliente enviadas desde el portal público de reservas
-- («No encuentro fecha», «Necesito atención urgente»).
--
-- · Es una bandeja interna: el equipo contacta a la persona por teléfono/WhatsApp de forma MANUAL.
--   La aplicación no envía mensajes ni confirma que se haya contactado a nadie; «Atendida» la marca una persona.
-- · Datos mínimos: nombre, teléfono, motivo, mensaje opcional y consentimiento para ser contactado.
-- · Las fechas las escribe la aplicación (sin DEFAULT del motor).
-- · Reversible: basta con DROP TABLE support_requests (ninguna otra tabla depende de ella).

CREATE TABLE IF NOT EXISTS support_requests (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(30) NOT NULL,
  phone_digits  VARCHAR(15) NOT NULL,                       -- solo dígitos: evita duplicados del mismo número
  reason        ENUM('no_date', 'urgent', 'other') NOT NULL,
  message       VARCHAR(300) NULL,
  status        ENUM('pending', 'attended', 'closed') NOT NULL DEFAULT 'pending',
  consent_at    CHAR(24) NOT NULL,                          -- el cliente aceptó que lo contacten
  created_at    CHAR(24) NOT NULL,
  updated_at    CHAR(24) NOT NULL,
  handled_by    INT UNSIGNED NULL,
  handled_at    CHAR(24) NULL,
  staff_note    VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_support_status (status, created_at),
  KEY idx_support_phone (phone_digits, status),
  CONSTRAINT fk_support_handled_by FOREIGN KEY (handled_by) REFERENCES users (id),
  CONSTRAINT ck_support_handled CHECK (status = 'pending' OR (handled_by IS NOT NULL AND handled_at IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
