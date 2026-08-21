#!/usr/bin/env bash
# smoke-container.sh (EYT-126) — baut die beiden OCI-Images aus dem AKTUELLEN
# Arbeitsbaum, startet sie als zusammenhaengende Topologie und prueft genau
# das, was ein Deploy auf Coolify/VPS oder Railway spaeter voraussetzt:
#
#   1. Beide Images tragen den erwarteten Commit als OCI-Label. Ohne diese
#      Bindung ist "das Image ist gruen" eine Aussage ueber irgendein Image.
#   2. Die API startet im Container, `/health` ist 200 und `/ready` ist 200 mit
#      `database: true` — also mit einer ECHTEN Datenbankverbindung.
#   3. Das Web erreicht die API ausschliesslich ueber den internen Dienstnamen.
#      Geprueft wird von aussen, durch den Web-Container hindurch.
#   4. Die ausgelieferte Seite nennt die interne Adresse nicht.
#   5. Die Protokolle enthalten weder Datenbankpasswort noch Anon-Key.
#   6. Beide Container laufen als nicht-privilegierter Benutzer.
#   7. Gegenprobe: mit NODE_ENV=production und ohne Wurzelzertifikat MUSS der
#      API-Container den Start verweigern. Ohne diesen Fall waere Punkt 2 auch
#      dann gruen, wenn die Konfigurationspruefung gar nichts prueft.
#   8. SIGTERM beendet beide Container geordnet.
#
# Fail-closed wie die uebrigen Gates: `EASYTREE_CONTAINER_SMOKE=required`
# (CI) macht jede Auslassung zum Fehler; `local` (Vorgabe) darf ohne Docker
# oder ohne Datenbank mit einer Warnung aussteigen.
#
# Erwartete Umgebung:
#   GIT_SHA                        — Commit, der in den Images stehen MUSS
#   EASYTREE_SMOKE_DATABASE_URL    — wie der CONTAINER die Datenbank sieht
#   EASYTREE_SMOKE_SUPABASE_URL    — wie der CONTAINER GoTrue sieht
#   EASYTREE_SMOKE_ANON_KEY        — oeffentlicher Anon-Key des Stacks
set -Eeuo pipefail

MODUS="${EASYTREE_CONTAINER_SMOKE:-local}"
NETZ="easytree-smoke-net"
API_CONTAINER="easytree-api-smoke"
WEB_CONTAINER="easytree-web-smoke"
API_IMAGE="easytree-api:smoke"
WEB_IMAGE="easytree-web:smoke"
API_PORT_HOST="${EASYTREE_SMOKE_API_PORT:-3011}"
WEB_PORT_HOST="${EASYTREE_SMOKE_WEB_PORT:-3010}"
# Genau diese Adresse wird in das Web-Image gebacken. Sie ist ein reiner
# Dienstname im Container-Netz — von aussen nicht aufloesbar, was Punkt 3
# ueberhaupt erst aussagekraeftig macht.
INTERNES_ZIEL="http://${API_CONTAINER}:3001"

AUSGEFUEHRT=0
BESTANDEN=0
UEBERSPRUNGEN=0

bericht() {
  echo "[container-smoke] mode=${MODUS} executed=${AUSGEFUEHRT} passed=${BESTANDEN} skipped=${UEBERSPRUNGEN}"
}

pruefung() {
  local name="$1"
  shift
  AUSGEFUEHRT=$((AUSGEFUEHRT + 1))
  if "$@"; then
    BESTANDEN=$((BESTANDEN + 1))
    echo "  OK   ${name}"
  else
    echo "::error::[container-smoke] ${name} fehlgeschlagen" >&2
    return 1
  fi
}

aussteigen() {
  local grund="$1"
  if [ "${MODUS}" = "required" ]; then
    echo "::error::[container-smoke] mode=required, aber ${grund}" >&2
    UEBERSPRUNGEN=$((UEBERSPRUNGEN + 1))
    bericht
    exit 1
  fi
  UEBERSPRUNGEN=$((UEBERSPRUNGEN + 1))
  echo "[container-smoke] uebersprungen: ${grund}" >&2
  bericht
  exit 0
}

