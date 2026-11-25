#!/usr/bin/env bash
# EYT-OPS — Sitzungszustand als generiertes Uebergabeartefakt.
#
# Druckt den GEMESSENEN Zustand des Arbeitsbaums als Markdown-Block, den man
# unveraendert in eine neue Session einfuegen kann. Ersetzt den handgetippten
# Zustandsblock (Branch, Head-SHA, PR, CI-Run), der bei jedem /clear neu
# abgeschrieben wurde und dabei veraltete.
#
#   bash scripts/ops/sitzungszustand.sh
#   bash scripts/ops/sitzungszustand.sh --notiz "Revision 6 bleibt massgeblich"
#   SITZUNGSZUSTAND_OFFLINE=1 bash scripts/ops/sitzungszustand.sh
#
# Grundregeln, bewusst und nicht verhandelbar:
#   1. Nur lesen. Kein `git fetch`, kein Schreiben in .git, keine Datei im Repo.
#      Die Frische von origin/master wird ueber `git ls-remote` gemessen, das
#      keinen Ref anfasst — ein fetch waere eine Zustandsaenderung mitten in
#      einer Messung.
#   2. Jede Zeile traegt eine gemessene Zahl oder einen gemessenen Bezeichner.
#      Keine Prosa, keine Wertung, kein "sieht gut aus".
#   3. Fail-loud: was nicht messbar ist, bekommt eine Zeile
#      "nicht messbar: <Grund>". Eine fehlende Zeile waere die schlimmste
#      Ausgabe, weil der Leser sie fuer "nichts zu melden" haelt.
#   4. Der Ausgabeblock ist ein Wegwerfartefakt. Er wird NICHT eingecheckt —
#      sonst entstuende genau die datierte Momentaufnahme, die er abloest.
#
# Exit 0 = alles messbar. Exit 1 = mindestens eine Zeile "nicht messbar"
# (der Block wird trotzdem vollstaendig gedruckt).
set -Eeuo pipefail

FRIST_NETZ="${SITZUNGSZUSTAND_FRIST:-25}" # Sekunden je Netzwerkaufruf
NOTIZ="${SITZUNGSZUSTAND_NOTIZ:-}"
OFFLINE="${SITZUNGSZUSTAND_OFFLINE:-0}"
MAX_DATEIEN=40 # so viele uncommittete Pfade werden einzeln aufgelistet

while [ "$#" -gt 0 ]; do
  case "$1" in
    --notiz)
      NOTIZ="${2:-}"
      shift 2
      ;;
    --offline)
      OFFLINE=1
      shift
      ;;
    -h | --hilfe | --help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      printf 'unbekanntes Argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

luecken=0

# --- Werkzeuge --------------------------------------------------------------

# lueckenhaft <text> — druckt eine fail-loud-Zeile und zaehlt sie.
lueckenhaft() {
  printf -- '- %s\n' "$1"
  luecken=$((luecken + 1))
}

AUSGABE=""
RC=0

# mit_frist <sekunden> <befehl...> — fuellt AUSGABE, liefert Exitcode.
# Ein haengender Netzwerkaufruf wird abgeschnitten und als Frist-Ueberschreitung
# gemeldet, statt die Sitzung blockieren zu duerfen.
mit_frist() {
  local frist="$1"
  shift
  local ablage kind wache rc
  ablage="$(mktemp)"
  ("$@" >"$ablage" 2>&1) &
  kind=$!
  (
    sleep "$frist"
    kill -TERM "$kind" 2>/dev/null
  ) &
  wache=$!
  rc=0
  wait "$kind" || rc=$?
  kill -TERM "$wache" 2>/dev/null || true
  wait "$wache" 2>/dev/null || true
  AUSGABE="$(cat "$ablage")"
  rm -f "$ablage"
  RC="$rc"
  return 0
}

# ohne_frist <befehl...> — dasselbe fuer rein lokale Aufrufe.
ohne_frist() {
  RC=0
  AUSGABE="$("$@" 2>&1)" || RC=$?
  return 0
}

# grund_rc <rc> — uebersetzt einen Exitcode in einen ehrlichen Grund.
# 143 ist SIGTERM, also unsere eigene Frist. Wer das als Fachfehler ausgibt
# ("nicht angemeldet"), stellt eine falsche Diagnose statt einer Luecke.
grund_rc() {
  case "$1" in
    143) printf 'Frist von %ss ueberschritten (SIGTERM), Ergebnis UNBEKANNT' "$FRIST_NETZ" ;;
    *) printf 'Exit %s' "$1" ;;
  esac
}

