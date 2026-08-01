#!/usr/bin/env bash
# EYT-67 — Verifikation der Branch Protection gegen die Akzeptanzkriterien.
#
# Liest ausschliesslich (keine Schreiboperationen) und prueft die tatsaechlich
# auf dem Default-Branch wirksamen Regeln ueber
#   GET /repos/{owner}/{repo}/rules/branches/{branch}
# Das ist die effektive Sicht von GitHub selbst, nicht die Wunschkonfiguration.
#
#   ./scripts/verify-branch-protection.sh
#   NEGATIVE_PR=7 ./scripts/verify-branch-protection.sh   # inkl. AC-8-Nachweis
#
# Exitcode 0 = alle geprueften Kriterien erfuellt, 1 = mindestens eines offen.
# Die Ausgabe ist so formatiert, dass sie direkt als Jira-Evidenz taugt.
set -Eeuo pipefail

REPO="${REPO:-DYAI2025/EasyTree}"
NEGATIVE_PR="${NEGATIVE_PR:-}"
RUNBOOK="${RUNBOOK:-docs/runbooks/branch-protection.md}"

REQUIRED_CHECKS="format
lint
typecheck
unit-tests
build-web
web-smoke
build-api
secret-scan
db-gates
read-through
auth-journey"

fail_count=0
skip_count=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  fail_count=$((fail_count + 1))
}
skip() {
  printf 'SKIP  %s\n' "$1"
  skip_count=$((skip_count + 1))
}

command -v gh >/dev/null 2>&1 || {
  printf 'FEHLER: gh ist nicht installiert.\n' >&2
  exit 2
}
command -v jq >/dev/null 2>&1 || {
  printf 'FEHLER: jq ist nicht installiert.\n' >&2
  exit 2
}

# --- Drift-Pruefung der EIGENEN Pflichtcheck-Liste (EYT-46) ----------------
# Dieses Skript fuehrt eine zweite Kopie von REQUIRED_CHECKS, unabhaengig von
# scripts/setup-branch-protection.sh. Dort wird die Liste beidseitig gegen
# ci.yml geprueft, hier bislang gar nicht: ein neuer CI-Job, der nur in `setup`
# nachgezogen wird, haette `verify` weiterhin "PASS" ueber eine veraltete Liste
# melden lassen — eine Verifikation, die den Fall bestaetigt, den sie pruefen
# soll. Beide Listen sind damit transitiv an ci.yml gebunden.
workflow_file="${WORKFLOW_FILE:-.github/workflows/ci.yml}"
if [ -f "$workflow_file" ]; then
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
      ' "$workflow_file"
  )"
  drift=""
  while IFS= read -r job; do
    [ -n "$job" ] || continue
    printf '%s\n' "$REQUIRED_CHECKS" | grep -qx -- "$job" || drift="${drift}+${job} "
  done <<EOF
$workflow_jobs
EOF
  while IFS= read -r want; do
    [ -n "$want" ] || continue
    printf '%s\n' "$workflow_jobs" | grep -qx -- "$want" || drift="${drift}-${want} "
  done <<EOF
$REQUIRED_CHECKS
EOF
  if [ -n "$drift" ]; then
    printf 'FEHLER: REQUIRED_CHECKS in diesem Skript weicht von %s ab: %s\n' \
      "$workflow_file" "$drift" >&2
    printf '        (+ = Job ohne Pflichtcheck, - = Pflichtcheck ohne Job)\n' >&2
    exit 2
  fi
else
  printf 'FEHLER: %s nicht gefunden — die Pflichtcheck-Liste ist damit unbelegbar.\n' \
    "$workflow_file" >&2
  exit 2
fi

repo_json="$(gh api "repos/${REPO}")"
default_branch="$(printf '%s' "$repo_json" | jq -r '.default_branch')"
visibility="$(printf '%s' "$repo_json" | jq -r '.visibility')"
owner_type="$(printf '%s' "$repo_json" | jq -r '.owner.type')"
canonical="$(printf '%s' "$repo_json" | jq -r '.full_name')"
if [ "$canonical" != "$REPO" ]; then
  printf 'Hinweis: %s ist ein Alias; kanonisch ist %s.\n' "$REPO" "$canonical"
  REPO="$canonical"
