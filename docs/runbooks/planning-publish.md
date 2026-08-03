# Runbook: Wochenplan veröffentlichen (EYT-107)

Stand: 03.08.2026 · Basis-SHA `d9b9607` · Branch `feat/eyt-107-publish-core`

Dieses Dokument beantwortet drei Fragen, und zwar in dieser Reihenfolge:
**Was wird beim Veröffentlichen tatsächlich geprüft? Was ausdrücklich nicht?
Was folgt daraus für EYT-109?**

---

## 1. Der Pfad

```
Browser  POST /api/v1/planung/versionen        Idempotency-Key, HttpOnly-Cookie
  └─ Next-Rewrite (gleicher Origin)
      └─ PlanningController.publishPlan
          1. REQUEST_IDENTITY  — Cookie ODER Bearer, verifiziert, Session lebt
          2. SESSION_ORGANISATIONS — Mitgliedschaft und Rechte aus der DB
          3. PlanningAccessPolicy — Organisation + Recht `planning.publish`
          4. Idempotency-Key gegen den Vertrag
          5. PublishPlanCommandSchema
          └─ PlanningWrites.publishPlan  ── EINE Transaktion ──────────────
              a) Idempotenzsperre  (app.lock_idempotency_key)
              b) Replay?           → Antwort des ERSTEN Aufrufs, Ende
              c) Organisation + Zeitzone
              d) Woche mit `for update` sperren
              e) expectedVersionId vergleichen
              f) bereits veröffentlicht?
              g) Zuweisungen laden
              h) Wochenzuordnung prüfen
              i) blockierende Konflikte prüfen
              j) EIN update: published_at = now(), published_by = app.current_user_id()
                 └─ Trigger stempelt assignments.published_at (Migration 0010)
                    └─ EXCLUDE assignments_no_published_overlap
              k) audit_events   'planning.plan_published'
              l) outbox_messages 'planning.plan_published'
              m) idempotency_records
          6. Antwort gegen PublishedPlanVersionSchema
```

`assignments.published_at` wird von der Anwendung **nicht** angefasst — das
Spalten-Grant aus Migration 0010 lässt es nicht zu, und der Trigger erledigt es.

---

## 2. Was beim Veröffentlichen GEPRÜFT wird

| Prüfung                                        | Wo                                  | Fehlercode                         |
| ---------------------------------------------- | ----------------------------------- | ---------------------------------- |
| Verifizierte Identität, lebende Session        | `REQUEST_IDENTITY`                  | 401                                |
| Aktive Mitgliedschaft, eindeutige Organisation | `MembershipPlanningAccessPolicy`    | 403 / 403 `ambiguous-organisation` |
| Recht `planning.publish`                       | Policy **und** RLS (Migration 0015) | 403                                |
| Gültiger Idempotenzschlüssel                   | Controller                          | 400                                |
| Erwartete Version (`expectedVersionId`)        | Repository, unter `for update`      | 409 `stale-version`                |
| Noch nicht veröffentlicht                      | Repository                          | 409 `already-published`            |
| Jede Zuweisung gehört zur `week_key`           | Repository, Zone der Organisation   | 409 `assignment-outside-week`      |
| Keine Intervallüberschneidung derselben Person | Repository **und** PostgreSQL       | 409 `blocking-conflict`            |
| Kein Cross-Tenant                              | RLS                                 | wie „unbekannt"                    |

### Zwei Anmerkungen, die man kennen muss

**Die Wochenzuordnung wird NUR serverseitig geprüft.**
`plan_versions.week_key` ist im Schema mit keinem Zeitstempel seiner
Zuweisungen verknüpft — die offene Lücke aus EYT-49. Ein `CHECK` kann sie
nicht schließen: die Woche eines Instants hängt von
`organizations.time_zone` ab (andere Tabelle), und Zeitzonenumrechnung ist in
PostgreSQL nicht `IMMUTABLE`. Ein Trigger wäre möglich, wäre aber eine
**zweite Wochenrechnung** neben `packages/domain`. Der Preis ist benannt: die
Regel gilt nur für Schreibpfade, die durch die Anwendung laufen. Wer künftig
per SQL an der Anwendung vorbei schreibt, umgeht sie.

