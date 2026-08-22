# syntax=docker/dockerfile:1.7
#
# easyTree Web-Shell (Next.js App Router) als OCI-Workload — EYT-126.
#
# ## Das Proxyziel ist LAUFZEIT-Konfiguration. Gemessen, nicht vermutet.
#
# Der Same-Origin-Proxy liegt in Route Handlern (`app/api/[[...pfad]]`,
# `app/health`, `app/ready`), nicht mehr in `next.config.ts`-`rewrites()`. Route
# Handler sind dynamischer Servercode: sie lesen `EASYTREE_API_PROXY_TARGET` bei
# JEDER Anfrage neu.
#
# Nachgemessen am 21.08.2026 auf Next 16.2.11: EIN Standalone-Build, danach
# derselbe Server dreimal mit unterschiedlichem Ziel gestartet — die Antworten
# kamen von den drei verschiedenen Stubs, ohne Neubau dazwischen. Der
# Container-Smoke wiederholt den Nachweis gegen denselben IMAGE-DIGEST.
#
# Deshalb steht hier KEIN `ARG EASYTREE_API_PROXY_TARGET` mehr. Dieses Image ist
# an keinen Anbieter und an kein Ziel gebunden; dieselbe Datei und derselbe
# Startpfad liefern es fuer Coolify/VPS wie fuer Railway.
#
# ## Fail-closed
#
# `instrumentation.ts` prueft das Ziel beim Serverstart. Fehlt es oder ist es
# ungueltig, meldet Next "Failed to prepare server" und beantwortet JEDE Route
# mit 500 — auch `/`. Der Prozess haelt dabei den Port; er bedient aber keinen
# normalen Anwendungsverkehr, und der Compose-Healthcheck auf `/` schlaegt fehl.
#
# `GIT_SHA` hat bewusst KEINEN Vorgabewert und wird unten erzwungen: ein Image
# mit `revision=unknown` waere ein Deploy ohne Herkunft.
#
# ## Der Browser sieht diese Adresse nie
#
# Das Ziel ist ausdruecklich KEIN `NEXT_PUBLIC_*`. Es wird serverseitig
# aufgeloest; weder im Browserbuendel noch in einem Antwortkopf steht es — auch
# nicht in einem `location`-Kopf, den die Durchreiche in einen relativen Pfad
# uebersetzt.

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
# Kein Vorgabewert, und der Wert wird geprueft: ein leeres ARG faellt sonst
# still auf ein Label ohne Inhalt zurueck, und "das Image ist gruen" waere eine
# Aussage ueber irgendein Image (EYT-126).
ARG GIT_SHA
RUN test -n "${GIT_SHA}" || { \
      echo "GIT_SHA fehlt. Baue mit --build-arg GIT_SHA=\$(git rev-parse HEAD)." >&2; \
      exit 1; \
    }
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
