# EYT-120 Inkrement 1 — Einsatz-Datenfundament (Server + Daten) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Einen fachlichen Einsatz persistieren und seine explizit ausgewählten Baustellentage,
deren Erstkonfigurationen und Team-Einplanungen in EINER autorisierten, idempotenten
PostgreSQL-Transaktion anlegen — bis zur Server-/Datengrenze, ohne sichtbare UI.

**Architecture:** Neue Tabelle `public.engagements` (fachlich: Einsatz, UTC-Instants, kein
Zonenfeld) plus `worksite_days.engagement_id` mit zusammengesetztem FK
`(engagement_id, org_id, worksite_id)` als strukturelle Mandanten-/Baustellenkonsistenz.
Ein Command `createEngagement` im bestehenden `PlanningWriteRepository` erwirbt Locks in
fester Reihenfolge (Idempotenz → Wochenentwürfe sortiert → Tagesidentitäten →
Konfigurationen → Personen sortiert → Einplanungen) und verwendet die aus `planWorksiteDay`
extrahierten transaktionsgebundenen Primitive. Lokale Wanduhrzeiten löst
`utcInstantOfLocalWallTime` (Domain) fail-closed auf.

**Tech Stack:** PostgreSQL 17 (Supabase-Migrationen + pgTAP), NestJS + `pg` über
`TenantQueryRunner`, Zod-Contracts (`packages/contracts`, generiertes `openapi/v1.json`),
vitest, `@easytree/domain` Zeitprimitive.

---

## 0. Gemessener Ausgangszustand (06.09.2026, 22:00 Europe/Berlin)

Nicht aus Erinnerung, sondern live gelesen. Wer diesen Plan ausführt, misst die Zeilen
mit `⟲` **erneut**, bevor er sie zitiert.

### 0.1 Start state

| Größe                      | Wert                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Repository                 | `/Users/benjaminpoersch/EasyTree`, `origin = https://github.com/DYAI2025/EasyTree.git` |
| Hauptcheckout              | Branch `feat/eyt-126-container-staging`, HEAD `3b4bbdb`, **35** dirty Einträge — nicht anfassen |
| `origin/master` ⟲          | `f8e96e4ceb4f00ae5f5ac777c6eb47aa8f766d6f` (lokale Ref = GitHub-`master`, ohne `fetch --prune`) |
| PR #101 ⟲                  | OPEN, base `master`, head `191b605d3841aba3a47dad41a14a30c7fbb3cdcb`, Branch `feat/eyt-147-dispositionswerkbank-slice-1`, 11 Commits vor master, `DO_NOT_MERGE` |
| PR #102                    | OPEN, `chore/claude-md-refresh-2026-09-05` @ `331c734` — nur CLAUDE.md, unbeteiligt      |
| PR-#101-Head lokal         | vorhanden (`git cat-file -t 191b605… = commit`), kein Fetch nötig                       |
| EYT-120-Worktree           | **angelegt in dieser Session**: `/Users/benjaminpoersch/EasyTree-worktrees/eyt-120-engagement-range-create`, Branch `feat/eyt-120-engagement-range-create`, HEAD = `191b605`, sauber |
| Implementierungsbasis      | PR-#101-Head `191b605` (master hat weder 0019 noch `worksite_days`)                     |

### 0.2 DRIFT GATE — Ergebnis

Gelesen: Confluence `7766017` (PRD v2.0, FR-004/FR-005), `46727169` (Glossar),
`9306113` (Mehrtages-Baseline), `49119274` (Anti-Drift-Vertrag,
`RECONCILED_2026_09_06_2107`, D-001…D-009, T-001…T-005), `31948801`
(Delivery-Reconciliation `EYT_120_ACTIVE / BUILD_AUTHORIZED_SUBJECT_TO_MIGRATION_STATE_GATE`),
Jira EYT-120 (`In Arbeit`, Sprint 579 „EYT Sprint 7", Human-PO-Entscheidungen 06.09.2026),
GitHub `master` + PR #101.

Punkte 1–15 der Pflichtprüfung: **bestätigt** (D-002 Eintages-Einsatz, D-003 lokale
Grenzen/`endAt` offen, D-004 atomar, D-005 Horizont, D-006 Erweiterung, D-008
`MAX_ONE_ENGAGEMENT_PER_WORKSITE_LOCAL_DATE`, D-009 `WORKING_TIME_WITHIN_ENGAGEMENT_BOUNDS`
ohne stilles Clipping, Invariante 12 `Assignment = Einplanung`, Invariante 14 Historie).
Punkt 16 ist gemessen (0.3). Kein Widerspruch zwischen den fünf Quellen.

`DRIFT_GATE = PASS`

### 0.3 HARD GATE 1 — Migration-0019-Zustand (gemessen)

| Umgebung                       | Quelle / Befehl                                                                                              | Befund                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Lokal (wegwerfbar)             | `pnpm exec supabase status` (nicht gestartet in dieser Session)                                              | irrelevant für die Strategie; wird bei `db reset` neu aufgebaut                                        |
| Shared/Dev                     | Repo, Runbooks, `.env`-Schlüssel, CI (`db-gates` = ephemer)                                                  | **es existiert keine** geteilte Dev-Datenbank außer dem VPS-Staging-Stack                              |
| Staging (VPS `srv1308064`)     | `docker exec supabase_db_easytree psql -At -c "select version, name from supabase_migrations.schema_migrations"` | **18 Zeilen, 0001…0018, kein 0019**; `to_regclass('public.worksite_days')` = NULL → **UNAPPLIED**     |
| Produktion `inypnrvpawvhgiyagxbd` | `mcp__supabase__list_migrations` ×2 → `Connection terminated due to connection timeout`; `get_project` → `status: INACTIVE`; `dig inypnrvpawvhgiyagxbd.supabase.co` → NXDOMAIN (Mac **und** VPS) | **UNKNOWN — Projekt pausiert**, DB nicht erreichbar. Letzte aufgezeichnete Lesungen (07.08., 15.08.2026: 17 Versionen) liegen VOR der Autorenschaft von 0019 (Commit `cc92ceb`, 01.09.2026). Beobachtung setzt `restore_project` voraus = Produktionsänderung, **nicht autorisiert** |

**Gate-Ergebnis nach Brief-Wortlaut:** `BLOCKED_MIGRATION_STATE` — Produktion ist nicht
sicher beobachtbar. Fehlende Fähigkeit: ein lesender Zugriff auf
`supabase_migrations.schema_migrations` des pausierten Projekts, der ohne `restore_project`
auskommt (gibt es nicht), ODER die Owner-Freigabe für ein Restore nur zum Lesen.

**Entscheidungsvorlage für den Orchestrator (D1):** `MIGRATION_STRATEGY = FORWARD_FIX`
(neue Migration 0020, 0019 unangetastet) ist in **beiden** Welten korrekt — ist 0019
in Produktion angewandt, ist sie Pflicht; ist sie es nicht, ist sie zulässig. Nur die
Option `REWRITE_UNAPPLIED_0019` hängt am unbeobachtbaren Zustand. FORWARD_FIX
braucht deshalb **keine** Annahme über Produktion. Dieser Plan ist für FORWARD_FIX
geschrieben; die Schemaaufgaben (ab Task 2) starten erst, wenn D1 vom Orchestrator
bestätigt oder ein Lese-Restore freigegeben ist. Tasks 1, 3 und 4 (Pfadumbenennung,
Contracts, reine Domainfunktionen) berühren kein Schema und dürfen davor laufen.

### 0.4 Kompatibilitätsbefunde (T-003 / T-004) — Entscheidungsvorlage D2

Gemessen im Worktree:

1. `POST /planung/einsaetze` ist heute `createAssignment` (Einplanung). Für den echten
   Einsatz gibt es keinen kollisionsfreien Pfad, solange das so bleibt → Task 1 benennt
   ihn nach `/planung/einplanungen` um (operationId `createAssignment` bleibt als
   dokumentierter technischer Kompatibilitätsname). Berührt außerhalb des Server-Scopes
   genau **eine** Zeile: `apps/web/test/helpers/werkbank.tsx:159` (Testhelfer, kein UI).
2. `POST /planung/baustellentage` (`planWorksiteDay`) wird von zwei **Pflicht**-CI-Jobs
   durch das (produktseitig abgelehnte) Vorläufer-Formular ausgeübt:
   `apps/web/e2e/read-through.spec.ts:516` (Job `read-through`) und
   `apps/web/e2e/auth-journey/journey.pwtest.ts:1353` (Job `auth-journey`), außerdem
   `apps/web/e2e/staging/journey.pwtest.ts:156`. Jede DB-Pflicht „Elternteil NOT NULL für
   neue Zeilen" macht diese Jobs rot, solange das Formular Standalone-Tage anlegt.
3. Das Web-Formular baut den Command in `apps/web/components/planning-window-view.tsx:477`;
   ein Pflichtfeld `einsatzId` im Contract bräche `typecheck`/`build-web` ohne UI-Arbeit.
   Sieben apps/web-Teststubs sind `: PlanningGateway` typisiert — ein Wachstum des
   Ports bräche sie ebenfalls.

**Disposition in diesem Plan:**

- Tasks 2–9 (Kern): Spalte `worksite_days.engagement_id` **nullable** + struktureller FK,
  Range-Command setzt sie immer; der Einsatz bekommt einen **eigenen Port**
  `EngagementGateway` (kein Wachstum von `PlanningGateway`); das Vorläufer-Formular bleibt
  unverändert lauffähig → alle elf Pflichtchecks bleiben grün.
- **Task-Gruppe E (D2):** DB-Pflicht `check (engagement_id is not null) not valid` +
  Umbau von `planWorksiteDay` zu „Tag zu dem Einsatz, der diesen Tag abdeckt"
  (deterministisch: genau ein abdeckender Einsatz, sonst benannt `ENGAGEMENT_REQUIRED`/
  `ENGAGEMENT_AMBIGUOUS`) + Einsatz-Vorbereitungsschritt in den drei Journeys.
  **Der Orchestrator entscheidet, ob E in diesem Inkrement läuft (empfohlen) oder in
  Inkrement 2 zusammen mit dem UI-Umbau.** Ohne E bleibt Drift-Punkt 2 für den
  Vorläuferpfad **offen** und wird im Evidence-Return so benannt.

---

## Konventionen für jeden Task

- Arbeitsverzeichnis: `/Users/benjaminpoersch/EasyTree-worktrees/eyt-120-engagement-range-create`.
  Jeder Befehl unten ist relativ dazu. Kein `git fetch --prune`, kein Stash/Reset im
  Hauptcheckout.
- Lokaler Stack: `colima start` → `pnpm exec supabase start -x vector -x logflare`
  (Memory: [[lokaler-auth-journey-lauf-unter-colima]]). App-Rolle-Passwort wie CI:
  `docker exec supabase_db_easytree psql -U postgres -c "alter role easytree_app with password 'ci-local-app-password'"`.
- Integrationssuiten **einzeln** aufrufen (nie zwei DB-Suiten in einem vitest-Aufruf,
  Memory [[vitest-multiple-db-suites-one-invocation-contaminate]]) mit
  `EASYTREE_TENANT_TESTS=required EASYTREE_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres EASYTREE_TEST_APP_DB_URL=postgresql://easytree_app:ci-local-app-password@127.0.0.1:54322/postgres`.
  Vorher `pnpm --filter @easytree/config build && pnpm --filter @easytree/contracts build && pnpm --filter @easytree/domain build`
  (apps/api liest `dist/`, Memory [[api-tests-read-stale-contracts-dist]]).
- **RED zuerst, und die Farbe wird gelesen:** vitest-Dateizahl ≥ 1, pgTAP `# Failed`-Zeile.
  Ein Pfadfilter ohne Treffer ist Exit 0 und beweist nichts.
- Gegenmutationen (Task 10) werden **eingespielt, gemessen, zurückgenommen**; Beleg ist
  `git diff -- <datei>` leer nach der Rücknahme.
- Commits: `feat(planning): EYT-120 …` / `feat(db): EYT-120 …` etc., Trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_01UTtwryviFpQMAKuhKPzAPu`. Nur benannte
  Dateien stagen; `git diff --cached --name-only` vor jedem Commit lesen.

---

### Task 1: T-004 — `POST /planung/einsaetze` wird `POST /planung/einplanungen`

**Files:**
- Modify: `packages/contracts/src/openapi/document.ts:385` (Pfadschlüssel + Beschreibungssatz)
- Modify: `packages/contracts/src/http/planning-gateway.ts:140`
- Modify: `packages/contracts/test/http-planning-gateway.test.ts` (Pfad-Assertion für createAssignment)
- Modify: `apps/api/src/modules/planning/interface/http/planning.controller.ts:439` (`@Post("einsaetze")` → `@Post("einplanungen")`)
- Modify: `apps/api/test/openapi-route-conformance.test.ts:59` (Kommentar)
- Modify: `apps/web/test/helpers/werkbank.tsx:159` (`/api/v1/planung/einplanungen`) — **außerhalb des Server-Scopes, Testhelfer, eine Zeile; Begründung: Abschnitt 0.4 Nr. 1**
- Regenerate: `packages/contracts/openapi/v1.json`

**Step 1: RED — Gateway-Test auf den neuen Pfad umstellen**

In `packages/contracts/test/http-planning-gateway.test.ts` den Test, der `createAssignment`
auf `${BASE}/planung/einsaetze` prüft (Suche: `grep -n 'planung/einsaetze' packages/contracts/test/http-planning-gateway.test.ts`),
auf `${BASE}/planung/einplanungen` ändern. Falls es keinen solchen Test gibt, nach dem Muster
von Zeile 370 („greift beim Anlegen auf POST /planung/baustellentage") einen anlegen:

```ts
it("greift beim Anlegen einer Einplanung auf POST /planung/einplanungen (T-004)", async () => {
  const { gateway, recorded } = gatewayMitAufzeichnung(); // Helfer der Datei wiederverwenden
  await gateway.createAssignment(gueltigerCreateAssignmentCommand(), {
    idempotencyKey: "00000000-0000-4000-8000-000000000001" as IdempotencyKey,
  });
  expect(recorded[0]?.url).toBe(`${BASE}/planung/einplanungen`);
});
```

**Step 2: Run — muss rot sein**

Run: `pnpm --filter @easytree/contracts exec vitest run test/http-planning-gateway.test.ts`
Expected: `Test Files 1 failed`, Assertion `expected ".../planung/einsaetze" to be ".../planung/einplanungen"`.

**Step 3: Pfad an den drei Quellen ändern**

- `document.ts`: `"/planung/einsaetze": {` → `"/planung/einplanungen": {`; `summary` wird
  `"Einplanung anlegen"`, die 201-Beschreibung `"Angelegte Einplanung"`, und die
  `description` des Vorgangs lautet: `"Fachlich eine EINPLANUNG (Glossar 46727169), keine Einsatz-Anlage: bis EYT-120 lag dieser Vorgang unter dem Pfad des Einsatzes, den seither createEngagement traegt. operationId createAssignment bleibt als technischer Kompatibilitaetsname."`
  — **ohne** das Literal des alten Pfads, damit der Grep in Step 4 dauerhaft 0 liefert
  (Kommentare in Tests ebenfalls ohne das Literal formulieren).
- `http/planning-gateway.ts:140`: `path: "/planung/einplanungen",`
- `planning.controller.ts:439`: `@Post("einplanungen")`
- `werkbank.tsx:159`: Pfad anpassen.
- `openapi-route-conformance.test.ts:59`: Kommentar anpassen.

**Step 4: OpenAPI regenerieren und alle betroffenen Suiten grün sehen**

Run:
```bash
pnpm --filter @easytree/contracts run openapi:write
pnpm --filter @easytree/contracts test
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts test/planning-gateway-parity.test.ts
pnpm --filter @easytree/web exec vitest run test/werkbank-serverwahrheit.test.tsx test/dispositionswerkbank.test.tsx
grep -rn -F 'planung/einsaetze' apps packages --include='*.ts' --include='*.tsx' --include='*.json' | grep -v node_modules | grep -v '/dist/'
```
Expected: alle Suiten grün mit Dateizahl ≥ 1; der letzte `grep` liefert **0 Zeilen**
(Ergebnis lesen, nicht Exit-Code).

**Step 5: Commit**

```bash
git add packages/contracts/src/openapi/document.ts packages/contracts/src/http/planning-gateway.ts packages/contracts/test/http-planning-gateway.test.ts packages/contracts/openapi/v1.json apps/api/src/modules/planning/interface/http/planning.controller.ts apps/api/test/openapi-route-conformance.test.ts apps/web/test/helpers/werkbank.tsx
git diff --cached --name-only
git commit -m "refactor(planning): EYT-120 Einplanungspfad heisst einplanungen, nicht einsaetze (T-004)"
```

---

### Task 2: Migration 0020 `engagements` + `worksite_days.engagement_id` (nur nach D1)

**Files:**
- Create: `supabase/migrations/<timestamp>_0020_engagements.sql` (via `pnpm exec supabase migration new engagements`, dann umbenennen)
- Create: `supabase/tests/0015_engagements.sql`
- Modify: `supabase/tests/0014_worksite_days.sql:75-83` (exakte Spaltenliste A1 um `engagement_id uuid NULL` erweitern; Aussagetext anpassen: „…kein EYT-120-Feld" wird „…engagement_id ist das EYT-120-Elternfeld (0020)")

**Step 1: RED — pgTAP 0015 schreiben, bevor die Migration existiert**

```sql
-- supabase/tests/0015_engagements.sql
-- EYT-120 Inkrement 1: Einsatz (engagements) und Elternrelation der Baustellentage.
-- Kein session_user-Wechsel moeglich (pgTAP laeuft als postgres) — Kanalaussagen
-- werden ueber die Policy-Definition geprueft, nicht ueber Verhalten (Memory
-- pgtap-cannot-change-session-user).
begin;
select plan(26);

-- A. Tabelle und Spalten -----------------------------------------------------
select has_table('public', 'engagements', 'A1 engagements existiert');
select is(
  (
    select coalesce(array_agg(
             a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' NOT NULL' else ' NULL' end
             order by a.attnum), array[]::text[])
    from pg_attribute a
    where a.attrelid = to_regclass('public.engagements')
      and a.attnum > 0 and not a.attisdropped
  ),
  array[
    'id uuid NOT NULL',
    'org_id uuid NOT NULL',
    'worksite_id uuid NOT NULL',
    'starts_at_utc timestamp with time zone NOT NULL',
    'ends_at_utc timestamp with time zone NULL',
    'created_at timestamp with time zone NOT NULL'
  ],
  'A2 engagements traegt exakt sechs Spalten — UTC-Instants, KEIN Zonenfeld, kein lokales Datum'
);
select col_is_pk('public', 'engagements', 'id', 'A3 id ist Primaerschluessel');
select has_unique('public', 'engagements', 'A4 unique-Constraints vorhanden');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.engagements'::regclass
            and contype = 'u' and conkey = array[
              (select attnum from pg_attribute where attrelid='public.engagements'::regclass and attname='id'),
              (select attnum from pg_attribute where attrelid='public.engagements'::regclass and attname='org_id'),
              (select attnum from pg_attribute where attrelid='public.engagements'::regclass and attname='worksite_id')]),
  'A5 unique (id, org_id, worksite_id) — Ziel des strukturellen FK aus worksite_days'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.engagements'::regclass
            and contype = 'c' and pg_get_constraintdef(oid) ilike '%ends_at_utc is null or ends_at_utc > starts_at_utc%'),
  'A6 check: bekanntes Ende liegt nach dem Beginn; offenes Ende erlaubt'
);
select fk_ok('public', 'engagements', array['worksite_id','org_id'], 'public', 'worksites', array['id','org_id'],
  'A7 Baustelle mandantengebunden referenziert');

