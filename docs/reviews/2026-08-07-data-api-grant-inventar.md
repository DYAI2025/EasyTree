# Grant-/Policy-Inventar der Planungs-Data-API (EYT-136, Phase 1)

**Stand:** 07.08.2026, Abschnitte 7-13 nachgetragen am 08.08.2026 · **Baseline:** `origin/master` =
`aad46ddca12abf1c4862e70248f61978dcce96e7` (Migrationsstand `0016`) · **Geprüfter Stand:** PR #56,
Kopf `41f0b5f63e488f585b0eb3098feeade42c4d417f` (Lauf `31239875658`, 11/11 grün) · **Zweck:**
Pflichtinventar vor jeder Rechteänderung (EYT-136 AK1) und Evidenzakte des Slices.

Abschnitte 1-6 sind das Inventar **vor** der Änderung (Messung 07.08.2026). Abschnitte 7-13 sind
die ausgeführte Evidenz: zwei unabhängige Rotnachweise, elf Gegenmutationen, der Positivpfad und
die ausdrücklichen Lücken.

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

| Tabelle                      | SELECT | INSERT       | UPDATE         | DELETE         | Spaltenrechte                                                                                                                                                                  |
| ---------------------------- | ------ | ------------ | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public.assignments`         | ✅     | nur Spalten  | nur Spalten    | **✅**         | INSERT: `id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc`<br>UPDATE: `plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc` |
| `public.plan_versions`       | ✅     | nur Spalten  | nur Spalten    | ❌             | INSERT: `id, org_id, week_key`<br>UPDATE: `published_at, published_by`                                                                                                         |
| `public.idempotency_records` | ✅     | ✅ (Tabelle) | ✅ (Tabelle)\* | ✅ (Tabelle)\* | keine Spaltenbegrenzung                                                                                                                                                        |
| `public.audit_events`        | ✅     | ✅ (Tabelle) | ✅ (Tabelle)\* | ✅ (Tabelle)\* | keine Spaltenbegrenzung                                                                                                                                                        |
| `public.outbox_messages`     | ✅     | ✅ (Tabelle) | ✅ (Tabelle)   | ✅ (Tabelle)\* | keine Spaltenbegrenzung                                                                                                                                                        |

`\*` = Recht ist erteilt, ist aber **heute** wirkungslos, weil für diesen Befehl **keine permissive
RLS-Policy** existiert und alle fünf Tabellen `force row level security` tragen. Das ist eine
Aussage über den heutigen Zustand, keine Zusicherung: das Recht ist da, es fehlt nur die Policy.

## 2. RLS-Policies (gemessen, `pg_policies`)

| Tabelle               | Befehl               | Policy                        | Prädikat                                                                                                                                                             | atomares Recht     | Runtime-Kanal |
| --------------------- | -------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `assignments`         | SELECT               | `assignments_select_in_org`   | `org_id in (app.user_org_ids())`                                                                                                                                     | —                  | —             |
| `assignments`         | INSERT               | `assignments_insert_in_org`   | `org_id in (…)`                                                                                                                                                      | **fehlt**          | **fehlt**     |
| `assignments`         | UPDATE               | `assignments_update_in_org`   | `org_id in (…)` (using + check)                                                                                                                                      | **fehlt**          | **fehlt**     |
| `assignments`         | DELETE               | `assignments_delete_in_org`   | `org_id in (…)`                                                                                                                                                      | **fehlt**          | **fehlt**     |
| `plan_versions`       | SELECT               | `plan_versions_select_in_org` | `org_id in (…)`                                                                                                                                                      | —                  | —             |
| `plan_versions`       | INSERT               | `plan_versions_insert_in_org` | `org_id in (…) and published_at is null`                                                                                                                             | **fehlt**          | **fehlt**     |
| `plan_versions`       | UPDATE               | `plan_versions_update_in_org` | `app.is_runtime_channel() and org_id in (…) and app.has_permission(org_id,'planning.publish')`; check zusätzlich `published_by is null or published_by = auth.uid()` | `planning.publish` | **vorhanden** |
| `plan_versions`       | DELETE               | `plan_versions_delete_in_org` | `org_id in (…)` — **Policy ohne Grant** (0016 entzog `delete`)                                                                                                       | —                  | —             |
| `idempotency_records` | SELECT/INSERT        | `…_in_org`                    | `org_id in (…)`                                                                                                                                                      | —                  | —             |
| `audit_events`        | SELECT               | `audit_events_select_in_org`  | `org_id in (…)`                                                                                                                                                      | —                  | —             |
| `audit_events`        | INSERT               | `audit_events_insert_in_org`  | `org_id in (…) and actor_user_id = app.current_user_id()`                                                                                                            | — (Akteurbindung)  | —             |
| `outbox_messages`     | SELECT/INSERT/UPDATE | `…_in_org`                    | `org_id in (…)`                                                                                                                                                      | —                  | —             |

`plan_versions UPDATE` ist damit die **einzige** Planungsschreiboperation, die heute an einen
Domain-Command gebunden ist. Sie ist das Muster, an dem sich EYT-136 orientiert (Migration 0015).

## 3. Legitime EasyTree-Verbraucher (gemessen im Produktionscode)

| Tabelle               | Legitimer Writer                             | Fundstelle                                 | Verwendete Spalten                                                                |
| --------------------- | -------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `plan_versions`       | Entwurf anlegen                              | `planning-write.repository.ts:469`         | `(org_id, week_key)`                                                              |
| `plan_versions`       | Veröffentlichen                              | `planning-write.repository.ts:801`         | `(published_at, published_by)`                                                    |
| `assignments`         | Zuweisung anlegen (Übernahme aus Vorversion) | `planning-write.repository.ts:509`         | `(org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)` |
| `assignments`         | Zuweisung anlegen (Nutzerpfad)               | `planning-write.repository.ts:555`         | dieselben sechs                                                                   |
| `assignments`         | **UPDATE**                                   | —                                          | **kein Verbraucher**                                                              |
| `assignments`         | **DELETE**                                   | —                                          | **kein Verbraucher**                                                              |
| `audit_events`        | Auditspur                                    | `planning-write.repository.ts:587`, `:851` | INSERT                                                                            |
| `outbox_messages`     | Outbox-Eintrag                               | `planning-write.repository.ts:607`, `:871` | INSERT                                                                            |
| `outbox_messages`     | **UPDATE** (`processed_at`)                  | —                                          | **kein Verbraucher** (Zusteller existiert nicht)                                  |
| `idempotency_records` | Ergebnis merken                              | `pg-idempotency-store.ts:45`               | INSERT                                                                            |
| `idempotency_records` | **UPDATE/DELETE**                            | —                                          | **kein Verbraucher** (bewusst, 0012)                                              |

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

| #   | Weg                                         | Wer kann es                                                                | Umgangene Domain-Regeln                                                                                                                                                                                                                            |
| --- | ------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1 | `POST /rest/v1/assignments`                 | jedes aktive Mitglied, **auch Rolle `member`** (die API antwortet ihm 403) | `planning.write`; Intervall-/Konfliktvalidierung (`draft-validation.ts`); Wochenzugehörigkeit (`week-membership.ts`, Fehlercode `OUTSIDE_WEEK`); Advisory-Lock-Serialisierung; Idempotenz; Auditspur; Outbox; Korrelations-ID; Transaktionsklammer |
| A-2 | `PATCH /rest/v1/assignments?id=eq.<id>`     | dieselbe Gruppe                                                            | dieselben; zusätzlich: verschiebt eine Zuweisung in eine andere Planversion, Person oder Baustelle ohne jede Prüfung                                                                                                                               |
| A-3 | `DELETE /rest/v1/assignments?…`             | dieselbe Gruppe                                                            | **löscht den Entwurfsstand einer ganzen Woche.** Der Trigger `assignments_published_immutable` schützt nur Zeilen mit `published_at is not null`                                                                                                   |
| A-4 | `POST /rest/v1/plan_versions`               | dieselbe Gruppe                                                            | `planning.write`; erzeugt Entwurfs-Planversionen. Da `0016` das `delete`-Recht entzogen hat, sind diese Zeilen über **keinen** Pfad wieder entfernbar                                                                                              |
| A-5 | `POST /rest/v1/outbox_messages` / `PATCH …` | dieselbe Gruppe                                                            | fingiert Nachrichten bzw. setzt `processed_at` auf echten Nachrichten. **Heute wirkungslos, weil kein Zusteller existiert**                                                                                                                        |
| A-6 | `POST /rest/v1/idempotency_records`         | dieselbe Gruppe                                                            | belegt `(org_id, operation, idempotency_key)` vorab. Setzt Schlüsselkenntnis voraus (client-erzeugte UUID)                                                                                                                                         |
| A-7 | `POST /rest/v1/audit_events`                | dieselbe Gruppe                                                            | hängt selbst-zugeschriebene Auditzeilen an. Die Policy bindet `actor_user_id` an die eigene Identität — **keine** Fremdzuschreibung möglich                                                                                                        |

## 5. Scope-Entscheidung für EYT-136

Der Product Owner hat den Slice ausdrücklich eng gezogen. Aufgenommen wird nur, wofür heutiger
Zustand, konkreter Bypass, legitimer Verbraucher und korrigierter Positivpfad zusammen belegt sind.

**Im Slice:**

- **A-1 / A-2 / A-3 (`assignments`)** — Bypass belegt, Verbraucher gemessen. `UPDATE` und `DELETE`
  haben **keinen** Verbraucher → Rechteentzug. `INSERT` hat einen → Prädikate statt Entzug.
- **A-4 (`plan_versions` INSERT)** — Bypass belegt, Verbraucher gemessen (`(org_id, week_key)`) →
  Prädikate; die ungenutzte Spalte `id` wird entzogen.

**Nicht im Slice, als Findings geführt:**

- **A-5 (`outbox_messages`)** — der Bypass ist reproduzierbar, die _unerwünschte Wirkung_ aber
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

| Datei                                              | Zeilen                      | Art                               |
| -------------------------------------------------- | --------------------------- | --------------------------------- |
| `supabase/tests/0006_planning_invariants.sql`      | 90, 106, 208, 224, 252, 283 | Fixture-DML unter `authenticated` |
| `supabase/tests/0007_temporal_and_idempotency.sql` | 119, 167, 201               | Fixture-DML unter `authenticated` |

Die _Aussagen_ dieser Tests bleiben erhalten; nur der Kanal, über den ihre Fixtures entstehen,
wechselt. Constraints und Trigger feuern für den Eigentümer unverändert.

Die vollständige Ausführungskanal-Karte aller Zusicherungen dieser Dateien — jede einzelne, nicht
eine Stichprobe — steht in [`2026-08-08-eyt-136-kanalmatrix.md`](2026-08-08-eyt-136-kanalmatrix.md).
Dort stehen auch die Befunde B1–B5 des zweiten Reviewgangs. Dieses Dokument wiederholt sie nicht.

---

## 7. Rotnachweis 1 — die pgTAP-Grenze auf dem Stand ohne `0017`

**Lauf `31222568290`** · PR #57 (`proof/eyt-136-red-baseline`) · Kopf
`cd0a1d3ed093bce23ca49a453c253afdd85117c3` · Job `db-gates`, Schritt _pgTAP suite (run 1)_.

Der Stand trägt Migration `0017` **nicht**: `git ls-tree -r cd0a1d3 -- supabase/migrations/` endet
bei `0016`, die Zahl der Treffer auf `0017` ist `0`. Der Nachweis misst also die offene Grenze,
nicht eine abgeschaltete Zusicherung.

TAP-Zusammenfassung im Wortlaut:

```
/…/supabase/tests/0012_planning_data_api_boundary.sql (Wstat: 0 Tests: 18 Failed: 14)
  Failed tests:  2, 4-5, 7-11, 13-18
  Parse errors: Bad plan.  You planned 16 tests but ran 18.
