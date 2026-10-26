#!/usr/bin/env bash
# Aprovisionamiento ÚNICO de un Droplet Ubuntu 24.04 LTS (ejecutar como root).
#   sudo bash provision.sh citas.tudominio.com [--with-local-mysql]
# Instala Node 24, Caddy y el cliente de MySQL, crea el usuario de servicio, los directorios,
# el cortafuegos y los servicios systemd. Es idempotente: se puede repetir sin romper nada.
#
# Base de datos (elige una):
#   - Recomendado: MySQL gestionado de DigitalOcean (copias automáticas, TLS). Sin flag: el script deja
#     una DATABASE_URL de ejemplo en el fichero de entorno que debes rellenar con la tuya.
#   - --with-local-mysql: instala MySQL en el propio Droplet, crea la base «gestor_citas» y un usuario
#     con contraseña aleatoria (queda en el fichero de entorno). Más barato, pero las copias
#     (nocturnas, ver docs/DEPLOYMENT.md) son tu única red de seguridad: llévalas fuera del servidor.
set -euo pipefail

DOMAIN="${1:-}"
LOCAL_MYSQL=false
[[ "${2:-}" == "--with-local-mysql" ]] && LOCAL_MYSQL=true
[[ -n "$DOMAIN" ]] || { echo "Uso: provision.sh <dominio> [--with-local-mysql]" >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo "Ejecuta como root (sudo)." >&2; exit 1; }

APP_DIR=/opt/gestor-citas
DATA_DIR=/var/lib/gestor-citas
LOG_DIR=/var/log/gestor-citas
ENV_DIR=/etc/gestor-citas
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git ufw debian-keyring debian-archive-keyring apt-transport-https logrotate mysql-client openssl

# --- Node.js 24 (NodeSource) ---
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v24" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# --- Caddy (repositorio oficial) ---
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# --- MySQL local (opcional) ---
DATABASE_URL="mysql://USUARIO:CLAVE@HOST:25060/gestor_citas"
DATABASE_SSL=true
if $LOCAL_MYSQL; then
  apt-get install -y mysql-server
  systemctl enable --now mysql
  DB_PASS="$(openssl rand -hex 16)"
  mysql -e "CREATE DATABASE IF NOT EXISTS gestor_citas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE USER IF NOT EXISTS 'gestor'@'localhost' IDENTIFIED BY '$DB_PASS';
            ALTER USER 'gestor'@'localhost' IDENTIFIED BY '$DB_PASS';
            GRANT ALL PRIVILEGES ON gestor_citas.* TO 'gestor'@'localhost'; FLUSH PRIVILEGES;"
  DATABASE_URL="mysql://gestor:$DB_PASS@127.0.0.1:3306/gestor_citas"
  DATABASE_SSL=false
fi

# --- Usuario de servicio sin shell ni contraseña ---
id gestor &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin gestor
install -d -o gestor -g gestor -m 750 "$APP_DIR" "$APP_DIR/releases" "$DATA_DIR" "$DATA_DIR/backups" "$LOG_DIR"
install -d -o root -g gestor -m 750 "$ENV_DIR"

# --- Fichero de entorno de producción (se rellena a mano; no está en Git) ---
if [[ ! -f "$ENV_DIR/gestor-citas.env" ]]; then
  cat >"$ENV_DIR/gestor-citas.env" <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
APP_URL=https://$DOMAIN
TRUST_PROXY=true
DATABASE_URL=$DATABASE_URL
DATABASE_SSL=$DATABASE_SSL
# Con MySQL gestionado de DigitalOcean: descarga el certificado CA del panel y descomenta la línea siguiente.
# DATABASE_SSL_CA=$ENV_DIR/ca-certificate.crt
LOG_FILE=$LOG_DIR/app.log
SESSION_TTL_HOURS=12
REMINDER_POLL_SECONDS=20
# WhatsApp: empieza en modo de prueba; cámbialo a meta cuando tengas credenciales (ver docs/DEPLOYMENT.md).
WHATSAPP_PROVIDER=test
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TEMPLATE_NAME=recordatorio_cita
WHATSAPP_TEMPLATE_LANG=es
EOF
  chown root:gestor "$ENV_DIR/gestor-citas.env"
  chmod 640 "$ENV_DIR/gestor-citas.env"
  echo ">> Creado $ENV_DIR/gestor-citas.env — revísalo antes del primer despliegue."
  $LOCAL_MYSQL || echo ">> OJO: rellena DATABASE_URL con los datos de tu MySQL gestionado (usuario, clave, host y puerto)."
fi

# --- Cortafuegos: solo SSH, HTTP y HTTPS ---
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- Caddy ---
sed "s/citas.tudominio.com/$DOMAIN/g" "$REPO_DIR/deploy/Caddyfile" >/etc/caddy/Caddyfile
install -d -o caddy -g caddy /var/log/caddy
systemctl enable --now caddy
systemctl reload caddy

# --- Rotación de logs de la aplicación ---
cat >/etc/logrotate.d/gestor-citas <<EOF
$LOG_DIR/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF

# --- systemd ---
install -m 644 "$REPO_DIR"/deploy/systemd/gestor-citas-*.service "$REPO_DIR"/deploy/systemd/gestor-citas-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable gestor-citas-api gestor-citas-worker gestor-citas-backup.timer

echo
echo "Listo. Siguientes pasos:"
echo "  1) Edita $ENV_DIR/gestor-citas.env si hace falta."
echo "  2) Despliega:  sudo bash deploy/scripts/deploy.sh <rama-o-tag>"
echo "  3) Crea el primer administrador (la contraseña no queda en el historial):"
echo "       read -rsp 'Contraseña: ' P; echo"
echo "       sudo -u gestor env ADMIN_EMAIL=tu@correo.com ADMIN_NAME='Tu Nombre' ADMIN_PASSWORD=\"\$P\" \\"
echo "         bash -c 'set -a; . $ENV_DIR/gestor-citas.env; set +a; cd $APP_DIR/current/server && node src/scripts/create-admin.ts'"