-- B. worksite_days: Elternrelation ------------------------------------------
select has_column('public', 'worksite_days', 'engagement_id', 'B1 worksite_days.engagement_id existiert');
select col_is_null('public', 'worksite_days', 'engagement_id', 'B2 engagement_id ist (gestuft) nullable — Bestandszeilen bleiben gueltig');
select fk_ok('public', 'worksite_days', array['engagement_id','org_id','worksite_id'],
             'public', 'engagements', array['id','org_id','worksite_id'],
  'B3 struktureller FK: Einsatz, Organisation UND Baustelle muessen uebereinstimmen');
select has_index('public', 'worksite_days', 'worksite_days_engagement_idx', 'B4 Index auf engagement_id');
select ok(
  (select conkey = array[
     (select attnum from pg_attribute where attrelid='public.worksite_days'::regclass and attname='org_id'),
     (select attnum from pg_attribute where attrelid='public.worksite_days'::regclass and attname='worksite_id'),
     (select attnum from pg_attribute where attrelid='public.worksite_days'::regclass and attname='local_date')]
   from pg_constraint where conrelid='public.worksite_days'::regclass and contype='u'
     and pg_get_constraintdef(oid) like '%local_date%'),
  'B5 unique (org_id, worksite_id, local_date) ist UNVERAENDERT (D-008, kein Key-Widening)'
);

-- C. Rechte und RLS (0017-Muster) --------------------------------------------
select is(
  (select array_agg(privilege_type::text order by privilege_type)
     from information_schema.role_table_grants
    where table_schema='public' and table_name='engagements' and grantee='authenticated'),
  array['INSERT','SELECT'],
  'C1 authenticated: nur INSERT und SELECT auf engagements — kein UPDATE/DELETE ohne Verbraucher'
);
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.role_column_grants
    where table_schema='public' and table_name='engagements' and grantee='authenticated' and privilege_type='INSERT'),
  array['ends_at_utc','org_id','starts_at_utc','worksite_id'],
  'C2 INSERT-Grant spaltenweise: id und created_at bleiben der Datenbank'
);
select ok(
  has_column_privilege('authenticated', 'public.worksite_days', 'engagement_id', 'INSERT'),
  'C3 worksite_days.engagement_id ist fuer authenticated einfuegbar (0019-Grant erweitert)'
);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.engagements'::regclass),
  'C4 RLS enabled + forced');
select policies_are('public', 'engagements', array['engagements_select_in_org','engagements_insert_in_org'],
  'C5 genau zwei Policies — select und insert');
select ok(
  (select pg_get_expr(polwithcheck, polrelid) ilike '%app.is_runtime_channel()%'
      and pg_get_expr(polwithcheck, polrelid) ilike '%planning.write%'
     from pg_policy where polname='engagements_insert_in_org'),
  'C6 insert-Policy verlangt Laufzeitkanal UND planning.write'
);

-- D. Idempotenz-Allowlist (0019 erweitert) -------------------------------------
select ok(
  (select pg_get_constraintdef(oid) ilike '%planning.create_engagement%'
     from pg_constraint where conname='idempotency_records_worksite_day_ops_need_payload'),
  'D1 create_engagement verlangt result_payload'
);
select ok(
  (select prosrc ilike '%planning.create_engagement%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='app' and p.proname='read_idempotency_result'),
  'D2 read_idempotency_result kennt den neuen Vorgang'
);

-- E. Verhalten (als postgres = Laufzeitkanal erfuellt) -------------------------
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-00000000aaa1','role','authenticated')::text, true);
set local role authenticated;
prepare einsatz as insert into public.engagements (org_id, worksite_id, starts_at_utc, ends_at_utc)
  values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000005010a1', '2031-01-06 07:00+00', '2031-01-10 16:00+00') returning id;
select lives_ok('einsatz', 'E1 Insert im eigenen Mandanten mit planning.write gelingt');
select throws_ok(
  $$insert into public.engagements (org_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000005010a1','2031-01-06 07:00+00','2031-01-06 07:00+00')$$,
  '23514', null, 'E2 Ende = Beginn wird abgewiesen');
select throws_ok(
  $$insert into public.engagements (org_id, worksite_id, starts_at_utc)
    values ('00000000-0000-4000-8000-0000000000b2', (select id from public.worksites where org_id='00000000-0000-4000-8000-0000000000b2' limit 1), '2031-01-06 07:00+00')$$,
  '42501', null, 'E3 Fremder Mandant: RLS lehnt ab (kein Existenzleck)');
select throws_ok(
  $$insert into public.worksite_days (org_id, worksite_id, local_date, engagement_id)
    values ('00000000-0000-4000-8000-0000000000a1', (select id from public.worksites where org_id='00000000-0000-4000-8000-0000000000a1' and id <> '00000000-0000-4000-8000-0000005010a1' limit 1), '2031-01-07',
            (select id from public.engagements where worksite_id='00000000-0000-4000-8000-0000005010a1' limit 1))$$,
  '23503', null, 'E4 Baustellenfremder Einsatz scheitert am strukturellen FK — nicht erst an einer Anwendungsregel');
select lives_ok(
  $$insert into public.worksite_days (org_id, worksite_id, local_date, engagement_id)
    values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000005010a1','2031-01-07',
            (select id from public.engagements where worksite_id='00000000-0000-4000-8000-0000005010a1' limit 1))$$,
  'E5 Tag mit passendem Einsatz gelingt');
select throws_ok(
  $$insert into public.worksite_days (org_id, worksite_id, local_date, engagement_id)
    values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000005010a1','2031-01-07',
            (select id from public.engagements where worksite_id='00000000-0000-4000-8000-0000005010a1' limit 1))$$,
  '23505', null, 'E6 zweiter Tag derselben Baustelle am selben lokalen Datum: unique haelt (D-008)');
-- E7 gehoert zu Task-Gruppe E (CHECK NOT VALID). Solange E nicht laeuft, bleibt der Fall
-- als `skip` eingetragen, damit plan(26) stimmt und der Ausstand sichtbar ist:
select skip('E7 parentloser Insert wird erst mit Task-Gruppe E (check not valid) abgewiesen', 1);
reset role;

select * from finish();
rollback;
```

Hinweis: `plan(26)` ist die Summe der `select`-Aussagen oben; nach jedem Zusatz nachzählen
(`grep -cE "^select (has_|is\(|ok\(|col_|fk_ok|lives_ok|throws_ok|policies_are|skip)" supabase/tests/0015_engagements.sql`).
Die Worksite-IDs stammen aus `supabase/seed.sql` (WORKSITE_ALPHA `…5010a1`, wie in
`apps/api/test/planning-write.integration.test.ts`).

**Step 2: Run — muss rot sein (Tabelle existiert nicht)**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db`
Expected: `0015_engagements.sql` rot, erste Aussage `A1 engagements existiert` fehlgeschlagen; alle
vorherigen Dateien grün.

**Step 3: Migration schreiben**

```bash
pnpm exec supabase migration new engagements
# Datei umbenennen: <timestamp>_engagements.sql -> <timestamp>_0020_engagements.sql
```

Inhalt:

```sql
-- Migration 0020_engagements — der Einsatz als fachliche Klammer der Baustellentage
-- (EYT-120 Inkrement 1; Confluence 49119274 D-002..D-009, T-001/T-002/T-005)
--
-- STRATEGIE: FORWARD_FIX. 0019 wird nicht angefasst — Staging traegt sie nicht (gemessen
-- 06.09.2026, 18 Versionen), Produktion ist pausiert und nicht beobachtbar. Diese
-- Migration ist in beiden Welten korrekt.
--
-- WAS HIER STEHT — UND WAS NICHT
-- ---------------------------------------------------------------------------
-- `engagements` ist die IDENTITAET des Einsatzes: Organisation, Baustelle, Beginn (Pflicht)
-- und Ende (offen erlaubt) als UTC-Instants. KEIN Zonenfeld: die Zone der Organisation
-- (`organizations.time_zone`, 0004) bleibt die einzige Wahrheit (D-003). KEIN lokales
-- Datum: es waere eine zweite, mit der Zone auseinanderlaufende Wahrheit. KEIN
-- Leistungsziel, KEIN Auftraggeber — nicht Teil dieses Inkrements (Brief: Einsatz-Minimum).
--
-- `worksite_days.engagement_id` ist der Elternkontext (T-001). Der Fremdschluessel ist
-- ZUSAMMENGESETZT ueber (engagement_id, org_id, worksite_id): damit ist "derselbe Mandant
-- UND dieselbe Baustelle" eine strukturelle Eigenschaft (23503), keine Anwendungsregel und
-- keine Audit-Rekonstruktion. Die Identitaet (org_id, worksite_id, local_date) bleibt
-- UNVERAENDERT (T-002, D-008).
--
-- GESTUFTE PFLICHT (Legacy-Strategie)
-- ---------------------------------------------------------------------------
-- Die Spalte ist NULLABLE: Zeilen aus 0019-Pfaden (lokale Staende, CI) muessen nicht
-- rueckwirkend umgedeutet werden — kein stiller Backfill. Die Pflicht fuer NEUE Zeilen
-- kommt als `check (...) not valid` (Block 6), das Bestandszeilen ungeprueft laesst;
-- `validate constraint` + `set not null` folgen in einer spaeteren Migration, wenn die
-- Bestandsinventur entschieden ist (PO). Block 6 wird NUR mit Task-Gruppe E aktiviert.
--
-- ROLLBACK (vorwaerts, als neue Migration — diese wird nach dem Merge nie editiert)
-- ---------------------------------------------------------------------------
--   alter table public.worksite_days drop constraint if exists worksite_days_engagement_required;
--   drop index public.worksite_days_engagement_idx;
--   alter table public.worksite_days drop constraint worksite_days_engagement_fk;
--   revoke insert on table public.worksite_days from authenticated;
--   grant insert (org_id, worksite_id, local_date) on table public.worksite_days to authenticated;
--   alter table public.worksite_days drop column engagement_id;
--   -- Idempotenz-Allowlist auf die 0019-Fassung zurueck (Constraint + Funktion):
--   alter table public.idempotency_records drop constraint idempotency_records_worksite_day_ops_need_payload;
--   alter table public.idempotency_records add constraint idempotency_records_worksite_day_ops_need_payload
--     check (operation not in ('planning.plan_worksite_day','planning.update_worksite_day_team') or result_payload is not null);
--   create or replace function app.read_idempotency_result(text, text) ... -- 0019-Rumpf
--   drop table public.engagements;
-- Datenverlust der Umkehr: alle Einsaetze und die Elternzuordnung ihrer Tage.

-- ---------------------------------------------------------------------------
-- 1. IDENTITAET DES EINSATZES
-- ---------------------------------------------------------------------------
create table public.engagements (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  worksite_id uuid not null,
  starts_at_utc timestamptz not null,
  ends_at_utc timestamptz,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Ziel des strukturellen FK aus worksite_days (Block 3).
  unique (id, org_id, worksite_id),
  constraint engagements_end_after_start check (ends_at_utc is null or ends_at_utc > starts_at_utc),
  foreign key (worksite_id, org_id) references public.worksites (id, org_id) on delete restrict
);

comment on table public.engagements is
  'Einsatz (EYT-120): Organisation, Baustelle, Beginn (Pflicht) und Ende (offen erlaubt) als UTC-Instants. Kein Zonenfeld — organizations.time_zone ist die einzige Zeitzonenwahrheit. Ein Einsatz ist die fachliche Klammer seiner worksite_days; Tagesarbeitszeiten sind davon getrennt (D-003).';
comment on column public.engagements.ends_at_utc is
  'NULL = offenes Ende (D-005). Der Planungshorizont wird NICHT hier persistiert; er ist Eingabe des Commands und materialisiert nur bestaetigte Tage.';

create index engagements_worksite_idx on public.engagements (org_id, worksite_id, starts_at_utc);

-- ---------------------------------------------------------------------------
-- 2. RECHTE UND RLS (0017/0019-Muster: spaltenweise, Kanal und Recht in der Policy)
-- ---------------------------------------------------------------------------
revoke all on table public.engagements from anon, authenticated;
grant select on table public.engagements to authenticated;
grant insert (org_id, worksite_id, starts_at_utc, ends_at_utc) on table public.engagements to authenticated;
-- KEIN update/delete: dieses Inkrement hat keinen Aenderungs-Command (EYT-121/122 spaeter).

alter table public.engagements enable row level security;
alter table public.engagements force row level security;

create policy engagements_select_in_org on public.engagements
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy engagements_insert_in_org on public.engagements
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  );

-- ---------------------------------------------------------------------------
-- 3. ELTERNRELATION DER BAUSTELLENTAGE (T-001), strukturell
-- ---------------------------------------------------------------------------
alter table public.worksite_days add column engagement_id uuid;

comment on column public.worksite_days.engagement_id is
  'Einsatz, zu dem dieser Baustellentag gehoert (EYT-120). Zusammengesetzter FK ueber (engagement_id, org_id, worksite_id): Mandant und Baustelle stimmen strukturell ueberein. NULL nur fuer Zeilen aus dem 0019-Vorlaeuferpfad; die Pflicht fuer neue Zeilen traegt worksite_days_engagement_required (Block 6).';

alter table public.worksite_days add constraint worksite_days_engagement_fk
  foreign key (engagement_id, org_id, worksite_id)
  references public.engagements (id, org_id, worksite_id)
  on delete restrict;

create index worksite_days_engagement_idx on public.worksite_days (engagement_id);

-- Der 0019-Grantumfang waechst um GENAU eine Spalte (dasselbe Vorgehen wie 0019 Block 6).
revoke insert on table public.worksite_days from authenticated;
grant insert (org_id, worksite_id, local_date, engagement_id) on table public.worksite_days to authenticated;

-- ---------------------------------------------------------------------------
-- 4. IDEMPOTENZ: dritter Payload-Vorgang (0019 Block 9 erweitert)
-- ---------------------------------------------------------------------------
alter table public.idempotency_records
  drop constraint idempotency_records_worksite_day_ops_need_payload;
alter table public.idempotency_records
  add constraint idempotency_records_worksite_day_ops_need_payload
  check (
    operation not in ('planning.plan_worksite_day', 'planning.update_worksite_day_team',
                      'planning.create_engagement')
    or result_payload is not null
  );

-- Die EINZIGE Lesestelle des Payloads — identischer Rumpf wie 0019, nur die Allowlist
-- kennt den dritten Vorgang. (Vollstaendig wiederholt, weil `create or replace` den
-- ganzen Rumpf traegt; Abweichungen vom 0019-Text ausser Zeile "1." sind ein Fehler.)
create or replace function app.read_idempotency_result(p_operation text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_payload jsonb;
  v_orgs uuid[];
begin
  -- 1. Nur die Payload-Vorgaenge (0019: zwei; 0020: drei).
  if p_operation not in ('planning.plan_worksite_day', 'planning.update_worksite_day_team',
                         'planning.create_engagement') then
    raise exception 'Kein Payload-Vorgang' using errcode = '42501';
  end if;
  if not app.is_runtime_channel() then
    raise exception 'Nur der Laufzeitkanal darf ein Replay-Ergebnis lesen'
      using errcode = '42501';
  end if;
  select array_agg(o) into v_orgs from app.user_org_ids() as o;
  if v_orgs is null then
    raise exception 'Keine aktive Organisation' using errcode = '42501';
  end if;
  if array_length(v_orgs, 1) > 1 then
    raise exception 'Mehrdeutige Organisation — genau eine aktive Mitgliedschaft erforderlich'
      using errcode = '42501';
  end if;
  v_org := v_orgs[1];
  if not app.has_permission(v_org, 'planning.write') then
    raise exception 'Kein Planungsrecht' using errcode = '42501';
  end if;
  select result_payload
    into v_payload
    from public.idempotency_records
   where org_id = v_org
     and operation = p_operation
     and idempotency_key = p_key;
  if not found then
    return null;
  end if;
  return v_payload;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. AUDIT-VORGANG
-- ---------------------------------------------------------------------------
-- audit_events.event_type ist freier Text (0008); keine Schemaaenderung noetig.
-- Der Command schreibt 'planning.engagement_created' mit subject_type 'engagement'.

-- ---------------------------------------------------------------------------
-- 6. GESTUFTE PFLICHT — NUR MIT TASK-GRUPPE E AKTIVIEREN
-- ---------------------------------------------------------------------------
-- `not valid`: neue und geaenderte Zeilen muessen die Bedingung erfuellen, Bestandszeilen
-- bleiben ungeprueft, bis eine spaetere Migration `validate constraint` ausfuehrt. Das ist
-- die kleinste migrationssichere Stufung fuer einen Pflicht-Elternteil (Brief: "staged
-- constraint strategy"). Solange der 0019-Vorlaeuferpfad (POST /planung/baustellentage)
-- parentlose Tage anlegt, macht dieser Block zwei Pflicht-CI-Jobs rot — deshalb ist er an
-- Task-Gruppe E gebunden (Plan 2026-09-06, Abschnitt 0.4).
-- alter table public.worksite_days add constraint worksite_days_engagement_required
--   check (engagement_id is not null) not valid;
```

