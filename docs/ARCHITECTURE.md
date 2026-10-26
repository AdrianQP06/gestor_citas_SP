# Arquitectura

## Vista general

```
 Navegador ──HTTPS──► Caddy ──► API Node (Hono) ──► MySQL 8 / MariaDB ◄── Worker Node (recordatorios)
   SPA React            │        /api/v1/*                                   │
   (web/dist servida    │        + sirve web/dist                            └─► WhatsApp Cloud API (Meta)
    por la API)         └─ certificados TLS automáticos
```

- **Un solo despliegue sencillo, sin microservicios.** Dos procesos del mismo código: la **API** (HTTP) y el **worker** (tareas programadas). Comparten la base de datos MySQL.
- El **frontend es una SPA** que solo se comunica con la API mediante HTTP (`/api/v1`). No accede a la base de datos ni contiene secretos.
- Todas las **reglas de negocio están en el backend**. El frontend valida únicamente el formato de los formularios (respuesta inmediata) y muestra los mensajes de error que devuelve el servidor, sin duplicar reglas.

## Backend (`server/src`)

Organizado por **módulos de negocio**; dentro de cada uno, capas con una responsabilidad clara:

| Fichero | Responsabilidad |
|---|---|
| `*.routes.ts` | «Controlador»: traduce HTTP ↔ servicio, aplica la política de autorización y valida la entrada |
| `*.service.ts` | Lógica de negocio y acceso a datos (SQL) del módulo |
| `*.schemas.ts` | Validaciones Zod de entrada |
| `auth.policy.ts` | **Políticas de autorización** (`requireAuth(db)`, `requireAuth(db, 'admin')`) y cookies de sesión |

| Módulo | Contenido |
|---|---|
| `availability` | Cálculo de horarios libres y validación de reservas (única fuente de verdad) |
| `appointments` | Alta, edición, estados, reprogramación, cancelación, listado y calendario |
| `portal` | API pública para reservar y gestionar una cita por enlace seguro |
| `customers` | Directorio e historial |
| `settings` | Negocio, reglas, horario semanal, excepciones y bloqueos |
| `notifications` | Cola de recordatorios, destinatarios, registro de envíos |
| `auth`, `users`, `audit` | Acceso, equipo y registro de actividad |
| `dashboard` | Indicadores del panel |
| `reports` | Informes (cálculos puros en `reports.metrics.ts`, consultas de solo lectura, generación de PDF con PDFKit en `pdf/`) |

Otras carpetas: `integrations/whatsapp` (proveedor externo tras una interfaz), `jobs` (tarea programada), `shared` (BD, errores, logger, fechas, auditoría), `http` (utilidades), `config` (entorno validado), `scripts` (migrar, sembrar, crear administrador, copias).

**Contrato de API versionado**: todo cuelga de `/api/v1`. Un cambio incompatible se publicaría como `/api/v2` manteniendo `v1` mientras haya clientes. El frontend fija la versión en `web/src/api/client.ts` y los tipos del contrato están en `web/src/types/api.ts`.

### Endpoints principales

| Área | Rutas (`/api/v1/…`) | Acceso |
|---|---|---|
| Auth | `POST auth/login`, `POST auth/logout`, `GET auth/me`, `POST auth/password` | público / sesión |
| Portal | `GET public/info`, `GET public/availability/{days,slots}`, `POST public/appointments`, `GET public/appointments/:token`, `POST …/:token/{cancel,reschedule}` | público (limitado por IP) |
| Citas | `GET/POST appointments`, `GET/PATCH appointments/:id`, `POST appointments/:id/{confirm,complete,cancel,reschedule}`, `GET calendar`, `GET availability/{days,slots}` | sesión |
| Clientes | `GET customers`, `GET/PATCH customers/:id` | sesión |
| Panel | `GET dashboard` | sesión |
| Configuración | `GET/PUT settings`, `PUT settings/week`, `GET/PUT/DELETE settings/exceptions`, `GET/POST/DELETE settings/blocks` | lectura: sesión; escritura: admin (bloqueos: sesión) |
| WhatsApp | `GET/POST/PATCH/DELETE whatsapp/recipients`, `POST whatsapp/test`, `GET notifications`, `POST notifications/:id/retry` | lectura y reintento: sesión; resto: admin |
| Equipo y registro | `users`, `audit` | admin |
| Reportes | `GET reports/options`, `GET reports/:type`, `GET reports/:type/pdf` (ver [REPORTS.md](REPORTS.md)) | sesión; `clients` y `operations` solo admin |
| Atención al cliente | `POST public/support-requests` (público), `GET support-requests`, `POST support-requests/:id/attend` y `/close` (ver [SUPPORT.md](SUPPORT.md)) | alta pública con límite por IP; bandeja con sesión |
| Operaciones | `GET/POST operations`, `GET operations/:id`, `POST operations/:id/confirm`, `POST operations/:id/void`, `GET operations/:id/receipt` (ver [OPERATIONS.md](OPERATIONS.md)) | sesión; confirmar solo admin |

