# Installation hors ligne chez le client

Ce dossier contient l'application complète, PostgreSQL, le proxy HTTPS et les tâches de sauvegarde. Aucune connexion
internet n'est nécessaire pendant l'installation, mais **Docker doit être installé avant le déplacement chez le client**.

## Prérequis

- Ordinateur 64 bits, 8 Go de RAM conseillés, SSD avec chiffrement activé. Utilisez le paquet `amd64` pour un
  PC Intel/AMD ou un Mac Intel, et `arm64` pour un Mac Apple Silicon (M1/M2/M3/M4).
- Adresse IP fixe réservée dans le routeur du cabinet.
- Windows : Docker Desktop démarré en mode « Linux containers ».
- Linux : Docker Engine avec le plugin Compose.
- Un disque externe pour copier régulièrement le dossier `backups`.

## Vérifier la clé USB

Le fichier livré avec ce dossier possède une empreinte `.sha256`. Sous Linux :

```bash
sha256sum -c cabinet-offline-amd64.tar.gz.sha256
```

Sous macOS, utilisez la ligne correspondant au processeur :

```bash
# Mac Intel
shasum -a 256 -c cabinet-offline-amd64.tar.gz.sha256
# Mac Apple Silicon (M1/M2/M3/M4)
shasum -a 256 -c cabinet-offline-arm64.tar.gz.sha256
```

Sous Windows PowerShell, comparez le résultat avec le contenu du fichier `.sha256` :

```powershell
Get-FileHash .\cabinet-offline-windows-amd64.zip -Algorithm SHA256
```

## Installer sous Windows

1. Dans l'Explorateur de fichiers, faites un clic droit sur `cabinet-offline-windows-amd64.zip`, choisissez
   « Extraire tout », puis ouvrez le dossier `cabinet-offline` extrait. Aucun logiciel de décompression supplémentaire
   n'est nécessaire.
2. Démarrez Docker Desktop et attendez l'indication « Engine running ».
3. Ouvrez PowerShell dans ce dossier puis exécutez :

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Installer sous Linux ou macOS

```bash
chmod +x *.sh
./install.sh
```

## Premier accès

Le programme affiche l'adresse finale, par exemple `https://192.168.1.10`. Sur chaque téléphone ou PC du cabinet,
installez d'abord le certificat indiqué (`http://192.168.1.10/ca.crt`), puis ouvrez l'adresse HTTPS.

- **Cabinet avec copie cloud :** ne créez rien localement. Sur le cloud, ouvrez Paramètres → Ordinateur du cabinet,
  créez le code, puis ouvrez `/sync-setup` sur le serveur local.
- **Cabinet uniquement local :** créez directement le premier cabinet. Il ne pourra pas être jumelé automatiquement
  plus tard sans repartir d'une base locale vide.

Consultez `GUIDE-INSTALLATION-COMPLET.md` pour les sauvegardes, la restauration, les mises à jour et les mots de passe.
