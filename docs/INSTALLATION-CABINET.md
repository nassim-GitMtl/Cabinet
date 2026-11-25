# Installation sur un serveur du cabinet (sans internet)

Cabinet Dentaire Pro peut fonctionner **entièrement sur le réseau du cabinet**. Un ordinateur sert de
serveur ; téléphones, tablettes et PC s'y connectent par le Wi-Fi du cabinet. Une coupure d'internet
n'interrompt rien : agenda, patients, actes, factures, paiements, caisse et rapports continuent de fonctionner.

> English summary: one machine runs the stack (`deploy/clinic`, Docker): PostgreSQL, the app, Caddy
> (HTTPS with a local CA) and a daily backup job. Devices use it over the clinic LAN; no internet needed.

## Ce qui fonctionne sans internet / ce qui en a besoin

| Sans internet (réseau du cabinet) | Nécessite internet |
| --- | --- |
| Toute l'application du personnel : agenda, accueil, patients, actes, plans de traitement, factures, paiements, caisse, dépenses, rapports, impressions, comptes et rôles, double authentification | Liens de prise de rendez-vous en ligne pour les patients **depuis chez eux** |
| Sauvegardes automatiques sur le serveur | Portail patient et page publique du cabinet (`/c/…`, affiche QR) accessibles hors du cabinet |
| Relances : les messages WhatsApp/SMS partent du téléphone du personnel | Envoi automatique de SMS par un fournisseur externe |

Pour rendre la réservation, la page publique et le portail accessibles depuis l'extérieur tout en continuant à travailler
pendant les coupures, déployez d'abord la copie cloud (Vercel/Neon ou VPS/Neon), puis jumelez ce serveur avec elle. Le
serveur du cabinet ouvre lui-même la connexion sortante : aucun port du routeur n'est exposé. Les changements en attente
sont envoyés et reçus dès que l'internet revient.

Sans copie cloud, le lien de réservation et le portail restent utilisables uniquement par les appareils connectés au
Wi-Fi du cabinet. Un `PUBLIC_APP_URL` pointant directement vers ce serveur est déconseillé : n'ouvrez pas ses ports sur
internet.

## Matériel conseillé

- Un PC ou mini-PC dédié (4 Go de RAM minimum, 8 Go conseillés, SSD 128 Go), allumé pendant les heures d'ouverture.
- Un onduleur (coupures de courant) et un disque/clé USB pour copier les sauvegardes.
- Un routeur Wi-Fi ; réservez une **adresse IP fixe** pour le serveur dans le routeur (ex. `192.168.1.10`).
- Docker : Docker Desktop (Windows/macOS) ou Docker Engine (Linux, recommandé).

## Installation

### A. Le serveur a internet pendant l'installation

```bash
cd deploy/clinic
./install.sh
```

Le script demande l'adresse IP du serveur, génère les mots de passe et clés de sécurité dans `deploy/clinic/.env`
(à garder secret et à sauvegarder), construit les images et démarre tout.

### B. Le serveur n'a jamais internet

Sur un ordinateur **avec** internet, dans une copie du projet :

```bash
cd deploy/clinic
./export-images.sh        # crée cabinet-offline-amd64.tar.gz + son empreinte SHA-256
```

Copiez `cabinet-offline-amd64.tar.gz` et `cabinet-offline-amd64.tar.gz.sha256` sur la clé USB. Le paquet cible les PC
Intel/AMD 64 bits courants; pour un serveur ARM, utilisez `TARGET_PLATFORM=linux/arm64 ./export-images.sh`.

Sur le serveur du cabinet, vérifiez l'empreinte, décompressez le paquet, puis :

```bash
cd cabinet-offline
./install.sh              # Linux/macOS : charge les images, sans internet
# Windows PowerShell : powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Le paquet contient aussi `README-OFFLINE.md` (procédure courte client) et `GUIDE-INSTALLATION-COMPLET.md`.

## Premier démarrage

1. Sur chaque appareil, ouvrez `http://<IP-du-serveur>/ca.crt` et installez le certificat
   (iPhone : Réglages › Général › VPN et gestion de l'appareil, puis Réglages › Général › Informations ›
   Réglages des certificats › activer ; Android : Paramètres › Sécurité › Installer un certificat CA ;
   Windows/macOS : double-cliquez et faites-lui confiance). Ceci évite l'alerte « connexion non sécurisée ».
2. Choisissez un seul mode de démarrage :
   - **avec copie cloud** : créez d'abord le cabinet et son propriétaire sur l'adresse HTTPS hébergée. Dans cette copie,
     ouvrez Paramètres › Ordinateur du cabinet et créez un code valable 30 minutes. Sur le serveur local encore vide,
     ouvrez `https://<IP-du-serveur>/sync-setup`, saisissez l'adresse cloud et le code, puis attendez la fin de la copie
     initiale avant de vous connecter ;
   - **local uniquement** : ouvrez `https://<IP-du-serveur>` et créez le cabinet une seule fois. Cette base n'est plus
     jumelable automatiquement après la création; pour passer au mode cloud, repartez d'une installation locale vide
     après sauvegarde et migration contrôlée des données.