**Step 4: pgTAP 0014 anpassen (bewusste Aktualisierung, kein Stummschalten)**

In `supabase/tests/0014_worksite_days.sql:75-83` die Spaltenliste um
`'engagement_id uuid NULL'` (am Ende, `attnum`-Reihenfolge) erweitern; Aussagetext:
`'A1 worksite_days traegt die fuenf Identitaetsspalten plus engagement_id (EYT-120, 0020) — keine Zeiten, kein Publish-Marker'`.
Prüfen, ob 0014 weitere exakte Grant-Listen auf `worksite_days` INSERT führt
(`sed -n 225,260p supabase/tests/0014_worksite_days.sql`) und dort `engagement_id` ergänzen.

**Step 5: Run — zweimal reset, zweimal pgTAP**

Run:
```bash
pnpm exec supabase db reset && pnpm exec supabase test db 2>&1 | tee /tmp/pgtap-1.log
pnpm exec supabase db reset && pnpm exec supabase test db 2>&1 | tee /tmp/pgtap-2.log
grep -E 'Failed|failed|# Looks like' /tmp/pgtap-1.log /tmp/pgtap-2.log
```
Expected: beide Läufe grün; E7 als `# SKIP` sichtbar; kein `Failed`.

**Step 6: Commit**

```bash
git add supabase/migrations/*_0020_engagements.sql supabase/tests/0015_engagements.sql supabase/tests/0014_worksite_days.sql
git diff --cached --name-only
git commit -m "feat(db): EYT-120 Einsatz-Identitaet und strukturelle Elternrelation der Baustellentage (0020)"
```

---

### Task 3: Contracts — Command, DTO, Problem-Types, `EngagementGateway`

**Files:**
- Modify: `packages/contracts/src/primitives.ts` (nach `LocalDateSchema`: `LocalTimeSchema`, `LocalDateTimeSchema`)
- Modify: `packages/contracts/src/planning/schemas.ts` (Anhang: `WorkingTimeSchema`, `EngagementDaySelectionSchema`, `CreateEngagementCommandSchema`, `EngagementDayDtoSchema`, `EngagementDtoSchema`, `ENGAGEMENT_PROBLEM_TYPE`)
- Modify: `packages/contracts/src/planning/gateway.ts` (neuer Port `EngagementGateway`)
- Modify: `packages/contracts/src/http/planning-gateway.ts` (`implements PlanningGateway, EngagementGateway`, Methode `createEngagement`, Pfad `/planung/einsaetze`)
- Modify: `packages/contracts/src/mock/planning.ts` (`createEngagement` im Mock: legt Tage in `state` an, gleiche Fehlerinduktion)
- Modify: `packages/contracts/src/openapi/document.ts` (Komponenten + Pfad `/planung/einsaetze`)
- Modify: `packages/contracts/src/index.ts` (Exporte)
- Create: `packages/contracts/test/engagement-schemas.test.ts`
- Modify: `packages/contracts/test/http-planning-gateway.test.ts` (Pfad/Methoden-Test für `createEngagement`)
- Modify: `packages/contracts/test/openapi-drift.test.ts:285` (Tabelle der Pfade um `{ pfad: "/planung/einsaetze", operationId: "createEngagement", erfolg: "201" }`)
- Regenerate: `packages/contracts/openapi/v1.json`

**Step 1: RED — Schema-Tests (Brief-Fälle 1–7)**

```ts
// packages/contracts/test/engagement-schemas.test.ts
import { describe, expect, it } from "vitest";
import { CreateEngagementCommandSchema } from "../src/planning/schemas.js";

const WORKSITE = "00000000-0000-4000-8000-0000005010a1";
const EMPLOYEE = "00000000-0000-4000-8000-0000004010a1";
const basis = {
  worksiteId: WORKSITE,
  startAt: { date: "2031-01-06", time: "07:00" },
  endAt: { date: "2031-01-10", time: "16:00" },
  planningHorizon: null,
  defaults: { workingTime: { from: "08:00", to: "18:00" } },
  days: [{ localDate: "2031-01-06" }, { localDate: "2031-01-07", workingTime: { from: "08:00", to: "12:00" } }],
  team: [EMPLOYEE],
};

describe("CreateEngagementCommandSchema (EYT-120)", () => {
  it("1 verlangt startAt als lokales Datum+Zeit", () => {
    const { startAt, ...ohne } = basis;
    void startAt; // Root-ESLint kennt kein varsIgnorePattern — `_weg` faellt an no-unused-vars
    expect(CreateEngagementCommandSchema.safeParse(ohne).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, startAt: { date: "2031-01-06" } }).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, startAt: "2031-01-06T07:00:00.000Z" }).success).toBe(false);
  });
  it("2 erlaubt endAt = null nur mit konkretem Planungshorizont", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, endAt: null, planningHorizon: "2031-01-17" }).success).toBe(true);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, endAt: null, planningHorizon: null }).success).toBe(false);
    // bekanntes Ende UND Horizont waeren zwei Wahrheiten
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, planningHorizon: "2031-01-17" }).success).toBe(false);
  });
  it("3 bekanntes Ende liegt nach dem Beginn (lexikografisch auf Datum+Zeit)", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, endAt: { date: "2031-01-06", time: "07:00" } }).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, endAt: { date: "2031-01-06", time: "07:01" }, days: [{ localDate: "2031-01-06" }] }).success).toBe(true);
  });
  it("4 mindestens ein ausgewaehlter Tag", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, days: [] }).success).toBe(false);
  });
  it("5 doppelte Tage werden abgelehnt", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, days: [{ localDate: "2031-01-06" }, { localDate: "2031-01-06" }] }).success).toBe(false);
  });
  it("6 Tage ausserhalb von [startAt.date, endAt.date | planningHorizon] werden abgelehnt", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, days: [{ localDate: "2031-01-05" }] }).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, days: [{ localDate: "2031-01-11" }] }).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, endAt: null, planningHorizon: "2031-01-17", days: [{ localDate: "2031-01-18" }] }).success).toBe(false);
  });
  it("7 unbekannte Schluessel werden strikt abgelehnt; Arbeitszeit to > from; Team nicht leer, ohne Duplikate", () => {
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, extra: 1 }).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, defaults: { workingTime: { from: "18:00", to: "08:00" } } }).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, team: [] }).success).toBe(false);
    expect(CreateEngagementCommandSchema.safeParse({ ...basis, team: [EMPLOYEE, EMPLOYEE] }).success).toBe(false);
  });
});
```

Run: `pnpm --filter @easytree/contracts exec vitest run test/engagement-schemas.test.ts`
Expected: `Test Files 1 failed` — Import `CreateEngagementCommandSchema` ist `undefined`.

**Step 2: Primitive**

In `packages/contracts/src/primitives.ts` nach `LocalDateSchema`:

```ts
/** Lokale Wanduhrzeit `HH:MM`, minutengenau. Sekunden gibt es im Produkt nicht. */
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Lokale Uhrzeit im Format HH:MM")
  .describe("Lokale Uhrzeit 08:00 — ohne Zone; die Organisationszeitzone loest sie auf");

export type LocalTime = z.infer<typeof LocalTimeSchema>;

/**
 * Lokales Geschaeftsdatum + lokale Geschaeftszeit (D-003). Bewusst KEIN Instant: der
 * Server loest den Wert mit der Zeitzone der Organisation auf — und lehnt nicht
 * existente oder mehrdeutige Sommerzeit-Zeiten benannt ab, statt zu raten.
 */
export const LocalDateTimeSchema = z.strictObject({
  date: LocalDateSchema,
  time: LocalTimeSchema,
});

export type LocalDateTime = z.infer<typeof LocalDateTimeSchema>;
```

**Step 3: Schemas**

Am Ende von `packages/contracts/src/planning/schemas.ts` (Import `LocalDateTimeSchema, LocalTimeSchema` aus `../primitives.js` ergänzen):

```ts
// ---------------------------------------------------------------------------
// Einsatz (EYT-120 Inkrement 1)
// ---------------------------------------------------------------------------

/** Geplante Arbeitszeit eines Tages, lokal, innerhalb desselben Kalendertages. */
export const WorkingTimeSchema = z
  .strictObject({ from: LocalTimeSchema, to: LocalTimeSchema })
  .refine((zeit) => zeit.to > zeit.from, {
    message: "to muss nach from liegen (Arbeitszeit innerhalb eines lokalen Tages)",
    path: ["to"],
  });

export type WorkingTime = z.infer<typeof WorkingTimeSchema>;

/** Ein ausgewaehlter Tag; ohne eigene Arbeitszeit gilt `defaults.workingTime`. */
export const EngagementDaySelectionSchema = z.strictObject({
  localDate: LocalDateSchema,
  workingTime: WorkingTimeSchema.optional(),
});

export type EngagementDaySelection = z.infer<typeof EngagementDaySelectionSchema>;

const lokalerZeitpunkt = (wert: { date: string; time: string }): string => `${wert.date}T${wert.time}`;

/**
 * Einsatz + bestaetigte Baustellentage in EINEM Kommando (D-004, FR-005).
 *
 * `startAt`/`endAt` sind lokale Datum-Zeit-Werte (D-003). `endAt = null` ist das offene
 * Ende (D-005); dann ist `planningHorizon` Pflicht und begrenzt nur die AUSWAHL, nicht den
 * Einsatz. Bei bekanntem Ende ist der Horizont das Ende — ein zusaetzlicher Horizont waere
 * eine zweite Wahrheit und wird abgelehnt.
 *
 * `days` ist die EXPLIZITE Auswahl der Planerin (Mo–Fr ist Darstellung, keine Serverregel);
 * der Server regeneriert keine Wochentage. Jeder Tag liegt in
 * [startAt.date, endAt.date | planningHorizon], keiner doppelt, keiner leer.
 *
 * Grenze der Veroeffentlichung: die Beziehungen (Ende nach Beginn, Tage im Zeitraum,
 * Duplikate, Horizont-XOR) sind JSON-Schema nicht ausdrueckbar; zur Laufzeit gelten sie.
 */
export const CreateEngagementCommandSchema = z
  .strictObject({
    worksiteId: IdSchema,
    startAt: LocalDateTimeSchema,
    endAt: LocalDateTimeSchema.nullable(),
    planningHorizon: LocalDateSchema.nullable(),
    defaults: z.strictObject({ workingTime: WorkingTimeSchema }),
    days: z.array(EngagementDaySelectionSchema).min(1, "Mindestens ein Tag muss ausgewaehlt sein"),
    team: z.array(IdSchema).min(1, "Ein Baustellentag entsteht nicht ohne Team"),
  })
  .superRefine((cmd, ctx) => {
    if (cmd.endAt !== null && lokalerZeitpunkt(cmd.endAt) <= lokalerZeitpunkt(cmd.startAt)) {
      ctx.addIssue({ code: "custom", path: ["endAt"], message: "endAt muss nach startAt liegen" });
    }
    if (cmd.endAt === null && cmd.planningHorizon === null) {
      ctx.addIssue({ code: "custom", path: ["planningHorizon"], message: "Offenes Ende braucht einen konkreten Planungshorizont" });
    }
    if (cmd.endAt !== null && cmd.planningHorizon !== null) {
      ctx.addIssue({ code: "custom", path: ["planningHorizon"], message: "Bei bekanntem Ende ist das Ende der Horizont — kein zweiter Wert" });
    }
    const bis = cmd.endAt?.date ?? cmd.planningHorizon;
    if (bis !== null && bis !== undefined && bis < cmd.startAt.date) {
      ctx.addIssue({ code: "custom", path: ["planningHorizon"], message: "Horizont liegt vor dem Beginn" });
    }
    const gesehen = new Set<string>();
    cmd.days.forEach((tag, i) => {
      if (gesehen.has(tag.localDate)) {
        ctx.addIssue({ code: "custom", path: ["days", i], message: `Tag ${tag.localDate} ist doppelt ausgewaehlt` });
      }
      gesehen.add(tag.localDate);
      if (tag.localDate < cmd.startAt.date || (bis !== null && bis !== undefined && tag.localDate > bis)) {
        ctx.addIssue({ code: "custom", path: ["days", i], message: `Tag ${tag.localDate} liegt ausserhalb des Zeitraums` });
      }
    });
    const personen = new Set(cmd.team);
    if (personen.size !== cmd.team.length) {
      ctx.addIssue({ code: "custom", path: ["team"], message: "Dieselbe Person steht zweimal im Team" });
    }
  });

export type CreateEngagementCommand = z.infer<typeof CreateEngagementCommandSchema>;

/** Ein erzeugter Tag — WorksiteDayDto plus die Woche, deren Entwurf ihn traegt. */
export const EngagementDayDtoSchema = WorksiteDayDtoSchema.extend({ weekKey: IsoWeekKeySchema });

export type EngagementDayDto = z.infer<typeof EngagementDayDtoSchema>;

export const EngagementDtoSchema = z.strictObject({
  engagementId: IdSchema,
  worksiteId: IdSchema,
  startsAtUtc: InstantSchema,
  endsAtUtc: InstantSchema.nullable(),
  days: z.array(EngagementDayDtoSchema).min(1),
});

export type EngagementDto = z.infer<typeof EngagementDtoSchema>;

/** Problem-Types des Einsatz-Commands; Zuordnung an der HTTP-Naht in apps/api. */
export const ENGAGEMENT_PROBLEM_TYPE = {
  ENGAGEMENT_START_IN_PAST: "urn:easytree:planning:engagement-start-in-past",
  LOCAL_TIME_NONEXISTENT: "urn:easytree:planning:local-time-nonexistent",
  LOCAL_TIME_AMBIGUOUS: "urn:easytree:planning:local-time-ambiguous",
  WORKING_TIME_OUTSIDE_ENGAGEMENT: "urn:easytree:planning:working-time-outside-engagement",
  WORKSITE_DAY_CLAIMED: "urn:easytree:planning:worksite-day-claimed",
  /** Task-Gruppe E: der Einzeltag-Command findet keinen abdeckenden Einsatz. */
  ENGAGEMENT_REQUIRED: "urn:easytree:planning:engagement-required",
  ENGAGEMENT_AMBIGUOUS: "urn:easytree:planning:engagement-ambiguous",
} as const;

export type EngagementProblemType = (typeof ENGAGEMENT_PROBLEM_TYPE)[keyof typeof ENGAGEMENT_PROBLEM_TYPE];
```

