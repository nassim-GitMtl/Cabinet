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
| Relances : les messages WhatsApp/SMS partent du téléphone du personnel | Partage de dossiers entre cabinets différents, envoi automatique de SMS |

Ces fonctions « internet » nécessiteront une synchronisation avec une copie en ligne (prévue, non incluse).
Sur le réseau du cabinet, le lien de réservation et le portail fonctionnent pour un appareil connecté au Wi-Fi.
Si le cabinet dispose d'un nom de domaine pointant vers ce serveur, indiquez-le dans `PUBLIC_APP_URL`
(fichier `.env`) : la page publique et l'affiche QR utiliseront cette adresse.

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

Le script demande l'adresse IP du serveur, génère les mots de passe dans `deploy/clinic/.env`
(à garder secret et à sauvegarder), construit les images et démarre tout.

### B. Le serveur n'a jamais internet

Sur un ordinateur **avec** internet, dans une copie du projet :

```bash
cd deploy/clinic
./export-images.sh        # crée cabinet-images.tar.gz
```

Copiez tout le dossier du projet **avec** `cabinet-images.tar.gz` (clé USB) sur le serveur, puis :

```bash
cd deploy/clinic
./install.sh              # charge les images depuis l'archive, sans internet
```

## Premier démarrage

1. Sur chaque appareil, ouvrez `http://<IP-du-serveur>/ca.crt` et installez le certificat
   (iPhone : Réglages › Général › VPN et gestion de l'appareil, puis Réglages › Général › Informations ›
   Réglages des certificats › activer ; Android : Paramètres › Sécurité › Installer un certificat CA ;
   Windows/macOS : double-cliquez et faites-lui confiance). Ceci évite l'alerte « connexion non sécurisée ».
2. Ouvrez `https://<IP-du-serveur>` et créez le cabinet (**une seule fois** : ensuite l'inscription est fermée).
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

## Fonctionnement en cas de coupure

- **Internet coupé** : aucun effet sur l'application dans le cabinet.
- **Wi-Fi coupé ou serveur éteint** : un bandeau rouge « Serveur du cabinet injoignable » s'affiche et
  rien n'est enregistré ; les écrans reviennent à la normale dès que la connexion est rétablie.
  Par sécurité, aucune donnée patient, clinique ou financière n'est stockée sur les téléphones.
- **Coupure de courant** : les services redémarrent seuls au rallumage du serveur (`restart: unless-stopped`).

## Sécurité

- Accès uniquement depuis le réseau du cabinet. N'ouvrez **pas** les ports 80/443 du routeur vers internet.
- Mettez le serveur dans une pièce fermée, avec un mot de passe de session et le chiffrement du disque
  (BitLocker / FileVault / LUKS).
- Activez la double authentification pour les comptes du propriétaire et de la comptabilité.

## Vérifications (exercice réalisé)

Voir la section « Clinic server » de `docs/STATUS.md` pour le résultat mesuré de l'exercice
sauvegarde → restauration.
