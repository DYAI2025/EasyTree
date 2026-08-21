#!/usr/bin/env bash
# Integrierter Read-Through-Nachweis (EYT-50).
#
# Browser -> Same-Origin-Rewrite -> NestJS -> TenantQueryRunner -> RLS ->
# PostgreSQL. Ersetzt sind ausschliesslich Subjektresolver und Access-Policy
# (apps/api/test/harness/server.ts); Repository, Runner, Pool und Controller
# sind echt.
#
# ## Warum EIN Skript und nicht mehrere Workflow-Steps
#
# Ein `trap` gilt nur im eigenen Prozess. Ueber mehrere Steps verteilt haette
# jeder seinen eigenen, und ein Fehlschlag in Schritt 13 raeumte die in
# Schritt 10 gestarteten Prozesse nicht ab — der Runner bliebe mit offener
# API, offenem Web und laufendem Docker zurueck. Deshalb besitzt dieses Skript
# beide PIDs, beide Logs und das Aufraeumen vollstaendig.
#
# ## Keine festen Sleeps als Bereitschaftsnachweis
#
# Gewartet wird auf eine ANTWORT, nicht auf eine Dauer. Zusaetzlich `kill -0`:
# ein Prozess, der beim Start gestorben ist, wuerde sonst bis zum Timeout
# angepollt, und die Meldung waere "nicht erreichbar" statt "abgestuerzt".
set -Eeuo pipefail

API_PORT=3001
WEB_PORT=3000
API_ORIGIN="http://127.0.0.1:${API_PORT}"
WEB_ORIGIN="http://127.0.0.1:${WEB_PORT}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
APP_PASSWORT="ci-local-app-password"

# Subjekt A: aktives Mitglied von Organisation Alpha (supabase/seed.sql).
SUBJEKT_A="00000000-0000-4000-8000-00000000aaa1"

LOGS="$(pwd)/harness-logs"
mkdir -p "$LOGS"
API_PID=""
WEB_PID=""

aufraeumen() {
  local code=$?
  set +e
  echo "::group::Harness aufraeumen (exit ${code})"
  [ -n "$API_PID" ] && kill -TERM "$API_PID" 2>/dev/null && wait "$API_PID" 2>/dev/null
  [ -n "$WEB_PID" ] && kill -TERM "$WEB_PID" 2>/dev/null && wait "$WEB_PID" 2>/dev/null
  pnpm exec supabase stop --no-backup >/dev/null 2>&1
  echo "::endgroup::"
  exit "$code"
}
trap aufraeumen EXIT INT TERM

# Wartet auf eine HTTP-Antwort UND darauf, dass der Prozess noch lebt.
warte_auf() {
  local name="$1" url="$2" pid="$3" versuche=60
  for ((i = 1; i <= versuche; i++)); do
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      echo "FEHLER: ${name} ist beim Start gestorben (PID ${pid})." >&2
      return 1
    fi
    if curl -fsS -o /dev/null --max-time 2 "$url"; then
      echo "${name} erreichbar nach ${i} Versuchen."
      return 0
    fi
    sleep 1
  done
  echo "FEHLER: ${name} unter ${url} nach ${versuche} Versuchen nicht erreichbar." >&2
  return 1
}

echo "::group::1-2 Supabase starten und zuruecksetzen"
pnpm exec supabase start -x studio
pnpm exec supabase db reset
echo "::endgroup::"

echo "::group::3 Laufzeitrolle provisionieren"
# easytree_app hat bewusst kein Passwort in der Migration (0003) — Geheimnisse
# gehoeren nicht nach git. Lokal wird es hier gesetzt.
PGPASSWORD=postgres psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres sslmode=disable" \
  -v ON_ERROR_STOP=1 -c "alter role easytree_app password '${APP_PASSWORT}';"
echo "::endgroup::"

# Die Harness-Fixtures werden BEWUSST erst nach dem Prozessstart eingespielt
# (Phase 12c). Grund steht dort.

