---
ticket: EYT-107
titel: "P1 — Direkter Tabellen-UPDATE umgeht den Publish-Command"
branch: feat/eyt-107-publish-core
basis: e34156a43f2be5b9b39959862e0e0ace7d718564
pr: 52
status: ready-for-execution
erstellt: 2026-08-04
---

# EYT-107 P1 — Kanal- und Spaltengrenze für `plan_versions`

<!-- GOAL_START -->

## Ziel

Migration 0015 verlangt für ein `update public.plan_versions` das Recht
`planning.publish` — aber sonst nichts. `authenticated` besitzt aus Migration
0007 weiterhin `grant select, insert, update, delete on table
public.plan_versions`, ohne Spaltenbegrenzung, und PostgREST stellt das Schema
`public` als Data-API bereit (`supabase/config.toml`, `schemas = ["public",
"graphql_public"]`).

Ein Benutzer mit gültigem JWT und der Rolle `owner` oder `manager` kann damit
`PATCH /rest/v1/plan_versions?id=eq.<id>` senden und `published_at` sowie
`published_by` unmittelbar setzen. Der Sync-Trigger aus 0010 stempelt die
Zuweisungen bereitwillig mit. Es entstehen dabei **nicht**: Wochenzuordnungs-
prüfung, benannte Konfliktprüfung, Idempotenzdatensatz, Audit-Ereignis,
Outbox-Nachricht, stabiler Command-Fehler.

Das verletzt die tragende EYT-107-Invariante: Eine Veröffentlichung ist ein
autorisierter, validierter, idempotenter und auditierter Domain Command — kein
gewöhnliches Tabellen-UPDATE.

Der pgTAP-Test `supabase/tests/0011_planning_publish.sql` bestätigt diesen
Bypass heute sogar als Positivfall (Zeile 172, `lives_ok` auf ein direktes
`update public.plan_versions`).

## Was diese Korrektur herstellt

Zwei Grenzen in der Datenbank, beide in Migration 0015 (der PR ist offen, die
Migration wurde nirgends angewandt — Korrektur an Ort und Stelle statt einer
0016, die ihre Vorgängerin sofort zurücknähme):

1. **Kanalgrenze.** Eine neue Funktion `app.is_runtime_channel()` vergleicht
   `session_user` mit der Laufzeitrolle `easytree_app`. Sie steht in `using`
   und in `with check` der Update-Policy. Der EasyTree-Serverpfad verbindet
   sich als `easytree_app` und setzt in der Transaktion `set local role
authenticated` — `session_user` bleibt dabei `easytree_app`. PostgREST
   verbindet sich als `authenticator`; gemessen am 04.08.2026 auf dem
   gehosteten Projekt ist `authenticator` **kein** Mitglied von `easytree_app`.

2. **Spaltengrenze.** `revoke update on public.plan_versions from
authenticated`, danach `grant update (published_at, published_by)`. Damit
   sind `org_id`, `week_key`, `created_at` über das Publish-Recht nicht mehr
   erreichbar — dieselbe Bauart, die `assignments` seit 0010 schützt.

Der Serverpfad bleibt unverändert unter echter Benutzeridentität und RLS
mandantengebunden. Es entsteht **keine** zweite fachliche
Publish-Implementierung als SQL-Kopie: die Anwendung bleibt die einzige
Stelle, die Wochenzuordnung, Konflikte, Idempotenz, Audit und Outbox erzeugt.

## Warum das reicht

Der Angriffspfad ist genau einer: eine Sitzung, die sich nicht als
`easytree_app` angemeldet hat, aber `set local role authenticated` besitzt.
Das ist PostgREST. Ihn schließt die Kanalgrenze technisch, nicht durch
Konvention. Was die Kanalgrenze nicht deckt — ein Zugriff mit
`service_role`-Schlüssel oder als `postgres` —, umgeht RLS ohnehin vollständig
(beide tragen `BYPASSRLS`, gemessen) und ist eine bestehende, andernorts
verwaltete Eigenschaft der Plattform, kein Regressionsrisiko dieser Änderung.

## Nachweisebene

Drei Ebenen, jede in einem **bestehenden** Pflichtcheck, kein zwölfter Job:

- `db-gates` / pgTAP: der direkte Versuch aus einer fremden Sitzung bleibt
  wirkungslos, und die Spaltengrenze lehnt `week_key`/`org_id` ab.
