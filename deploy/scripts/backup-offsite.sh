#!/usr/bin/env bash
# Copia las copias de seguridad a un almacenamiento externo (p. ej. DigitalOcean Spaces) con rclone.
# Es OPCIONAL: si no hay rclone o no se define RCLONE_REMOTE, no hace nada (y no falla).
# Configuración (en /etc/gestor-citas/gestor-citas.env):  RCLONE_REMOTE=spaces:mi-bucket/gestor-citas
set -euo pipefail
[[ -n "${RCLONE_REMOTE:-}" ]] || { echo "backup-offsite: RCLONE_REMOTE no definido; se omite."; exit 0; }
command -v rclone >/dev/null || { echo "backup-offsite: rclone no instalado; se omite."; exit 0; }
rclone copy /var/lib/gestor-citas/backups "$RCLONE_REMOTE" --include 'citas-*.sql.gz' --max-age 3d
echo "backup-offsite: copia enviada a $RCLONE_REMOTE"