aufraeumen() {
  docker rm -f "${WEB_CONTAINER}" "${API_CONTAINER}" >/dev/null 2>&1 || true
  docker network rm "${NETZ}" >/dev/null 2>&1 || true
}
trap aufraeumen EXIT

command -v docker >/dev/null 2>&1 || aussteigen "docker ist nicht installiert"
docker info >/dev/null 2>&1 || aussteigen "der Docker-Daemon ist nicht erreichbar"

: "${GIT_SHA:?GIT_SHA fehlt — ohne erwarteten Commit kann der Smoke nichts binden}"
if [ -z "${EASYTREE_SMOKE_DATABASE_URL:-}" ]; then
  aussteigen "EASYTREE_SMOKE_DATABASE_URL fehlt — ohne Datenbank ist /ready kein Nachweis"
fi
: "${EASYTREE_SMOKE_SUPABASE_URL:?EASYTREE_SMOKE_SUPABASE_URL fehlt}"
: "${EASYTREE_SMOKE_ANON_KEY:?EASYTREE_SMOKE_ANON_KEY fehlt}"

aufraeumen

echo "== 1/8 Images bauen (GIT_SHA=${GIT_SHA}) =="
docker build -f apps/api/Dockerfile --build-arg "GIT_SHA=${GIT_SHA}" -t "${API_IMAGE}" .
docker build -f apps/web/Dockerfile \
  --build-arg "GIT_SHA=${GIT_SHA}" \
  --build-arg "EASYTREE_API_PROXY_TARGET=${INTERNES_ZIEL}" \
  -t "${WEB_IMAGE}" .

label_ist_head() {
  local image="$1"
  local ist
  ist="$(docker inspect "${image}" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  if [ "${ist}" != "${GIT_SHA}" ]; then
    echo "  Label=${ist} erwartet=${GIT_SHA}" >&2
    return 1
  fi
  echo "  revision=${ist}"
}
laeuft_als_node() {
  local image="$1"
  local benutzer
  benutzer="$(docker inspect "${image}" --format '{{.Config.User}}')"
  [ "${benutzer}" = "node" ] || {
    echo "  User=${benutzer:-<root>} erwartet=node" >&2
    return 1
  }
}

echo "== 2/8 Bindung an den Head =="
pruefung "API-Image traegt den Head als OCI-Revision" label_ist_head "${API_IMAGE}"
pruefung "Web-Image traegt den Head als OCI-Revision" label_ist_head "${WEB_IMAGE}"
pruefung "API-Image laeuft nicht als root" laeuft_als_node "${API_IMAGE}"
pruefung "Web-Image laeuft nicht als root" laeuft_als_node "${WEB_IMAGE}"

echo "== 3/8 Topologie starten =="
docker network create "${NETZ}" >/dev/null
# NODE_ENV=test und nicht production: das Produktionsprofil verlangt ein
# TLS-Wurzelzertifikat und verbietet localhost-URLs — beides hat ein lokaler
# Supabase-Stack nicht. Dieselbe Einschraenkung haben die bestehenden
# Prozess-Smokes. Das Produktionsprofil wird stattdessen in Schritt 7 negativ
# belegt.
docker run -d --name "${API_CONTAINER}" \
  --network "${NETZ}" --network-alias "${API_CONTAINER}" \
  --add-host=host.docker.internal:host-gateway \
  -p "127.0.0.1:${API_PORT_HOST}:3001" \
  -e NODE_ENV=test \
  -e API_PORT=3001 \
  -e "DATABASE_URL=${EASYTREE_SMOKE_DATABASE_URL}" \
  -e "SUPABASE_URL=${EASYTREE_SMOKE_SUPABASE_URL}" \
  -e "SUPABASE_ANON_KEY=${EASYTREE_SMOKE_ANON_KEY}" \
  "${API_IMAGE}" >/dev/null

warte_auf() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "${url}"; then return 0; fi
    sleep 1
  done
  return 1
}

api_gesund() { warte_auf "http://127.0.0.1:${API_PORT_HOST}/health"; }
pruefung "API-Container antwortet auf /health" api_gesund || {
  docker logs "${API_CONTAINER}" 2>&1 | tail -40 >&2
  bericht
  exit 1
}