fi

rules="$(gh api "repos/${REPO}/rules/branches/${default_branch}")"
rule_type() { printf '%s' "$rules" | jq -r --arg t "$1" 'map(select(.type == $t)) | .[0] // empty'; }

pr_rule="$(rule_type pull_request)"
checks_rule="$(rule_type required_status_checks)"
deletion_rule="$(rule_type deletion)"
nff_rule="$(rule_type non_fast_forward)"

printf '=== EYT-67 Verifikation ===\n'
printf 'Repository:      %s (%s, Owner-Typ %s)\n' "$REPO" "$visibility" "$owner_type"
printf 'Default-Branch:  %s\n' "$default_branch"
printf 'Wirksame Regeln: %s\n\n' "$(printf '%s' "$rules" | jq -r '[.[].type] | join(", ")')"

# --- AC 1 + AC 2: kein direkter Push, Aenderungen nur ueber Pull Request ----
if [ -n "$pr_rule" ]; then
  pass "AC1/AC2 — pull_request-Regel ist auf ${default_branch} wirksam; direkte Pushes sind serverseitig abgelehnt."
else
  fail "AC1/AC2 — keine pull_request-Regel auf ${default_branch} wirksam."
fi

# Bypass-Akteure entwerten die Sperre und werden daher explizit ausgewiesen.
# FAIL-CLOSED: Ein nicht lesbares Ruleset darf NICHT als "keine Bypass-Akteure"
# gelten. Sonst erzeugt ein Token, das die effective rules lesen kann aber ein
# (womoeglich geerbtes) Ruleset-Detail nicht, ein PASS auf die sicherheits-
# relevanteste Aussage dieses Skripts, ohne sie geprueft zu haben.
ruleset_ids="$(printf '%s' "$rules" | jq -r '[.[].ruleset_id] | unique | .[]')"
bypass_total=0
bypass_unreadable=""
for rid in $ruleset_ids; do
  if ! detail="$(gh api "repos/${REPO}/rulesets/${rid}" 2>/dev/null)"; then
    bypass_unreadable="${bypass_unreadable}${rid} "
    continue
  fi
  n="$(printf '%s' "$detail" | jq -r '.bypass_actors | length' 2>/dev/null || true)"
  case "$n" in
    '' | *[!0-9]*)
      bypass_unreadable="${bypass_unreadable}${rid} "
      continue
      ;;
  esac
  bypass_total=$((bypass_total + n))
done
if [ -n "$bypass_unreadable" ]; then
  fail "AC1 — Ruleset-Detail(s) ${bypass_unreadable}nicht lesbar; bypass_actors sind damit UNBESTAETIGT. Fail-closed statt PASS (Token-Rechte pruefen)."
elif [ "$bypass_total" -eq 0 ]; then
  pass "AC1 — kein Bypass-Akteur in allen $(printf '%s\n' "$ruleset_ids" | grep -c . || true) gelesenen Ruleset(s); die Sperre gilt auch fuer Repo-Admins."
else
  fail "AC1 — ${bypass_total} Bypass-Akteur(e) konfiguriert; die Merge-Sperre ist damit umgehbar."
fi

# --- AC 3: Pflichtchecks aus EYT-56 / EYT-57 / EYT-58 ----------------------
if [ -n "$checks_rule" ]; then
  configured="$(printf '%s' "$checks_rule" | jq -r '.parameters.required_status_checks[].context' | sort)"
  missing=""
  while IFS= read -r want; do
    [ -n "$want" ] || continue
    printf '%s\n' "$configured" | grep -qx -- "$want" || missing="${missing}${want} "
  done <<EOF
