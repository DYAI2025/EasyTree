#!/usr/bin/env bash
# smoke-worker.sh (EYT-58, gehaertet in EYT-70) — boots the built worker,
# asserts it opens NO listening TCP port (ADR-001 §2: same module, no HTTP),
# then verifies graceful shutdown on SIGTERM. Requires the same strict
# test-preset env as smoke-api.sh.
#
# EYT-70: die Portpruefung kannte frueher nur zwei Ausgaenge — "Listener
# gefunden" und "alles andere". Ein fehlgeschlagenes `ss` (Fehler, fehlende
# Rechte, leere Ausgabe) fiel damit in denselben Zweig wie "kein Listener" und
# erzeugte ein gruenes Pflicht-Gate, ohne je geprueft zu haben. Ebenso auf
# macOS: `/proc` fehlt und `find -printf` ist GNU-only, also lief die
# Fallback-Schleife ueber nichts und meldete "sauber".
#
# Jetzt drei Zustaende:
#   0 = Listener gehoert dem Prozess          -> Smoke rot
#   1 = geprueft, kein Listener               -> Smoke darf gruen werden
#   2 = Pruefung war nicht moeglich           -> Smoke rot (NICHT "kein Listener")
set -euo pipefail

# --- Testhaken (wie PLAYWRIGHT_CHROMIUM_PATH in playwright.config.ts) --------
# EASYTREE_SMOKE_PROBE_PID: nur die Portpruefung gegen diese PID ausfuehren und
#   mit ihrem Zustand terminieren. Ohne Worker-Start. Macht den Rot-Fall
#   reproduzierbar pruefbar, statt ihn zu behaupten.
# EASYTREE_SMOKE_FORCE_PROBE: proc | lsof | ss | none — erzwingt ein Verfahren,
#   auch wenn es nicht verfuegbar ist. "none" simuliert eine Umgebung ohne
#   jedes Werkzeug und muss zu Zustand 2 fuehren.
PROBE_PID_OVERRIDE="${EASYTREE_SMOKE_PROBE_PID:-}"
FORCE_PROBE="${EASYTREE_SMOKE_FORCE_PROBE:-}"

# WICHTIG: keine dieser Funktionen fasst `set -e` an. Ein `set -e` in einer
# Funktion gilt fuer die GANZE Shell und hebt ein `set +e` des Aufrufers auf —
# der naechste `return 1` loest dann errexit aus und das Skript bricht STILL
# mit 1 ab. Das sieht von aussen aus wie "kein Listener" und ist derselbe
# Fehlertyp, den EYT-70 beseitigen soll. Stattdessen ueberall die
# errexit-sicheren Formen `cmd || rc=$?` und `if cmd; then`.
fail_check() {
  printf '::error::Portpruefung nicht moeglich: %s\n' "$1" >&2
}

