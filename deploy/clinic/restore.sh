#!/bin/sh
# Restores a backup over the current database (a safety backup is taken first).
#   ./restore.sh backups/cabinet-YYYYmmdd-HHMMSS.dump
set -eu
cd "$(dirname "$0")"
f="${1:?usage: ./restore.sh backups/cabinet-....dump}"
[ -f "$f" ] || { echo "Fichier introuvable : $f"; exit 1; }
if [ -f "$f.sha256" ]; then
  (cd "$(dirname "$f")" && sha256sum -c "$(basename "$f").sha256" 2>/dev/null || shasum -a 256 -c "$(basename "$f").sha256")
fi
start=$(date +%s)
echo "1/4 Sauvegarde de sécurité de l'état actuel…"
docker compose exec -T backup sh /backup.sh now
echo "2/4 Arrêt de l'application…"
docker compose stop app
echo "3/4 Restauration…"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U cabinet_owner -d postgres \
  -c "DROP DATABASE IF EXISTS cabinet WITH (FORCE)" -c "CREATE DATABASE cabinet OWNER cabinet_owner" \
  -c "GRANT CONNECT ON DATABASE cabinet TO cabinet_app"
docker compose exec -T db pg_restore -U cabinet_owner -d cabinet --exit-on-error < "$f"
echo "4/4 Redémarrage (migrations éventuelles appliquées automatiquement)…"
docker compose up -d --wait app
echo "Restauration terminée en $(( $(date +%s) - start )) s."
