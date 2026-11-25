# Sprint-5-Durchstich abschließen — Implementierungsplan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eine berechtigte Person sieht tägliche Plan-Personalkosten aus einer unveränderlichen veröffentlichten Planversion und exportiert exakt denselben Snapshot als Excel.

**Architecture:** Fünf gestaffelte Slices auf dem bestehenden Split-Monolithen (ADR-001). Jeder Slice schließt genau einen offenen Nutzerpfad und endet an einem Freigabe-Gate. Die Kostenkette bleibt: Browser → Same-Origin-Rewrite → NestJS → `CostAccessPolicy` → `TenantQueryRunner` → RLS → PostgreSQL. Neue Fachlogik entsteht ausschließlich im Modul `costs`; geteilt wird nur über benannte Modulgrenzen.

**Tech Stack:** TypeScript, pnpm 10.28 + Turborepo, NestJS 11, Next 16 / React 19, PostgreSQL 17 via Supabase, Zod-generierter OpenAPI-Vertrag, Vitest, Playwright, pgTAP.

---

## Geltungsbereich und bewusste Auslassung

Dieser Plan ist **nicht überall gleich tief**, und das ist eine Entscheidung, keine Lücke.

**Vollständig ausgearbeitet** sind Phase 1 (Review, sofort ausführbar) und Phase 3 (EYT-108 Option A+, der nächste fachliche Slice). Dort stehen exakte Dateien, Code und Kommandos.

**Nur als Gate mit Akzeptanzkriterien und Messauftrag** stehen Phase 2, 4, 5 und 6. Grund: Phase 2 hängt an einer Freigabe und an GitHub-Adminrechten, die niemand hier hat. Phase 4 bis 6 hängen an Schemata, die es noch nicht gibt — die Snapshot-Tabelle aus EYT-109 bestimmt, wie der Publish-Command aus EYT-107 seine Planversions-Id ausgibt, und der XLSX-Adapter aus EYT-110 liest genau diese Snapshot-Zeilen. Jetzt Testcode dafür zu schreiben hieße, Schnittstellen zu erfinden, die die Messung danach widerlegt. Das wäre genau die "Abstraktion auf Vorrat", die der Auftrag verbietet.

Jede dieser Phasen beginnt deshalb mit einem **Messauftrag**: was zuerst aus dem Repository gelesen werden muss, bevor der Detailplan geschrieben wird.

**WIP-Grenze:** höchstens ein Slice gleichzeitig. Reihenfolge fest: EYT-106 Release → EYT-108 snapshot-ready → EYT-107 Publish → EYT-109 Snapshot/UI → EYT-110 Excel.

---

## Phase 1 — PR #42 Release Review

**Ziel:** Unabhängiges Review. Ergebnis `PASS_FOR_MERGE` oder `BLOCKED_REVIEW`. **Kein Merge.**

**Kein zusätzlicher `playwright --list`-Schritt in `web-smoke`** — ausdrücklich abgelehnt. Kein CI-Zyklus zur Optimierung der Fehlergeschwindigkeit.

Alle Kommandos im Worktree:
`/private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/d573da1f-df4b-49b5-aea7-2939929592b2/scratchpad/eyt106-wt`

### Task 1.1: Formalen PR-Zustand messen

**Files:** keine (read-only)

**Step 1: Zustand, Base, Head und Commit-Anzahl lesen**

```bash
gh pr view 42 --json state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefOid \
  --jq '"state=\(.state) draft=\(.isDraft) mergeable=\(.mergeable) mergeState=\(.mergeStateStatus) base=\(.baseRefName) head=\(.headRefOid)"'
```

Erwartet: `state=OPEN draft=false mergeable=MERGEABLE mergeState=CLEAN base=master head=dc8e0a35dc2908b511383ac28e5567f8fb2d79fd`

**Step 2: Keine neuen Commits nach `dc8e0a3`**

```bash
git fetch origin
git rev-list --count dc8e0a3..origin/feat/eyt-106-acceptance-closure
```

Erwartet: `0`. Jede andere Zahl ist ein Befund — die Review-Evidenz gilt dann nicht mehr.

**Step 3: Diff auf exakt 20 Dateien prüfen**

```bash
git diff --name-only origin/master...dc8e0a3 | sort | tee /tmp/pr42-dateien.txt | wc -l
```

Erwartet: `20`. Liste gegen die PR-Beschreibung lesen — nicht nur die Zahl.

