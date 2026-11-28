# Déployer Cabinet Dentaire Pro sur Vercel et Neon

Cette variante héberge l'application Next.js sur Vercel, PostgreSQL sur Neon et les photos, radios, PDF et DICOM dans
un magasin **Vercel Blob privé**. Elle ne dépend d'aucun disque local éphémère. Les données réelles ne doivent être
chargées qu'après validation des contrats, de la résidence des données et des obligations de santé applicables au cabinet.

## 1. Architecture de production

- **Vercel** exécute Next.js et publie le domaine HTTPS.
- **Neon** contient PostgreSQL. Le serveur web utilise uniquement l'endpoint poolé du rôle restreint `cabinet_app`.
- **Vercel Blob privé** contient les fichiers cliniques. Le navigateur les envoie directement avec un jeton court et
  limité au patient; le serveur relit les octets, vérifie leur signature, les renomme sous une clé immuable et inscrit
  ensuite les métadonnées dans PostgreSQL. Les téléchargements restent authentifiés, autorisés et audités par l'application.

Les migrations utilisent temporairement l'endpoint Neon direct du propriétaire depuis une machine d'administration ou
un workflow CI protégé. Ne placez jamais `DATABASE_URL_ADMIN` dans les variables du serveur web Vercel.

## 2. Initialiser Neon

**Région : Francfort pour les deux.** Les cabinets et les patients sont en Algérie : `vercel.json` fixe l'exécution
Vercel à `fra1` (Francfort) et le projet Neon doit être créé dans `aws-eu-central-1` (Francfort), la région d'un projet
Neon ne pouvant pas être changée ensuite. Les deux doivent rester ensemble : chaque page fait plusieurs allers-retours
vers la base, et un serveur à Francfort qui parlerait à une base aux États-Unis serait plus lent qu'avant.

```bash
neon projects create --name "Cabinet Frankfurt" --region-id aws-eu-central-1 --pg-version 18
```

Depuis une machine sûre qui possède le dépôt :

```bash
npm ci
export DATABASE_URL_ADMIN='postgresql://OWNER:PASSWORD@ep-example.region.aws.neon.tech/neondb?sslmode=require'
export DATABASE_RUNTIME_PASSWORD='une-cle-aleatoire-d-au-moins-24-caracteres'
export DATABASE_SYNC_PASSWORD='une-autre-cle-aleatoire-d-au-moins-24-caracteres'
npm run db:setup:neon -- --print-runtime-url
```

Le script crée `cabinet_app`, active le compte dédié `cabinet_sync`, vérifie leurs attributs sûrs et leurs rôles hérités,
applique les migrations, puis teste l'isolation RLS des deux connexions par l'endpoint poolé. Il affiche les deux URL
secrètes à copier dans Vercel. La procédure détaillée et la rotation des mots de passe sont dans
`docs/DEPLOYMENT-NEON.md`.

## 3. Créer le projet Vercel

1. Importez le dépôt GitHub dans Vercel et gardez le preset **Next.js**. Aucune commande personnalisée n'est nécessaire :
   Vercel exécute `npm run build`.
2. Dans **Storage**, créez un magasin **Blob privé** et connectez-le au projet de production. Vercel ajoute
   `BLOB_READ_WRITE_TOKEN`; ne copiez pas cette valeur dans Git.
3. Choisissez une région de fonctions proche de Neon. Gardez l'application et la base dans la même zone géographique pour
   réduire la latence et les transferts interrégionaux.
4. Configurez un domaine HTTPS définitif avant d'inviter des patients.

## 4. Variables Vercel de production

Ajoutez ces variables à l'environnement **Production** :

| Variable | Valeur / usage |
|---|---|
| `DATABASE_URL` | URL Neon **poolée**, utilisateur `cabinet_app` |
| `SYNC_DATABASE_URL` | deuxième URL Neon **poolée**, utilisateur `cabinet_sync` |
| `CABINET_SYNC_WORKER` | `off` sur le cloud (les routes restent actives; seule la boucle sortante est coupée) |
| `DATABASE_POOL_MAX` | `1` recommandé par instance serverless |
| `APP_URL` | `https://cabinet.example.com` |
| `PUBLIC_APP_URL` | la même URL publique définitive |
| `CLINICAL_STORAGE_BACKEND` | `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` | ajouté par la connexion au magasin Blob privé |
| `MFA_ENCRYPTION_KEY` | secret aléatoire distinct d'au moins 32 octets |
| `AUTH_RATE_LIMIT_SECRET` | autre secret aléatoire d'au moins 32 octets |
| `REGISTRATION_MODE` | `first-only` pour un cabinet unique |
| `TZ` | `Africa/Algiers` |