# /proc-Verfahren (Linux). Autoritativ fuer einen selbst gestarteten Prozess:
# wir besitzen ihn, also ist /proc/<pid>/fd lesbar — keine Rechte-Grauzone wie
# bei der PID-Zuordnung von `ss`.
# Kein `find -printf` (GNU-only): readlink je fd ist portabel.
probe_proc() {
  local pid="$1" fd target inode table
  [ -d "/proc/${pid}/fd" ] || return 2
  [ -r "/proc/${pid}/fd" ] || return 2
  [ -r /proc/net/tcp ] || return 2

  for fd in "/proc/${pid}/fd"/*; do
    [ -e "$fd" ] || continue
    target="$(readlink "$fd" 2>/dev/null)" || continue
    case "$target" in
      "socket:["*"]") inode="${target#socket:[}"; inode="${inode%]}" ;;
      *) continue ;;
    esac
    for table in /proc/net/tcp /proc/net/tcp6; do
      [ -r "$table" ] || continue
      # Spalte 4 = st (0A = LISTEN), Spalte 10 = inode.
      if awk -v want="$inode" '$4 == "0A" && $10 == want { found = 1 } END { exit !found }' \
        "$table"; then
        return 0
      fi
    done
  done
  return 1
}

# lsof-Verfahren (macOS/BSD, wo /proc fehlt). Exit 1 von lsof heisst bei
# -iTCP "keine Treffer"; alles andere ist ein echter Fehler und darf NICHT als
# "kein Listener" durchgehen.
probe_lsof() {
  local pid="$1" out rc=0
  command -v lsof >/dev/null 2>&1 || return 2
  out="$(lsof -a -p "$pid" -iTCP -sTCP:LISTEN -P -n 2>/dev/null)" || rc=$?
  case "$rc" in
    0)
      [ -n "$out" ] || return 1
      return 0
      ;;
    1) return 1 ;;
    *) return 2 ;;
  esac
}

# ss-Verfahren. Nur Fallback: ein nicht-null Exitcode oder voellig leere
# Ausgabe ist ab jetzt Zustand 2 und nicht mehr stillschweigend "kein Match".
probe_ss() {
  local pid="$1" out rc=0
  command -v ss >/dev/null 2>&1 || return 2
  out="$(ss -ltnp 2>/dev/null)" || rc=$?
  [ "$rc" -eq 0 ] || return 2
  # ss druckt selbst ohne Sockets eine Kopfzeile. Voellig leer = es hat uns
  # nichts gesagt, und das ist keine Aussage ueber Listener.
  [ -n "$out" ] || return 2
  printf '%s\n' "$out" | grep -q "pid=${pid}," && return 0
  return 1
}

# Liefert 0/1/2 und meldet auf stderr, welches Verfahren gegriffen hat.
worker_listening_state() {
  local pid="$1" state=0 name

  case "$FORCE_PROBE" in
    proc | lsof | ss)
      state=0
      "probe_${FORCE_PROBE}" "$pid" || state=$?
      printf 'Portpruefung erzwungen via %s: %s\n' "$FORCE_PROBE" "$state" >&2
      return "$state"
      ;;
    none)
      fail_check "EASYTREE_SMOKE_FORCE_PROBE=none erzwingt den Nicht-pruefbar-Fall"
      return 2
      ;;
    "") ;;
    *)
      fail_check "unbekanntes EASYTREE_SMOKE_FORCE_PROBE='${FORCE_PROBE}'"
      return 2
      ;;
  esac

  for name in proc lsof ss; do
    state=0
    "probe_${name}" "$pid" || state=$?
    if [ "$state" -ne 2 ]; then
      printf 'Portpruefung via %s: %s\n' "$name" "$state" >&2
      return "$state"
    fi
  done

  fail_check "weder /proc noch lsof noch ss lieferten ein verwertbares Ergebnis"
  return 2
}

# --- Testhaken-Modus: nur pruefen, nichts starten --------------------------
if [ -n "$PROBE_PID_OVERRIDE" ]; then
  probe_state=0
  worker_listening_state "$PROBE_PID_OVERRIDE" || probe_state=$?
  printf 'probe_state=%s\n' "$probe_state"
  exit "$probe_state"
fi

# --- Regulaerer Smoke ------------------------------------------------------
node apps/api/dist/worker.js & PID=$!
trap 'kill -9 $PID 2>/dev/null || true' EXIT

sleep 5

if ! kill -0 $PID 2>/dev/null; then
  echo "::error::Worker exited prematurely"
  exit 1
fi

STATE=0
worker_listening_state "$PID" || STATE=$?

case "$STATE" in
  0)
    echo "::error::Worker opened an unexpected listening port"
    exit 1
    ;;
  1)
    echo "worker holds no listening TCP port (geprueft)"
    ;;
  *)
    echo "::error::Worker-Portpruefung konnte nicht ausgefuehrt werden — fail-closed (EYT-70)"
    exit 1
    ;;
esac

kill -TERM $PID
for _ in $(seq 1 10); do
  kill -0 $PID 2>/dev/null || {
    trap - EXIT
    echo "worker shutdown OK"
    exit 0
  }
  sleep 1
done

echo "::error::Worker did not shut down gracefully"
exit 1
