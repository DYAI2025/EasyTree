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

if node apps/api/dist/main.js >/tmp/role-gate.log 2>&1; then
  echo "::error::API ist gestartet, obwohl die Datenbankrolle nicht pruefbar war."
  cat /tmp/role-gate.log
  exit 1
fi

# Nicht nur "irgendein Fehler": es muss DIESER Fehler sein. Sonst wuerde ein
# Tippfehler in der Konfiguration denselben gruenen Haken erzeugen.
if ! grep -q "InsecureDatabaseRoleError\|Datenbankrolle" /tmp/role-gate.log; then
  echo "::error::API ist nicht gestartet, aber nicht wegen der Rollenpruefung:"
  cat /tmp/role-gate.log
  exit 1
fi

echo "Rollen-Gate OK: Start verweigert, Grund ist die Rollenpruefung."
grep -o "Die Datenbankrolle.*" /tmp/role-gate.log | head -1 || true
