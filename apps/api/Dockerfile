# syntax=docker/dockerfile:1.7
#
# easyTree API (NestJS) als OCI-Workload — EYT-126.
#
# ## Was dieses Image ist und was nicht
#
# Es ist eine Verpackung des BESTEHENDEN Node-Startpfads `node dist/main.js`.
# Es enthaelt keine providerspezifische Logik: derselbe Startbefehl laeuft auf
# Coolify/VPS, auf Railway und lokal. Coolify ist Orchestrator, nicht Teil der
# Facharchitektur (ADR-001, Confluence 30998530).
#
# Der zweite Einstiegspunkt (`dist/worker.js`, Outbox, kein Port) steckt im
# GLEICHEN Image — ein Workload ueberschreibt dafuer nur das Kommando. Zwei
# Images fuer einen Modulgraphen waeren zwei Stellen, die auseinanderlaufen
# koennen.
#
# ## Reproduzierbarkeit
#
# `pnpm install --frozen-lockfile` gegen das eingecheckte `pnpm-lock.yaml`.
# Schlaegt der Lockfile-Abgleich fehl, bricht der Build ab statt aufzuloesen —
# das ist der Unterschied zwischen "reproduzierbar" und "hat heute funktioniert".
#
# ## Was NICHT im Image steckt
#
# Keine Secrets, keine `.env`, kein Zertifikat. `DATABASE_URL`, `SUPABASE_URL`,
# `SUPABASE_ANON_KEY` und `DATABASE_SSL_ROOT_CERT` kommen ausschliesslich zur
# Laufzeit aus der Plattform. `packages/config` validiert sie beim Bootstrap
# streng (`z.strictObject` je NODE_ENV) — eine fehlende Pflichtvariable ist ein
# lauter Startfehler, kein stiller Default.

ARG NODE_IMAGE=node:22.23.1-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack liest `packageManager` aus der Wurzel-package.json (pnpm@10.28.0).
# Damit ist die Paketmanager-Version genauso gepinnt wie die Abhaengigkeiten.
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Abhaengigkeiten zuerst, Quelltext danach: eine Quelltextaenderung soll nicht
# jeden Install ungueltig machen.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# ALLE Workspace-Manifeste, nicht nur die gefilterten: `--frozen-lockfile`
# vergleicht die Importer des Lockfiles mit den vorhandenen Paketen. Fehlt
# eines, meldet pnpm ERR_PNPM_OUTDATED_LOCKFILE statt zu installieren.
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --filter @easytree/api...

# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @easytree/api... build
# `pnpm deploy` erzeugt ein in sich geschlossenes Verzeichnis: die
# Workspace-Pakete werden als echte Ordner nach `node_modules/@easytree/*`
# kopiert statt verlinkt. `--legacy` ist seit pnpm 10 noetig, solange
# `inject-workspace-packages` nicht gesetzt ist (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE).
RUN pnpm --filter @easytree/api --prod --legacy deploy /prod/api

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="easytree-api" \
      org.opencontainers.image.description="easyTree API (NestJS) — EYT-126" \
      org.opencontainers.image.source="https://github.com/DYAI2025/EasyTree" \
      org.opencontainers.image.revision="${GIT_SHA}"

# Voreinstellung ist das SCHARFE Profil. Wer eine Umgebung mit lockereren
# Regeln braucht (z.B. der Container-Smoke gegen einen lokalen Stack ohne
# TLS-Wurzelzertifikat), setzt NODE_ENV zur Laufzeit ausdruecklich um. Der
# umgekehrte Default waere die gefaehrliche Richtung.
ENV NODE_ENV=production
ENV API_PORT=3001
WORKDIR /app

# Nur drei Dinge aus dem Deploy-Ergebnis. `src/`, `test/` und die
# tsconfig-Dateien wandern bewusst NICHT mit: sie werden zur Laufzeit nicht
# gebraucht und vergroessern nur die Angriffsflaeche.
COPY --from=build --chown=node:node /prod/api/package.json ./package.json
COPY --from=build --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/api/dist ./dist

USER node
EXPOSE 3001
# Der Worker nutzt dasselbe Image: `command: ["node", "dist/worker.js"]`.
CMD ["node", "dist/main.js"]