- `db-gates` / Integrationstest gegen eine echte `easytree_app`-Verbindung:
  der Serverpfad funktioniert weiterhin, und `with check` lehnt eine fremde
  Urheberangabe ab.
- `auth-journey`: ein echter, per GoTrue angemeldeter Benutzer mit
  `planning.publish` versucht den Bypass über die reale PostgREST-Data-API und
  ändert nichts.

<!-- GOAL_END -->

## Non-Goals

- **NG-1** — EYT-109 (Tageskosten-Snapshot) und EYT-110 (XLSX) bleiben
  unberührt.
- **NG-2** — Migration 0014 und 0015 werden **nicht** remote angewandt.
- **NG-3** — Railway wird nicht verändert, es wird nicht deployt.
- **NG-4** — PR #52 wird nicht gemergt, EYT-107 nicht auf Fertig gesetzt.
- **NG-5** — Keine Kanalgrenze für andere Tabellen. `assignments`,
  `employee_rate_versions`, `items` behalten ihre heutigen Policies. Siehe
  BEFUND-2 unten: der Schreibpfad auf `assignments` prüft heute **kein**
  fachliches Recht — das ist ein realer, benannter Folgebefund und wird hier
  bewusst **nicht** mitrepariert, weil er nicht Teil des P1 ist und den
  Änderungsumfang verdoppeln würde.
- **NG-6** — Keine Änderung an `role-privileges.ts` / dem EYT-45-Startgate.
  Begründung unter RISK-3.
- **NG-7** — Kein Rückbau der Rechteprüfung im Controller, keine
  Rollenabfrage dort.

## Vorbedingungen und bekannte Lücken

### Gemessene Evidenz (04.08.2026)

| Nr.  | Aussage                                                                                                                                      | Quelle                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| E-1  | `grant select, insert, update, delete on table public.plan_versions to authenticated` — ohne Spaltenbegrenzung                               | `supabase/migrations/20260727020300_0007_planning.sql:101`                       |
| E-2  | `assignments` hat seit 0010 eine Spaltengrenze, die `published_at` ausschließt                                                               | `20260727050000_0010_planning_invariants.sql:83-86`                              |
| E-3  | 0015 prüft in `using` nur Organisation und `planning.publish`, keinen Kanal                                                                  | `20260803120000_0015_planning_publish_permissions.sql:121-130`                   |
| E-4  | PostgREST stellt `public` bereit → `plan_versions` ist über `/rest/v1/` erreichbar                                                           | `supabase/config.toml`, `[api] schemas`                                          |
| E-5  | pgTAP 0011 bestätigt den Bypass als Positivfall                                                                                              | `supabase/tests/0011_planning_publish.sql:172-178`                               |
| E-6  | `authenticator` ist LOGIN/NOINHERIT und **kein** Mitglied von `easytree_app`; `pg_has_role('authenticator','easytree_app','member') = false` | Supabase-MCP, `execute_sql` gegen `inypnrvpawvhgiyagxbd`, read-only              |
| E-7  | `easytree_app` ist LOGIN/NOINHERIT/NOBYPASSRLS und Mitglied von `authenticated` (`set_option = true`)                                        | dieselbe Messung, `pg_auth_members`                                              |
| E-8  | `postgres` trägt `BYPASSRLS`, ist **kein** Superuser; `service_role` trägt ebenfalls `BYPASSRLS`                                             | dieselbe Messung, `pg_roles`                                                     |
| E-9  | `postgres` ist Mitglied von `easytree_app` mit `inherit_option = false`, `set_option = false`                                                | dieselbe Messung                                                                 |
| E-10 | Serverpfad in CI und Produktion verbindet als `easytree_app`                                                                                 | `ci.yml:402/434/504`, `scripts/read-through-harness.sh:95`, CLAUDE.md Deployment |
| E-11 | Die drei Planungs-DB-Gates verbinden heute als `postgres`                                                                                    | `ci.yml:209-256`, `EASYTREE_TEST_DB_URL`                                         |
| E-12 | Der Publish-Pfad hat **eine** Schreibstelle und wirft bei null betroffenen Zeilen                                                            | `planning-write.repository.ts:801-829`                                           |
| E-13 | Server-Version des gehosteten Projekts: PostgreSQL 17.6                                                                                      | dieselbe Messung                                                                 |
| E-14 | Alle benötigten Pfade liegen bereits im PRIL-Manifest — **keine** Scope-Erweiterung nötig                                                    | `docs/scope/sprint-5-daily-cost-export.scope.json`                               |