`InstantSchema` wird bereits importiert (Zeile 24). Exporte in `packages/contracts/src/index.ts`
im Planungsblock ergänzen (`WorkingTimeSchema`, `EngagementDaySelectionSchema`,
`CreateEngagementCommandSchema`, `EngagementDayDtoSchema`, `EngagementDtoSchema`,
`ENGAGEMENT_PROBLEM_TYPE`, Typen, `EngagementGateway`, `LocalTimeSchema`, `LocalDateTimeSchema`).

**Step 4: Port + HTTP + Mock**

`packages/contracts/src/planning/gateway.ts`:

```ts
/**
 * Einsatz-Port (EYT-120). Eigener Port statt Wachstum von {@link PlanningGateway}: sieben
 * apps/web-Teststubs sind `: PlanningGateway` typisiert und wuerden mit jedem neuen
 * Pflichtmitglied rot — die UI (Inkrement 2) verdrahtet diesen Port im Composition Root.
 */
export interface EngagementGateway {
  createEngagement(
    input: CreateEngagementCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<EngagementDto>>;
}
```

`packages/contracts/src/http/planning-gateway.ts`: Klasse `implements PlanningGateway, EngagementGateway`,
Methode nach dem Muster von `planWorksiteDay`:

```ts
  createEngagement(
    input: CreateEngagementCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<z.infer<typeof EngagementDtoSchema>>> {
    return this.send({
      path: "/planung/einsaetze",
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey,
      schema: EngagementDtoSchema,
      // Jeder 409 ist eine fachliche Ablehnung (Tag vergeben, Zeit ausserhalb, Vergangenheit,
      // DST) — beim Anlegen gibt es keinen veralteten Stand.
      conflictAs: "REJECTED",
    });
  }
```

`packages/contracts/src/mock/planning.ts`: `implements PlanningGateway, EngagementGateway`;
`createEngagement` erzeugt je `days[i]` einen `WorksiteDayDto` mit `weekKey` (ISO-Woche über
`isoWeekKeyOf`-Helfer der Datei oder `iso-week.ts`), respektiert `induce(...)`.

OpenAPI (`document.ts`): Komponenten `WorkingTime`, `EngagementDaySelection`,
`CreateEngagementCommand`, `EngagementDayDto`, `EngagementDto` registrieren; Pfad:

```ts
      "/planung/einsaetze": {
        post: {
          operationId: "createEngagement",
          summary: "Einsatz mit bestaetigten Baustellentagen anlegen",
          description:
            "Legt einen Einsatz (Baustelle, lokaler Beginn, lokales oder offenes Ende) und seine " +
            "explizit ausgewaehlten Baustellentage mit Erstkonfiguration und Team in EINER " +
            "Transaktion an (EYT-120). Lokale Zeiten werden mit der Organisationszeitzone " +
            "aufgeloest; nicht existente/mehrdeutige Sommerzeit-Zeiten, ein Beginn vor jetzt, " +
            "Arbeitszeiten ausserhalb der Einsatzgrenzen und bereits vergebene Tage werden mit " +
            `${ENGAGEMENT_PROBLEM_TYPE.LOCAL_TIME_NONEXISTENT}, ${ENGAGEMENT_PROBLEM_TYPE.LOCAL_TIME_AMBIGUOUS}, ` +
            `${ENGAGEMENT_PROBLEM_TYPE.ENGAGEMENT_START_IN_PAST}, ${ENGAGEMENT_PROBLEM_TYPE.WORKING_TIME_OUTSIDE_ENGAGEMENT} ` +
            `und ${ENGAGEMENT_PROBLEM_TYPE.WORKSITE_DAY_CLAIMED} abgelehnt — nie still gekuerzt.`,
          parameters: [idempotencyHeader],
          requestBody: jsonBody("CreateEngagementCommand"),
          responses: {
            "201": jsonOk("EngagementDto", "Angelegter Einsatz mit seinen Tagen"),
            ...problemResponses,
            "409": konfliktMit(
              ENGAGEMENT_PROBLEM_TYPE.ENGAGEMENT_START_IN_PAST,
              ENGAGEMENT_PROBLEM_TYPE.LOCAL_TIME_NONEXISTENT,
              ENGAGEMENT_PROBLEM_TYPE.LOCAL_TIME_AMBIGUOUS,
              ENGAGEMENT_PROBLEM_TYPE.WORKING_TIME_OUTSIDE_ENGAGEMENT,
              ENGAGEMENT_PROBLEM_TYPE.WORKSITE_DAY_CLAIMED,
              WORKSITE_DAY_PROBLEM_TYPE.DUPLICATE_WORKSITE_DAY,
            ),
          },
        },
      },
```

Der `NamedSchema`-Typ in `document.ts` leitet sich aus der Komponentenliste ab — die fünf
Namen dort eintragen, sonst bricht `jsonBody("CreateEngagementCommand")` beim Typecheck.

**Step 5: Tests grün, Dokument regenerieren, Drift**

Run:
```bash
pnpm --filter @easytree/contracts exec vitest run test/engagement-schemas.test.ts test/http-planning-gateway.test.ts
pnpm --filter @easytree/contracts run openapi:write
pnpm --filter @easytree/contracts test
pnpm --filter @easytree/contracts build
```
Expected: 7 Schema-Fälle grün; Drift-Test grün **nach** `openapi:write`; `git diff --stat packages/contracts/openapi/v1.json` zeigt Änderungen.

Zusatz-RED für die Strictness-Falle (Memory [[zod-strictobject-im-dokument-unsichtbar]]):
Fall 7 oben ist der Laufzeitfall; ohne ihn bliebe ein Verlust von `strictObject` unsichtbar.

**Step 6: Commit**

```bash
git add packages/contracts/src/primitives.ts packages/contracts/src/planning/schemas.ts packages/contracts/src/planning/gateway.ts packages/contracts/src/http/planning-gateway.ts packages/contracts/src/mock/planning.ts packages/contracts/src/openapi/document.ts packages/contracts/src/index.ts packages/contracts/openapi/v1.json packages/contracts/test/engagement-schemas.test.ts packages/contracts/test/http-planning-gateway.test.ts packages/contracts/test/openapi-drift.test.ts
git diff --cached --name-only
git commit -m "feat(contracts): EYT-120 Einsatz-Command, -DTO, Problem-Types und EngagementGateway"
```

---

### Task 4: Reine Domainregeln — Einsatzgrenzen, Tagesarbeitszeit, Zeitprüfungen

**Files:**
- Create: `apps/api/src/modules/planning/domain/engagement-range.ts`
- Create: `apps/api/test/planning-engagement-range.test.ts` (Unit, ohne DB)
- Modify: `apps/api/src/modules/planning/index.ts` (Barrel-Export; Memory [[costs-tests-import-only-via-module-index]])
- **Kein** Eintrag in `apps/api/test/domain-invariants/registry.ts`: das Register ist laut
  eigenem Kopf und `domain-invariant-coverage.test.ts` auf Exporte von `@easytree/domain` und
  Tests unter `packages/domain/test/` beschränkt (gemessen 07.09.2026: ein Eintrag mit
  apps/api-Datei macht zwei Zusicherungen rot). Die Einsatzregeln sind Modul-Domain von
  `apps/api`; Nachweis sind die zehn Unit-Fälle plus Gegenmutationen M4/M7 (Task 10).

**Step 1: RED — Unit-Tests (Brief-Fälle 8–16, ohne DB)**

```ts
// apps/api/test/planning-engagement-range.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTimeZone } from "@easytree/domain";
import { describe, expect, it } from "vitest";
import {
  resolveEngagementBounds,
  resolveWorkingInterval,
  workingIntervalWithinBounds,
} from "../src/modules/planning";

const berlin = (() => {
  const z = createTimeZone("Europe/Berlin");
  if (!z.ok) throw new Error("Zone");
  return z.timeZone;
})();

/** Letzter Sonntag eines Monats — EU-Sommerzeitwechsel, jahresunabhaengig. */
function letzterSonntag(jahr: number, monat: number): string {
  const d = new Date(Date.UTC(jahr, monat, 0)); // letzter Tag des Monats (monat 1-basiert)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
const JAHR = new Date().getUTCFullYear() + 1;
const DST_BEGINN = letzterSonntag(JAHR, 3);
const DST_ENDE = letzterSonntag(JAHR, 10);
const JETZT = new Date(`${JAHR - 1}-12-01T10:00:00.000Z`);

describe("resolveEngagementBounds (EYT-120)", () => {
  it("8 lehnt einen Beginn vor dem serverautoritativen Jetzt ab", () => {
    const r = resolveEngagementBounds({ startAt: { date: `${JAHR - 1}-12-01`, time: "10:59" }, endAt: null }, berlin, JETZT);
    expect(r).toEqual({ ok: false, problem: { kind: "ENGAGEMENT_START_IN_PAST" } });
  });
  it("9 akzeptiert denselben Tag ab jetzt (Gleichheit) und spaeter", () => {
    const gleich = resolveEngagementBounds({ startAt: { date: `${JAHR - 1}-12-01`, time: "11:00" }, endAt: null }, berlin, JETZT);
    expect(gleich.ok).toBe(true);
    const spaeter = resolveEngagementBounds({ startAt: { date: `${JAHR - 1}-12-01`, time: "11:01" }, endAt: null }, berlin, JETZT);
    expect(spaeter.ok).toBe(true);
  });
  it("10 nicht existente lokale Startzeit (Sommerzeitbeginn 02:30) faellt geschlossen", () => {
    const r = resolveEngagementBounds({ startAt: { date: DST_BEGINN, time: "02:30" }, endAt: null }, berlin, JETZT);
    expect(r).toEqual({ ok: false, problem: { kind: "LOCAL_TIME_NONEXISTENT", feld: "startAt" } });
  });
  it("11 mehrdeutige lokale Start-/Endzeit (Sommerzeitende 02:30) faellt geschlossen", () => {
    expect(resolveEngagementBounds({ startAt: { date: DST_ENDE, time: "02:30" }, endAt: null }, berlin, JETZT))
      .toEqual({ ok: false, problem: { kind: "LOCAL_TIME_AMBIGUOUS", feld: "startAt" } });
    expect(resolveEngagementBounds({ startAt: { date: DST_ENDE, time: "01:00" }, endAt: { date: DST_ENDE, time: "02:30" } }, berlin, JETZT))
      .toEqual({ ok: false, problem: { kind: "LOCAL_TIME_AMBIGUOUS", feld: "endAt" } });
  });
  it("bekanntes Ende nach Beginn — auch nach der Aufloesung als Instants", () => {
    const r = resolveEngagementBounds({ startAt: { date: `${JAHR}-01-06`, time: "07:00" }, endAt: { date: `${JAHR}-01-06`, time: "07:00" } }, berlin, JETZT);
    expect(r).toEqual({ ok: false, problem: { kind: "ENGAGEMENT_END_NOT_AFTER_START" } });
  });
});

describe("Tagesarbeitszeit innerhalb der Einsatzgrenzen (D-009)", () => {
  const grenzen = { startsAtUtc: new Date(`${JAHR}-01-06T09:00:00.000Z`), endsAtUtc: new Date(`${JAHR}-01-08T14:00:00.000Z`) }; // 10:00–15:00 Berlin
  const intervall = (tag: string, from: string, to: string) => {
    const r = resolveWorkingInterval(tag, { from, to }, berlin);
    if (!r.ok) throw new Error(r.problem.kind);
    return r.interval;
  };
  it("13 Arbeitszeit vor dem Einsatzbeginn wird abgelehnt", () => {
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-06`, "08:00", "18:00"), grenzen)).toBe(false);
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-06`, "10:00", "18:00"), grenzen)).toBe(true);
  });
  it("14 Arbeitszeit nach dem bekannten Ende wird abgelehnt", () => {
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-08`, "08:00", "18:00"), grenzen)).toBe(false);
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-08`, "08:00", "15:00"), grenzen)).toBe(true);
  });
  it("15 ohne Ende gibt es keine kuenstliche Endgrenze, die Startgrenze gilt weiter", () => {
    const ohneEnde = { startsAtUtc: grenzen.startsAtUtc, endsAtUtc: null };
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-12-31`, "08:00", "23:59"), ohneEnde)).toBe(true);
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-06`, "09:00", "18:00"), ohneEnde)).toBe(false);
  });
  it("12 die Instants entstehen aus der Wanduhrzeit je Tag — ueber die Sommerzeitgrenze hinweg keine +24h-Arithmetik", () => {
    const vor = intervall(DST_BEGINN.replace(/\d{2}$/, (t) => String(Number(t) - 1).padStart(2, "0")), "08:00", "18:00");
    const nach = intervall(DST_BEGINN, "08:00", "18:00");
    expect(nach.start.getTime() - vor.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
  it("16 kein stilles Clipping: das Modul exportiert keine Kuerzungs-/Klemmfunktion (Namensheuristik ueber alle Exportformen)", () => {
    const quelle = readFileSync(join(process.cwd(), "src/modules/planning/domain/engagement-range.ts"), "utf8");
    const exporte = [...quelle.matchAll(/export (?:function|const|let|class) ([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(exporte.length).toBeGreaterThanOrEqual(4);
    expect(exporte.some((name) => /clip|clamp|kuerz|trim|adjust/i.test(name ?? ""))).toBe(false);
  });
});
```

Run: `pnpm --filter @easytree/api exec vitest run test/planning-engagement-range.test.ts`
Expected: `Test Files 1 failed` — Exporte fehlen im Barrel.

**Step 2: Domainmodul**

