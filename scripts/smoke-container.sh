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
#   4. Die interne Adresse erreicht den Browser auf KEINEM Weg: weder im
#      ausgelieferten HTML noch in einem Client-Chunk noch in einem
#      Antwortkopf — weder in einem `location`-Kopf, den die API absolut auf
#      sich selbst setzt, noch in einem gewoehnlichen Kopf wie
#      `x-upstream-url` oder `link: <…>; rel="self"`. Beide Faelle werden mit
#      einem Stub belegt, der den leckenden Kopf nachweislich sendet.
#      Und die Gegenrichtung im selben Zug: harmlose Koepfe, die das WORT der
#      internen Adresse tragen, aber nicht die Adresse (`X-Api-Version`, eine
#      Doku-URL auf einem fremden Host, ein Cookie `api_session`), muessen
#      unveraendert ankommen — sonst ist der Riegel kein Schutz, sondern ein
#      stiller Ausfall.
#   5. Die Protokolle enthalten weder Datenbankpasswort noch Anon-Key.
#   6. Beide Container laufen als nicht-privilegierter Benutzer.
#   7. Gegenprobe: mit NODE_ENV=production und ohne Wurzelzertifikat MUSS der
#      API-Container den Start verweigern. Ohne diesen Fall waere Punkt 2 auch
#      dann gruen, wenn die Konfigurationspruefung gar nichts prueft.
#   8. Ein Image, zwei Ziele: derselbe DIGEST wird zweimal gestartet und
#      erreicht zwei verschiedene APIs — ohne Neubau dazwischen. Ohne diesen
#      Punkt bliebe "anbieterneutral" eine Behauptung. Der Digest zaehlt und
#      nicht der Tag: ein Tag laesst sich zwischen zwei Starts umhaengen.
#   9. Gegenprobe dazu: fehlt das Ziel oder ist es ungueltig, wird KEIN
#      Anwendungsverkehr bedient (auch `/` antwortet 500) und das Protokoll
#      nennt EASYTREE_API_PROXY_TARGET.
#  10. SIGTERM beendet beide Container geordnet.
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
# Genau diese Adresse bekommt der Web-Container zur LAUFZEIT (seit EYT-126 wird
# sie nicht mehr in das Image gebacken). Sie ist ein reiner Dienstname im
# Container-Netz — von aussen nicht aufloesbar, was Punkt 3 ueberhaupt erst
# aussagekraeftig macht.
INTERNES_ZIEL="http://${API_CONTAINER}:3001"

# Die Namen der Ein-Image-zwei-Ziele-Probe stehen HIER und nicht erst in
# Abschnitt 8. Das Skript laeuft mit `set -Eeuo pipefail`, und `aufraeumen()`
# haengt am EXIT-Trap: waere eine dieser Variablen erst weiter unten gesetzt,
# erzeugte ein Abbruch davor einen "unbound variable"-Folgefehler, der den
# echten Grund verdeckt.
ZWEI_ZIEL_A="easytree-stub-a"
ZWEI_ZIEL_B="easytree-stub-b"
ZWEI_WEB="easytree-web-zweiziel"
ZWEI_PORT="${EASYTREE_SMOKE_ZWEI_PORT:-3020}"
# Derselbe Tag, den beide Dockerfiles als `ARG NODE_IMAGE` voreinstellen: nach
# den Bauten liegt er im lokalen Cache, der Stub zieht also nichts nach.
STUB_IMAGE="${EASYTREE_SMOKE_NODE_IMAGE:-node:22.23.1-bookworm-slim}"

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
  # Jeder Name wird zusaetzlich ueber `${VAR:-}` gelesen: die Konstanten oben
  # sind zwar vor dem Trap gesetzt, aber ein Cleanup, das seinerseits an
  # `set -u` sterben kann, ist kein Cleanup.
  docker rm -f "${WEB_CONTAINER:-}" "${API_CONTAINER:-}" \
    "${ZWEI_WEB:-}" "${ZWEI_ZIEL_A:-}" "${ZWEI_ZIEL_B:-}" >/dev/null 2>&1 || true
  docker network rm "${NETZ:-}" >/dev/null 2>&1 || true
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