**Step 4: Offene Review-Threads**

```bash
gh api graphql -f query='
{ repository(owner:"DYAI2025", name:"EasyTree") { pullRequest(number:42) {
    reviewThreads(first:50) { nodes { isResolved isOutdated comments(first:1){nodes{path body}} } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | .comments.nodes[0].path'
```

Erwartet: keine Ausgabe.

**Step 5: Alle elf Jobs gehören zu `dc8e0a3`**

```bash
gh api repos/DYAI2025/EasyTree/commits/dc8e0a3/check-runs \
  --jq '.check_runs[] | "\(.name)\t\(.conclusion)"' | sort
```

Erwartet: elf Zeilen, jede `success`. Ein Job, der zu einem älteren SHA gehört, ist ein Befund.

### Task 1.2: Secret-Wächter auf False Negatives prüfen

**Files:**

- Read: `apps/api/test/architecture/secret-surface-rules.ts`
- Read: `apps/api/test/secret-surface.test.ts`

**Step 1: Prüfpunkt 1 — sind die Ausnahmen zu breit?**

Lies `PRIVILEGIERTE_ORTE` und `ERLAUBTE_UMGEBUNGSLESER`. Für jeden Eintrag beantworten: _Kann diese Datei zur Laufzeit einer HTTP-Anfrage ausgeführt werden?_ Ein `Ja` ist ein Befund.

Erwartet: sechs privilegierte Orte (2 × `supabase/`, `scripts/read-through-harness.sh`, `.github/workflows/ci.yml`, 2 × Testdatei) und zwei Umgebungsleser (`config.module.ts`, `next.config.ts`).

**Step 2: Prüfpunkt 2 — indirekter Zugriff über importierte Helfer**

Das ist der wichtigste Punkt und der wahrscheinlichste echte Befund. `runtime-reads-no-environment` prüft **je Datei**. Ein Helfer außerhalb des Laufzeitpfads, der `process.env` liest und aus dem Laufzeitpfad importiert wird, umginge die Regel.

```bash
# Jede Datei, die process.env liest, mit ihrer Lage im Laufzeitpfad
grep -rln "process\.env" apps/api/src apps/web packages/*/src 2>/dev/null | sort
```

Für jeden Treffer, der **nicht** in den zwei benannten Ausnahmen liegt: prüfen, ob er aus `apps/api/src/**` oder `apps/web/**` (ohne test/e2e) importiert wird.

```bash
# Beispiel je Kandidat:
grep -rn "from \".*<dateiname ohne endung>\"" apps/api/src apps/web
```

Erwartet: `packages/config/src/**` liest `process.env` **nicht** — `loadConfig(env)` bekommt die Umgebung hereingereicht. Ist das nicht so, ist es ein Befund: dann existiert ein importierbarer Umweg.

**Step 3: Prüfpunkt 9 — echte API, nicht der Harness**

```bash
grep -n "dist/main.js\|dist-harness" .github/workflows/ci.yml apps/web/e2e/auth-journey/config.ts
```

Erwartet: `config.ts` startet `node dist/main.js`; `dist-harness` erscheint nur im `read-through`-Kontext.

**Step 4: Prüfpunkt 10 — Änderung auf EYT-106 begrenzt**

```bash
git diff --name-only origin/master...dc8e0a3 | grep -vE '^(apps/api/(src/modules/costs|src/app.module.ts|test)|apps/web/e2e/auth-journey|\.github/workflows/ci\.yml|\.gitleaksignore|scripts/(setup|verify)-branch-protection\.sh)'
```

Erwartet: keine Ausgabe.

### Task 1.3: Auditereignis auf Nutzdaten prüfen

**Files:**

- Read: `apps/api/src/modules/costs/application/cost-access-audit.port.ts`
- Read: `apps/api/src/modules/costs/interface/http/costs.controller.ts`

**Step 1: Prüfpunkt 3 — Feldliste**

`COST_ACCESS_EVENT_FIELDS` lesen. Erwartet genau: `event`, `correlationId`, `decision`, `permission`, `organisationId`, `subject`, `reason`, `at`, `route`. Kein Feld darf einen Namen, Betrag oder Bezeichner einer natürlichen Person tragen.

`serialisiereZugriffsereignis` muss aus dieser Liste bauen, **nicht** aus dem Objekt. Alles andere ist ein Befund.

