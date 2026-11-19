#!/bin/sh
# Daily PostgreSQL + private clinical-file backup into /backups, kept BACKUP_KEEP_DAYS days.
#   docker compose exec backup sh /backup.sh now   -> immediate backup
set -eu
BACKUP_HOUR="${BACKUP_HOUR:-21}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

backup() {
  ts=$(date +%Y%m%d-%H%M%S)
  f="/backups/cabinet-$ts.dump"
  files="/backups/cabinet-$ts-files.tar.gz"
  pg_dump -h db -U cabinet_owner -d cabinet -Fc -f "$f.partial"
  tar -czf "$files.partial" -C /clinical-files .
  mv "$f.partial" "$f"
  mv "$files.partial" "$files"
  (cd /backups && sha256sum "$(basename "$f")" "$(basename "$files")" > "$(basename "$f").sha256")
  find /backups -name 'cabinet-*' -mtime +"$BACKUP_KEEP_DAYS" -delete
  echo "$(date -Iseconds) backup ok: $f + $files ($(du -k "$f" "$files" | awk '{n += $1} END {print n " KiB"}'))"
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
