# Planning-Data-API auf Least Privilege bringen — Implementierungsplan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Schreibende Zugriffe auf `public.assignments` und `public.plan_versions` sind über die
Supabase-Data-API (PostgREST) nicht mehr möglich, und keine Tabelle im exponierten Schema `public`
trägt für `authenticated` mehr Rechte, als ihr Fachpfad braucht — ohne dass ein legitimer
EasyTree-Command seine Wirkung verliert.

**Architecture:** Eine einzige Vorwärtsmigration `0017`. Sie tut genau zwei Dinge, in dieser
Reihenfolge: (1) sie nimmt jeder Tabelle im Schema `public` die von Supabase per
`ALTER DEFAULT PRIVILEGES` vergebenen Rechte für `authenticated` (`revoke all`) und vergibt
anschließend **exakt** die Verben und Spalten wieder, die ein gemessener Repository-Pfad benutzt;
(2) sie erweitert die vier Policies der Planungsschreibfläche um genau die zwei Prädikate, die
Migration 0015 für `plan_versions UPDATE` bereits einsetzt — `app.is_runtime_channel()` und
`app.has_permission(org_id, 'planning.write')`. Es entsteht **keine** neue Funktion, **kein**
neues Rechtekonzept und **keine** zweite Geschäftslogik in RLS: beide Prädikate existieren seit
0015 und werden nur an weiteren Stellen verwendet.

**Tech Stack:** PostgreSQL 17 (Supabase), pgTAP, Vitest + `node-postgres` (Integrationstests),
Playwright (Angriffsweg im echten Browserkontext), GitHub Actions Job `db-gates`.

---

## Warum überhaupt — der gemessene Befund

Gemessen am 07.08.2026 gegen das produktive Projekt `inypnrvpawvhgiyagxbd`, ausschließlich lesend
(`supabase_read_only_user`, `transaction_read_only = on`), über `pg_class`,
`has_table_privilege`, `has_column_privilege` und `pg_policies`:

| Tabelle                 | SELECT | INSERT | UPDATE | DELETE | Policy-Prädikat der Schreibbefehle              |
| ----------------------- | ------ | ------ | ------ | ------ | ----------------------------------------------- |
| `plan_versions`         | ✅     | Spalte | Spalte | ❌     | UPDATE: Kanal + `planning.publish`; INSERT: Org  |
| `assignments`           | ✅     | Spalte | Spalte | **✅** | **nur Organisation**                             |
| `outbox_messages`       | ✅     | ✅     | ✅     | ✅\*   | nur Organisation (DELETE ohne Policy → verweigert)|
| `idempotency_records`   | ✅     | ✅     | ✅\*   | ✅\*   | INSERT nur Organisation                          |
| `audit_events`          | ✅     | ✅     | ✅\*   | ✅\*   | INSERT Org + Akteurbindung                       |
| `memberships`           | ✅     | ✅\*   | ✅\*   | ✅\*   | **keine Schreibpolicy**                          |
| `organizations`         | ✅     | ✅\*   | ✅\*   | ✅\*   | **keine Schreibpolicy**                          |
| `employee_rate_versions`| ✅     | ✅     | Spalte | ❌     | Org + `costs.*` (vorbildlich)                    |
| `items`, `item_notes`   | ✅     | ✅     | ✅     | ✅     | nur Organisation (Boilerplate ohne Verbraucher)  |

`✅*` = Recht ist erteilt, aber **heute** durch das Fehlen einer permissiven Policy wirkungslos
(`force row level security` ist auf allen Tabellen aktiv).

Zwei Aussagen folgen daraus, und nur diese zwei tragen den Plan:

1. **`assignments` ist offen.** Recht **und** Policy sind vorhanden; ein aktives Mitglied jeder
   Rolle — auch `member`, dem die API `403` gibt — kann Entwurfszuweisungen über PostgREST anlegen,
   ändern und **löschen**. Migration 0016 hat `delete` auf `plan_versions` entzogen; auf
   `assignments` ist es nie entzogen worden.