### MISSING

- **M-1** — Auf diesem Rechner läuft **kein** Docker (`docker info` scheitert,
  gemessen 04.08.2026). Jede SQL-Aussage dieses Plans wird zum ersten Mal in
  CI ausgeführt. Es gibt keinen lokalen Vorlauf; der rote Nachweis und jede
  Gegenmutation kosten je einen CI-Lauf.
- **M-2** — `authenticator` lässt sich in pgTAP nicht simulieren: `SET SESSION
AUTHORIZATION` verlangt, dass der ursprüngliche Sitzungsbenutzer Superuser
  war; `postgres` ist es in Supabase nicht (E-8). pgTAP kann `session_user`
  deshalb nicht wechseln. Der Negativnachweis auf pgTAP-Ebene lautet daher
  „eine Sitzung, deren Loginrolle nicht `easytree_app` ist" (konkret:
  `postgres`) — die exakte PostgREST-Sitzung beweist erst `auth-journey`.

### ASSUMPTION

- **A-1** — Der lokale Supabase-Stack in CI legt `authenticator` mit denselben
  Eigenschaften an wie das gehostete Projekt. Belegt wird das nicht durch
  Annahme, sondern durch den `auth-journey`-Nachweis: schlüge die Annahme
  fehl, ginge dieser Test rot.
- **A-2** — Der Publish-Pfad ist die **einzige** Stelle, die
  `public.plan_versions` aktualisiert. Grundlage: `grep` über
  `apps/api/src/` findet genau ein `update public.plan_versions`
  (`planning-write.repository.ts:801`). Fällt diese Annahme, scheitert der
  betroffene Pfad mit `42501` — laut, nicht still.

### OPEN QUESTION

- **OQ-1** — Soll die Kanalgrenze langfristig auch für `assignments`,
  `audit_events` und `outbox_messages` gelten? Diese Frage ist echt und wird
  hier **nicht** entschieden (NG-5, BEFUND-2).

### BLOCKER

Keiner. Status: `ready-for-execution`.

### Zwei benannte Nebenbefunde (nicht Teil dieser Korrektur)

- **BEFUND-1** — Verlegt die Anwendung ihre Verbindung je auf den
  Supavisor-Transaktionspooler, lautet `session_user` dort
  `postgres.<pooler-tenant-id>` und **nicht** `easytree_app`. Das
  Veröffentlichen bräche dann — laut, über die Nullzeilen-Ausnahme aus E-12,
  nicht still. Wird im Kopf der Migration und im Runbook benannt.
- **BEFUND-2** — `assignments_update_in_org` und `assignments_insert_in_org`
  prüfen heute **nur** die Organisation, kein fachliches Recht. Jedes aktive
  Mitglied kann Zuweisungen einer Entwurfswoche über PostgREST direkt
  ändern. Das ist ein realer Befund derselben Familie, aber **nicht** der
  gemeldete P1 (dort geht es ausschließlich um die Veröffentlichung). Er wird
  hier dokumentiert und nicht behoben.

## Anforderungen

