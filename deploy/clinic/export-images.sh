#!/bin/sh
# On a machine WITH internet: builds every image the clinic server needs and
# writes cabinet-images.tar.gz for an installation with no internet at all.
set -eu
cd "$(dirname "$0")"
[ -f .env ] || printf 'CLINIC_HOST=x\nDB_OWNER_PASSWORD=x\nDB_APP_PASSWORD=x\nMFA_ENCRYPTION_KEY=x\n' > .env.export
docker compose --env-file "$( [ -f .env ] && echo .env || echo .env.export )" build
docker pull postgres:18-alpine
docker pull caddy:2-alpine
docker save cabinet-dentaire-pro:local cabinet-dentaire-pro-migrate:local postgres:18-alpine caddy:2-alpine | gzip > cabinet-images.tar.gz
rm -f .env.export
echo "Créé : $(pwd)/cabinet-images.tar.gz — copiez-le avec ce dossier sur le serveur du cabinet."