2. **Die übrigen Tabellen sind nur zufällig zu.** Ihre Rechte stammen aus den
   Supabase-Default-Privileges; `revoke all … from authenticated` steht in den Migrationen nur bei
   `role_permissions` (0013 Z. 69) und `employee_rate_versions` (0013 Z. 151). Überall sonst wurde
   **auf ein bestehendes `ALL` daraufgegrantet**. Die Sicherheit hängt damit an der Abwesenheit
   einer Policy, nicht an der Abwesenheit eines Rechts. Wer aus gutem Grund eine
   `memberships`-UPDATE-Policy ergänzt, schaltet damit unbemerkt auch INSERT und DELETE frei —
   also Selbstbeförderung zur Rolle `owner`.

**Warum `app.is_runtime_channel()` hier richtig ist und nicht nur „mehr davon".** Der Auftrag
verlangt ausdrücklich den Beweis statt der Annahme. Er lautet: es gibt heute **keinen legitimen
Schreiber** von `assignments`/`plan_versions`, der nicht als `easytree_app` angemeldet ist. Die API
und der Worker verbinden als `easytree_app` (produktiv gemessen 04.08.2026:
`session_user=easytree_app`, nach `set local role authenticated` → `app.is_runtime_channel()=true`);
`scripts/ops/bootstrap-demo-tenant.mjs` verbindet über dieselbe `DATABASE_URL` und schreibt
ohnehin keine Planungstabellen; PostgREST verbindet als `authenticator` und ist nicht Mitglied von
`easytree_app`. Ein reiner Rechte-Check (`planning.write`) würde zwar `member` aussperren, eine
**Managerin** aber weiterhin am Command vorbeischreiben lassen — mit Verlust von
Wochenzugehörigkeitsprüfung, Idempotenz, Audit, Outbox und Korrelations-ID. Genau diese Lücke hat
0015 für das Veröffentlichen geschlossen; für den Entwurf steht sie offen. Beide Riegel, gleiche
Bauart wie 0015.