$REQUIRED_CHECKS
EOF
  if [ -z "$missing" ]; then
    pass "AC3 — alle $(printf '%s\n' "$REQUIRED_CHECKS" | grep -c .) Pflichtchecks sind als required_status_checks gesetzt."
  else
    fail "AC3 — fehlende Pflichtchecks: ${missing}"
  fi
  # strict ist Teil von AC3 (Runbook Abschnitt 3) und wird deshalb GEPRUEFT, nicht
  # nur ausgegeben. Ohne strict darf ein veralteter Branch mit alten gruenen Checks
  # gemergt werden — die Pflichtchecks gelten dann nicht fuer den Merge-Zustand.
  # Hinweis: setup-branch-protection.sh kennt STRICT_UP_TO_DATE=false; wer das
  # setzt, laesst diese Verifikation bewusst rot werden.
  strict="$(printf '%s' "$checks_rule" | jq -r '.parameters.strict_required_status_checks_policy')"
  if [ "$strict" = "true" ]; then
    pass "AC3 — strict_required_status_checks_policy=true; der Branch muss vor dem Merge aktuell sein."
  else
    fail "AC3 — strict_required_status_checks_policy=${strict}; ein veralteter Branch koennte mit alten gruenen Checks gemergt werden."
  fi
else
  fail "AC3 — keine required_status_checks-Regel wirksam."
fi

# --- AC 4: veraltete Freigaben verwerfen ----------------------------------
if [ -n "$pr_rule" ] && [ "$(printf '%s' "$pr_rule" | jq -r '.parameters.dismiss_stale_reviews_on_push')" = "true" ]; then
  pass "AC4 — dismiss_stale_reviews_on_push=true; Freigaben verfallen bei neuen Commits."
else
  fail "AC4 — dismiss_stale_reviews_on_push ist nicht aktiv."
fi

# --- AC 5: offene Review-Kommentare blockieren ----------------------------
if [ -n "$pr_rule" ] && [ "$(printf '%s' "$pr_rule" | jq -r '.parameters.required_review_thread_resolution')" = "true" ]; then
  pass "AC5 — required_review_thread_resolution=true; ungeloeste Kommentare blockieren den Merge."
else
  fail "AC5 — required_review_thread_resolution ist nicht aktiv."
fi

# --- AC 6: Force Push und Branch-Loeschung ---------------------------------
if [ -n "$nff_rule" ]; then
  pass "AC6 — non_fast_forward-Regel wirksam; Force Push auf ${default_branch} ist gesperrt."
else
  fail "AC6 — non_fast_forward-Regel fehlt; Force Push ist moeglich."
fi
if [ -n "$deletion_rule" ]; then
  pass "AC6 — deletion-Regel wirksam; ${default_branch} kann nicht geloescht werden."
else
  fail "AC6 — deletion-Regel fehlt; der Branch kann geloescht werden."
fi

# --- AC 7: Dokumentation der Plan-/Repo-Grenzen ---------------------------
if [ -f "$RUNBOOK" ]; then
  pass "AC7 — Runbook vorhanden: ${RUNBOOK}"
else
  fail "AC7 — Runbook fehlt: ${RUNBOOK}"
fi

