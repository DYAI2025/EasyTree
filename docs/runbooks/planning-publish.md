# Runbook: Wochenplan veröffentlichen (EYT-107)

Stand: 04.08.2026 · Basis-SHA `4a605de` (PR #52 gemergt) · offene Nachbesserung
in `fix/eyt-107-f1-insert-boundary` (Migration 0016, Reviewbefunde F1–F3)

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

### Das Recht allein genügt nicht — der Kanal auch (P1, 04.08.2026)

Die unabhängige Finalprüfung von PR #52 fand eine Lücke: das Recht zu prüfen
reicht nicht, solange `authenticated` die Tabelle direkt beschreiben darf.
`supabase/config.toml` stellt das Schema `public` als **Data-API** bereit, also
ist `plan_versions` über `PATCH /rest/v1/plan_versions` erreichbar. Eine
Managerin konnte damit `published_at` setzen — am Command vorbei, und damit
ohne Wochenzuordnungsprüfung, ohne benannte Konflikte, ohne Idempotenz, ohne
Audit und ohne Outbox. Der Sync-Trigger aus 0010 hätte die Zuweisungen
mitgestempelt.

Migration 0015 zieht deshalb zwei zusätzliche Grenzen:

- **Kanal.** `app.is_runtime_channel()` vergleicht `session_user` mit
  `easytree_app`. API und Worker melden sich als diese Rolle an und setzen
  danach `set local role authenticated`; `session_user` bleibt dabei
  `easytree_app`. PostgREST meldet sich als `authenticator` an und ist **kein**
  Mitglied von `easytree_app` (gemessen 04.08.2026). Die Bedingung steht in
  `using` **und** in `with check`.
- **Spalten.** `revoke update on plan_versions from authenticated`, danach
  `grant update (published_at, published_by)`. `org_id`, `week_key` und
  `created_at` sind über das Publish-Recht nicht mehr erreichbar — dieselbe
  Bauart, die `assignments` seit 0010 schützt.

### Eine Planversion wird als Entwurf geboren (F1, Migration 0016)

Das Selbstreview der P1-Korrektur fand die zweite Tür: das `UPDATE` war
abgedichtet, das **Anlegen** nicht. `authenticated` durfte `published_at`
mitgeben, und keiner der beiden Trigger auf `plan_versions` feuert bei INSERT.
Eine so geborene Planversion wäre sofort veröffentlicht, unveränderlich und
unlöschbar gewesen — und hätte `publishedVersionId` der Woche dauerhaft besetzt.

Migration 0016 zieht dieselben zwei Riegel wie 0015 beim Ändern:

- `revoke insert on plan_versions`, danach `grant insert (id, org_id, week_key)`;
- `published_at is null` im `with check` der Insert-Policy.

Ebenfalls in 0016: `revoke delete on plan_versions from authenticated` (F3). Kein
Command löscht Planversionen; über die Data-API hätte jedes Mitglied einen
Entwurf samt seiner Zuweisungen entfernen können (`on delete cascade`).

Was diese Grenze **nicht** deckt: `service_role` und `postgres` tragen
`BYPASSRLS` und umgehen jede Policy, auf jeder Tabelle. Das ist eine
Plattformeigenschaft, keine Regression — und der Grund, warum CLAUDE.md
Service-Role-Pfade in der Anwendung verbietet.

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

### ⚠️ Die Login-Rolle ist Teil der Sicherheitsgrenze

Seit dem P1-Fix veröffentlicht **nur** eine Verbindung, deren `session_user`
`easytree_app` lautet. **Seit Migration `0017` (EYT-136) gilt das nicht mehr nur
für das Veröffentlichen, sondern für die gesamte Planungsschreibfläche** — das
Anlegen einer Entwurfs-Planversion und das Schreiben von Zuweisungen hängen
seither an derselben Kanalbedingung. Wer diesen Abschnitt für eine reine
Publish-Frage hält, unterschätzt die Auswirkung um den Unterschied zwischen
„der Veröffentlichen-Knopf scheitert" und „keinerlei Planungsschreiben
funktioniert noch".

| Situation                                                           | `session_user`             | Planungsschreiben (Entwurf, Zuweisung, Publish)       |
| ------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| Railway → direkter Supabase-Host, `DATABASE_URL` als `easytree_app` | `easytree_app`             | ja                                                    |
| Supavisor-Transaktionspooler                                        | `postgres.<pooler-tenant>` | **nein — alle drei**                                  |
| Notfallzugriff als `postgres`                                       | `postgres`                 | nein (RLS wird aber ohnehin per `BYPASSRLS` umgangen) |

Ein Wechsel auf den Pooler bricht damit **jedes** Planungsschreiben — **laut**,
nicht still. `planning-write.repository.ts` wirft an drei Stellen eine benannte
Ausnahme statt Erfolg zu melden, und die Datenbank meldet darunter
SQLSTATE 42501:

| Vorgang                      | Fundstelle                         | Ausnahme                                                   |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| Entwurfs-Planversion anlegen | `planning-write.repository.ts:490` | `EYT-92: Entwurf der Woche konnte nicht ermittelt werden.` |
| Zuweisung schreiben          | `planning-write.repository.ts:565` | `EYT-92: Einfuegen lieferte keine Zeile zurueck.`          |
| Veröffentlichen              | `planning-write.repository.ts:838` | `EYT-107: Veroeffentlichen betraf keine Zeile …`           |

Nur die letzte Meldung nennt heute beide möglichen Ursachen (fehlendes Recht
oder falscher Kanal). Die beiden EYT-92-Meldungen stammen aus der Zeit vor der
Kanalbindung und sagen den Kanal **nicht** — wer sie im Betrieb sieht, prüft
zuerst `select session_user, current_user, app.is_runtime_channel();`.

Wer den Kanal ändern muss, ändert `app.is_runtime_channel()` in einer neuen
Vorwärtsmigration — nicht die Policy, und schon gar nicht durch Entfernen der
Bedingung.

Zum Nachmessen, mit der Verbindungszeichenkette der Laufzeit:

```sql
select session_user, current_user, app.is_runtime_channel();
```

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

### Die drei Ebenen des P1-Nachweises

Keine ersetzt eine andere, und jede sagt genau eine Sache:

| Datei                                                | Sitzung                          | Aussage                                                                                                                        |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/tests/0011_planning_publish.sql`           | `postgres` + `authenticated`     | Eine Sitzung, deren Loginrolle nicht `easytree_app` ist, bewirkt nichts — auch mit `planning.publish`. Dazu die Spaltengrenze. |
| `apps/api/test/planning-publish.integration.test.ts` | `easytree_app` + `authenticated` | Der echte Serverpfad funktioniert weiterhin, und `with check` lehnt eine fremde Urheberangabe ab.                              |
| `apps/web/e2e/auth-journey/journey.pwtest.ts`        | `authenticator` (PostgREST)      | Der ECHTE Angriffskanal: echtes GoTrue-Token, echte Data-API, `PATCH /rest/v1/plan_versions` — null geänderte Zeilen.          |

pgTAP kann die dritte Aussage nicht treffen: `SET SESSION AUTHORIZATION`
verlangt einen Superuser, und `postgres` ist in Supabase keiner. Deshalb misst
dort nur `auth-journey`.

Ausgeführte Gegenmutationen:
`docs/reviews/2026-08-03-eyt-107-gegenmutationen.md` (Command-Pfad) und
`docs/reviews/2026-08-04-eyt-107-p1-gegenmutationen.md` (Kanal- und
Spaltengrenze).