**Step 2: Prüfpunkt 4 — Pseudonym ist keine Autorisierungsfunktion**

```bash
grep -rn "pseudonymSubjekt" apps/api/src
```

Erwartet: Treffer ausschließlich in `cost-access-audit.port.ts` (Definition) und `costs.controller.ts` in `protokolliere(...)`. Erscheint das Pseudonym in `zugang()` **vor** der Entscheidung, in einem Vergleich oder in einer Bedingung, ist das ein Befund.

**Step 3: Prüfpunkt 5 — Loggerfehler ändern keine Entscheidung**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-access-audit.http.test.ts -t "werfender Logger"
```

Erwartet: 2 passed. Zusätzlich im Controller lesen, dass `this.audit.record(...)` im `try`/`catch` steht und der `catch` nichts wirft.

### Task 1.4: Testdatengrenze der Auth-Reise prüfen

**Files:**

- Read: `apps/web/e2e/auth-journey/fixtures.sql`, `teardown.sql`, `global-setup.ts`, `global-teardown.ts`

**Step 1: Prüfpunkt 6 — Idempotenz**

`fixtures.sql`: jede `insert` muss `on conflict` tragen. `teardown.sql`: muss nach festen IDs und der Reisenden-Adresse löschen und mit `restzeilen=0` enden.

Erwartet: Der zweite Lauf des Teardowns findet nichts und meldet trotzdem `restzeilen=0`.

**Step 2: Prüfpunkt 7 — nichts bleibt nach dem CI-Lauf**

```bash
gh api repos/DYAI2025/EasyTree/actions/jobs/$(gh api repos/DYAI2025/EasyTree/actions/runs/30719819939/jobs --jq '.jobs[]|select(.name=="auth-journey")|.id')/logs \
  | grep -E "auth-journey-teardown|auth-journey-fixture"