api_bereit() {
  local status koerper
  koerper="$(curl -s -o /tmp/container-ready.json -w '%{http_code}' "http://127.0.0.1:${API_PORT_HOST}/ready")"
  status="${koerper}"
  echo "  ready=${status} $(cat /tmp/container-ready.json)"
  [ "${status}" = "200" ] || return 1
  # Nicht nur 200: die Datenbankanzeige MUSS positiv sein. Ein `/ready`, das
  # ohne Datenbank 200 liefert, waere der Fehler, den dieser Smoke sucht.
  grep -q '"database"' /tmp/container-ready.json || return 1
  ! grep -qE '"(status|state)"[[:space:]]*:[[:space:]]*"(down|error)"' /tmp/container-ready.json
}
pruefung "API-Container ist bereit und sieht die Datenbank" api_bereit

docker run -d --name "${WEB_CONTAINER}" \
  --network "${NETZ}" \
  -p "127.0.0.1:${WEB_PORT_HOST}:3000" \
  -e NODE_ENV=production \
  -e PORT=3000 -e HOSTNAME=0.0.0.0 \
  "${WEB_IMAGE}" >/dev/null

web_erreichbar() { warte_auf "http://127.0.0.1:${WEB_PORT_HOST}/"; }
pruefung "Web-Container liefert die Shell aus" web_erreichbar || {
  docker logs "${WEB_CONTAINER}" 2>&1 | tail -40 >&2
  bericht
  exit 1
}

echo "== 4/8 Interner Weg Web -> API =="
# Der entscheidende Nachweis: `${INTERNES_ZIEL}` ist von HIER aus nicht
# aufloesbar. Kommt trotzdem die Antwort der API zurueck, dann ist sie durch
# den Web-Container gelaufen.
web_proxied_health() {
  local durch direkt
  durch="$(curl -fsS "http://127.0.0.1:${WEB_PORT_HOST}/health")"
  direkt="$(curl -fsS "http://127.0.0.1:${API_PORT_HOST}/health")"
  echo "  ueber web=${durch}"
  [ -n "${durch}" ] && [ "${durch}" = "${direkt}" ]
}
pruefung "Web reicht /health ueber den Dienstnamen an die API weiter" web_proxied_health

web_proxied_ready() {
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT_HOST}/ready")"
  echo "  ueber web ready=${status}"
  [ "${status}" = "200" ]
}
pruefung "Web reicht /ready an die API weiter" web_proxied_ready

ziel_von_aussen_unaufloesbar() {
  # Gegenprobe zur Aussagekraft: waere der Dienstname auch vom Host aus
  # erreichbar, bewiese Schritt 4 nichts ueber den internen Weg.
  ! curl -fsS -m 5 -o /dev/null "${INTERNES_ZIEL}/health"
}
pruefung "der interne Dienstname ist vom Host aus NICHT erreichbar" ziel_von_aussen_unaufloesbar

echo "== 5/8 Der Browser sieht die interne Adresse nicht =="
seite_ohne_interne_adresse() {
  local html
  html="$(curl -fsS "http://127.0.0.1:${WEB_PORT_HOST}/")"
  if printf '%s' "${html}" | grep -qF "${API_CONTAINER}"; then
    echo "  Dienstname steht im ausgelieferten HTML" >&2
    return 1
  fi
  if printf '%s' "${html}" | grep -qF "${INTERNES_ZIEL}"; then
    echo "  internes Ziel steht im ausgelieferten HTML" >&2
    return 1
  fi
  printf '%s' "${html}" | grep -qF "<html" || {
    echo "  Antwort ist kein HTML — der Test haette nichts geprueft" >&2
    return 1
  }
}
pruefung "das ausgelieferte HTML nennt die interne API-Adresse nicht" seite_ohne_interne_adresse