echo "== 1/10 Images bauen (GIT_SHA=${GIT_SHA}) =="
docker build -f apps/api/Dockerfile --build-arg "GIT_SHA=${GIT_SHA}" -t "${API_IMAGE}" .
# KEIN --build-arg EASYTREE_API_PROXY_TARGET mehr: das Ziel ist seit EYT-126
# Laufzeitkonfiguration. Dass der Bau hier ohne die Variable durchlaeuft, ist
# bereits die erste Haelfte des Nachweises.
docker build -f apps/web/Dockerfile \
  --build-arg "GIT_SHA=${GIT_SHA}" \
  -t "${WEB_IMAGE}" .

# Ab hier zaehlt der Digest, nicht der Tag. Ein Tag laesst sich zwischen zwei
# Starts umhaengen; der Digest nicht — und genau "kein Neubau dazwischen" ist
# die Aussage, die dieser Smoke belegen soll.
WEB_DIGEST="$(docker image inspect "${WEB_IMAGE}" --format '{{.Id}}')"
echo "  Web-Image-Digest: ${WEB_DIGEST}"

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

echo "== 2/10 Bindung an den Head =="
pruefung "API-Image traegt den Head als OCI-Revision" label_ist_head "${API_IMAGE}"
pruefung "Web-Image traegt den Head als OCI-Revision" label_ist_head "${WEB_IMAGE}"
pruefung "API-Image laeuft nicht als root" laeuft_als_node "${API_IMAGE}"
pruefung "Web-Image laeuft nicht als root" laeuft_als_node "${WEB_IMAGE}"

echo "== 3/10 Topologie starten =="
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

# Der Digest, nicht der Tag — und das Ziel als LAUFZEIT-Variable.
docker run -d --name "${WEB_CONTAINER}" \
  --network "${NETZ}" \
  -p "127.0.0.1:${WEB_PORT_HOST}:3000" \
  -e NODE_ENV=production \
  -e PORT=3000 -e HOSTNAME=0.0.0.0 \
  -e "EASYTREE_API_PROXY_TARGET=${INTERNES_ZIEL}" \
  "${WEB_DIGEST}" >/dev/null

web_erreichbar() { warte_auf "http://127.0.0.1:${WEB_PORT_HOST}/"; }
pruefung "Web-Container liefert die Shell aus" web_erreichbar || {
  docker logs "${WEB_CONTAINER}" 2>&1 | tail -40 >&2
  bericht
  exit 1
}

echo "== 4/10 Interner Weg Web -> API =="
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

echo "== 5/10 Der Browser sieht die interne Adresse nicht =="
seite_ohne_interne_adresse() {
  local html
  html="$(curl -fsS "http://127.0.0.1:${WEB_PORT_HOST}/")"
  # `case` statt `printf | grep -q`: `grep -q` beendet sich beim ERSTEN Treffer,
  # `printf` bekommt EPIPE, und unter `set -o pipefail` ist die Pipeline dann
  # fehlgeschlagen — obwohl grep gefunden hat. Bei einer Leckpruefung ist das
  # die gefaehrliche Richtung: das gefundene Leck saehe aus wie keines.
  case "${html}" in
  *"${API_CONTAINER}"*)
    echo "  Dienstname steht im ausgelieferten HTML" >&2
    return 1
    ;;
  esac
  case "${html}" in
  *"${INTERNES_ZIEL}"*)
    echo "  internes Ziel steht im ausgelieferten HTML" >&2
    return 1
    ;;
  esac
  case "${html}" in
  *"<html"*) ;;
  *)
    echo "  Antwort ist kein HTML — der Test haette nichts geprueft" >&2
    return 1
    ;;
  esac
}
pruefung "das ausgelieferte HTML nennt die interne API-Adresse nicht" seite_ohne_interne_adresse

