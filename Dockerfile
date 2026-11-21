# syntax=docker/dockerfile:1.7
# Cabinet Dentaire Pro — standalone application and migration images.
# Used by the offline clinic server and the Neon deployment. See
# docs/INSTALLATION-CABINET.md and docs/DEPLOYMENT-NEON.md.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    # Placeholder only: nothing connects to a database during the build.
    DATABASE_URL=postgres://build:build@127.0.0.1:1/build
RUN npx next build

# Migration runner bundled into one file (drizzle + postgres driver), so the
# one-shot migrate image needs no node_modules.
FROM deps AS migrate-build
COPY scripts/migrate.ts scripts/staff-reset-link.ts ./scripts/
COPY src/server/deployment/database-url.ts ./src/server/deployment/database-url.ts
RUN for name in migrate staff-reset-link; do \
      npx esbuild scripts/$name.ts --bundle --platform=node --format=esm --target=node22 \
        --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
        --outfile=dist/$name.mjs || exit 1; \
    done

# One-shot job that applies database migrations, then exits. Also carries the owner reset-link command
# (deploy/clinic/reset-password.sh).
FROM node:24-alpine AS migrate
WORKDIR /app
COPY --from=migrate-build /app/dist/migrate.mjs /app/dist/staff-reset-link.mjs ./scripts/
COPY drizzle ./drizzle
USER node
CMD ["node", "scripts/migrate.mjs"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Africa/Algiers
RUN apk add --no-cache tzdata && addgroup -S app && adduser -S app -G app \
    && mkdir -p /data/clinical-files && chown -R app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
VOLUME ["/data/clinical-files"]
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