```

**Die 14 ist nicht die Zahl der Sicherheitsbefunde.** Die Datei führte 18 Zusicherungen aus,
deklarierte aber `plan(16)`. `pg_prove` nennt die fachliche Zahl in derselben Ausgabe selbst:
`Failed 12/16 subtests`. **Zwölf** benannte fachliche Fehlschläge:

| TAP-# | Zusicherung                                                        | gemeldet                 |
| ----- | ------------------------------------------------------------------ | ------------------------ |
| 2     | `A2` — `authenticated` hat kein `delete`-Recht mehr                | Fehlschlag               |
| 4     | `A4` — Spalte `id` aus dem `assignments`-INSERT-Grant entfernt     | Fehlschlag               |
| 5     | `A5` — `plan_versions`-INSERT nur auf `(org_id, week_key)`         | Fehlschlag               |
| 7     | `B1` — von drei Schreibpolicies bleibt genau eine                  | `have: 3 / want: 1`      |
| 8     | `B2` — `assignments`-INSERT-Policy prüft den Laufzeitkanal         | Fehlschlag               |
| 9     | `B3` — `assignments`-INSERT-Policy prüft `planning.write`          | Fehlschlag               |
| 10    | `B4` — `plan_versions`-INSERT-Policy prüft Kanal **und** Recht     | Fehlschlag               |
| 11    | `B5` — die seit `0016` wirkungslose DELETE-Policy ist entfernt     | `have: 1 / want: 0`      |
| 13    | `C1` — `assignments` INSERT außerhalb des Kanals wird abgewiesen   | `no exception` / `42501` |
| 14    | `C2` — `assignments` UPDATE wird abgewiesen                        | `no exception` / `42501` |
| 15    | `C3` — `assignments` DELETE wird abgewiesen                        | `no exception` / `42501` |
| 16    | `C4` — `plan_versions` INSERT außerhalb des Kanals wird abgewiesen | `no exception` / `42501` |

Die restlichen zwei der 14 sind die Tests **17 und 18** — sie lagen außerhalb des deklarierten
Plans. Das ist ein **Defekt der Testdatei**, keine zusätzliche Sicherheitsverletzung. Der `plan(N)`
wurde auf `plan(18)` korrigiert; ein späterer Basislauf (§ 8) bestätigt, dass der Parse-Fehler weg
ist.

**Warum diese Genauigkeit hier der Punkt ist.** Eine frühere Formulierung dieses Nachweises hätte
gelautet „14 Security-Tests waren rot". Sie überzeichnet den Befund um zwei, und zwar in die
bequeme Richtung. Ein TAP-Planfehler ist ein **kaputter Test**; ein fehlgeschlagenes `assert` ist
eine **kaputte Grenze**. Wer beides in eine Zahl wirft, hat kein Messergebnis mehr, sondern eine
Behauptung — und einem Sicherheitsreview, das hier zwei danebenliegt, ist auch bei jeder anderen
Zahl nicht mehr zu trauen. Die tragfähige Aussage lautet: **zwölf** Zusicherungen der Grenze fielen,
davon vier (`C1`–`C4`) im Verhalten, also mit tatsächlich durchgelaufenem Schreibzugriff.

## 8. Rotnachweis 2 — die Data-API-Angriffe auf dem Stand ohne `0017`

`db-gates` misst die Grenze am Katalog und an einer SQL-Sitzung. Ob **PostgREST** sie überschreitet,
sagt es nicht. Dafür gibt es diesen zweiten, unabhängigen Nachweis.

**Lauf `31237004812`** · PR #57 · Kopf `20314de424e070914e30dd543931f6be2795a361` · Job
`auth-journey`. Auch dieser Stand trägt `0017` nicht (`git ls-tree`, Treffer `0`). Gefahren wird die
echte Reise: echter GoTrue-Login, echte HttpOnly-Cookies, echtes `POST /rest/v1/…` gegen die
laufende Data API.

**Alle sechs Angriffe gelangen:**

| Akteur                                          | Angriff                                     | Ergebnis auf dem Basisstand         |
| ----------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| Reisender A (`owner`, **mit** `planning.write`) | `POST /rest/v1/assignments`                 | **201**, Zeile angelegt             |
| Reisender A                                     | `POST /rest/v1/plan_versions` (Entwurf W36) | **201**, Entwurf angelegt           |
| Reisender B (`member`, Leih-Mitgliedschaft)     | `POST /rest/v1/assignments`                 | **201**, Zeile angelegt             |
| Reisender B                                     | `PATCH /rest/v1/assignments?id=eq.…e261`    | **200**, `starts_at_utc` verschoben |
| Reisender B                                     | `DELETE /rest/v1/assignments?id=eq.…e261`   | **200**, Zeile weg                  |
| Reisender B                                     | `POST /rest/v1/plan_versions` (Entwurf W37) | **201**, Entwurf angelegt           |

Protokolliert als `[eyt136-riegel] 9c4/assignments-insert status=201 …` usw.; alle sechs Zeilen
stehen im Lauf.

**Die tragende Aussage — sie ist der nicht-vakuose Kern des ganzen Tickets:**

> Reisender A **trägt** `planning.write` — und sein direktes PostgREST-`INSERT` lieferte **201** mit
> angelegter Zeile. Vor dem Fix genügte das Recht **allein**; erst der Kanal-Riegel macht es
> unzureichend.

Das Recht ist dabei zweifach belegt, und keiner der beiden Belege setzt voraus, was er zeigen soll:

- **Über As eigenes Token.** Es liest seine eigene Mitgliedschaft (`memberships`, Policy
  `memberships_select_own` gibt nur die eigene Zeile frei: `owner`, `active`) und die passende
  Zeile in `role_permissions`. Diese beiden Lesezugriffe **sind** der Rumpf von
  `app.has_permission` — die Funktion selbst liegt im Schema `app` und ist über PostgREST nicht
  als RPC erreichbar.
- **Über die Verwaltungsverbindung.** Die Markerzeile
  `[eyt136-member-an] … owner_planning_write=1 … a_has_permission=t` befragt die Funktion direkt.

Ohne diesen Doppelbeleg bliebe offen, ob die Grenze nur „wer nichts darf, darf nichts" misst. Genau
deshalb greift der Angriff **auch** mit einem berechtigten Subjekt an, nicht nur mit einem `member`.

**Nach `0017`** liefern alle sechs **403 / SQLSTATE 42501** — gemessen im finalen Lauf
`31239875658` (§ 12). Die beiden Riegel sind dabei von außen **unterscheidbar**, und das ist
Absicht, weil ein 403 auch aus einem dritten Grund kommen könnte:

| Riegel                   | betroffene Versuche  | `message`                                                  |
| ------------------------ | -------------------- | ---------------------------------------------------------- |
| Policy (`with check`)    | die vier `INSERT`    | `new row violates row-level security policy for table "…"` |
| entzogenes Tabellenrecht | `PATCH` und `DELETE` | `permission denied for table assignments`                  |

Bei den beiden letzten prüft die Reise zusätzlich den `hint`, den PostgREST mitschickt: er muss
`GRANT UPDATE ON public.assignments TO authenticated` bzw. das `DELETE`-Gegenstück enthalten. Damit
ist nicht nur belegt, **dass** ein Recht fehlt, sondern **welches** — nämlich genau das, was `0017`
entzogen hat (`journey.pwtest.ts:369`).

**Ein bewusster Unterschied zum Feature-Branch:** der Wegwerf-Branch verwendet `expect.soft`, damit
**ein** Lauf alle sechs Ergebnisse liefert statt beim ersten Fehlschlag abzubrechen. Das ist die
einzige absichtliche Abweichung; die Angriffe selbst sind identisch. (Eine frühere Planfassung ging
noch davon aus, ein Lauf könne nur **einen** gelungenen Angriff belegen — das ist mit `expect.soft`
überholt.)

**Zweiter, unabhängiger Basisnachweis im selben Lauf:** `db-gates` war rot mit
`Tests: 18 Failed: 12` auf `0012` — zwölf fachliche Fehlschläge, und der Parse-Fehler aus § 7 ist
weg. Die beiden Rotnachweise stützen sich also nicht gegenseitig, sondern messen dieselbe Lücke
durch zwei verschiedene Kanäle: SQL-Sitzung und HTTP.

## 9. Nachgezogen: `A1` konnte Spaltenrechte gar nicht sehen

**Lauf `31238678563`** · Kopf `8cfebcfebb2d52241c8dce77eb1186056d9895c4` · `Tests: 18 Failed: 13`,
`Failed tests: 1-2, 4-5, 7-11, 13-16`.

Die ehrliche Gegenüberstellung lautet **zwölf → dreizehn** fachliche Fehlschläge, nicht „14 → 13":
die Rohzahl sinkt nur, weil der `plan(N)`-Defekt behoben ist und die Tests 17/18 wegfallen. Der
Unterschied ist exakt **+1** und exakt `A1`.

Warum `A1` vorher fehlte: die Zusicherung benutzte `has_table_privilege(…, 'UPDATE')`. Diese
Funktion **sieht Spaltenrechte nicht**. Migration `0010` hatte das Tabellenrecht `update` entzogen
und spaltenweise neu vergeben — `has_table_privilege` meldete daher schon auf dem Basisstand
`false`, und `A1` war **grün, während der `PATCH`-Angriff nachweislich gelang** (§ 8). Ein Test, der
die Eigenschaft, die er behauptet, konstruktionsbedingt nicht messen kann.

Korrigiert auf `has_any_column_privilege`. Damit fällt `A1` auf dem Basisstand mit — und die
Zusicherung ist an denselben Zustand gebunden, den der Angriff ausnutzt. Dies ist zugleich ein
Beispiel der Hausregel, dass ein grüner Test ohne benannte Gegenmutation kein Nachweis ist: `A1`
war grün, und das war die Fehlinformation.

## 10. Ausgeführte Gegenmutationen

Jede Zeile ist ein **gefahrener** Lauf auf einem eigenen Wegwerf-Branch; eine benannte, aber nie
ausgeführte Mutation zählt in diesem Repository nicht. Branch, SHA und Lauf sind gegen GitHub
geprüft.

| Mutation                                             | Branch                | SHA          | Lauf        | erwartet rot      | erste fallende Zusicherung                                                           | Urteil                  |
| ---------------------------------------------------- | --------------------- | ------------ | ----------- | ----------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| GM1 — Kanal aus `assignments`-INSERT-Policy          | `gm/eyt-136-gm1`      | `4927b2ba73` | 31238564685 | auth-journey 9c4  | `9c4 INSERT assignments: nicht mit 403 abgewiesen` — erwartet 403, **201**           | bestätigt               |
| GM2a — `planning.write` aus `plan_versions`-INSERT   | `gm/eyt-136-gm2a`     | `b831a3fcc4` | 31238574199 | write gate        | vorher abgebrochen an pgTAP `0012` `B4`                                              | **Ziel nicht erreicht** |
| GM2a-iso — dieselbe, mit isolierter pgTAP-Zeile      | `gm/eyt-136-gm2a-iso` | `93ec6e1dab` | 31238802272 | write gate        | `das Mitglied konnte eine Planversion anlegen`                                       | bestätigt               |
| GM2b — `planning.write` aus `assignments`-INSERT     | `gm/eyt-136-gm2b`     | `63373a2581` | 31238584914 | write gate        | vorher abgebrochen an pgTAP `0012` `B3`                                              | **Ziel nicht erreicht** |
| GM2b-iso — dieselbe, mit isolierter pgTAP-Zeile      | `gm/eyt-136-gm2b-iso` | `b978705329` | 31238803760 | write gate        | `das Mitglied konnte eine Zuweisung anlegen`                                         | bestätigt               |
| GM3 — `assignments`-UPDATE-Grant + Policy zurück     | `gm/eyt-136-gm3`      | `99bb26dd28` | 31238598756 | auth-journey 9c5  | `9c5 PATCH assignments: nicht mit 403 abgewiesen` — **200**                          | bestätigt               |
| GM4 — `assignments`-DELETE-Grant + Policy zurück     | `gm/eyt-136-gm4`      | `b8840bead4` | 31238658106 | auth-journey 9c5  | `9c5 DELETE assignments: nicht mit 403 abgewiesen` — **200**                         | bestätigt               |
| GM5 — Kanal aus `plan_versions`-INSERT-Policy        | `gm/eyt-136-gm5`      | `1123203861` | 31238659805 | auth-journey 9c4  | `9c4 INSERT plan_versions: nicht mit 403 abgewiesen` — **201**                       | bestätigt               |
| GM6 — Triggerfunktion als `security invoker`         | `gm/eyt-136-gm6`      | `0fc4a4f303` | 31238661331 | pgTAP + Verhalten | pgTAP `0006` `prosecdef`; write gate **übersprungen**                                | strukturell bestätigt   |
| GM6-iso — dieselbe, pgTAP-Zeile isoliert             | `gm/eyt-136-gm6-iso`  | `4f018e9fc4` | 31238804687 | Verhalten         | `die Triggerfunktion ist nicht security definer` — `expect` stand **vor** dem Insert | weiterhin strukturell   |
| GM6b — dieselbe, nach Umstellung der Fallreihenfolge | `gm/eyt-136-gm6b`     | `e0fe81a866` | 31239527407 | Verhalten         | `die Zuweisung ist in die veroeffentlichte Version gelaufen` — `fehler` war **null** | behavioural bestätigt   |

Elf Läufe. Die Kanalmatrix führt dieselben Mutationen in ihrem Abschnitt 8 in knapperer Form; dort
stehen die Beobachtungen O0–O2 im Volltext, hier stehen Branch, SHA und die erste fallende
Zusicherung.

**Zu GM2a-iso und GM2b-iso — die beiden Riegel sind nachweislich unabhängig.** Beide Sonden gaben
`kanal=true` aus: der Kanal-Riegel hielt, gefallen ist **nur** der Rechte-Riegel. Damit ist belegt,
dass die zweite Bedingung nicht bloß Beiwerk der ersten ist, sondern für sich trägt.

**Zu GM6b — die Kontrolle, die den Nachweis scharf macht.** Im selben Lauf blieb der Nachbarfall
_„eine veröffentlichte Planversion nimmt über den Laufzeitkanal keine Zuweisung mehr auf"_ **grün**
(16 ms). Sein Subjekt trägt `planning.publish`, die sperrende Lesung findet die Elternzeile also
auch als Invoker — der Trigger selbst funktioniert weiter. Gebrochen ist ausschließlich der Pfad,
der auf `security definer` angewiesen ist. Wären **beide** Fälle gefallen, hätte der Lauf nur
„der Trigger ist kaputt" gezeigt und über die Definer-Eigenschaft nichts ausgesagt.

**Zu den drei nicht erreichten Zielen — offen protokolliert.** GM2a, GM2b und GM6 brachen `db-gates`
an einer **Text**-Zusicherung ab, bevor das Verhaltensgate lief; der benannte Zielfall wurde also
**gar nicht ausgeführt** (Ursache: Abschnitt 11, O1). Das wurde **nicht** durch Anpassen der
Mutation „repariert", sondern berichtet — und mit eigenen Isolationsvarianten nachgemessen, die
genau **eine** vorgelagerte Zusicherung umstellen. Beleg dafür, dass dieser Eingriff sauber war:
in allen drei Isolationsläufen sind die pgTAP-Durchläufe 1 und 2 vollständig grün.

## 11. Zwei strukturelle Beobachtungen zum Lesen roter Läufe

Beide stehen ausführlich in der [Kanalmatrix, Abschnitt 8](2026-08-08-eyt-136-kanalmatrix.md)
(O1/O2). Sie gehören hierher, weil sie ändern, **wie ein roter Lauf zu deuten ist** — und weil beide
Beobachtungen sind, keine Handlungsaufträge: an der Struktur der CI-Jobs wird im Rahmen von EYT-136
nichts geändert.

- **`auth-journey` kann den Rechte-Riegel prinzipiell nicht sehen.** PostgREST meldet sich als
  `authenticator` an und ist nie der Laufzeitkanal, also fällt **immer der Kanal-Riegel zuerst** —
  unabhängig davon, ob das Subjekt `planning.write` trägt. Gemessen: unter GM2a und GM2b lief
  `auth-journey` **grün** durch. Der Rechte-Riegel hat damit genau **einen** Zeugen, die
  Verhaltensfälle in `apps/api/test/planning-write.integration.test.ts`. Vor diesem PR war er nur
  durch eine Textzusicherung gedeckt, die gegen `has_permission(…) or true` grün geblieben wäre.
- **`db-gates` führt pgTAP vor den Verhaltensgates aus.** Eine Mutation, die beides bricht,
  verdeckt den teureren Nachweis: `pipefail` beendet den Job, spätere Schritte erscheinen als
  `skipped`. **Ein übersprungener Schritt ist kein bestandener Schritt** — genau der Fall der drei
  Zeilen „Ziel nicht erreicht" in Abschnitt 10.

## 12. Positiver Laufzeitpfad und finaler Lauf

Eine Grenze, die alles abweist, ist keine Grenze, sondern ein Ausfall. Der finale Lauf belegt
deshalb beide Richtungen.

**Lauf `31239875658`** · Branch `fix/eyt-136-planning-data-api-boundary` · Kopf
`41f0b5f63e488f585b0eb3098feeade42c4d417f` · **11 von 11 Jobs grün**.

- **Positivpfad gemessen:** `session_user=easytree_app current_user=authenticated
runtime_channel=true` — der echte Laufzeitkanal legt Entwürfe und Zuweisungen weiterhin an.
  `[planning-write] Gate OK: executed=14 passed=14 skipped=0`.
- **Negativpfad gemessen:** alle sechs Data-API-Angriffe **403 / 42501**, mit den beiden
  unterscheidbaren Riegelmeldungen aus § 8.
- **Definer-Sonde:** `[planning-write] definer-probe kanal=true mandant_alpha=true recht_write=true
recht_publish=false lesbar=1 sperrlesbar=0 definer=true` — die gewöhnliche Lesung findet die
  Elternzeile, die **sperrende** nicht. Die Filterwirkung der `using`-Klausel ist damit gemessen,
  nicht erschlossen.

## 13. Was dieses Dokument ausdrücklich **nicht** abdeckt

- `outbox_messages`, `idempotency_records`, `audit_events` bleiben per PO-Entscheidung **Findings**
  mit Folgeticketvorschlag (§ 5), nicht Teil dieses Slices.
- Die **SELECT**-Fläche ist unangetastet; sie hängt am Subjektmodell aus EYT-14.
- `service_role` und `postgres` tragen `BYPASSRLS`. Keine Zusicherung dieses Dokuments schränkt sie
  ein.
- Kein SQL dieses Reviews lief lokal — auf der Arbeitsmaschine existiert keine Container-Laufzeit.
  `db-gates` ist die erste und einzige Ausführungsstelle. Die PO-Freigabe für „nur CI" liegt vor.
