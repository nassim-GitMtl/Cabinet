# syntax=docker/dockerfile:1.7
# Cabinet Dentaire Pro — images for the clinic server (see docs/INSTALLATION-CABINET.md).
# Build once on a machine with internet, or on the clinic server itself; the
# running application never needs internet access.

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

# One-shot job that applies database migrations, then exits.
FROM deps AS migrate
COPY drizzle ./drizzle
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY tsconfig.json ./
CMD ["npx", "tsx", "scripts/migrate.ts"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Africa/Algiers
RUN apk add --no-cache tzdata && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
