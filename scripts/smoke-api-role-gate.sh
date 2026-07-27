#!/usr/bin/env bash
# smoke-api-role-gate.sh (EYT-45) — beweist, dass die API NICHT startet, wenn
# die Datenbankrolle nicht als RLS-gebunden verifiziert werden kann.
#
# Loest den frueheren Smoke "dependency down -> ready 503" fuer den STARTFALL ab.
# Grund: seit EYT-45 prueft der Bootstrap die Rollenattribute und verweigert den
# Start fail-closed, wenn er sie nicht ermitteln kann. Eine unerreichbare
# Datenbank darf die Sicherheitspruefung nicht stillschweigend ueberspringen.
#
# Das 503-Verhalten der Readiness bleibt abgedeckt — in
# apps/api/test/health.e2e.test.ts, wo der DATABASE_PING-Token per DI ersetzt
# wird. Dort gehoert es hin: Readiness beschreibt einen LAUFENDEN Prozess,
# dessen Abhaengigkeit ausfaellt, nicht einen Prozess, der nie starten durfte.
#
# Erwartet dieselbe strikte Test-Preset-Umgebung wie smoke-api.sh.
set -euo pipefail

# Der Prozess laeuft im HINTERGRUND mit Zeitschranke.
#
# Die erste Fassung startete ihn im Vordergrund. Faellt das Rollen-Gate aus —
# also genau der Fehler, den dieser Smoke fangen soll — dann startet die API
# erfolgreich und bedient endlos Anfragen. Das Skript haette nie zurueckgegeben,
# und der Job waere bis zum Job-Timeout gehangen, statt die Regression zu
# melden. Eine Pruefung, die im Fehlerfall haengt statt rot zu werden, ist keine.
TIMEOUT_SECONDS="${ROLE_GATE_TIMEOUT_SECONDS:-30}"
LOG="$(mktemp -t eyt-role-gate)"

node apps/api/dist/main.js >"$LOG" 2>&1 &
PID=$!
trap 'kill -9 "$PID" 2>/dev/null || true; rm -f "$LOG"' EXIT

exit_code=""
for _ in $(seq 1 "$TIMEOUT_SECONDS"); do
  if ! kill -0 "$PID" 2>/dev/null; then
    set +e
    wait "$PID"
    exit_code=$?
    set -e
    break
  fi
  sleep 1
done

if [ -z "$exit_code" ]; then
  echo "::error::API laeuft nach ${TIMEOUT_SECONDS}s noch — das Rollen-Gate hat NICHT gegriffen."
  cat "$LOG"
  exit 1
fi

if [ "$exit_code" -eq 0 ]; then
  echo "::error::API ist sauber beendet worden, statt den Start zu verweigern."
  cat "$LOG"
  exit 1
fi

# Nicht nur "irgendein Fehler": es muss DIESER Fehler sein. Sonst wuerde ein
# Tippfehler in der Konfiguration denselben gruenen Haken erzeugen.
if ! grep -q "Die Datenbankrolle" "$LOG"; then
  echo "::error::API ist nicht gestartet, aber nicht wegen der Rollenpruefung:"
  cat "$LOG"
  exit 1
fi

echo "Rollen-Gate OK: Start verweigert (exit ${exit_code}), Grund ist die Rollenpruefung."
grep -o "Die Datenbankrolle.*" "$LOG" | head -1 || true