echo "::group::6-9 Bauen"
pnpm --filter @easytree/api^... build
pnpm --filter @easytree/api run build:harness
# Der Bau braucht das Ziel seit EYT-126 nicht mehr — es wird beim `next start`
# unten gesetzt und dort bei jeder Anfrage neu gelesen.
pnpm --filter @easytree/web... build
pnpm --filter @easytree/web exec playwright install --with-deps chromium
echo "::endgroup::"

echo "::group::10-12 Prozesse starten und Bereitschaft abwarten"
(
  cd apps/api
  NODE_ENV=test \
  DATABASE_URL="postgresql://easytree_app:${APP_PASSWORT}@127.0.0.1:54322/postgres" \
  SUPABASE_URL="http://127.0.0.1:54321" \
  SUPABASE_ANON_KEY="harness-anon-key" \
  API_PORT="$API_PORT" \
  LOG_LEVEL="debug" \
  node dist-harness/test/harness/main.js "$SUBJEKT_A" "$API_PORT"
) >"$LOGS/api.log" 2>&1 &
API_PID=$!
warte_auf "API" "${API_ORIGIN}/health" "$API_PID"

(
  cd apps/web
  EASYTREE_API_PROXY_TARGET="$API_ORIGIN" pnpm exec next start -p "$WEB_PORT"
) >"$LOGS/web.log" 2>&1 &
WEB_PID=$!
warte_auf "Web" "$WEB_ORIGIN" "$WEB_PID"

# Und der Beweis, dass das Rewrite steht, BEVOR ein Browser startet: /health
# ueber die WEB-Origin muss NestJS erreichen.
warte_auf "Rewrite" "${WEB_ORIGIN}/health" "$WEB_PID"
echo "::endgroup::"

echo "::group::12b Diagnoseabruf vor dem Browser"
# Der Fachaufruf einmal direkt, BEVOR Playwright startet.
#
# Grund: der Exception-Filter gibt bewusst keine Stacktraces aus (EYT-58), und
# LOG_LEVEL=error haelt den Nest-Logger still. Ein 500 waere damit im
# Browsertest sichtbar und im Log unsichtbar — genau das ist beim ersten Lauf
# passiert, und die Diagnose kostete einen ganzen Durchgang.
#
# Die Antwort landet im Artefakt, egal ob sie gelingt. `|| true`, weil dieser
# Schritt DIAGNOSTIZIERT und nicht urteilt: die Zusicherungen stehen in den
# Tests.
# Abgefragt wird W32 (Standardseed) und NICHT W40: die Harness-Fixtures sind an
# dieser Stelle noch nicht eingespielt (siehe 12c/12d), eine W40-Abfrage lieferte
# also eine leere Woche und im Log stuende ein irrefuehrendes Ergebnis.
{
  echo "--- GET /api/v1/planung/fenster?weekKey=2026-W32 (direkt an die API) ---"
  curl -sS -i --max-time 10 "${API_ORIGIN}/api/v1/planung/fenster?weekKey=2026-W32" || true
  echo
  echo "--- dasselbe ueber die WEB-Origin (Rewrite) ---"
  curl -sS -i --max-time 10 "${WEB_ORIGIN}/api/v1/planung/fenster?weekKey=2026-W32" || true
} >"$LOGS/diagnose.txt" 2>&1
sed -n '1,40p' "$LOGS/diagnose.txt"
echo "::endgroup::"

echo "::group::12c Standardseed-Kern (EYT-91) — VOR den Harness-Fixtures"
# Diese Phase laeuft, waehrend die Datenbank ausschliesslich den Stand von
# `supabase db reset` traegt: Migrationen plus `supabase/seed.sql`. Die
# W40-Fixtures aus `apps/web/e2e/harness/seed.sql` existieren hier noch NICHT.
#
# Das ist der Unterschied zwischen behaupteter und struktureller
# Unabhaengigkeit. Liefe der Nachweis erst nach dem Einspielen, muesste er
# ZUSICHERN, dass keine Harness-Zeile eingesprungen ist. Hier kann keine
# einspringen, weil keine da ist.
#
# Genau umgekehrt verhaelt es sich mit der Abgrenzungspruefung
# ("Standardseed-Abgrenzung"): die sucht Harness-Spuren in der W32-Antwort und
# waere ohne vorhandene Fixtures vakuum — sie findet nichts, weil es nichts
# gibt, und faerbt sich gruen ohne etwas gemessen zu haben. Sie laeuft deshalb
# bewusst SPAETER, in Phase 13.
EASYTREE_API_ORIGIN="$API_ORIGIN" PLAYWRIGHT_BASE_URL="$WEB_ORIGIN" \
  pnpm --filter @easytree/web exec playwright test \
    -c playwright.harness.config.ts --grep "Standardseed-Kern"
