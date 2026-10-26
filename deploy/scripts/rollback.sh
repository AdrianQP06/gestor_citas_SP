#!/usr/bin/env bash
# Vuelve a una versión anterior ya instalada (ejecutar como root).
#   sudo bash deploy/scripts/rollback.sh            -> la inmediatamente anterior
#   sudo bash deploy/scripts/rollback.sh 20261023-101500   -> una concreta
# OJO: las migraciones solo avanzan. Si la versión más reciente cambió el esquema de forma incompatible,
# restaura también la copia previa (ver docs/DEPLOYMENT.md, «Restaurar una copia»).
set -euo pipefail
APP_DIR=/opt/gestor-citas
[[ $EUID -eq 0 ]] || { echo "Ejecuta como root (sudo)." >&2; exit 1; }

CURRENT="$(readlink -f "$APP_DIR/current")"
if [[ -n "${1:-}" ]]; then
  TARGET="$APP_DIR/releases/$1"
else
  TARGET="$(ls -1dt "$APP_DIR"/releases/* | grep -vx "$CURRENT" | head -n1 || true)"
fi
[[ -d "${TARGET:-}" ]] || { echo "No hay versión de destino." >&2; ls -1 "$APP_DIR/releases"; exit 1; }

echo "Activa:  $CURRENT"
echo "Destino: $TARGET"
ln -sfn "$TARGET" "$APP_DIR/current"
systemctl restart gestor-citas-api gestor-citas-worker
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then echo "OK: versión restaurada."; exit 0; fi
  sleep 1
done
echo "La API no responde tras la reversión: journalctl -u gestor-citas-api -n 100" >&2
exit 1