```ts
// apps/api/src/modules/planning/domain/engagement-range.ts
/**
 * Einsatzgrenzen und Tagesarbeitszeit als reine Regeln (EYT-120, D-003/D-009).
 *
 * Alles hier ist frei von Datenbank und Uhr: `now` kommt herein, die Zone kommt herein.
 * Lokale Wanduhrzeiten loest `utcInstantOfLocalWallTime` fail-closed auf — nicht
 * existente und mehrdeutige Sommerzeit-Zeiten werden BENANNT, nie geraten. Es gibt hier
 * keine Funktion, die eine Arbeitszeit an eine Grenze anpasst: Clipping ist verboten.
 */
import { utcInstantOfLocalWallTime, type IanaTimeZone } from "@easytree/domain";

export interface LocalDateTimeInput {
  readonly date: string; // JJJJ-MM-TT, vertraglich geprueft
  readonly time: string; // HH:MM, vertraglich geprueft
}

export interface EngagementBounds {
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date | null;
}

export type EngagementRangeProblem =
  | { readonly kind: "LOCAL_TIME_NONEXISTENT"; readonly feld: string }
  | { readonly kind: "LOCAL_TIME_AMBIGUOUS"; readonly feld: string }
  | { readonly kind: "ENGAGEMENT_START_IN_PAST" }
  | { readonly kind: "ENGAGEMENT_END_NOT_AFTER_START" };

type Result<T> = { readonly ok: true } & T | { readonly ok: false; readonly problem: EngagementRangeProblem };

function wallTimeParts(value: LocalDateTimeInput): { date: { year: number; month: number; day: number }; hour: number; minute: number } {
  const [y, m, d] = value.date.split("-").map(Number);
  const [h, min] = value.time.split(":").map(Number);
  if ([y, m, d, h, min].some((n) => n === undefined || Number.isNaN(n))) {
    throw new Error("EYT-120: unvertragliche lokale Zeit erreichte die Domain.");
  }
  return { date: { year: y as number, month: m as number, day: d as number }, hour: h as number, minute: min as number };
}

/** Wanduhrzeit -> Instant, mit benanntem Feld im Fehlerfall. */
export function resolveLocalDateTime(
  value: LocalDateTimeInput,
  zone: IanaTimeZone,
  feld: string,
): Result<{ readonly instant: Date }> {
  const r = utcInstantOfLocalWallTime(wallTimeParts(value), zone);
  if (!r.ok) {
    return { ok: false, problem: { kind: r.error === "AMBIGUOUS_LOCAL_TIME" ? "LOCAL_TIME_AMBIGUOUS" : "LOCAL_TIME_NONEXISTENT", feld } };
  }
  return { ok: true, instant: r.instant };
}

/**
 * Einsatzgrenzen aufloesen. Reihenfolge: erst die Aufloesbarkeit BEIDER Zeiten (sonst ist
 * "vor jetzt" keine sinnvolle Aussage), dann Vergangenheit (Gleichheit passt), dann Ordnung.
 */
export function resolveEngagementBounds(
  input: { readonly startAt: LocalDateTimeInput; readonly endAt: LocalDateTimeInput | null },
  zone: IanaTimeZone,
  now: Date,
): Result<{ readonly bounds: EngagementBounds }> {
  const start = resolveLocalDateTime(input.startAt, zone, "startAt");
  if (!start.ok) return start;
  let endsAtUtc: Date | null = null;
  if (input.endAt !== null) {
    const ende = resolveLocalDateTime(input.endAt, zone, "endAt");
    if (!ende.ok) return ende;
    endsAtUtc = ende.instant;
  }
  if (start.instant.getTime() < now.getTime()) {
    return { ok: false, problem: { kind: "ENGAGEMENT_START_IN_PAST" } };
  }
  if (endsAtUtc !== null && endsAtUtc.getTime() <= start.instant.getTime()) {
    return { ok: false, problem: { kind: "ENGAGEMENT_END_NOT_AFTER_START" } };
  }
  return { ok: true, bounds: { startsAtUtc: start.instant, endsAtUtc } };
}

export interface WorkingInterval {
  readonly start: Date;
  readonly end: Date;
}

/** Arbeitszeit eines Tages -> halb-offenes Instant-Intervall; DST fail-closed je Grenze. */
export function resolveWorkingInterval(
  localDate: string,
  workingTime: { readonly from: string; readonly to: string },
  zone: IanaTimeZone,
): Result<{ readonly interval: WorkingInterval }> {
  const von = resolveLocalDateTime({ date: localDate, time: workingTime.from }, zone, `days[${localDate}].workingTime.from`);
  if (!von.ok) return von;
  const bis = resolveLocalDateTime({ date: localDate, time: workingTime.to }, zone, `days[${localDate}].workingTime.to`);
  if (!bis.ok) return bis;
  return { ok: true, interval: { start: von.instant, end: bis.instant } };
}

/** D-009: vollstaendig innerhalb [Beginn, Ende]; offenes Ende hat keine Obergrenze. */
export function workingIntervalWithinBounds(interval: WorkingInterval, bounds: EngagementBounds): boolean {
  if (interval.start.getTime() < bounds.startsAtUtc.getTime()) return false;
  if (bounds.endsAtUtc !== null && interval.end.getTime() > bounds.endsAtUtc.getTime()) return false;
  return true;
}
```

Barrel (`index.ts`): `export { resolveEngagementBounds, resolveLocalDateTime, resolveWorkingInterval, workingIntervalWithinBounds } from "./domain/engagement-range"; export type { EngagementBounds, EngagementRangeProblem, LocalDateTimeInput, WorkingInterval } from "./domain/engagement-range";`


**Step 3: Run — grün**

Run: `pnpm --filter @easytree/domain build && pnpm --filter @easytree/api exec vitest run test/planning-engagement-range.test.ts test/domain-invariant-coverage.test.ts test/no-local-time-construction.test.ts test/architecture.test.ts`
Expected: alle grün, Dateizahl = 4 (der Filter `test/domain-invariants` ohne Dateiname trifft
`domain-invariant-coverage.test.ts` NICHT — Substring-Falle). Fall 16 scannt die Quelldatei
über `fs.readFileSync` + Regex auf alle Exportformen, damit `module-public-api-only` grün bleibt.

**Step 4: Commit**

```bash
git add apps/api/src/modules/planning/domain/engagement-range.ts apps/api/src/modules/planning/index.ts apps/api/test/planning-engagement-range.test.ts
git diff --cached --name-only
git commit -m "feat(planning): EYT-120 Einsatzgrenzen und Tagesarbeitszeit als reine Domainregeln"
```

---

### Task 5: Port + Repository `createEngagement` (Integrationssuite, Fälle 17–22)

**Files:**
- Modify: `apps/api/src/modules/planning/application/planning-writes.port.ts` (Input/Result/Problem-Kinds, Methode im `PlanningWrites`-Interface)
- Modify: `apps/api/src/modules/planning/infrastructure/planning-write.repository.ts` (Helfer extrahieren, `createEngagement`, `fehlerNach: "engagement-day"`)
- Modify: alle `PlanningWrites`-Stubs: `apps/api/test/planning-worksite-day.http.test.ts`, `apps/api/test/planning-window-single-snapshot.test.ts`, `apps/api/test/planning-gateway-parity.test.ts`, `apps/api/test/planning-publish.http.test.ts` (`createEngagement: () => Promise.reject(new Error("… nicht abgedeckt"))`)
- Create: `apps/api/test/planning-engagement.integration.test.ts` (Gate-Präfix `planning-engagement`, Ticket `EYT-120`)
- Modify: `apps/api/src/modules/planning/index.ts` (Typexporte)

**Step 1: Port**

In `planning-writes.port.ts`:

```ts
export interface CreateEngagementDayInput {
  readonly localDate: string;
  /** Effektive Arbeitszeit — die HTTP-Naht hat `defaults` bereits eingesetzt. */
  readonly workingTime: { readonly from: string; readonly to: string };
}

export interface CreateEngagementInput {
  readonly worksiteId: string;
  readonly startAt: { readonly date: string; readonly time: string };
  readonly endAt: { readonly date: string; readonly time: string } | null;
  /** Nur bei offenem Ende gesetzt; wird NICHT persistiert. */
  readonly planningHorizon: string | null;
  readonly days: readonly CreateEngagementDayInput[];
  readonly team: readonly string[];
  readonly idempotencyKey: string;
}

export interface CreatedEngagementDayRow extends CreatedWorksiteDayRow {
  readonly weekKey: string;
}

export interface CreatedEngagementRow {
  readonly engagementId: string;
  readonly worksiteId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date | null;
  readonly days: readonly CreatedEngagementDayRow[];
}

export type CreateEngagementResult =
  | { readonly ok: true; readonly engagement: CreatedEngagementRow; readonly replayed: boolean }
  | { readonly ok: false; readonly problem: PlanningWriteProblem };
```

`PlanningWriteProblem` erweitern:

```ts
  /** EYT-120: Beginn liegt vor dem serverautoritativen Jetzt. */
  | { readonly kind: "ENGAGEMENT_START_IN_PAST" }
  | { readonly kind: "ENGAGEMENT_END_NOT_AFTER_START" }
  | { readonly kind: "LOCAL_TIME_NONEXISTENT"; readonly feld: string }
  | { readonly kind: "LOCAL_TIME_AMBIGUOUS"; readonly feld: string }
  | { readonly kind: "WORKING_TIME_OUTSIDE_ENGAGEMENT"; readonly localDate: string }
  /** Der Tag gehoert bereits einem (anderen) Einsatz — D-008. */
  | { readonly kind: "WORKSITE_DAY_CLAIMED"; readonly localDate: string }
  /** Task-Gruppe E: Einzeltag ohne / mit mehreren abdeckenden Einsaetzen. */
  | { readonly kind: "ENGAGEMENT_REQUIRED" }
  | { readonly kind: "ENGAGEMENT_AMBIGUOUS" }
```

Im Interface `PlanningWrites`: `createEngagement(input: CreateEngagementInput): Promise<CreateEngagementResult>;`

**Step 2: RED — Integrationssuite anlegen (Kern der Fälle 17–22)**

Datei nach dem Gerüst von `planning-write.integration.test.ts` (Imports, `runnerAuf`,
`neueAdminVerbindung`, `neueVerbindung`, `beobachte`, `verwalte`, `dbIt`, `FailClosedGate("planning-engagement", MODE, "EYT-120")`,
`beforeAll` mit `probeDatabase` + App-Rollen-Verbindung, `afterAll` mit `gate.reportLine()`).
Eigene Wochen: Suite wählt ein **freies Jahr ≥ 2100** wie der EYT-158-Test (`generate_series`)
und arbeitet in dessen ISO-Wochen 02–04 (Memory [[planning-fixtures-collide-with-real-invariants]]).
Aufräumen (`raeumeEinsatz`): Assignments → Konfigurationen → `worksite_days` → `engagements`
→ `plan_versions` (unveröffentlicht) → `idempotency_records` (ORG_ALPHA) → `audit_events`
(`planning.engagement_created`).

```ts
function repo(client: Client, fehlerNach: "engagement-day" | null = null): PlanningWriteRepository {
  return new PlanningWriteRepository(runnerAuf(client), USER_A, wochenschluessel, idempotenzSpeicher, fehlerNach);
}

function befehl(ueberschreibungen: Partial<CreateEngagementInput> = {}): CreateEngagementInput {
  return {
    worksiteId: WORKSITE_ALPHA,
    startAt: { date: TAG[0], time: "07:00" },
    endAt: { date: TAG[4], time: "16:00" },
    planningHorizon: null,
    days: TAG.map((localDate) => ({ localDate, workingTime: { from: "08:00", to: "16:00" } })),
    team: [EMPLOYEE_ALPHA, EMPLOYEE_ALPHA_2],
    idempotencyKey: crypto.randomUUID(),
    ...ueberschreibungen,
  };
}

describe("Einsatz + Tage atomar (EYT-120 Inkrement 1)", () => {
  dbIt("17/18 Einsatz persistiert; JEDER erzeugte Tag referenziert ihn; Konfiguration je Tag; Team je Tag", async () => {
    const client = await neueVerbindung();
    const r = await repo(client).createEngagement(befehl());
    if (!r.ok) throw new Error(`abgelehnt: ${r.problem.kind}`);
    const einsatz = await beobachte<{ n: string }>("select count(*)::text as n from public.engagements where id = $1 and worksite_id = $2", [r.engagement.engagementId, WORKSITE_ALPHA]);
    expect(einsatz[0]?.n).toBe("1");
    const tage = await beobachte<{ local_date: string; engagement_id: string }>(
      "select local_date::text as local_date, engagement_id from public.worksite_days where engagement_id = $1 order by local_date", [r.engagement.engagementId]);
    expect(tage.map((t) => t.local_date)).toEqual(TAG);
    expect(new Set(tage.map((t) => t.engagement_id))).toEqual(new Set([r.engagement.engagementId]));
    const konfigs = await beobachte<{ n: string }>(
      "select count(*)::text as n from public.worksite_day_configurations c join public.worksite_days d on d.id = c.worksite_day_id where d.engagement_id = $1", [r.engagement.engagementId]);
    expect(konfigs[0]?.n).toBe(String(TAG.length));
    const zuweisungen = await beobachte<{ n: string }>(
      "select count(*)::text as n from public.assignments a join public.worksite_day_configurations c on c.id = a.worksite_day_configuration_id join public.worksite_days d on d.id = c.worksite_day_id where d.engagement_id = $1", [r.engagement.engagementId]);
    expect(zuweisungen[0]?.n).toBe(String(TAG.length * 2));
    expect(r.engagement.days.map((d) => d.localDate)).toEqual(TAG);
  });

  dbIt("19 Tenant-/Baustellenfremde Referenz scheitert strukturell (23503), nicht nur in der Anwendung", async () => {
    const client = await neueVerbindung();
    const r = await repo(client).createEngagement(befehl({ days: [{ localDate: TAG[0], workingTime: { from: "08:00", to: "16:00" } }] }));
    if (!r.ok) throw new Error(r.problem.kind);
    const fremd = await verwalte<{ id: string }>("select id from public.worksites where org_id = $1 and id <> $2 limit 1", [ORG_ALPHA, WORKSITE_ALPHA]);
    await expect(
      verwalte("insert into public.worksite_days (org_id, worksite_id, local_date, engagement_id) values ($1, $2, $3::date, $4)", [ORG_ALPHA, fremd[0]?.id, TAG[1], r.engagement.engagementId]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  dbIt("20/21 zweiter Einsatz derselben Baustelle am selben Tag verliert ATOMAR — null Zeilen, kein Audit, kein Idempotenzeintrag", async () => {
    const client = await neueVerbindung();
    const erster = await repo(client).createEngagement(befehl({ days: [{ localDate: TAG[2], workingTime: { from: "08:00", to: "16:00" } }] }));
    if (!erster.ok) throw new Error(erster.problem.kind);
    const vorher = await zaehleAlles();
    const schluessel = crypto.randomUUID();
    const zweiter = await repo(client).createEngagement(befehl({ idempotencyKey: schluessel, days: [TAG[1], TAG[2]].map((localDate) => ({ localDate, workingTime: { from: "08:00", to: "16:00" } })) }));
    expect(zweiter).toEqual({ ok: false, problem: { kind: "WORKSITE_DAY_CLAIMED", localDate: TAG[2] } });
    expect(await zaehleAlles()).toEqual(vorher); // engagements, worksite_days, configurations, assignments, audit_events, idempotency_records
    const tag1 = await beobachte<{ n: string }>("select count(*)::text as n from public.worksite_days where worksite_id = $1 and local_date = $2::date", [WORKSITE_ALPHA, TAG[1]]);
    expect(tag1[0]?.n).toBe("0");
    const idem = await beobachte<{ n: string }>("select count(*)::text as n from public.idempotency_records where idempotency_key = $1", [schluessel]);
    expect(idem[0]?.n).toBe("0");
  });

  dbIt("22 Fehler an Tag N laesst NICHTS zurueck (fehlerNach = engagement-day)", async () => {
    const client = await neueVerbindung();
    const vorher = await zaehleAlles();
    await expect(repo(client, "engagement-day").createEngagement(befehl())).rejects.toThrow(/engagement-day/);
    expect(await zaehleAlles()).toEqual(vorher);
  });
});
```

`zaehleAlles()` liefert `{ engagements, worksiteDays, configurations, assignments, audit, idempotency }`
als Strings aus `count(*)` je Tabelle für ORG_ALPHA.

Run: `EASYTREE_TENANT_TESTS=required EASYTREE_TEST_DB_URL=… EASYTREE_TEST_APP_DB_URL=… pnpm --filter @easytree/api exec vitest run test/planning-engagement.integration.test.ts`
Expected: rot — `createEngagement is not a function` — **und** die Gate-Zeile
`[planning-engagement] mode=required executed=4 passed=0 skipped=0`.

