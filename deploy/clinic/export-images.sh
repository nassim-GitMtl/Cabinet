#!/bin/sh
# On a machine WITH internet: builds every image the clinic server needs and
# creates a self-contained archive for a client computer with no internet.
#
# Default target is a standard Intel/AMD clinic PC. Override only when needed:
#   TARGET_PLATFORM=linux/arm64 ./export-images.sh
set -eu
cd "$(dirname "$0")"
output_dir=$(pwd)

target_platform="${TARGET_PLATFORM:-linux/amd64}"
case "$target_platform" in
  linux/amd64) target_arch="amd64" ;;
  linux/arm64) target_arch="arm64" ;;
  *) echo "TARGET_PLATFORM doit être linux/amd64 ou linux/arm64." >&2; exit 2 ;;
esac

command -v docker >/dev/null || { echo "Docker est requis pour créer le paquet." >&2; exit 1; }
docker version >/dev/null

temporary_env=""
bundle_tmp=""
cleanup() {
  if [ -n "$temporary_env" ] && [ -f "$temporary_env" ]; then rm -f "$temporary_env"; fi
  if [ -n "$bundle_tmp" ] && [ -d "$bundle_tmp" ]; then rm -rf "$bundle_tmp"; fi
}
trap cleanup EXIT INT TERM

if [ -f .env ]; then
  compose_env=.env
else
  temporary_env=.env.export
  compose_env=$temporary_env
  cat > "$compose_env" <<'ENV'
CLINIC_HOST=x
DB_OWNER_PASSWORD=x
DB_APP_PASSWORD=x
DB_SYNC_PASSWORD=x
MFA_ENCRYPTION_KEY=x
AUTH_RATE_LIMIT_SECRET=x
ENV
fi

if [ "${SKIP_IMAGE_BUILD:-0}" != "1" ]; then
  echo "Construction des images pour ${target_platform}…"
  DOCKER_DEFAULT_PLATFORM="$target_platform" docker compose --env-file "$compose_env" build

  # Docker Desktop's containerd store keeps the multi-platform index tag even
  # after `pull --platform`. `docker save` then asks for every architecture and
  # fails on the variants that were not downloaded. Resolve and retag the exact
  # child manifest so the delivered archive is genuinely single-platform.
  pin_official_image() {
    image="$1"
    repository="${image%:*}"
    digest=$(docker buildx imagetools inspect "$image" --format \
      "{{range .Manifest.Manifests}}{{if and (eq .Platform.OS \"linux\") (eq .Platform.Architecture \"$target_arch\")}}{{.Digest}}{{end}}{{end}}")
    if [ -z "$digest" ]; then
      echo "Manifest $target_platform introuvable pour $image." >&2
      exit 1
    fi
    docker pull "$repository@$digest"
    docker tag "$repository@$digest" "$image"
  }

  pin_official_image postgres:18-alpine
  pin_official_image caddy:2-alpine
else
  echo "Réutilisation contrôlée des images locales pour $target_platform."
fi

for image in cabinet-dentaire-pro:local cabinet-dentaire-pro-migrate:local postgres:18-alpine caddy:2-alpine; do
  image_arch=$(docker image inspect "$image" --format '{{.Architecture}}')
  if [ "$image_arch" != "$target_arch" ]; then
    echo "Architecture incorrecte pour $image : $image_arch (attendu : $target_arch)." >&2
    exit 1
  fi
done

images_archive="cabinet-images.tar.gz"
docker save cabinet-dentaire-pro:local cabinet-dentaire-pro-migrate:local postgres:18-alpine caddy:2-alpine \
  | gzip > "$images_archive"
if command -v sha256sum >/dev/null; then
  sha256sum "$images_archive" > "$images_archive.sha256"
else
  shasum -a 256 "$images_archive" > "$images_archive.sha256"
fi

bundle_tmp=$(mktemp -d "${TMPDIR:-/tmp}/cabinet-offline.XXXXXX")
bundle_root="$bundle_tmp/cabinet-offline"
mkdir -p "$bundle_root/backups" "$bundle_root/initdb"
for file in \
  .env.example Caddyfile backup.sh configure-sync.sh docker-compose.yml install.sh install.ps1 \
  reset-password.sh restore.sh update.sh README-OFFLINE.md; do
  cp "$file" "$bundle_root/$file"
done
cp initdb/01-roles.sh "$bundle_root/initdb/01-roles.sh"
cp "../../docs/INSTALLATION-CABINET.md" "$bundle_root/GUIDE-INSTALLATION-COMPLET.md"
cp "$images_archive" "$images_archive.sha256" "$bundle_root/"

bundle="cabinet-offline-$target_arch.tar.gz"
tar -czf "$bundle" -C "$bundle_tmp" cabinet-offline
if command -v sha256sum >/dev/null; then
  sha256sum "$bundle" > "$bundle.sha256"
else
  shasum -a 256 "$bundle" > "$bundle.sha256"
fi

windows_bundle="cabinet-offline-windows-$target_arch.zip"
if command -v zip >/dev/null; then
  rm -f "$windows_bundle" "$windows_bundle.sha256"
  (cd "$bundle_tmp" && zip -q -0 -r "$output_dir/$windows_bundle" cabinet-offline)
  if command -v sha256sum >/dev/null; then
    sha256sum "$windows_bundle" > "$windows_bundle.sha256"
  else
    shasum -a 256 "$windows_bundle" > "$windows_bundle.sha256"
  fi
else
  echo "Attention : commande zip absente, paquet Windows non créé." >&2
  windows_bundle=""
fi

echo
echo "Paquet client créé : $(pwd)/$bundle"
echo "Empreinte SHA-256 :  $(pwd)/$bundle.sha256"
if [ -n "$windows_bundle" ]; then
  echo "Paquet Windows créé : $(pwd)/$windows_bundle"
  echo "Empreinte Windows :   $(pwd)/$windows_bundle.sha256"
fi
echo "Copiez le paquet adapté au système et son fichier .sha256 sur la clé USB du client."
