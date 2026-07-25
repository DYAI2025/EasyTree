#!/usr/bin/env bash
# EYT-67 — Branch Protection als Code.
#
# Legt das Repository-Ruleset fuer den Default-Branch an oder aktualisiert es
# idempotent. Muss lokal mit einem GitHub-Account ausgefuehrt werden, der
# Admin-Rechte auf dem Repository besitzt (Cloud-Sandboxen haben diese nicht).
#
#   gh auth login                       # einmalig
#   ./scripts/setup-branch-protection.sh
#   ./scripts/verify-branch-protection.sh
#
# Umgebungsvariablen:
#   REPO               Standard: DYAI2025/EasyTree
#   RULESET_NAME       Standard: "EasyTree master protection (EYT-67)"
#   STRICT_UP_TO_DATE  true|false, Standard true ("Branch muss aktuell sein")
#   DRY_RUN            true -> nur Payload ausgeben, nichts schreiben
#
# Kompatibel mit bash 3.2 (macOS-Systembash): keine Assoziativ-Arrays,
# kein mapfile, keine Expansion leerer Arrays unter "set -u".
set -Eeuo pipefail

REPO="${REPO:-DYAI2025/EasyTree}"
RULESET_NAME="${RULESET_NAME:-EasyTree master protection (EYT-67)}"
STRICT_UP_TO_DATE="${STRICT_UP_TO_DATE:-true}"
DRY_RUN="${DRY_RUN:-false}"
WORKFLOW_FILE="${WORKFLOW_FILE:-.github/workflows/ci.yml}"

# Kanonische Pflichtchecks. Die Namen entsprechen den Job-IDs in ci.yml,
# weil dort kein job-level "name:" gesetzt ist. Aenderungen an ci.yml ohne
# Aenderung dieser Liste werden unten als Drift erkannt und brechen ab.
REQUIRED_CHECKS="format
lint
typecheck
unit-tests
build-web
web-smoke
build-api
secret-scan
db-gates"

die() {
  printf 'FEHLER: %s\n' "$1" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) ist nicht installiert."
command -v jq >/dev/null 2>&1 || die "jq ist nicht installiert."
gh auth status >/dev/null 2>&1 || die "gh ist nicht angemeldet. Zuerst 'gh auth login' ausfuehren."

repo_json="$(gh api "repos/${REPO}")" || die "Repository ${REPO} nicht lesbar."
is_admin="$(printf '%s' "$repo_json" | jq -r '.permissions.admin // false')"
default_branch="$(printf '%s' "$repo_json" | jq -r '.default_branch')"
visibility="$(printf '%s' "$repo_json" | jq -r '.visibility')"
canonical="$(printf '%s' "$repo_json" | jq -r '.full_name')"

[ "$is_admin" = "true" ] ||
  die "Der angemeldete Account hat keine Admin-Rechte auf ${REPO}. Ruleset-Schreibzugriff erfordert den Scope Administration:write."

# GitHub leitet frühere Repository-Namen weiter. Ab hier wird ausschliesslich der
# kanonische Name verwendet, damit das Ruleset nicht gegen einen Alias läuft.
if [ "$canonical" != "$REPO" ]; then
  printf 'Hinweis: %s ist ein Alias; kanonisch ist %s.\n' "$REPO" "$canonical"
  REPO="$canonical"
fi

printf 'Repository:      %s (%s)\n' "$REPO" "$visibility"
printf 'Default-Branch:  %s\n' "$default_branch"

# --- Drift-Pruefung: ci.yml-Jobs vs. Pflichtcheck-Liste --------------------
# BEIDE Richtungen, fail-closed:
#  - Job in ci.yml, aber nicht in REQUIRED_CHECKS => neuer Job waere stillschweigend
#    optional (der Fall, fuer den diese Pruefung urspruenglich gebaut wurde).
#  - Eintrag in REQUIRED_CHECKS, aber nicht in ci.yml => GitHub wartet dauerhaft auf
#    einen Kontext, den kein Workflow erzeugen kann; JEDER kuenftige PR wird damit
#    permanent unmergebar. Der gefaehrlichere der beiden Faelle.
# Eine fehlende Workflow-Datei ist ebenfalls ein Abbruch: ohne sie ist die
# Pflichtcheck-Liste unbelegbar, und ein Blind-Write koennte genau die obige
# Dauerblockade erzeugen.
[ -f "$WORKFLOW_FILE" ] ||
  die "Workflow-Datei ${WORKFLOW_FILE} nicht gefunden. Ohne sie ist die Pflichtcheck-Liste nicht pruefbar; Abbruch statt Blind-Konfiguration."