Ajoutez les variables SMTP seulement si les courriels de réinitialisation doivent être envoyés. Utilisez
`openssl rand -base64 36` pour chaque secret applicatif. N'ajoutez ni `DATABASE_URL_ADMIN`, ni les variables de démo
`SEED_*` à Vercel.

Les environnements Preview ne doivent jamais pointer vers la base ni le magasin Blob de vrais patients. Utilisez une
branche Neon et un magasin Blob séparés, avec des données fictives, ou désactivez les previews pour cette branche.

Si vous migrez une installation existante, copiez d'abord chaque fichier clinique vers le magasin privé en conservant sa
clé canonique stockée en base. Ne passez à `vercel-blob` qu'après avoir contrôlé que toutes les clés existent : changer la
variable ne déplace pas les anciens octets du volume local.

## 5. Déployer et vérifier

Déclenchez le premier déploiement depuis Vercel, puis vérifiez :

```bash
curl https://cabinet.example.com/api/health
```

La réponse attendue est `{"ok":true,...}`. Une réponse 503 indique notamment une base indisponible ou un magasin Blob
privé non connecté. Ouvrez ensuite `/register`; avec `first-only`, seule la création du premier cabinet est permise.
Testez avec des données fictives : connexion, création d'un patient, envoi puis ouverture d'une petite image clinique.

Pour chaque nouvelle version qui contient une migration :

1. sauvegardez la base;
2. exécutez `DATABASE_URL_ADMIN='…' npm run db:migrate` depuis l'environnement d'administration sécurisé;
3. déployez le commit sur Vercel;
4. contrôlez `/api/health` et les journaux Vercel.

## 6. Mises à jour de la base (automatiques)

Le workflow GitHub **Database migrations** (`.github/workflows/migrate.yml`) applique chaque nouvelle migration poussée
sur `main` : base de test (Preview) d'abord, puis production. En parallèle, la construction Vercel (`vercel-build` →
`scripts/check-schema.ts`) attend jusqu'à 5 minutes que la base soit à jour ; sinon elle refuse le déploiement et
**l'ancienne version reste en ligne** (jamais une version qui casserait faute de migration).

Secrets GitHub à créer (dépôt → Settings → Secrets and variables → Actions → New repository secret) :

| Secret | Valeur |
|---|---|
| `PRODUCTION_DATABASE_URL_ADMIN` | URL Neon **directe** (sans `-pooler`) du propriétaire, projet « Cabinet Frankfurt » |
| `PREVIEW_DATABASE_URL_ADMIN` | URL Neon directe du propriétaire, projet « Cabinet Preview (test data only) » |
| `BACKUP_PASSPHRASE` | longue phrase secrète aléatoire (gardez-en une copie dans votre gestionnaire de mots de passe) |

Sans ces secrets, les workflows s'arrêtent avec un avertissement ; appliquez alors les migrations à la main :
`DATABASE_URL_ADMIN='<URL directe>' npm run db:migrate`, puis redéployez.

## 7. Sauvegarde automatique et restauration

Le workflow **Database backup** (`.github/workflows/backup.yml`) sauvegarde la base de production chaque nuit à 03:30
(Alger), la **chiffre** (AES-256, clé dérivée de `BACKUP_PASSPHRASE`) puis la garde 30 jours comme artefact GitHub. Le
dépôt étant public, seul le fichier chiffré y est stocké. Lancez-le aussi à la main avant toute opération risquée
(onglet Actions → Database backup → Run workflow).

Restaurer (de préférence dans un nouveau projet ou une nouvelle branche Neon, jamais directement par-dessus la production) :

```bash
# 1. Télécharger l'artefact (onglet Actions → exécution → Artifacts), puis :
sha256sum -c cabinet-AAAAMMJJ-HHMM.dump.enc.sha256
openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter 200000 -in cabinet-AAAAMMJJ-HHMM.dump.enc -out cabinet.dump
# (la phrase secrète BACKUP_PASSPHRASE est demandée)
# 2. Restaurer dans une base vide (PostgreSQL 18) :
pg_restore --no-owner --no-privileges -d "<URL directe de la base cible>" cabinet.dump
# 3. Recréer les rôles restreints et vérifier (fournir aussi DATABASE_RUNTIME_PASSWORD et DATABASE_SYNC_PASSWORD) :
DATABASE_URL_ADMIN='<même URL>' npm run db:setup:neon
```

