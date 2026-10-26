# Gestor de citas

Plataforma para gestionar las citas de una empresa, con dos caras:

- **Panel del equipo** (privado): panel de control, calendario día/semana/mes, listado de citas con búsqueda y filtros, clientes, configuración de horarios y reglas, equipo y registro de actividad.
- **Portal de reservas** (público, sin cuentas): los clientes eligen día y hora disponibles, dejan sus datos y reciben una confirmación con un **enlace seguro** para consultar, reprogramar o cancelar su cita según las reglas configuradas.
- **Reportes** (menú «Reportes»): rendimiento operativo, diario, semanal, mensual, clientes, cancelaciones y reprogramaciones, motivos y próximas citas, con filtros por período, estado y motivo, y **PDF** (vista previa y descarga) con el logotipo y la paleta de Supernova. Ver [docs/REPORTS.md](docs/REPORTS.md).
- **Operaciones** (sección en el detalle de cada cita): registro de depósitos (Daily / Master Business) y reembolsos, método siempre «Efectivo», estados pendiente/confirmada/anulada, historial, recibo PDF e informe para administradores. Es solo un registro: no mueve dinero. Ver [docs/OPERATIONS.md](docs/OPERATIONS.md). Desde la cita hay un acceso rápido al **recibo PDF** (entrega manual al cliente).
- **Atención al cliente**: formulario público (`/reservar/atencion`) y bandeja interna para quien no encuentra fecha o necesita ayuda urgente. Solo registra la solicitud (sin envíos automáticos). Ver [docs/SUPPORT.md](docs/SUPPORT.md).
- **Recordatorios por WhatsApp al equipo** 20 minutos antes de cada cita (configurable), mediante la **API oficial de WhatsApp Business (Meta)**, con cola persistente, reintentos y sin duplicados.

Toda la interfaz está en español y las fechas y horas se muestran en la zona horaria configurada del negocio.