| ID     | Anforderung                                                                                                                                               | Akzeptanz (binär / GWT)                                                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-1  | Ein Benutzer mit gültigem JWT und `planning.publish` kann `plan_versions.published_at` **nicht** über PostgREST setzen.                                   | **Given** Reisender A (owner) mit gültigem Access-Token und Entwurf `…e251`, **when** `PATCH /rest/v1/plan_versions?id=eq.…e251` mit `{"published_at":…,"published_by":…}`, **then** keine Zeile in der Antwort **und** `published_at is null`. |
| REQ-2  | Nur der serverseitige Command-Pfad veröffentlicht.                                                                                                        | Der Integrationstest gegen eine echte `easytree_app`-Verbindung veröffentlicht erfolgreich; derselbe SQL-Befehl aus einer `postgres`-Sitzung mit `set local role authenticated` bewirkt 0 Zeilen.                                               |
| REQ-3  | Der Serverpfad bleibt unter echter Benutzeridentität und RLS mandantengebunden.                                                                           | `planning-publish.integration.test.ts` bleibt vollständig grün, einschließlich Cross-Tenant-Fall; `auth-journey` veröffentlicht weiterhin über die UI.                                                                                          |
| REQ-4  | Ein erfolgreicher Publish erzeugt atomar `plan_versions.published_at`, synchronisierte `assignments.published_at`, Audit, Outbox und Idempotenzdatensatz. | Bestehende Fälle in `planning-publish.integration.test.ts` bleiben grün (unverändert).                                                                                                                                                          |
| REQ-5  | Ein direkter Tabellenversuch erzeugt **keinerlei** Teilwirkung.                                                                                           | Nach dem abgelehnten Versuch: `assignments.published_at is null`, `count(audit_events where …) = 0`, `count(outbox_messages where …) = 0`, `count(idempotency_records where operation = 'planning.publish_plan') = 0`.                          |
| REQ-6  | `org_id`, `week_key`, `created_at` sind über das Publish-Recht nicht veränderbar.                                                                         | `update … set week_key = …` und `update … set org_id = …` werfen `42501` (Spaltenrecht), nicht `23514`.                                                                                                                                         |
| REQ-7  | `with check` erzwingt jede sicherheitsrelevante Bedingung auf dem neuen Zeilenzustand.                                                                    | Auf dem Laufzeitkanal wirft `update … set published_by = <fremde Id>, published_at = now()` `42501`.                                                                                                                                            |
| REQ-8  | `member` bleibt abgelehnt, `manager`/`owner` funktionieren ausschließlich über den Command.                                                               | pgTAP: `app.has_permission(org, 'planning.publish') = false` für `member`; Integrationstest: Publish als `member`-Subjekt endet in `FORBIDDEN`/0 Zeilen.                                                                                        |
| REQ-9  | Cross-Tenant bleibt unsichtbar.                                                                                                                           | Bestehende Fälle bleiben grün; die fremde Planversion bleibt Entwurf.                                                                                                                                                                           |
| REQ-10 | Rollback nach erzwungenem Fehler bleibt vollständig.                                                                                                      | Die drei `fehlerNach`-Fälle in `planning-publish.integration.test.ts` bleiben grün.                                                                                                                                                             |
| REQ-11 | Der bisherige pgTAP-Positivfall wird **umgewandelt**, nicht entfernt.                                                                                     | `supabase/tests/0011_planning_publish.sql` enthält an derselben Stelle einen Negativfall; die Datei behält oder erhöht ihre Aussagenzahl.                                                                                                       |
| REQ-12 | Keine zweite fachliche Publish-Implementierung in SQL.                                                                                                    | `grep -c "insert into public.audit_events" supabase/migrations/` bleibt unverändert; die Migration fügt genau eine Funktion hinzu, die `session_user` vergleicht.                                                                               |

## Architektur- und Dateigrenzen

**Geändert wird ausschließlich:**

| Datei                                                                       | Art       | Warum                                                                      |
| --------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| `supabase/migrations/20260803120000_0015_planning_publish_permissions.sql`  | Korrektur | Kanalfunktion, Spaltengrenze, verschärfte Policy                           |
| `supabase/tests/0011_planning_publish.sql`                                  | Umbau     | Positivfall → Negativfall, Spaltengrenze, Eigentümerpfad für Triggerbeweis |
| `supabase/tests/0006_planning_invariants.sql`                               | Anpassung | veröffentlicht heute über `authenticated` — muss auf den Eigentümerpfad    |
| `supabase/tests/0007_temporal_and_idempotency.sql`                          | Anpassung | dito                                                                       |
| `apps/api/test/planning-publish.integration.test.ts`                        | Ergänzung | `with check`-Negativfälle auf dem Laufzeitkanal                            |
| `apps/web/e2e/auth-journey/journey.pwtest.ts`                               | Ergänzung | realer PostgREST-Bypassversuch vor dem echten Publish                      |
| `.github/workflows/ci.yml`                                                  | Ergänzung | Passwort für `easytree_app` früher bereitstellen, zwei Gates auf den Kanal |
| `apps/api/src/modules/planning/infrastructure/planning-write.repository.ts` | Kommentar | Fehlermeldung benennt zusätzlich die Kanalgrenze                           |
| `docs/runbooks/planning-publish.md`                                         | Doku      | Betriebshinweis: Loginrolle ist Teil der Sicherheitsgrenze                 |
| `docs/reviews/2026-08-04-eyt-107-p1-gegenmutationen.md`                     | neu       | Protokoll der vier geforderten Gegenmutationen                             |

