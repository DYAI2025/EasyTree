#!/usr/bin/env bash
# EasyTree — projektlokaler Riegel fuer zwei nicht verhandelbare Regeln aus CLAUDE.md.
#
# REGEL A  supabase/migrations/ ist append-only. Eine bereits nach origin/master
#          gemergte Migration wird weder editiert noch geloescht — nur Fix-forward
#          mit einer neuen Migration.
# REGEL B  packages/contracts/openapi/v1.json ist Buildprodukt und wird nie handeditiert.
#
# Aufruf: als PreToolUse-Hook (Write|Edit und Bash). Das Tool-Input kommt als JSON
# auf stdin. Exit 0 = durchlassen, Exit 2 = blockieren (stderr geht ans Modell).
#
# Kein Netzverkehr. Kein jq, kein python3 — die JSON-Felder werden mit bash-eigener
# ERE-Mustererkennung gelesen (jq liegt hier unter /opt/homebrew/bin und ist im
# Hook-PATH nicht garantiert; /usr/bin/python3 ist auf diesem Rechner ein
# Plugin-Shim). Laeuft unter bash 3.2 (/bin/bash) wie unter bash 5.

set -euo pipefail

MIGRATIONSVERZEICHNIS="supabase/migrations"
VERTRAGSARTEFAKT="packages/contracts/openapi/v1.json"
BASISREF="${EASYTREE_RIEGEL_BASISREF:-refs/remotes/origin/master}"
BASISREF_KURZ="${BASISREF#refs/remotes/}"
FETCH_MAX_ALTER_S="${EASYTREE_RIEGEL_FETCH_MAX_ALTER_S:-86400}"

blockiere() {
  printf '%s\n' "$*" >&2
  exit 2
}

# ---------------------------------------------------------------- stdin lesen
eingabe="$(cat || true)"

muster_werkzeug='"tool_name"[[:space:]]*:[[:space:]]*"([^"]*)"'
muster_pfad='"file_path"[[:space:]]*:[[:space:]]*"(([^"\]|\\.)*)"'
muster_befehl='"command"[[:space:]]*:[[:space:]]*"(([^"\]|\\.)*)"'

werkzeug=""
if [[ $eingabe =~ $muster_werkzeug ]]; then werkzeug="${BASH_REMATCH[1]}"; fi

entschluesseln() {
  # minimale JSON-Entschaerfung fuer Dateipfade
  local s="$1"
  s="${s//\\\//\/}"
  s="${s//\\\"/\"}"
  s="${s//\\\\/\\}"
  printf '%s' "$s"
}

projektwurzel() {
  local start="${CLAUDE_PROJECT_DIR:-$PWD}"
  git -C "$start" rev-parse --show-toplevel 2>/dev/null || true
}

# Ist <relativer Pfad> in der Basisref vorhanden? 0 = ja, 1 = nein.
liegt_in_basisref() {
  local wurzel="$1" rel="$2"
  git -C "$wurzel" cat-file -e "$BASISREF:$rel" 2>/dev/null
}

