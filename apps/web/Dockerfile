# syntax=docker/dockerfile:1.7
#
# easyTree Web-Shell (Next.js App Router) als OCI-Workload — EYT-126.
#
# ## Das Proxyziel ist BAUZEIT-Konfiguration. Gemessen, nicht vermutet.
#
# `next.config.ts` loest `EASYTREE_API_PROXY_TARGET` in `rewrites()` auf. Next
# schreibt das Ergebnis beim Bauen nach `.next/routes-manifest.json`; `next
# start` liest die Weiterleitungen aus diesem Manifest und NICHT erneut aus der
# Umgebung.
#
# Nachgemessen am 21.08.2026 auf Next 16.2.11: gebaut mit
# `http://buildtime-marker.invalid:9999`, gestartet mit
# `EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3999` — der Server antwortete auf
# `/health` mit HTTP 500 und protokollierte
# `Failed to proxy http://buildtime-marker.invalid:9999/health … ENOTFOUND`.
# Der Laufzeitwert wurde also ignoriert.
#
# Konsequenz, die hier ehrlich stehen muss: das Web-IMAGE ist an sein Ziel
# gebunden, nicht an einen Anbieter. Dieselbe Datei, derselbe Startpfad und
# dieselben Argumente bauen es fuer Coolify/VPS wie fuer Railway — nur der
# Wert unterscheidet sich. "Ein Image fuer beide Plattformen gleichzeitig"
# waere dagegen eine Behauptung, die die Messung nicht deckt.
#
# Fail-closed ist es trotzdem: `next build` setzt NODE_ENV=production, und
# `normalizeProxyTarget` wirft dort ohne expliziten Wert. Ein vergessenes
# `--build-arg` faellt den Build, statt still auf localhost zu zeigen.
#
# ## Der Browser sieht diese Adresse nie
#
# Das Ziel ist ausdruecklich KEIN `NEXT_PUBLIC_*`. Es wird serverseitig
# aufgeloest; im Browserbuendel steht es nicht. Die Weiterleitung passiert im
# Next-Server im Container.

ARG NODE_IMAGE=node:22.23.1-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --filter @easytree/web...

# ---------------------------------------------------------------------------
FROM deps AS build
ARG EASYTREE_API_PROXY_TARGET
ENV EASYTREE_API_PROXY_TARGET=${EASYTREE_API_PROXY_TARGET}
# `standalone` legt unter `.next/standalone/` einen selbsttragenden Server samt
# der wirklich benutzten node_modules ab (~23 MB statt des ganzen Workspace).
# Der Schalter ist bewusst nicht fest verdrahtet — siehe lib/next-output.ts.
ENV EASYTREE_NEXT_OUTPUT=standalone
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @easytree/web... build

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="easytree-web" \
      org.opencontainers.image.description="easyTree Web-Shell (Next.js) — EYT-126" \
      org.opencontainers.image.source="https://github.com/DYAI2025/EasyTree" \
      org.opencontainers.image.revision="${GIT_SHA}"

ENV NODE_ENV=production
ENV PORT=3000
# Ohne HOSTNAME bindet der Standalone-Server auf localhost — im Container
# waere er dann von aussen nicht erreichbar, und der Fehler saehe aus wie ein
# Netzwerkproblem der Plattform.
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Drei Kopien, alle noetig: der Standalone-Baum (Server + node_modules),
# die statischen Buildartefakte und `public/`. Next kopiert die letzten beiden
# ausdruecklich NICHT selbst.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