**Nicht angefasst:** Contracts, OpenAPI, Web-Komponenten, `app.module.ts`,
`tenant-query-runner.ts`, `role-privileges.ts`, `packages/**`.

Alle Pfade liegen im bestehenden PRIL-Manifest (E-14) — das Manifest wird
**nicht** geändert, es wird kein Entwaffnen nötig.

## Aufgaben

Reihenfolge ist bindend: rote Nachweise vor der Migration.

### T-01 — Kanalmessung festschreiben (15 min) · REQ-1, REQ-2

Die Messungen E-6 bis E-9 und E-13 als Kopfkommentar in die Migration
übernehmen, mit Datum und Quelle. Keine Codeänderung.
**Evidenz:** Diff enthält die Zahlen, nicht die Behauptung.

### T-02 — pgTAP 0011: Positivfall in Negativfall umwandeln (40 min) · REQ-1, REQ-5, REQ-6, REQ-11

`supabase/tests/0011_planning_publish.sql`:

- Abschnitt 3 (`manager`): das direkte `update … set published_at` bleibt
  stehen, seine **Erwartung** kehrt sich um — 0 Zeilen Wirkung, `published_at`
  weiterhin `null`. Kommentar benennt M-2 (die Sitzung ist `postgres`, nicht
  `authenticator`; der exakte Kanal wird in `auth-journey` gemessen).
- Neu: `update … set week_key = …` → `42501`; `update … set org_id = …` →
  `42501`.
- Neu: nach dem abgelehnten Versuch je `is(count(*), 0)` auf `audit_events`,
  `outbox_messages` und `idempotency_records` für diese Planversion.
- Neu: `is(app.is_runtime_channel(), false, …)` — direkte Aussage über die
  Funktion.
- Der Triggerbeweis (Sync der Zuweisungen) und die Unveränderlichkeit ziehen
  auf den **Eigentümerpfad** um (`reset role`, danach wieder `set local role
authenticated`), weil `postgres` `BYPASSRLS` trägt und die Policy dort nicht
  greift. Kommentar sagt genau das.
- `plan(n)` an die neue Zahl anpassen.

**Test:** `pnpm exec supabase test db` (nur CI, M-1).
**Erwartung in diesem Schritt:** ROT.

### T-03 — pgTAP 0006 und 0007 auf den Eigentümerpfad (30 min) · REQ-2

Beide Dateien veröffentlichen heute unter `set local role authenticated`
(`0006:113,197,217`, `0007:131,162,187`). Nach der Kanalgrenze bewirken diese
Statements nichts, und die Folgeaussagen (`23P01`, Sync-Zeitstempel) werden
falsch. Die Publish-Statements — und nur sie — laufen künftig als Eigentümer.
`0006:134` (`set week_key` → `23514`) bleibt `23514`, weil der Eigentümer volle
Spaltenrechte hat und der Trigger aus 0010 zuerst greift; das ist zu prüfen,
nicht zu behaupten.

**Erwartung in diesem Schritt:** ROT (0011 aus T-02 bleibt rot).

### T-04 — Integrationstest: `with check` auf dem Laufzeitkanal (35 min) · REQ-7, REQ-8

`apps/api/test/planning-publish.integration.test.ts`, zwei neue Fälle über eine
rohe SQL-Anweisung innerhalb des bestehenden Runners:

- fremdes `published_by` → `42501` (`with check`);
- `set org_id = <fremde Org>` → `42501` (Spaltengrenze).

Beide sind erst auf dem Laufzeitkanal erreichbar — deshalb gehören sie hierher
und nicht in pgTAP.

### T-05 — CI: Laufzeitkanal für die Planungs-Gates (25 min) · REQ-2, REQ-3

`.github/workflows/ci.yml`, Job `db-gates`:

- Neuer Schritt direkt nach „Restart stack" (nach der Rollen-Probe, die
  `easytree_app` löscht und neu anlegen lässt): Passwort provisionieren,
  identisch zum bestehenden Schritt weiter unten.
- `EASYTREE_TEST_DB_URL` der Schritte „Planning invariants gate" und „Planning
  publish gate" auf
  `postgresql://easytree_app:ci-local-app-password@127.0.0.1:54322/postgres`
  umstellen. Beide Suiten arbeiten ausschließlich innerhalb von `set local role
authenticated` (geprüft: `beginAsPlanner`, `runnerAuf`), `probeDatabase` ist
  ein `select 1` — `NOINHERIT` steht dem nicht im Weg.