chunks_ohne_interne_adresse() {
  # Das HTML allein reicht nicht: der Wert koennte in einem Client-Chunk stehen
  # und von dort aus jederzeit im Browser landen.
  local html skripte pfad js
  html="$(curl -fsS "http://127.0.0.1:${WEB_PORT_HOST}/")"
  skripte="$(printf '%s' "${html}" | grep -oE '/_next/static/[^"]+\.js' | sort -u)"
  [ -n "${skripte}" ] || {
    echo "  kein Client-Chunk referenziert — die Pruefung waere vakuos" >&2
    return 1
  }
  for pfad in ${skripte}; do
    js="$(curl -fsS "http://127.0.0.1:${WEB_PORT_HOST}${pfad}")" || return 1
    case "${js}" in
    *"${API_CONTAINER}"*)
      echo "  Dienstname steht im Client-Chunk ${pfad}" >&2
      return 1
      ;;
    esac
  done
  echo "  $(printf '%s\n' ${skripte} | wc -l | tr -d ' ') Client-Chunks geprueft"
}
pruefung "kein Client-Chunk nennt die interne API-Adresse" chunks_ohne_interne_adresse

koepfe_ohne_interne_adresse() {
  local koepfe
  koepfe="$(curl -fsS -D - -o /dev/null "http://127.0.0.1:${WEB_PORT_HOST}/health")"
  [ -n "${koepfe}" ] || return 1
  # Kleingeschrieben verglichen, weil Kopfnamen und -werte in beliebiger
  # Schreibweise kommen duerfen; `tr` liest die Eingabe vollstaendig und kann
  # deshalb — anders als `grep -q` — kein EPIPE ausloesen.
  local klein
  klein="$(printf '%s' "${koepfe}" | tr 'A-Z' 'a-z')"
  case "${klein}" in
  *"${API_CONTAINER}"*)
    echo "  interne Adresse steht in den Antwortkoepfen" >&2
    printf '%s\n' "${koepfe}" >&2
    return 1
    ;;
  esac
  # `x-middleware-rewrite` war der gemessene Leckweg der verworfenen
  # proxy.ts-Variante. Er darf nicht durch die Hintertuer zurueckkommen.
  case "${klein}" in
  *x-middleware-rewrite*)
    echo "  x-middleware-rewrite steht in den Antwortkoepfen" >&2
    return 1
    ;;
  esac
}
pruefung "die Antwortkoepfe nennen die interne API-Adresse nicht" koepfe_ohne_interne_adresse

echo "== 6/10 Protokolle ohne Geheimnisse =="
protokolle_ohne_geheimnis() {
  local logs passwort
  logs="$(docker logs "${API_CONTAINER}" 2>&1; docker logs "${WEB_CONTAINER}" 2>&1)"
  # Das Passwort aus der Verbindungszeichenkette, ohne sie selbst zu drucken.
  passwort="$(printf '%s' "${EASYTREE_SMOKE_DATABASE_URL}" | sed -n 's#^[a-z+]*://[^:]*:\([^@]*\)@.*#\1#p')"
  if [ -n "${passwort}" ]; then
    case "${logs}" in
    *"${passwort}"*)
      echo "  Datenbankpasswort steht im Protokoll" >&2
      return 1
      ;;
    esac
  fi
  case "${logs}" in
  *"${EASYTREE_SMOKE_ANON_KEY}"*)
    echo "  Anon-Key steht im Protokoll" >&2
    return 1
    ;;
  esac
  # Eingangsbremse: haette der Aufruf gar keine Ausgabe geliefert, waere die
  # Pruefung vakuoes gruen.
  [ -n "${logs}" ]
}
pruefung "weder Datenbankpasswort noch Anon-Key stehen in den Protokollen" protokolle_ohne_geheimnis

echo "== 7/10 Gegenprobe: production ohne Wurzelzertifikat MUSS scheitern =="
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
  case "${ausgabe}" in
  *DATABASE_SSL_ROOT_CERT*) ;;
  *)
    echo "  Start scheiterte, aber nicht an DATABASE_SSL_ROOT_CERT:" >&2
    printf '%s\n' "${ausgabe}" | tail -20 >&2
    return 1
    ;;
  esac
  echo "  Start verweigert, DATABASE_SSL_ROOT_CERT benannt"
}
pruefung "Produktionsprofil ohne DATABASE_SSL_ROOT_CERT verweigert den Start" production_ohne_zertifikat_scheitert