**Step 3: Helfer aus `planWorksiteDay` extrahieren (Verhalten unverändert)**

In `planning-write.repository.ts` vier private Methoden, die `planWorksiteDay` (Zeilen 887–1025)
fortan aufruft:

```ts
  /** Klasse (2): Wochenentwurf erwerben/anlegen; Vorgaenger nur fuer den INSERT-Gewinner. */
  private async erwirbWochenentwurf(tx: TenantQuery, orgId: string, weekKey: string): Promise<{ draftId: string; predecessorId: string | undefined }> {
    const draft = await tx.query<IdRow>("select app.lock_week_draft($1) as id", [weekKey]);
    const draftId = draft.rows[0]?.id;
    if (draftId === undefined) throw new Error("EYT-152: Wochenentwurf lieferte keine Id.");
    const selbstAngelegt = await tx.query<IdRow>(
      `select d.id from public.plan_versions d where d.id = $1 and d.org_id = $2 and d.xmin = pg_current_xact_id()::xid`,
      [draftId, orgId],
    );
    const predecessorId = selbstAngelegt.rows[0] === undefined ? undefined : await this.zuletztVeroeffentlichte(tx, orgId, weekKey);
    if (predecessorId !== undefined) await this.kopiereTageskonfigurationen(tx, draftId, predecessorId, orgId);
    return { draftId, predecessorId };
  }

  /** Klasse (4): Konfiguration im Entwurf; `undefined` = existiert dort schon. */
  private async legeTageskonfigurationAn(tx: TenantQuery, orgId: string, worksiteDayId: string, draftId: string): Promise<WorksiteDayConfigurationRow | undefined> {
    const r = await tx.query<WorksiteDayConfigurationRow>(
      `insert into public.worksite_day_configurations (org_id, worksite_day_id, plan_version_id)
       values ($1, $2, $3) on conflict (plan_version_id, worksite_day_id) do nothing returning id, lock_version`,
      [orgId, worksiteDayId, draftId],
    );
    return r.rows[0];
  }

  /** Klasse (5): Personensperren in globaler Reihenfolge. */
  private async sperreMitarbeitende(tx: TenantQuery, employeeIds: Iterable<string>): Promise<void> {
    for (const employeeId of [...new Set(employeeIds)].sort()) {
      await tx.query("select app.lock_employee_planning($1)", [employeeId]);
    }
  }

  /** Klasse (6): Ueberlappung pruefen und EINE Zuweisung einfuegen. */
  private async plantTeammitglied(tx: TenantQuery, draftId: string, configurationId: string, worksiteId: string, member: { employeeId: string; startsAtUtc: Date; endsAtUtc: Date }): Promise<WorksiteDayTeamMemberRow> {
    // Rumpf = Zeilen 978–1024 von planWorksiteDay (Ueberlappungsabfrage + Insert), unveraendert.
  }
```

Regression sofort: `… vitest run test/planning-write.integration.test.ts` — Gate-Zeile
`[planning-write] mode=required executed=N passed=N skipped=0` mit demselben N wie vor dem
Umbau (N vorher notieren!).

**Step 4: `createEngagement`**

```ts
const CREATE_ENGAGEMENT_OPERATION = "planning.create_engagement";

function engagementFingerprintOf(input: CreateEngagementInput): string {
  return [
    input.worksiteId,
    `${input.startAt.date}T${input.startAt.time}`,
    input.endAt === null ? "open" : `${input.endAt.date}T${input.endAt.time}`,
    input.planningHorizon ?? "null",
    ...[...input.days].sort((a, b) => a.localDate.localeCompare(b.localDate, "en")).map((d) => `${d.localDate}:${d.workingTime.from}-${d.workingTime.to}`),
    ...[...input.team].sort(),
  ].join("|");
}

class EngagementRejectedError extends Error {
  constructor(readonly problem: PlanningWriteProblem) { super(`EYT-120: ${problem.kind}`); }
}

  async createEngagement(input: CreateEngagementInput): Promise<CreateEngagementResult> {
    try {
      return await this.runner.run({ userId: this.subjectUserId }, async (tx) => {
        const fingerabdruck = engagementFingerprintOf(input);
        // (1) Idempotenz-Command-Lock, Replay vor jeder Beobachtung.
        await this.idempotenz.lock(tx, CREATE_ENGAGEMENT_OPERATION, input.idempotencyKey);
        const bekannt = await this.idempotenz.find(tx, CREATE_ENGAGEMENT_OPERATION, input.idempotencyKey);
        if (bekannt !== null) {
          if (bekannt.requestFingerprint !== fingerabdruck) return { ok: false as const, problem: { kind: "IDEMPOTENCY_KEY_REUSED" as const } };
          const payload = await this.idempotenz.readResultPayload(tx, CREATE_ENGAGEMENT_OPERATION, input.idempotencyKey);
          if (payload === null) throw new Error("EYT-120: Idempotenzschluessel ohne Replay-Ergebnis.");
          return { ok: true as const, engagement: replayEngagement(payload), replayed: true };
        }

        // Organisation und Zone (genau eine aktive Mitgliedschaft).
        const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
        if (orgs.rows.length === 0) return { ok: false as const, problem: { kind: "NO_ORGANISATION" as const } };
        if (orgs.rows.length > 1) return { ok: false as const, problem: { kind: "AMBIGUOUS_ORGANISATION" as const } };
        const org = orgs.rows[0]!;
        const zone = createTimeZone(org.time_zone);
        if (!zone.ok) throw new Error(`EYT-120: unbekannte Zeitzone "${org.time_zone}" in organizations.`);

        // Serverautoritatives Jetzt aus der Datenbank, nicht aus der App-Uhr.
        const jetzt = (await tx.query<{ now: Date }>("select now() as now")).rows[0]!.now;
        const grenzen = resolveEngagementBounds({ startAt: input.startAt, endAt: input.endAt }, zone.timeZone, jetzt);
        if (!grenzen.ok) return { ok: false as const, problem: grenzen.problem };

        // Tage: sortiert, Arbeitszeit aufgeloest, innerhalb der Grenzen (D-009, kein Clipping).
        const tage = [...input.days].sort((a, b) => a.localDate.localeCompare(b.localDate, "en"));
        const intervalle = new Map<string, WorkingInterval>();
        for (const tag of tage) {
          const iv = resolveWorkingInterval(tag.localDate, tag.workingTime, zone.timeZone);
          if (!iv.ok) return { ok: false as const, problem: iv.problem };
          if (!workingIntervalWithinBounds(iv.interval, grenzen.bounds)) {
            return { ok: false as const, problem: { kind: "WORKING_TIME_OUTSIDE_ENGAGEMENT" as const, localDate: tag.localDate } };
          }
          intervalle.set(tag.localDate, iv.interval);
        }

        // Auswaehlbarkeit (Baustelle, Personen) — nur Lesezugriffe, vor jeder Sperre.
        const worksite = await tx.query<ActiveRow>("select active from public.worksites where id = $1", [input.worksiteId]);
        if (worksite.rows[0] === undefined || !worksite.rows[0].active) return { ok: false as const, problem: { kind: "RESOURCE_NOT_SELECTABLE" as const, feld: "worksiteId" as const } };
        for (const employeeId of [...input.team].sort()) {
          const employee = await tx.query<ActiveRow>("select active from public.employees where id = $1", [employeeId]);
          if (employee.rows[0] === undefined || !employee.rows[0].active) return { ok: false as const, problem: { kind: "RESOURCE_NOT_SELECTABLE" as const, feld: "employeeId" as const } };
        }

        // (2) Wochenentwuerfe in DETERMINISTISCHER Reihenfolge (sortierte Wochenschluessel).
        const wocheVon = (localDate: string) => planningWeekKey(isoWeekOfLocalDate(localDateParts(localDate)));
        const wochen = [...new Set(tage.map((t) => wocheVon(t.localDate)))].sort();
        const entwuerfe = new Map<string, { draftId: string; predecessorId: string | undefined }>();
        for (const weekKey of wochen) entwuerfe.set(weekKey, await this.erwirbWochenentwurf(tx, org.id, weekKey));

        // Einsatz-Identitaet.
        const einsatz = await tx.query<IdRow>(
          `insert into public.engagements (org_id, worksite_id, starts_at_utc, ends_at_utc) values ($1, $2, $3, $4) returning id`,
          [org.id, input.worksiteId, grenzen.bounds.startsAtUtc, grenzen.bounds.endsAtUtc],
        );
        const engagementId = einsatz.rows[0]?.id;
        if (engagementId === undefined) throw new Error("EYT-120: Einsatz wurde nicht angelegt.");

        // (3) Tagesidentitaeten — NEU oder Ablehnung. Kein Adoptieren einer fremden Identitaet (D-008).
        const identitaeten = new Map<string, string>();
        for (const tag of tage) {
          const r = await tx.query<WorksiteDayRow>(
            `insert into public.worksite_days (org_id, worksite_id, local_date, engagement_id)
             values ($1, $2, $3::date, $4) on conflict (org_id, worksite_id, local_date) do nothing returning id`,
            [org.id, input.worksiteId, tag.localDate, engagementId],
          );
          const id = r.rows[0]?.id;
          if (id === undefined) throw new EngagementRejectedError({ kind: "WORKSITE_DAY_CLAIMED", localDate: tag.localDate });
          identitaeten.set(tag.localDate, id);
          this.vielleichtScheitern("engagement-day"); // Testhaken (Fall 22): nach dem ERSTEN Tag
        }

        // (4) Konfigurationen.
        const konfigurationen = new Map<string, WorksiteDayConfigurationRow>();
        for (const tag of tage) {
          const { draftId } = entwuerfe.get(wocheVon(tag.localDate))!;
          const config = await this.legeTageskonfigurationAn(tx, org.id, identitaeten.get(tag.localDate)!, draftId);
          if (config === undefined) throw new EngagementRejectedError({ kind: "DUPLICATE_WORKSITE_DAY" });
          konfigurationen.set(tag.localDate, config);
        }

        // (5) Personensperren: Team + geerbte Personen aller Vorgaenger, EINMAL, sortiert.
        const geerbt: string[] = [];
        for (const { predecessorId } of entwuerfe.values()) {
          if (predecessorId === undefined) continue;
          const rows = await tx.query<{ employee_id: string }>("select distinct employee_id from public.assignments where plan_version_id = $1 and org_id = $2", [predecessorId, org.id]);
          geerbt.push(...rows.rows.map((r) => r.employee_id));
        }
        await this.sperreMitarbeitende(tx, [...geerbt, ...input.team]);
        for (const [weekKey, { draftId, predecessorId }] of [...entwuerfe.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
          if (predecessorId !== undefined) await this.kopiereZuweisungen(tx, draftId, predecessorId, org.id);
          void weekKey;
        }

        // (6) Einplanungen je Tag, je Person (sortiert).
        const days: CreatedEngagementDayRow[] = [];
        for (const tag of tage) {
          const weekKey = wocheVon(tag.localDate);
          const { draftId } = entwuerfe.get(weekKey)!;
          const config = konfigurationen.get(tag.localDate)!;
          const iv = intervalle.get(tag.localDate)!;
          const team: WorksiteDayTeamMemberRow[] = [];
          for (const employeeId of [...input.team].sort()) {
            team.push(await this.plantTeammitglied(tx, draftId, config.id, input.worksiteId, { employeeId, startsAtUtc: iv.start, endsAtUtc: iv.end }));
          }
          days.push({ weekKey, worksiteDayId: identitaeten.get(tag.localDate)!, configurationId: config.id, worksiteId: input.worksiteId, localDate: tag.localDate, lockVersion: config.lock_version, team });
        }

        const engagement: CreatedEngagementRow = { engagementId, worksiteId: input.worksiteId, startsAtUtc: grenzen.bounds.startsAtUtc, endsAtUtc: grenzen.bounds.endsAtUtc, days };

        await tx.query(
          `insert into public.audit_events (org_id, actor_user_id, event_type, subject_type, subject_id, context)
           values ($1, app.current_user_id(), 'planning.engagement_created', 'engagement', $2, $3::jsonb)`,
          [org.id, engagementId, JSON.stringify({ worksiteId: input.worksiteId, startsAtUtc: engagement.startsAtUtc.toISOString(), endsAtUtc: engagement.endsAtUtc?.toISOString() ?? null, weekKeys: wochen, worksiteDayIds: days.map((d) => d.worksiteDayId), configurationIds: days.map((d) => d.configurationId), assignmentIds: days.flatMap((d) => d.team.map((m) => m.assignmentId)) })],
        );
        await this.idempotenz.rememberWithResultPayload(tx, org.id, CREATE_ENGAGEMENT_OPERATION, input.idempotencyKey, engagementId, fingerabdruck, serialisiereEngagement(engagement));
        return { ok: true as const, engagement, replayed: false };
      });
    } catch (error) {
      if (error instanceof EngagementRejectedError) return { ok: false, problem: error.problem };
      throw error;
    }
  }
```

`plantTeammitglied` wirft bei Überlappung `WorksiteDayRejectedError({kind:"OVERLAPPING_ASSIGNMENT",…})`
— der `catch` von `createEngagement` muss **beide** Fehlerklassen in `{ ok:false }` übersetzen.
`serialisiereEngagement`/`replayEngagement` spiegeln `serialisiereWorksiteDay`/`replayWorksiteDay`
(Ids, ISO-Zeitstempel, Zahlen; `endsAtUtc: null` zulässig; jede Tageszeile mit `weekKey`).
`vielleichtScheitern(punkt)` ist der vorhandene `fehlerNach`-Testhaken (Zeile 1557, wirft `EYT-92: erzwungener Fehler nach …`); dessen Parameter-Union und die Konstruktor-Union um
`"engagement-day"` erweitern. `localDateParts` existiert (Zeile 230).
**Wichtig:** Das Konstruktor-Argument `fehlerNach` ist positional — die Suite oben übergibt
es als fünftes Argument.

**Step 5: Run — grün**

Run (Einzelaufrufe, in dieser Reihenfolge):
```bash
pnpm --filter @easytree/api exec vitest run test/planning-engagement.integration.test.ts 2>&1 | tee /tmp/pe.log
grep -F '[planning-engagement] mode=required' /tmp/pe.log
pnpm --filter @easytree/api exec vitest run test/planning-write.integration.test.ts 2>&1 | tee /tmp/pw.log
grep -F '[planning-write] mode=required' /tmp/pw.log
pnpm --filter @easytree/api exec vitest run test/planning-worksite-day.http.test.ts test/planning-gateway-parity.test.ts test/planning-window-single-snapshot.test.ts test/planning-publish.http.test.ts test/architecture.test.ts
```
Expected: `[planning-engagement] mode=required executed=4 passed=4 skipped=0`;
`[planning-write] … passed=N skipped=0` mit unverändertem N; Stub-Suiten + Architektur grün.

**Step 6: Commit**

```bash
git add apps/api/src/modules/planning/application/planning-writes.port.ts apps/api/src/modules/planning/infrastructure/planning-write.repository.ts apps/api/src/modules/planning/index.ts apps/api/test/planning-engagement.integration.test.ts apps/api/test/planning-worksite-day.http.test.ts apps/api/test/planning-window-single-snapshot.test.ts apps/api/test/planning-gateway-parity.test.ts apps/api/test/planning-publish.http.test.ts
git diff --cached --name-only
git commit -m "feat(planning): EYT-120 Einsatz + bestaetigte Tage atomar in einer Transaktion anlegen"
```

---

### Task 6: Idempotenz, Zeit/DST gegen echte DB, Multi-Week-Lockordnung (Fälle 23–28, 8–16 integriert)

**Files:**
- Modify: `apps/api/test/planning-engagement.integration.test.ts`

**Step 1: RED — Tests ergänzen** (jeder muss erst rot sein; wo die Implementierung aus Task 5
sie bereits erfüllt, gilt der Fall als *Ausführungsevidenz* und bekommt in Task 10 seine
Gegenmutation)