- Alle übrigen Gates bleiben auf `postgres`; ihre Aussagen betreffen RLS, nicht
  den Kanal.

**Gegenprobe im selben Schritt:** der Publish-Gate-Schritt gibt vor dem Lauf
`session_user` aus, damit der Kanal im Log steht statt geglaubt zu werden.

### T-06 — auth-journey: realer PostgREST-Bypassversuch (40 min) · REQ-1, REQ-5

`apps/web/e2e/auth-journey/journey.pwtest.ts`, neuer Schritt **zwischen**
„Entwurf sichtbar" (Z. ~391) und „veröffentlichen" (Z. ~398) — die Reihenfolge
ist tragend: nach dem echten Publish würde der Unveränderlichkeits-Trigger
ablehnen und einen falschen Positivbefund liefern.

1. Access-Token für Reisenden A holen:
   `POST ${SUPABASE_URL}/auth/v1/token?grant_type=password` mit
   `EASYTREE_JOURNEY_EMAIL_A` / `…_PASSWORT_A` und `apikey: ANON_KEY`.
2. `PATCH ${SUPABASE_URL}/rest/v1/plan_versions?id=eq.<Entwurf>` mit
   `Authorization: Bearer <token>`, `apikey`, `Prefer: return=representation`,
   Body `{"published_at": …, "published_by": <A>}`.
3. Erwartung: leere Repräsentation.
4. Danach über `EASYTREE_JOURNEY_ADMIN_DB_URL` belegen: `published_at is
null`, `assignments.published_at is null`, keine Audit-, Outbox- oder
   Idempotenzzeile.

Der Schritt schreibt seinen Befund in die Reise-Zusammenfassung.
**Erwartung in diesem Schritt:** ROT — heute gelingt der PATCH.

### T-07 — Roten Nachweis in CI erzeugen (20 min Wartezeit) · alle

T-02 bis T-06 committen, pushen, `db-gates` und `auth-journey` beobachten.
Erwartet: beide rot, mit den benannten Fällen. Ergebnis ins
Gegenmutationsprotokoll.

**Ohne diesen Lauf gilt die Korrektur als unbelegt.**

### T-08 — Migration 0015 korrigieren (40 min) · REQ-1, REQ-2, REQ-6, REQ-7, REQ-12

```sql
create or replace function app.is_runtime_channel()
returns boolean language sql stable
set search_path = ''
as $$ select session_user = 'easytree_app' $$;

revoke update on table public.plan_versions from authenticated;
grant update (published_at, published_by) on table public.plan_versions to authenticated;

drop policy plan_versions_update_in_org on public.plan_versions;
create policy plan_versions_update_in_org on public.plan_versions
  for update to authenticated
  using (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.publish')
  )
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.publish')
    and (published_by is null or published_by = auth.uid())
  );
```

Kopfkommentar: Messung (T-01), BEFUND-1 (Pooler), M-2 (Grenze der
pgTAP-Aussage), und warum `with check` die Kanalbedingung wiederholt, obwohl
`using` sie bereits erzwingt — Tiefenverteidigung, ehrlich als solche benannt.

Rollbackblock im Kopf fortschreiben.

### T-09 — Grüner Lauf (20 min Wartezeit) · alle

Push, elf Pflichtchecks auf demselben Head. Kein Weiterarbeiten, bevor der
Lauf gelesen ist.

### T-10 — Gegenmutationen ausführen (je ~20 min) · Nachweisgüte

Vier geforderte Mutationen, **je ein echter CI-Lauf** auf dem PR-Head, danach
zurückgenommen:

| Nr.   | Mutation                                               | Erwartet rot                                                                               |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| GM-P1 | `app.is_runtime_channel()` aus `using` entfernen       | pgTAP 0011 Negativfall; `auth-journey` Bypassversuch                                       |
| GM-P2 | `grant update on plan_versions to authenticated`       | pgTAP 0011 `week_key`/`org_id` → `42501`                                                   |
| GM-P3 | Spaltengrenze entfernen                                | identisch zu GM-P2 — wird ehrlich als **dieselbe** Mutation dokumentiert, nicht als zweite |
| GM-P4 | `published_by = auth.uid()` aus `with check` entfernen | `planning-publish.integration.test.ts`, Urheberfall                                        |