```

Erwartet: `[auth-journey-fixture] projektion=1 membership=1 mitarbeiter=1 satz=1` **und** `[auth-journey-teardown] restzeilen=0`.

**Step 3: Prüfpunkt 8 — keine Tokens in Artefakten**

Artefakt herunterladen und **lesen**, nicht nur auflisten:

```bash
gh run download 30719819939 -n auth-journey-nachweise -D /tmp/pr42-art
grep -c "eyJ" /tmp/pr42-art/zusammenfassung.json /tmp/pr42-art/ergebnis.json
```

Erwartet: `0` in beiden. Beide Screenshots öffnen und ansehen: kein Passwortfeld mit sichtbarem Wert, kein Token im Bild.

Zusätzlich prüfen, dass das Passwort **nicht** als Prozessargument übergeben wird:

```bash
grep -n "passwort" apps/web/e2e/auth-journey/global-setup.ts
```

Erwartet: nur über `process.env` weitergereicht, nie als `execFileSync`-Argument — ein Passwort in `argv` stünde in der Prozessliste.

### Task 1.5: Urteil abgeben

**Step 1: Befunde zusammenstellen**

Für jeden der elf Prüfpunkte: `OK` oder Befund mit Datei, Zeile und Auswirkung. Ein Befund ist nur dann einer, wenn ein konkreter Fehlerfall benennbar ist — kein Stilbefund.

**Step 2: Urteil melden**

`PASS_FOR_MERGE` oder `BLOCKED_REVIEW`. **Nicht mergen.** Auf ausdrückliche Freigabe warten.

---

## Phase 2 — Merge und Produktionsabnahme (GATE)

**Beginnt ausschließlich nach ausdrücklicher Merge-Freigabe.**

### Gate-Bedingungen

1. Merge SHA-gebunden: `gh pr merge 42 --merge --match-head-commit dc8e0a35dc2908b511383ac28e5567f8fb2d79fd`
2. Post-Merge-CI auf `master` vollständig abwarten, alle elf Jobs.
3. Railway: prüfen, **ob** der Merge-SHA automatisch deployt wird. Kein redundantes Deployment auslösen.
4. `/health` und `/ready` mehrfach über mehrere Minuten prüfen; `database: true` erwarten.
5. Reale HTTPS-Anmeldung über die Preview. `Set-Cookie` messen: `HttpOnly=true`, **`Secure=true`** (das ist der Nachweis, den die HTTP-Reise nicht führen kann), `SameSite=Strict`.
6. Login, Session, Kosten-Navigation, Satzhistorie, Logout.
7. Produktionsdatenbestand vorher und nachher read-only vergleichen. **Keine neuen Fachdatensätze.**

Referenzstand vor dem Merge (01.08.2026): `orgs=1 mitarbeiter=1 memberships=1 auth_users=1 saetze=1 betrag=3850`. Nachher identisch erwartet.

### Ruleset-Nachweis — eigener Blocker

Repository-Dateien sind **kein** Nachweis. Gemessen wird die effektive Regel:

```bash
bash scripts/verify-branch-protection.sh
```

Erwartet für ein echtes Gate: `enforcement=active`, `strict_required_status_checks_policy=true` und `auth-journey` unter den Pflichtchecks.

Fehlen die Adminrechte, ist der Blocker exakt zu melden:

- **Checkname:** `auth-journey`
- **Ruleset:** `19718704`, Ziel `~DEFAULT_BRANCH`
- **Schritte:** Repository → Settings → Rules → Rulesets → `19718704` → _Require status checks to pass_ → `auth-journey` ergänzen → Save. Danach `bash scripts/verify-branch-protection.sh` zur Gegenprüfung.

**EYT-106 nicht auf Fertig setzen, solange das tatsächliche Gate nicht nachgewiesen ist.**

### Jira nach erfolgreicher Abnahme

EYT-133, EYT-134, EYT-135, EYT-106 → Fertig. Jede Transition read-after-write prüfen (`getJiraIssue` nach `transitionJiraIssue`, Status lesen).

---

## Phase 3 — EYT-108 snapshot-ready (Option A+)

**Beginnt erst nach abgeschlossenem EYT-106.**

Neuer Branch von aktuellem `origin/master`: `feat/eyt-108-option-a-plus`.

### Fachliche Invariante

Betrag, Währung, Organisation, Mitarbeiter, `valid_from`, Grund, Ersteller, Erstellungszeitpunkt und Korrelations-Id einer Satzversion sind unveränderlich. Nur `valid_to` einer aktuell offenen Version darf **genau einmal** von NULL auf `valid_from` des direkten Nachfolgers gesetzt werden — ausschließlich innerhalb desselben autorisierten, auditierten, idempotenten Commands, der den Nachfolger anlegt.

### Architekturentscheidung: Security-Definer-Funktion, kein UPDATE-Recht

Der Auftrag verlangt eine Abwägung. Ergebnis:

**Gewählt:** eine eng geschnittene `security definer`-Funktion. `authenticated` bekommt **kein** `UPDATE` auf `public.employee_rate_versions`.

**Verworfen:** Spalten-Grant `grant update (valid_to)` plus RLS-UPDATE-Policy. Eine Row-Policy kann `valid_to = <valid_from des Nachfolgers>` nicht ausdrücken — sie kennt den Nachfolger nicht, der im selben Statement erst entsteht. Die Policy könnte also nur "irgendein Datum" erlauben, und die eigentliche Invariante bliebe in der Anwendung. Das ist genau die pauschale Regel, die der Auftrag ausschließt.

**Gefahr der gewählten Lösung, benannt:** `security definer` umgeht RLS. Die Funktion muss Mitgliedschaft und Recht deshalb **selbst** prüfen. Das steht unten explizit im Code und bekommt eigene Negativtests.

**Zusätzlich, unabhängig davon:** ein `before update`-Trigger auf der Tabelle. Er trägt heute nichts bei, weil niemand `UPDATE` darf — er ist die Versicherung gegen eine künftige Migration, die das Recht doch erteilt.

### Messauftrag vor dem ersten Commit

Lies und notiere, bevor Code entsteht:

```bash
sed -n '100,175p' supabase/migrations/20260729010000_0012_idempotency_records.sql   # app.lock_employee_planning
sed -n '1,100p'  supabase/migrations/20260801060000_0013_cost_permissions_and_rates.sql
sed -n '1,140p'  apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts
ls supabase/migrations | tail -3        # naechste NNNN-Nummer
```

`app.lock_employee_planning(uuid)` existiert bereits (EYT-92) und serialisiert Prüfen-und-Einfügen je Organisation und Person. **Wiederverwenden, nicht nachbauen** — aber prüfen, ob der Name noch trägt oder ob eine Umbenennung fällig ist; sie sperrt künftig auch Sätze.

### Task 3.1: Migration — Trigger und Command-Funktion

**Files:**

- Create: `supabase/migrations/<timestamp>_0014_rate_version_succession.sql`
- Create: `supabase/tests/0014_rate_version_succession.sql`

**Step 1: Migration anlegen und umbenennen**

```bash
pnpm exec supabase migration new rate_version_succession
# Die erzeugte Datei auf <timestamp>_0014_rate_version_succession.sql umbenennen —
# `migration new` vergibt nur den Zeitstempel, die NNNN-Folge ist Handarbeit.
```

**Step 2: Unveränderlichkeitstrigger schreiben**

```sql
-- Verteidigung in der Tiefe: heute darf `authenticated` gar nicht UPDATEn.
-- Dieser Trigger sorgt dafuer, dass eine kuenftige Migration, die das Recht
-- doch erteilt, die Invariante nicht mitnimmt.
create or replace function app.enforce_rate_version_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.employee_id is distinct from old.employee_id
     or new.amount_minor_units is distinct from old.amount_minor_units
     or new.currency is distinct from old.currency
     or new.valid_from is distinct from old.valid_from
     or new.predecessor_id is distinct from old.predecessor_id
     or new.reason is distinct from old.reason
     or new.created_by is distinct from old.created_by
     or new.correlation_id is distinct from old.correlation_id
     or new.created_at is distinct from old.created_at then
    raise exception
      'EYT-108: nur valid_to darf geaendert werden (Version %).', old.id
      using errcode = 'restrict_violation';
  end if;

  if old.valid_to is not null then
    raise exception
      'EYT-108: valid_to ist bereits gesetzt und wird nicht erneut geaendert (Version %).', old.id
      using errcode = 'restrict_violation';
  end if;

  if new.valid_to is null then
    raise exception 'EYT-108: valid_to darf nicht auf NULL zurueckgesetzt werden.'
      using errcode = 'restrict_violation';
  end if;

  if new.valid_to <= old.valid_from then
    raise exception
      'EYT-108: valid_to (%) muss nach valid_from (%) liegen.', new.valid_to, old.valid_from
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger employee_rate_versions_immutable
  before update on public.employee_rate_versions
  for each row execute function app.enforce_rate_version_immutability();
