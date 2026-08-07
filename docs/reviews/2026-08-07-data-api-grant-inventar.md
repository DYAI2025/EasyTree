# Grant-/Policy-Inventar der Planungs-Data-API (EYT-136, Phase 1)

**Stand:** 07.08.2026 · **Baseline:** `origin/master` = `aad46ddca12abf1c4862e70248f61978dcce96e7`
(Migrationsstand `0016`) · **Zweck:** Pflichtinventar vor jeder Rechteänderung (EYT-136 AK1).

## Wie gemessen wurde

Zwei unabhängige Quellen, weil eine allein hier in die Irre führt:

1. **Produktivkatalog, ausschließlich lesend.** Supabase-MCP gegen Projekt `inypnrvpawvhgiyagxbd`
   als `supabase_read_only_user` (`transaction_read_only = on` — ein Schreibversuch wäre technisch
   unmöglich, nicht nur unterlassen). Abgefragt wurden `pg_class`, `has_table_privilege`,
   `has_column_privilege` und `pg_policies`.
2. **Produktionscode.** `rg -e 'insert into public\.' -e 'update public\.' -e 'delete from public\.'`
   über `apps/api/src`, `packages/*/src` und `scripts/ops`. Testcode ist ausgeschlossen — ein Test
   begründet kein Produktionsrecht.

> **Messfalle, die hier zuschlug.** `information_schema.role_table_grants` liefert als
> `supabase_read_only_user` ein **leeres** Ergebnis: die Sicht zeigt nur Grants, an denen die
> abfragende Rolle beteiligt ist. Wer daraus „keine Grants" liest, misst sein eigenes Fehlen.
> Verbindlich ist `has_table_privilege` / `has_column_privilege` über `pg_class`.

> **Lokal nicht reproduzierbar.** Auf der Arbeitsmaschine läuft keine Docker-Engine
> (`docker info` scheitert, weder Docker Desktop noch OrbStack noch Rancher installiert). Der
> lokale Supabase-Stack ist damit nicht startbar; der CI-Job `db-gates` ist die erste und einzige
> Stelle, an der Migrationen und pgTAP dieses Repositories überhaupt ausgeführt werden. Die
> Spalten „Rechte" und „Policies" unten stammen deshalb aus der **Produktion**, nicht aus einem
> lokalen Stack.

## 1. Rechtematrix für `authenticated` (gemessen, Produktion)

| Tabelle                 | SELECT | INSERT        | UPDATE        | DELETE | Spaltenrechte                                                                                     |
| ----------------------- | ------ | ------------- | ------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `public.assignments`    | ✅     | nur Spalten   | nur Spalten   | **✅** | INSERT: `id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc`<br>UPDATE: `plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc` |
| `public.plan_versions`  | ✅     | nur Spalten   | nur Spalten   | ❌     | INSERT: `id, org_id, week_key`<br>UPDATE: `published_at, published_by`                              |
| `public.idempotency_records` | ✅ | ✅ (Tabelle) | ✅ (Tabelle)\* | ✅ (Tabelle)\* | keine Spaltenbegrenzung                                                                  |
| `public.audit_events`   | ✅     | ✅ (Tabelle)  | ✅ (Tabelle)\* | ✅ (Tabelle)\* | keine Spaltenbegrenzung                                                                  |
| `public.outbox_messages`| ✅     | ✅ (Tabelle)  | ✅ (Tabelle)  | ✅ (Tabelle)\* | keine Spaltenbegrenzung                                                                  |

`\*` = Recht ist erteilt, ist aber **heute** wirkungslos, weil für diesen Befehl **keine permissive
RLS-Policy** existiert und alle fünf Tabellen `force row level security` tragen. Das ist eine
Aussage über den heutigen Zustand, keine Zusicherung: das Recht ist da, es fehlt nur die Policy.

## 2. RLS-Policies (gemessen, `pg_policies`)

| Tabelle | Befehl | Policy | Prädikat | atomares Recht | Runtime-Kanal |
| ------- | ------ | ------ | -------- | -------------- | ------------- |
| `assignments` | SELECT | `assignments_select_in_org` | `org_id in (app.user_org_ids())` | — | — |
| `assignments` | INSERT | `assignments_insert_in_org` | `org_id in (…)` | **fehlt** | **fehlt** |
| `assignments` | UPDATE | `assignments_update_in_org` | `org_id in (…)` (using + check) | **fehlt** | **fehlt** |
| `assignments` | DELETE | `assignments_delete_in_org` | `org_id in (…)` | **fehlt** | **fehlt** |
| `plan_versions` | SELECT | `plan_versions_select_in_org` | `org_id in (…)` | — | — |
| `plan_versions` | INSERT | `plan_versions_insert_in_org` | `org_id in (…) and published_at is null` | **fehlt** | **fehlt** |
| `plan_versions` | UPDATE | `plan_versions_update_in_org` | `app.is_runtime_channel() and org_id in (…) and app.has_permission(org_id,'planning.publish')`; check zusätzlich `published_by is null or published_by = auth.uid()` | `planning.publish` | **vorhanden** |
| `plan_versions` | DELETE | `plan_versions_delete_in_org` | `org_id in (…)` — **Policy ohne Grant** (0016 entzog `delete`) | — | — |
| `idempotency_records` | SELECT/INSERT | `…_in_org` | `org_id in (…)` | — | — |
| `audit_events` | SELECT | `audit_events_select_in_org` | `org_id in (…)` | — | — |
| `audit_events` | INSERT | `audit_events_insert_in_org` | `org_id in (…) and actor_user_id = app.current_user_id()` | — (Akteurbindung) | — |
| `outbox_messages` | SELECT/INSERT/UPDATE | `…_in_org` | `org_id in (…)` | — | — |