Die Kanalbedingung **im `with check`** ist nicht unabhängig falsifizierbar,
solange `using` sie bereits erzwingt. Das wird als redundante
Tiefenverteidigung dokumentiert, nicht als bestandener Test.

### T-11 — Dokumentation und PR (30 min) · Rechenschaft

- `docs/reviews/2026-08-04-eyt-107-p1-gegenmutationen.md`: ausgeführt /
  nicht ausgeführt getrennt.
- `docs/runbooks/planning-publish.md`: Betriebshinweis (Loginrolle ist Teil
  der Sicherheitsgrenze; Pooler-Wechsel bricht Publish laut).
- PR-Beschreibung: P1-Befund, Korrektur, Regressionstests. **Keine**
  Behauptung eines externen Code-Reviews — Sourcery hat PR #52 wegen seiner
  Größe nicht inhaltlich geprüft.

### T-12 — PRIL und Abschluss (15 min)

`bash scripts/plumbline-scope-guard.sh`, Worktree lesen, elf Checks auf dem
Endhead, Bericht.

## Validierungsbefehle

```bash
# lokal ausführbar
pnpm format && pnpm lint && pnpm typecheck
pnpm --filter @easytree/api exec vitest run test/planning-week-membership.test.ts
bash scripts/plumbline-scope-guard.sh
git diff --cached --name-only

# nur in CI (M-1 — kein Docker auf diesem Rechner)
pnpm exec supabase db reset && pnpm exec supabase test db
EASYTREE_TENANT_TESTS=required \
  EASYTREE_TEST_DB_URL=postgresql://easytree_app:ci-local-app-password@127.0.0.1:54322/postgres \
  pnpm --filter @easytree/api exec vitest run test/planning-publish.integration.test.ts
pnpm --filter @easytree/web exec playwright test -c e2e/auth-journey/config.ts

# Ergebnis lesen, nicht vermuten
gh pr checks 52 --watch
```

## Risiken

- **RISK-1 — Die Kanalgrenze bricht bestehende DB-Gates.** Wahrscheinlichkeit
  hoch, Wirkung mittel: `0006`, `0007`, `0011` und zwei Integrationsgates
  veröffentlichen heute über den `authenticated`-Pfad einer
  `postgres`-Sitzung. Genau deshalb sind T-03 und T-05 eigene Aufgaben und
  nicht Fußnoten von T-08.
- **RISK-2 — Ein Wechsel auf den Supavisor-Pooler bricht Publish**
  (BEFUND-1). Wirkung hoch, Wahrscheinlichkeit niedrig. Abmilderung: laut
  scheitern (E-12) plus Runbookeintrag; **keine** stille Lockerung der
  Bedingung.
- **RISK-3 — Versuchung, das EYT-45-Startgate um eine
  `session_user`-Prüfung zu erweitern.** Bewusst nicht getan (NG-6): das
  Startgate entscheidet heute über Rollenattribute, nicht über Identität, und
  eine harte Startbedingung auf einen Rollennamen würde lokale
  Entwicklungsaufbauten ohne Vorwarnung ausschließen. Der Publish-Pfad meldet
  den Fall bereits laut.
- **RISK-4 — `M-2` wird als vollständiger Beweis gelesen.** Der
  pgTAP-Negativfall misst `postgres`, nicht `authenticator`. Nur
  `auth-journey` misst den echten Kanal. Beide Kommentare sagen das; keine
  Zusammenfassung darf es verschweigen.
- **RISK-5 — Vier Gegenmutationen kosten vier CI-Läufe.** Kein technisches
  Risiko, ein Zeitrisiko. Es wird nicht durch „gedachte" Mutationen abgekürzt.

## Rollback

1. `git revert` der Korrekturcommits — die Migration ist nirgends angewandt
   (remote steht auf 0013), es gibt nichts zurückzurollen.
2. Fällt die Kanalgrenze nach einem Merge in Produktion negativ auf: neue
   Vorwärtsmigration `0016`, die die Policy auf den Stand vor dieser Korrektur
   zurücksetzt (Block steht im Kopf von 0015). Kein Datenverlust: es werden
   weder Tabellen noch Spalten angelegt oder entfernt.
3. Die Spaltengrenze wird mit
   `grant update on table public.plan_versions to authenticated` zurückgenommen.

## Execution Handoff

