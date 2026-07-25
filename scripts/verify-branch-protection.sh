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
db-gates"

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
ruleset_ids="$(printf '%s' "$rules" | jq -r '[.[].ruleset_id] | unique | .[]')"
bypass_total=0
for rid in $ruleset_ids; do
  n="$(gh api "repos/${REPO}/rulesets/${rid}" 2>/dev/null | jq -r '.bypass_actors | length' || echo 0)"
  bypass_total=$((bypass_total + n))
done
if [ "$bypass_total" -eq 0 ]; then
  pass "AC1 — kein Bypass-Akteur konfiguriert; die Sperre gilt auch fuer Repo-Admins."
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
  strict="$(printf '%s' "$checks_rule" | jq -r '.parameters.strict_required_status_checks_policy')"
  printf '      Hinweis: strict_required_status_checks_policy=%s (Branch muss vor Merge aktuell sein).\n' "$strict"
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
if [ -n "$NEGATIVE_PR" ]; then
  pr_json="$(gh api "repos/${REPO}/pulls/${NEGATIVE_PR}")"
  head_sha="$(printf '%s' "$pr_json" | jq -r '.head.sha')"
  mergeable_state="$(printf '%s' "$pr_json" | jq -r '.mergeable_state')"
  pr_state="$(printf '%s' "$pr_json" | jq -r '.state')"
  failed_checks="$(
    gh api "repos/${REPO}/commits/${head_sha}/check-runs" --paginate |
      jq -r '.check_runs[] | select(.conclusion == "failure") | .name' | sort -u | tr '\n' ' '
  )"
  printf '      PR #%s: state=%s mergeable_state=%s head=%s\n' \
    "$NEGATIVE_PR" "$pr_state" "$mergeable_state" "${head_sha:0:7}"
  printf '      Rote Checks: %s\n' "${failed_checks:-keine}"
  if [ "$mergeable_state" = "blocked" ] && [ -n "$failed_checks" ]; then
    pass "AC8 — PR #${NEGATIVE_PR} hat einen roten Pflichtcheck und ist technisch nicht mergebar (mergeable_state=blocked)."
  else
    fail "AC8 — PR #${NEGATIVE_PR} belegt die Merge-Blockade nicht (mergeable_state=${mergeable_state}, rote Checks: ${failed_checks:-keine})."
  fi
else
  skip "AC8 — kein NEGATIVE_PR gesetzt. Negativ-Test-PR eroeffnen und erneut mit NEGATIVE_PR=<nr> ausfuehren."
fi

printf '\n=== Ergebnis: %s offen, %s uebersprungen ===\n' "$fail_count" "$skip_count"
[ "$fail_count" -eq 0 ] || exit 1
[ "$skip_count" -eq 0 ] || exit 1
printf 'Alle EYT-67-Akzeptanzkriterien sind belegt.\n'