echo "::endgroup::"

echo "::group::12d Harness-Fixtures einspielen und fail-closed pruefen"
# Erst jetzt — siehe 12c. Die Prozesse laufen bereits; sie brauchen nur die
# Datenbank, nicht diese Fixtures.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f apps/web/e2e/harness/seed.sql
# Diese Datei wirft bei jeder Abweichung; ein gruener Schritt hier heisst,
# dass Alpha UND Beta wirklich existieren.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f apps/web/e2e/harness/verify-seed.sql
echo "::endgroup::"

echo "::group::13 Gesunde Nachweise"
# Ohne "Standardseed-Kern": der lief bereits in 12c gegen den reinen Seed. Ein
# zweiter Lauf hier waere nicht falsch, aber er wuerde die Aussage verwaessern
# — er liefe gegen eine Datenbank, die inzwischen auch Harness-Daten haelt.
EASYTREE_API_ORIGIN="$API_ORIGIN" PLAYWRIGHT_BASE_URL="$WEB_ORIGIN" \
  pnpm --filter @easytree/web exec playwright test \
    -c playwright.harness.config.ts --grep-invert "Nachweis 7|Standardseed-Kern|Schreibpfad"
echo "::endgroup::"

echo "::group::13b Schreibpfad — Formular bis PostgreSQL und zurueck (EYT-92)"
# AUSDRUECKLICH nach Phase 13 und in einem eigenen Aufruf.
#
# Der Grund ist eine echte Abhaengigkeit, keine Formalie: "Nachweis 4" prueft,
# dass Woche W40 GENAU EINE Zuweisung zeigt. Der Schreibpfad legt eine zweite
# an. Liefen beide im selben Aufruf, entschiede die Reihenfolge der
# Deklaration im Spec darueber, ob Nachweis 4 gruen wird — und die kann
# jemand beim Umsortieren aendern, ohne es zu merken. Zwei Aufrufe machen die
# Reihenfolge zu einer Eigenschaft DIESES Skripts.
#
# Umgekehrt gilt: der Schreibpfad braucht die Fixtures aus 12d, also kann er
# nicht frueher laufen.
EASYTREE_API_ORIGIN="$API_ORIGIN" PLAYWRIGHT_BASE_URL="$WEB_ORIGIN" \
  pnpm --filter @easytree/web exec playwright test \
    -c playwright.harness.config.ts --grep "Schreibpfad"
echo "::endgroup::"

echo "::group::14 API kontrolliert beenden"
kill -TERM "$API_PID"
wait "$API_PID" 2>/dev/null || true
API_PID=""
# Bestaetigen, dass wirklich niemand mehr antwortet — sonst pruefte Nachweis 7
# eine laufende API.
if curl -fsS -o /dev/null --max-time 2 "${API_ORIGIN}/health"; then
  echo "FEHLER: API antwortet nach SIGTERM noch." >&2
  exit 1
fi
echo "API beendet und bestaetigt."
echo "::endgroup::"

echo "::group::15 Nachweis 7 ohne API"
PLAYWRIGHT_BASE_URL="$WEB_ORIGIN" \
  pnpm --filter @easytree/web exec playwright test \
    -c playwright.harness.config.ts --grep "Nachweis 7"
echo "::endgroup::"

echo "Read-Through-Harness OK: gesunde Lesenachweise + Schreibpfad + Ausfallnachweis."