# erste_zeile <text> — erste Ausgabezeile als Anhang, leer bleibt leer.
erste_zeile() {
  if [ -n "$1" ]; then
    printf ': %s' "$(printf '%s' "$1" | sed -n 1p)"
  fi
}

# zeilen <text> — Zeilenzahl, aber 0 fuer den leeren Text.
zeilen() {
  if [ -z "$1" ]; then
    printf '0'
  else
    printf '%s\n' "$1" | wc -l | tr -d ' '
  fi
}

# --- Verortung --------------------------------------------------------------

if ! WURZEL="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  printf 'nicht messbar: kein Git-Repository unter %s\n' "$PWD" >&2
  exit 1
fi
G() { git -C "$WURZEL" "$@"; }

JETZT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '## Sitzungszustand — gemessen %s\n' "$JETZT"
printf '\n'
printf 'Erzeugt von `bash scripts/ops/sitzungszustand.sh` in `%s`. Nicht abschreiben, neu erzeugen.\n' "$WURZEL"
printf '\n'

# --- 1. Arbeitsbaum ---------------------------------------------------------

printf '### 1. Arbeitsbaum\n\n'

ohne_frist git -C "$WURZEL" rev-parse --abbrev-ref HEAD
if [ "$RC" -eq 0 ]; then
  BRANCH="$AUSGABE"
  printf -- '- Branch: `%s` (%s Zeichen)\n' "$BRANCH" "${#BRANCH}"
else
  BRANCH=""
  lueckenhaft "Branch: nicht messbar: git rev-parse --abbrev-ref HEAD → Exit ${RC}"
fi

ohne_frist git -C "$WURZEL" rev-parse HEAD
if [ "$RC" -eq 0 ]; then
  HEAD_SHA="$AUSGABE"
  printf -- '- Head-SHA: `%s` (kurz `%s`)\n' "$HEAD_SHA" "${HEAD_SHA:0:7}"
else
  HEAD_SHA=""
  lueckenhaft "Head-SHA: nicht messbar: git rev-parse HEAD → Exit ${RC}"
fi

ohne_frist git -C "$WURZEL" log -1 --format=%cI%x09%s
if [ "$RC" -eq 0 ]; then
  printf -- '- Head-Commit: %s\n' "$(printf '%s' "$AUSGABE" | tr '\t' ' ')"
else
  lueckenhaft "Head-Commit: nicht messbar: git log -1 → Exit ${RC}"
fi

# Uncommittete Aenderungen: gezaehlt UND aufgelistet. Die Zahl allein liesse
# offen, ob es Quelltext oder nur Notizen sind.
ohne_frist git -C "$WURZEL" status --porcelain -uall
if [ "$RC" -eq 0 ]; then
  ANZ_DIRTY="$(zeilen "$AUSGABE")"
  printf -- '- Uncommittete Aenderungen: %s\n' "$ANZ_DIRTY"
  if [ "$ANZ_DIRTY" -gt 0 ]; then
    printf '%s\n' "$AUSGABE" | sed -n "1,${MAX_DATEIEN}p" | sed 's/^/    - `/; s/$/`/'
    if [ "$ANZ_DIRTY" -gt "$MAX_DATEIEN" ]; then
      printf '    - … %s weitere nicht aufgelistet (Grenze %s)\n' \
        "$((ANZ_DIRTY - MAX_DATEIEN))" "$MAX_DATEIEN"
    fi
  fi
else
  lueckenhaft "Uncommittete Aenderungen: nicht messbar: git status --porcelain -uall → Exit ${RC}"
fi