workflow_jobs="$(
  awk '
      /^jobs:[[:space:]]*$/ { in_jobs = 1; next }
      in_jobs && /^[^[:space:]]/ { in_jobs = 0 }
      in_jobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
        line = $0
        gsub(/[[:space:]]/, "", line)
        sub(/:$/, "", line)
        print line
      }
    ' "$WORKFLOW_FILE"
)"

[ -n "$workflow_jobs" ] ||
  die "In ${WORKFLOW_FILE} wurde kein einziger Job erkannt. Parser oder Datei pruefen; Abbruch statt Blind-Konfiguration."

# Richtung 1: ci.yml -> REQUIRED_CHECKS
not_required=""
while IFS= read -r job; do
  [ -n "$job" ] || continue
  if ! printf '%s\n' "$REQUIRED_CHECKS" | grep -qx -- "$job"; then
    not_required="${not_required}${job} "
  fi
done <<EOF
$workflow_jobs
EOF

# Richtung 2: REQUIRED_CHECKS -> ci.yml
not_in_workflow=""
while IFS= read -r want; do
  [ -n "$want" ] || continue
  if ! printf '%s\n' "$workflow_jobs" | grep -qx -- "$want"; then
    not_in_workflow="${not_in_workflow}${want} "
  fi
done <<EOF
$REQUIRED_CHECKS
EOF

if [ -n "$not_required" ]; then
  die "Drift erkannt: ${WORKFLOW_FILE} enthaelt Jobs, die nicht als Pflichtcheck gefuehrt sind: ${not_required}- REQUIRED_CHECKS in diesem Skript ergaenzen."
fi
if [ -n "$not_in_workflow" ]; then
  die "Drift erkannt: REQUIRED_CHECKS fuehrt Checks, die ${WORKFLOW_FILE} nicht erzeugt: ${not_in_workflow}- GitHub wuerde dauerhaft darauf warten und jeden PR blockieren. Liste oder Workflow korrigieren."
fi

printf 'Drift-Pruefung:  OK, beide Richtungen (%s CI-Jobs, %s Pflichtchecks)\n' \
  "$(printf '%s\n' "$workflow_jobs" | grep -c . || true)" \
  "$(printf '%s\n' "$REQUIRED_CHECKS" | grep -c . || true)"

# --- Payload ---------------------------------------------------------------
checks_json="$(printf '%s\n' "$REQUIRED_CHECKS" | grep . | jq -R '{context: .}' | jq -s '.')"

payload="$(
  jq -n \
    --arg name "$RULESET_NAME" \
    --argjson checks "$checks_json" \
    --argjson strict "$STRICT_UP_TO_DATE" \
    '{
      name: $name,
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: []
        }
      },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: true,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: true
          }
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: $strict,
            do_not_enforce_on_create: false,
            required_status_checks: $checks
          }
        }
      ]
    }'
)"

if [ "$DRY_RUN" = "true" ]; then
  printf '\n--- DRY_RUN: Payload ---\n%s\n' "$payload"
  exit 0
fi

# --- Anlegen oder aktualisieren -------------------------------------------
# Fail-closed: nur eine NACHWEISLICH erfolgreiche Abfrage ohne Treffer darf in den
# Create-Pfad fuehren. Ein transienter API-/Rate-Limit-/Rechte-Fehler wuerde sonst
# als "kein Ruleset vorhanden" gelesen und ein zweites aktives Ruleset anlegen —
# die Idempotenz waere gebrochen, und ein zurueckbleibendes Duplikat wuerde nach
# spaeteren Updates weiter veraltete Checks verlangen.
if ! rulesets_json="$(gh api "repos/${REPO}/rulesets")"; then
  die "Ruleset-Liste von ${REPO} nicht lesbar. Abbruch statt Blind-POST — ein zweites Ruleset waere sonst die Folge."
fi

existing_id="$(
  printf '%s' "$rulesets_json" |
    jq -r --arg n "$RULESET_NAME" 'map(select(.name == $n)) | .[0].id // empty'
)"

if [ -n "$existing_id" ]; then
  printf '\nBestehendes Ruleset %s wird aktualisiert ...\n' "$existing_id"
  printf '%s' "$payload" |
    gh api --method PUT "repos/${REPO}/rulesets/${existing_id}" --input - >/dev/null
  ruleset_id="$existing_id"
else
  printf '\nNeues Ruleset wird angelegt ...\n'
  ruleset_id="$(
    printf '%s' "$payload" |
      gh api --method POST "repos/${REPO}/rulesets" --input - |
      jq -r '.id'
  )"
fi

printf 'Ruleset aktiv: id=%s name=%s\n' "$ruleset_id" "$RULESET_NAME"
printf '\nNaechster Schritt: ./scripts/verify-branch-protection.sh\n'
printf 'Rollback:          gh api --method DELETE repos/%s/rulesets/%s\n' "$REPO" "$ruleset_id"
