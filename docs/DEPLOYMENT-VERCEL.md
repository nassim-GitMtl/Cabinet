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
npm run db:setup:neon -- --print-runtime-url
```

Le script crée `cabinet_app` sans rôle hérité, vérifie `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, applique les
migrations, puis teste l'isolation RLS par l'endpoint poolé. La dernière ligne affiche l'URL d'exécution secrète à copier
dans Vercel. La procédure détaillée et la rotation du mot de passe sont dans `docs/DEPLOYMENT-NEON.md`.

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

## 6. Sauvegarde et exploitation

- Exportez régulièrement Neon avec `pg_dump` via l'endpoint direct, selon le plan de sauvegarde du cabinet.
- Sauvegardez séparément le magasin Blob privé. Une restauration Neon ne restaure pas les fichiers cliniques.
- Restaurez toujours la base et les objets du même point de sauvegarde : leurs métadonnées et octets doivent correspondre.
- Surveillez `/api/health`, les erreurs de fonctions, les quotas Neon/Blob et l'expiration du domaine.
- Les objets cliniques acceptés sont immuables dans le produit. Un objet temporaire abandonné expire automatiquement.

Vercel et Neon fournissent l'infrastructure, pas une certification automatique de conformité médicale. Avant production,
le responsable du cabinet doit valider le contrat de traitement, la localisation, la rétention, la procédure d'incident,
les accès administrateurs et un exercice réel de restauration.
