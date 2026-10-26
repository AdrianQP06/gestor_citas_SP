#!/usr/bin/env bash
# Despliegue reproducible con reversión automática (ejecutar como root en el Droplet).
#   sudo bash deploy/scripts/deploy.sh <rama|tag|commit> [url-del-repo]
#
# Cada versión vive en /opt/gestor-citas/releases/<fecha> y /opt/gestor-citas/current apunta a la activa.
# Pasos: clonar → instalar → compilar → copia de seguridad previa → migrar → cambiar enlace →
# reiniciar → comprobar salud. Si la comprobación falla, vuelve sola a la versión anterior.
set -euo pipefail

REF="${1:?Uso: deploy.sh <rama|tag|commit> [url-del-repo]}"
REPO_URL="${2:-${GESTOR_REPO_URL:-}}"
APP_DIR=/opt/gestor-citas
ENV_FILE=/etc/gestor-citas/gestor-citas.env
KEEP_RELEASES=5

[[ $EUID -eq 0 ]] || { echo "Ejecuta como root (sudo)." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Falta $ENV_FILE (ejecuta provision.sh primero)." >&2; exit 1; }
if [[ -z "$REPO_URL" ]]; then
  REPO_URL="$(git -C "$(dirname "${BASH_SOURCE[0]}")/../.." remote get-url origin 2>/dev/null || true)"
fi
[[ -n "$REPO_URL" ]] || { echo "Indica la URL del repositorio (2.º argumento o GESTOR_REPO_URL)." >&2; exit 1; }

RELEASE="$APP_DIR/releases/$(date +%Y%m%d-%H%M%S)"
PREVIOUS="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
as_gestor() { runuser -u gestor -- "$@"; }
run_env() { runuser -u gestor -- bash -c "set -a && . $ENV_FILE && set +a && cd $RELEASE/server && $*"; }

healthy() {
  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

rollback() {
  echo "!! El despliegue ha fallado. Volviendo a la versión anterior…" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$APP_DIR/current"
    systemctl restart gestor-citas-api gestor-citas-worker || true
    healthy && echo "Versión anterior restaurada: $PREVIOUS" >&2 || echo "¡La versión anterior tampoco responde! Revisa: journalctl -u gestor-citas-api" >&2
  else
    echo "No había versión anterior a la que volver." >&2
  fi
  exit 1
}

echo ">> 1/7 Obteniendo $REF"
install -d -o gestor -g gestor "$RELEASE"
as_gestor git clone --quiet "$REPO_URL" "$RELEASE"
as_gestor git -C "$RELEASE" checkout --quiet "$REF"

echo ">> 2/7 Instalando dependencias (npm ci)"
as_gestor bash -c "cd $RELEASE && npm ci --no-audit --no-fund"

echo ">> 3/7 Compilando el frontend y comprobando tipos"
as_gestor bash -c "cd $RELEASE && npm run typecheck && npm run build"

echo ">> 4/7 Copia de seguridad previa a la migración"
if [[ -n "$PREVIOUS" ]]; then # en el primer despliegue aún no hay datos que copiar
  run_env "node src/scripts/backup.ts /var/lib/gestor-citas/backups"
fi

echo ">> 5/7 Aplicando migraciones"
run_env "node src/scripts/migrate.ts" || { echo "Falló la migración; no se cambia nada." >&2; exit 1; }

echo ">> 6/7 Activando la nueva versión"
ln -sfn "$RELEASE" "$APP_DIR/current"
systemctl restart gestor-citas-api gestor-citas-worker
systemctl reload caddy || true

echo ">> 7/7 Comprobando salud"
healthy || rollback
systemctl is-active --quiet gestor-citas-worker || rollback

# Limpieza de versiones antiguas
ls -1dt "$APP_DIR"/releases/* | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf
echo "OK. Versión activa: $RELEASE"