3. Invitez le personnel depuis Paramètres › Équipe (chaque personne a son propre compte).
4. Remplacez les tarifs de démonstration du catalogue par vos prix.
5. Sur téléphone, « Ajouter à l'écran d'accueil » installe l'application.

## Sauvegardes et restauration

- Une sauvegarde complète est faite **chaque jour à 21 h** (réglable : `BACKUP_HOUR`) dans
  `deploy/clinic/backups/`, conservée 30 jours (`BACKUP_KEEP_DAYS`), avec une empreinte `.sha256`.
  Chaque sauvegarde contient le dump PostgreSQL et une archive assortie des images/documents cliniques privés.
- Sauvegarde immédiate : `docker compose exec backup sh /backup.sh now`
- **Copiez régulièrement le dossier `backups/` sur un disque externe** (et gardez une copie hors du cabinet) :
  une sauvegarde sur le même disque ne protège pas contre une panne ou un vol.
- Restaurer : `./restore.sh backups/cabinet-AAAAMMJJ-HHMMSS.dump` (une sauvegarde de sécurité de l'état
  actuel est faite avant). L'archive `cabinet-AAAAMMJJ-HHMMSS-files.tar.gz` correspondante est vérifiée puis
  restaurée avec la base ; ne séparez pas ces fichiers lors d'une copie externe.

## Mises à jour

```bash
cd deploy/clinic
./update.sh               # sauvegarde, nouvelles images, redémarrage, migrations automatiques
```

## Mot de passe oublié

- **Un membre de l'équipe** : le responsable (ou un administrateur) ouvre Paramètres › Équipe, choisit la personne
  et « Mot de passe oublié ? Créer un lien ». Le lien est valable 24 h, une seule fois ; la personne choisit
  elle-même son nouveau mot de passe et tous ses appareils sont déconnectés. Cocher « téléphone perdu »
  désactive aussi la double authentification, à reconfigurer ensuite.
- **Le responsable du cabinet** (personne ne peut créer de lien pour lui) : sur le serveur,

  ```bash
  cd deploy/clinic
  ./reset-password.sh adresse@du-responsable [--reset-mfa]
  ```

  affiche un lien valable 2 h à ouvrir depuis un appareil du cabinet.
- **Par e-mail (facultatif)** : si le serveur peut envoyer des e-mails, renseignez `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM` dans `deploy/clinic/.env`, puis `docker compose up -d`. Le lien
  « Mot de passe oublié ? » de la page de connexion envoie alors un lien valable 1 h (3 demandes par heure au plus).

## Fonctionnement en cas de coupure

- **Internet coupé** : aucun effet sur l'application dans le cabinet.
- **Wi-Fi coupé ou serveur éteint** : un bandeau rouge « Serveur du cabinet injoignable » s'affiche et
  rien n'est enregistré ; les écrans reviennent à la normale dès que la connexion est rétablie.
  Par sécurité, aucune donnée patient, clinique ou financière n'est stockée sur les téléphones.
- **Coupure de courant** : les services redémarrent seuls au rallumage du serveur (`restart: unless-stopped`).

## Sécurité

- Accès uniquement depuis le réseau du cabinet. N'ouvrez **pas** les ports 80/443 du routeur vers internet.
- Caddy transmet l'adresse réelle de l'appareil dans un en-tête qu'il remplace lui-même. L'application limite dans
  PostgreSQL les tentatives de connexion du personnel et des patients (30 par 15 minutes et par adresse), ainsi que les
  demandes « mot de passe oublié » (10 par heure). Le limiteur ne conserve qu'une empreinte HMAC de l'adresse. Ne publiez jamais
  directement le port 3000 de l'application : un accès internet doit rester derrière un proxy de confiance.
- `AUTH_RATE_LIMIT_SECRET` est généré automatiquement dans `.env`. `update.sh` l'ajoute également aux anciennes
  installations sans modifier leurs autres secrets.
- `DB_SYNC_PASSWORD` est distinct des mots de passe propriétaire et applicatif. Il est généré à l'installation (ou lors
  de la première mise à jour d'une ancienne installation), puis injecté uniquement dans les composants de synchronisation.
- Mettez le serveur dans une pièce fermée, avec un mot de passe de session et le chiffrement du disque
  (BitLocker / FileVault / LUKS).
- Activez la double authentification pour les comptes du propriétaire et de la comptabilité.

## Vérifications (exercice réalisé)

Voir la section « Clinic server » de `docs/STATUS.md` pour le résultat mesuré de l'exercice
sauvegarde → restauration.
