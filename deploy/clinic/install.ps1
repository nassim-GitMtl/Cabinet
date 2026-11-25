# Cabinet Dentaire Pro — installation hors ligne sous Windows.
# Docker Desktop doit être installé, démarré et configuré pour les conteneurs Linux.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function New-HexSecret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function Assert-LastCommand([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

& docker version | Out-Null
Assert-LastCommand "Docker Desktop doit être installé et démarré."

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
  $defaultAddress = "192.168.1.10"
  try {
    $candidate = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($candidate) { $defaultAddress = $candidate }
  } catch {}

  $clinicAddress = Read-Host "Adresse fixe de ce PC sur le réseau du cabinet [$defaultAddress]"
  if ([string]::IsNullOrWhiteSpace($clinicAddress)) { $clinicAddress = $defaultAddress }

  $content = @"
# Généré par install.ps1. Gardez ce fichier privé et sauvegardé.
CLINIC_HOST=$clinicAddress
DB_OWNER_PASSWORD=$(New-HexSecret 24)
DB_APP_PASSWORD=$(New-HexSecret 24)
DB_SYNC_PASSWORD=$(New-HexSecret 24)
MFA_ENCRYPTION_KEY=$(New-HexSecret 48)
AUTH_RATE_LIMIT_SECRET=$(New-HexSecret 48)
TZ=Africa/Algiers
BACKUP_HOUR=21
BACKUP_KEEP_DAYS=30
BACKUP_DIR=./backups
HTTPS_PORT=443
HTTP_PORT=80
CABINET_SYNC_WORKER=on
"@
  [System.IO.File]::WriteAllText($envPath, $content, $utf8NoBom)
  Write-Host "Fichier .env créé avec des secrets aléatoires."
} else {
  $content = [System.IO.File]::ReadAllText($envPath)
  if ($content -notmatch "(?m)^DB_SYNC_PASSWORD=") {
    [System.IO.File]::AppendAllText($envPath, "`nDB_SYNC_PASSWORD=$(New-HexSecret 24)`n", $utf8NoBom)
  }
  $clinicAddress = (($content -split "`r?`n") | Where-Object { $_ -like "CLINIC_HOST=*" } | Select-Object -First 1) -replace "^CLINIC_HOST=", ""
}

New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "backups") | Out-Null
$images = Get-ChildItem -Path $PSScriptRoot -Filter "cabinet-images*.tar.gz" | Select-Object -First 1
if (-not $images) { throw "Archive cabinet-images introuvable dans ce dossier." }

Write-Host "Chargement des images Docker hors ligne…"
& docker load --input $images.FullName
Assert-LastCommand "Le chargement des images Docker a échoué."

Write-Host "Démarrage de Cabinet Dentaire Pro…"
& docker compose up -d --wait db app proxy backup
Assert-LastCommand "Le démarrage de l'application a échoué."

Write-Host ""
Write-Host "Cabinet Dentaire Pro est prêt : https://$clinicAddress"
Write-Host "Certificat à installer sur chaque appareil : http://$clinicAddress/ca.crt"
Write-Host "Sauvegardes quotidiennes : $PSScriptRoot\backups"
