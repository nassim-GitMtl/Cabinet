#!/bin/sh
# Prints a single-use password reset link (valid 2 hours) for a staff account, typically the owner
# when nobody can sign in to create one from Settings → Team.
#   ./reset-password.sh owner@example.com              -> new password only
#   ./reset-password.sh owner@example.com --reset-mfa  -> also turns off two-step verification (lost phone)
# Open the printed link on a computer of the clinic network.
set -eu
cd "$(dirname "$0")"
if [ $# -lt 1 ]; then
  echo "Usage: ./reset-password.sh <email> [--reset-mfa]" >&2
  exit 2
fi
CLINIC_HOST=$(grep '^CLINIC_HOST=' .env | cut -d= -f2-)
docker compose run --rm --no-deps -e APP_URL="https://${CLINIC_HOST}" migrate node scripts/staff-reset-link.mjs "$@"