echo "== 8/10 Ein Image, zwei Ziele, kein Neubau =="
# Die PO-Forderung woertlich: derselbe Digest wird zweimal gestartet, jedes Mal
# gegen eine andere API, und es MUSS jedes Mal die richtige antworten. Zwei
# Stub-Container statt der echten API, weil der Nachweis ueber die
# UNTERSCHEIDUNG laeuft — zwei echte APIs waeren nicht unterscheidbar.
#
# Derselbe Stub beantwortet ausserdem zwei Weiterleitungsfaelle, weil `location`
# der zweite Weg ist, auf dem die interne Adresse den Browser erreichen koennte.
#
# Auf JEDER 200er-Antwort sendet der Stub zusaetzlich zwei Koepfe, die seine
# EIGENE interne Adresse nennen — `x-upstream-url` und ein `link: <…>;
# rel="self"`. Beides sind reale Formen (Weiterleitungsketten, Hypermedia), und
# beide sind fuer same-origin-JavaScript ueber `response.headers` lesbar.
#
# Daneben stehen VIER harmlose Koepfe, und sie sind nicht bloss Beiwerk. Der
# Riegel hat zwei Fehlerrichtungen, und ein Smoke, der nur die eine misst, ist
# halb blind:
#
#   * `x-stub-marke` beantwortet "kommt ueberhaupt etwas durch";
#   * `x-api-version`, `x-documentation` (eine FREMDE Adresse) und das Cookie
#     `api_session` tragen das Wort "api" und **nicht** die interne Autoritaet.
#     Sie muessen ankommen. Eine frueherere Fassung des Riegels verglich den
#     nackten Dienstnamen als Teilstring und ueber den Kopfnamen mit — bei der
#     vorgesehenen Topologie `http://api:3001` haette das genau diese drei
#     verschluckt. Gemessen wird diese Fehlerrichtung scharf in der
#     Unit-Suite (dort heisst das Ziel woertlich `api`); hier belegt sie, dass
#     der Weg durch den echten Container dieselbe Antwort gibt.
STUB_PROGRAMM='const http=require("http");const name=process.env.STUB_NAME;const eigen=process.env.STUB_ORIGIN;http.createServer((q,s)=>{if(q.url.indexOf("weiterleitung-intern")!==-1){s.writeHead(302,{location:eigen+"/foo?x=1"});return s.end();}if(q.url.indexOf("weiterleitung-extern")!==-1){s.writeHead(302,{location:"https://login.example.org/oauth?state=xyz"});return s.end();}s.writeHead(200,{"content-type":"application/json","x-upstream-url":eigen+"/private",link:"<"+eigen+"/foo>; rel=\"self\"","x-stub-marke":"harmlos","x-api-version":"1","x-documentation":"https://api.example.org/public","set-cookie":["api_session=abc123; Path=/; HttpOnly","stub_sitzung=def456; Path=/"]});s.end(JSON.stringify({stub:name,pfad:q.url}));}).listen(3001,"0.0.0.0")'

stub_starten() {
  local name="$1"
  docker rm -f "${name}" >/dev/null 2>&1 || true
  docker run -d --name "${name}" --network "${NETZ}" --network-alias "${name}" \
    -e "STUB_NAME=${name}" \
    -e "STUB_ORIGIN=http://${name}:3001" \
    "${STUB_IMAGE}" \
    node -e "${STUB_PROGRAMM}" >/dev/null
}

web_gegen_ziel_starten() {
  local ziel="$1"
  docker rm -f "${ZWEI_WEB}" >/dev/null 2>&1 || true
  docker run -d --name "${ZWEI_WEB}" --network "${NETZ}" \
    -p "127.0.0.1:${ZWEI_PORT}:3000" \
    -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
    -e "EASYTREE_API_PROXY_TARGET=${ziel}" \
    "${WEB_DIGEST}" >/dev/null
  warte_auf "http://127.0.0.1:${ZWEI_PORT}/" || {
    docker logs "${ZWEI_WEB}" 2>&1 | tail -20 >&2
    return 1
  }
}