```

**Step 3: Command-Funktion schreiben**

```sql
-- EIN Command: Vorgaenger schliessen UND Nachfolger anlegen, atomar.
--
-- `security definer`, weil die Funktion UPDATE braucht und `authenticated`
-- das Recht bewusst NICHT hat. Damit umgeht sie RLS — Mitgliedschaft und
-- Recht werden deshalb hier ausdruecklich geprueft. Wer diese Funktion
-- aendert, aendert eine Sicherheitsgrenze.
create or replace function app.append_rate_version(
  p_employee_id uuid,
  p_amount_minor_units bigint,
  p_valid_from date,
  p_reason text,
  p_correlation_id text,
  p_expected_active_version_id uuid
)
returns public.employee_rate_versions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_subject uuid := auth.uid();
  v_offen public.employee_rate_versions;
  v_neu public.employee_rate_versions;
begin
  if v_subject is null then
    raise exception 'EYT-108: kein Subjekt im Sitzungskontext.' using errcode = 'insufficient_privilege';
  end if;

  -- Organisation aus der Person ABLEITEN, nie vom Aufrufer nehmen.
  select org_id into v_org from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'EYT-108: unbekannte Person.' using errcode = 'no_data_found';
  end if;

  -- RLS ist hier ausgeschaltet: Mitgliedschaft und Recht selbst pruefen.
  if not exists (select 1 from public.memberships
                 where org_id = v_org and user_id = v_subject and active) then
    raise exception 'EYT-108: kein Mitglied dieser Organisation.' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_cost_permission(v_org, 'costs.manage_rates') then
    raise exception 'EYT-108: Recht costs.manage_rates fehlt.' using errcode = 'insufficient_privilege';
  end if;

  perform app.lock_rate_succession(v_org, p_employee_id);

  select * into v_offen from public.employee_rate_versions
    where org_id = v_org and employee_id = p_employee_id and valid_to is null
    for update;

  if p_expected_active_version_id is not null
     and (v_offen.id is null or v_offen.id <> p_expected_active_version_id) then
    raise exception 'EYT-108: erwartete aktive Version stimmt nicht.' using errcode = 'serialization_failure';
  end if;
  if p_expected_active_version_id is null and v_offen.id is not null then
    raise exception 'EYT-108: es existiert eine offene Version, die nicht benannt wurde.'
      using errcode = 'serialization_failure';
  end if;

  if v_offen.id is not null then
    if p_valid_from <= v_offen.valid_from then
      raise exception 'EYT-108: Nachfolger muss nach dem Vorgaenger beginnen.'
        using errcode = 'check_violation';
    end if;
    update public.employee_rate_versions
       set valid_to = p_valid_from
     where id = v_offen.id and valid_to is null;
  end if;

  insert into public.employee_rate_versions
    (org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
     predecessor_id, reason, created_by, correlation_id)
  values (v_org, p_employee_id, p_amount_minor_units, 'EUR', p_valid_from, null,
          v_offen.id, p_reason, v_subject, p_correlation_id)
  returning * into v_neu;

  return v_neu;