**Bewusst NICHT in diesem Slice:** die SELECT-Fläche. Ein `member` kann heute die Planung seiner
Organisation über die Data-API lesen, obwohl die API `403` gibt. Das ist ein echter Befund, seine
Korrektur hängt aber am Subjektmodell aus EYT-14 (Mitarbeitersicht „eigene Einsätze"), das nicht
existiert. Eine Lesegrenze ohne dieses Modell wäre geraten, nicht entschieden. Siehe Abschnitt
_Non-Goals_.

---

## Requirements

| ID    | Anforderung                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| R-1   | Kein `authenticated`-Recht im Schema `public` existiert, ohne dass ein gemessener Produktionspfad es benutzt.                            |
| R-2   | `insert`, `update` und `delete` auf `public.assignments` sind über die Data-API für jede Rolle unmöglich.                                |
| R-3   | `insert` auf `public.plan_versions` ist über die Data-API unmöglich.                                                                     |
| R-4   | Alle heute grünen Pfade bleiben grün: Entwurf anlegen, Entwurf prüfen, Veröffentlichen, Satzpflege, Auth-Reise, Read-Through.            |
| R-5   | Ausschließlich Vorwärtsmigrationen; `0016` und früher werden nicht editiert.                                                             |
| R-6   | Zu jeder Zusicherung existiert eine **ausgeführte** Gegenmutation, die sie rot macht.                                                    |
| R-7   | Der Rückbau steht als lauffähiger Block im Kopfkommentar von `0017` und gehört bei Bedarf in eine `0018`.                                |

## Acceptance Criteria

- [ ] **AK1** — `0017` entzieht in einer Schleife über eine **namentlich aufgezählte** Tabellenliste
      `all` von `authenticated` und vergibt danach exakt die in Task 1 gemessenen Verben/Spalten.
      Die Liste ist im Kopfkommentar gegen `information_schema.tables` abgeglichen; eine neue Tabelle
      ohne Eintrag macht den Metagate aus `0005_schema_meta_gate.sql` rot.
- [ ] **AK2** — `has_table_privilege('authenticated','public.assignments','DELETE')` ist `false`;
      `has_column_privilege` für jede `assignments`-Spalte in `INSERT` und `UPDATE` ist `false`.
- [ ] **AK3** — `has_column_privilege('authenticated','public.plan_versions',<jede Spalte>,'INSERT')`
      ist `false`; `UPDATE (published_at, published_by)` bleibt `true`.
- [ ] **AK4** — Die Policies `assignments_insert_in_org`, `assignments_update_in_org`,
      `assignments_delete_in_org` und `plan_versions_insert_in_org` tragen
      `app.is_runtime_channel()` **und** `app.has_permission(org_id,'planning.write')`, jeweils in
      `using` **und** `with check`, soweit der Befehl beide Klauseln kennt.
- [ ] **AK5** — `outbox_messages`, `idempotency_records`, `audit_events`, `memberships`,
      `organizations`, `items`, `item_notes` tragen nur noch die Verben, die ihr Repository benutzt;
      insbesondere hat `memberships` kein `insert`/`update`/`delete` mehr.
- [ ] **AK6** — pgTAP `0012_planning_data_api_boundary.sql` prüft AK2–AK5 mit `has_*_privilege`
      **und** mit einem Verhaltensfall je Befehl. Beides, weil SQLSTATE `42501` mehrdeutig ist
      (Spaltenrecht *oder* RLS) und ein Verhaltenstest allein nicht sagt, welcher Riegel hielt.
- [ ] **AK7** — Ein Integrationstest fährt den echten Angriffsweg: eine Session als `authenticator`
      (PostgREST-Rolle) mit gültigem JWT eines `manager` versucht INSERT/UPDATE/DELETE auf
      `assignments` und INSERT auf `plan_versions` und wird jeweils abgewiesen; dieselbe Operation
      über den Command-Pfad gelingt.
- [ ] **AK8** — `db-gates`, `read-through` und `auth-journey` sind auf dem PR-Head grün; keine
      Gegenmutation bleibt im Baum zurück.
- [ ] **AK9** — `docs/runbooks/planning-publish.md` erhält einen Abschnitt „Data-API-Grenze der
      Planung" mit der gemessenen Rechtematrix vorher/nachher.

## Non-Goals

Ausdrücklich **nicht** Teil dieses Slices — jeweils mit Grund:

1. **SELECT-Härtung der Planungstabellen.** Braucht das Subjektmodell aus EYT-14; ohne es wäre die
   Grenze geraten. Eigener Befund, eigenes Ticket.
2. **`service_role` / `postgres` (BYPASSRLS).** Plattformeigenschaft, durch keine Policy erreichbar.
3. **Löschen von `items`/`item_notes`.** Rechteentzug ja, `drop table` nein — Datenverlust braucht
   ein eigenes Ticket mit Restore-Nachweis (CLAUDE.md, _Non-negotiable rules_).
4. **Umstellung auf den Supavisor-Pooler.** Sie bräche `app.is_runtime_channel()` — nach diesem
   Slice an mehr Stellen als vorher. Der Zusammenhang gehört ins Runbook, die Entscheidung nicht
   hierher.
5. **EYT-109, EYT-110, EYT-80, EYT-130, EYT-18, Outbox-Consumer.**

## Risk-/Rollback-Gates

| Risiko                                                                        | Gate                                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `revoke all` nimmt ein Recht, das ein Repository still benutzt → API bricht    | **Task 1 misst die Verben aus dem Code, statt sie zu raten.** `read-through` und `auth-journey` fahren den echten Pfad und würden rot.           |
| Merge auf `master` ist eine **Produktivmigration** (Check „Supabase Preview")  | Vor dem Merge PO-Freigabe einholen. Der Merge-Zeitpunkt ist der Migrationszeitpunkt — nicht später.                                            |
| `0017` sperrt einen Pfad, den erst EYT-109 braucht                            | EYT-109 schreibt keine Planungstabellen, es liest sie. Snapshot-Tabellen entstehen dort neu und bringen ihre eigenen Grants mit.               |
| Rückbau                                                                        | Reiner Rechte-/Policy-Rückbau, kein Datenverlust. Lauffähiger Block im Kopfkommentar von `0017`, anzuwenden als **neue** `0018`.               |

---

## Task 1: Die tatsächlich benutzten Rechte messen, nicht raten

**Files:**

- Create: `docs/reviews/2026-08-07-data-api-grant-inventar.md`

**Step 1: Jede Schreibstelle im Produktionscode auflisten**

```bash
rg -n --type ts -e 'insert into public\.' -e 'update public\.' -e 'delete from public\.' \
  apps/api/src packages | sort
```

Erwartung: eine Zeile je Repository-Statement. `apps/api/test/` bleibt außen vor — Testcode
begründet kein Produktionsrecht.

**Step 2: Ergebnis in eine Tabelle Tabelle → Verb → Spalten → Fundstelle schreiben**

Jede Zeile trägt `datei.ts:zeile`. Eine Tabelle ohne Fundstelle bekommt **kein** Recht.
`scripts/ops/bootstrap-demo-tenant.mjs` wird als eigener, benannter Verbraucher geführt
(`users`, `organizations`, `memberships`, `employees` — nur `insert`).

**Step 3: Gegen die gemessene Ist-Matrix stellen**

```bash
pnpm exec supabase start -x studio && pnpm exec supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -c "
select t.relname,
       has_table_privilege('authenticated', t.oid,'SELECT') sel,
       has_table_privilege('authenticated', t.oid,'INSERT') ins,
       has_table_privilege('authenticated', t.oid,'UPDATE') upd,
       has_table_privilege('authenticated', t.oid,'DELETE') del
  from pg_class t join pg_namespace n on n.oid=t.relnamespace
 where n.nspname='public' and t.relkind='r' order by 1;"
```

Erwartung: dieselbe Matrix wie oben im Abschnitt _Warum überhaupt_. Weicht sie ab, ist die
lokale Stack-Version nicht der Produktionsstand — **stoppen und melden**, nicht weiterbauen.

**Step 4: Commit**

```bash
git add docs/reviews/2026-08-07-data-api-grant-inventar.md
git commit -m "docs(review): EYT-P1 — gemessenes Grant-Inventar der Data-API-Fläche"
```

---

## Task 2: Roter pgTAP-Nachweis, dass die Lücke existiert

**Files:**

- Create: `supabase/tests/0012_planning_data_api_boundary.sql`

**Step 1: Den Test schreiben, der heute FEHLSCHLÄGT**

```sql
-- 0012_planning_data_api_boundary — Data-API-Grenze der Planung (P1 aus EYT-107).
--
-- Dieser Test ist ZUERST rot. Er beschreibt den Zielzustand von Migration 0017,
-- nicht den Bestand. Wer ihn grün sieht, bevor 0017 existiert, hat ihn falsch
-- geschrieben.
begin;
select plan(9);

-- 1-4: assignments traegt fuer authenticated kein Schreibrecht mehr.
select ok(not has_table_privilege('authenticated','public.assignments','DELETE'),
  'assignments: kein DELETE-Recht fuer authenticated');
select ok(not has_column_privilege('authenticated','public.assignments','starts_at_utc','INSERT'),
  'assignments: kein INSERT-Recht auf starts_at_utc');
select ok(not has_column_privilege('authenticated','public.assignments','employee_id','UPDATE'),
  'assignments: kein UPDATE-Recht auf employee_id');
select ok(not has_column_privilege('authenticated','public.plan_versions','week_key','INSERT'),
  'plan_versions: kein INSERT-Recht auf week_key');

-- 5: das Veroeffentlichen bleibt erreichbar — sonst waere 0017 ein Rueckschritt.
select ok(has_column_privilege('authenticated','public.plan_versions','published_at','UPDATE'),
  'plan_versions: UPDATE auf published_at bleibt erhalten');

-- 6-7: memberships ist wieder nur lesbar (Selbstbefoerderung ausgeschlossen).
select ok(not has_table_privilege('authenticated','public.memberships','INSERT'),
  'memberships: kein INSERT-Recht');
select ok(not has_table_privilege('authenticated','public.memberships','UPDATE'),
  'memberships: kein UPDATE-Recht');

-- 8-9: die Policies der Schreibflaeche nennen BEIDE Praedikate.
select ok(
  (select count(*) from pg_policies
    where schemaname='public' and tablename='assignments' and cmd in ('INSERT','UPDATE','DELETE')
      and coalesce(qual,'') || coalesce(with_check,'') like '%is_runtime_channel%') = 3,
  'assignments: alle drei Schreibpolicies pruefen den Laufzeitkanal');
select ok(
  (select count(*) from pg_policies
    where schemaname='public' and tablename='assignments' and cmd in ('INSERT','UPDATE','DELETE')
      and coalesce(qual,'') || coalesce(with_check,'') like '%planning.write%') = 3,
  'assignments: alle drei Schreibpolicies pruefen planning.write');

select * from finish();
rollback;
```

**Step 2: Rot messen**

```bash
pnpm exec supabase test db
```

Erwartung: `0012` schlägt fehl, und zwar bei **allen neun** Zusicherungen außer Nr. 5.
Erwartete Ausgabe enthält `not ok 1 - assignments: kein DELETE-Recht fuer authenticated`.
Läuft der Test grün, ist er wirkungslos — dann Schritt 1 korrigieren, nicht weitergehen.

**Step 3: Commit**

```bash
git add supabase/tests/0012_planning_data_api_boundary.sql
git commit -m "test(db): EYT-P1 — roter Nachweis der offenen Data-API-Grenze der Planung"
```

---

## Task 3: Migration 0017 — Rechte entziehen und exakt neu vergeben

**Files:**

- Create: `supabase/migrations/20260807HHMMSS_0017_planning_data_api_least_privilege.sql`

> `pnpm exec supabase migration new planning_data_api_least_privilege` erzeugt nur den Zeitstempel —
> **die Datei anschließend auf die `NNNN`-Sequenz umbenennen** (CLAUDE.md, _Non-negotiable rules_).

**Step 1: Kopfkommentar mit Rückbaublock**

```sql
-- Migration 0017_planning_data_api_least_privilege (P1 aus EYT-107, Folgebefund NG-1)
--
-- Die Data-API vergibt keine Rechte mehr, die kein Fachpfad benutzt — und die
-- Planungsschreibflaeche verlangt denselben Riegel wie das Veroeffentlichen.
--
-- Rollback (vorwaerts, als NEUE 0018; 0017 wird nach dem Merge nicht editiert):
--   grant select, insert, update, delete on table public.assignments to authenticated;
--   revoke insert, update on table public.assignments from authenticated;
--   grant insert (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
--     on table public.assignments to authenticated;
--   grant update (plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
--     on table public.assignments to authenticated;
--   grant insert (id, org_id, week_key) on table public.plan_versions to authenticated;
--   grant select, insert, update, delete on table public.memberships to authenticated;
--   -- Policies auf den Stand vor 0017 (nur Organisation) zuruecksetzen: siehe Abschnitt 3.
-- Kein Datenverlust: diese Migration legt keine Tabelle und keine Spalte an und
-- loescht keine Zeile. Sie entzieht Rechte und verschaerft vier Policies.
```

**Step 2: Abschnitt 1 — Default-Privileges einsammeln**

```sql
-- ---------------------------------------------------------------------------
-- 1. Der Bestand stammt nicht aus diesen Migrationen
-- ---------------------------------------------------------------------------
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf neuen Tabellen im Schema
-- `public` ALLE Rechte an anon/authenticated/service_role. Die bisherigen
-- Migrationen haben darauf GEGRANTET, statt vorher zu entziehen — nur 0013 tut
-- es fuer `role_permissions` und `employee_rate_versions`. Ueberall sonst haengt
-- die Sicherheit an der ABWESENHEIT einer Policy, nicht an der Abwesenheit eines
-- Rechts. Wer aus gutem Grund eine memberships-UPDATE-Policy ergaenzt, schaltet
-- damit unbemerkt INSERT und DELETE frei — also Selbstbefoerderung zur Rolle
-- owner. Diese Migration dreht das um: erst entziehen, dann exakt vergeben.
--
-- Die Liste ist NAMENTLICH und nicht dynamisch. Eine dynamische Schleife ueber
-- pg_class waere bequemer und genau deshalb falsch: sie wuerde eine kuenftige
-- Tabelle stillschweigend mitentziehen und der Fehler faende sich erst zur
-- Laufzeit. Der Metagate aus 0005 haelt die Liste vollstaendig.
revoke all on table
  public.users, public.memberships, public.items, public.item_notes,
  public.organizations, public.employees, public.worksites,
  public.plan_versions, public.assignments,
  public.audit_events, public.outbox_messages,
  public.idempotency_records
from authenticated;
```

**Step 3: Abschnitt 2 — exakt neu vergeben (Werte aus Task 1!)**

```sql
-- ---------------------------------------------------------------------------
-- 2. Exakt das, was ein gemessener Repository-Pfad benutzt
-- ---------------------------------------------------------------------------
-- Fundstellen: docs/reviews/2026-08-07-data-api-grant-inventar.md
grant select on table public.memberships   to authenticated;   -- nur Lesen (0002 Absicht)
grant select on table public.organizations to authenticated;   -- nur Lesen (0004 Absicht)
grant select, insert, update, delete on table public.users to authenticated;
grant select, insert, update on table public.employees to authenticated;
grant select, insert, update, delete on table public.worksites to authenticated;
grant select on table public.plan_versions to authenticated;
grant update (published_at, published_by) on table public.plan_versions to authenticated;
grant select on table public.assignments to authenticated;
grant select, insert on table public.audit_events to authenticated;
grant select, insert, update on table public.outbox_messages to authenticated;
grant select, insert on table public.idempotency_records to authenticated;
-- items/item_notes: Boilerplate aus 0002 ohne Produktionsverbraucher. Kein
-- Recht. Die Tabellen bleiben stehen — ein `drop` waere Datenverlust und
-- braucht ein eigenes Ticket mit Restore-Nachweis.
```

> **Achtung, `plan_versions` und `assignments` bekommen KEIN `insert` zurück.** Der Command-Pfad
> legt beide über `easytree_app` an — und `easytree_app` ist Mitglied von `authenticated` mit
> `set_option = true`, benutzt aber beim `set local role authenticated` genau diese Rechte. Task 4
> beweist mit `read-through` und `auth-journey`, ob das trägt; **falls nicht**, ist die richtige
> Antwort ein eigener, kanalgebundener `grant` an `easytree_app` — nicht die Rückkehr zu
> `authenticated`. Diese Verzweigung ist bewusst offen gelassen und in Task 4 gemessen, statt hier
> geraten zu werden.

**Step 4: Abschnitt 3 — die vier Policies**

```sql
-- ---------------------------------------------------------------------------
-- 3. Entwurfsschreiben verlangt Kanal UND Recht — dieselbe Bauart wie 0015
-- ---------------------------------------------------------------------------
drop policy assignments_insert_in_org on public.assignments;
create policy assignments_insert_in_org on public.assignments
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  );

drop policy assignments_update_in_org on public.assignments;
create policy assignments_update_in_org on public.assignments
  for update to authenticated
  using (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  )
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  );

drop policy assignments_delete_in_org on public.assignments;
create policy assignments_delete_in_org on public.assignments
  for delete to authenticated
  using (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  );

drop policy plan_versions_insert_in_org on public.plan_versions;
create policy plan_versions_insert_in_org on public.plan_versions
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
    and published_at is null
  );
```

> **`using` UND `with check` beim update, obwohl das redundant aussieht.** 0015 hat dieselbe
> Doppelung, und der Grund steht in CLAUDE.md: gemessen ist die Bedingung allein im `with check`
> ebenfalls wirksam, aber nur laut statt still. Zwei unabhängige Riegel, keine Kopie.

**Step 5: `supabase db reset` zweimal + pgTAP**

```bash
pnpm exec supabase db reset && pnpm exec supabase db reset
pnpm exec supabase test db
```

Erwartung: beide Resets fehlerfrei, `0012` jetzt **grün** (9/9), alle übrigen Suiten unverändert
grün. Wird `0011_planning_publish.sql` rot, hat 0017 den Publish-Pfad beschädigt — dann
**zurückbauen und Task 3 Step 3 neu entscheiden**, nicht den Test anpassen.

**Step 6: Commit**

```bash
git add supabase/migrations/20260807*_0017_*.sql
git commit -m "fix(db): EYT-P1 — Data-API der Planung auf Least Privilege, Entwurf braucht Kanal und Recht"
```

---

## Task 4: Der echte Angriffsweg, nicht nur die Rechtetabelle

**Files:**

- Create: `apps/api/test/planning-data-api-boundary.integration.test.ts`

**Step 1: Test schreiben — zwei Verbindungen, zwei Rollen**

Die eine Verbindung meldet sich als Laufzeitrolle an (`easytree_app`, wie die API), die andere als
`authenticator` (wie PostgREST). Beide setzen denselben JWT-Kontext einer **Managerin** — also
jemand mit `planning.write`. Der Unterschied darf ausschließlich der Kanal sein.

```ts
it("weist Entwurfsschreiben ueber den PostgREST-Kanal ab, laesst es ueber den Laufzeitkanal zu", async () => {
  await expect(alsPostgrest(managerJwt, (tx) =>
    tx.query(`insert into public.assignments (id, org_id, plan_version_id, employee_id,
                worksite_id, starts_at_utc, ends_at_utc) values ($1,$2,$3,$4,$5,$6,$7)`, zeile),
  )).rejects.toMatchObject({ code: "42501" });

  await expect(alsLaufzeit(managerJwt, (tx) =>
    tx.query(`insert into public.assignments (...) values (...)`, zeile),
  )).resolves.toMatchObject({ rowCount: 1 });
});
```

Analog je ein Fall für `update`, `delete` (`assignments`) und `insert` (`plan_versions`).

**Step 2: Laufen lassen**

```bash
EASYTREE_TENANT_TESTS=required \
  pnpm --filter @easytree/api exec vitest run test/planning-data-api-boundary.integration.test.ts
```

Erwartung: 4 Fälle grün, greppbare Zeile `[planning-data-api] mode=required executed=4 skipped=0`.

**Step 3: Gegenmutationen AUSFÜHREN und zurücknehmen**

Nicht ausdenken — einspielen, messen, zurücknehmen (je Mutation eine Zeile ins Reviewprotokoll):

| # | Mutation                                                                              | Erwartet rot                  |
| - | ------------------------------------------------------------------------------------- | ----------------------------- |
| 1 | `app.is_runtime_channel()` aus `assignments_delete_in_org` entfernen                    | pgTAP 0012 Nr. 8, Delete-Fall |
| 2 | `app.has_permission(...,'planning.write')` aus `assignments_insert_in_org` entfernen    | pgTAP 0012 Nr. 9              |
| 3 | `grant delete on public.assignments to authenticated` nachträglich wieder vergeben      | pgTAP 0012 Nr. 1              |
| 4 | `grant insert (week_key) on public.plan_versions to authenticated` wieder vergeben      | pgTAP 0012 Nr. 4              |
| 5 | Im Integrationstest `alsPostgrest` durch `alsLaufzeit` ersetzen                         | alle vier Fälle               |

> Mutationen an **uncommitteten** Dateien niemals mit `git checkout --` zurücknehmen — das stellt
> den Commit-Stand her, nicht den Arbeitsstand. Vorher Sicherungskopie anlegen.

**Step 4: Commit**

```bash
git add apps/api/test/planning-data-api-boundary.integration.test.ts \
        docs/reviews/2026-08-07-data-api-gegenmutationen.md
git commit -m "test(db): EYT-P1 — echter PostgREST-Angriffsweg plus fuenf ausgefuehrte Gegenmutationen"
```

---

## Task 5: CI-Gate, Runbook, PR

**Files:**

- Modify: `.github/workflows/ci.yml` (Schritt im **bestehenden** Job `db-gates`)
- Modify: `docs/runbooks/planning-publish.md`

**Step 1: Kein neuer Job.** Der Nachweis läuft als Schritt in `db-gates`. Ein neuer Job wäre bis
zur nächsten Ruleset-Anwendung **kein Pflichtcheck**, und beide Kopien der Pflichtcheck-Liste
(`scripts/setup-branch-protection.sh`, `scripts/verify-branch-protection.sh`) müssten mitgezogen
werden — sonst bricht `verify` mit einem internen Driftfehler ab.

**Step 2: Runbook-Abschnitt „Data-API-Grenze der Planung"** mit der Matrix vorher/nachher aus
Task 1 und Task 3, plus dem Satz, dass ein Wechsel auf den Supavisor-Pooler ab jetzt **auch das
Entwurfsschreiben** bricht, nicht nur das Veröffentlichen.

**Step 3: Gate vor dem Push lesen**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

Erst danach `git push`. `vitest` allein genügt nicht — ein Typfehler in einer Testdatei zeigt sich
erst unter `tsc`.

**Step 4: PR öffnen, elf Pflichtchecks abwarten, NICHT mergen**

Der Merge auf `master` **ist** die Produktivmigration (Check „Supabase Preview"). Freigabe des
Product Owners einholen; die Freigabe ist SHA-gebunden und verfällt mit jedem neuen Commit.
