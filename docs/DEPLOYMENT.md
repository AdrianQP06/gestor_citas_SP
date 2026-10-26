# Despliegue en DigitalOcean

Estrategia: **un Droplet Ubuntu 24.04 LTS** con **Caddy** (HTTPS automático), dos servicios **systemd** (API y worker de recordatorios) y **MySQL** (gestionado de DigitalOcean, recomendado, o local en el Droplet). Es reproducible: todo el aprovisionamiento y las actualizaciones se hacen con los scripts de `deploy/`.

## Estado de verificación

| Pieza | Estado |
|---|---|
| Compilación, tipos, lint y pruebas (`npm run typecheck && npm run lint && npm test && npm run build`) | Verificado en local contra MariaDB 10.4 |
| Arranque en modo producción (`NODE_ENV=production`) sirviendo el frontend compilado, CSP, cookie `Secure`/`HttpOnly` | Verificado en local |
| Copia de seguridad con `mysqldump` | Verificada en local |
| `provision.sh`, `deploy.sh`, `rollback.sh`, unidades systemd, Caddyfile | **Escritos y con sintaxis comprobada, pero NO ejecutados en un Droplet real.** Pruébalos primero en un Droplet de pruebas (se puede destruir) antes de poner datos reales |
| Envío real por WhatsApp | **Pendiente de credenciales de Meta.** Verificado solo con un `fetch` simulado |

## 1. Requisitos previos

- Un dominio (o subdominio, p. ej. `citas.tuempresa.com`) cuyo registro DNS **A** apunte a la IP del Droplet.
- El repositorio en GitHub (o cualquier remoto Git accesible desde el Droplet; si es privado, una *deploy key* de solo lectura).
- Opcional pero recomendado: un clúster **MySQL gestionado** de DigitalOcean (Databases → MySQL 8).

## 2. Crear los recursos

1. **Droplet**: Ubuntu 24.04, 1 vCPU / 2 GB bastan. Activa *Backups* del Droplet y añade tu clave SSH (sin contraseña de root por SSH).
2. **Base de datos** (recomendado): clúster MySQL 8 en la misma región. En *Trusted sources* añade **solo** el Droplet. Crea la base `gestor_citas` y un usuario de aplicación (no uses `doadmin`). Descarga el certificado CA y cópialo al Droplet más tarde.
3. **Firewall de DigitalOcean** (Networking → Firewalls) permitiendo solo 22, 80 y 443 entrantes. El script también configura `ufw`.

## 3. Aprovisionar el servidor (una vez)

```bash
ssh root@IP_DEL_DROPLET
git clone https://github.com/TU_USUARIO/TU_REPO.git /root/gestor-citas && cd /root/gestor-citas

# MySQL gestionado (recomendado):
bash deploy/scripts/provision.sh citas.tuempresa.com
# o MySQL en el propio Droplet:
bash deploy/scripts/provision.sh citas.tuempresa.com --with-local-mysql
```

Instala Node 24, Caddy y el cliente de MySQL; crea el usuario de sistema `gestor` (sin shell), los directorios (`/opt/gestor-citas`, `/var/lib/gestor-citas/backups`, `/var/log/gestor-citas`), el cortafuegos, la configuración de Caddy con tu dominio y los servicios systemd.

Después edita **`/etc/gestor-citas/gestor-citas.env`** (permisos `640`, fuera de Git). Con MySQL gestionado:

```
DATABASE_URL=mysql://USUARIO:CLAVE@HOST:25060/gestor_citas
DATABASE_SSL=true
DATABASE_SSL_CA=/etc/gestor-citas/ca-certificate.crt   # copia aquí el CA descargado
```

Valores ya preparados: `NODE_ENV=production`, `HOST=127.0.0.1` (solo escucha en local; Caddy publica), `APP_URL=https://tu-dominio`, `TRUST_PROXY=true`. **La aplicación se niega a arrancar en producción si `APP_URL` no es HTTPS o si `COOKIE_SECURE=false`.**

## 4. Primer despliegue

```bash
bash deploy/scripts/deploy.sh main https://github.com/TU_USUARIO/TU_REPO.git
```

