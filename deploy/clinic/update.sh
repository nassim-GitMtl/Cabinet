#!/bin/sh
# Updates the application: backup first, then new images, then restart (migrations run automatically).
set -eu
cd "$(dirname "$0")"
docker compose exec -T backup sh /backup.sh now
if [ -f cabinet-images.tar.gz ]; then gunzip -c cabinet-images.tar.gz | docker load; else docker compose build; fi
docker compose up -d --wait db app proxy backup
echo "Mise à jour terminée."
