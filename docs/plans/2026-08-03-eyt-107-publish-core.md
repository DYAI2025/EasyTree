# EYT-107 Publish Core Implementation Plan

| Feld           | Wert                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| Plan path      | `docs/plans/2026-08-03-eyt-107-publish-core.md`                                    |
| Jira           | EYT-107 (Task, Epic EYT-3, Status _In Arbeit_, gemessen 03.08.2026)                |
| Status         | **ready-for-execution** — PO-Entscheidung 03.08.2026 schließt B-1/OQ-1, OQ-2, OQ-3 |
| Branch         | `feat/eyt-107-publish-core`                                                        |
| Basis-SHA      | `d9b9607338aa83ec6bde46d02efe129a19802b19` (= `origin/master`, PR #51)             |
| Owner/Executor | Agent-Session nach Product-Owner-Freigabe                                          |
| Last updated   | 2026-08-03                                                                         |

---

<!-- GOAL_START -->

## Goal

`POST /planung/versionen` existiert im Vertrag, im OpenAPI-Dokument und im
HTTP-Client — serverseitig gibt es die Route nicht. EYT-107 baut den kleinsten
echten Pfad dahinter: eine autorisierte Nest-Route, ein Application-Command mit
Transaktionsklammer, eine explizite Publish-Aktion in der Planungsoberfläche.

Danach entsteht eine veröffentlichte Planversion ausschließlich so: eine real
angemeldete, berechtigte Person öffnet eine Planungswoche, sieht `Entwurf`,
wählt `Plan veröffentlichen`, und der Server setzt `plan_versions.published_at`
genau einmal — innerhalb einer Transaktion, die Audit, Outbox und
Idempotenzdatensatz mitträgt. Der bestehende Trigger aus Migration 0010
synchronisiert `assignments.published_at`. Ein Wiederholungsversuch mit
demselben Idempotenzschlüssel liefert dieselbe Antwort und veröffentlicht nicht
zweimal. Reload und ein zweiter Browserkontext zeigen dieselbe Version.

Damit ist EYT-107 die Vorbedingung für EYT-109: ab hier gibt es eine
serverseitig bestätigte, unveränderliche Planversions-ID, aus der ein
Kosten-Snapshot entstehen kann. EYT-107 baut diesen Snapshot **nicht**.

Das eigentliche Hindernis ist nicht die Datenbank — die ist seit EYT-49 fertig —
sondern die Authentifizierung. Die Planungsroute hängt an
`TENANT_SUBJECT_RESOLVER` (Produktionsimplementierung liefert immer `null`) und
`DenyAllPlanningAccess` (liefert immer `false`). Der Kostenpfad aus EYT-106
besitzt daneben eine echte Kette: `REQUEST_IDENTITY` → verifiziertes Token →
Session-Liveness → serverseitig aufgelöste Mitgliedschaften und Rechte. Zwei
Auth-Wahrheiten in einem `AppModule`. EYT-107 löst diesen Widerspruch auf, indem
die Planung auf die reale Kette umzieht; ohne das ist jeder Publish-Nachweis nur
ein Nachweis über einen Testharness.

Umfang: Auth-Naht, Publish-Command, HTTP-Route, Migration 0015 (Rechte und
RLS-Zweitmeinung), UI-Aktion, reale Browserreise, Nebenläufigkeits- und
Gegenmutationsnachweise. Kein neuer Pflichtcheck, keine neue Tabelle, keine
zweite Idempotenztabelle, keine zweite Wochenrechnung.

**Non-Goals.** Mitarbeiterbestätigung, Worker-Zustellung, Ressourcen-,
Abwesenheits-, Qualifikations-, Zertifikats-, Fahrzeug- und Geräteprüfungen.
Kein Organisationsumschalter (EYT-14). Kein Abschluss von EYT-18. Kein
Tageskosten-Snapshot (EYT-109), kein XLSX-Export (EYT-110). Kein
Produktionsdeployment, keine Railway-Änderung, keine Produktivmigration.

**Ehrlichkeitsgrenze, die in Code und Oberfläche stehen muss.** Beim
Veröffentlichen werden genau zwei fachliche Regeln geprüft, die es heute gibt:
Intervallüberschneidung derselben Person (blockierend, zusätzlich von
PostgreSQL erzwungen) und Wochenkapazität (implementiert, aber mit
`NO_CAPACITY_LIMIT` verdrahtet und damit wirkungslos). Die Konfliktcodes
`EMPLOYEE_INACTIVE` und `WORKSITE_NOT_PUBLISHABLE` stehen im Vertrag, werden
aber von keiner Regel erzeugt. Abwesenheiten, Qualifikationen, Zertifikate,
Ressourcen, Fahrzeuge, Geräte, Reise- und Ruhezeiten sind ungeprüft. EYT-18
bleibt offen.

<!-- GOAL_END -->

Goal-Länge: **2 971 Unicode-Zeichen** (Grenze 4 000) — gemessen, siehe
[§16 Truth-Check](#16-plausibilitäts-und-wahrheitsprüfung).

---

## 1. Evidenz und Quellgrenze

### 1.1 Repository-Gate (ausgeführt 03.08.2026)

| Messung                                | Ergebnis                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pwd`                                  | `/Users/benjaminpoersch/EasyTree`                                                                                      |
| `git rev-parse origin/master`          | `d9b9607338aa83ec6bde46d02efe129a19802b19` (PR #51, EYT-134 Cookie-Nachweis)                                           |
| PR #45 im Verlauf                      | `abff0c63c2d3b59d70223d5949070358f2b53379` — vorhanden, wie erwartet                                                   |
| **Lokaler `master` bei Sessionbeginn** | **`092ada2` — 25 Commits HINTER `origin/master`** (`git rev-list --left-right --count origin/master...HEAD` → `25  0`) |
| Arbeitsbaum                            | nicht sauber: 1 geänderte, 6 ungetrackte Pfade (siehe unten)                                                           |
| Arbeitsbranch dieses Plans             | `feat/eyt-107-publish-core`, erzeugt **aus `origin/master`**, HEAD `d9b9607`                                           |

**Befund, der diesen Plan fast falsch gemacht hätte.** Der erste
Evidenzdurchlauf lief gegen den lokalen `master` und meldete unter anderem: kein
`apps/api/src/platform/idempotency/`, kein `auth-journey`-Job, höchste Migration
0013, kein `apps/web/e2e/auth-journey/`. Alle vier Aussagen sind **falsch für
`origin/master`**. Der Branch wurde deshalb neu aus `origin/master` gezogen und
die betroffene Evidenz vollständig erneut erhoben. Wer diesen Plan ausführt,
muss zuerst `git rev-parse HEAD` gegen `d9b9607` prüfen.

Arbeitsbaum bei Branch-Erstellung (nichts gelöscht, nichts gestaget, nichts
überschrieben — die Dateien wandern unverändert mit):

```
 M docs/canvas/sprint-5-daily-cost-export.canvas.md
?? docs/architecture/EasyTree – Softwaredokumentation.md
?? docs/plans/2026-08-02-eyt-108-rate-succession.md
?? docs/plans/2026-08-02-eyt-133-env-template-parser-hardening.md
?? docs/plans/2026-08-02-eyt-133-secret-guard-hardening.md
?? docs/plans/2026-08-02-sprint-5-durchstich-abschluss.md
?? scripts/ops/
```

`docs/canvas/sprint-5-daily-cost-export.canvas.md` unterscheidet sich zwischen
`092ada2` und `d9b9607` **nicht** (`git diff --name-only HEAD origin/master --
<pfad>` → leer), der Branchwechsel war daher konfliktfrei. **Kein Blocker**,
aber: diese sieben Pfade gehören nicht zu EYT-107 und dürfen in keinen
EYT-107-Commit geraten. Deshalb gilt in jeder Task: nur benannte Pfade stagen,
danach `git diff --cached --name-only` lesen.

### 1.2 Source Map

Autorität: **A1** = ausgeführte Messung/Quelltext auf `d9b9607`; **A2** = Jira/
Confluence (Produktautorität); **A3** = Repo-Dokumentation (kann veralten);
**A4** = historische PR-Beschreibung (nur Begründung, nie Ist-Zustand).

| #   | Quelle                  | Pfad / Referenz                                                                                               | Zweck                                                                              | Aut. | Aktualität           | Gelesen             | Konflikt |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---- | -------------------- | ------------------- | -------- |
| Q1  | Vertrag Planung         | `packages/contracts/src/planning/schemas.ts`                                                                  | `PublishPlanCommandSchema`, `PublishedPlanVersionSchema`, `PlanningWindowSchema`   | A1   | d9b9607              | ja (vollständig)    | —        |
| Q2  | Port                    | `packages/contracts/src/planning/gateway.ts:33-49`                                                            | `publishPlan(input, options)` Signatur                                             | A1   | d9b9607              | ja                  | —        |
| Q3  | HTTP-Client             | `packages/contracts/src/http/planning-gateway.ts:146-221`                                                     | Client **ist implementiert**: `POST /planung/versionen`, 409→`STALE_VERSION`       | A1   | d9b9607              | ja                  | K1       |
| Q4  | OpenAPI-Generator       | `packages/contracts/src/openapi/document.ts:217-228`                                                          | Operation `publishPlan` bereits deklariert, 201 + 400/401/403/409                  | A1   | d9b9607              | ja                  | K2       |
| Q5  | Controller Planung      | `apps/api/src/modules/planning/interface/http/planning.controller.ts`                                         | Ist-Naht: `TENANT_SUBJECT_RESOLVER` + `PLANNING_ACCESS_POLICY`                     | A1   | d9b9607              | ja (vollständig)    | K3       |
| Q6  | Schreibport             | `apps/api/src/modules/planning/application/planning-writes.port.ts`                                           | nur `validateDraft` + `createAssignment`                                           | A1   | d9b9607              | ja (vollständig)    | —        |
| Q7  | Schreibrepository       | `apps/api/src/modules/planning/infrastructure/planning-write.repository.ts`                                   | Transaktionsmuster, Idempotenz, Audit, Outbox, `fehlerNach`-Testhaken              | A1   | d9b9607              | ja (vollständig)    | K4       |
| Q8  | Access-Port             | `apps/api/src/modules/planning/application/planning-access.port.ts`                                           | `DenyAllPlanningAccess` = Produktionsstand                                         | A1   | d9b9607              | ja (vollständig)    | —        |
| Q9  | Kommando-Port (tot)     | `apps/api/src/modules/planning/application/planning-commands.port.ts`                                         | zweite, abweichende `publishPlan`-Deklaration, **null Implementierungen**          | A1   | d9b9607              | ja (vollständig)    | K5       |
| Q10 | Domainregeln            | `apps/api/src/modules/planning/domain/draft-validation.ts`                                                    | erzeugt nur `EMPLOYEE_INTERVAL_OVERLAP` + `EMPLOYEE_WEEKLY_CAPACITY`               | A1   | d9b9607              | ja (vollständig)    | K6       |
| Q11 | Wurzel                  | `apps/api/src/app.module.ts`                                                                                  | verdrahtet Planung deny-all, Kosten real; `IDEMPOTENCY_STORE` vorhanden            | A1   | d9b9607              | ja (vollständig)    | K3       |
| Q12 | Reale Identität         | `apps/api/src/platform/auth/request-identity.ts`                                                              | Cookie ODER Bearer, verifiziert, Liveness, kein Cache                              | A1   | d9b9607              | ja (vollständig)    | —        |
| Q13 | Kostencontroller        | `apps/api/src/modules/costs/interface/http/costs.controller.ts`                                               | Muster `zugang()`: Identität → Mitgliedschaften → Policy → Arbeit                  | A1   | d9b9607              | ja (vollständig)    | —        |
| Q14 | Kostenpolicy            | `apps/api/src/modules/costs/application/cost-access.policy.ts`                                                | `authorize(memberships, requestedOrgId, permission)`, atomare Rechte               | A1   | d9b9607              | ja (vollständig)    | —        |
| Q15 | Mitgliedschaften        | `apps/api/src/modules/tenancy/infrastructure/membership-repository.ts`                                        | liest `memberships` + `role_permissions` über `TenantQueryRunner`                  | A1   | d9b9607              | ja (vollständig)    | —        |
| Q16 | Rechtemodell            | `supabase/migrations/20260801060000_0013_cost_permissions_and_rates.sql:29-104`                               | `role_permissions`, `app.has_cost_permission`, nur `costs.*` gesät                 | A1   | d9b9607              | ja                  | —        |
| Q17 | Planungsschema          | `supabase/migrations/20260727020300_0007_planning.sql`                                                        | `plan_versions`, `assignments`, Grants, RLS                                        | A1   | d9b9607              | ja (vollständig)    | K7       |
| Q18 | Invarianten             | `supabase/migrations/20260727050000_0010_planning_invariants.sql`                                             | EXCLUDE, Sync-Trigger, Unveränderlichkeit, Spalten-Grants                          | A1   | d9b9607              | ja (vollständig)    | —        |
| Q19 | Audit/Outbox            | `supabase/migrations/20260727020400_0008_audit_outbox.sql`                                                    | Spalten, Grants, `unique (org_id, message_type, idempotency_key)`                  | A1   | d9b9607              | ja (Struktur)       | K8       |
| Q20 | Idempotenz-DB           | `supabase/migrations/20260729010000_0012_idempotency_records.sql`                                             | Tabelle, `operation`, `app.lock_idempotency_key`                                   | A1   | d9b9607              | ja (vollständig)    | —        |
| Q21 | Idempotenz-Port         | `apps/api/src/platform/idempotency/{idempotency-store,pg-idempotency-store}.ts`                               | Plattformport `lock/find/remember`, nimmt `TenantQuery` herein                     | A1   | d9b9607              | ja (vollständig)    | K4       |
| Q22 | EYT-108-Präzedenz       | `apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts:147-313`                                     | Vorlage: Sperre → Replay → Fachlogik → `remember`, SQLSTATE-Mapping                | A1   | d9b9607              | ja                  | —        |
| Q23 | Konformität             | `apps/api/test/openapi-route-conformance.test.ts:67-71,183-216`                                               | `NOT_YET_IMPLEMENTED` mit `POST /planung/versionen`, beidseitig rot                | A1   | d9b9607              | ja                  | K9       |
| Q24 | Drift                   | `packages/contracts/test/openapi-drift.test.ts`                                                               | byteweise + Idempotency-Key-Pflicht je POST                                        | A1   | d9b9607              | ja                  | —        |
| Q25 | CI                      | `.github/workflows/ci.yml`                                                                                    | **elf** Jobs inkl. `auth-journey` (Z. 454-535)                                     | A1   | d9b9607              | ja                  | K10      |
| Q26 | Reise-Harness           | `apps/web/e2e/auth-journey/{config,global-setup,global-teardown,fixtures.sql,teardown.sql,journey.pwtest.ts}` | echte Anmeldung, zweiter Browserkontext, Artefakte, Teardown                       | A1   | d9b9607              | ja                  | —        |
| Q27 | Read-Through-Harness    | `scripts/read-through-harness.sh`, `apps/api/test/harness/server.ts`                                          | ersetzt **genau** `TENANT_SUBJECT_RESOLVER` + `PLANNING_ACCESS_POLICY`             | A1   | d9b9607              | ja                  | —        |
| Q28 | Planungsoberfläche      | `apps/web/components/planning-window-view.tsx`                                                                | `Stand`-Anzeige vorhanden, **keine** Publish-Aktion                                | A1   | d9b9607              | ja                  | K11      |
| Q29 | Konflikt-UI-Präzedenz   | `apps/web/components/rate-management.tsx:32-48,184-291`                                                       | `STALE_VERSION` → `StateBanner` warning + Neuladen                                 | A1   | d9b9607              | ja                  | —        |
| Q30 | UI-Primitive            | `packages/ui/src/{index,status-badge,state-banner,error-state}.ts(x)`                                         | neun Primitive; `StatusBadge` kennt `published`/`draft`                            | A1   | d9b9607              | ja                  | K11      |
| Q31 | Sitzung/Rechte im Web   | `apps/web/lib/session-provider.tsx`, `apps/web/components/{app-shell,kosten-zugang}.tsx`                      | `hatRecht(...)`, Seitenwächter-Muster                                              | A1   | d9b9607              | ja                  | K12      |
| Q32 | Architekturregeln       | `apps/api/test/architecture/rules.ts`, `apps/api/test/architecture.test.ts`                                   | Modulgrenzen, `api-dependency-allowlist`                                           | A1   | d9b9607              | ja                  | —        |
| Q33 | Besitzregister          | `apps/api/src/modules/module-catalogue.ts`                                                                    | `plan_versions`/`assignments` → `planning`; `audit_events` → `audit`               | A1   | d9b9607              | ja                  | K13      |
| Q34 | Metagate                | `supabase/tests/0005_schema_meta_gate.sql:26,46-79,216-246`                                                   | `plan(10)`, `EXPECTED_TABLES`, zwei Lock-Funktionen benannt                        | A1   | d9b9607              | ja                  | —        |
| Q35 | Schreibpfad-Integration | `apps/api/test/planning-write.integration.test.ts`                                                            | Vorlage für Nebenläufigkeit, Teilwirkung, Report-Zeile                             | A1   | d9b9607              | ja                  | K14      |
| Q36 | Jira EYT-107            | `https://dyai2026.atlassian.net/browse/EYT-107`                                                               | Ziel, 10 AK, Out of Scope, `blocks EYT-109`, `relates EYT-18`                      | A2   | 03.08.2026 13:00     | ja                  | K15      |
| Q37 | Sprint-5-Seite          | Confluence 8552449                                                                                            | S5-REQ-03: Publish als unveraenderliche Kostenquelle, Reihenfolge, Scope-Grenze    | A2   | Seite vom 29.07.2026 | **ja** (03.08.2026) | K16      |
| Q38 | Basisdesign v2.0        | Confluence 8814623                                                                                            | verbindliche Zustandsformen, CTA-, Fokus- und Kontrastregeln, Navigationsfilterung | A2   | Seite vom 30.07.2026 | **ja** (03.08.2026) | K17      |
| Q39 | CLAUDE.md               | `CLAUDE.md`                                                                                                   | Projektregeln                                                                      | A3   | teilweise veraltet   | ja                  | K10, K13 |
| Q40 | PO-Entscheidung         | Sitzung 03.08.2026                                                                                            | Rollenmatrix, Option A bestaetigt, OQ-2/OQ-3 geschlossen                           | A2   | 03.08.2026           | ja                  | —        |

### 1.3 Gemessene Konflikte

- **K1 — Der Client kann veröffentlichen, der Server nicht.**
  `HttpPlanningGateway.publishPlan` ist vollständig implementiert und sendet
  `POST /planung/versionen` samt `Idempotency-Key`. Serverseitig existiert die
  Route nicht (`NOT_YET_IMPLEMENTED`, Q23). EYT-107 schließt genau diese Lücke.
- **K2 — Der Vertrag ist fertig, das Dokument auch.** `PublishPlanCommand`
  (`weekKey`, `expectedVersionId: Id|null`) und `PublishedPlanVersion`
  (`versionId`, `weekKey`, `publishedAtUtc`, `assignmentIds`) existieren, und
  `openapi/v1.json` führt die Operation bereits. **Folge: EYT-107 braucht keine
  Vertragsänderung und kein `openapi:write`** — solange kein Feld und kein
  Header hinzukommt.
- **K3 — Zwei Auth-Wahrheiten in einem `AppModule`.** `TENANT_SUBJECT_RESOLVER`
  → `UnauthenticatedSubjectResolver` (immer `null`) und `PLANNING_ACCESS_POLICY`
  → `DenyAllPlanningAccess` (immer `false`) gegen `REQUEST_IDENTITY` +
  `MembershipCostAccessPolicy` beim Kostenpfad. Das ist das zentrale
  Architekturthema, siehe [§5](#5-plan-gate-planning-auth).
- **K4 — Zwei Idempotenz-Implementierungen.** Der Plattformport `IdempotencyStore`
  existiert und wird von den Kosten benutzt; das Planungsrepository baut
  dasselbe Protokoll als rohes SQL nach (Q7 Z. 340-348 vs. Q21).
- **K5 — Zwei `publishPlan`-Deklarationen.** `PlanningCommands.publishPlan`
  (`{assignmentIds}` → `PlanVersionId`) hat null Implementierungen und
  widerspricht der Vertragsform (`weekKey` + `expectedVersionId`).
- **K6 — Zwei der vier Konfliktcodes werden nie erzeugt.**
  `assignment-draft.ts:29-30` behauptet „Hier stehen ausschliesslich Codes, die
  von Code in diesem Repository auch **erzeugt** werden". Gemessen: für
  `EMPLOYEE_INACTIVE` und `WORKSITE_NOT_PUBLISHABLE` existiert kein Produzent.
  Zusätzlich ist `EMPLOYEE_WEEKLY_CAPACITY` mit `NO_CAPACITY_LIMIT` verdrahtet
  (Q7 Z. 277-280) und damit wirkungslos.
- **K7 — Wochenbindung fehlt weiterhin.** Kein Constraint, kein Trigger, kein
  Check verknüpft `assignments.starts_at_utc` mit `plan_versions.week_key`. Die
  EYT-49-Lücke ist **nicht** geschlossen; `planning-invariants.integration.test.ts`
  nutzt sie sogar bewusst aus.
- **K8 — Audit hat keinen Eindeutigkeitsschlüssel.** `outbox_messages` trägt
  `unique (org_id, message_type, idempotency_key)`; `audit_events` trägt nur
  `primary key (id)` und `unique (id, org_id)`. Gegen ein doppeltes
  **Auditereignis** schützt allein der Idempotenz-Replay, nicht das Schema.
- **K9 — `NOT_YET_IMPLEMENTED` ist beidseitig scharf.** Route bauen ohne den
  Eintrag zu entfernen → rot (`stale`). Eintrag entfernen ohne Route → rot
  (`undeclared`).
- **K10 — CLAUDE.md ist an drei Stellen veraltet:** „Ten jobs on master"
  (tatsächlich elf, `auth-journey` fehlt in der Aufzählung), „Eight of the nine
  contract operations are still unimplemented" (`NOT_YET_IMPLEMENTED` hat sechs
  Einträge), „the one frozen list of ten slugs" (`MODULE_SLUGS` hat elf, `costs`
  kam mit EYT-105 dazu). CLAUDE.md ist hier **nicht** Autorität.
- **K11 — `StatusBadge` kennt `published`/`draft`, die Planungsansicht benutzt
  es nicht.** Sie rendert `Stand` als reinen Text in `<p>`; die einzige Stelle
  der App mit echter Entwurf/Veröffentlicht-Unterscheidung verwendet das dafür
  gebaute Primitive nicht.
- **K12 — `/planung` hat keinen Seitenwächter.** `AppShell` zeigt den
  Planungslink **unbedingt**, während die API jede Planungsanfrage mit 401/403
  beantwortet. `/kosten` hat mit `KostenZugang` das Gegenmuster.
- **K13 — Besitzregister vs. Laufzeit.** `TABLE_OWNERSHIP` weist `audit_events`
  dem Modul `audit` zu, aber das Planungsrepository schreibt sie bereits direkt
  (Q7 Z. 537-553) und die Suite ist grün: der einzige SQL-Tabellenwächter
  (`costs-touches-only-own-tables`) ist auf `apps/api/src/modules/costs/`
  begrenzt. Für die Planung existiert **keine** solche Regel.
- **K14 — `planning-write.integration.test.ts` nennt vier Gegenmutationen im
  Kopf, führt aber keine aus.** Genau der Fehler, den dieser Plan bei sich selbst
  vermeiden muss (siehe [§11](#11-nebenläufigkeit-und-gegenmutationen)).
- **K15 — Jira AK8 enthält eine halbe Zusage außerhalb dieses Tickets:** „…
  der Kostenpfad akzeptiert nur deren serverseitige ID." Dieser Halbsatz wird in
  [§10](#10-kostenpfad-abgrenzung) ausdrücklich abgegrenzt.
- **K16 — Die Sprint-5-Seite ist als Repositoryquelle veraltet.** Sie nennt
  `master = f9da445…` und „zehn CI-Gates"; gemessen sind `d9b9607` und elf Jobs.
  Für Produktabsicht bleibt sie Autorität, für Repositoryfakten nicht. Derselbe
  Halbsatz wie K15 steht dort in S5-REQ-03 — die Abgrenzung in §10 gilt für
  beide Quellen gleichermaßen.
- **K17 — Das Basisdesign nennt Komponenten, die EYT-107 nicht baut.**
  `PublishDiffSheet`, `PlanningMatrix`, `TimelineView`, `PlanningInspector` sind
  Slice-2-Flächen. EYT-107 liefert die Publish-**Aktion** und die
  Zustandsdarstellung, **keinen** Publish-Diff und keine Wochenmatrix. Das wird
  nicht als erfüllt behauptet (§3.1, letzter Absatz).

---

## 2. Ist-Zustand in zwölf Sätzen

1. `POST /planung/versionen` ist im Vertrag, im OpenAPI-Dokument und im
   HTTP-Client vollständig vorhanden; der Server kennt die Route nicht.
2. `PlanningWrites` bietet `validateDraft` und `createAssignment`, keinen
   Publish-Pfad; `PlanningCommands.publishPlan` ist eine tote, abweichend
   geformte Zweitdeklaration.
3. Der `PlanningController` löst das Subjekt über `TENANT_SUBJECT_RESOLVER`
   auf, dessen Produktionsimplementierung immer `null` liefert → 401.
4. `PLANNING_ACCESS_POLICY` ist in Produktion `DenyAllPlanningAccess` → 403.
5. Der Kostenpfad benutzt daneben `REQUEST_IDENTITY` (Cookie oder Bearer,
   signaturgeprüft, Session-Liveness) und löst Mitgliedschaften plus Rechte
   serverseitig über `memberships` × `role_permissions` auf.
6. `role_permissions` kennt heute ausschließlich vier `costs.*`-Rechte; für die
   Planung existiert **kein** Recht, weder im Code noch in der Datenbank.
7. `plan_versions.published_at` ist autoritativ; ein Trigger
   (`plan_versions_publish_assignments`, security definer) spiegelt ihn in
   derselben Transaktion nach `assignments.published_at`.
8. `assignments.published_at` ist der Rolle `authenticated` per Spalten-Grant
   entzogen; `plan_versions` trägt dagegen weiterhin ein volles
   `update`-Grant und eine RLS-Policy, die **nur** die Organisation prüft.
9. `assignments_no_published_overlap` (partieller EXCLUDE, nur veröffentlichte
   Zeilen) macht das Veröffentlichen eines überlappenden Entwurfs auf
   Datenbankebene unmöglich — als `23P01`, nicht als Fachcode.
10. `app.lock_idempotency_key(operation, key)` und die Tabelle
    `idempotency_records` mit Spalte `operation` sind vorhanden und generisch;
    ein Plattformport (`IdempotencyStore`) kapselt sie bereits.
11. In der Oberfläche existiert die Entwurf/Veröffentlicht-Anzeige (`Stand`),
    aber keine Publish-Aktion, kein `expectedVersionId` und kein Seitenwächter.
12. CI hat elf Jobs; `auth-journey` fährt die **echte** API (`dist/main.js`) mit
    echter Anmeldung und zweitem Browserkontext — und kann `/planung` heute
    strukturell nicht erreichen, weil Punkt 3 und 4 gelten.

---

## 3. Annahmen, fehlende Information, offene Fragen, Blocker

### 3.0 Verbindliche Rollenmatrix (PO-Entscheidung 03.08.2026)

| Rolle     | `planning.read` | `planning.write` | `planning.publish` |
| --------- | --------------- | ---------------- | ------------------ |
| `owner`   | ja              | ja               | ja                 |
| `manager` | ja              | ja               | ja                 |
| `member`  | **nein**        | **nein**         | **nein**           |

Harte Bedingungen, die aus dieser Entscheidung Testfälle werden:

1. `planning.publish` ist ein **eigenständiges atomares Recht**;
   `planning.write` impliziert es **nicht**. → REQ-S-03, T-5, T-13.
2. Keine Rollenprüfung im Controller; Rollen werden serverseitig auf atomare
   Rechte abgebildet (`role_permissions`). → REQ-S-04.
3. API und PostgreSQL/RLS prüfen **unabhängig**. → REQ-S-05, GM-8.
4. Ein `member` sieht keine Publish-Aktion **und** wird bei direktem API-Aufruf
   abgelehnt. → REQ-F-10, REQ-F-12, T-17 (Reise B).
5. Organisationsdaten aus Body oder URL autorisieren nichts. → REQ-S-02.
6. Keine stille Auswahl bei mehreren aktiven Organisationen. → A-2.

**B-1/OQ-1 ist damit geschlossen.** Die Matrix ist keine Empfehlung dieses
Plans mehr, sondern Vorgabe; sie steht 1:1 in Migration 0015 (T-4).

### ASSUMPTION

- ~~**A-1 — Rollenzuordnung für Publish.**~~ **ENTSCHIEDEN 03.08.2026, keine
  Annahme mehr.** Siehe [§3.0 Rollenmatrix](#30-verbindliche-rollenmatrix-po-entscheidung-03082026).
- **A-2 — Organisationsauswahl bleibt implizit.** Die Publish-Route ruft die
  Policy mit `requestedOrganisationId = null` auf: genau eine aktive
  Mitgliedschaft ist eindeutig, mehrere ergeben `ORG_CONTEXT_REQUIRED` (400).
  Das entspricht dem heutigen Verhalten des Planungsrepositories
  (`AMBIGUOUS_ORGANISATION`) und vermeidet eine Vertrags- und
  OpenAPI-Änderung. Der Organisationsheader bleibt EYT-14.
- **A-3 — `EMPLOYEE_INACTIVE` / `WORKSITE_NOT_PUBLISHABLE` werden auch beim
  Publish nicht erzeugt.** Sie sind heute von keiner Regel produziert; sie beim
  Veröffentlichen einzuführen wäre eine **neue** Fachregel, nicht die
  Wiederholung einer bestehenden (AK3 sagt „heute implementierte"). Folge: ein
  Entwurf mit inzwischen deaktivierter Person ist veröffentlichbar. Das gehört
  in die Dokumentation und in den UI-Hinweis. Siehe OQ-2.
- **A-4 — Die Wochenbindung wird serverseitig geprüft, nicht datenbankseitig.**
  Begründung in [§6.4](#64-wochenbindung-k7).

### MISSING

- ~~**M-1 — Confluence 8552449 und 8814623 nicht gelesen.**~~ **ERLEDIGT
  03.08.2026** — beide gelesen, Ergebnis in
  [§3.1](#31-übernommene-aussagen-aus-confluence) und in der Source Map (Q37/Q38).
- **M-2 — Kein lokaler Supabase-Stack auf dieser Maschine** (`MEMORY.md`:
  „SQL only runs in CI"). Migration 0015 und alle pgTAP-/Integrationsnachweise
  laufen erstmals in `db-gates`. Das ist eine Evidenzgrenze, kein Blocker.

### 3.1 Übernommene Aussagen aus Confluence

**Seite 8552449 — Sprint 5** (gelesen 03.08.2026, Stand der Seite 29.07.2026).
Nur das für EYT-107 Verbindliche, wörtlich aus S5-REQ-03:

- „Der vorhandene `publishPlan`-Vertrag erhält einen autorisierten, idempotenten
  und auditierten Serverpfad." → REQ-F-01, REQ-F-02, REQ-D-04.
- „Nur ein konfliktfreier Entwurf wird atomar veröffentlicht." → REQ-F-08.
- „Der Kostenpfad akzeptiert ausschließlich eine veröffentlichte
  Planversions-ID." → **derselbe Halbsatz wie Jira AK8**; Abgrenzung in
  [§10](#10-kostenpfad-abgrenzung), er wird in EYT-107 nicht erfüllt.
- „Noch nicht vorhandene Ressourcen-/Abwesenheitsregeln werden nicht als geprüft
  behauptet; EYT-18 bleibt bis zu diesen Slices offen." → REQ-DOC-02.
- Die Seite bestätigt außerdem die Publish-Position in der Reihenfolge (Platz 4,
  nach EYT-106, vor EYT-108/109/110) und nennt Publish ausdrücklich
  „unveränderliche Kostenquelle".

_Hinweis zur Aktualität:_ Die Seite nennt als Baseline `master = f9da445…` und
„zehn CI-Gates". Beides ist überholt (`d9b9607`, elf Jobs). Für Fakten über das
Repository ist die Seite **nicht** Autorität; für Produktabsicht schon.

**Seite 8814623 — Basisdesign v2.0** (gelesen 03.08.2026, Stand 30.07.2026,
Status „verbindliche Designvorgabe"). Verbindlich für T-15:

- Leitregel: „Die Oberfläche darf Komplexität verdichten, aber keine fachliche
  Unsicherheit verstecken." Entwurf, veröffentlicht, Konflikt und veraltet
  müssen **ohne reine Farbcodierung** erkennbar bleiben. → REQ-NF-02.
- Kopfbereich der Planung trägt „klare Status- und Publish-Aktion". → REQ-F-12.
- Zustandsformen, wörtlich: **Entwurf** = „gestrichelte Kontur + Text
  ‚Entwurf'"; **Veröffentlicht** = „durchgehende Kontur + linke grüne Kante +
  Text"; **Konflikt** = „rote Kontur + Anzahl + Konfliktcode"; **Veraltet** =
  „neutrale Leiste ‚Plan wurde geändert — neu laden'". → REQ-NF-05.
- „Ein primärer CTA pro Bildschirm"; „Desktop-Buttons mindestens 40 px";
  „Fokus sichtbar und mindestens 3:1 zur angrenzenden Fläche". → REQ-NF-03/06.
- Pflichtzustände jeder datenabhängigen Fläche: Loading, Empty, Success, Error,
  **Forbidden**, **Unauthenticated**, **Stale Version**, Offline read-only,
  Partial data, Retry. → REQ-NF-01.
- „Die Navigation … wird serverseitig nach atomaren Rechten gefiltert. Ein
  sichtbarer Navigationspunkt ersetzt keine Autorisierung." → schließt K12:
  der Planungs-Navigationspunkt wird auf `planning.read` gefiltert (T-15).
- Semantische Tokens für die Zustände existieren als Vorgabe
  (`state.published.bg`, `state.draft.text/bg`, `state.danger.*`,
  `state.info.*`, `action.primary`).

**Ausdrücklich NICHT übernommen:** Die Komponentenliste der Seite nennt
`PublishDiffSheet` und `PlanningMatrix` als Admin-Komponenten (Slice 2). Ein
Publish-**Diff** ist weder in EYT-107s Akzeptanzkriterien noch in seinem Umfang;
er wird hier nicht gebaut und nicht als erfüllt behauptet. Ebenso bleibt die
Wochenmatrix EYT-72/EYT-114.

### OPEN QUESTION

_Alle drei offenen Fragen sind durch die PO-Entscheidung vom 03.08.2026
geschlossen. Sie bleiben mit ihrer Auflösung stehen, damit später nachvollziehbar
ist, was entschieden wurde und was daraus folgte._

- **OQ-1 — Welche Rollen dürfen veröffentlichen? → GESCHLOSSEN.** Rollenmatrix
  in [§3.0](#30-verbindliche-rollenmatrix-po-entscheidung-03082026).
  `owner` und `manager` erhalten alle drei Rechte, `member` keines.
- **OQ-2 — Entwurf mit inzwischen deaktivierter Person veröffentlichbar? →
  GESCHLOSSEN, nicht blockierend.** PO-Vorgabe: die Codes `EMPLOYEE_INACTIVE`
  und `WORKSITE_NOT_PUBLISHABLE` werden **nicht** als geprüfte Regeln behauptet,
  es wird **keine** neue Businesslogik nur wegen existierender Codes erfunden,
  und die Lücke wird als bekannte Grenze des Publish-Cores dokumentiert.
  **Erneut verifiziert auf `d9b9607`** (03.08.2026): die einzigen
  `conflicts.push`-Stellen sind `draft-validation.ts:41` und `:59` und erzeugen
  `EMPLOYEE_INTERVAL_OVERLAP` bzw. `EMPLOYEE_WEEKLY_CAPACITY`; die beiden
  anderen Codes existieren ausschließlich in der eingefrorenen Liste
  (`assignment-draft.ts:39-40`), der Anzeigetextmap
  (`planning-write.repository.ts:78-79`), dem Vertragsenum
  (`schemas.ts:63-64`) und dem generierten `v1.json`. → A-3, REQ-DOC-02.
- **OQ-3 — Darf `TENANT_SUBJECT_RESOLVER` entfallen? → GESCHLOSSEN als
  Architekturentscheidung.** PO-Vorgabe: entfernen, **sofern nach der Migration
  kein produktiver Verbraucher verbleibt**. Isolierte Testhelfer dürfen
  existieren, aber weder als Produktionspfad noch als Beweis der realen
  Auth-Reise. → T-7 misst das mit
  `git grep -n "TENANT_SUBJECT_RESOLVER" -- apps/api/src apps/web packages`
  (Produktionsquellen, ohne `test/`); T-6 stellt den Harness vorher um.

### BLOCKER

**Keiner.** B-1 ist mit der Rollenentscheidung geschlossen; ein neuer Sicherheits-,
Daten-, Autorisierungs- oder Migrationsblocker wurde bei der Finalisierung nicht
gefunden. Der Railway-Zustand (`BLOCKED_MISSING_EASYTREE_APP_PASSWORD`) ist für
diesen Plan kein Blocker: EYT-107 fasst keine Produktionsumgebung an und wird
ausdrücklich nicht deployt.

Der Planstatus ist damit **`ready-for-execution`**.

---

## 4. Requirements

Jede ID ist stabil und wird von Tasks und Tests referenziert. „Given/When/Then"
oder binär — keine Absichtserklärungen.

### REQ-F — Funktional

| ID       | Anforderung                                                                                                                          | Akzeptanz                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-F-01 | `POST /planung/versionen` existiert als Nest-Route und erfüllt den bestehenden Vertrag ohne Vertragsänderung.                        | `openapi-route-conformance.test.ts` ist grün **und** `NOT_YET_IMPLEMENTED` enthält den Eintrag nicht mehr. `openapi-drift.test.ts` bleibt grün ohne `openapi:write`.                         |
| REQ-F-02 | Die Route verlangt einen vertragsgültigen `Idempotency-Key`-Header.                                                                  | Given kein/ungültiger Header, When POST, Then 400 mit `type = …:planning:missing-idempotency-key`, und keine Zeile in `plan_versions` geändert.                                              |
| REQ-F-03 | Der Command verlangt `expectedVersionId` (auch `null` ist ein Wert) und `weekKey`.                                                   | Given Body ohne `expectedVersionId`, When POST, Then 400; `PublishPlanCommandSchema` ist die einzige Prüfung.                                                                                |
| REQ-F-04 | Ein Wiederholungsversuch mit gleichem Schlüssel und gleicher Nutzlast liefert dieselbe Antwort und veröffentlicht nicht erneut.      | Given erfolgreicher Publish, When identischer Aufruf, Then 201 mit identischer `versionId`/`publishedAtUtc`, und `count(*)` in `audit_events`/`outbox_messages` für diesen Vorgang bleibt 1. |
| REQ-F-05 | Gleicher Schlüssel mit **anderer** Nutzlast wird abgelehnt, nicht beantwortet.                                                       | Then 409 `…:planning:idempotency-key-reused`; keine Wirkung.                                                                                                                                 |
| REQ-F-06 | `expectedVersionId` stimmt nicht mit dem aktuellen Entwurf überein → stabile Stale-Antwort.                                          | Then HTTP 409 mit `type = …:planning:stale-version`; der Client bildet daraus `STALE_VERSION`.                                                                                               |
| REQ-F-07 | Die Woche ist bereits veröffentlicht und es gibt keinen Entwurf → eigener stabiler Code.                                             | Then 409 `…:planning:already-published` mit der Id der bestehenden Version im `detail`-freien Problemdokument (nur Code trägt Bedeutung).                                                    |
| REQ-F-08 | Ein Entwurf mit blockierendem Konflikt wird nicht veröffentlicht.                                                                    | Then 409 `…:planning:blocking-conflict`, `plan_versions.published_at` bleibt `null`, `assignments.published_at` bleibt `null`.                                                               |
| REQ-F-09 | Jede Zuweisung des Entwurfs gehört nach der Organisationszeitzone zur `week_key` der Planversion.                                    | Given eine Zuweisung außerhalb der Woche, When Publish, Then 409 `…:planning:assignment-outside-week`; keine Wirkung.                                                                        |
| REQ-F-10 | Ohne Berechtigung wird serverseitig abgelehnt.                                                                                       | Then 403; kein Hinweis darauf, ob die Woche existiert.                                                                                                                                       |
| REQ-F-11 | Die Antwort trägt die serverseitige `versionId`, `weekKey`, `publishedAtUtc` und `assignmentIds`.                                    | Antwort validiert gegen `PublishedPlanVersionSchema`; bei Verstoß 500 statt kaputter Antwort.                                                                                                |
| REQ-F-12 | Die Oberfläche bietet genau eine explizite Publish-Aktion `Plan veröffentlichen` mit dem serverseitig gelesenen `expectedVersionId`. | Aktion nur sichtbar, wenn `sourceVersion.state === "draft"` **und** `hatRecht("planning.publish")`.                                                                                          |
| REQ-F-13 | Nach Erfolg lädt die Oberfläche den Serverzustand neu und zeigt `Veröffentlicht`.                                                    | Keine lokale Zustandssetzung vor der Serverantwort — Gegenprobe in T-16.                                                                                                                     |
| REQ-F-14 | Reload und ein zweiter Browserkontext zeigen dieselbe veröffentlichte Version.                                                       | `auth-journey` belegt beides mit derselben `data-published-version-id`.                                                                                                                      |

### REQ-D — Daten

| ID       | Anforderung                                                                                                | Akzeptanz                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| REQ-D-01 | `plan_versions.published_at` wird ausschließlich vom autorisierten Publish-Pfad gesetzt, und genau einmal. | pgTAP: `authenticated` ohne `planning.publish` kann `published_at` nicht setzen.                     |
| REQ-D-02 | `published_by` trägt die aufrufende Identität, nicht einen Clientwert.                                     | RLS-`with check` erzwingt `published_by = auth.uid()`; Integrationstest mit fremder Id schlägt fehl. |
| REQ-D-03 | `assignments.published_at` wird nur vom bestehenden Trigger gesetzt.                                       | Keine neue Anwendungs-SQL berührt die Spalte (statische Prüfung + bestehendes Spalten-Grant).        |
| REQ-D-04 | Audit, Outbox und Idempotenzdatensatz committen atomar mit `published_at`.                                 | Erzwungener Fehler nach jedem der drei Punkte hinterlässt **null** Wirkung (T-13).                   |
| REQ-D-05 | Genau ein Auditereignis und genau eine Outbox-Nachricht je Veröffentlichung.                               | Nach zwei parallelen und einem wiederholten Aufruf: `count = 1` je Tabelle.                          |
| REQ-D-06 | Keine neue Tabelle, keine zweite Idempotenztabelle.                                                        | `EXPECTED_TABLES` in `0005_schema_meta_gate.sql` unverändert; `select plan(10)` unverändert.         |
| REQ-D-07 | Veröffentlichte Planversionen und Zuweisungen bleiben unveränderlich.                                      | Bestehende Trigger aus 0010 unangetastet; pgTAP dazu bleibt grün.                                    |
| REQ-D-08 | Migration 0015 ist vorwärts, additiv und ohne Datenverlust; Rollback ist im Kopf benannt.                  | Zwei aufeinanderfolgende `db reset` plus grünes `supabase test db`.                                  |

### REQ-A — Architektur

| ID       | Anforderung                                                                                                            | Akzeptanz                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| REQ-A-01 | Controller → Application-Port → Repository. Kein SQL im Controller.                                                    | `architecture.test.ts` grün; Controller enthält kein `select`/`insert`.        |
| REQ-A-02 | Der Publish-Schreibpfad liegt auf `PlanningWrites`; die tote Zweitdeklaration `PlanningCommands.publishPlan` entfällt. | Genau eine `publishPlan`-Deklaration im API-Paket.                             |
| REQ-A-03 | Idempotenz läuft über den bestehenden Plattformport `IdempotencyStore`.                                                | `planning-write.repository.ts` nennt `idempotency_records` nicht mehr selbst.  |
| REQ-A-04 | Die Wochenrechnung kommt aus `@easytree/domain` über die bereits injizierte Funktion.                                  | Keine zweite ISO-Wochenableitung; `iso-week-parity.test.ts` bleibt grün.       |
| REQ-A-05 | Keine neue Tabelle, kein generischer Eventbus, keine Modulreorganisation.                                              | Diff enthält keine neue Datei unter `apps/api/src/platform/` außer Tests.      |
| REQ-A-06 | Kein zwölfter Pflichtcheck.                                                                                            | `.github/workflows/ci.yml` behält elf Jobs; beide Required-Listen unverändert. |

### REQ-S — Sicherheit

| ID       | Anforderung                                                                                                                        | Akzeptanz                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-S-01 | Die Route benutzt die reale Anfrageidentität (`REQUEST_IDENTITY`): verifiziertes Token plus lebende Session.                       | Kein Aufruf ohne gültige Sitzung erreicht die Fachlogik; `auth-journey` belegt es gegen `dist/main.js`.                                                       |
| REQ-S-02 | Mitgliedschaft und Recht werden **serverseitig** aufgelöst, nie aus Body oder Header übernommen.                                   | Policy erhält nur `memberships` aus der Datenbank; keine `orgId` in einer Portsignatur.                                                                       |
| REQ-S-03 | Es gibt ein eigenes atomares Recht `planning.publish`, getrennt von Lesen und Schreiben; `planning.write` impliziert es **nicht**. | Ein Subjekt mit `planning.read` + `planning.write`, aber ohne `planning.publish`, erhält 403 — als Testfall in T-5 (rein) **und** T-13 (gegen die Datenbank). |
| REQ-S-10 | Die Rollenmatrix aus §3.0 ist genau so in `role_permissions` abgebildet: `owner` und `manager` je drei Rechte, `member` keines.    | pgTAP zählt die sechs Zeilen und belegt, dass für `member` **null** `planning.*`-Zeilen existieren.                                                           |
| REQ-S-04 | Keine Rollenabfrage im Controller.                                                                                                 | Kein `role ===`/`rolle ===` in `planning.controller.ts`.                                                                                                      |
| REQ-S-05 | API und RLS entscheiden unabhängig.                                                                                                | Gegenmutation: Policy auf `immer erlaubt` → RLS lehnt weiterhin ab (T-14/GM-8).                                                                               |
| REQ-S-06 | Cross-Tenant bleibt unsichtbar; kein Existenzleck.                                                                                 | Fremde `expectedVersionId` erzeugt dieselbe Antwort wie eine unbekannte.                                                                                      |
| REQ-S-07 | Kein Service-Role-Pfad, kein `postgres`, kein BYPASSRLS im Laufzeitpfad.                                                           | `smoke-api-role-gate.sh` unverändert grün; `secret-scan` grün.                                                                                                |
| REQ-S-08 | Weder Audit, Outbox, Logs noch Testartefakte tragen Secrets, Tokens, vollständige Request-Bodies oder Personendaten.               | Auditkontext enthält nur Ids und Codes; `secret-surface.test.ts` grün.                                                                                        |
| REQ-S-09 | Der Client hat keine Autorität über Organisation oder Veröffentlichungsstatus.                                                     | UI liest `publishedVersionId` ausschließlich vom Server.                                                                                                      |

### REQ-O — Zuverlässigkeit / Nebenläufigkeit

| ID       | Anforderung                                                                                                                               | Akzeptanz                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| REQ-O-01 | Zwei gleichzeitige Publish-Anfragen auf denselben Entwurf: genau ein Gewinner.                                                            | Zwei echte Verbindungen; genau ein 201, der andere 409 stale/already-published.    |
| REQ-O-02 | Nach dem Wettlauf: genau ein `published_at`, alle Zuweisungen synchronisiert, je ein Audit- und Outbox-Ereignis, ein Idempotenzdatensatz. | SQL-Zählungen im Integrationstest.                                                 |
| REQ-O-03 | Kein halber Zustand bei erzwungenem Fehler an drei Punkten.                                                                               | Siehe REQ-D-04.                                                                    |
| REQ-O-04 | Ein `23P01` aus dem Sync-Trigger wird als Fachcode beantwortet, nicht als 500.                                                            | Test mit überlappendem Entwurf → 409 `blocking-conflict`.                          |
| REQ-O-05 | Der Nachweis läuft fail-closed und meldet eine greppbare Zeile.                                                                           | `[planning-publish] mode=required executed=N skipped=0`, von `db-gates` erzwungen. |

### REQ-NF — Nicht-funktional / Barrierefreiheit

| ID        | Anforderung                                                                                                                                                                                       | Akzeptanz                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-NF-01 | Alle Zustände sind sichtbar unterscheidbar: Entwurf, läuft, Erfolg, Konflikt, Stale, bereits veröffentlicht, keine Berechtigung, Fehler.                                                          | Erschöpfende `Record<…, string>`-Abbildung ohne Standardzweig.                                                                                         |
| REQ-NF-02 | Bedeutung wird nie allein über Farbe transportiert.                                                                                                                                               | `StatusBadge`/`StateBanner` mit Textmarke; axe grün.                                                                                                   |
| REQ-NF-03 | Die Aktion ist tastaturbedienbar, der Zustandswechsel wird angekündigt, der Fokus geht nicht verloren.                                                                                            | `role="status"`/`role="alert"` wie in `rate-management.tsx`; jsdom-axe-Test.                                                                           |
| REQ-NF-04 | Während des Publish ist die Aktion gesperrt und als laufend erkennbar.                                                                                                                            | `disabled` + Textwechsel, kein Doppelklick-Zweitaufruf.                                                                                                |
| REQ-NF-05 | Die Zustandsformen folgen Basisdesign v2.0 (Q38): Entwurf mit Textmarke, Veröffentlicht mit Textmarke, Veraltet als neutrale Leiste „Plan wurde geändert — neu laden", Konflikt mit Konfliktcode. | `StatusBadge` `draft`/`published` (trägt bereits eine `aria-hidden`-Geometriemarke) plus `StateBanner`; Wortlaut der Stale-Leiste wörtlich wie in Q38. |
| REQ-NF-06 | Genau ein primärer CTA auf der Planungsseite; Desktop-Aktionsfläche mindestens 40 px; Fokus sichtbar.                                                                                             | `PrimaryAction` genau einmal gerendert; `min-height: 40px`; Fokusring nicht entfernt.                                                                  |
| REQ-NF-07 | Der Navigationspunkt „Planung" wird auf `planning.read` gefiltert — ein sichtbarer Punkt ersetzt keine Autorisierung (Q38).                                                                       | `AppShell`-Test: ohne `planning.read` kein Planungslink; die API lehnt unabhängig davon ab.                                                            |

### REQ-DOC — Dokumentation

| ID         | Anforderung                                                                                                                                               | Akzeptanz                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| REQ-DOC-01 | Ein Runbook/Abschnitt benennt die beim Publish **tatsächlich** geprüften Regeln und die fehlenden.                                                        | `docs/runbooks/planning-publish.md` existiert und listet beide Mengen. |
| REQ-DOC-02 | Der Text sagt ausdrücklich, dass Ressourcen-, Abwesenheits-, Qualifikations-, Zertifikats-, Fahrzeug- und Geräteprüfungen fehlen und EYT-18 offen bleibt. | Wortlaut im Dokument und als Hinweis in der UI.                        |
| REQ-DOC-03 | Die Vorbedingung für EYT-109 ist benannt: veröffentlichte Planversions-ID, serverseitiger Status, Mandantenbindung.                                       | Abschnitt „Handoff EYT-109".                                           |
| REQ-DOC-04 | CLAUDE.md wird an den drei gemessenen Stellen korrigiert (K10).                                                                                           | Diff in T-19.                                                          |

---

## 5. Plan-Gate: Planning-Auth

Dieses Gate ist eigenständig. Ohne Entscheidung hier ist EYT-107 nicht baubar.

### 5.1 Die Optionen

**Option A — Planung zieht auf die reale Anfrageidentität um.**
`PlanningController` bekommt `REQUEST_IDENTITY`, `SESSION_ORGANISATIONS` und
eine `MembershipPlanningAccessPolicy` in derselben Form wie
`MembershipCostAccessPolicy`. `TENANT_SUBJECT_RESOLVER` und
`DenyAllPlanningAccess` entfallen. Der `read-through`-Harness ersetzt künftig
`REQUEST_IDENTITY` statt des Resolvers.

- **+** Eine Identitätswahrheit im ganzen `AppModule`.
- **+** Die reale Reise wird überhaupt erst möglich (AK7/AK8).
- **+** Die Rechteprüfung liegt in einer Policy, nicht im Controller (REQ-S-04).
- **−** Berührt `planning.controller.ts`, `app.module.ts`, den Harness und
  mehrere Tests, die den Resolver per DI ersetzen.
- **−** `read-through` (Pflichtcheck) muss angepasst werden; ein Fehler dort ist
  sofort rot.

**Option B — Adapter hinter `TENANT_SUBJECT_RESOLVER`.**
Ein Produktionsadapter delegiert an `REQUEST_IDENTITY`; der Controller bleibt.

- **−, entscheidend:** `TenantSubjectResolver.resolve(request)` ist
  **synchron** (`resolve(request): string | null`, Q5 Z. 164), während
  `RequestIdentityService.identify()` asynchron ist (Signaturprüfung plus
  HTTP-Liveness). Der Adapter ist ohne Änderung der Portsignatur nicht baubar.
  Ändert man sie auf `Promise`, ist der Eingriff genauso groß wie in Option A —
  nur bleiben dauerhaft zwei Identitätsabstraktionen stehen.
- **−** Zwei Auth-Wahrheiten werden zementiert statt aufgelöst.

**Option C — nur die Publish-Route bekommt die reale Kette, Leseroute bleibt.**

- **+** Kleinster Diff.
- **−, entscheidend:** Die Leseroute bliebe deny-all. Die reale Reise könnte die
  Planungswoche nicht laden und damit weder `expectedVersionId` beschaffen noch
  AK8 belegen. Außerdem entstünden **drei** Auth-Wege in einem Controller.

### 5.2 Entscheidung: Option A (PO-bestätigt 03.08.2026)

**Option A ist bestätigt und damit keine Empfehlung mehr, sondern Vorgabe.**
Die PO-Zielvorgaben dazu, jede als prüfbare Bedingung:

| PO-Zielvorgabe                                           | Wo eingelöst | Wie geprüft                                                                                        |
| -------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| keine zweite produktive Identitätswahrheit               | T-7          | `git grep` auf Produktionsquellen findet `TENANT_SUBJECT_RESOLVER` nicht mehr                      |
| keine doppelte Tokenverifikation                         | T-7          | genau ein `identify()`-Aufruf je Anfrage; `RequestIdentityService` bleibt der einzige Verifizierer |
| kein dauerhafter Produktionspfad über den alten Resolver | T-6, T-7     | Harness ersetzt `REQUEST_IDENTITY`, nicht den Resolver                                             |
| Planning-Access bleibt ein eigener Application-Port      | T-5          | `PLANNING_ACCESS_POLICY` bleibt bestehen, nur die Form ändert sich                                 |
| Rollen-/Permissionauflösung nicht im Controller          | T-5, T-7     | kein `role ===` im Controller; Auflösung in `MembershipRepository` + Policy                        |

**Zur Löschbedingung des alten Resolvers (OQ-3):** Er wird entfernt, wenn nach
T-7 **kein produktiver Verbraucher** verbleibt. Gemessen wird auf
Produktionsquellen (`apps/api/src`, `apps/web`, `packages`), nicht auf `test/`.
Isolierte Testhelfer dürfen bleiben — aber der `read-through`-Harness zählt
ausdrücklich **nicht** als Beweis der realen Auth-Reise; diese Rolle hat allein
`auth-journey` (T-17).

### 5.2.1 Warum Option A auch unabhängig von der Freigabe die richtige war

**Option A.** Sie ist die einzige, unter der AK7 und AK8 überhaupt belegbar
sind, und die einzige, die den Widerspruch beseitigt statt ihn zu verwalten. Der
Zusatzaufwand gegenüber Option B ist gering, weil Option B die Portsignatur
ohnehin ändern müsste.

**Stärkstes Gegenargument gegen Option A:** sie fasst mit `read-through` einen
Pflichtcheck an, der heute grün ist und mit EYT-107 fachlich nichts zu tun hat.
Bricht der Harness, blockiert das den Merge aus einem Grund, den niemand mit
„Publish" verbinden würde. — **Antwort:** Der Harness ersetzt heute genau die
zwei Tokens, die Option A ablöst; ihn nicht anzupassen ist keine Option,
sondern nur eine spätere Überraschung. T-6 macht die Umstellung zu einer
eigenen, einzeln zurücknehmbaren Task **vor** jeder Publish-Logik, damit ein
Fehlschlag dort isoliert sichtbar wird.

### 5.3 Das Recht

Bei der Planerstellung existierte **keine** autoritative
Rolle→Planungsrecht-Abbildung (gemessen: `role_permissions` enthielt
ausschließlich vier `costs.*`-Zeilen). Der Plan hat sie deshalb nicht still
erfunden, sondern als Blocker markiert. **Die PO-Entscheidung vom 03.08.2026
hat sie geliefert** — die verbindliche Matrix steht in
[§3.0](#30-verbindliche-rollenmatrix-po-entscheidung-03082026) und ist ab hier
Vorgabe, nicht Vorschlag.

Technisch: `app.has_cost_permission(uuid, text)` ist im Rumpf bereits generisch
(sie vergleicht `rp.permission = p_permission`), trägt aber einen kostenspezifischen
Namen. Migration 0015 legt deshalb `app.has_permission(uuid, text)` mit
identischem Rumpf an und lässt `app.has_cost_permission` unangetastet bestehen —
die Policies aus 0013 referenzieren sie, und ein `drop`/`rename` wäre eine
rückwärtsgerichtete Änderung an einer gemergten Migration.

---

## 6. Architektur- und Dateigrenzen

### 6.1 Zielarchitektur des Aufrufs

```
Browser  POST /api/v1/planung/versionen        Idempotency-Key, Cookie
  └─ Next-Rewrite (gleicher Origin, EASYTREE_API_PROXY_TARGET)
      └─ PlanningController.publishPlan
          1. REQUEST_IDENTITY.identify(cookie|bearer)        → 401
          2. SESSION_ORGANISATIONS.organisationsFor(userId)
          3. PlanningAccessPolicy.authorize(mitgl., null, "planning.publish") → 403/400
          4. IdempotencyKeySchema.safeParse(header)           → 400
          5. PublishPlanCommandSchema.safeParse(body)         → 400
          └─ PlanningWrites.publishPlan(input)
              └─ TenantQueryRunner.run  ── EINE Transaktion ──────────────
                  begin
                  set_config('request.jwt.claims', …, true)
                  set local role authenticated
                  a) IdempotencyStore.lock(tx, "planning.publish_plan", key)
                  b) IdempotencyStore.find(…)  → Replay? → Antwort, ENDE
                  c) Organisation + time_zone lesen
                  d) Entwurf der Woche mit `for update` sperren
                  e) expectedVersionId vergleichen        → STALE_VERSION
                  f) published_at bereits gesetzt?        → ALREADY_PUBLISHED
                  g) Zuweisungen laden
                  h) Wochenzugehörigkeit je Zuweisung     → OUTSIDE_WEEK
                  i) validateDraft über den Bestand       → BLOCKING_CONFLICT
                  j) update plan_versions set published_at = now(),
                       published_by = app.current_user_id()  ← EINZIGE Stelle
                     │  └─ Trigger plan_versions_publish_assignments
                     │       setzt assignments.published_at (security definer)
                     │       └─ EXCLUDE assignments_no_published_overlap
                     │            → 23P01 → BLOCKING_CONFLICT
                  k) insert audit_events   ('planning.plan_published')
                  l) insert outbox_messages('planning.plan_published')
                  m) IdempotencyStore.remember(tx, org, vorgang, key, versionId, fp)
                  commit
              ────────────────────────────────────────────────────────────
          6. PublishedPlanVersionSchema.safeParse(antwort)    → 500 bei Bruch
```

### 6.2 Dateien, die entstehen

| Pfad                                                                              | Zweck                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/planning/application/planning-access.port.ts` (**ersetzt**) | `PlanningAccessPolicy.authorize(memberships, requestedOrgId, permission)` in der Form der Kostenpolicy; `PLANNING_PERMISSIONS = ["planning.read","planning.write","planning.publish"]` |
| `apps/api/src/modules/planning/application/membership-planning-access.policy.ts`  | reine, synchrone Umsetzung (Vorbild `MembershipCostAccessPolicy`)                                                                                                                      |
| `supabase/migrations/<ts>_0015_planning_publish_permissions.sql`                  | `app.has_permission`, drei `role_permissions`-Zeilen je Rolle, verschärfte `plan_versions`-Update-Policy                                                                               |
| `supabase/tests/0011_planning_publish.sql`                                        | pgTAP: Rechtefunktion, Update-Policy, `published_by = auth.uid()`                                                                                                                      |
| `apps/api/test/planning-publish.integration.test.ts`                              | zwei echte Verbindungen, Replay, Teilwirkung, Report-Zeile                                                                                                                             |
| `apps/api/test/planning-publish.http.test.ts`                                     | Route, Statuscodes, Problemtypen                                                                                                                                                       |
| `apps/api/test/planning-publish.red-case.test.ts`                                 | ausgeführte Gegenmutationen der reinen Policy                                                                                                                                          |
| `apps/web/components/planning-publish-action.tsx`                                 | die Publish-Aktion samt Zuständen                                                                                                                                                      |
| `docs/runbooks/planning-publish.md`                                               | REQ-DOC                                                                                                                                                                                |

### 6.3 Dateien, die sich ändern

`planning.controller.ts` (Auth-Naht + neue Route), `planning-writes.port.ts`
(+`publishPlan`), `planning-write.repository.ts` (+Implementierung,
Idempotenz auf den Plattformport), `planning-problem.filter.ts` (+vier
Fehlertypen), `planning/index.ts`, `app.module.ts`,
`apps/api/test/harness/server.ts` + `scripts/read-through-harness.sh` (Option A),
`openapi-route-conformance.test.ts` (Eintrag entfernen),
`planning-window-view.tsx`, `app/planung/page.tsx`,
`apps/web/e2e/auth-journey/{fixtures.sql,teardown.sql,journey.pwtest.ts}`,
`.github/workflows/ci.yml` (**nur** ein Schritt im bestehenden `db-gates`),
`CLAUDE.md`.

### 6.4 Wochenbindung (K7)

Gemessen: keine Constraint, kein Trigger, kein Check verknüpft
`assignments.starts_at_utc` mit `plan_versions.week_key`.

Die Prüfung entsteht **serverseitig**, in derselben Transaktion, mit der bereits
in `AppModule` injizierten Funktion `wochenschluessel(instant, timeZone)` — also
über `planningWeekKey(isoWeekOfLocalDate(localBusinessDate(…)))` aus
`@easytree/domain`. Kein zweiter Ableitungspfad.

**Warum die Datenbankhälfte hier bewusst NICHT entsteht, und das keine
Bequemlichkeit ist:** ein SQL-Check müsste aus einem `timestamptz` eine ISO-Woche
in der Zeitzone der Organisation ableiten. Diese Zeitzone steht in einer
**anderen Tabelle** (`organizations.time_zone`), und eine Zeitzonenumrechnung ist
in PostgreSQL nicht `IMMUTABLE`. Beides schließt einen `CHECK` aus. Ein Trigger
wäre möglich, aber er wäre eine **zweite Wochenrechnung** neben
`packages/domain` — genau das, was die Prohibited-Liste dieses Auftrags und
`iso-week-parity.test.ts` verhindern sollen. Der Preis: die Regel gilt nur für
Schreibpfade, die durch die Anwendung laufen. Das steht so im Runbook.

### 6.5 Verbotene Änderungen

Kein `postgres`/Service-Role/BYPASSRLS im Laufzeitpfad. Kein Abschalten von RLS.
Kein direkter Supabase-Zugriff aus dem Browser. Kein breites `update`-Grant.
Keine zweite Idempotenztabelle. Keine zweite Wochenlogik. Kein generischer
Eventbus. Keine Modulreorganisation. Kein zwölfter Pflichtcheck. Keine
Bearbeitung gemergter Migrationen (0001–0014). Kein Commit auf `master`. Kein
Merge, kein Deployment, keine Jira-Transition in der Ausführungssession ohne
gesonderte Freigabe.

---

## 7. Fehlercodes

Der Client bildet HTTP auf `GatewayFailure` ab (gemessen, Q3): 401 →
`UNAUTHENTICATED`, 403 → `FORBIDDEN`, **409 → `STALE_VERSION` (nur für
publishPlan)**, ≥500 → `UNAVAILABLE`, sonst → `REJECTED`.

Daraus folgt eine Grenze, die der Plan nicht umgehen darf: **alle vier fachlichen
Ablehnungen kommen als 409 an und werden im Client zu `STALE_VERSION`.** Die
Unterscheidung trägt allein der `type` im Problemdokument. Die UI muss deshalb
`problem.type` lesen und darf sich nicht auf `failure` allein stützen.

| Fach-Kind                 | HTTP | `type` (`urn:easytree:planning:…`)    | UI-Wirkung                    |
| ------------------------- | ---- | ------------------------------------- | ----------------------------- |
| `STALE_VERSION`           | 409  | `stale-version`                       | Warnung + Woche neu laden     |
| `ALREADY_PUBLISHED`       | 409  | `already-published`                   | Hinweis + Woche neu laden     |
| `BLOCKING_CONFLICT`       | 409  | `blocking-conflict`                   | Konfliktliste, kein Publish   |
| `ASSIGNMENT_OUTSIDE_WEEK` | 409  | `assignment-outside-week`             | Hinweis mit Wochenangabe      |
| `IDEMPOTENCY_KEY_REUSED`  | 409  | `idempotency-key-reused` (existiert)  | Fehler, neuen Vorgang starten |
| fehlender Schlüssel       | 400  | `missing-idempotency-key` (existiert) | Fehler                        |
| kein Recht                | 403  | —                                     | Aktion war gar nicht sichtbar |
| mehrere Organisationen    | 400  | `ambiguous-organisation` (existiert)  | Hinweis auf EYT-14            |

---

## 8. Implementierungsphasen

| Phase | Inhalt                                   | Tasks                    | Vorbedingung   |
| ----- | ---------------------------------------- | ------------------------ | -------------- |
| 1     | Truth Gate und rote Baseline             | T-1 … T-3                | —              |
| 2     | Auth- und Berechtigungsnaht              | T-4 … T-7                | §3.0 (erfüllt) |
| 3     | Publish-Domain und Application-Command   | T-8 … T-10               | —              |
| 4     | PostgreSQL, Transaktion, Nebenläufigkeit | T-11 … T-14              | —              |
| 5     | HTTP und Vertrag                         | (in T-10/T-12 enthalten) | —              |
| 6     | Oberfläche                               | T-15 … T-16              | Q38 (gelesen)  |
| 7     | Reale Browserreise                       | T-17                     | T-4…T-7        |
| 8     | CI, Dokumentation, Review, Handoff       | T-18 … T-21              | —              |

---

## 9. Tasks

Jede Task ist 15–45 Minuten. **TDD-first:** der rote Lauf wird ausgeführt und
sein Ergebnis notiert, bevor Produktionscode entsteht. „Rot erwartet" ohne
ausgeführten roten Lauf zählt nicht.

---

### T-1 — Basis verifizieren und rote Baseline aufnehmen (15 min)

- **Objective.** Beweisen, dass die Ausführungssession auf `d9b9607` steht und
  die Suite vorher grün ist.
- **Requirements.** alle (Voraussetzung).
- **Dateien.** keine.
- **Schritte.**
  ```bash
  git rev-parse HEAD                 # muss d9b9607… sein
  git status --short                 # nur die sieben bekannten Fremdpfade
  pnpm install --frozen-lockfile
  pnpm --filter @easytree/config build
  pnpm --filter @easytree/contracts build
  pnpm --filter @easytree/domain build
  pnpm format && pnpm lint && pnpm typecheck && pnpm test
  ```
- **Akzeptanz.** Alle vier Gates grün; die Ausgabe wird zitiert, nicht
  zusammengefasst.
- **Rollback.** entfällt.

---

### T-2 — Konformitätstest zuerst rot machen (20 min)

- **Objective.** Den Test, der die Lücke misst, zur Fehlermeldung bringen,
  bevor irgendein Produktionscode entsteht.
- **Requirements.** REQ-F-01.
- **Dateien.** `apps/api/test/openapi-route-conformance.test.ts`.
- **TDD.** Den Eintrag `"POST /planung/versionen"` aus `NOT_YET_IMPLEMENTED`
  **entfernen**.
- **Rot erwartet.** `fuehrt jede noch offene Vertragsoperation mit Begruendung`
  schlägt fehl mit `undeclared` = `["POST /planung/versionen"]`.
- **Validierung.** `pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts`
- **Akzeptanz.** Der rote Lauf ist ausgeführt und die Meldung notiert. Der
  Eintrag bleibt entfernt — ab hier ist die Suite rot, bis T-12 die Route liefert.
- **Rollback.** Eintrag wieder einfügen.

---

### T-3 — Fehlertypen und Problemabbildung (30 min)

- **Objective.** Vier stabile Fehlertypen anlegen, bevor es einen Verursacher gibt.
- **Requirements.** REQ-F-06, REQ-F-07, REQ-F-08, REQ-F-09.
- **Dateien.** `apps/api/src/modules/planning/interface/http/planning-problem.filter.ts`.
- **TDD.** Test: für jeden neuen Wert in `PLANNING_ERROR_TYPE` liefert der Filter
  ein RFC-7807-Dokument mit genau diesem `type`, ohne Stacktrace und ohne
  Eingabewerte.
- **Rot erwartet.** `PLANNING_ERROR_TYPE.STALE_VERSION` ist `undefined`.
- **Minimal.** Vier Konstanten ergänzen: `stale-version`, `already-published`,
  `blocking-conflict`, `assignment-outside-week`.
- **Validierung.** `pnpm --filter @easytree/api exec vitest run -t "planning-problem"`
- **Akzeptanz.** Jeder Zweig ausgeschrieben, kein Standardfall.
- **Rollback.** Datei zurücksetzen.

---

### T-4 — Migration 0015: Recht und RLS-Zweitmeinung (40 min)

- **Objective.** Das Recht `planning.publish` in der Datenbank verankern und die
  `plan_versions`-Update-Policy so verschärfen, dass RLS unabhängig ablehnt.
- **Requirements.** REQ-D-01, REQ-D-02, REQ-D-08, REQ-S-03, REQ-S-05.
- **Freigegeben.** Rollenmatrix aus §3.0 ist verbindlich; T-4 setzt sie 1:1 um.
- **Dateien.**
  `supabase/migrations/<timestamp>_0015_planning_publish_permissions.sql`.
  Nummer **0015** — Ergebnis der Inventur: 0001…0014 existieren, die höchste ist
  `20260803000000_0014_rate_succession.sql`. `supabase migration new` vergibt nur
  den Zeitstempel; die Datei wird anschließend auf `_0015_` umbenannt.
- **TDD zuerst.** `supabase/tests/0011_planning_publish.sql` schreiben:
  1. `app.has_permission(org, 'planning.publish')` ist wahr für `owner` und
     `manager`, falsch für `member`;
     1b. `member` trägt **null** `planning.*`-Zeilen (REQ-S-10), und ein Subjekt
     mit `planning.read` + `planning.write`, aber ohne `planning.publish`,
     scheitert an der Update-Policy (REQ-S-03 — `write` impliziert kein
     `publish`);
  2. `authenticated` ohne das Recht kann `plan_versions.published_at` **nicht**
     setzen (0 betroffene Zeilen bzw. Policy-Verstoß);
  3. ein `update` mit fremdem `published_by` schlägt fehl.
- **Rot erwartet.** `supabase test db` meldet `function app.has_permission does
not exist` — **nur in CI messbar** (M-2).
- **Minimal.**
  ```sql
  create or replace function app.has_permission(p_org_id uuid, p_permission text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select exists (
      select 1 from public.memberships m
      join public.role_permissions rp on rp.role = m.role
     where m.org_id = p_org_id and m.user_id = auth.uid()
       and m.active and rp.permission = p_permission); $$;

  -- Rollenmatrix aus §3.0, PO-Entscheidung 03.08.2026. 'member' bekommt
  -- bewusst KEINE Zeile — dieselbe Bauart wie bei den Kostenrechten in 0013.
  insert into public.role_permissions (role, permission) values
    ('owner','planning.read'), ('owner','planning.write'), ('owner','planning.publish'),
    ('manager','planning.read'), ('manager','planning.write'), ('manager','planning.publish');

  drop policy plan_versions_update_in_org on public.plan_versions;
  create policy plan_versions_update_in_org on public.plan_versions
    for update to authenticated
    using (org_id in (select app.user_org_ids())
           and app.has_permission(org_id, 'planning.publish'))
    with check (org_id in (select app.user_org_ids())
           and (published_by is null or published_by = auth.uid()));
  ```
  Kopfkommentar mit Rollback: `drop policy` + alte Policy wiederherstellen,
  `delete from role_permissions where permission like 'planning.%'`,
  `drop function app.has_permission(uuid,text)`. Kein Datenverlust — additiv.
  `app.has_cost_permission` bleibt unangetastet (0013 referenziert sie).
- **Validierung (CI).** `db-gates` → zwei `db reset` + zwei `supabase test db`.
- **Akzeptanz.** Keine neue Tabelle → `EXPECTED_TABLES` und `select plan(10)` in
  `0005_schema_meta_gate.sql` bleiben unverändert (REQ-D-06).
- **Rollback.** Vorwärts über eine neue Migration; die Datei ist bis zum Merge
  löschbar.

---

### T-5 — Planning-Access-Policy in der Form der Kostenpolicy (35 min)

- **Objective.** Anwendungsseitige Rechteprüfung, rein und synchron.
- **Requirements.** REQ-S-02, REQ-S-03, REQ-S-04, REQ-A-01.
- **Dateien.** `planning-access.port.ts` (Interface ersetzen), **neu**
  `apps/api/src/modules/planning/application/membership-planning-access.policy.ts`,
  **neu** `apps/api/test/planning-access.test.ts` (existiert heute nicht —
  geprüft).
- **TDD zuerst.** `planning-access.test.ts`:
  keine Mitgliedschaft → `ORG_CONTEXT_REQUIRED`; zwei Mitgliedschaften ohne
  Auswahl → `ORG_CONTEXT_REQUIRED`; eine Mitgliedschaft mit `planning.write`,
  aber ohne `planning.publish`, gefragt nach `planning.publish` → `PERMISSION_MISSING`;
  mit dem Recht → `ok` samt `organisationId`.
- **Rot erwartet.** `authorize is not a function`.
- **Minimal.** Portabbildung 1:1 zu `MembershipCostAccessPolicy` (Q14), Rechte
  als `PLANNING_PERMISSIONS`-Tupel.
- **Validierung.** `pnpm --filter @easytree/api exec vitest run test/planning-access.test.ts`
- **Akzeptanz.** Keine Datenbank, kein `async`, kein Rollenvergleich außerhalb
  von `permissions.includes`.
- **Rollback.** Neue Datei löschen, Port zurücksetzen.

---

### T-6 — Read-Through-Harness auf die reale Naht umstellen (35 min)

**Diese Task steht bewusst VOR jeder Publish-Logik**, damit ein Fehlschlag im
Pflichtcheck `read-through` isoliert sichtbar wird.

- **Objective.** Der Harness ersetzt künftig `REQUEST_IDENTITY` und
  `SESSION_ORGANISATIONS` statt `TENANT_SUBJECT_RESOLVER` und der alten Policy.
- **Requirements.** REQ-A-06, REQ-S-01.
- **Dateien.** `apps/api/test/harness/server.ts`, ggf.
  `scripts/read-through-harness.sh`.
- **TDD.** Zuerst `bash scripts/read-through-harness.sh` **vor** der Änderung
  fahren und grün notieren (Docker nötig).
- **Rot erwartet.** Nach dem Entfernen des Resolvers aus dem Controller (T-7)
  läuft der Harness in 401, solange er den alten Token ersetzt.
- **Minimal.** Im Harness `REQUEST_IDENTITY` durch ein Objekt ersetzen, dessen
  `identify()` eine feste `VerifiedIdentity` liefert, und `SESSION_ORGANISATIONS`
  durch eine feste Mitgliedschaft mit allen `planning.*`-Rechten.
- **Validierung.** `bash scripts/read-through-harness.sh`
- **Akzeptanz.** Harness grün; im Kopfkommentar steht ausdrücklich, dass er
  **keine** Identitätsevidenz liefert — die kommt aus `auth-journey`.
- **Rollback.** Datei zurücksetzen.

---

### T-7 — Controller auf `REQUEST_IDENTITY` umstellen (40 min)

- **Objective.** Eine Auth-Wahrheit; `TENANT_SUBJECT_RESOLVER` entfällt.
- **Requirements.** REQ-S-01, REQ-S-02, REQ-S-04, REQ-A-01.
- **Dateien.** `planning.controller.ts`, `app.module.ts`,
  `apps/api/src/common/tenant-subject.ts` (**löschen**, OQ-3),
  betroffene Tests (`planning-window.http.test.ts`,
  `planning-gateway-parity.test.ts`).
- **TDD zuerst.** In `planning-window.http.test.ts` die DI-Ersetzung auf
  `REQUEST_IDENTITY` + `SESSION_ORGANISATIONS` + neue Policy umschreiben und
  einen Fall ergänzen: gültige Sitzung **ohne** `planning.read` → 403.
- **Rot erwartet.** Nest-Auflösungsfehler
  `Nest can't resolve dependencies of the PlanningController`.
- **Minimal.** Eine private `zugang(req, permission)`-Methode nach dem Vorbild
  von `CostsController.zugang` (Q13); die drei bestehenden Routen rufen sie mit
  `planning.read` bzw. `planning.write`.
- **Validierung.**
  `pnpm --filter @easytree/api exec vitest run test/planning-window.http.test.ts test/planning-gateway-parity.test.ts`
  danach `pnpm --filter @easytree/api test`.
- **Akzeptanz.** `git grep -n "TENANT_SUBJECT_RESOLVER" apps packages` liefert
  nichts. Keine Rollenabfrage im Controller.
- **Rollback.** Commit einzeln zurücknehmen; T-8 ff. hängen davon ab.

---

### T-8 — Portsignatur `PlanningWrites.publishPlan` (25 min)

- **Objective.** Die Fachschnittstelle festlegen, bevor SQL entsteht.
- **Requirements.** REQ-A-02, REQ-F-03, REQ-F-11.
- **Dateien.** `planning-writes.port.ts`, `planning-commands.port.ts`
  (Methode `publishPlan` entfernen, K5), `planning/index.ts`.
- **TDD.** Typtest: eine Attrappe, die `PlanningWrites` implementiert, muss
  `publishPlan` anbieten; `PlanningWriteProblem` wird um vier `kind` erweitert.
- **Rot erwartet.** `Property 'publishPlan' is missing` unter `pnpm typecheck`.
- **Minimal.**
  ```ts
  export interface PublishPlanInput {
    readonly weekKey: string;
    readonly expectedVersionId: string | null;
    readonly idempotencyKey: string;
  }
  export interface PublishedPlanVersionRow {
    readonly versionId: string;
    readonly weekKey: string;
    readonly publishedAtUtc: Date;
    readonly assignmentIds: readonly string[];
  }
  export type PublishPlanResult =
    | { readonly ok: true; readonly version: PublishedPlanVersionRow; readonly replayed: boolean }
    | { readonly ok: false; readonly problem: PlanningWriteProblem };
  ```
  Neue `PlanningWriteProblem`-Zweige: `STALE_VERSION` (mit `aktuelleVersionId`),
  `ALREADY_PUBLISHED` (mit `versionId`), `BLOCKING_CONFLICT` (mit
  `conflicts: ValidatedConflict[]`), `ASSIGNMENT_OUTSIDE_WEEK` (mit
  `tatsaechlicheWoche`).
- **Validierung.** `pnpm typecheck`
- **Akzeptanz.** `problemFor(...)` im Controller wird beim Typcheck rot, weil
  vier Zweige fehlen — genau die Wirkung, die der fehlende Standardzweig hat.
- **Rollback.** Signaturen zurücksetzen.

---

### T-9 — Idempotenz des Planungsrepositories auf den Plattformport (30 min)

- **Objective.** Zwei Idempotenz-Implementierungen (K4) auf eine reduzieren,
  bevor eine dritte entsteht.
- **Requirements.** REQ-A-03.
- **Dateien.** `planning-write.repository.ts`, `app.module.ts`.
- **TDD.** Kein neues Verhalten — bestehende Tests sind der Nachweis. Zuerst
  `apps/api/test/planning-write.integration.test.ts` grün notieren (CI/Docker).
- **Minimal.** `IdempotencyStore` in den Konstruktor, die drei rohen SQL-Aufrufe
  durch `lock/find/remember` ersetzen, `PLANNING_WRITES_FACTORY` um
  `IDEMPOTENCY_STORE` erweitern (Vorbild `RATE_REPOSITORY_FACTORY`, Q11 Z. 126-134).
- **Validierung.** `pnpm --filter @easytree/api test`, danach in CI `db-gates`.
- **Akzeptanz.** `git grep -n "idempotency_records" apps/api/src` trifft nur
  noch `platform/idempotency/pg-idempotency-store.ts`.
- **Rollback.** Eigener Commit, isoliert rücknehmbar. **Diese Task ist optional**
  — sie verbessert, blockiert aber T-11 nicht. Bei Zeitdruck streichen und im
  Handoff vermerken.

---

### T-10 — Domainprüfung „Zuweisung gehört zur Woche" (30 min)

- **Objective.** Die K7-Lücke als prüfbare Funktion, ohne zweite Wochenrechnung.
- **Requirements.** REQ-F-09, REQ-A-04.
- **Dateien.** `apps/api/src/modules/planning/domain/week-membership.ts` (neu).
- **TDD zuerst.** `apps/api/test/planning-week-membership.test.ts`:
  eine Zuweisung, deren Beginn in `Europe/Berlin` in W32 fällt, gehört zu
  `2026-W32`; eine am Sonntag 23:30 UTC, die lokal schon Montag ist, gehört zur
  **Folgewoche**; leere Liste → keine Verletzung.
- **Rot erwartet.** Modul nicht gefunden.
- **Minimal.**
  ```ts
  export function zuweisungenAusserhalbDerWoche(
    zuweisungen: readonly { id: string; startsAtUtc: Date }[],
    weekKey: string,
    wochenschluessel: (instant: Date, zone: string) => string,
    timeZone: string,
  ): { id: string; tatsaechlicheWoche: string }[];
  ```
  Die Ableitung wird **hereingereicht**, nicht importiert — dieselbe Funktion,
  die `AppModule` schon für `createAssignment` injiziert.
- **Validierung.** `pnpm --filter @easytree/api exec vitest run test/planning-week-membership.test.ts`
- **Akzeptanz.** Keine `Intl`-Nutzung und kein `new Date(y,m,d)` in der Datei
  (`no-local-time-construction.test.ts` bleibt grün).
- **Rollback.** Datei löschen.

---

### T-11 — Publish-Transaktion im Repository (45 min)

- **Objective.** Der Kern: eine Transaktion, in der alles oder nichts passiert.
- **Requirements.** REQ-F-04…09, REQ-D-01…05, REQ-O-03, REQ-O-04.
- **Dateien.** `planning-write.repository.ts`.
- **TDD zuerst.** Die Fälle in `planning-publish.integration.test.ts` (T-13)
  schreiben; sie sind die rote Vorlage.
- **Rot erwartet.** `publishPlan is not a function`.
- **Minimal.** Reihenfolge exakt wie [§6.1](#61-zielarchitektur-des-aufrufs).
  Fünf Punkte, die nicht verhandelbar sind:
  1. `IdempotencyStore.lock` ist die **erste** Anweisung nach dem Öffnen der
     Transaktion — vor jeder veränderlichen Prüfung (Begründung Q7 Z. 324-339).
  2. Der Entwurf wird mit `select … for update` gesperrt, bevor
     `expectedVersionId` verglichen wird; ohne die Sperre lesen zwei Anfragen
     denselben Stand.
  3. `published_at` wird **einmal** gesetzt, zusammen mit
     `published_by = app.current_user_id()` — der Check
     `plan_versions_publication_complete` verlangt beides, und ein Clientwert
     wäre eine gefälschte Urheberangabe.
  4. `assignments.published_at` wird **nicht** angefasst. Das erledigt der
     Trigger; das Spalten-Grant lässt es ohnehin nicht zu.
  5. Ein Testhaken `fehlerNach: "published" | "audit" | "outbox"` als
     **Konstruktorargument**, nie aus der Umgebung — genau wie der bestehende
     (Q7 Z. 585-606). `AppModule` übergibt ihn nie.
     SQLSTATE-Abbildung außerhalb der Transaktion nach dem Muster Q22 Z. 302-313:
     `23P01` → `BLOCKING_CONFLICT`, `23505` → `IDEMPOTENCY_KEY_REUSED`, sonst werfen.
     Vorgangsname: `const VORGANG = "planning.publish_plan"` (Konvention aus
     `planning.create_assignment` / `costs.create_rate_version`).
     Fingerabdruck: `[weekKey, expectedVersionId ?? "null"].join("|")` — dieselbe
     Klartextform wie die Schwestermethode in derselben Datei; der Schlüssel selbst
     geht nicht ein.
     Audit: `event_type = 'planning.plan_published'`, `subject_type = 'plan_version'`,
     `subject_id = versionId`, `context = {weekKey, assignmentCount}` — **keine**
     Personendaten, keine Namen, keine Ids von Beschäftigten.
     Outbox: `message_type = 'planning.plan_published'`,
     `payload = {planVersionId, weekKey}`, `idempotency_key = <Schlüssel>` — der
     bestehende `unique (org_id, message_type, idempotency_key)` ist die letzte
     Autorität gegen eine zweite Nachricht.
- **Validierung.** `pnpm --filter @easytree/api test` (Einheiten), Rest in CI.
- **Akzeptanz.** Kein `org_id` in einer `where`-Klausel; kein `pg`-Import.
- **Rollback.** Methode entfernen.

---

### T-12 — HTTP-Route (30 min)

- **Objective.** Die Route, die T-2 grün macht.
- **Requirements.** REQ-F-01, REQ-F-02, REQ-F-03, REQ-F-10, REQ-F-11.
- **Dateien.** `planning.controller.ts`, `planning-publish.http.test.ts` (neu).
- **TDD zuerst.** Nest-Testserver mit ersetzten Ports: 401 ohne Sitzung, 403
  ohne `planning.publish`, 400 ohne Schlüssel, 400 bei kaputtem Body, 201 im
  Erfolgsfall, 409 je Problem mit dem erwarteten `type`.
- **Rot erwartet.** 404 auf `POST /api/v1/planung/versionen`.
- **Minimal.** `@Post("versionen") @HttpCode(201)`; Reihenfolge Identität →
  Recht → Schlüssel → Body → Fachlogik → Antwortvalidierung. Ein
  Vertragsfehler **vor** der Rechteprüfung zu melden verriete einem
  Unberechtigten die Form des Vertrags.
- **Validierung.**
  ```bash
  pnpm --filter @easytree/api exec vitest run test/planning-publish.http.test.ts
  pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts
  pnpm --filter @easytree/contracts test
  ```
- **Akzeptanz.** T-2 ist grün, **ohne** dass `openapi/v1.json` sich geändert hat
  (`git diff --stat packages/contracts/openapi/v1.json` leer).
- **Rollback.** Route entfernen, T-2-Eintrag zurückschreiben.

---

### T-13 — Integrationsnachweis mit zwei echten Verbindungen (45 min)

- **Objective.** Nebenläufigkeit, Replay und Teilwirkung an einer echten
  Datenbank belegen.
- **Requirements.** REQ-O-01…05, REQ-D-04, REQ-D-05, REQ-S-06.
- **Dateien.** `apps/api/test/planning-publish.integration.test.ts`.
- **Vorlage.** `planning-write.integration.test.ts` (Verbindung über
  `EASYTREE_TEST_DB_URL`, Fixtures mit festen v4-UUIDs, Aufräumen im
  `afterAll`) und `costs/rate-succession.integration.test.ts` (zwei
  Verbindungen, genau ein Gewinner).
- **Fälle.**
  1. Erfolg: `published_at` gesetzt, **alle** Zuweisungen der Version
     synchronisiert, je eine Audit- und Outbox-Zeile, ein Idempotenzdatensatz.
  2. Replay: identischer Aufruf → `replayed: true`, identische `versionId`,
     Zählungen unverändert.
  3. Gleicher Schlüssel, andere Woche → `IDEMPOTENCY_KEY_REUSED`, keine Wirkung.
  4. Stale: `expectedVersionId` einer fremden/alten Version → `STALE_VERSION`.
  5. Bereits veröffentlicht → `ALREADY_PUBLISHED`.
  6. Überlappender Entwurf → `BLOCKING_CONFLICT`; **und** `published_at` ist
     danach `null` (der Trigger hat zurückgerollt).
  7. Zuweisung außerhalb der Woche → `ASSIGNMENT_OUTSIDE_WEEK`.
  8. **Nebenläufigkeit:** zwei Verbindungen, beide publizieren dieselbe Woche;
     genau ein `ok: true`; anschließend `count(*)` = 1 in `plan_versions`
     (mit `published_at not null`), `audit_events`, `outbox_messages`,
     `idempotency_records`.
  9. **Teilwirkung:** je ein Lauf mit `fehlerNach = "published" | "audit" |
"outbox"`; danach ist `published_at` `null`, und alle drei Tabellen sind
     für diesen Vorgang leer.
  10. **Cross-Tenant:** Mandant B publiziert mit der `versionId` von Mandant A →
      dieselbe Antwort wie bei einer unbekannten Id, keine Wirkung bei A.
- **Fail-closed.** Über `EASYTREE_TENANT_TESTS`; die Datei druckt
  `[planning-publish] mode=required executed=N skipped=0`.
- **Validierung (lokal nur mit Stack, sonst CI).**
  ```bash
  EASYTREE_TENANT_TESTS=required \
    pnpm --filter @easytree/api exec vitest run test/planning-publish.integration.test.ts
  ```
- **Akzeptanz.** Zehn Fälle grün, Report-Zeile vorhanden.
- **Rollback.** Datei löschen.

---

### T-14 — Gegenmutationen ausführen (40 min)

Siehe [§11](#11-nebenläufigkeit-und-gegenmutationen). **Jede Mutation wird
eingespielt, gemessen und zurückgenommen** — eine gedachte Mutation zählt nicht.
Das Ergebnis, auch ein „bleibt grün", wird in
`docs/reviews/2026-08-0X-eyt-107-gegenmutationen.md` protokolliert.

---

### T-15 — Publish-Aktion in der Oberfläche (45 min)

- **Objective.** Genau eine explizite Aktion, alle Zustände sichtbar, keine
  optimistische Scheinveröffentlichung.
- **Requirements.** REQ-F-12, REQ-F-13, REQ-NF-01…07, REQ-S-09, REQ-DOC-02.
- **Designvorgabe (Q38, gelesen 03.08.2026).** Bindend für diese Task:
  ein primärer CTA; Desktop-Aktionsfläche ≥ 40 px; Fokus sichtbar; Status nie
  nur über Farbe; Stale-Leiste wörtlich „Plan wurde geändert — neu laden";
  Navigationspunkt „Planung" serverseitig auf `planning.read` gefiltert.
  **Nicht** in dieser Task: `PublishDiffSheet`, `PlanningMatrix`,
  `PlanningInspector` (K17 — Slice 2, nicht EYT-107).
- **Dateien.** `apps/web/components/planning-publish-action.tsx` (neu),
  `planning-window-view.tsx`, `apps/web/app/planung/page.tsx`,
  `apps/web/components/app-shell.tsx` (Navigationsfilter, REQ-NF-07).
- **TDD zuerst.** `apps/web/test/planning-publish-action.test.tsx`:
  Aktion fehlt ohne `planning.publish`; Aktion fehlt bei
  `sourceVersion.state === "published"`; Klick ruft `publishPlan` mit **genau
  einem** Schlüssel je Vorgang und dem `sourceVersion.id` als
  `expectedVersionId`; bei `STALE_VERSION`/`already-published` wird die Woche
  neu geladen; **bei Fehlschlag bleibt der angezeigte `Stand` unverändert**.
- **Rot erwartet.** Komponente nicht gefunden.
- **Minimal.** Muster aus `rate-management.tsx` (Q29): erschöpfende
  `Record<GatewayFailure, string>`-Abbildung **plus** Verzweigung über
  `problem.type` (§7), `StateBanner` `warning` für Stale/bereits veröffentlicht,
  `danger` sonst, `StatusBadge` `published`/`draft` für den Stand (K11),
  `PrimaryAction` für die eine CTA. Der Schlüssel entsteht **einmal je
  Vorgang**, nicht je Klick.
  Zusätzlich der Wahrheitshinweis aus REQ-DOC-02 als sichtbarer Text neben der
  Aktion.
- **Validierung.**
  ```bash
  pnpm --filter @easytree/web test
  pnpm --filter @easytree/web... build
  ```
- **Akzeptanz.** jsdom-axe grün; keine Bedeutung allein über Farbe.
- **Rollback.** Komponente löschen, Einbindung zurücknehmen.

---

### T-16 — Gegenprobe „keine Scheinveröffentlichung" (20 min)

- **Objective.** Beweisen, dass die UI den Erfolg nicht selbst behauptet.
- **Requirements.** REQ-F-13, REQ-S-09.
- **Dateien.** `apps/web/test/planning-publish-action.test.tsx`.
- **Vorgehen.** Attrappe liefert `{ok:false, failure:"UNAVAILABLE"}`; der
  gerenderte `Stand` muss danach weiterhin `Entwurf` sein.
- **Gegenmutation (ausgeführt).** In der Komponente den Zustand vor dem
  `await` auf „veröffentlicht" setzen → Test muss rot werden; danach zurücknehmen.
- **Akzeptanz.** Rot gemessen, Rücknahme gemessen.

---

### T-17 — Reale Browserreise erweitern (45 min)

- **Objective.** AK7 und AK8 gegen die **echte** API belegen — keine
  Harness-Identität.
- **Requirements.** REQ-F-12, REQ-F-14, REQ-S-01, REQ-NF-01.
- **Dateien.** `apps/web/e2e/auth-journey/fixtures.sql`,
  `apps/web/e2e/auth-journey/teardown.sql`,
  `apps/web/e2e/auth-journey/journey.pwtest.ts`.
- **Warum hier und nicht in `read-through`.** `auth-journey` startet
  `apps/api/dist/main.js` — die echte Produktionsverdrahtung — mit echter
  GoTrue-Anmeldung, HttpOnly-Cookies und zweitem Browserkontext.
  `read-through` ersetzt die Identität und kann sie deshalb nicht beweisen.
  **Kein neuer Job** (REQ-A-06).
- **Fixtures ergänzen.** Eine Baustelle, eine Entwurfs-Planversion für eine feste
  Woche, zwei nicht überlappende Zuweisungen — alle mit festen v4-UUIDs im
  bestehenden Präfix `00000000-0000-4000-8000-00000000e2xx`. Der bestehende
  `DO`-Block zählt heute `1/1/1/2`; die neuen Zeilen kommen als eigene Zählungen
  dazu, damit eine unvollständige Fixture **laut** scheitert.
- **Teardown ergänzen.** Die drei neuen Objektklassen in FK-Reihenfolge löschen
  und in die `restzeilen=0`-Zählung aufnehmen. Der CI-Schritt fährt das Skript
  **zweimal** und erzwingt den Marker — eine vergessene Klasse fällt dort auf.
- **Reise ergänzen (Benutzer A).** `/planung?weekKey=…` öffnen → `Entwurf`
  sichtbar → Screenshot `04-planung-entwurf.png` → `Plan veröffentlichen`
  klicken → auf `Veröffentlicht` warten → Screenshot
  `05-planung-veroeffentlicht.png` → Seite neu laden → weiterhin
  `Veröffentlicht` mit **derselben** `data-published-version-id` → zweiter
  Browserkontext, erneute Anmeldung, dieselbe Id → Screenshot
  `06-planung-zweiter-kontext.png`. Die Id wandert in `zusammenfassung.json`.
- **Reise ergänzen (Benutzer B).** B ist angemeldet, aber ohne Mitgliedschaft:
  `/planung` zeigt keine Publish-Aktion, und ein direkter
  `POST /api/v1/planung/versionen` antwortet 403 — der diskriminierende
  Nachweis (REQ-F-10).
- **Validierung (CI, `auth-journey`).**
  ```bash
  pnpm --filter @easytree/web exec playwright test -c e2e/auth-journey/config.ts
  ```
- **Akzeptanz.** Artefakte unter `apps/web/test-results/auth-journey/`;
  Teardown zweimal `restzeilen=0`.
- **Rollback.** Drei Dateien zurücksetzen.

---

### T-18 — `db-gates` um das Publish-Gate erweitern (25 min)

- **Objective.** Den Integrationsnachweis pflichtig machen — **ohne** neuen Job.
- **Requirements.** REQ-O-05, REQ-A-06.
- **Dateien.** `.github/workflows/ci.yml` (nur der `db-gates`-Job).
- **Minimal.** Ein Schritt nach dem bestehenden Planungs-Schreibgate:
  `EASYTREE_TENANT_TESTS=required` setzen, den Test laufen lassen, Ausgabe in
  eine Logdatei, danach `grep` auf
  `[planning-publish] mode=required ` **und** `skipped=0` — nach dem Muster von
  `scripts/assert-tenant-report.sh`.
- **Akzeptanz.** `grep -c "^  [a-z][a-z0-9-]*:$" .github/workflows/ci.yml`
  bleibt bei elf Jobs; beide Required-Listen in
  `scripts/{setup,verify}-branch-protection.sh` bleiben **unverändert**.
- **Rollback.** Schritt entfernen.

---

### T-19 — Dokumentation und Wahrheitskorrekturen (35 min)

- **Objective.** Die Grenze benennen, statt sie zu verschweigen.
- **Requirements.** REQ-DOC-01…04.
- **Dateien.** `docs/runbooks/planning-publish.md` (neu), `CLAUDE.md`.
- **Inhalt des Runbooks.**
  - **Beim Publish tatsächlich geprüft:** Intervallüberschneidung derselben
    Person (blockierend; zusätzlich von `assignments_no_published_overlap`
    erzwungen); Wochenkapazität (implementiert, **aber mit `NO_CAPACITY_LIMIT`
    verdrahtet und damit heute wirkungslos**); Zugehörigkeit jeder Zuweisung zur
    Woche der Planversion (serverseitig, nicht datenbankseitig — Begründung
    §6.4); `expectedVersionId`; „noch nicht veröffentlicht"; Recht
    `planning.publish` in Anwendung **und** RLS.
  - **Nicht geprüft:** Abwesenheiten, Qualifikationen, Zertifikate, Ressourcen,
    Fahrzeuge, Geräte, Reisezeiten, Ruhezeiten. Zusätzlich: die Konfliktcodes
    `EMPLOYEE_INACTIVE` und `WORKSITE_NOT_PUBLISHABLE` stehen im Vertrag, werden
    aber von **keiner** Regel erzeugt (K6) — ein Entwurf mit inzwischen
    deaktivierter Person ist veröffentlichbar (A-3/OQ-2).
  - **EYT-18 bleibt offen.** EYT-107 ist ein Teilschnitt.
  - **Handoff EYT-109** (siehe §10).
- **CLAUDE.md.** Die drei gemessenen Fehler aus K10 korrigieren.
- **Akzeptanz.** `grep -nE "offen|TODO|TOOL_GAP|FIXME" docs/runbooks/planning-publish.md`
  liefert nur bewusst gesetzte Vorkommen im Abschnitt „Nicht geprüft".
- **Rollback.** Dateien zurücksetzen.

---

### T-20 — Vollständiges Gate und Eigenreview (30 min)

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @easytree/api... build
pnpm --filter @easytree/web... build
git diff --cached --name-only            # NUR EYT-107-Pfade
git diff --check
```

Zusätzlich: `git grep -nE "offen|TODO|TOOL_GAP|FIXME" -- <geänderte Pfade>` —
jeder Treffer ist ein Blocker (CLAUDE.md).
**Die sieben Fremdpfade aus §1.1 dürfen in keinem Commit auftauchen.**

---

### T-21 — Pull Request und Handoff (25 min)

- Branch `feat/eyt-107-publish-core` gegen `master`.
- PR-Text: was gemessen ist, was angenommen ist (A-1…A-4), was offen bleibt
  (OQ-1…OQ-3), die Gegenmutationstabelle aus T-14 **einschließlich der grün
  gebliebenen**.
- **Kein Merge, kein Deployment, keine Jira-Transition** ohne gesonderte
  Freigabe. Eine Freigabe gilt für den SHA, für den sie erteilt wurde.

---

## 10. Kostenpfad-Abgrenzung

Jira AK8 endet mit: „… der Kostenpfad akzeptiert nur deren serverseitige ID."

**Gemessen:** Es gibt heute keinen Kosten-Snapshot-Command. `CostExportPort` und
`PlanCostFactsPort` existieren als Ports, sind aber **nicht** in `AppModule`
verdrahtet und haben keinen HTTP-Aufrufer. EYT-109 („Tägliche
Plan-Personalkosten … sichtbar berechnen") ist in Jira `Zu erledigen` und wird
von EYT-107 **blockiert** (`blocks`-Link, gemessen).

**Folge:** Diesen Halbsatz in EYT-107 zu erfüllen hieße, einen Snapshot-Endpunkt
zu erfinden, damit ihn eine Prüfung ablehnen kann. Das wäre tote
Zukunftsarchitektur, gebaut zur formalen Erfüllung eines Kriteriums — und
zugleich ein Verstoß gegen die Out-of-Scope-Liste desselben Tickets
(„Tageskosten-Snapshot aus EYT-109").

**Stattdessen liefert EYT-107 einen getesteten Handoff:**

| Zusage                                                                              | Wo belegt                                 |
| ----------------------------------------------------------------------------------- | ----------------------------------------- |
| Es gibt eine serverseitig bestätigte `versionId` einer veröffentlichten Planversion | REQ-F-11, T-13 Fall 1                     |
| Ihr Veröffentlichungsstatus ist serverseitig lesbar und stabil                      | `PlanningWindow.publishedVersionId`, T-13 |
| Sie ist mandantengebunden und für Fremde unsichtbar                                 | REQ-S-06, T-13 Fall 10                    |
| Sie ist nach Reload und in einem zweiten Browserkontext dieselbe                    | REQ-F-14, T-17                            |
| Sie ist unveränderlich                                                              | Trigger aus 0010, bestehende pgTAP        |
| Kein Clientflag ist Autorität                                                       | REQ-S-09, T-16                            |

Der eigentliche Test — Entwurf als Snapshotquelle **ablehnen**, fremde
veröffentlichte Version **ablehnen**, Snapshot **erzeugen** — gehört zu EYT-109,
weil der dafür nötige Command dort erstmals entsteht. Das Runbook nennt diese
Vorbedingung ausdrücklich (REQ-DOC-03).

**Konsequenz für die Abnahme:** AK8 kann in EYT-107 nur zur Hälfte abgehakt
werden. Der Product Owner entscheidet, ob die zweite Hälfte an EYT-109 wandert
oder EYT-107 offen bleibt. Der Plan behauptet nicht, sie erfüllt zu haben.

---

## 11. Nebenläufigkeit und Gegenmutationen

### 11.1 Nebenläufigkeitsnachweis

Zwei **echte** Verbindungen (T-13 Fall 8), nicht zwei Aufrufe auf einer. Eine
Sitzung kann zeigen, dass ein Constraint ablehnt, aber nicht, dass er
**serialisiert** — dieselbe Begründung, aus der `db-gates` das Planungsgate mit
zwei Verbindungen fährt.

### 11.2 Die Gegenmutationen

Jede wird **eingespielt, gemessen, zurückgenommen** und protokolliert. Ein
„bleibt grün" ist ein Befund, kein Makel — aber es muss dastehen.

| #     | Mutation                                                                            | Erwartung                                                                                                                                  | Redundanzhinweis                                                                                                                                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GM-1  | `select … for update` beim Laden des Entwurfs entfernen                             | T-13 Fall 8 wird rot (zwei Gewinner oder doppelte Nebenwirkung)                                                                            | —                                                                                                                                                                                                                                                                                                                                             |
| GM-2  | Vergleich von `expectedVersionId` überspringen                                      | Fall 4 rot                                                                                                                                 | —                                                                                                                                                                                                                                                                                                                                             |
| GM-3  | Prüfung „bereits veröffentlicht" entfernen                                          | Fall 5 rot                                                                                                                                 | **Erwartet teils grün:** der Trigger feuert nur bei `old.published_at is null`, und `reject_published_row_change` verbietet die Zweitänderung → statt Fachcode käme `23514`. Rot wird der Test über den **erwarteten Fehlertyp**, nicht über die Wirkung.                                                                                     |
| GM-4  | Blockierende Konflikte ignorieren (Aufruf von `validateDraft` entfernen)            | Fall 6 rot                                                                                                                                 | **Erwartet: Wirkung bleibt korrekt.** `assignments_no_published_overlap` lehnt weiterhin ab. Rot wird der Test, weil `23P01` statt einer benannten Konfliktliste ankommt. Die Anwendungsprüfung ist damit **redundante Tiefenverteidigung**, deren Wert die _itemisierte Ablehnung_ ist, nicht die Verhinderung. Das gehört so ins Protokoll. |
| GM-5  | Wochenzugehörigkeitsprüfung entfernen                                               | Fall 7 rot                                                                                                                                 | **Keine Redundanz** — die Datenbank prüft das nicht (K7). Diese Mutation ist der einzige Schutz.                                                                                                                                                                                                                                              |
| GM-6  | Idempotenz-Replay entfernen (`find` ignorieren)                                     | Fall 2 rot; Fall 8 zeigt zwei Audit-/Outbox-Zeilen                                                                                         | Der Outbox-Unique fängt die zweite **Nachricht**, nicht die zweite **Auditzeile** (K8).                                                                                                                                                                                                                                                       |
| GM-7  | Audit **oder** Outbox aus der Transaktion nehmen (eigene Verbindung)                | Fall 9 rot: `published_at` gesetzt, Nebenwirkung fehlt                                                                                     | —                                                                                                                                                                                                                                                                                                                                             |
| GM-8  | `MembershipPlanningAccessPolicy.authorize` auf `immer ok` setzen                    | Ein Subjekt ohne `planning.publish` erhält kein 403 mehr — **aber die Datenbank lehnt weiterhin ab** (Migration 0015). Beleg für REQ-S-05. | Genau die Unabhängigkeitszusage; die Anwendung ist primär, RLS ist unabhängig.                                                                                                                                                                                                                                                                |
| GM-9  | Trigger `plan_versions_publish_assignments` in einer Wegwerf-Migration deaktivieren | Fall 1 rot: `assignments.published_at` bleibt `null`                                                                                       | Nur lokal/CI, **nie** committen.                                                                                                                                                                                                                                                                                                              |
| GM-10 | In der UI den Zustand vor dem `await` auf „veröffentlicht" setzen                   | T-16 rot                                                                                                                                   | —                                                                                                                                                                                                                                                                                                                                             |

**Vorsichtsregel aus `MEMORY.md`:** Gegenmutationen an nicht committeten Dateien
werden über eine **Sicherungskopie** zurückgenommen, nie über
`git checkout --` — das stellt den Commit-Stand her und hat schon zweimal Arbeit
vernichtet.

---

## 12. Validierungsstrategie

| Ebene                                                 | Befehl                                                                                  | Läuft lokal?            | Pflichtjob                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------- | ---------------------------- |
| Format                                                | `pnpm format`                                                                           | ja                      | `format`                     |
| Lint                                                  | `pnpm lint`                                                                             | ja                      | `lint`                       |
| Typen                                                 | `pnpm typecheck`                                                                        | ja                      | `typecheck`                  |
| Einheiten, Architektur, Konformität                   | `pnpm test`                                                                             | ja                      | `unit-tests`                 |
| Vertrag/Drift                                         | `pnpm --filter @easytree/contracts test`                                                | ja                      | `unit-tests`                 |
| Web-Einheiten + axe                                   | `pnpm --filter @easytree/web test`                                                      | ja                      | `unit-tests`                 |
| API-Build                                             | `pnpm --filter @easytree/api... build`                                                  | ja                      | `build-api`                  |
| Web-Build                                             | `pnpm --filter @easytree/web... build`                                                  | ja                      | `build-web`                  |
| Shell-Smoke im Browser                                | `pnpm --filter @easytree/web run test:e2e`                                              | ja (Chromium)           | `web-smoke`                  |
| Secretgrenze                                          | `pnpm --filter @easytree/api exec vitest run test/secret-surface.test.ts`               | ja                      | `unit-tests` + `secret-scan` |
| Migration 0015, pgTAP, Publish-Integration            | `pnpm exec supabase db reset` / `test db` / Vitest mit `EASYTREE_TENANT_TESTS=required` | **nein** (M-2)          | `db-gates`                   |
| Lesepfad Ende-zu-Ende                                 | `bash scripts/read-through-harness.sh`                                                  | ja (Docker)             | `read-through`               |
| **Reale Identität, Publish, Reload, zweiter Kontext** | `pnpm --filter @easytree/web exec playwright test -c e2e/auth-journey/config.ts`        | nein (braucht Supabase) | **`auth-journey`**           |

**Kein freiwilliger Skip** in `db-gates`, `read-through`, `auth-journey`. Die
Tenant- und Publish-Suiten laufen dort mit `EASYTREE_TENANT_TESTS=required` und
melden `skipped=0`; ein Skip ist rot.

**Artefakte der Reise:** `apps/web/test-results/auth-journey/` — Screenshots,
`zusammenfassung.json`, `zusammenfassung-b.json`, `ergebnis.json`, hochgeladen
als `auth-journey-nachweise`. **Wiederholbarkeit und Teardown:** Der CI-Schritt
fährt `teardown.sql` unter `if: always()` **zweimal** und erzwingt beide Male
den Marker `restzeilen=0`. Fehlt der Marker, ist der Schritt rot — das ist die
Stelle, an der eine unvollständig erweiterte Fixture auffällt.

**Evidenzstufen, die im Abschlussbericht zu nennen sind:** ausgeführter CI-Lauf

> lokaler Lauf > Subagent-Bericht > Plan. Dieser Plan ist Stufe „Plan" mit
> Quelltextmessungen der Stufe „lokal gelesen".

---

## 13. Migration und Rollback

- **Nummer 0015** — Ergebnis der Inventur, nicht geraten: 0001…0014 existieren,
  die höchste ist `20260803000000_0014_rate_succession.sql`.
  `pnpm exec supabase migration new planning_publish_permissions` vergibt nur
  den Zeitstempel; die Datei wird auf `<ts>_0015_planning_publish_permissions.sql`
  umbenannt.
- **Additiv und ohne Datenverlust:** eine neue Funktion, sechs neue Zeilen in
  `role_permissions`, eine ersetzte RLS-Policy. Keine Tabelle, keine Spalte,
  kein `drop table`.
- **Rollback im Kopfkommentar:** alte `plan_versions_update_in_org`
  wiederherstellen, `delete from public.role_permissions where permission like
'planning.%'`, `drop function app.has_permission(uuid, text)`. Als
  **Vorwärtsmigration**, nie durch Editieren von 0015 nach dem Merge.
- **`app.has_cost_permission` bleibt bestehen** — die Policies aus 0013
  referenzieren sie; ein `rename` wäre eine rückwirkende Änderung an einer
  gemergten Migration.
- **Definition of done:** zwei aufeinanderfolgende `db reset` plus grünes
  `supabase test db` — beides ausschließlich in `db-gates` messbar (M-2).
- **Kein Produktivlauf.** Railway steht auf
  `BLOCKED_MISSING_EASYTREE_APP_PASSWORD`; das ist ein getrenntes Release-Gate
  und wird mit EYT-107-Code nicht vermischt.

---

## 14. Sicherheits- und Datenschutzreview

| Frage                                    | Antwort                                                                                                                                                                                                             | Beleg                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Woher kommt die Identität?               | `REQUEST_IDENTITY`: Cookie **oder** Bearer, Signatur und Claims geprüft, Session-Liveness am Auth-Server, kein Cache. Widersprechende Credentials → 401.                                                            | Q12                      |
| Woher kommt die Organisation?            | Ausschließlich aus `memberships` über den `TenantQueryRunner` unter RLS. Kein Body, kein Header, kein Claim.                                                                                                        | Q15, REQ-S-02            |
| Woher kommt das Recht?                   | `role_permissions` in der Datenbank; die Anwendung liest, entscheidet aber selbst. Zusätzlich prüft RLS unabhängig.                                                                                                 | T-4, T-5, GM-8           |
| Wer darf `published_at` setzen?          | Nur ein Subjekt mit `planning.publish`, und nur mit `published_by = auth.uid()`.                                                                                                                                    | REQ-D-01, REQ-D-02       |
| Kann der Client `published_at` fälschen? | Nein: `assignments.published_at` ist der Rolle per Spalten-Grant entzogen (0010); `plan_versions` ist ab 0015 rechtegebunden.                                                                                       | Q18, T-4                 |
| Existenzleck?                            | `ORG_NOT_A_MEMBER` und `PERMISSION_MISSING` werden gleich beantwortet; eine fremde `versionId` verhält sich wie eine unbekannte.                                                                                    | Q14-Muster, T-13 Fall 10 |
| Was steht im Audit?                      | `org_id`, `actor_user_id` aus `app.current_user_id()`, `event_type`, `subject_type`, `subject_id`, Kontext `{weekKey, assignmentCount}`. **Keine** Namen, keine Beschäftigten-Ids, kein Request-Body, keine Header. | REQ-S-08, T-11           |
| Was steht in der Outbox?                 | `{planVersionId, weekKey}` plus der Idempotenzschlüssel.                                                                                                                                                            | T-11                     |
| Secrets in Logs oder Artefakten?         | Nein; `secret-surface`-Regeln gelten für jede neue Datei unter `apps/api/src/**`, jeder `process.env`-Zugriff außerhalb der Konfigurationsgrenze ist ein Befund.                                                    | REQ-S-08                 |
| Service-Role/`postgres`/BYPASSRLS?       | Nicht berührt; `smoke-api-role-gate.sh` bleibt unverändert.                                                                                                                                                         | REQ-S-07                 |
| Neue Angriffsfläche?                     | Eine POST-Route hinter derselben Auth-Kette wie die Kostenrouten; kein neuer öffentlicher Pfad, kein neuer Header, keine neue Tabelle.                                                                              | §6                       |

**Bewusst nicht behauptet:** Dass die Rolle→Recht-Zuordnung fachlich richtig
ist — sie ist eine **Produktentscheidung** (§3.0), die dieser Plan umsetzt und
prüfbar macht, nicht begründet. Dass die Publish-Regeln fachlich vollständig
sind (§Goal, REQ-DOC-02). Dass die Wochenbindung datenbankseitig durchgesetzt
ist (§6.4).

---

## 15. Beobachtbarkeit, Audit und Outbox

- Genau **ein** Auditereignis `planning.plan_published` je Veröffentlichung, in
  derselben Transaktion. Gegen ein zweites schützt der Idempotenz-Replay — das
  Schema tut es nicht (K8), und genau deshalb ist GM-6 Pflicht.
- Genau **eine** Outbox-Nachricht `planning.plan_published`; hier ist zusätzlich
  `unique (org_id, message_type, idempotency_key)` die letzte Autorität.
- Kein neuer Eventbus, kein Nachlauf, kein zweiter Commit.
- Die Korrelations-ID kommt aus `CorrelationIdMiddleware` und wandert in den
  Auditkontext, nicht in die Outbox-Nutzlast.
- Kein Zustellprozess: die Outbox wird gefüllt, nicht gelesen. Das ist
  bestehender Stand und keine Regression.

---

## 16. Plausibilitäts- und Wahrheitsprüfung

### 16.1 Formale Prüfungen

| Prüfung                                                                                                         | Ergebnis                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal-Marker (START/END als HTML-Kommentar)                                                                      | vorhanden, und **genau einmal** im Dokument — die Marker werden hier bewusst nicht wörtlich wiederholt, sonst extrahiert ein Validator den falschen Block. Genau dieser Fehler ist bei der ersten Messung aufgetreten und wurde korrigiert. |
| Goal-Länge                                                                                                      | **3 020** Unicode-Zeichen, Grenze 4 000 — gemessen, nicht geschätzt; Befehl in §16.6                                                                                                                                                        |
| Requirements mit stabilen IDs                                                                                   | **54**, gemessen (14 REQ-F, 8 REQ-D, 6 REQ-A, 10 REQ-S, 5 REQ-O, 7 REQ-NF, 4 REQ-DOC) — gegenueber der Erstfassung +4 aus PO-Entscheidung und Basisdesign v2.0                                                                              |
| Tasks                                                                                                           | 21, je 15–45 min                                                                                                                                                                                                                            |
| Jede Task nennt Requirement-Bezug, Dateien, TDD-Schritt, roten Erwartungsfall, Validierung, Akzeptanz, Rollback | ja                                                                                                                                                                                                                                          |
| Alle genannten Pfade existieren auf `d9b9607` oder sind als **neu** markiert                                    | ja, gegen den Arbeitsbaum geprüft                                                                                                                                                                                                           |
| Alle Befehle stammen aus `package.json`, `ci.yml` oder `scripts/`                                               | ja                                                                                                                                                                                                                                          |
| Migrationsnummer aus Inventur                                                                                   | 0015, aus 0001…0014                                                                                                                                                                                                                         |
| Kein zwölfter Pflichtcheck                                                                                      | ja (T-18)                                                                                                                                                                                                                                   |
| Validator des Writing-Plans-Skills                                                                              | **nicht verfügbar** — der Skill (`~/.claude/skills/writing-plans/SKILL.md`) definiert nur ein Format, kein ausführbares Prüfprogramm. Schema und Goal-Länge wurden manuell geprüft. Diese Grenze ist hier benannt, nicht verschwiegen.      |

### 16.2 Entfernte oder markierte unbelegte Behauptungen

- „`platform/idempotency/` existiert nicht" — **war falsch**, stammte aus dem
  Lauf gegen den veralteten lokalen `master`. Korrigiert.
- „Höchste Migration ist 0013" — **war falsch**, 0014 existiert. Korrigiert.
- „CI hat zehn Jobs" (CLAUDE.md) — **falsch**, elf. Als K10 markiert, Korrektur
  in T-19.
- „`plan_versions.week_key` ist inzwischen an die Zuweisungszeitstempel
  gebunden" — **nicht behauptet**, gemessen widerlegt (K7).
- „Der Publish prüft Abwesenheiten/Qualifikationen" — **nicht behauptet**,
  ausdrücklich als fehlend dokumentiert.
- „Die Rolle `manager` darf veröffentlichen" — war ASSUMPTION (A-1), ist seit
  der PO-Entscheidung vom 03.08.2026 **Vorgabe** (§3.0). Die Herkunft bleibt
  sichtbar: der Plan hat sie nicht erfunden, er hat sie erfragt.
- „Confluence 8552449/8814623 sagen X" — bis zur Finalisierung **nicht
  behauptet** und als MISSING geführt; beide Seiten sind am 03.08.2026 gelesen
  und in §3.1 mit Datum und Seitenstand ausgewertet. Dabei fiel auf, dass die
  Sprint-5-Seite als **Repositoryquelle** veraltet ist (K16) — sie wird nur für
  Produktabsicht zitiert.
- „`EMPLOYEE_INACTIVE`/`WORKSITE_NOT_PUBLISHABLE` haben keinen Produzenten" —
  auf Anweisung des PO **auf `d9b9607` erneut gemessen** statt aus dem ersten
  Durchlauf übernommen. Ergebnis unverändert (§3 OQ-2).

### 16.3 Stärkstes Gegenargument gegen diesen Plan

> EYT-107 heißt „Planentwurf veröffentlichen". Der Plan gibt den größten Teil
> seines Umfangs an einen Auth-Umbau (T-5 bis T-7), fasst dabei einen grünen
> Pflichtcheck an, löscht eine bestehende Abstraktion und ändert Tests, die mit
> Publish nichts zu tun haben. Das ist Scope Creep unter dem Deckmantel einer
> Vorbedingung. Ein disziplinierterer Schnitt hätte die Publish-Route hinter der
> bestehenden Naht gebaut, den Nachweis über `read-through` geführt und die
> Auth-Frage an EYT-14 gegeben, wo sie laut Ticketzuschnitt hingehört.

**Antwort — und wo sie schwach bleibt.** Der Einwand hat einen wahren Kern:
EYT-14 ist der Ort des Rollenmodells, und dieser Plan nimmt einen Teil davon
vorweg. Er ist trotzdem nicht durchführbar, weil AK7 und AK8 wörtlich eine
Oberfläche und einen zweiten Browserkontext verlangen, und die Planungsroute in
Produktion mit 401 antwortet, bevor irgendeine Oberfläche etwas anzeigen kann.
Ein Nachweis über `read-through` wäre ein Nachweis über eingespritzte Identität —
also genau die „Testoverride-Kaschierung", die der Auftrag ausdrücklich
verbietet. **Wo die Antwort schwach bleibt:** Der Plan behauptet nicht, dass
sein Rechtemodell das von EYT-14 ist. Er legt drei Rechte fest, die EYT-14 später
möglicherweise anders schneidet, und akzeptiert diese Umbaukosten. Wer den
Einwand höher gewichtet, sollte EYT-107 stattdessen splitten: Auth-Naht als
eigenes Ticket, Publish darauf aufbauend. **Das ist eine Product-Owner-Frage und
kein Umsetzungsdetail** — sie gehört mit OQ-1 zusammen entschieden.

### 16.4 Failure-Mode-Ketten

| Kette                             | Verlauf                                                                                                                                                       | Abfang                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Auth**                          | Planung bleibt an deny-all → echter Benutzer kann nicht veröffentlichen, oder der Test beweist nur den Harness → EYT-107 wirkt grün, ist operativ unbenutzbar | T-7 entfernt die Naht ganz; T-17 fährt gegen `dist/main.js`; GM-8                             |
| **Nebenläufigkeit**               | Zwei Anfragen lesen denselben Entwurf → beide schreiben Nebenwirkungen → doppeltes Audit/Outbox oder widersprüchlicher Zustand                                | `for update` (T-11), Idempotenzsperre, T-13 Fall 8, GM-1/GM-6                                 |
| **Woche**                         | Zuweisung gehört nicht zur `week_key` → falsche Woche veröffentlicht → EYT-109 rechnet Kosten aus fachlich fremden Zeiten                                     | T-10, T-13 Fall 7, **GM-5 (einziger Schutz — die DB prüft es nicht)**                         |
| **Transaktion**                   | `published_at` gesetzt, Audit/Outbox scheitert → veröffentlichter Plan ohne Spur → Retry und Betrieb können den Zustand nicht rekonstruieren                  | Eine Transaktion (T-11), `fehlerNach` an drei Punkten, T-13 Fall 9, GM-7                      |
| **Idempotenz**                    | Retry gilt als neuer Publish → zweites Ereignis oder falscher Konflikt → ein erfolgreicher Timeout ist nicht sicher wiederholbar                              | `lock` vor `find` (T-11), T-13 Fälle 2+3, GM-6                                                |
| **UI**                            | UI setzt lokal „Veröffentlicht", Servertransaktion scheitert → die Planerin sieht einen Zustand, den PostgreSQL nicht kennt                                   | Neuladen statt lokalem Setzen (T-15), T-16, GM-10                                             |
| **Nachweisillusion** (zusätzlich) | Gegenmutationen werden benannt statt ausgeführt — wie in `planning-write.integration.test.ts` (K14)                                                           | T-14 verlangt eingespielt/gemessen/zurückgenommen und protokolliert auch die grün gebliebenen |
| **Basisdrift** (zusätzlich)       | Ausführung startet auf veraltetem lokalen `master` → Plan zeigt auf Dateien, die dort anders sind                                                             | T-1 prüft `git rev-parse HEAD` gegen `d9b9607`; §1.1 dokumentiert den Vorfall                 |

### 16.5 Bias-Risiken dieses Plans

- **Bestätigungstendenz zur EYT-108-Vorlage.** Der Publish-Pfad ist bewusst nach
  `rate-repository.pg.ts` geformt. Das ist begründet (bewährtes Muster, gleiche
  Bausteine), verstellt aber den Blick auf Alternativen — etwa eine
  SQL-Funktion, die das Veröffentlichen atomar in der Datenbank erledigt. Diese
  Alternative wurde **nicht** ernsthaft geprüft; sie hätte den Vorteil, das
  Recht und die Wirkung an einem Ort zu halten, und den Nachteil, Fachlogik in
  PL/pgSQL zu verschieben.
- **Vollständigkeitsillusion durch Zitatdichte.** Der Plan zitiert viel
  Quelltext. Zitierte Zeilen sind keine ausgeführten Tests. Alles
  Datenbankbezogene ist bis `db-gates` **unbewiesen** (M-2).
- **Autoritätsverwechslung.** CLAUDE.md wirkt autoritativ und war an drei
  gemessenen Stellen falsch (K10). Der Plan stützt sich deshalb auf Quelltext,
  nicht auf Projektdokumentation.
- **Optimismus bei T-17.** Die Reise um sechs Schritte zu erweitern ist als
  45-Minuten-Task angesetzt. Realistisch ist das die riskanteste Task des Plans
  (Fixtures, Teardown-Zählung, Timing im zweiten Kontext). Sie kann überziehen.
- **Sunk-Cost bei Option A.** Nachdem T-6/T-7 den Umbau vollzogen haben, wird
  ein Rückbau teuer. Wer Option A ablehnt, muss das **vor** T-6 tun.

### 16.6 Abschließende Bereitschaft

**Status: `ready-for-execution`** (gesetzt 03.08.2026 nach PO-Entscheidung).

Die drei Bedingungen, die den Status vorher zurückgehalten haben, sind erfüllt:

| Vorher offen                                        | Jetzt                                                                                          | Wo                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- |
| B-1/OQ-1 — keine autoritative Rolle→Recht-Zuordnung | entschieden, verbindlich                                                                       | §3.0                |
| OQ-2 — nicht erzeugte Konfliktcodes                 | entschieden: nicht behaupten, nicht erfinden, dokumentieren; **auf `d9b9607` neu verifiziert** | §3 OQ-2, REQ-DOC-02 |
| OQ-3 — alter Resolver                               | entschieden: entfernen, wenn kein produktiver Verbraucher bleibt                               | §5.2, T-7           |

Bei der Finalisierung wurde **kein neuer** Sicherheits-, Daten-,
Autorisierungs- oder Migrationsblocker gefunden. Die beiden Confluence-Quellen
sind gelesen und in §3.1 ausgewertet; damit ist auch M-1 geschlossen. Offen
bleibt nur M-2 (kein lokaler Supabase-Stack) — eine Evidenzgrenze, kein Blocker:
alles Datenbankbezogene wird erstmals in `db-gates` ausgeführt und dort belegt.

**Was `ready-for-execution` ausdrücklich nicht heißt:** dass der Plan richtig
ist. Er ist ausführbar und widerspruchsfrei gegen den gemessenen Stand. Die
Risiken aus §16.5 — besonders die Zeitschätzung für T-17 und die
Sunk-Cost-Falle bei Option A — bleiben bestehen.

Nachrechnen der Goal-Länge — bewusst über die **erste** Markerpaarung, nicht
über einen `awk`-Schalter. Der naheliegende Einzeiler
(`awk '/START/{f=1;next} /END/{f=0} f'`) zählt falsch, sobald irgendeine weitere
Zeile einen Marker erwähnt: er schaltet erneut ein und zählt den Rest des
Dokuments mit. Bei der ersten Messung dieses Plans ergab das 10 194 statt 3 020 —
ein Faktor 3,4 aus einem Werkzeugfehler, nicht aus dem Inhalt.

```bash
DATEI=docs/plans/2026-08-03-eyt-107-publish-core.md
S=$(grep -n -m1 'GOAL_START' "$DATEI" | cut -d: -f1)
E=$(grep -n -m1 'GOAL_END'   "$DATEI" | cut -d: -f1)
sed -n "$((S+1)),$((E-1))p" "$DATEI" | wc -m     # erwartet: 3020
```
