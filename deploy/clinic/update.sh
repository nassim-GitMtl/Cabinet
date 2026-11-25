#!/bin/sh
# Updates the application: backup first, then new images, then restart (migrations run automatically).
set -eu
cd "$(dirname "$0")"
# Older installations predate the dedicated limiter key. Add one without changing any existing secret.
if ! grep -q '^AUTH_RATE_LIMIT_SECRET=' .env; then
  secret=$(openssl rand -hex 48 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
  printf '\nAUTH_RATE_LIMIT_SECRET=%s\n' "$secret" >> .env
  chmod 600 .env
fi
# Sync was added after the first clinic-server release. Existing installs get
# a distinct login secret without changing either existing database password.
if ! grep -q '^DB_SYNC_PASSWORD=' .env; then
  sync_secret=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  printf '\nDB_SYNC_PASSWORD=%s\n' "$sync_secret" >> .env
  chmod 600 .env
fi
docker compose exec -T backup sh /backup.sh now
if [ -f cabinet-images.tar.gz ]; then gunzip -c cabinet-images.tar.gz | docker load; else docker compose build; fi
docker compose up -d --wait db app proxy backup
echo "Mise à jour terminée."