Le chiffrement, le déchiffrement et la restauration ont été testés sur une copie locale (86 tables restaurables).

## 8. Exploitation

- Exportez régulièrement Neon avec `pg_dump` via l'endpoint direct, selon le plan de sauvegarde du cabinet.
- Sauvegardez séparément le magasin Blob privé. Une restauration Neon ne restaure pas les fichiers cliniques.
- Restaurez toujours la base et les objets du même point de sauvegarde : leurs métadonnées et octets doivent correspondre.
- Surveillez `/api/health`, les erreurs de fonctions, les quotas Neon/Blob et l'expiration du domaine.
- Les objets cliniques acceptés sont immuables dans le produit. Un objet temporaire abandonné expire automatiquement.

Vercel et Neon fournissent l'infrastructure, pas une certification automatique de conformité médicale. Avant production,
le responsable du cabinet doit valider le contrat de traitement, la localisation, la rétention, la procédure d'incident,
les accès administrateurs et un exercice réel de restauration.

## 9. Rappels WhatsApp automatiques (Meta WhatsApp Cloud API)

Le module « Rappels WhatsApp » envoie la veille de chaque rendez-vous un message au patient, depuis **votre** compte
WhatsApp Business (la plateforme paie Meta et revend le module aux cabinets). Tant que les clés ci-dessous manquent,
l’écran du cabinet affiche « non configuré » et rien ne part.

1. **Meta** : créez un compte Meta Business (business.facebook.com), faites vérifier l’entreprise, puis dans
   developers.facebook.com créez une application de type « Business » avec le produit **WhatsApp**. Ajoutez le numéro
   qui enverra les messages (un numéro dédié, pas votre WhatsApp personnel) et notez son **Phone number ID**.
2. **Jeton permanent** : Paramètres de l’entreprise → Utilisateurs système → créez un utilisateur système, donnez-lui
   l’application et le compte WhatsApp avec la permission `whatsapp_business_messaging`, générez un jeton sans
   expiration. Ce jeton ne va que dans Vercel (jamais dans le code, jamais dans un message).
3. **Modèle de message** (WhatsApp Manager → Modèles) : nom `rappel_rendez_vous`, catégorie **Utilitaire**, trois
   langues, corps exactement avec 5 variables dans cet ordre (prénom, cabinet, date, heure, téléphone du site) :
   - Français : `Bonjour {{1}}, nous vous rappelons votre rendez-vous chez {{2}} le {{3}} à {{4}}. En cas d'empêchement, merci de nous prévenir au {{5}}.`
   - Arabe : `مرحبًا {{1}}، نذكّركم بموعدكم في {{2}} يوم {{3}} على الساعة {{4}}. في حال تعذّر الحضور، يرجى إعلامنا على الرقم {{5}}.`
   - Anglais : `Hello {{1}}, this is a reminder of your appointment at {{2}} on {{3}} at {{4}}. If you cannot come, please let us know at {{5}}.`
   Attendez l’approbation de Meta. Une langue non approuvée bascule automatiquement sur le français.
4. **Accusés de réception (webhook)** : dans l’application Meta → WhatsApp → Configuration, URL de rappel
   `https://<votre-domaine>/api/whatsapp/webhook`, jeton de vérification = une longue chaîne aléatoire que vous
   choisissez, puis abonnez le champ `messages`. Notez aussi la **clé secrète de l’application** (Paramètres → Général).
5. **Vercel** (Production, chiffrées) :
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
   `CRON_SECRET` (chaîne aléatoire d’au moins 16 caractères ; Vercel l’envoie à la tâche planifiée).
   Facultatif : `WHATSAPP_API_VERSION` (défaut `v26.0`), `WHATSAPP_REMINDER_TEMPLATE` (défaut `rappel_rendez_vous`),
   `WHATSAPP_TEMPLATE_LANGUAGES` (défaut `fr,ar,en`). Redéployez.
6. **Planification** : `vercel.json` lance `/api/cron/reminders` chaque jour à 15 h UTC (16 h à Alger). Sur le plan
   Hobby, Vercel exécute une tâche par jour, à une heure près.
7. **Par cabinet** : dans `/platform`, cochez le module « Rappels WhatsApp » pour le cabinet ; son propriétaire
   l’active dans Paramètres → Rappels WhatsApp (le téléphone du site doit être renseigné) et peut envoyer un message de
   test à son propre numéro.

Coût : Meta facture chaque message « utilitaire » envoyé hors conversation ouverte ; consultez la grille tarifaire de
Meta pour l’Algérie avant de fixer le prix du module.