`plan_versions UPDATE` ist damit die **einzige** Planungsschreiboperation, die heute an einen
Domain-Command gebunden ist. Sie ist das Muster, an dem sich EYT-136 orientiert (Migration 0015).

## 3. Legitime EasyTree-Verbraucher (gemessen im Produktionscode)

| Tabelle | Legitimer Writer | Fundstelle | Verwendete Spalten |
| ------- | ---------------- | ---------- | ------------------ |
| `plan_versions` | Entwurf anlegen | `planning-write.repository.ts:469` | `(org_id, week_key)` |
| `plan_versions` | Veröffentlichen | `planning-write.repository.ts:801` | `(published_at, published_by)` |
| `assignments` | Zuweisung anlegen (Übernahme aus Vorversion) | `planning-write.repository.ts:509` | `(org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)` |
| `assignments` | Zuweisung anlegen (Nutzerpfad) | `planning-write.repository.ts:555` | dieselben sechs |
| `assignments` | **UPDATE** | — | **kein Verbraucher** |
| `assignments` | **DELETE** | — | **kein Verbraucher** |
| `audit_events` | Auditspur | `planning-write.repository.ts:587`, `:851` | INSERT |
| `outbox_messages` | Outbox-Eintrag | `planning-write.repository.ts:607`, `:871` | INSERT |
| `outbox_messages` | **UPDATE** (`processed_at`) | — | **kein Verbraucher** (Zusteller existiert nicht) |
| `idempotency_records` | Ergebnis merken | `pg-idempotency-store.ts:45` | INSERT |
| `idempotency_records` | **UPDATE/DELETE** | — | **kein Verbraucher** (bewusst, 0012) |

Leser: sämtliche Lesepfade laufen über `TenantQueryRunner` (`set local role authenticated` +
transaktionslokale JWT-Claims) und über die Repositories des Planungs- und Kostenmoduls. Kein
Produktionscode liest diese Tabellen an der Laufzeitrolle vorbei.

**Zentrale Feststellung:** Der Produktionscode enthält **kein einziges**
`delete from public.<tabelle>` und **kein** `update public.assignments`. Beide Rechte auf
`assignments` haben damit keinen gemessenen legitimen Verbraucher.

## 4. Data-API-Angriffswege und umgangene Domain-Regeln

PostgREST stellt Schema `public` als Data API bereit (`supabase/config.toml`,
`schemas = ["public", "graphql_public"]`) und meldet sich als `authenticator` an — kein Mitglied
von `easytree_app`, also `app.is_runtime_channel() = false`.

| # | Weg | Wer kann es | Umgangene Domain-Regeln |
| - | --- | ----------- | ----------------------- |
| A-1 | `POST /rest/v1/assignments` | jedes aktive Mitglied, **auch Rolle `member`** (die API antwortet ihm 403) | `planning.write`; Intervall-/Konfliktvalidierung (`draft-validation.ts`); Wochenzugehörigkeit (`week-membership.ts`, Fehlercode `OUTSIDE_WEEK`); Advisory-Lock-Serialisierung; Idempotenz; Auditspur; Outbox; Korrelations-ID; Transaktionsklammer |
| A-2 | `PATCH /rest/v1/assignments?id=eq.<id>` | dieselbe Gruppe | dieselben; zusätzlich: verschiebt eine Zuweisung in eine andere Planversion, Person oder Baustelle ohne jede Prüfung |
| A-3 | `DELETE /rest/v1/assignments?…` | dieselbe Gruppe | **löscht den Entwurfsstand einer ganzen Woche.** Der Trigger `assignments_published_immutable` schützt nur Zeilen mit `published_at is not null` |
| A-4 | `POST /rest/v1/plan_versions` | dieselbe Gruppe | `planning.write`; erzeugt Entwurfs-Planversionen. Da `0016` das `delete`-Recht entzogen hat, sind diese Zeilen über **keinen** Pfad wieder entfernbar |
| A-5 | `POST /rest/v1/outbox_messages` / `PATCH …` | dieselbe Gruppe | fingiert Nachrichten bzw. setzt `processed_at` auf echten Nachrichten. **Heute wirkungslos, weil kein Zusteller existiert** |
| A-6 | `POST /rest/v1/idempotency_records` | dieselbe Gruppe | belegt `(org_id, operation, idempotency_key)` vorab. Setzt Schlüsselkenntnis voraus (client-erzeugte UUID) |
| A-7 | `POST /rest/v1/audit_events` | dieselbe Gruppe | hängt selbst-zugeschriebene Auditzeilen an. Die Policy bindet `actor_user_id` an die eigene Identität — **keine** Fremdzuschreibung möglich |