Errores uniformes: `{ "error": { "code", "message", "fields?" } }` con 400 (validación), 401, 403, 404, 409 (conflicto: horario ocupado, estado no válido…), 429 y 500 (sin detalles internos).

## Modelo de datos (MySQL / MariaDB)

`users`, `sessions` (solo hash del token), `settings` (JSON validado), `working_hours`, `exceptions` (festivos/horario especial), `blocks`, `customers` (único por correo), `appointments`, `notification_recipients`, `notifications` (cola), `audit_log`, `schema_migrations`.

- Instantes absolutos en **UTC (ISO 8601)**. Horas de apertura y fechas de excepción son **locales** a la zona del negocio. El servidor entrega a la API también `date`/`time` ya convertidos, de modo que el frontend nunca hace aritmética de zonas.
- `appointments`: estados `pending → confirmed → completed` o `cancelled`; origen `staff`/`portal`; `public_token` (192 bits) para el enlace del cliente.
- Índice único sobre una columna generada (`active_start`, que vale `starts_at` solo si la cita está activa) como red de seguridad frente a duplicados exactos (MySQL no tiene índices parciales).
- Migraciones SQL numeradas en `server/migrations`, aplicadas una a una bajo un bloqueo (`GET_LOCK`) y registradas en `schema_migrations`. Los DDL de MySQL no son transaccionales, por eso se escriben con `IF NOT EXISTS` y pueden repetirse si se interrumpen. **Solo avanzan** (la reversión es de código + restauración de copia si hace falta).

## Disponibilidad y concurrencia

`availability.service.ts` calcula, para una fecha local, todos los horarios candidatos (`apertura + k·(duración+intervalo)`) y para cada uno si está libre y, si no, **por qué** (pasado, poca antelación, demasiado lejos, cerrado, descanso, bloqueado, ocupado). La **misma función** alimenta el listado que ven los clientes y la validación al reservar, así que no hay dos versiones de la regla.

Al crear o mover una cita se ejecuta `tx()` (`shared/db.ts`): toma un **bloqueo nombrado de MySQL** (`GET_LOCK`, común a todas las conexiones y procesos) *antes* de abrir la transacción y lo libera *después* de confirmarla; así los escritores se serializan y cada uno ve lo confirmado por el anterior. Dentro: se re-valida el horario, se comprueba el límite por correo, se inserta y se sincronizan los recordatorios, todo atómico. Si dos personas piden el mismo hueco, la segunda recibe `409 slot_unavailable` y la interfaz le devuelve a la selección con la disponibilidad actualizada. Hay pruebas con **peticiones simultáneas desde dos pools de conexiones independientes**. Las consultas dentro de `tx()` usan automáticamente la conexión de la transacción (`AsyncLocalStorage`).

Reglas para el personal frente al portal: el personal ignora la antelación mínima/máxima pero no puede reservar fuera de horario, en descansos, festivos, bloqueos ni sobre otra cita.

## Recordatorios (cola persistente + worker)

1. Cada cambio de una cita llama a `reconcileAppointment`: crea (o reactiva) un recordatorio por destinatario activo con `scheduled_for = inicio − reminder_minutes`, y **cancela** los pendientes que ya no corresponden (cita cancelada, movida, destinatario pausado). `UNIQUE (cita, destinatario, tipo, scheduled_for)` + `ON CONFLICT` garantizan **idempotencia**.
2. El **worker** (`jobs/reminder-worker.ts`, cada 20 s) llama a `processDueNotifications`: recupera envíos «en curso» huérfanos por una caída, caduca los de citas ya iniciadas, **reclama** cada envío con un `UPDATE … WHERE status='pending'` atómico y envía. Resultado: `sent` (con proveedor e id de mensaje), reintento con espera (60/120/240 s, máx. 4 intentos) para errores temporales (red, 429, 5xx), o `failed` para los permanentes, con `audit_log` y visibilidad en el panel (botón de reintento).
3. Sin credenciales reales, los recordatorios esperan en cola sin marcarse como fallidos.
4. No depende del navegador ni de ninguna petición HTTP: es un proceso con reinicio automático (systemd). Semántica *at-least-once*: un fallo justo entre el envío y el registro podría repetir un aviso; es el compromiso estándar de cualquier cola.

El proveedor está tras la interfaz `WhatsAppProvider`: `MetaWhatsAppProvider` (API oficial, plantilla con 3 parámetros: cliente, hora, motivo) y `TestWhatsAppProvider` (no envía nada, declarado como modo de prueba).

## Frontend (`web/src`)