echo "== 6/8 Protokolle ohne Geheimnisse =="
protokolle_ohne_geheimnis() {
  local logs passwort
  logs="$(docker logs "${API_CONTAINER}" 2>&1; docker logs "${WEB_CONTAINER}" 2>&1)"
  # Das Passwort aus der Verbindungszeichenkette, ohne sie selbst zu drucken.
  passwort="$(printf '%s' "${EASYTREE_SMOKE_DATABASE_URL}" | sed -n 's#^[a-z+]*://[^:]*:\([^@]*\)@.*#\1#p')"
  if [ -n "${passwort}" ] && printf '%s' "${logs}" | grep -qF "${passwort}"; then
    echo "  Datenbankpasswort steht im Protokoll" >&2
    return 1
  fi
  if printf '%s' "${logs}" | grep -qF "${EASYTREE_SMOKE_ANON_KEY}"; then
    echo "  Anon-Key steht im Protokoll" >&2
    return 1
  fi
  # Eingangsbremse: haette der Aufruf gar keine Ausgabe geliefert, waere die
  # Pruefung vakuoes gruen.
  [ -n "${logs}" ]
}
pruefung "weder Datenbankpasswort noch Anon-Key stehen in den Protokollen" protokolle_ohne_geheimnis

echo "== 7/8 Gegenprobe: production ohne Wurzelzertifikat MUSS scheitern =="
production_ohne_zertifikat_scheitert() {
  local ausgabe status=0
  ausgabe="$(docker run --rm --network "${NETZ}" \
    --add-host=host.docker.internal:host-gateway \
    -e NODE_ENV=production \
    -e API_PORT=3001 \
    -e "DATABASE_URL=${EASYTREE_SMOKE_DATABASE_URL}" \
    -e "SUPABASE_URL=${EASYTREE_SMOKE_SUPABASE_URL}" \
    -e "SUPABASE_ANON_KEY=${EASYTREE_SMOKE_ANON_KEY}" \
    "${API_IMAGE}" 2>&1)" || status=$?
  if [ "${status}" -eq 0 ]; then
    echo "  Der Container startete OHNE Wurzelzertifikat im Produktionsprofil." >&2
    return 1
  fi
  # Nicht irgendein Fehlschlag: es muss DIESE Variable sein.
  printf '%s' "${ausgabe}" | grep -qF "DATABASE_SSL_ROOT_CERT" || {
    echo "  Start scheiterte, aber nicht an DATABASE_SSL_ROOT_CERT:" >&2
    printf '%s\n' "${ausgabe}" | tail -20 >&2
    return 1
  }
  echo "  Start verweigert, DATABASE_SSL_ROOT_CERT benannt"
}
pruefung "Produktionsprofil ohne DATABASE_SSL_ROOT_CERT verweigert den Start" production_ohne_zertifikat_scheitert

echo "== 8/8 Geordnetes Herunterfahren =="
# Zwei verschiedene Erwartungen, und der Unterschied ist gemessen, nicht
# geraten (21.08.2026):
#
#   * Die NestJS-API ruft `enableShutdownHooks()` und beendet sich mit 0.
#   * Der Next-Standalone-Server registriert KEINEN SIGTERM-Handler. Node
#     beendet den Prozess dann sofort mit 143 (128+15). Das ist ein prompter
#     Abgang auf das Signal hin, kein Abwuergen.
#
# Was in beiden Faellen NICHT passieren darf, ist 137 (128+9): dann hat Docker
# nach Ablauf der Frist SIGKILL geschickt, weil der Prozess nicht reagiert hat.
# Genau diesen Fall soll der Schritt fangen — deshalb wird der Code benannt und
# nicht bloss "ungleich null" geprueft.
stoppt_geordnet() {
  local container="$1" erlaubt="$2" code
  docker stop -t 15 "${container}" >/dev/null
  code="$(docker inspect "${container}" --format '{{.State.ExitCode}}')"
  echo "  ${container} exit=${code} erlaubt=${erlaubt}"
  if [ "${code}" = "137" ]; then
    echo "  137 = SIGKILL nach Fristablauf: der Prozess hat SIGTERM ignoriert." >&2
    return 1
  fi
  case " ${erlaubt} " in
  *" ${code} "*) return 0 ;;
  *) return 1 ;;
  esac
}
pruefung "Web-Container beendet sich auf SIGTERM ohne SIGKILL" stoppt_geordnet "${WEB_CONTAINER}" "0 143"
pruefung "API-Container beendet sich geordnet auf SIGTERM (Exitcode 0)" stoppt_geordnet "${API_CONTAINER}" "0"

bericht