El script, por cada versión: clona en `/opt/gestor-citas/releases/<fecha>` → `npm ci` → comprueba tipos y compila el frontend → **copia de seguridad previa** (si había una versión anterior) → **migra la base de datos** → cambia el enlace `current` → reinicia API y worker → **comprueba `/api/v1/health`** → si algo falla, **vuelve solo a la versión anterior**. Conserva las 5 últimas versiones.

Crea el primer administrador (la contraseña no queda en el historial):

```bash
read -rsp 'Contraseña: ' P; echo
sudo -u gestor env ADMIN_EMAIL=tu@correo.com ADMIN_NAME='Tu Nombre' ADMIN_PASSWORD="$P" \
  bash -c 'set -a; . /etc/gestor-citas/gestor-citas.env; set +a; cd /opt/gestor-citas/current/server && node src/scripts/create-admin.ts'
```

Entra en `https://citas.tuempresa.com`, y en **Configuración** ajusta negocio, zona horaria, horario y reglas. **No ejecutes `npm run seed` en producción** (crea usuarios de demostración).

## 5. Procesos en segundo plano

| Servicio | Qué hace | Comandos |
|---|---|---|
| `gestor-citas-api` | API y web (`REMINDER_WORKER=false`) | `systemctl status gestor-citas-api` · `journalctl -u gestor-citas-api -f` |
| `gestor-citas-worker` | Recordatorios de WhatsApp: cola persistente en MySQL, reintentos, sin duplicados | `systemctl status gestor-citas-worker` · `journalctl -u gestor-citas-worker -f` |
| `gestor-citas-backup.timer` | Copia diaria 03:30 | `systemctl list-timers gestor-citas-backup.timer` |

Ambos servicios se reinician solos (`Restart=always`) y tras reiniciar el servidor. Los recordatorios pendientes viven en la base de datos, no en memoria: una caída o un reinicio no los pierde (los envíos «en curso» huérfanos se recuperan a los 5 min). No hay temporizadores en el navegador ni procesos ligados a una petición HTTP.

## 6. WhatsApp Business API (Meta)

La integración usa la **API oficial (WhatsApp Business Cloud)**. Los mensajes que inicia la empresa —como estos recordatorios— **requieren una plantilla aprobada**.

