# Déployer Cabinet Dentaire Pro avec Neon

Neon héberge la base PostgreSQL. L'application Next.js et les fichiers cliniques privés restent hébergés sur un serveur
Node/Docker. Le déploiement fourni ici utilise un VPS avec Docker Compose et Caddy : Caddy obtient automatiquement le
certificat HTTPS, l'application utilise l'endpoint Neon poolé, et un conteneur séparé applique les migrations par
l'endpoint direct.

> Important : ne déployez pas cette version sur un hébergement sans disque persistant. Les radios, photos, PDF et DICOM
> sont actuellement stockés dans `CLINICAL_STORAGE_DIR`, pas dans Neon. Le volume `clinical-files` doit être sauvegardé.

## 1. Créer le projet Neon

1. Créez un projet et une base dans une région proche du serveur applicatif.
2. Dans **Connect**, copiez la chaîne **Direct connection** du rôle propriétaire.
3. Gardez `sslmode=require`. Le script accepte les URL copiées avec `channel_binding=require`, mais retire ce paramètre
   client non pris en charge par Postgres.js tout en conservant TLS.

N'utilisez jamais le rôle propriétaire comme `DATABASE_URL` du serveur web. Chez Neon, les rôles créés depuis la Console
héritent normalement de `neon_superuser`, qui inclut `BYPASSRLS`. Le projet crée donc `cabinet_app` directement en SQL,
sans rôle hérité et sans capacité de contourner l'isolation des cabinets.

## 2. Initialiser le rôle et le schéma

Sur une machine disposant du dépôt et de Node.js :

```bash
npm ci
export DATABASE_URL_ADMIN='postgresql://OWNER:PASSWORD@ep-example.region.aws.neon.tech/neondb?sslmode=require'
export DATABASE_RUNTIME_PASSWORD='une-cle-aleatoire-d-au-moins-24-caracteres'
npm run db:setup:neon -- --print-runtime-url
```

Le script :

1. refuse un endpoint poolé ou non chiffré pour l'administration ;
2. crée/répare `cabinet_app`, retire ses rôles hérités et vérifie `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` ;
3. applique toutes les migrations par l'endpoint direct ;
4. se reconnecte par l'endpoint `-pooler` et vérifie le rôle, les privilèges et le RLS sans contexte de cabinet.

La dernière ligne `DATABASE_URL` contient un secret. Copiez-la immédiatement dans le coffre de secrets du serveur; ne la
committez jamais. Pour une clé robuste : `openssl rand -base64 36`.

Le script est réexécutable. Une nouvelle valeur de `DATABASE_RUNTIME_PASSWORD` effectue une rotation du mot de passe; il
faut ensuite remplacer `DATABASE_URL` sur tous les serveurs applicatifs dans la même opération.

## 3. Préparer le serveur applicatif

Prérequis : un VPS Linux avec Docker + le plugin Compose, un domaine dont l'enregistrement A/AAAA pointe vers le VPS, et
les ports 80/443 ouverts.

```bash
cp deploy/neon/environment.example .env.neon
```

Renseignez :

- `APP_HOST` : domaine sans `https://` ;
- `TLS_EMAIL` : contact Let's Encrypt ;
- `DATABASE_URL_ADMIN` : URL directe propriétaire, utilisée uniquement par le conteneur de migration ;
- `DATABASE_URL` : URL poolée `cabinet_app` produite par le script ;
- `MFA_ENCRYPTION_KEY` et `AUTH_RATE_LIMIT_SECRET` : deux secrets distincts d'au moins 32 octets ;
- SMTP si les liens « mot de passe oublié » doivent partir par courriel.

Le fichier `.env.neon` est ignoré par Git. Limitez-le au compte système qui exécute Docker (`chmod 600 .env.neon`).

## 4. Construire et démarrer

```bash
docker compose --env-file .env.neon -f deploy/neon/compose.yaml up -d --build
docker compose --env-file .env.neon -f deploy/neon/compose.yaml ps
curl https://cabinet.example.com/api/health
```

Le résultat attendu du contrôle est `{"ok":true,...}`. Ouvrez ensuite `/register`. Avec
`REGISTRATION_MODE=first-only`, seul le premier cabinet peut s'inscrire; les autres employés rejoignent par invitation.

Lors de chaque nouvelle version, récupérez le code puis relancez la même commande `up -d --build`. Le conteneur `migrate`
termine avant le démarrage de la nouvelle application et l'URL propriétaire n'est jamais injectée dans le conteneur web.

## 5. Sauvegardes et exploitation

- Neon protège la base selon le plan choisi, mais exportez périodiquement un `pg_dump` avec l'URL **directe**.
- Sauvegardez séparément le volume Docker `cabinet-neon_clinical-files`; une restauration de Neon ne restaure pas ces
  fichiers.
- Testez ensemble la restauration du dump et du volume clinique. Les métadonnées et fichiers doivent rester synchrones.
- Surveillez `/api/health`, l'espace du volume clinique, les certificats Caddy et les échecs du conteneur `migrate`.
- Pour plusieurs réplicas applicatifs, remplacez d'abord le stockage local par un stockage objet privé durable. Sinon, un
  fichier envoyé sur un réplica ne sera pas disponible sur les autres.

## Variables de production

| Variable | Conteneur | Rôle |
|---|---|---|
| `DATABASE_URL` | application | Endpoint Neon poolé, utilisateur `cabinet_app` uniquement |
| `DATABASE_POOL_MAX` | application | Connexions par processus; `5` est le défaut du déploiement Neon |
| `DATABASE_URL_ADMIN` | migration | Endpoint Neon direct, jamais le serveur web |
| `APP_URL`, `PUBLIC_APP_URL` | application | URL HTTPS publique générée depuis `APP_HOST` |
| `CLINICAL_STORAGE_DIR` | application | `/data/clinical-files`, monté sur un volume persistant |
| `MFA_ENCRYPTION_KEY` | application | Chiffrement des secrets TOTP |
| `AUTH_RATE_LIMIT_SECRET` | application | HMAC des adresses utilisées pour le throttling |
| `REGISTRATION_MODE` | application | `first-only` recommandé pour un cabinet unique |

## Limites actuelles

- Neon n'héberge ni Next.js, ni Caddy, ni les fichiers cliniques.
- Un déploiement serverless sans volume persistant n'est pas compatible avec les documents cliniques actuels.
- La résidence des données, les contrats de sous-traitance, la rétention et les obligations de santé doivent être validés
  pour le pays et le cabinet avant de placer des données réelles dans le cloud.