**Die Wochenkapazität ist implementiert, aber wirkungslos.**
`validateDraft` kennt `EMPLOYEE_WEEKLY_CAPACITY`, wird aber mit
`NO_CAPACITY_LIMIT` aufgerufen, weil es im Fachschema keine
Wochenstundengrenze gibt. Eine geratene Zahl wäre eine erfundene Regel. Der
Code ist da, die Regel feuert nicht.

---

## 3. Was beim Veröffentlichen NICHT geprüft wird

Für nichts davon existiert im Produktivcode eine Regel. Es wird deshalb auch
nicht behauptet — weder im Code, noch in der Oberfläche, noch hier.

- **Abwesenheiten** (Urlaub, Krankheit) — keine Tabelle, keine Regel.
- **Qualifikationen und Zertifikate** — keine Tabelle, keine Regel.
- **Ressourcen, Fahrzeuge, Geräte** — keine Tabelle; Migration 0010 nennt das
  Fehlen von `resources` ausdrücklich als bewusste Auslassung.
- **Reise- und Ruhezeiten** — kein Modell.
- **`EMPLOYEE_INACTIVE` und `WORKSITE_NOT_PUBLISHABLE`** — beide Codes stehen
  im Transportvertrag (`CONFLICT_CODE_VALUES`) und in der Anzeigetextmap, aber
  **keine Regel im Repository erzeugt sie** (erneut gemessen am 03.08.2026 auf
  `d9b9607`: die einzigen `conflicts.push`-Stellen sind
  `draft-validation.ts:41` und `:59`). Praktische Folge: ein Entwurf, dessen
  Person nach dem Anlegen deaktiviert wurde, ist veröffentlichbar. Beim
  ANLEGEN einer Zuweisung wird die Auswählbarkeit sehr wohl geprüft
  (`RESOURCE_NOT_SELECTABLE`) — beim Veröffentlichen nicht.
  Product-Owner-Entscheidung 03.08.2026: für EYT-107 wird daraus keine neue
  Regel erfunden; die Lücke wird dokumentiert.