## 5. Scope-Entscheidung für EYT-136

Der Product Owner hat den Slice ausdrücklich eng gezogen. Aufgenommen wird nur, wofür heutiger
Zustand, konkreter Bypass, legitimer Verbraucher und korrigierter Positivpfad zusammen belegt sind.

**Im Slice:**

- **A-1 / A-2 / A-3 (`assignments`)** — Bypass belegt, Verbraucher gemessen. `UPDATE` und `DELETE`
  haben **keinen** Verbraucher → Rechteentzug. `INSERT` hat einen → Prädikate statt Entzug.
- **A-4 (`plan_versions` INSERT)** — Bypass belegt, Verbraucher gemessen (`(org_id, week_key)`) →
  Prädikate; die ungenutzte Spalte `id` wird entzogen.

**Nicht im Slice, als Findings geführt:**

- **A-5 (`outbox_messages`)** — der Bypass ist reproduzierbar, die *unerwünschte Wirkung* aber
  nicht: es gibt keinen Zusteller, der eine fingierte Nachricht zustellen oder eine unterdrückte
  auslassen könnte. Damit fehlt Punkt 2 der PO-Bedingung. Härtung gehört an das Ticket, das den
  Outbox-Consumer baut — dort ist der legitime `UPDATE`-Verbraucher erstmals bekannt.
  → **Folgeticket vorschlagen:** „Outbox-Schreibwege an den Zusteller binden".
- **A-6 (`idempotency_records`)** — Bypass reproduzierbar, Wirkung an Schlüsselkenntnis gebunden
  (client-erzeugte UUID). Kein Rechteüberschuss: `INSERT` ist der legitime Verbraucher,
  `UPDATE`/`DELETE` haben keine Policy. Eine Härtung wäre eine Kanalbindung des INSERT.
  → **Folgeticket vorschlagen:** „Idempotenzschlüssel an den Laufzeitkanal binden".
- **A-7 (`audit_events`)** — kein Rechteüberschuss gegenüber dem Verbraucher, und die
  Akteurbindung verhindert die schwerwiegende Variante. Verbleibt: selbst-zugeschriebene
  Zusatzzeilen. → **Folgeticket vorschlagen:** „Auditspur an den Laufzeitkanal binden".
- **Die Hypothese systemisch zu weiter Supabase-Default-Grants.** Beim Messen von Abschnitt 1 ist
  aufgefallen, dass mehrere Tabellen außerhalb dieses Slices Tabellenrechte tragen, die keine
  Migration erteilt hat, und dass `revoke all … from authenticated` nur in `0013` vorkommt. Das ist
  **nicht Gegenstand von EYT-136** (PO-Entscheidung) und wird hier nur als offene, separat zu
  prüfende Hypothese festgehalten — ohne Änderung und ohne abgeleitete Handlung.

## 6. Nebenbefund: Testfolgen der Kanalbindung

`app.is_runtime_channel()` vergleicht `session_user` mit `easytree_app`. In pgTAP ist
`session_user` immer `postgres`; `SET SESSION AUTHORIZATION` verlangt Superuser und steht dort
nicht zur Verfügung. Jede pgTAP-Zusicherung, die heute unter `set local role authenticated`
Zuweisungen anlegt, ändert oder löscht, wird durch die Kanalbindung rot und muss auf den
Eigentümerpfad (`reset role`) umgestellt werden — genau die Anpassung, die EYT-107 für das
Veröffentlichen bereits vorgenommen hat (`0006_planning_invariants.sql` Z. 113 ff.).

Betroffen und im Rahmen dieses Slices umzustellen:

| Datei | Zeilen | Art |
| ----- | ------ | --- |
| `supabase/tests/0006_planning_invariants.sql` | 90, 106, 208, 224, 252, 283 | Fixture-DML unter `authenticated` |
| `supabase/tests/0007_temporal_and_idempotency.sql` | 119, 167, 201 | Fixture-DML unter `authenticated` |

Die *Aussagen* dieser Tests bleiben erhalten; nur der Kanal, über den ihre Fixtures entstehen,
wechselt. Constraints und Trigger feuern für den Eigentümer unverändert.