# --- AC 8: negativer Test-Pull-Request ------------------------------------
# Praezision zaehlt hier: `mergeable_state=blocked` ist ein AGGREGAT. Ein PR kann
# auch durch einen noch pendenden Pflichtcheck, einen veralteten Branch oder einen
# ungeloesten Review-Thread blockiert sein. Ein beliebiger roter Check (z. B. ein
# optionaler Doku-Check) wuerde zusammen mit so einem Aggregat sonst als Beweis
# durchgehen. AC 8 verlangt aber: ein roter PFLICHTcheck verhindert den Merge.
# Deshalb wird die Menge der roten Checks gegen REQUIRED_CHECKS geschnitten.
if [ -n "$NEGATIVE_PR" ]; then
  if ! pr_json="$(gh api "repos/${REPO}/pulls/${NEGATIVE_PR}")"; then
    fail "AC8 — PR #${NEGATIVE_PR} nicht lesbar; Nachweis unbestaetigt (fail-closed)."
    pr_json=""
  fi
  if [ -n "$pr_json" ]; then
    head_sha="$(printf '%s' "$pr_json" | jq -r '.head.sha')"
    mergeable_state="$(printf '%s' "$pr_json" | jq -r '.mergeable_state')"
    pr_state="$(printf '%s' "$pr_json" | jq -r '.state')"

    if ! check_runs_json="$(gh api "repos/${REPO}/commits/${head_sha}/check-runs" --paginate)"; then
      fail "AC8 — Check-Runs zu ${head_sha:0:7} nicht lesbar; Nachweis unbestaetigt (fail-closed)."
      check_runs_json=""
    fi

    failed_all=""
    failed_required=""
    if [ -n "$check_runs_json" ]; then
      failed_all="$(
        printf '%s' "$check_runs_json" |
          jq -r '.check_runs[] | select(.conclusion == "failure") | .name' | sort -u | tr '\n' ' '
      )"
      failed_required="$(
        printf '%s' "$check_runs_json" |
          jq -r --arg req "$REQUIRED_CHECKS" '
            ($req | split("\n") | map(select(length > 0))) as $required
            | .check_runs[]
            | select(.conclusion == "failure")
            | .name
            | select(. as $n | $required | index($n))
          ' | sort -u | tr '\n' ' '
      )"
    fi

    printf '      PR #%s: state=%s mergeable_state=%s head=%s\n' \
      "$NEGATIVE_PR" "$pr_state" "$mergeable_state" "${head_sha:0:7}"
    printf '      Rote Checks (alle):        %s\n' "${failed_all:-keine}"
    printf '      Rote PFLICHTchecks:        %s\n' "${failed_required:-keine}"

    # Live- und Historien-Nachweis werden getrennt ausgewiesen: bei einem
    # GESCHLOSSENEN PR ist `mergeable_state` nicht mehr aussagekraeftig (GitHub
    # friert den letzten Wert ein). Das Runbook verlangt, den Negativ-PR nach dem
    # Nachweis zu schliessen — eine spaetere Re-Verifikation darf daraus also kein
    # "ist aktuell nicht mergebar" ableiten, sondern nur "war es nachweislich".
    if [ -z "$failed_required" ]; then
      if [ -n "$check_runs_json" ] && [ -n "$pr_json" ]; then
        fail "AC8 — PR #${NEGATIVE_PR} hat keinen roten PFLICHTcheck (rote Checks insgesamt: ${failed_all:-keine}). Ein roter optionaler Check belegt AC8 nicht."
      fi
    elif [ "$pr_state" = "open" ] && [ "$mergeable_state" = "blocked" ]; then
      pass "AC8 — PR #${NEGATIVE_PR} ist OFFEN, hat den roten PFLICHTcheck ${failed_required}und ist technisch nicht mergebar (mergeable_state=blocked)."
      printf '      Hinweis: mergeable_state ist ein Aggregat (auch pendende Checks, veralteter\n'
      printf '               Branch oder ungeloeste Review-Threads blockieren). Der direkte\n'
      printf '               Gegenbeweis ist `gh pr merge %s --merge` — muss mit "the base\n' "$NEGATIVE_PR"
      printf '               branch policy prohibits the merge" abgelehnt werden.\n'
    elif [ "$pr_state" = "closed" ]; then
      pass "AC8 (historisch) — PR #${NEGATIVE_PR} ist geschlossen; roter PFLICHTcheck ${failed_required}ist belegt, letzter gemeldeter mergeable_state=${mergeable_state}."
      printf '      Hinweis: geschlossener PR — mergeable_state ist eingefroren und belegt KEINE\n'
      printf '               aktuelle Sperre. Fuer einen Live-Nachweis einen neuen Negativ-PR\n'
      printf '               nach Runbook Abschnitt 5 eroeffnen.\n'
    else
      fail "AC8 — PR #${NEGATIVE_PR} belegt die Merge-Blockade nicht (state=${pr_state}, mergeable_state=${mergeable_state}, rote Pflichtchecks: ${failed_required})."
    fi
  fi
else
  skip "AC8 — kein NEGATIVE_PR gesetzt. Negativ-Test-PR eroeffnen und erneut mit NEGATIVE_PR=<nr> ausfuehren."
fi

printf '\n=== Ergebnis: %s offen, %s uebersprungen ===\n' "$fail_count" "$skip_count"
[ "$fail_count" -eq 0 ] || exit 1
[ "$skip_count" -eq 0 ] || exit 1
printf 'Alle EYT-67-Akzeptanzkriterien sind belegt.\n'
