#!/usr/bin/env bash
# Projektlokaler PRIL Scope Guard (EYT Sprint 5, PO-Weisung 30.07.2026 §4).
#
# WARUM DIESE DATEI EXISTIERT
# ---------------------------
# Die gemeinsam genutzte Plumbline-Installation berechnet ihre Pruefoberflaeche in
# config/claude/hooks/plumbline-enforce.sh so:
#
#     base="$(git -C "$repo" merge-base HEAD main 2>/dev/null)" || base=""
#     [ -n "$base" ] || base="HEAD"
#
# EasyTree hat keinen Branch `main`, sondern `master`. Der Aufruf scheitert, der Fallback
# setzt base="HEAD", und `git diff HEAD...HEAD` ist leer. Damit ist die Haelfte
# "committed feature work" der Oberflaeche **wirkungslos**: bereits committete
# Out-of-Scope-Aenderungen laufen durch den Scope-Guard hindurch. Gemessen 30.07.2026:
#
#     $ git merge-base HEAD main
#     fatal: Not a valid object name main
#
# Dieser Wrapper kompensiert das fail-closed, ohne die gemeinsame Installation zu
# veraendern. Er ist reversibel: loeschen stellt exakt den vorherigen Zustand her.
#
# UNTERSCHIEDE ZUM HOOK (alle fail-closed statt fail-open)
#   1. Base kommt aus docs/context/.scope-base, sonst origin/master, sonst Abbruch.
#      Es gibt KEINEN Fallback auf HEAD.
#   2. Laesst sich die Merge-Base nicht bestimmen, blockiert der Guard (Exit 4).
#   3. Ein vorhandener, aber leerer oder unplausibler Feature-Marker blockiert.
#      Nur ein vollstaendig ABWESENDER Marker ist ein No-op.
#
# VERWENDUNG
#   scripts/plumbline-scope-guard.sh              # echtes Repository pruefen
#   scripts/plumbline-scope-guard.sh --self-test  # Gegenmutation in einem Wegwerf-Repo
#
# EXIT-CODES
#   0 bestanden oder kein Feature armiert
#   3 Scope-Verletzung
#   4 Guard kann nicht sicher laufen (Base/Marker/Werkzeug fehlt) -> blockierend
set -euo pipefail

BIN="${PLUMBLINE_BIN:-$HOME/.claude/bin}"
SCOPE_CHECK="$BIN/plumbline-scope-check"

die() {
  printf 'PRIL scope guard BLOCKED: %s\n' "$1" >&2
  exit 4
}

# ---------------------------------------------------------------- surface ----
# Vier Quellen, wie vom PO gefordert: committed, unstaged, staged, untracked.
# `merge-base`..HEAD liefert die committete Feature-Arbeit; ohne korrekte Base
# waere genau dieser Teil leer, was der Defekt oben ist.
collect_surface() {
  local repo="$1" base_sha="$2" out="$3"
  # Zweite Verteidigungslinie: ohne aufgeloeste Base waere `diff ...HEAD` sinnlos und
  # der committete Teil der Oberflaeche still leer - genau der Defekt, den dieser
  # Wrapper kompensiert. Deshalb hier hart abbrechen statt weiterzurechnen.
  [ -n "$base_sha" ] || die "interner Fehler: leere Scope-Base an collect_surface"
  {
    git -C "$repo" diff --name-only "$base_sha...HEAD"
    git -C "$repo" diff --name-only
    git -C "$repo" diff --name-only --cached
    git -C "$repo" ls-files --others --exclude-standard
  } | sed '/^$/d' | sort -u > "$out"
}

resolve_base_sha() {
  local repo="$1" pin ref
  pin=""
  if [ -n "${PLUMBLINE_SCOPE_BASE:-}" ]; then
    pin="$PLUMBLINE_SCOPE_BASE"
  elif [ -f "$repo/docs/context/.scope-base" ]; then
    pin="$(head -1 "$repo/docs/context/.scope-base" | tr -d '[:space:]')"
  fi
  [ -n "$pin" ] || pin="origin/master"

  git -C "$repo" rev-parse --verify --quiet "$pin^{commit}" >/dev/null \
    || die "Scope-Base '$pin' ist im Repository nicht aufloesbar. Kein Fallback auf HEAD."
  ref="$(git -C "$repo" merge-base HEAD "$pin")" \
    || die "merge-base HEAD..'$pin' nicht bestimmbar. Kein Fallback auf HEAD."
  printf '%s\n' "$ref"
}