# Fail-closed-Pruefung: Basisref vorhanden und nicht offensichtlich veraltet?
# Gibt eine leere Zeichenkette zurueck, wenn alles in Ordnung ist, sonst den Grund.
basisref_unbrauchbar() {
  local wurzel="$1" gemeinsam alter jetzt fetchkopf
  if ! git -C "$wurzel" rev-parse --verify --quiet "$BASISREF" >/dev/null 2>&1; then
    printf '%s' "die Basisref ${BASISREF_KURZ} existiert lokal nicht"
    return 0
  fi
  gemeinsam="$(git -C "$wurzel" rev-parse --git-common-dir 2>/dev/null || true)"
  case "$gemeinsam" in
    "") printf '%s' "das Git-Verzeichnis ist nicht lesbar"; return 0 ;;
    /*) ;;
    *) gemeinsam="$wurzel/$gemeinsam" ;;
  esac
  fetchkopf="$gemeinsam/FETCH_HEAD"
  if [[ ! -f $fetchkopf ]]; then
    printf '%s' "es gibt kein FETCH_HEAD — in diesem Klon wurde nie gefetcht"
    return 0
  fi
  jetzt="$(date +%s)"
  alter="$(stat -f %m "$fetchkopf" 2>/dev/null || stat -c %Y "$fetchkopf" 2>/dev/null || echo 0)"
  if [[ $alter -le 0 ]] || [[ $((jetzt - alter)) -gt $FETCH_MAX_ALTER_S ]]; then
    printf '%s' "der letzte fetch liegt mehr als ${FETCH_MAX_ALTER_S}s zurueck"
    return 0
  fi
  printf '%s' ""
}

meldung_regel_a_gemergt() {
  local rel="$1" wurzel="$2" commit
  commit="$(git -C "$wurzel" log -1 --format=%h "$BASISREF" -- "$rel" 2>/dev/null || true)"
  cat >&2 <<MELDUNG
BLOCKIERT — REGEL A (append-only Migrationen, CLAUDE.md "Non-negotiable rules").

  Datei:  $rel
  Grund:  Diese Migration liegt bereits auf ${BASISREF_KURZ}${commit:+ (zuletzt dort in $commit)}.
          Gemergte Migrationen sind append-only. Wird eine bereits ausgefuehrte
          Migration nachtraeglich veraendert, weichen die Datenbanken, die sie
          schon angewendet haben, dauerhaft vom Repository ab — lokal, in
          db-gates und in der Produktion je verschieden.

  Stattdessen — Fix-forward mit einer NEUEN Migration:
    1) pnpm exec supabase migration new <slug>
    2) die erzeugte Datei nach dem Schema <timestamp>_NNNN_<slug>.sql umbenennen
       und die NNNN-Folge fortsetzen (naechste freie Nummer siehe
       ls -1 supabase/migrations/)
    3) die Korrektur dort als zusaetzliche Anweisung schreiben
    4) zweimal pnpm exec supabase db reset, danach pnpm exec supabase test db

  Diese Regel wird nicht umgangen. Gibt es einen begruendeten Ausnahmefall,
  ist das eine Entscheidung des Menschen — frag nach, statt sie zu suchen.
MELDUNG
  exit 2
}

# ---------------------------------------------------------------- Notausgang
if [[ ${EASYTREE_RIEGEL_AUS:-0} == "1" ]]; then
  exit 0
fi

# ================================================================ Arm 1: Bash
if [[ $werkzeug == "Bash" ]]; then
  befehl=""
  if [[ $eingabe =~ $muster_befehl ]]; then befehl="$(entschluesseln "${BASH_REMATCH[1]}")"; fi
  [[ -n $befehl ]] || exit 0
  # nur destruktive Verben interessieren; alles andere darf durch
  # Nur wirklich schreibende Verben interessieren. Ein blankes ">" irgendwo im
  # Befehl reicht NICHT: "cat supabase/migrations/0002.sql > /tmp/kopie.sql" liest
  # nur und wurde von der frueheren Fassung faelschlich geblockt. Gezaehlt wird
  # deshalb ausschliesslich eine Umleitung IN einen geschuetzten Pfad.
  schreibend=0
  case "$befehl" in
    *rm\ *|*"git rm"*|*mv\ *|*truncate*|*"sed -i"*|*tee\ *) schreibend=1 ;;
  esac
  muster_umleitung=">>?[[:space:]]*['\"]?[^[:space:]]*($MIGRATIONSVERZEICHNIS|$VERTRAGSARTEFAKT)"
  if [[ $befehl =~ $muster_umleitung ]]; then schreibend=1; fi
  [[ $schreibend == 1 ]] || exit 0
  [[ $befehl == *"$MIGRATIONSVERZEICHNIS"* || $befehl == *"$VERTRAGSARTEFAKT"* ]] || exit 0
  wurzel="$(projektwurzel)"
  [[ -n $wurzel ]] || blockiere "BLOCKIERT — kein Git-Kontext, der Riegel kann 'gemergt' nicht entscheiden (fail-closed). Aus dem Repository heraus aufrufen."
  if [[ $befehl == *"$VERTRAGSARTEFAKT"* ]]; then
    blockiere "BLOCKIERT — REGEL B: $VERTRAGSARTEFAKT ist Buildprodukt. Nicht loeschen/ueberschreiben, sondern mit 'pnpm --filter @easytree/contracts run openapi:write' neu erzeugen."
  fi
  # Verzeichnis als Ganzes getroffen -> immer blocken
  if [[ $befehl == *"$MIGRATIONSVERZEICHNIS"[[:space:]]* || $befehl == *"$MIGRATIONSVERZEICHNIS" ]]; then
    blockiere "BLOCKIERT — REGEL A: ein Befehl greift das ganze Verzeichnis $MIGRATIONSVERZEICHNIS an. Migrationen sind append-only; einzelne Fix-forward-Migration anlegen statt loeschen."
  fi
  grund="$(basisref_unbrauchbar "$wurzel")"
  [[ -z $grund ]] || blockiere "BLOCKIERT — REGEL A (fail-closed): $grund, deshalb ist nicht entscheidbar, ob eine der genannten Migrationen bereits gemergt ist. Erst 'git fetch origin master' ausfuehren, dann erneut versuchen."
  treffer="$(printf '%s' "$befehl" | grep -oE "${MIGRATIONSVERZEICHNIS}/[A-Za-z0-9_.-]+" || true)"
  [[ -n $treffer ]] || exit 0
  while IFS= read -r kandidat; do
    [[ -n $kandidat ]] || continue
    if liegt_in_basisref "$wurzel" "$kandidat"; then
      meldung_regel_a_gemergt "$kandidat" "$wurzel"
    fi
  done <<< "$treffer"
  exit 0
fi

# =========================================================== Arm 2: Write/Edit
pfad=""
if [[ $eingabe =~ $muster_pfad ]]; then pfad="$(entschluesseln "${BASH_REMATCH[1]}")"; fi

if [[ -z $pfad ]]; then
  case "$werkzeug" in
    Write|Edit|MultiEdit)
      blockiere "BLOCKIERT (fail-closed) — der Riegel schutz-anhaengeregel.sh konnte im Tool-Input kein .tool_input.file_path lesen und kann deshalb nicht entscheiden, ob eine gemergte Migration oder das generierte openapi/v1.json getroffen wird. Bitte den Riegel pruefen (scripts/claude/schutz-anhaengeregel.sh)." ;;
    *) exit 0 ;;
  esac
fi

# --- schneller Ausstieg, BEVOR irgendein git-Aufruf passiert
case "$pfad" in
  *"$MIGRATIONSVERZEICHNIS"/*|*"$VERTRAGSARTEFAKT") ;;
  *) exit 0 ;;
esac

wurzel="$(projektwurzel)"
if [[ -n $wurzel ]]; then
  case "$pfad" in
    /*) abs="$pfad" ;;
    *) abs="${CLAUDE_PROJECT_DIR:-$PWD}/$pfad" ;;
  esac
  if [[ $abs == "$wurzel"/* ]]; then rel="${abs#"$wurzel"/}"; else rel=""; fi
else
  rel=""
fi

# --- REGEL B: gilt immer, ohne Git, ohne Ausnahme
if [[ $pfad == *"$VERTRAGSARTEFAKT" ]]; then
  cat >&2 <<'MELDUNG'
BLOCKIERT — REGEL B (generiertes Artefakt, CLAUDE.md "The contract is generated from Zod").

  Datei:  packages/contracts/openapi/v1.json
  Grund:  Diese Datei ist Buildprodukt, keine Quelle. Sie wird nur deshalb
          eingecheckt, damit der Diff lesbar ist. test/openapi-drift.test.ts
          vergleicht das serialisierte Dokument BYTE FUER BYTE mit dieser Datei —
          eine Handaenderung faellt entweder sofort rot aus oder, schlimmer,
          verdeckt eine echte Schemaabweichung.

  Stattdessen:
    1) das Zod-Schema unter packages/contracts/src/**/schemas.ts aendern
    2) pnpm --filter @easytree/contracts run openapi:write
    3) die neu erzeugte v1.json mit committen

  Diese Regel wird nicht umgangen. Gibt es einen begruendeten Ausnahmefall,
  ist das eine Entscheidung des Menschen — frag nach, statt sie zu suchen.
MELDUNG
  exit 2
fi

# --- REGEL A
if [[ -z $wurzel ]]; then
  blockiere "BLOCKIERT — REGEL A (fail-closed): kein Git-Kontext auffindbar, 'bereits gemergt' ist nicht entscheidbar. Aus dem Repository heraus arbeiten."
fi
if [[ -z $rel ]]; then
  blockiere "BLOCKIERT — REGEL A (fail-closed): '$pfad' sieht nach einer Migration aus, liegt aber nicht unterhalb von $wurzel. Der Riegel kann nicht entscheiden, ob sie gemergt ist."
fi

grund="$(basisref_unbrauchbar "$wurzel")"
if [[ -n $grund ]]; then
  blockiere "BLOCKIERT — REGEL A (fail-closed): $grund. Solange das gilt, kann der Riegel nicht ausschliessen, dass '$rel' inzwischen gemergt wurde; er laesst dann nichts durch. Bitte 'git fetch origin master' ausfuehren und erneut versuchen."
fi

if liegt_in_basisref "$wurzel" "$rel"; then
  meldung_regel_a_gemergt "$rel" "$wurzel"
fi

exit 0