# Migrationen. nullglob statt `ls *.sql`, weil ein leeres Verzeichnis sonst
# den unexpandierten Glob zaehlen wuerde.
if [ -d "$WURZEL/supabase/migrations" ]; then
  shopt -s nullglob
  MIGRATIONEN=("$WURZEL"/supabase/migrations/*.sql)
  shopt -u nullglob
  printf -- '- Migrationen: %s Dateien unter `supabase/migrations/*.sql`\n' "${#MIGRATIONEN[@]}"
  if [ "${#MIGRATIONEN[@]}" -gt 0 ]; then
    printf -- '- Juengste Migration: `%s`\n' "$(basename "${MIGRATIONEN[${#MIGRATIONEN[@]} - 1]}")"
  fi
else
  lueckenhaft "Migrationen: nicht messbar: Verzeichnis supabase/migrations fehlt"
fi

printf '\n'

# --- 2. Abstand zu master ---------------------------------------------------

printf '### 2. Abstand zu master\n\n'

ohne_frist git -C "$WURZEL" rev-parse --verify --quiet origin/master
if [ "$RC" -eq 0 ] && [ -n "$AUSGABE" ]; then
  LOKAL_OM="$AUSGABE"
  printf -- '- `origin/master` lokal: `%s`\n' "$LOKAL_OM"
else
  LOKAL_OM=""
  lueckenhaft "\`origin/master\` lokal: nicht messbar: Ref existiert nicht (git rev-parse --verify → Exit ${RC})"
fi

if [ -n "$LOKAL_OM" ] && [ -n "$HEAD_SHA" ]; then
  ohne_frist git -C "$WURZEL" rev-list --left-right --count origin/master...HEAD
  if [ "$RC" -eq 0 ]; then
    printf -- '- Abstand gegen den LOKALEN Ref (`git rev-list --left-right --count origin/master...HEAD`): %s (links = origin/master voraus, rechts = HEAD voraus)\n' \
      "$(printf '%s' "$AUSGABE" | tr '\t' '/')"
  else
    lueckenhaft "Abstand gegen den lokalen Ref: nicht messbar: git rev-list → Exit ${RC}"
  fi
else
  lueckenhaft "Abstand gegen den lokalen Ref: nicht messbar: origin/master oder HEAD unbekannt"
fi

# Frische, Teil 1: Alter des letzten fetch. Nur ein Indiz — FETCH_HEAD wird von
# manchen Operationen gar nicht geschrieben.
FETCH_KOPF="$(G rev-parse --git-dir)/FETCH_HEAD"
if [ -f "$FETCH_KOPF" ]; then
  if MTIME="$(stat -f %m "$FETCH_KOPF" 2>/dev/null)" || MTIME="$(stat -c %Y "$FETCH_KOPF" 2>/dev/null)"; then
    ALTER=$(($(date +%s) - MTIME))
    printf -- '- Letzter `git fetch` (mtime von FETCH_HEAD): %s UTC, vor %s Sekunden (%s Stunden)\n' \
      "$(date -u -r "$MTIME" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$MTIME" +%Y-%m-%dT%H:%M:%SZ)" \
      "$ALTER" "$((ALTER / 3600))"
  else
    lueckenhaft "Letzter \`git fetch\`: nicht messbar: stat kennt weder -f %m noch -c %Y"
  fi
else
  lueckenhaft "Letzter \`git fetch\`: nicht messbar: ${FETCH_KOPF} existiert nicht (0 Treffer)"
fi

# Frische, Teil 2: die eigentliche Messung. ls-remote fragt den Server, ohne
# einen lokalen Ref zu bewegen. Weicht der lokale Ref ab, ist JEDE Zahl aus
# Teil 1 gegen einen veralteten Stand gemessen — das muss laut werden.
if [ "$OFFLINE" = "1" ]; then
  lueckenhaft "\`master\` auf dem Server: nicht messbar: SITZUNGSZUSTAND_OFFLINE=1 gesetzt"
  FERN_OM=""
else
  mit_frist "$FRIST_NETZ" git -C "$WURZEL" ls-remote origin refs/heads/master
  if [ "$RC" -eq 0 ] && [ -n "$AUSGABE" ]; then
    FERN_OM="$(printf '%s' "$AUSGABE" | awk 'NR==1{print $1}')"
    printf -- '- `master` auf dem Server (`git ls-remote`, ohne fetch): `%s`\n' "$FERN_OM"
  else
    FERN_OM=""
    lueckenhaft "\`master\` auf dem Server: nicht messbar: git ls-remote → $(grund_rc "$RC")$(erste_zeile "$AUSGABE")"
  fi
fi

if [ -n "$FERN_OM" ] && [ -n "$LOKAL_OM" ]; then
  if [ "$FERN_OM" = "$LOKAL_OM" ]; then
    printf -- '- FRISCHE: aktuell — lokaler Ref und Server stimmen ueberein (0 Zeichen Abweichung).\n'
  else
    printf -- '- **FRISCHE: VERALTET** — lokaler Ref `%s` != Server `%s`. Jede Zahl aus `origin/master...HEAD` oben ist gegen einen veralteten Ref gemessen.\n' \
      "${LOKAL_OM:0:7}" "${FERN_OM:0:7}"
  fi
fi

printf '\n'

# --- 3. Werkzeuglage --------------------------------------------------------
# Wird VOR den gh-Abschnitten gedruckt, damit ein fehlendes gh dort nicht als
# "nichts los" missverstanden wird.

GH_DA=0
GH_GRUND=""
if [ "$OFFLINE" = "1" ]; then
  GH_GRUND="SITZUNGSZUSTAND_OFFLINE=1 gesetzt"
elif ! command -v gh >/dev/null 2>&1; then
  GH_GRUND="gh nicht im PATH (command -v gh → 0 Treffer)"
else
  mit_frist "$FRIST_NETZ" gh auth status
  if [ "$RC" -eq 0 ]; then
    GH_DA=1
  elif [ "$RC" -eq 143 ]; then
    GH_GRUND="gh auth status nach ${FRIST_NETZ}s abgebrochen (SIGTERM) — Anmeldezustand UNBEKANNT, nicht 'abgemeldet'"
  else
    GH_GRUND="gh vorhanden, aber nicht angemeldet (gh auth status → Exit ${RC})"
  fi
fi

# Repo-Kennung aus der Fernadresse ableiten statt hart zu verdrahten.
SLUG=""
ohne_frist git -C "$WURZEL" remote get-url origin
if [ "$RC" -eq 0 ]; then
  SLUG="$(printf '%s' "$AUSGABE" | sed -E 's#^git@[^:]+:##; s#^ssh://git@[^/]+/##; s#^https?://[^/]+/##; s#\.git$##')"
fi

printf '### 3. Pull Request\n\n'

if [ "$GH_DA" -eq 0 ]; then
  lueckenhaft "Offene PRs: nicht messbar: ${GH_GRUND}"
elif [ -z "$SLUG" ] || [ -z "$BRANCH" ]; then
  lueckenhaft "Offene PRs: nicht messbar: Repo-Kennung oder Branch unbekannt (slug='${SLUG}', branch='${BRANCH}')"
else
  printf -- '- Repo-Kennung: `%s`\n' "$SLUG"
  mit_frist "$FRIST_NETZ" gh pr list -R "$SLUG" --head "$BRANCH" --state open \
    --json number,headRefOid,mergeable,mergeStateStatus,isDraft,baseRefName \
    --jq '.[] | "#\(.number) head=\(.headRefOid[0:7]) base=\(.baseRefName) mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus) isDraft=\(.isDraft)"'
  if [ "$RC" -eq 0 ]; then
    ANZ_PR="$(zeilen "$AUSGABE")"
    printf -- '- Offene PRs mit head=`%s`: %s\n' "$BRANCH" "$ANZ_PR"
    if [ "$ANZ_PR" -gt 0 ]; then
      printf '%s\n' "$AUSGABE" | sed 's/^/    - /'
      case "$AUSGABE" in
        *UNKNOWN*)
          printf -- '    - Hinweis: `UNKNOWN` heisst "GitHub hat den Merge-Zustand noch nicht berechnet", nicht "nicht mergebar". Erneut messen.\n'
          ;;
      esac
    else
      # Kein offener PR ist ein Zustand, kein Fehler — aber er braucht Kontext,
      # sonst sucht der Mensch die PR-Nummer, die er zuletzt getippt hat.
      mit_frist "$FRIST_NETZ" gh pr list -R "$SLUG" --head "$BRANCH" --state all --limit 3 \
        --json number,state,headRefOid,baseRefName,mergedAt \
        --jq '.[] | "#\(.number) state=\(.state) head=\(.headRefOid[0:7]) base=\(.baseRefName) mergedAt=\(.mergedAt)"'
      if [ "$RC" -eq 0 ]; then
        printf -- '- Letzte PRs fuer diesen Branch (jeder Zustand): %s\n' "$(zeilen "$AUSGABE")"
        if [ -n "$AUSGABE" ]; then
          printf '%s\n' "$AUSGABE" | sed 's/^/    - /'
        fi
      else
        lueckenhaft "Letzte PRs fuer diesen Branch: nicht messbar: gh pr list --state all → $(grund_rc "$RC")"
      fi
    fi
  else
    lueckenhaft "Offene PRs: nicht messbar: gh pr list → $(grund_rc "$RC")$(erste_zeile "$AUSGABE")"
  fi

  # Fetch-unabhaengiger Abstand: der Server rechnet, der lokale Ref ist egal.
  # Diese Zeile ist die einzige, die auch bei uraltem origin/master stimmt.
  if [ -n "$HEAD_SHA" ]; then
    mit_frist "$FRIST_NETZ" gh api "repos/${SLUG}/compare/master...${HEAD_SHA}" \
      --jq '"status=\(.status) ahead_by=\(.ahead_by) behind_by=\(.behind_by) merge_base=\(.merge_base_commit.sha[0:7])"'
    if [ "$RC" -eq 0 ]; then
      printf -- '- Abstand HEAD zu `master` serverseitig (`gh api compare`, fetch-unabhaengig): %s\n' "$AUSGABE"
    else
      lueckenhaft "Abstand HEAD zu master serverseitig: nicht messbar: gh api compare → $(grund_rc "$RC")$(erste_zeile "$AUSGABE")"
    fi
  fi
fi

printf '\n'

# --- 4. CI fuer den Head-SHA ------------------------------------------------

printf '### 4. CI fuer den Head-SHA\n\n'

if [ "$GH_DA" -eq 0 ]; then
  lueckenhaft "CI-Laeufe: nicht messbar: ${GH_GRUND}"
elif [ -z "$SLUG" ] || [ -z "$HEAD_SHA" ]; then
  lueckenhaft "CI-Laeufe: nicht messbar: Repo-Kennung oder Head-SHA unbekannt"
else
  mit_frist "$FRIST_NETZ" gh run list -R "$SLUG" --commit "$HEAD_SHA" --limit 20 \
    --json databaseId,name,status,conclusion,headSha,createdAt \
    --jq '.[] | "#\(.databaseId) \(.name) status=\(.status) conclusion=\(.conclusion) head=\(.headSha[0:7]) erstellt=\(.createdAt)"'
  if [ "$RC" -eq 0 ]; then
    ANZ_RUNS="$(zeilen "$AUSGABE")"
    printf -- '- Laeufe fuer `%s`: %s\n' "${HEAD_SHA:0:7}" "$ANZ_RUNS"
    if [ "$ANZ_RUNS" -gt 0 ]; then
      printf '%s\n' "$AUSGABE" | sed 's/^/    - /'
    else
      printf -- '    - 0 Laeufe: fuer diesen Head existiert KEINE CI-Evidenz. Ein gruener Lauf eines Vorgaengers deckt ihn nicht.\n'
    fi
  else
    lueckenhaft "CI-Laeufe: nicht messbar: gh run list → $(grund_rc "$RC")$(erste_zeile "$AUSGABE")"
  fi
fi

printf '\n'

# --- 5. Nicht gemessen ------------------------------------------------------
# Der handgetippte Block trug Saetze wie "Revision 6 bleibt massgeblich". Das
# ist eine Setzung, keine Messung. Sie bekommt hier einen Platz MIT Etikett,
# damit sie nicht als gemessen gelesen wird.

printf '### 5. Nicht gemessen (Setzung des Menschen)\n\n'
if [ -n "$NOTIZ" ]; then
  printf -- '- Freitext, %s Zeilen / %s Zeichen, von diesem Skript NICHT geprueft:\n' \
    "$(zeilen "$NOTIZ")" "${#NOTIZ}"
  printf '%s\n' "$NOTIZ" | sed 's/^/    > /'
else
  printf -- '- Freitext: 0 Zeichen (kein `--notiz` uebergeben).\n'
fi
printf -- '- Von diesem Skript grundsaetzlich nicht erhoben: Jira-Status, Sprint-Inhalt, Confluence-Revision, Deploy-Zustand. 0 Zeilen daraus sind unten gedeckt.\n'

printf '\n'
printf -- '---\n'
printf -- '- Nicht messbare Punkte in diesem Block: %s\n' "$luecken"

[ "$luecken" -eq 0 ] || exit 1