guard_repo() {
  local repo="$1" marker feat base_sha surface rc

  [ -x "$SCOPE_CHECK" ] || die "plumbline-scope-check nicht ausfuehrbar unter $SCOPE_CHECK"
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || die "kein Git-Repository: $repo"

  marker="$repo/docs/context/.active-feature"
  # Abwesender Marker = kein Feature aktiv = No-op. Das ist die EINZIGE Ausnahme.
  [ -f "$marker" ] || { echo "PRIL scope guard: kein armiertes Feature, no-op."; return 0; }

  feat="$(head -1 "$marker" | tr -d '[:space:]')"
  [ -n "$feat" ] \
    || die "Feature-Marker vorhanden, aber leer. Enforcement laesst sich nicht durch Leeren abschalten - Marker entfernen oder Slug eintragen."
  case "$feat" in
    *[!a-zA-Z0-9._-]* | .* ) die "Feature-Marker enthaelt einen unplausiblen Slug: '$feat'" ;;
  esac
  [ -f "$repo/docs/canvas/$feat.canvas.md" ] \
    || die "kein Canvas fuer armiertes Feature '$feat' - Scope nicht bestimmbar."

  # `die` in einer Kommandosubstitution beendet nur deren Subshell - der Aufrufer liefe
  # sonst mit leerer Base weiter und waere fail-OPEN. Der Rueckgabewert wird deshalb
  # ausdruecklich geprueft. (Vom Self-Test gefunden, 30.07.2026.)
  if ! base_sha="$(resolve_base_sha "$repo")" || [ -z "$base_sha" ]; then
    return 4
  fi
  surface="$(mktemp)"; trap 'rm -f "$surface"' RETURN
  collect_surface "$repo" "$base_sha" "$surface"

  echo "PRIL scope guard: feature=$feat base=${base_sha:0:12} files=$(wc -l < "$surface" | tr -d ' ')"
  set +e
  "$SCOPE_CHECK" --repo "$repo" --feature "$feat" --changed-files "$surface"
  rc=$?
  set -e
  return "$rc"
}

# -------------------------------------------------------------- self-test ----
# Permanente Gegenmutation statt einmaliger Handprobe: baut ein synthetisches
# Repository in einem Temp-Verzeichnis (nie das echte), dessen Default-Branch
# `master` heisst - genau die Konstellation, in der der geteilte Hook fail-open
# laeuft. Die vierte Probe ist der eigentliche Nachweis.
self_test() {
  local tmp pass=0 fail=0
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN

  git -C "$tmp" init -q -b master
  git -C "$tmp" config user.email scope-guard@test.invalid
  git -C "$tmp" config user.name "Scope Guard Selftest"
  mkdir -p "$tmp/docs/canvas" "$tmp/docs/context" "$tmp/src" "$tmp/evil"
  cat > "$tmp/docs/canvas/demo.canvas.md" <<'CANVAS'
# Demo Canvas

## Allowed change scope

- src/**
- docs/canvas/**
- docs/context/**
CANVAS
  printf 'demo\n' > "$tmp/docs/context/.active-feature"
  git -C "$tmp" add -A
  git -C "$tmp" commit -q -m baseline
  # Base auf den Baseline-Commit pinnen. Der Pin-Commit selbst faellt unter
  # docs/context/** und ist damit im erlaubten Scope - er darf die Probe nicht faerben.
  local base; base="$(git -C "$tmp" rev-parse HEAD)"
  printf '%s\n' "$base" > "$tmp/docs/context/.scope-base"
  git -C "$tmp" add -A && git -C "$tmp" commit -q -m pin

  check() { # name expected_rc
    local name="$1" want="$2" got
    set +e; ( guard_repo "$tmp" ) >/dev/null 2>&1; got=$?; set -e
    if [ "$got" = "$want" ]; then
      echo "  PASS  $name (exit $got)"; pass=$((pass + 1))
    else
      echo "  FAIL  $name (exit $got, erwartet $want)"; fail=$((fail + 1))
    fi
  }

  echo "Self-Test (synthetisches Repo, Default-Branch master):"
  check "sauberer Baum ist gruen" 0

  printf 'ok\n' > "$tmp/src/allowed.ts"
  check "erlaubter Pfad, untracked -> gruen" 0
  git -C "$tmp" add -A && git -C "$tmp" commit -q -m "allowed committed"
  check "erlaubter Pfad, committed -> gruen" 0

  printf 'bad\n' > "$tmp/evil/out-of-scope.ts"
  check "unerlaubter Pfad, untracked -> BLOCK" 3
  git -C "$tmp" add -A
  check "unerlaubter Pfad, staged -> BLOCK" 3
  git -C "$tmp" commit -q -m "out of scope committed"
  check "unerlaubter Pfad, COMMITTED -> BLOCK (Kompensation des main-Fallbacks)" 3

  # Bewusst `reset --hard` statt `git rm`: ein GELOESCHTER Out-of-Scope-Pfad bleibt in
  # `diff base...HEAD` sichtbar und muss weiter blockieren. Nur das vollstaendige
  # Zuruecknehmen des Commits stellt Gruen her - genau das wird hier geprueft.
  git -C "$tmp" reset --hard -q HEAD~1
  check "nach Zuruecknehmen des Commits wieder gruen" 0

  rm -f "$tmp/docs/context/.scope-base"
  printf 'refs/heads/does-not-exist\n' > "$tmp/docs/context/.scope-base"
  check "unaufloesbare Base -> BLOCK statt Fallback auf HEAD" 4

  printf '%s\n' "$base" > "$tmp/docs/context/.scope-base"
  printf '   \n' > "$tmp/docs/context/.active-feature"
  check "leerer Marker -> BLOCK (nicht still abschaltbar)" 4

  rm -f "$tmp/docs/context/.active-feature"
  check "abwesender Marker -> No-op" 0

  echo "Self-Test: $pass bestanden, $fail fehlgeschlagen"
  [ "$fail" = "0" ]
}

case "${1:-}" in
  --self-test) self_test ;;
  "")          guard_repo "$(git rev-parse --show-toplevel)" ;;
  *)           echo "usage: $0 [--self-test]" >&2; exit 64 ;;
esac
