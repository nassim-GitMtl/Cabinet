#!/bin/sh
# Daily PostgreSQL backup (custom format) into /backups, kept BACKUP_KEEP_DAYS days.
#   docker compose exec backup sh /backup.sh now   -> immediate backup
set -eu
BACKUP_HOUR="${BACKUP_HOUR:-21}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

backup() {
  ts=$(date +%Y%m%d-%H%M%S)
  f="/backups/cabinet-$ts.dump"
  pg_dump -h db -U cabinet_owner -d cabinet -Fc -f "$f.partial"
  mv "$f.partial" "$f"
  (cd /backups && sha256sum "$(basename "$f")" > "$(basename "$f").sha256")
  find /backups -name 'cabinet-*.dump*' -mtime +"$BACKUP_KEEP_DAYS" -delete
  echo "$(date -Iseconds) backup ok: $f ($(du -h "$f" | cut -f1))"
}

if [ "${1:-}" = "now" ]; then
  backup
  exit 0
fi

last=""
while true; do
  today=$(date +%Y%m%d)
  if [ "$(date +%H)" -ge "$BACKUP_HOUR" ] && [ "$last" != "$today" ]; then
    backup && last="$today" || echo "$(date -Iseconds) BACKUP FAILED" >&2
  fi
  sleep 300
done