end;
$$;

revoke all on function app.append_rate_version(uuid, bigint, date, text, text, uuid) from public;
grant execute on function app.append_rate_version(uuid, bigint, date, text, text, uuid) to authenticated;
```

Dazu `app.lock_rate_succession(uuid, uuid)` analog zu `app.lock_employee_planning`, aber mit eigenem Hash-Präfix (`'rate:'`), damit Planung und Satzablösung einander nicht sperren.

**Step 4: Zweimal zurücksetzen und pgTAP fahren**

```bash
pnpm exec supabase db reset && pnpm exec supabase test db
pnpm exec supabase db reset && pnpm exec supabase test db
```

Erwartet: beide Läufe grün und identisch. **Definition of Done der Migration.**

**Step 5: Commit**

```bash
git add supabase/migrations/<datei>.sql supabase/tests/0014_rate_version_succession.sql
git commit -m "feat(db): EYT-108 kontrollierte Satzablösung als Command-Funktion"
```

### Task 3.2: pgTAP — die Datenbank erzwingt es allein

**Files:** Create: `supabase/tests/0014_rate_version_succession.sql`

Jede Zusicherung ohne Anwendungsschicht, als `authenticated` mit gesetztem JWT-Claim:

1. Owner legt ersten Satz an → `valid_to is null`, `predecessor_id is null`.
2. Owner legt Nachfolger an → Vorgänger `valid_to = valid_from` des Nachfolgers, Nachfolger `predecessor_id` = Vorgänger.
3. Zweiter Aufruf mit demselben `expected` → `serialization_failure`.
4. Nachfolger mit `valid_from <= ` Vorgänger → `check_violation`.
5. `member` ruft die Funktion → `insufficient_privilege`.
6. `manager` ruft die Funktion → `insufficient_privilege` (manager hat kein `costs.manage_rates`).
7. Fremder Mandant → `insufficient_privilege` oder `no_data_found`, nie Erfolg.
8. Direktes `update ... set amount_minor_units = ...` als `authenticated` → scheitert **schon am fehlenden Recht**.
9. Direktes `update` als Tabelleneigentümer mit geändertem Betrag → Trigger wirft `restrict_violation`.
10. Zweites Setzen von `valid_to` → `restrict_violation`.
11. Keine Lücke: `valid_to` des Vorgängers = `valid_from` des Nachfolgers, exakt.

**Gegenmutation (auszuführen, nicht nur zu benennen):** Im Trigger die Zeile `if old.valid_to is not null then raise` entfernen → Probe 10 muss rot werden. Danach zurücknehmen.

### Task 3.3: Nebenläufigkeit mit zwei echten Verbindungen

**Files:** Create: `apps/api/test/costs/rate-succession.integration.test.ts`

Ein Test kann mit einer Verbindung zeigen, dass ein Constraint **ablehnt**, aber nicht, dass er **serialisiert** (vgl. EYT-49). Deshalb zwei `Client`.

**Step 1: Failing test**

```ts
dbIt("zwei gleichzeitige Nachfolger — genau einer gewinnt", async () => {
  const a = await neueVerbindung();
  const b = await neueVerbindung();
  await a.query("begin"); await b.query("begin");
  await setzeSubjekt(a, OWNER); await setzeSubjekt(b, OWNER);

  const ersterLauf = a.query(`select app.append_rate_version($1,$2,$3,$4,$5,$6)`, [...]);
  const zweiterLauf = b.query(`select app.append_rate_version($1,$2,$3,$4,$5,$6)`, [...]);

  const ergebnisse = await Promise.allSettled([ersterLauf, zweiterLauf]);
  await a.query("commit").catch(() => a.query("rollback"));
  await b.query("commit").catch(() => b.query("rollback"));

  const erfolgreich = ergebnisse.filter((e) => e.status === "fulfilled").length;
  expect(erfolgreich).toBe(1);   // nicht 0, nicht 2
});
```

Anschließend aus einer dritten Verbindung lesen: **genau zwei** Zeilen, keine Lücke, keine Überlappung.

**Step 2 bis 5:** rot laufen lassen, implementieren, grün, committen — wie in Task 3.1.

Der Test gehört als eigener Schritt in `db-gates`, gepaart mit `bash scripts/assert-tenant-report.sh rate-succession /tmp/rate-succession.log`. Ohne diese Paarung beweist der Schritt nichts.

### Task 3.4: Repository und Command auf die Funktion umstellen

**Files:**

- Modify: `apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts`
- Modify: `apps/api/src/modules/costs/application/rate-repository.port.ts` (neues Problem `PREDECESSOR_CLOSED`)

`append()` ruft künftig `select * from app.append_rate_version($1,…)` statt eines eigenen `insert`. Die Fehlercodes der Funktion werden auf `RateWriteProblem` abgebildet:

| PostgreSQL-Code                  | `RateWriteProblem`                                                       |
| -------------------------------- | ------------------------------------------------------------------------ |
| `serialization_failure` (40001)  | `STALE_ACTIVE_VERSION`                                                   |
| `insufficient_privilege` (42501) | _nicht_ abbilden — als Fehler durchreichen, der Controller antwortet 403 |
| `no_data_found` (02000)          | `EMPLOYEE_UNKNOWN`                                                       |
| `check_violation` (23514)        | neu: `RATE_PREDECESSOR_ORDER`                                            |
| `exclusion_violation` (23P01)    | `RATE_INTERVAL_OVERLAP`                                                  |

Der Vertrag in `packages/contracts/src/costs/schemas.ts` bekommt den neuen Fehlertyp; danach **zwingend**:

```bash
pnpm --filter @easytree/contracts run openapi:write
```

Sonst geht `test/openapi-drift.test.ts` byteweise rot.

### Task 3.5: UI — die Vorgängerkette sichtbar machen

**Files:** Modify: `apps/web/components/rate-management.tsx`

Die Tabelle hat heute sechs Spalten: `Status`, `Betrag`, `Gültig ab`, `Gültig bis`, `Grund`, `Angelegt`. `predecessorId` steht bereits im DTO, wird aber nicht gerendert — genau die Lücke.

Ergänzen: eine Spalte `Ersetzt`, die bei gesetztem `predecessorId` „ersetzt Version vom &lt;valid_from des Vorgängers&gt;" zeigt und sonst „—". Der Vorgänger ist in derselben `versions`-Liste enthalten; **nicht** nachladen.

Barrierefreiheit: die neue Spalte braucht `<th scope="col">`, und der Verweis darf nicht nur über Farbe oder Position funktionieren. `apps/web/test/a11y.test.tsx` und `apps/web/e2e/shell-smoke.spec.ts` müssen grün bleiben.

### Task 3.6: Browserreise erweitern

**Files:** Modify: `apps/web/e2e/auth-journey/journey.pwtest.ts` **oder** neue Reise `succession.pwtest.ts` im selben Ordner

Positive Reise: erster offener Satz → neue Version ab späterem Datum → Vorgänger geschlossen → Nachfolger aktiv oder kommend → Reload zeigt beide → genau eine Version je Testdatum wirksam.

Artefakte: Screenshot **vor** der Nachfolgeversion, Screenshot **danach** mit zwei Zeilen, maschinenlesbare Zusammenfassung, Datenbanknachweis der `predecessor_id`-Kette.

Negative Reisen: stale predecessor, Retry desselben Idempotenzschlüssels, zwei parallele Nachfolger, gleiches `valid_from`, Nachfolger vor `valid_from`, fehlendes `manage_rates`, fremder Mandant, direkter UPDATE-Versuch.

### Task 3.7: Abschluss EYT-108

EYT-108 als **`SNAPSHOT_READY`** dokumentieren, **nicht** auf Fertig setzen.

Das Kriterium _„Spätere Satzänderungen verändern bereits erzeugte Kosten-Snapshots nicht"_ bleibt `BLOCKED_BY_EYT-109` — es lässt sich ohne Snapshot nicht prüfen.

---

## Phase 4 — EYT-107 Publish-Core (GATE)

**Beginnt nach dem snapshot-ready-Gate von EYT-108.**

**Messauftrag zuerst:** `supabase/migrations/20260727020300_0007_planning.sql` (Planversionen, `published_at`), `20260727020400_0008_audit_outbox.sql` (Outbox), `20260729010000_0012_idempotency_records.sql` (Idempotenz), `apps/api/src/modules/planning/application/planning-commands.port.ts`. Erst danach Detailplan.

**Akzeptanz:** autorisierter, idempotenter Publish-Command; UI-Aktion; unveränderliche veröffentlichte Planversions-Id; Reload und zweiter Browserkontext zeigen denselben Zustand; Audit, Outbox und Idempotenz **atomar** in einer Transaktion; ein Entwurf ist niemals Kostenquelle.

**Sichtbar:** eindeutiger Status `Veröffentlicht`, die Planversions-Id, Konflikt- und Stale-Zustand, kein optimistischer Scheinerfolg.

---

## Phase 5 — EYT-109 Snapshot und Kostenansicht (GATE)

**Messauftrag zuerst:** `packages/domain/src/**` (Money-, Rundungs- und Effective-Date-Kern aus EYT-95), `apps/api/src/modules/costs/application/plan-cost-facts.port.ts`, `domain/planned-work-fact.ts`, `apps/web/app/kosten/page.tsx` (heute ehrlicher Leerzustand `kosten-leer`).

**Akzeptanz:** veröffentlichte Planversion wählen; Snapshot **atomar** erzeugen; tägliche Personalkosten anzeigen; fehlende Sätze **blockierend** anzeigen statt mit 0,00 € zu raten; Snapshot-Id, Planversion, Regelversion und Erstellungszeit sichtbar; Reload und zweiter Browser zeigen denselben Snapshot; eine spätere Satzänderung verändert den bestehenden Snapshot **nicht**.

Mit dem letzten Nachweis wird das offene Kriterium aus EYT-108 geschlossen und EYT-108 auf Fertig gesetzt.

---

## Phase 6 — EYT-110 XLSX aus demselben Snapshot (GATE)

**Messauftrag zuerst:** `apps/api/src/modules/costs/application/cost-export.port.ts` (Port existiert bereits), und: es gibt **keine** XLSX-Bibliothek im Repository. Eine neue Laufzeitabhängigkeit verlangt eine Supply-Chain-Prüfung durch `security-reviewer`, bevor sie in `package.json` landet.

**Akzeptanz:** XLSX **ohne Neuberechnung** direkt aus den Snapshot-Zeilen; Metadatenblatt; Positionsblatt; Formula-Injection-Schutz (führende `=`, `+`, `-`, `@`, Tab und CR neutralisieren); stabiler MIME-Type und Dateiname; Paritätsprüfung UI = API = DB = XLSX.

Der Adapter liegt hinter `CostExportPort`; die XLSX-Bibliothek darf ausschließlich in `infrastructure/` erscheinen (Wächter `costs-xlsx-behind-application-port`).

---

## Abschlussformat je Phase

Jede Phase meldet: Jira-Status vorher/nachher · Branch, Commits, PR · sichtbares Nutzerergebnis · Akzeptanzkriterien mit PASS/FAIL/BLOCKED · technische Tests · Browserartefakte · Produktions- oder Testdatenbestand · stärkstes Restrisiko · Rollback · klare Freigabeentscheidung.

**Stopp an jedem Merge- und Deployment-Gate bis zur ausdrücklichen Freigabe.**

## Stehende Regeln für jeden Slice

- Rot vor Grün. Jede Eigenschaft braucht eine **ausgeführte** Gegenmutation, nicht nur eine benannte.
- Migrationen sind append-only. Zwei aufeinanderfolgende `db reset` plus grünes `supabase test db` sind die Definition of Done.
- Nach jeder skriptgesteuerten Ersetzung das **Ergebnis** greppen, nie dem Exit-Code glauben.
- Nur benannte Dateien stagen, danach `git diff --cached --name-only` lesen.
- Ein neuer CI-Job zwingt zur Änderung **beider** Pflichtcheck-Listen.
- Vertragsänderung → `openapi:write`, sonst geht `openapi-drift` byteweise rot.
- Der Scope-Guard läuft vor jedem Commit: `bash scripts/plumbline-scope-guard.sh`.
