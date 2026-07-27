#!/usr/bin/env bash
# assert-tenant-report.sh (EYT-71) — prueft die Report-Zeile einer
# fail-closed-Suite im Required-Modus.
#
# Aufruf: assert-tenant-report.sh <prefix> <logfile>
#   z. B. assert-tenant-report.sh tenant-isolation /tmp/tenant-direct.log
#
# Verlangt genau das, was ein gruenes Pflicht-Gate bedeuten soll:
#   executed >= 1     (kein Leerlauf — null ausgefuehrte Tests sind kein Beweis)
#   passed == executed (jeder ausgefuehrte Test ist auch bestanden)
#   skipped == 0      (kein Pflichttest uebersprungen, EYT-66)
#
# Warum ein Skript statt eines Greps: die Bedingung "passed == executed" ist mit
# einem erweiterten regulaeren Ausdruck nicht formulierbar, und die BRE-Variante
# mit Rueckreferenz (`passed=\1`) haengt an der grep-Implementierung — ugrep
# etwa lehnt sie ab. Ein Pflicht-Gate darf nicht davon abhaengen, welches grep
# im PATH liegt. Zusaetzlich kann diese Fassung sagen, WELCHE Bedingung brach.
set -euo pipefail

PREFIX="${1:?Aufruf: assert-tenant-report.sh <prefix> <logfile>}"
LOGFILE="${2:?Aufruf: assert-tenant-report.sh <prefix> <logfile>}"

die() {
  printf '::error::[%s] %s\n' "$PREFIX" "$1" >&2
  exit 1
}

[ -r "$LOGFILE" ] || die "Logdatei ${LOGFILE} fehlt oder ist nicht lesbar."

# Letzte passende Zeile: bei mehreren Laeufen im selben Log zaehlt der juengste.
line="$(grep -F "[${PREFIX}] mode=required " "$LOGFILE" | tail -1 || true)"
[ -n "$line" ] || die "Keine Report-Zeile 'mode=required' in ${LOGFILE}. Suite lief nicht im Pflichtmodus."

field() {
  printf '%s\n' "$line" | sed -n "s/.* $1=\([0-9][0-9]*\).*/\1/p"
}

executed="$(field executed)"
passed="$(field passed)"
skipped="$(field skipped)"

for name in executed passed skipped; do
  eval "value=\${$name}"
  case "$value" in
    '' | *[!0-9]*) die "Feld '${name}' fehlt oder ist keine Zahl. Zeile: ${line}" ;;
  esac
done

[ "$executed" -ge 1 ] ||
  die "executed=${executed} — kein einziger Pflichttest ausgefuehrt. Zeile: ${line}"
[ "$skipped" -eq 0 ] ||
  die "skipped=${skipped} — Pflichttests uebersprungen (EYT-66). Zeile: ${line}"
[ "$passed" -eq "$executed" ] ||
  die "passed=${passed} von executed=${executed} — nicht jeder ausgefuehrte Pflichttest ist bestanden (EYT-71). Zeile: ${line}"

printf '[%s] Gate OK: executed=%s passed=%s skipped=%s\n' \
  "$PREFIX" "$executed" "$passed" "$skipped"