ziel_antwortet() {
  local erwartet="$1" ziel="$2" gelesen
  web_gegen_ziel_starten "${ziel}" || return 1
  gelesen="$(curl -fsS "http://127.0.0.1:${ZWEI_PORT}/health")"
  echo "  ziel=${ziel} -> ${gelesen}"
  case "${gelesen}" in
  *"\"stub\":\"${erwartet}\""*) return 0 ;;
  *) return 1 ;;
  esac
}

stub_starten "${ZWEI_ZIEL_A}"
stub_starten "${ZWEI_ZIEL_B}"

pruefung "derselbe Digest erreicht Ziel A" \
  ziel_antwortet "${ZWEI_ZIEL_A}" "http://${ZWEI_ZIEL_A}:3001"
pruefung "derselbe Digest erreicht Ziel B — ohne Neubau" \
  ziel_antwortet "${ZWEI_ZIEL_B}" "http://${ZWEI_ZIEL_B}:3001"

digest_unveraendert() {
  local jetzt
  jetzt="$(docker image inspect "${WEB_IMAGE}" --format '{{.Id}}')"
  echo "  vorher=${WEB_DIGEST} nachher=${jetzt}"
  [ "${jetzt}" = "${WEB_DIGEST}" ]
}
pruefung "der Image-Digest ist zwischen beiden Laeufen unveraendert" digest_unveraendert

echo "== 8b/10 Weiterleitungen lecken die interne Adresse nicht =="
# Der Stub B laeuft noch und ist das aktuelle Ziel des Web-Containers.
# `-D -` liest die Koepfe, `--max-redirs 0` folgt der Weiterleitung NICHT: was
# hier steht, ist genau das, was der Browser zu sehen bekaeme.
ort_von() {
  curl -fsS -D - -o /dev/null --max-redirs 0 "http://127.0.0.1:${ZWEI_PORT}$1" 2>/dev/null \
    | grep -i '^location:' | tr -d '\r' | sed 's/^[Ll]ocation:[[:space:]]*//'
}

interne_weiterleitung_wird_uebersetzt() {
  local ort
  ort="$(ort_von "/api/v1/weiterleitung-intern")"
  echo "  location=${ort}"
  [ -n "${ort}" ] || {
    echo "  kein location-Kopf — die Pruefung waere vakuos" >&2
    return 1
  }
  case "${ort}" in
  *"${ZWEI_ZIEL_B}"*)
    echo "  die interne Adresse steht im location-Kopf und erreicht den Browser" >&2
    return 1
    ;;
  esac
  # Pfad und Query MUESSEN erhalten bleiben, sonst ist die Uebersetzung eine
  # Verstuemmelung und keine Uebersetzung.
  [ "${ort}" = "/foo?x=1" ]
}
pruefung "eine absolute Weiterleitung auf das interne Ziel erreicht den Browser relativ" \
  interne_weiterleitung_wird_uebersetzt

externe_weiterleitung_bleibt() {
  local ort
  ort="$(ort_von "/api/v1/weiterleitung-extern")"
  echo "  location=${ort}"
  [ "${ort}" = "https://login.example.org/oauth?state=xyz" ]
}
pruefung "ein externes Weiterleitungsziel bleibt semantisch unveraendert" \
  externe_weiterleitung_bleibt