```ts
  dbIt("23 gleicher Schluessel + gleicher Payload = exaktes Replay: dieselben IDs, keine neuen Zeilen", async () => {
    const client = await neueVerbindung();
    const cmd = befehl();
    const erst = await repo(client).createEngagement(cmd);
    if (!erst.ok) throw new Error(erst.problem.kind);
    const vorher = await zaehleAlles();
    const replay = await repo(client).createEngagement({ ...cmd, days: [...cmd.days].reverse() }); // Reihenfolge ist kein Payloadunterschied
    expect(replay).toEqual({ ok: true, engagement: erst.engagement, replayed: true });
    expect(await zaehleAlles()).toEqual(vorher);
  });
  dbIt("24 gleicher Schluessel + anderer Payload = IDEMPOTENCY_KEY_REUSED ohne Teilwirkung", async () => {
    const client = await neueVerbindung();
    const cmd = befehl();
    const erst = await repo(client).createEngagement(cmd);
    if (!erst.ok) throw new Error(erst.problem.kind);
    const vorher = await zaehleAlles();
    const anders = await repo(client).createEngagement({ ...cmd, team: [EMPLOYEE_ALPHA] });
    expect(anders).toEqual({ ok: false, problem: { kind: "IDEMPOTENCY_KEY_REUSED" } });
    expect(await zaehleAlles()).toEqual(vorher);
  });
  dbIt("25 Replay erzeugt keinen zweiten Audit-Eintrag", async () => {
    const client = await neueVerbindung();
    const cmd = befehl();
    const erst = await repo(client).createEngagement(cmd);
    if (!erst.ok) throw new Error(erst.problem.kind);
    await repo(client).createEngagement(cmd);
    const audit = await beobachte<{ n: string }>("select count(*)::text as n from public.audit_events where event_type = 'planning.engagement_created' and subject_id = $1", [erst.engagement.engagementId]);
    expect(audit[0]?.n).toBe("1");
  });
  dbIt("26/27 Zeitraum ueber zwei ISO-Wochen: je Tag der Entwurf SEINER Woche", async () => {
    const client = await neueVerbindung();
    const r = await repo(client).createEngagement(befehl({ startAt: { date: TAG[3], time: "07:00" }, endAt: { date: TAG_W2[1], time: "16:00" }, days: [TAG[3], TAG[4], TAG_W2[0], TAG_W2[1]].map((localDate) => ({ localDate, workingTime: { from: "08:00", to: "16:00" } })) }));
    if (!r.ok) throw new Error(r.problem.kind);
    expect(new Set(r.engagement.days.map((d) => d.weekKey)).size).toBe(2);
    const zuordnung = await beobachte<{ local_date: string; week_key: string }>(
      `select d.local_date::text as local_date, pv.week_key from public.worksite_days d
         join public.worksite_day_configurations c on c.worksite_day_id = d.id
         join public.plan_versions pv on pv.id = c.plan_version_id
        where d.engagement_id = $1 order by d.local_date`, [r.engagement.engagementId]);
    for (const zeile of zuordnung) expect(zeile.week_key).toBe(wochenschluessel(new Date(`${zeile.local_date}T12:00:00Z`), "Europe/Berlin"));
  });
  dbIt("28a Wochenlocks werden SORTIERT erworben — unabhaengig von der Eingabereihenfolge", async () => {
    const client = await neueVerbindung();
    const gesehen: string[] = [];
    const runner = runnerMitBeobachter(client, (sql, params) => { if (sql.includes("app.lock_week_draft")) gesehen.push(String(params?.[0])); });
    const r = await new PlanningWriteRepository(runner, USER_A, wochenschluessel, idempotenzSpeicher).createEngagement(
      befehl({ startAt: { date: TAG[3], time: "07:00" }, endAt: { date: TAG_W2[1], time: "16:00" }, days: [TAG_W2[1], TAG[3]].map((localDate) => ({ localDate, workingTime: { from: "08:00", to: "16:00" } })) }));
    if (!r.ok) throw new Error(r.problem.kind);
    expect(gesehen).toEqual([...gesehen].sort());
    expect(gesehen).toHaveLength(2);
  });
  dbIt("28b zwei ueberlappende Zwei-Wochen-Commands (verschiedene Tage, verschiedene Personen) laufen synchronisiert ohne Deadlock durch", async () => {
    const a = await neueVerbindung(); const b = await neueVerbindung();
    const barrier = barrierFuerZwei();
    const [ra, rb] = await Promise.all([
      new PlanningWriteRepository(synchronisierteWorksiteDayRunner(a, barrier), USER_A, wochenschluessel, idempotenzSpeicher).createEngagement(befehl({ startAt: { date: TAG[3], time: "07:00" }, endAt: { date: TAG_W2[1], time: "16:00" }, days: [TAG[3], TAG_W2[0]].map((localDate) => ({ localDate, workingTime: { from: "08:00", to: "16:00" } })), team: [EMPLOYEE_ALPHA] })),
      new PlanningWriteRepository(synchronisierteWorksiteDayRunner(b, barrier), USER_A, wochenschluessel, idempotenzSpeicher).createEngagement(befehl({ startAt: { date: TAG[3], time: "07:00" }, endAt: { date: TAG_W2[1], time: "16:00" }, days: [TAG_W2[1], TAG[4]].map((localDate) => ({ localDate, workingTime: { from: "08:00", to: "16:00" } })), team: [EMPLOYEE_ALPHA_2] })),
    ]);
    expect(ra.ok && rb.ok).toBe(true);
  }, 30_000);
  dbIt("8–11 Zeitregeln gegen die echte Organisationszone (Europe/Berlin)", async () => {
    const client = await neueVerbindung();
    expect(await repo(client).createEngagement(befehl({ startAt: { date: "2020-01-06", time: "07:00" }, endAt: null, planningHorizon: "2020-01-10", days: [{ localDate: "2020-01-06", workingTime: { from: "08:00", to: "16:00" } }] }))).toEqual({ ok: false, problem: { kind: "ENGAGEMENT_START_IN_PAST" } });
    expect(await repo(client).createEngagement(befehl({ startAt: { date: DST_BEGINN, time: "02:30" }, endAt: null, planningHorizon: DST_BEGINN, days: [{ localDate: DST_BEGINN, workingTime: { from: "08:00", to: "16:00" } }] }))).toEqual({ ok: false, problem: { kind: "LOCAL_TIME_NONEXISTENT", feld: "startAt" } });
    expect(await repo(client).createEngagement(befehl({ startAt: { date: DST_ENDE, time: "02:30" }, endAt: null, planningHorizon: DST_ENDE, days: [{ localDate: DST_ENDE, workingTime: { from: "08:00", to: "16:00" } }] }))).toEqual({ ok: false, problem: { kind: "LOCAL_TIME_AMBIGUOUS", feld: "startAt" } });
  });
  dbIt("12 ueber den Sommerzeitbeginn hinweg entstehen die Instants aus der Wanduhrzeit je Tag (kein UTC+24h)", async () => {
    const client = await neueVerbindung();
    const vortag = tagVor(DST_BEGINN);
    const r = await repo(client).createEngagement(befehl({ startAt: { date: vortag, time: "07:00" }, endAt: { date: DST_BEGINN, time: "20:00" }, days: [vortag, DST_BEGINN].map((localDate) => ({ localDate, workingTime: { from: "08:00", to: "18:00" } })), team: [EMPLOYEE_ALPHA] }));
    if (!r.ok) throw new Error(r.problem.kind);
    const starts = r.engagement.days.map((d) => d.team[0]!.startsAtUtc.getTime());
    expect(starts[1]! - starts[0]!).toBe(23 * 3_600_000);
    const local = await beobachte<{ local_date: string }>("select local_date::text as local_date from public.worksite_days where engagement_id = $1 order by 1", [r.engagement.engagementId]);
    expect(local.map((l) => l.local_date)).toEqual([vortag, DST_BEGINN]);
  });
  dbIt("13–16 Arbeitszeit ausserhalb der Einsatzgrenzen wird benannt abgelehnt; nichts wird gekuerzt persistiert", async () => {
    const client = await neueVerbindung();
    const vorher = await zaehleAlles();
    expect(await repo(client).createEngagement(befehl({ startAt: { date: TAG[0], time: "10:00" }, days: [{ localDate: TAG[0], workingTime: { from: "08:00", to: "16:00" } }] }))).toEqual({ ok: false, problem: { kind: "WORKING_TIME_OUTSIDE_ENGAGEMENT", localDate: TAG[0] } });
    expect(await repo(client).createEngagement(befehl({ endAt: { date: TAG[4], time: "15:00" }, days: [{ localDate: TAG[4], workingTime: { from: "08:00", to: "16:00" } }] }))).toEqual({ ok: false, problem: { kind: "WORKING_TIME_OUTSIDE_ENGAGEMENT", localDate: TAG[4] } });
    expect(await repo(client).createEngagement(befehl({ startAt: { date: TAG[0], time: "09:00" }, endAt: { date: TAG[0], time: "15:00" }, days: [{ localDate: TAG[0], workingTime: { from: "08:00", to: "14:00" } }] }))).toEqual({ ok: false, problem: { kind: "WORKING_TIME_OUTSIDE_ENGAGEMENT", localDate: TAG[0] } });
    expect(await repo(client).createEngagement(befehl({ startAt: { date: TAG[0], time: "09:00" }, endAt: null, planningHorizon: TAG[4], days: [{ localDate: TAG[0], workingTime: { from: "08:00", to: "23:00" } }] }))).toEqual({ ok: false, problem: { kind: "WORKING_TIME_OUTSIDE_ENGAGEMENT", localDate: TAG[0] } });
    const offen = await repo(client).createEngagement(befehl({ startAt: { date: TAG[0], time: "07:00" }, endAt: null, planningHorizon: TAG[4], days: [{ localDate: TAG[4], workingTime: { from: "08:00", to: "23:00" } }] }));
    expect(offen.ok).toBe(true); // 15: keine kuenstliche Endgrenze
    expect((await zaehleAlles()).assignments).toBe(String(Number(vorher.assignments) + 2));
  });
```

`runnerMitBeobachter(client, cb)` wickelt `runnerAuf` wie `synchronisierteWorksiteDayRunner`, ruft
`cb(sql, params)` vor jedem Query. `tagVor` = ISO-Vortag (über `dayBefore` aus `@easytree/domain`).
`TAG`/`TAG_W2` = fünf Werktage der Woche W02 bzw. W03 des freien Jahres (`planningWeekDateRange`).

**Step 2: Run, Farben lesen, GRÜN herstellen**

Run: wie Task 5 Step 5. Expected: `[planning-engagement] mode=required executed=14 passed=14 skipped=0`.

**Step 3: Commit**

```bash
git add apps/api/test/planning-engagement.integration.test.ts
git commit -m "test(planning): EYT-120 Idempotenz, Zeitgrenzen, DST und Multi-Week-Lockordnung gegen PostgreSQL"
```

---

### Task 7: Tenant / Rechte (Fälle 29–32)

**Files:**
- Modify: `apps/api/test/planning-engagement.integration.test.ts`

**Step 1: RED — Tests**

```ts
  dbIt("29/30 fremde Baustelle / fremde Person: RESOURCE_NOT_SELECTABLE ohne Existenzleck, null Zeilen", async () => {
    const client = await neueVerbindung();
    const betaWorksite = await verwalte<{ id: string }>("select id from public.worksites where org_id = $1 limit 1", [ORG_BETA]);
    const betaEmployee = await verwalte<{ id: string }>("select id from public.employees where org_id = $1 limit 1", [ORG_BETA]);
    const vorher = await zaehleAlles();
    expect(await repo(client).createEngagement(befehl({ worksiteId: betaWorksite[0]!.id }))).toEqual({ ok: false, problem: { kind: "RESOURCE_NOT_SELECTABLE", feld: "worksiteId" } });
    expect(await repo(client).createEngagement(befehl({ team: [betaEmployee[0]!.id] }))).toEqual({ ok: false, problem: { kind: "RESOURCE_NOT_SELECTABLE", feld: "employeeId" } });
    expect(await zaehleAlles()).toEqual(vorher);
  });
  dbIt("31 ohne planning.write lehnt die DATENBANK ab (42501 an der ersten Sperre), null Zeilen", async () => {
    await mitGeliehenerMitgliedschaft(async () => { // USER_B als 'member' in ORG_ALPHA
      const client = await neueVerbindung();
      const vorher = await zaehleAlles();
      await expect(new PlanningWriteRepository(runnerAuf(client), USER_B, wochenschluessel, idempotenzSpeicher).createEngagement(befehl())).rejects.toMatchObject({ code: "42501" });
      expect(await zaehleAlles()).toEqual(vorher);
    });
  });
  dbIt("32 Rechte/RLS: authenticated hat auf engagements genau INSERT+SELECT; direkter Insert eines fremden Mandanten faellt an RLS", async () => {
    const rechte = await beobachte<{ p: string }>("select privilege_type as p from information_schema.role_table_grants where table_name = 'engagements' and grantee = 'authenticated' order by 1");
    expect(rechte.map((r) => r.p)).toEqual(["INSERT", "SELECT"]);
    const client = await neueVerbindung();
    await expect(runnerAuf(client).run({ userId: USER_A }, (tx) => tx.query("insert into public.engagements (org_id, worksite_id, starts_at_utc) values ($1, (select id from public.worksites where org_id = $1 limit 1), now() + interval '1 day')", [ORG_BETA]))).rejects.toMatchObject({ code: "42501" });
  });
```

`mitGeliehenerMitgliedschaft` aus `planning-write.integration.test.ts` kopieren (kein Import
zwischen Suiten). Hinweis Memory [[sqlstate-42501-is-ambiguous]]: Fall 31 misst **zusätzlich**
über `has_column_privilege('authenticated','public.engagements','org_id','INSERT') = true`,
dass das Spaltenrecht vorhanden ist — dann ist 42501 eindeutig die Policy.

**Step 2: Run — grün; Gate-Zeile `executed=17 passed=17 skipped=0`. Commit**

```bash
git add apps/api/test/planning-engagement.integration.test.ts
git commit -m "test(planning): EYT-120 Mandanten- und Rechtegrenzen des Einsatz-Commands"
```

---

### Task 8: HTTP-Naht `POST /planung/einsaetze`

**Files:**
- Modify: `apps/api/src/modules/planning/interface/http/planning.controller.ts` (Route nach dem Muster von `planWorksiteDay`, Zeilen 499–563; `problemFor` um die neuen Kinds)
- Modify: `apps/api/src/modules/planning/interface/http/planning-problem.filter.ts` (`BEKANNTE_TYPEN` um `ENGAGEMENT_PROBLEM_TYPE`)
- Create: `apps/api/test/planning-engagement.http.test.ts` (nach `planning-worksite-day.http.test.ts`)
- Modify: `apps/api/test/openapi-route-conformance.test.ts` (nichts eintragen — die Route ist implementiert; der Test wird grün, sobald Controller und Vertrag übereinstimmen)

**Step 1: RED — HTTP-Test**

Fälle (Stub-Writes wie im Vorbild): 401/403 über `zugang`; 400 ohne `Idempotency-Key`;
400 bei Vertragsverletzung (Schema); 201 mit vertragskonformem `EngagementDto`
(`EngagementDtoSchema.safeParse(body).success === true`); 409 mit `problem.type =
ENGAGEMENT_PROBLEM_TYPE.WORKSITE_DAY_CLAIMED` bei Stub-Problem `WORKSITE_DAY_CLAIMED`;
409 `ENGAGEMENT_START_IN_PAST`; 409 `LOCAL_TIME_NONEXISTENT`; 409 `WORKING_TIME_OUTSIDE_ENGAGEMENT`;
`RESOURCE_NOT_SELECTABLE` bleibt 400 wie bisher.

Run: `pnpm --filter @easytree/api exec vitest run test/planning-engagement.http.test.ts` → rot (404).

**Step 2: Route**