1. En [Meta for Developers](https://developers.facebook.com) crea una app de tipo *Business* y añade el producto **WhatsApp**. Vincúlala a una cuenta de **Meta Business** verificada.
2. Registra un **número de teléfono** de WhatsApp Business (no puede estar en uso en la app de WhatsApp normal) y apunta su **Phone number ID** (no es el teléfono).
3. Crea un **usuario del sistema** con rol de administrador, asígnale la cuenta de WhatsApp y genera un **token permanente** con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Crea una **plantilla** de categoría *Utilidad*, idioma *Español*, nombre `recordatorio_cita`, con este cuerpo (3 variables, en este orden):

   > Recordatorio: {{1}} tiene cita a las {{2}}. Motivo: {{3}}.

   Espera a que Meta la apruebe.
5. En `/etc/gestor-citas/gestor-citas.env`:

   ```
   WHATSAPP_PROVIDER=meta
   WHATSAPP_TOKEN=...
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_TEMPLATE_NAME=recordatorio_cita
   WHATSAPP_TEMPLATE_LANG=es
   ```

   y reinicia: `systemctl restart gestor-citas-api gestor-citas-worker`.
6. En el panel: **Configuración → WhatsApp**, añade los números del equipo (formato `+34…`) y pulsa **Enviar prueba**. Mientras estés en modo de prueba verás un aviso en el panel y los registros marcados como «Prueba».

Notas: en el entorno de pruebas de Meta solo se puede escribir a números añadidos como destinatarios de prueba. Un número que no pueda recibir mensajes producirá un fallo *definitivo* visible en el registro (con botón de reintento); los fallos temporales (red, límites de tasa) se reintentan solos con espera (1, 2 y 4 min, máx. 4 intentos).

## 7. Actualizar y revertir

```bash
cd /root/gestor-citas && git pull          # solo para tener scripts recientes
bash deploy/scripts/deploy.sh v1.2.0       # rama, etiqueta o commit
```

Si el despliegue falla en la comprobación de salud, vuelve solo a la versión anterior. Para revertir manualmente:

```bash
bash deploy/scripts/rollback.sh            # a la inmediatamente anterior
bash deploy/scripts/rollback.sh 20261023-101500   # a una concreta
```

**Migraciones**: solo avanzan y se aplican antes de cambiar de versión. Escríbelas compatibles hacia atrás (añadir columnas/tablas, no borrar ni renombrar de golpe) para que la versión anterior siga funcionando con el esquema nuevo y la reversión de código sea segura. Si una migración incompatible tuviera que deshacerse, restaura la copia previa (siguiente apartado).

## 8. Copias de seguridad y recuperación

- **Diaria** (`gestor-citas-backup.timer`): `mysqldump --single-transaction` (instantánea consistente sin bloquear), comprimida en `/var/lib/gestor-citas/backups`, últimas 14. Además se hace una **antes de cada migración** durante el despliegue.
- **Fuera del servidor**: si configuras `rclone` hacia DigitalOcean Spaces y `RCLONE_REMOTE=spaces:bucket/ruta` en el fichero de entorno, la copia diaria se sube sola (`deploy/scripts/backup-offsite.sh`; no probado).
- Con **MySQL gestionado** DigitalOcean añade copias diarias con recuperación a un punto en el tiempo; tus volcados son una capa extra.
- Con MySQL local, activa también las *Backups* del Droplet.

**Restaurar una copia**

```bash
systemctl stop gestor-citas-api gestor-citas-worker
gunzip -c /var/lib/gestor-citas/backups/citas-FECHA.sql.gz | mysql -h HOST -u USUARIO -p gestor_citas
systemctl start gestor-citas-api gestor-citas-worker
```

Prueba la restauración en una base de datos vacía **antes** de necesitarla.

## 9. Registros y supervisión

- Errores y operaciones: JSON por línea en `journalctl -u gestor-citas-api` / `-worker` y en `/var/log/gestor-citas/app.log` (rotado semanalmente).
- Operaciones de negocio (accesos, citas, configuración, envíos fallidos): tabla `audit_log`, visible para administradores en **Configuración → Actividad**.
- Accesos HTTP: `/var/log/caddy/gestor-citas.access.log`.
- Salud: `GET https://tu-dominio/api/v1/health`. Configura una alerta de *Uptime* de DigitalOcean (o similar) apuntando a esa URL y otra de CPU/disco del Droplet.
- Recordatorios: el panel muestra un aviso si hay envíos fallidos en la última semana.

## 10. Seguridad: lista de comprobación

- [ ] HTTPS activo (Caddy) y `APP_URL` con `https://`.
- [ ] `/etc/gestor-citas/gestor-citas.env` con permisos `640` (propietario `root:gestor`); nada de secretos en Git.
- [ ] MySQL accesible **solo** desde el Droplet (*Trusted sources* o `bind-address=127.0.0.1`) y con un usuario de aplicación de mínimos privilegios sobre una sola base.
- [ ] `DATABASE_SSL=true` con MySQL gestionado.
- [ ] Firewall: solo 22/80/443; SSH solo con clave (`PasswordAuthentication no`).
- [ ] Contraseñas de administrador únicas y largas; desactiva a quien deje el equipo (Configuración → Equipo).
- [ ] `WHATSAPP_TOKEN` de usuario del sistema con los permisos mínimos; rótalo si se filtra.
- [ ] Actualizaciones de seguridad del sistema (`unattended-upgrades`) y de dependencias (`npm audit`, Dependabot en GitHub).
- [ ] Probada la restauración de una copia.

## 11. Escalar

El diseño admite varias instancias de la API detrás de un balanceador: las sesiones y la cola están en MySQL, los envíos se reclaman con un `UPDATE` atómico, y la serialización de reservas usa un bloqueo de MySQL común. Los límites de peticiones por IP son en memoria (por instancia); con varias instancias conviene moverlos a un almacén compartido o al proxy. Ejecuta **un único worker** salvo que lo necesites: varios son seguros pero innecesarios.