> **Estado honesto.** El flujo de reservas, la gestión, la autenticación, los permisos, la concurrencia y la programación de recordatorios están implementados y probados (ver [Pruebas](#pruebas)). El **envío real a WhatsApp depende de credenciales de Meta que este repositorio no incluye**: arranca en **modo de prueba**, claramente señalizado en la interfaz, donde no se envía nada real. Los scripts de despliegue en DigitalOcean están escritos pero **no se han ejecutado todavía contra un Droplet real**: ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#estado-de-verificación).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend (`web/`) | React 19, Vite, TanStack Router y Query, Tailwind CSS 4, shadcn/ui (base: [shadcn-admin](https://github.com/satnaing/shadcn-admin), MIT), React Hook Form + Zod, Recharts |
| Backend (`server/`) | Node.js 24, [Hono](https://hono.dev), **MySQL 8 / MariaDB 10.4+** (`mysql2`), Zod, Luxon (zonas horarias). TypeScript ejecutado directamente por Node (sin paso de compilación) |
| Despliegue | Droplet de DigitalOcean + Caddy (HTTPS automático) + systemd + MySQL (gestionado de DigitalOcean o local) |

Las decisiones y su motivo están en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Estructura

```
.
├── server/                 Backend (API HTTP versionada + worker de tareas)
│   ├── migrations/         Migraciones SQL numeradas (solo avanzan)
│   ├── src/
│   │   ├── config/         Lectura y validación de variables de entorno
│   │   ├── shared/         Base de datos, errores, logger, fechas, auditoría
│   │   ├── http/           Utilidades HTTP (validación de cuerpos, IP, límites)
│   │   ├── modules/        Módulos de negocio: auth · availability · appointments · customers ·
│   │   │                   dashboard · notifications · portal · settings · users · audit
│   │   │                   (cada uno: *.service.ts, *.routes.ts, *.schemas.ts, *.policy.ts)
│   │   ├── integrations/   Servicios externos (WhatsApp)
│   │   ├── jobs/           Tareas programadas (worker de recordatorios)
│   │   ├── scripts/        migrate · seed · create-admin · backup
│   │   ├── app.ts          Composición de la API (/api/v1) y cabeceras de seguridad
│   │   ├── index.ts        Proceso de la API · worker.ts: proceso del worker
│   └── test/               Pruebas (node:test)
├── web/                    Frontend (SPA)
│   └── src/
│       ├── routes/         Rutas (TanStack Router, ficheros finos)
│       ├── features/       Páginas por área: dashboard · calendar · appointments · customers · settings · portal · auth
│       ├── components/     ui (shadcn) · layout · shared
│       ├── api/            Cliente HTTP y servicios de API (único acceso al backend)
│       ├── types/          Contratos de la API
│       ├── validation/     Validación de formato de formularios (Zod)
│       └── lib/ hooks/ context/
├── deploy/                 Caddyfile, servicios systemd y scripts de despliegue/reversión/copias
├── docs/                   ARCHITECTURE.md · DEPLOYMENT.md
└── .github/workflows/      CI (tipos, lint, pruebas, build)
```

El frontend **solo** habla con el backend por HTTP (`/api/v1`) y no contiene secretos. Todas las reglas de negocio (disponibilidad, solapamientos, plazos, permisos) viven en el backend; el navegador solo valida el *formato* de los formularios.

## Requisitos

- Node.js **24** o superior (`.nvmrc`).
- **MySQL 8 o MariaDB 10.4+** (en Windows sirve el de XAMPP).

## Desarrollo local

1. Arranca MySQL (XAMPP: panel de control → *Start* en MySQL) y crea las bases y el usuario de la aplicación:

   ```sql
   CREATE DATABASE gestor_citas      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE gestor_citas_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;  -- solo para las pruebas
   CREATE USER 'gestor'@'localhost' IDENTIFIED BY 'TU_CLAVE';
   GRANT ALL PRIVILEGES ON gestor_citas.*      TO 'gestor'@'localhost';
   GRANT ALL PRIVILEGES ON gestor_citas_test.* TO 'gestor'@'localhost';
   ```

2. Configura y arranca:

   ```bash
   npm install
   cp .env.example .env        # edita DATABASE_URL y TEST_DATABASE_URL con tu clave
   npm run migrate             # crea las tablas
   npm run seed                # datos de demostración (administrador, equipo, horario y ~60 citas)
   npm run dev                 # API en :3000 y web en http://localhost:5173
   ```

Usuarios de demostración (solo para desarrollo; `npm run seed -- --force` reinicia los datos). **No hay contraseñas fijas en el código**: el seed genera una aleatoria para cada usuario y **la muestra una sola vez en la consola** (anótala). Para el administrador puedes fijarla con `SEED_ADMIN_PASSWORD` en `.env` (mínimo 10 caracteres).

| Rol | Correo |
|---|---|
| Administrador | `admin@demo.local` |
| Equipo | `equipo@demo.local` |

- Panel: <http://localhost:5173> · Portal público: <http://localhost:5173/reservar>
- En desarrollo, el proceso de la API ejecuta también el worker de recordatorios (`REMINDER_WORKER=true`).

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | API + web con recarga |
| `npm test` | Pruebas del backend |
| `npm run typecheck` | Comprobación de tipos (backend y frontend) |
| `npm run lint` | ESLint (frontend) |
| `npm run build` | Compila el frontend en `web/dist` (lo sirve la API en producción) |
| `npm start` / `npm run worker` | API / worker de recordatorios |
| `npm run migrate` | Aplica migraciones pendientes |
| `npm run create-admin` | Crea el primer administrador real (ver despliegue) |
| `npm run backup` | Copia de la base de datos con `mysqldump` (comprimida, con rotación) |

## Pruebas

```bash
npm test
```

Necesitan MySQL en marcha y la base `gestor_citas_test` (`TEST_DATABASE_URL`; se vacía en cada prueba, nunca uses la base real). Cubren, entre otras cosas: la rejilla de disponibilidad (apertura, cierre, descansos, festivos, excepciones, bloqueos, intervalo entre citas, antelación mínima/máxima, zona horaria y cambio de hora), el flujo completo de reserva/consulta/reprogramación/cancelación, la prevención de solapamientos (incluidas reservas simultáneas desde conexiones independientes), las reglas de cancelación del cliente, la autenticación (hash de contraseñas, sesiones, bloqueo por intentos, caducidad, CSRF), los permisos por rol y la programación de recordatorios (un único envío, sin duplicados, ejecuciones concurrentes, reprogramación, cancelación, reintentos con espera, fallos definitivos, caducidad y recuperación tras caídas). El proveedor de WhatsApp se prueba con un `fetch` simulado (no se contacta con Meta).

Además, el frontend se verifica con `npm run typecheck`, `npm run lint` y `npm run build`, y se ha recorrido el flujo completo en un navegador real (reserva, doble reserva simultánea, gestión por enlace, panel, permisos y móvil).

## Configuración

Todo se configura por variables de entorno (ver [`.env.example`](.env.example), sin secretos). Lo que el negocio cambia a diario (horarios, reglas, destinatarios de WhatsApp, equipo) se gestiona desde **Configuración** en el panel.

### Reglas de disponibilidad (todas validadas en el servidor)

- Días laborables, apertura, cierre y un descanso por día. Excepciones por fecha (festivo o horario especial) y bloqueos manuales.
- Duración de las citas e intervalo entre ellas: los horarios son *apertura + k × (duración + intervalo)*.
- Antelación mínima y máxima de reserva, y plazo para que el cliente cancele o reprograme.
- Un horario ocupado no se puede reservar: la comprobación y la inserción ocurren en una transacción con un bloqueo de escritura (`GET_LOCK`) compartido por todos los procesos, más un índice único como red de seguridad.
- Zona horaria del negocio: las citas se guardan en UTC y se muestran siempre en la zona configurada.

### Confirmación de reservas del portal

Por defecto las reservas del portal quedan **pendientes** hasta que el equipo las confirma (opción «Confirmar automáticamente» en *Reglas de reserva*). Si un cliente reprograma una cita confirmada, vuelve a pendiente salvo confirmación automática. Un mismo correo no puede tener más de 3 citas próximas reservadas por el portal.

### WhatsApp

1. **Modo de prueba (por defecto)**: `WHATSAPP_PROVIDER=test`. Los recordatorios se programan y se registran, pero **no se envía ningún mensaje real**. El panel lo muestra en un aviso y en el registro de envíos (etiqueta «Prueba»).
2. **Envío real**: API oficial de **WhatsApp Business Cloud (Meta)**. Necesitas una cuenta de WhatsApp Business, un número, un token permanente y una **plantilla aprobada** (los mensajes iniciados por la empresa lo exigen). Pasos y texto sugerido de la plantilla en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#whatsapp-business-api-meta). Después:

   ```
   WHATSAPP_PROVIDER=meta
   WHATSAPP_TOKEN=…
   WHATSAPP_PHONE_NUMBER_ID=…
   WHATSAPP_TEMPLATE_NAME=recordatorio_cita
   WHATSAPP_TEMPLATE_LANG=es
   ```

   Usa **Configuración → WhatsApp → Enviar prueba** para comprobar que llega. Mientras falten credenciales con `meta`, los recordatorios esperan en cola (no se marcan como fallidos) y caducan si la cita empieza.

Cómo funcionan los recordatorios: al crear/modificar/cancelar una cita se sincroniza una cola persistente (tabla `notifications`) con un recordatorio por destinatario activo y hora programada única (`UNIQUE`), de modo que **no se duplican**. Un worker (proceso aparte en producción) los procesa: cada envío se reclama de forma atómica, se reintenta con espera (1, 2 y 4 min, máx. 4 intentos) ante fallos temporales, y los errores definitivos quedan registrados y visibles en el panel, con botón de reintento.

## Seguridad (resumen)

Contraseñas con scrypt; sesiones en cookie `HttpOnly`/`SameSite=Lax`/`Secure` (en producción) con el token guardado solo como hash; bloqueo tras intentos fallidos; roles `admin`/`equipo`; protección CSRF por origen; límites de peticiones en login y portal; campo trampa anti-bots; enlaces de cita con 192 bits de entropía; validación de entrada con Zod en el servidor; cabeceras de seguridad con CSP estricta (sin recursos de terceros, tipografía autoalojada); registro de operaciones (`audit_log`) y de errores (JSON en stdout y fichero). En producción la app **rechaza arrancar** sin `APP_URL` con HTTPS o con `COOKIE_SECURE=false`.

## Despliegue y documentación

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Droplet de DigitalOcean, HTTPS, servicios, migraciones, copias de seguridad, actualización y reversión.
- [docs/REPORTS.md](docs/REPORTS.md): fórmulas de los indicadores, filtros, PDF y permisos del módulo de reportes.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): registro de depósitos y reembolsos, estados, permisos, recibo PDF y limitaciones.
- [docs/SUPPORT.md](docs/SUPPORT.md): solicitudes de atención al cliente, estados, protecciones y decisiones pendientes.
- [docs/TIMESTAMPS.md](docs/TIMESTAMPS.md): investigación de las marcas de tiempo y qué fechas históricas no son fiables.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): arquitectura, modelo de datos, decisiones y su justificación.

## Control de versiones

El repositorio no está inicializado ni se ha hecho ningún commit. Para publicarlo:

```bash
git init -b main
git add . && git status        # revisa que no aparezcan .env, *.db, node_modules ni dist
git commit -m "Gestor de citas"
git remote add origin git@github.com:TU_USUARIO/TU_REPO.git
git push -u origin main
```

`.gitignore` excluye `.env`, bases de datos, logs, copias de seguridad, `node_modules` y `dist`. Los datos de demostración se generan con `npm run seed` y son ficticios.

## Licencia

La plantilla de interfaz base conserva su licencia MIT (`web/LICENSE`, ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Define aquí la licencia de tu proyecto antes de publicarlo.

## Identidad visual (Supernova)

La interfaz usa la identidad de Supernova, tomada del proyecto principal (`SUPERNOVA-dev`), sin recrear nada:

- **Logotipos oficiales** en `web/public/brand/` (copias sin modificar de `logoSupernova.png`, `logoSupernovaBlanco.png`, `logoSupernovaS.png` y `favicon.ico`; el proyecto principal solo dispone de PNG, no de SVG). Se usan a través de `web/src/components/brand/logo.tsx`.
- **Paleta** en `web/src/styles/theme.css`: azul marino `#040167` (con su escala 50–900), acento dorado `#96731a` reservado a la cifra destacada del panel, fondo `#f8fafc`, texto `#1e293b`/`#64748b`, bordes `#e2e8f0`. Tipografía **Manrope** (autoalojada con `@fontsource-variable/manrope`), bordes `rounded-lg` y sombras con tinte de marca.
- El proyecto principal no tiene modo oscuro ni colores de estado propios: aquí el modo oscuro se deriva de la escala del primario y los estados usan los tonos por defecto de Tailwind (emerald/amber/red), como sus componentes.
- Los iconos siguen siendo Lucide (el proyecto principal usa Material Symbols; cambiarlo exigiría cargar otra fuente de iconos).
- El nombre del negocio (por defecto «Supernova») y su dirección/teléfono se configuran en **Configuración → Negocio**.