```ts
  @Post("einsaetze")
  @HttpCode(201)
  async createEngagement(@Req() request: Request, @Body() body: unknown, @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string): Promise<unknown> {
    const { subjectUserId: subject } = await this.zugang(request, "planning.write");
    const schluessel = IdempotencyKeySchema.safeParse(idempotencyKey);
    if (!schluessel.success) throw new BadRequestException({ type: PLANNING_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY, title: "Idempotenzschlüssel fehlt oder ist unbrauchbar", detail: `Der Header ${IDEMPOTENCY_HEADER} fehlt oder entspricht nicht dem Vertrag.` });
    const command = CreateEngagementCommandSchema.safeParse(body);
    if (!command.success) throw new BadRequestException({ type: PLANNING_ERROR_TYPE.INVALID_INTERVAL, title: "Einsatz unvollständig oder ungültig", detail: "Baustelle, Einsatzgrenzen, Horizont, Tage, Arbeitszeit oder Team entsprechen nicht dem Vertrag." });
    const result = await this.writesFor(subject).createEngagement({
      worksiteId: command.data.worksiteId,
      startAt: command.data.startAt,
      endAt: command.data.endAt,
      planningHorizon: command.data.planningHorizon,
      days: command.data.days.map((tag) => ({ localDate: tag.localDate, workingTime: tag.workingTime ?? command.data.defaults.workingTime })),
      team: command.data.team,
      idempotencyKey: schluessel.data,
    });
    if (!result.ok) throw problemFor(result.problem);
    const response = EngagementDtoSchema.safeParse({
      engagementId: result.engagement.engagementId,
      worksiteId: result.engagement.worksiteId,
      startsAtUtc: result.engagement.startsAtUtc.toISOString(),
      endsAtUtc: result.engagement.endsAtUtc?.toISOString() ?? null,
      days: result.engagement.days.map((d) => ({ weekKey: d.weekKey, worksiteDayId: d.worksiteDayId, configurationId: d.configurationId, worksiteId: d.worksiteId, localDate: d.localDate, lockVersion: d.lockVersion, team: d.team.map((m) => ({ assignmentId: m.assignmentId, employeeId: m.employeeId, interval: { startUtc: m.startsAtUtc.toISOString(), endUtc: m.endsAtUtc.toISOString() } })) })),
    });
    if (!response.success) throw new InternalServerErrorException("Antwort entspricht nicht dem Vertrag.");
    return response.data;
  }
```

`problemFor`: je neuer Kind eine `ConflictException` mit `type` aus `ENGAGEMENT_PROBLEM_TYPE`,
`title`/`detail` deutsch, ohne Hostnamen/IDs fremder Mandanten; `ENGAGEMENT_END_NOT_AFTER_START`
→ `BadRequestException` mit `PLANNING_ERROR_TYPE.INVALID_INTERVAL`.

**Step 3: Run — grün**

```bash
pnpm --filter @easytree/api exec vitest run test/planning-engagement.http.test.ts test/openapi-route-conformance.test.ts test/planning-problem.test.ts test/planning-gateway-parity.test.ts
```
Expected: alle grün; Route-Konformität meldet **keine** `undeclared`/`stale`-Operation.

**Step 4: Commit**

```bash
git add apps/api/src/modules/planning/interface/http/planning.controller.ts apps/api/src/modules/planning/interface/http/planning-problem.filter.ts apps/api/test/planning-engagement.http.test.ts
git commit -m "feat(planning): EYT-120 POST /planung/einsaetze mit benannten Problem-Types"
```

---

### Task 9: CI-Gate, Doku, Kompatibilitätsschuld

**Files:**
- Modify: `.github/workflows/ci.yml` — **außerhalb des Server-Scopes; Begründung: ohne eigenen `db-gates`-Schritt läuft die neue Pflichtsuite in CI nie (`not_run`, CLAUDE.md „a gate that has never failed is not_run")**. Neuer Schritt direkt nach „Planning write gate":

```yaml
      - name: Planning engagement gate (fail-closed, zwei Verbindungen, EYT-120)
        env:
          EASYTREE_TENANT_TESTS: required
          EASYTREE_TEST_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
          EASYTREE_TEST_APP_DB_URL: postgresql://easytree_app:ci-local-app-password@127.0.0.1:54322/postgres
        shell: bash
        run: |
          pnpm --filter @easytree/api exec vitest run test/planning-engagement.integration.test.ts 2>&1 | tee /tmp/planning-engagement.log
          bash scripts/assert-tenant-report.sh planning-engagement /tmp/planning-engagement.log
```
  Kein neuer Job, kein neuer Pflichtcheck (Ruleset bleibt unberührt; `scripts/verify-branch-protection.sh` unverändert).
- Create: `docs/architecture/einsatz-datenmodell-eyt-120.md` (≤ 80 Zeilen): Tabellen, FK,
  gestufte Pflicht, Lockordnung (Klassen 1–6 mit Zwei-Wochen-Beispiel), Idempotenzraum
  `planning.create_engagement`, Zeitvertrag, **Kompatibilitätsschuld**: (a) `POST /planung/baustellentage`
  = 0019-Vorläufer, Standalone bis Task-Gruppe E; (b) `operationId createAssignment` unter
  `/planung/einplanungen`; (c) `worksite_days.engagement_id` nullable bis `validate constraint`.
- Modify: `docs/runbooks/database-workflow.md` — eine Zeile in der Gate-Liste für `[planning-engagement]`.

Commit: `chore(ci): EYT-120 Einsatz-Gate in db-gates; Datenmodell und Kompatibilitaetsschuld dokumentiert`.

---

### Task-Gruppe E (nur nach D2): DB-Pflicht + Umbau des Einzeltag-Commands + Journeys

**Files:**
- Modify: `supabase/migrations/*_0020_engagements.sql` Block 6 einkommentieren (0020 ist ungemergt)
- Modify: `supabase/tests/0015_engagements.sql` (E7 von `skip` auf `throws_ok(…, '23514', …)`, plan-Zahl bleibt)
- Modify: `apps/api/src/modules/planning/infrastructure/planning-write.repository.ts` (`planWorksiteDay`: vor `erwirbWochenentwurf` den abdeckenden Einsatz auflösen)
- Modify: `apps/api/test/planning-write.integration.test.ts` (Fixture-Helfer `mitEinsatz(worksite, von, bis)` vor jedem `planWorksiteDay`-Fall, der einen NEUEN Tag anlegt; neue Fälle `ENGAGEMENT_REQUIRED`, `ENGAGEMENT_AMBIGUOUS`, `WORKING_TIME_OUTSIDE_ENGAGEMENT`, `WORKSITE_DAY_CLAIMED` für den Einzeltag)
- Modify: `packages/contracts/src/openapi/document.ts` (`planWorksiteDay`-Beschreibung: „…fuegt den Tag dem Einsatz hinzu, der ihn abdeckt…", 409-Liste um `ENGAGEMENT_REQUIRED`, `ENGAGEMENT_AMBIGUOUS`, `WORKING_TIME_OUTSIDE_ENGAGEMENT`, `WORKSITE_DAY_CLAIMED`), `v1.json` regenerieren
- Modify: `apps/web/e2e/read-through.spec.ts`, `apps/web/e2e/auth-journey/journey.pwtest.ts`, `apps/web/e2e/staging/journey.pwtest.ts` — **außerhalb des Server-Scopes; Begründung 0.4 Nr. 2**: vor dem UI-Schritt per `request.post('/api/v1/planung/einsaetze', …)` einen Einsatz anlegen, der den Journey-Tag abdeckt, mit einem **anderen** bestätigten Tag in der **Folgewoche** (damit die geöffnete Woche weiterhin genau eine Karte zeigt), `startAt = {date: journeyTag, time: "00:00"}`, `endAt: null`, `planningHorizon = journeyTag + 7`.

Repository-Änderung in `planWorksiteDay` (nach den Aktivitätsprüfungen, vor `erwirbWochenentwurf`):

```ts
        const kandidaten = (await tx.query<{ id: string; starts_at_utc: Date; ends_at_utc: Date | null }>(
          "select id, starts_at_utc, ends_at_utc from public.engagements where worksite_id = $1 order by starts_at_utc, id", [input.worksiteId])).rows
          .filter((e) => compareLocalBusinessDate(localBusinessDate(e.starts_at_utc, zone.timeZone), requestedDay) <= 0
                      && (e.ends_at_utc === null || compareLocalBusinessDate(localBusinessDate(e.ends_at_utc, zone.timeZone), requestedDay) >= 0));
        if (kandidaten.length === 0) return { ok: false as const, problem: { kind: "ENGAGEMENT_REQUIRED" as const } };
        if (kandidaten.length > 1) return { ok: false as const, problem: { kind: "ENGAGEMENT_AMBIGUOUS" as const } };
        const einsatz = kandidaten[0]!;
        for (const member of input.team) {
          if (!workingIntervalWithinBounds({ start: member.startsAtUtc, end: member.endsAtUtc }, { startsAtUtc: einsatz.starts_at_utc, endsAtUtc: einsatz.ends_at_utc })) {
            return { ok: false as const, problem: { kind: "WORKING_TIME_OUTSIDE_ENGAGEMENT" as const, localDate: input.localDate } };
          }
        }
```
Identitäts-Insert mit `engagement_id = einsatz.id`; beim `select id`-Fallback zusätzlich
`engagement_id` lesen und bei Abweichung `WORKSITE_DAY_CLAIMED` werfen.

RED-Reihenfolge: (1) 0015 E7 auf `throws_ok` → rot; Block 6 einkommentieren → grün. (2) Der
bestehende `planning-write`-Fall „EYT-158: PlanningWindow liest drei reale Teammitglieder"
wird rot mit `ENGAGEMENT_REQUIRED` → Fixture `mitEinsatz` → grün. (3) Journeys lokal:
`bash scripts/read-through-harness.sh` und der auth-journey-Lauf (Memory
[[lokaler-auth-journey-lauf-unter-colima]]) — beide **vor** dem Push grün sehen.

Commit: `feat(planning): EYT-120 Baustellentag nur noch innerhalb eines Einsatzes; Elternpflicht fuer neue Zeilen (Task-Gruppe E)`.

---

### Task 10: Gegenmutationen — eingespielt, rot gesehen, zurückgenommen

Jede Zeile: Mutation einspielen → genau die genannte Suite laufen lassen → die genannte
Aussage rot sehen → `git checkout -- <datei>` **nur wenn die Datei committed ist**, sonst
Sicherungskopie (Memory [[git-checkout-reverts-to-commit-not-worktree]]) → `git diff -- <datei>`
leer. Ergebnisse als Tabelle in den Evidence-Return.

| # | Mutation (Datei, Stelle) | Erwartet rot | Suite |
| - | ------------------------ | ------------ | ----- |
| M1 | 0020: FK `worksite_days_engagement_fk` auf `(engagement_id, org_id)` verkürzen (Ziel `engagements (id, org_id)`) | pgTAP `B3`, `E4`; Integrationsfall 19 (`23503` bleibt aus) | `supabase test db`, `planning-engagement` |
| M1b (nur mit E) | 0020 Block 6 entfernen | pgTAP `E7`; `planning-write`-Fall `ENGAGEMENT_REQUIRED` bleibt grün, aber `E7` rot | `supabase test db` |
| M2 | Repository (3): `on conflict … do nothing returning id` durch `on conflict (org_id, worksite_id, local_date) do update set engagement_id = excluded.engagement_id returning id` ersetzen (Adoption) | Fall 20/21: kein `WORKSITE_DAY_CLAIMED`, Zählungen verändert | `planning-engagement` |
| M3 | Repository: `throw new EngagementRejectedError(WORKSITE_DAY_CLAIMED)` durch `continue` ersetzen (Teilerfolg statt Abbruch) | Fall 20/21 (Zeilen für TAG[1] entstehen), Fall 22 wenn `vielleichtScheitern` in `try/catch` geschluckt wird | `planning-engagement` |
| M4 | `workingIntervalWithinBounds` → immer `true` **und** in `createEngagement` `iv.interval.start = max(start, bounds.start)` clampen | Unit 13/14/15, Integration 13–16 (Assignment mit gekürztem Instant) | `planning-engagement-range`, `planning-engagement` |
| M5 | `if (bekannt.requestFingerprint !== fingerabdruck)` entfernen | Fall 24 (Replay statt `IDEMPOTENCY_KEY_REUSED`) | `planning-engagement` |
| M6 | `wochen` unsortiert (`[...new Set(...)]` ohne `.sort()`) | Fall 28a | `planning-engagement` |
| M7 | `resolveEngagementBounds`: `<` durch `<=` beim Vergangenheitsvergleich | Unit 9 (Gleichheit) | `planning-engagement-range` |
| M8 | Contract: `CreateEngagementCommandSchema` von `strictObject` auf `object` | Contract-Fall 7 | `engagement-schemas` |

Ausführungsbeleg je Mutation: der `vitest`-Ausschnitt mit `✗`/`FAIL` und die Gate-Zeile, danach
`git diff -- <datei> | wc -l` = `0`.

---

### Task 11: Gesamte Verifikation, Commit-Hygiene, Push, Evidence-Return

**Step 1: Gates (Turbo nur mit `--force`, `Cached: 0 cached` lesen)**

```bash
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force --continue --concurrency=1
env -u EASYTREE_API_PROXY_TARGET pnpm build
pnpm exec supabase db reset && pnpm exec supabase test db && pnpm exec supabase db reset && pnpm exec supabase test db
# DB-Suiten einzeln (Task 5 Step 5 + planning-publish + planning-invariants + tenant-isolation) mit Gate-Zeilen
git diff --stat 191b605d3841aba3a47dad41a14a30c7fbb3cdcb..HEAD -- packages/ui apps/web/app apps/web/components   # muss LEER sein (kein UI, kein packages/ui)
git log --oneline 191b605d3841aba3a47dad41a14a30c7fbb3cdcb..HEAD
grep -rnE 'offen|TODO|TOOL_GAP|FIXME' docs/architecture/einsatz-datenmodell-eyt-120.md supabase/migrations/*_0020_* apps/api/src/modules/planning/domain/engagement-range.ts   # Treffer = Blocker
```

Secret-Scan: `git diff --cached --name-only | grep -E '\.env|\.pem|\.key$'` → leer.

**Step 2: Push (nur wenn alles grün)**

```bash
git push -u origin feat/eyt-120-engagement-range-create
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 2400
gh run list --repo DYAI2025/EasyTree --branch feat/eyt-120-engagement-range-create --limit 1
```
CI-Läufe starten nur für PRs (`ci.yml` on: pull_request); ohne PR bleibt die Evidenzstufe
„lokal". Ein **Draft-PR** gegen `feat/eyt-147-dispositionswerkbank-slice-1` (Stacked, Basis
PR #101) ist zulässig — Body: „Stacked auf PR #101 (`DO_NOT_MERGE`); nicht merge-bereit bis
Orchestrator-Review; Gate-Zeilen …". Kein Merge, kein Rebase, kein Jira-Übergang.

**Step 3: Evidence-Return** — die 16 Abschnitte des Briefs, je mit Befehl + Rohausgabe:
1 Start state (0.1 mit ⟲-Werten neu gemessen) · 2 Drift gate · 3 Migration-0019-Zustand (0.3 +
D1-Entscheid) · 4 RED-Evidenz (Test → erwartete Ausgabe → warum) · 5 Änderungen (Dateiliste
aus `git diff --name-status 191b605..HEAD`) · 6 Datenmodell (Block 1/3 der 0020) · 7 Lock-Trace
(Ausgabe von Fall 28a plus Reihenfolge der Klassen) · 8 Idempotenz (Fälle 23–25) · 9 Zeit/DST
(Unit 8–12 + Integration) · 10 Arbeitszeitgrenze (13–16) · 11 Gegenmutationen (Tabelle Task 10
mit Rohausschnitten) · 12 Testergebnisse (jede Gate-Zeile wörtlich, `Cached: 0 cached`) ·
13 Diff/Scope (leerer Diff auf `packages/ui`, `apps/web/app`, `apps/web/components`; benannte
Out-of-Scope-Berührungen: `werkbank.tsx:159`, `ci.yml`, ggf. drei e2e-Specs) · 14 Git-Zustand
(Branch, SHA, Push, PR-Nummer/Draft) · 15 Restrisiken (Produktion pausiert/unbeobachtet;
Vorläuferpfad bis E; `validate constraint` ausstehend; Engagement-Rückgabe im PlanningWindow
fehlt = Inkrement 2; Mehrfachmitgliedschaft fail-closed) · 16 Final gate: **eine** Zeile.

Erwartetes Final gate bei vollständigem Lauf: `INCREMENT_1_READY_FOR_ORCHESTRATOR_REVIEW`.
Ohne D1-Bestätigung endet die Ausführung nach Task 4 mit `BLOCKED_MIGRATION_STATE`.