**EYT-18 („Planungskonflikte erkennen und Wochenplan veröffentlichen") wird
durch diesen Teilschnitt NICHT geschlossen.** EYT-107 liefert den
Veröffentlichungspfad und zwei Regeln; die Regelfamilie von EYT-18 ist
wesentlich größer.

Dieselbe Grenze steht als sichtbarer Text neben der Publish-Aktion
(`planning-publish-action.tsx`, `data-testid="planung-publish-grenze"`) — ein
Runbook, das niemand öffnet, ist keine Warnung.

---

## 4. Rechte

Product-Owner-Entscheidung 03.08.2026, umgesetzt in Migration 0015:

| Rolle     | `planning.read` | `planning.write` | `planning.publish` |
| --------- | --------------- | ---------------- | ------------------ |
| `owner`   | ja              | ja               | ja                 |
| `manager` | ja              | ja               | ja                 |
| `member`  | nein            | nein             | nein               |

`planning.publish` ist **eigenständig**: `planning.write` impliziert es nicht.
Wer einen Entwurf bearbeiten darf, darf ihn deshalb nicht automatisch für die
ganze Organisation verbindlich machen.

Geprüft wird an zwei unabhängigen Stellen:

1. **Anwendung** — `MembershipPlanningAccessPolicy`, rein und synchron.
2. **Datenbank** — die Update-Policy auf `plan_versions` verlangt
   `app.has_permission(org_id, 'planning.publish')` und lässt `published_by`
   nur auf `auth.uid()` zu.

Schaltet man die Anwendungs-Policy auf „immer erlaubt", lehnt PostgreSQL
weiterhin ab; das `update` betrifft dann null Zeilen, und das Repository meldet
das laut, statt einen Erfolg zu erfinden.

---

## 5. Betrieb

**Ein Retry ist sicher.** Derselbe Idempotenzschlüssel mit derselben Nutzlast
liefert dieselbe Antwort und erzeugt keine zweite Wirkung. Der Schlüssel ist
in der Oberfläche an (Woche, erwartete Version) gebunden und wird erst nach
Erfolg verworfen.

**Ein Retry mit anderer Nutzlast wird abgelehnt** (`idempotency-key-reused`, 409) — die alte Antwort zurückzugeben hieße, ein „veröffentlicht" für etwas
auszugeben, das nie geschickt wurde.

**Nach dem Veröffentlichen ist die Version unveränderlich und unlöschbar**
(Migration 0010). Das gilt auch für Testdaten: `apps/web/e2e/auth-journey/teardown.sql`
setzt die beiden Trigger dafür sichtbar und transaktional aus und prüft
danach, dass sie wieder scharf sind. Für eine Organisation mit veröffentlichter
Planversion schlägt ein Löschen der Organisation fehl — das ist gewollt.

**Kein Zustellprozess.** Die Outbox wird gefüllt, nicht gelesen. Das ist
bestehender Stand und keine Regression von EYT-107.

---

## 6. Handoff an EYT-109

EYT-107 erzeugt die Vorbedingung, mehr nicht. Verfügbar ist ab jetzt:

| Zusage                                                                      | Beleg                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Eine serverseitig bestätigte `versionId` einer veröffentlichten Planversion | `PublishedPlanVersionSchema`; `planning-publish.integration.test.ts` Fall 1 |
| Ihr Veröffentlichungsstatus ist serverseitig lesbar                         | `PlanningWindow.publishedVersionId`                                         |
| Sie ist mandantengebunden und für Fremde unsichtbar                         | RLS; Cross-Tenant-Fall im Integrationstest                                  |
| Nach Reload und in einem zweiten Browserkontext dieselbe                    | `auth-journey`, Schritt 9d                                                  |
| Sie ist unveränderlich                                                      | Migration 0010, pgTAP 0006/0011                                             |
| Kein Clientflag ist Autorität                                               | `planning-publish-action.test.tsx`                                          |

**Ausdrücklich NICHT geliefert:** Jira AK8 endet mit „der Kostenpfad
akzeptiert nur deren serverseitige ID" (wortgleich in Confluence 8552449,
S5-REQ-03). Dieser Halbsatz ist in EYT-107 **nicht erfüllt** und konnte es
nicht sein: es gibt keinen Kosten-Snapshot-Command, den man einschränken
könnte. `CostExportPort` und `PlanCostFactsPort` existieren als Ports, sind
aber nicht verdrahtet und haben keinen HTTP-Aufrufer. Einen Endpunkt zu
erfinden, damit eine Prüfung ihn ablehnen kann, wäre tote Zukunftsarchitektur
und zugleich ein Verstoß gegen die Out-of-Scope-Liste desselben Tickets.

Die eigentlichen Tests — Entwurf als Snapshotquelle ablehnen, fremde
veröffentlichte Version ablehnen, Snapshot erzeugen — gehören zu EYT-109, weil
der Command dort erstmals entsteht.

---

## 7. Nachweise

| Ebene                                               | Datei                                                                       | Pflichtjob         |
| --------------------------------------------------- | --------------------------------------------------------------------------- | ------------------ |
| Rechtelogik, rein                                   | `apps/api/test/planning-access.test.ts`                                     | `unit-tests`       |
| Fehlercodes                                         | `apps/api/test/planning-problem.test.ts`                                    | `unit-tests`       |
| Wochenzuordnung                                     | `apps/api/test/planning-week-membership.test.ts`                            | `unit-tests`       |
| HTTP-Naht                                           | `apps/api/test/planning-publish.http.test.ts`                               | `unit-tests`       |
| Routenkonformität                                   | `apps/api/test/openapi-route-conformance.test.ts`                           | `unit-tests`       |
| PostgreSQL, Nebenläufigkeit, Teilwirkung            | `apps/api/test/planning-publish.integration.test.ts`                        | `db-gates`         |
| Recht und RLS in der Datenbank                      | `supabase/tests/0011_planning_publish.sql`                                  | `db-gates`         |
| Oberfläche                                          | `apps/web/test/planning-publish-action.test.tsx`, `planung-zugang.test.tsx` | `unit-tests`       |
| **Reale Identität, Reload, zweiter Browserkontext** | `apps/web/e2e/auth-journey/journey.pwtest.ts`                               | **`auth-journey`** |

`read-through` beweist den Datenweg, **nicht** die Identität: der Harness
ersetzt `REQUEST_IDENTITY`. Der Identitätsnachweis ist allein `auth-journey`
gegen `dist/main.js`.

Ausgeführte Gegenmutationen: `docs/reviews/2026-08-03-eyt-107-gegenmutationen.md`.