echo "== 8c/10 Auch gewoehnliche Antwortkoepfe lecken die interne Adresse nicht =="
# `location` ist nicht der einzige Kopf, der eine Adresse traegt. Der Stub B —
# weiterhin das Ziel des Web-Containers — nennt seine eigene interne Adresse in
# `x-upstream-url` und in `link`. Beide muessen hinter dem Proxy verschwunden
# sein, ohne dass dabei der harmlose Kopf mit verschwindet.
stub_leckt_direkt() {
  # Ohne diesen Schritt waere die Pruefung darunter vakuos: sendet der Stub den
  # leckenden Kopf gar nicht, beweist seine Abwesenheit hinter dem Proxy
  # nichts. Gelesen wird AUS dem Containernetz heraus, denn von aussen ist der
  # Stub nicht erreichbar — genau das ist ja der Punkt.
  local ausgabe
  ausgabe="$(docker run --rm --network "${NETZ}" \
    -e "STUB_URL=http://${ZWEI_ZIEL_B}:3001" "${STUB_IMAGE}" \
    node -e 'fetch(process.env.STUB_URL+"/health").then(r=>{for(const k of ["x-upstream-url","link","x-stub-marke","x-api-version","x-documentation"])console.log(k+"="+r.headers.get(k));console.log("set-cookie="+r.headers.getSetCookie().join(" || "));}).catch(e=>{console.log("fehler="+e.message);process.exitCode=1})')" || return 1
  printf '  direkt vom Stub: %s\n' "$(printf '%s' "${ausgabe}" | tr '\n' ' ')"
  case "${ausgabe}" in
  *"${ZWEI_ZIEL_B}"*) ;;
  *)
    echo "  der Stub nennt seine interne Adresse in KEINEM Kopf — die Pruefung darunter waere vakuos" >&2
    return 1
    ;;
  esac
  # Und die Eingangsbremsen muss es beim Stub auch wirklich geben — alle vier,
  # sonst prueft die Erhaltungsseite darunter weniger, als sie behauptet.
  local bremse
  for bremse in "x-stub-marke=harmlos" "x-api-version=1" \
    "x-documentation=https://api.example.org/public" "api_session=abc123"; do
    case "${ausgabe}" in
    *"${bremse}"*) ;;
    *)
      echo "  der Stub sendet '${bremse}' nicht — die Erhaltungspruefung waere blind" >&2
      printf '%s\n' "${ausgabe}" >&2
      return 1
      ;;
    esac
  done
}
pruefung "der Stub nennt seine interne Adresse tatsaechlich in einem Nicht-location-Kopf" \
  stub_leckt_direkt

gewoehnliche_koepfe_ohne_leck() {
  local koepfe klein
  koepfe="$(curl -fsS -D - -o /dev/null "http://127.0.0.1:${ZWEI_PORT}/health")"
  [ -n "${koepfe}" ] || return 1
  # `tr` liest die Eingabe vollstaendig und kann deshalb — anders als
  # `grep -q` — kein EPIPE ausloesen, das unter `pipefail` einen Treffer in
  # einen Fehlschlag verkehren wuerde.
  klein="$(printf '%s' "${koepfe}" | tr 'A-Z' 'a-z')"
  case "${klein}" in
  *"${ZWEI_ZIEL_B}"*)
    echo "  die interne Adresse steht in den Antwortkoepfen" >&2
    printf '%s\n' "${koepfe}" >&2
    return 1
    ;;
  esac
  case "${klein}" in
  *x-upstream-url*)
    echo "  der leckende Kopf x-upstream-url erreicht den Browser" >&2
    printf '%s\n' "${koepfe}" >&2
    return 1
    ;;
  esac
  # Eingangsbremse: der harmlose Kopf des Stubs MUSS durchkommen. Sonst bewiese
  # die Abwesenheit oben nur, dass ueberhaupt nichts durchgereicht wird.
  case "${klein}" in
  *x-stub-marke*) ;;
  *)
    echo "  auch der harmlose Kopf x-stub-marke fehlt — es wird gar nichts durchgereicht" >&2
    printf '%s\n' "${koepfe}" >&2
    return 1
    ;;
  esac
  echo "  x-upstream-url und link entfernt, x-stub-marke durchgereicht"
}
pruefung "kein gewoehnlicher Antwortkopf traegt die interne Adresse zum Browser" \
  gewoehnliche_koepfe_ohne_leck