| Carpeta | Contenido |
|---|---|
| `routes/` | Rutas TanStack Router por ficheros (finas: guardas de sesión/rol y validación de parámetros de URL) |
| `features/` | Páginas por área, con sus componentes y consultas |
| `components/ui` | shadcn/ui (de la plantilla) · `layout/` (barra lateral, cabecera) · `shared/` (selector de horarios, badges, estados vacíos…) |
| `api/` | `client.ts` (axios + errores normalizados) y `services.ts` (una función por endpoint) |
| `types/` | Contrato de la API |
| `validation/` | Validación de formato (Zod) y volcado de errores del servidor a los campos |

Estado de servidor con TanStack Query (caché, invalidación tras cada cambio, estados de carga y error). Estado de interfaz en URL cuando es compartible (vista/fecha del calendario, filtros del listado).

## Seguridad

- **Autenticación**: correo + contraseña (scrypt con sal); sesión opaca de 256 bits en cookie `HttpOnly` + `SameSite=Lax` + `Secure` (producción); en BD solo su SHA-256; caducidad (12 h por defecto); cambiar la contraseña o desactivar a un usuario cierra sus sesiones; bloqueo de 15 min tras 8 intentos fallidos por IP+correo; mensaje de error genérico y tiempo de respuesta homogéneo.
- **Autorización**: roles `admin` y `staff` aplicados en el servidor con políticas por ruta; el último administrador activo no se puede degradar ni desactivar.
- **CSRF**: `SameSite=Lax` + comprobación de `Origin` en peticiones que modifican datos (mismo host o `APP_URL`) + cuerpos JSON.
- **Portal público**: límites por IP (reservas, consultas, cambios), campo trampa, máximo de citas próximas por correo, tokens de 192 bits, y la vista pública nunca incluye notas internas.
- **Datos personales**: acceso solo con sesión; el portal solo devuelve al titular del enlace los datos de su propia cita; auditoría de operaciones; los logs de errores no incluyen cuerpos de petición.
- **Cabeceras**: CSP estricta, HSTS (producción), `frame-ancestors 'none'`, `Permissions-Policy`, `no-store` en la API. Sin recursos de terceros (tipografía autoalojada → sin envío de IP a Google Fonts).
- **Configuración**: validada al arrancar; en producción exige HTTPS y cookie segura; secretos solo por entorno.
- `X-Forwarded-For` solo se usa con `TRUST_PROXY=true` (detrás de Caddy); si no, se usa la IP del socket.

## Decisiones técnicas (ADR resumidos)

1. **MySQL / MariaDB.** Datos relacionales con transacciones ACID, restricciones e índices únicos, disponible en local (XAMPP) y como servicio gestionado de DigitalOcean (copias automáticas, alta disponibilidad, TLS). Se accede con `mysql2` (pool) y SQL explícito concentrado en los `*.service.ts`. Las fechas se guardan como texto ISO-8601 UTC de 24 caracteres (`CHAR(24)`), de modo que se ordenan y comparan como cadenas sin depender de la zona horaria del servidor ni del driver. La serialización de escritores usa `GET_LOCK` (MySQL 5.7+/8 y MariaDB), que funciona igual con varios procesos. *Compatibilidad*: probado con MariaDB 10.4; el esquema usa solo construcciones comunes a MySQL 8 (columna generada virtual con índice único, valores por defecto con expresión, `ENUM`).
2. **Droplet + systemd + Caddy.** Procesos en segundo plano de primera clase (el worker), HTTPS automático con Caddy y un procedimiento de despliegue transparente. Al ser la aplicación sin estado (los datos viven en MySQL), App Platform también sería viable (API como servicio web y worker como *worker component*, con MySQL gestionado); no se ha elegido por el control y la facilidad de depuración de un Droplet.
3. **Cola en la propia base de datos (outbox) en lugar de Redis/BullMQ.** Es persistente, transaccional con la cita (se sincroniza en la misma transacción) y no añade infraestructura.
4. **Worker como proceso aparte en producción** (`gestor-citas-worker`): aísla las tareas programadas del ciclo de peticiones y se reinicia solo. En desarrollo puede ir embebido.
5. **TypeScript sin compilación en el backend** (type stripping de Node 24): menos piezas, arranque directo; los tipos se comprueban con `tsc --noEmit` y en CI.
6. **Hono** (ligero, estándar Web) en lugar de un framework mayor: se necesita enrutado, middleware y poco más.
7. **Una sola fuente de verdad para la disponibilidad** (ver arriba) para impedir divergencias entre lo que se ofrece y lo que se acepta.
8. **Clientes únicos por correo**: reserva repetida del mismo correo reutiliza la ficha y actualiza nombre y teléfono (gana el último dato).

## Alcance deliberadamente fuera

Facturación, pagos, CRM avanzado, multi-empleado/recursos con agendas paralelas, envío de correos al cliente (el enlace seguro se muestra al reservar y puede compartirse; añadir SMTP sería la ampliación natural) y recordatorios al cliente final por WhatsApp (los avisos van al equipo, como se pidió).