Ausführende Sitzung beginnt bei **T-01**, arbeitet strikt in Reihenfolge und
hält bei **T-07** an, bis der rote CI-Lauf gelesen ist. Kein Merge, kein
Deploy, kein Jira-Übergang, keine Remote-Migration.

## Stärkstes Gegenargument

> „`session_user` ist eine Deployment-Eigenschaft, keine Sicherheitsgrenze.
> Wer die Anwendung umzieht, an einen Pooler hängt oder die Rolle umbenennt,
> zerbricht ein Sicherheitsversprechen, ohne es zu merken. Eine
> `SECURITY DEFINER`-Publish-Funktion, die nur über einen expliziten,
> vergebenen Ausführungsrechteweg erreichbar ist, wäre robuster."

Das trifft zu und wird nicht kleingeredet. Drei Gründe geben trotzdem den
Ausschlag:

1. Eine `SECURITY DEFINER`-Funktion wäre über PostgREST **ebenfalls**
   erreichbar (`POST /rpc/…`), sobald `authenticated` sie ausführen darf — und
   das muss sie, weil der Laufzeitkanal selbst unter `authenticated` läuft. Der
   Kanalvergleich wäre also **auch dort** nötig; die Funktion käme obendrauf,
   nicht anstelle.
2. Die Alternative hieße, die fachliche Publish-Logik ein zweites Mal in SQL zu
   schreiben. Genau das schließt der Auftrag aus, und aus gutem Grund: zwei
   Implementierungen derselben Regel driften.
3. Der Bruchfall ist **laut**, nicht still (E-12): null betroffene Zeilen
   werfen eine benannte Ausnahme. Ein unbemerkt zerbrochenes
   Sicherheitsversprechen ist damit nicht das erwartete Ergebnis eines Umzugs —
   ein sofort sichtbarer Ausfall ist es.

## Failure-Mode-Kette

1. Die Kanalfunktion wird geschrieben, aber die Policy referenziert sie nicht →
   `auth-journey` bleibt rot. **Gefangen.**
2. Die Policy referenziert sie, aber die Spaltengrenze fehlt → pgTAP `42501`
   fällt. **Gefangen.**
3. Beides steht, aber die CI-Gates verbinden weiter als `postgres` → der
   Publish-Integrationstest scheitert mit der Nullzeilen-Ausnahme aus E-12,
   mit klarer Meldung. **Gefangen.**
4. Alles grün, aber der pgTAP-Negativfall ist vakuos (er misst gar keine
   Wirkung) → GM-P1 macht ihn rot. Bliebe er grün, wäre die Mutation der
   Befund. **Gefangen.**
5. Alles grün, `auth-journey` prüft aber gegen die falsche Planversion → die
   Zusatzprüfung „Entwurf vor dem Versuch, Entwurf nach dem Versuch" schlägt
   an, weil eine bereits veröffentlichte Zeile den Vorher-Zustand verletzt.
   **Gefangen.**
6. Alles grün, aber `authenticator` verhält sich lokal anders als gehostet →
   `auth-journey` misst lokal; die gehostete Messung (E-6) steht daneben.
   Beide müssten gleichzeitig falsch sein. **Restrisiko, benannt.**

## Truth- und Bias-Check

- Der P1-Befund wurde **nicht** geglaubt, sondern nachgemessen: E-1, E-3, E-4,
  E-5 zeigen die Lücke im Quelltext, nicht in der Erzählung.
- Die naheliegende Selbstentlastung „ein Browser benutzt die Tabelle ohnehin
  nicht direkt" wird ausdrücklich nicht verwendet — E-4 belegt, dass die
  Data-API die Tabelle exponiert.
- Zwei Nebenbefunde (BEFUND-1, BEFUND-2) werden benannt, obwohl sie den
  Umfang unbequem machen und keiner davon Teil des Auftrags ist.
- Die Grenze der pgTAP-Aussage (M-2) wird vorab zugegeben, statt sie nach
  einem grünen Lauf als vollständigen Beweis darzustellen.
- Zwei der vier geforderten Gegenmutationen sind in Wahrheit **dieselbe**
  (GM-P2/GM-P3); das wird gesagt, statt vier Häkchen zu erzeugen.
- Eine der geforderten Bedingungen (`with check`-Kanal) ist nicht unabhängig
  falsifizierbar; sie wird als redundante Tiefenverteidigung dokumentiert und
  **nicht** als bestandener Nachweis gezählt.