harmlose_koepfe_ueberleben() {
  # Die andere Fehlerrichtung. Der Riegel darf nur die ADRESSE treffen, nicht
  # das Wort: alle drei Koepfe hier tragen "api", keiner die interne
  # Autoritaet. Verschluckt der Proxy sie, ist er kaputt — nur eben still.
  local koepfe klein fehlt=0
  koepfe="$(curl -fsS -D - -o /dev/null "http://127.0.0.1:${ZWEI_PORT}/health")"
  [ -n "${koepfe}" ] || return 1
  klein="$(printf '%s' "${koepfe}" | tr 'A-Z' 'a-z')"
  local erwartet
  for erwartet in "x-api-version: 1" "x-documentation: https://api.example.org/public" \
    "api_session=abc123" "stub_sitzung=def456"; do
    case "${klein}" in
    *"${erwartet}"*) ;;
    *)
      echo "  der harmlose Kopf '${erwartet}' wurde unterwegs verschluckt" >&2
      fehlt=1
      ;;
    esac
  done
  if [ "${fehlt}" -ne 0 ]; then
    printf '%s\n' "${koepfe}" >&2
    return 1
  fi
  # Zwei Cookies bleiben zwei — der Riegel darf nicht zusammenfalten.
  local kekse
  kekse="$(printf '%s' "${koepfe}" | tr -d '\r' | grep -ci '^set-cookie:' || true)"
  echo "  set-cookie-Koepfe: ${kekse}"
  [ "${kekse}" = "2" ] || {
    echo "  erwartet waren zwei getrennte set-cookie-Koepfe" >&2
    return 1
  }
  echo "  x-api-version, x-documentation und beide Cookies unveraendert durchgereicht"
}
pruefung "harmlose Koepfe mit dem Wort 'api' ueberleben den Riegel unveraendert" \
  harmlose_koepfe_ueberleben

echo "== 9/10 Fail-closed zur Laufzeit =="
start_verweigert() {
  local beschreibung="$1" antwort
  shift
  docker rm -f "${ZWEI_WEB}" >/dev/null 2>&1 || true
  docker run -d --name "${ZWEI_WEB}" --network "${NETZ}" \
    -p "127.0.0.1:${ZWEI_PORT}:3000" \
    -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
    "$@" "${WEB_DIGEST}" >/dev/null
  sleep 8
  # Die Startseite, nicht `/health`: die Zusage lautet, dass KEIN normaler
  # Anwendungsverkehr bedient wird.
  antwort="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:${ZWEI_PORT}/")"
  echo "  ${beschreibung}: / -> HTTP ${antwort}"
  [ "${antwort}" = "500" ] || return 1
  # Nicht irgendein 500: es MUSS diese Variable sein.
  # Erst einlesen, dann vergleichen. `docker logs | grep -q` ist hier gemessen
  # unzuverlaessig: grep beendet sich beim ersten Treffer, `docker logs` stirbt
  # an EPIPE, und `pipefail` macht daraus einen Fehlschlag — die Pruefung ging
  # rot, obwohl das Protokoll die Variable nannte (22.08.2026).
  local protokoll
  protokoll="$(docker logs "${ZWEI_WEB}" 2>&1)"
  case "${protokoll}" in
  *EASYTREE_API_PROXY_TARGET*) ;;
  *)
    echo "  500, aber das Protokoll nennt EASYTREE_API_PROXY_TARGET nicht" >&2
    printf '%s\n' "${protokoll}" | tail -20 >&2
    return 1
    ;;
  esac
}
pruefung "ohne Proxyziel wird kein Anwendungsverkehr bedient" \
  start_verweigert "Ziel fehlt"
pruefung "mit ungueltigem Proxyziel wird kein Anwendungsverkehr bedient" \
  start_verweigert "Ziel ungueltig" -e "EASYTREE_API_PROXY_TARGET=ftp://api:3001"

docker rm -f "${ZWEI_WEB}" "${ZWEI_ZIEL_A}" "${ZWEI_ZIEL_B}" >/dev/null 2>&1 || true

echo "== 10/10 Geordnetes Herunterfahren =="
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
