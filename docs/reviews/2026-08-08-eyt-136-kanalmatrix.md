# Kanalmatrix der drei mitgeänderten pgTAP-Suiten (EYT-136, zweiter Reviewgang)

**Stand:** 08.08.2026 · **Baseline:** `origin/master` = `aad46ddca12abf1c4862e70248f61978dcce96e7`
· **Geprüfter Stand:** PR #56, Kopf `2b8cba2a865caf057a7fa0042671124d11ba87bb`
· **Zweck:** vollständige Ausführungskanal-Karte aller Zusicherungen in
`0004_core_domain.sql`, `0006_planning_invariants.sql` und `0007_temporal_and_idempotency.sql`,
nachdem Migration 0017 die Schreibfläche der Planung an den Laufzeitkanal gebunden hat.

## Der Prüfsatz, gegen den gemessen wurde

Eine neue Sicherheitsgrenze **darf** einen alten Test zwingen, seinen Ausführungskanal zu
wechseln. Sie **darf nicht** dazu benutzt werden, eine alte Aussage zu löschen oder
abzuschwächen. Für jede geänderte Zusicherung müssen drei Fragen schriftlich beantwortet sein:
was bewies sie, warum ist diese Form nach 0017 nicht mehr messbar, wo wird dieselbe Invariante
jetzt bewiesen — mit Datei und Zeile, nicht mit „ist ohnehin abgedeckt".

Dies ist der **zweite** Reviewgang über dieselbe Grenzfunktion. Die Hausregel dafür ist
eindeutig: ab dem zweiten Mal wird nicht mehr bemustert, sondern kartiert. Unten steht deshalb
**jede** Zusicherung der drei Dateien in Ausführungsreihenfolge, nicht eine Auswahl.

## Warum der Kanal überhaupt zum Thema wird

`app.is_runtime_channel()` ist `select session_user = 'easytree_app'` (Migration 0015). In
pgTAP ist `session_user` **immer** `postgres`: `SET SESSION AUTHORIZATION` verlangt einen
Superuser, und `postgres` ist in Supabase keiner. Eine pgTAP-Sitzung ist damit **nie** der
Laufzeitkanal — unabhängig davon, welche Rolle `set local role` gerade gesetzt hat.
`set local role` ändert `current_user`, nicht `session_user`.

Zweiter Punkt, der die Karte trägt: der **Eigentümerpfad** (`reset role`, also `postgres`)
umgeht RLS vollständig. Alle betroffenen Tabellen tragen zwar `force row level security`, aber
`postgres` trägt `BYPASSRLS` — belegt nicht durch Annahme, sondern durch den grünen Bestand auf
`origin/master`: `0006` veröffentlicht dort seit EYT-107 P1 auf dem Eigentümerpfad, und die
unmittelbar folgende `is()`-Zeile über `assignments.published_at` wäre rot, wenn das Update an
der Policy gefiltert worden wäre.

Beides zusammen ergibt die Regel, nach der unten geurteilt wird:

- Zusicherungen über **Constraints, Trigger, Katalogeinträge und Rechtelage** sind
  kanalunabhängig. Ein Wechsel auf den Eigentümerpfad kostet sie nichts.
- Zusicherungen über **Policies und den Client-Kanal** verlieren auf dem Eigentümerpfad ihren
  Gegenstand. Für sie muss ein Ersatz benannt werden — oder der Befund heißt VERLOREN.

## 1. Matrix `supabase/tests/0004_core_domain.sql` — `plan(23)`, unverändert

Zeilennummern des geprüften Standes. Eine Änderung durch PR #56: ein nacktes `reset role;`
vor der letzten Zusicherung.

| #   | Zeile | Rolle vorher    | Rolle nachher   | misst                                | Urteil                           |
| --- | ----- | --------------- | --------------- | ------------------------------------ | -------------------------------- |
| 1   | 18    | owner           | owner           | Katalog (Spalte `time_zone`)         | unverändert                      |
| 2   | 20    | owner           | owner           | Seeddaten                            | unverändert                      |
| 3   | 32    | owner           | owner           | Katalog (Trigger)                    | unverändert                      |
| 4   | 37    | owner           | owner           | Trigger (unbekannte IANA-Zone)       | unverändert                      |
| 5   | 46    | owner           | owner           | Gegenprobe zum Trigger               | unverändert                      |
| 6   | 52    | owner           | owner           | Katalog (`during`)                   | unverändert                      |
| 7   | 54    | owner           | owner           | Katalog (`published_at`)             | unverändert                      |
| 8   | 58    | owner           | owner           | Katalog (`btree_gist`)               | unverändert                      |
|     | _75_  |                 |                 | `set local role authenticated`       |                                  |
| 9   | 80    | `authenticated` | `authenticated` | RLS SELECT (fremde Org leer)         | unverändert                      |
| 10  | 85    | `authenticated` | `authenticated` | RLS SELECT                           | unverändert                      |
| 11  | 90    | `authenticated` | `authenticated` | RLS SELECT                           | unverändert                      |
| 12  | 95    | `authenticated` | `authenticated` | RLS SELECT                           | unverändert                      |
| 13  | 102   | `authenticated` | `authenticated` | RLS-Gegenprobe (eigene Org)          | unverändert                      |
| 14  | 110   | `authenticated` | `authenticated` | INSERT-Policy `employees`            | unverändert                      |
| 15  | 118   | `authenticated` | `authenticated` | INSERT-Policy `worksites`            | unverändert                      |
| 16  | 126   | `authenticated` | `authenticated` | INSERT-Policy `audit_events`         | unverändert                      |
| 17  | 140   | (Katalog)       | (Katalog)       | Tabellenrecht `audit_events` UPD     | unverändert                      |
| 18  | 146   | (Katalog)       | (Katalog)       | Tabellenrecht `audit_events` DEL     | unverändert                      |
| 19  | 155   | (Katalog)       | (Katalog)       | Tabellenrecht `employees` DELETE     | unverändert                      |
| 20  | 168   | `authenticated` | `authenticated` | Akteurbindung (fremde Person)        | unverändert                      |
| 21  | 178   | `authenticated` | `authenticated` | Akteurbindung (Akteur NULL)          | unverändert                      |
| 22  | 190   | `authenticated` | `authenticated` | Gegenprobe zur Akteurbindung         | unverändert                      |
|     | _209_ |                 |                 | **`reset role;` — neu in PR #56**    |                                  |
| 23  | 211   | `authenticated` | **owner**       | CHECK `assignments_interval_ordered` | Kanal verschoben, Aussage intakt |

**Zu R1 (das nackte `reset role`).** Es steht zwischen der letzten Zusicherung, die
`authenticated` braucht (#22, Akteurbindung), und der letzten Zusicherung der Datei. Danach
folgen nur noch `finish()` und `rollback`. Es leckt also in **keine** spätere Zusicherung, und
der Ausfallmodus „eine Policy-Aussage läuft danach als Eigentümer und ist vakuos grün" tritt
hier nicht ein. Eine Wiederherstellung mit `set local role authenticated;` wäre wirkungslos und
unterbleibt.

Der Wechsel selbst ist erzwungen: über `authenticated` lehnt seit 0017
`assignments_insert_in_org` mit 42501 ab, **bevor** der CHECK-Constraint zum Zug käme — die
Aussage von #23 wäre still verloren.

**Restrisiko, benannt statt entdeckt.** Der Insert in #23 ist ein `insert … select … limit 1`
über einen Join ohne `order by`. Unter `authenticated` war die Auswahl durch RLS auf Alpha
begrenzt; auf dem Eigentümerpfad umfasst sie beide Organisationen. Heute ist das folgenlos: der
Seed enthält **keine** veröffentlichte Planversion (`seed.sql` Z. 110 f., „published_at NULL"),
und diese Datei veröffentlicht selbst keine — `app.reject_assignment_in_published_plan()` kann
also nicht vorher feuern. Sobald der Seed eine veröffentlichte Version bekommt, würde dieser
Trigger zuerst greifen und die Zeile **rot** machen (falsche 23514-Meldung), nicht grün. Der
Befund ist damit Sprödigkeit, keine Vakuosität; er wird hier festgehalten und nicht behoben,
weil er außerhalb des Prüfsatzes liegt.

## 2. Matrix `supabase/tests/0006_planning_invariants.sql` — `plan(24)` → `plan(26)`

Zeilennummern des korrigierten Standes (nach dieser Prüfung). „vorher" = `origin/master`.

| #   | Zeile | Rolle vorher    | Rolle nachher   | misst                                                 | Urteil                                       |
| --- | ----- | --------------- | --------------- | ----------------------------------------------------- | -------------------------------------------- |
| 1   | 26    | owner           | owner           | Katalog (EXCLUDE-Constraint)                          | unverändert                                  |
| 2   | 41    | owner           | owner           | Katalog (`plan_versions_publish_assignments`)         | unverändert                                  |
| 3   | 43    | owner           | owner           | Katalog (`plan_versions_published_immutable`)         | unverändert                                  |
| 4   | 45    | owner           | owner           | Katalog (`assignments_published_immutable`)           | unverändert                                  |
| 5   | 47    | owner           | owner           | Katalog (`assignments_reject_published_plan`)         | unverändert                                  |
| 6   | 53    | (Katalog)       | (Katalog)       | Spaltenrecht `published_at` UPDATE = false            | unverändert (Erwartung gleich) — s. R2       |
| 7   | 71    | (Katalog)       | (Katalog)       | Spaltenrecht `starts_at_utc` UPDATE                   | **Erwartung invertiert** `true` → `false`    |
| 8   | 81    | (Katalog)       | (Katalog)       | Spaltenrecht `published_at` INSERT = false            | unverändert                                  |
| 9   | 87    | (Katalog)       | (Katalog)       | Spaltenrecht `starts_at_utc` INSERT = **true**        | unverändert — **positiver Anker der Datei**  |
|     | _—_   |                 |                 | `set local role authenticated` **entfernt**           |                                              |
| 10  | 126   | `authenticated` | **owner**       | partieller EXCLUDE gilt nicht für Entwürfe            | Kanal verschoben, Aussage intakt             |
| 11  | 142   | `authenticated` | **owner**       | Unveränderlichkeitstrigger greift nicht bei Entwurf   | Kanal verschoben, Aussage intakt             |
|     | _164_ |                 |                 | `reset role`                                          |                                              |
| 12  | 166   | owner           | owner           | Sync-Trigger (veröffentlichen)                        | unverändert                                  |
|     | _174_ |                 |                 | `set local role authenticated`                        |                                              |
| 13  | 176   | `authenticated` | `authenticated` | Sync-Trigger, gelesen über RLS                        | unverändert                                  |
| 14  | 200   | `authenticated` | `authenticated` | Spaltenrecht `week_key` (42501)                       | unverändert                                  |
|     | _209_ |                 |                 | `reset role`                                          |                                              |
| 15  | 211   | owner           | owner           | Unveränderlichkeitstrigger (23514)                    | unverändert                                  |
|     | _219_ |                 |                 | `set local role authenticated`                        |                                              |
| 16  | 227   | `authenticated` | `authenticated` | Tabellenrecht DELETE `plan_versions` (42501)          | unverändert                                  |
|     | _233_ |                 |                 | `reset role`                                          |                                              |
| 17  | 235   | owner           | owner           | Unveränderlichkeitstrigger beim DELETE (23514)        | unverändert                                  |
|     | _242_ |                 |                 | `set local role authenticated`                        |                                              |
| 18  | 247   | —               | `authenticated` | Tabellenrecht UPDATE `assignments` (42501)            | **neu in PR #56** (Rechteteil von #19)       |
|     | _257_ |                 |                 | `reset role`                                          |                                              |
| 19  | 259   | `authenticated` | **owner**       | Unveränderlichkeitstrigger `assignments` (23514)      | Kanal verschoben, Aussage intakt             |
| 20  | 311   | —               | owner (Katalog) | `prosecdef` von `reject_assignment_in_published_plan` | **neu in dieser Prüfung** (Ersatz zu #21)    |
| 21  | 323   | `authenticated` | **owner**       | Trigger „veröffentlichte Version nimmt nichts auf"    | Kanal verschoben — **Definer-Last VERLOREN** |
| 22  | 344   | `authenticated` | **owner**       | partieller Unique-Index (Entwurf nach Publish)        | Kanal verschoben, Aussage intakt             |
| 23  | 351   | `authenticated` | **owner**       | EXCLUDE gilt nur für Veröffentlichtes                 | Kanal verschoben, Aussage intakt             |
|     | _365_ |                 |                 | `reset role`                                          |                                              |
| 24  | 367   | owner           | owner           | EXCLUDE bei der zweiten Veröffentlichung (23P01)      | unverändert                                  |
|     | _—_   |                 |                 | `set local role authenticated` **entfernt**           |                                              |
| 25  | 384   | `authenticated` | **owner**       | Halboffenheit `[start, end)`                          | Kanal verschoben, Aussage intakt             |
|     | _—_   |                 |                 | `reset role` **entfernt** (davor ohnehin owner)       |                                              |
| 26  | 391   | owner           | owner           | Gegenprobe zum EXCLUDE                                | unverändert                                  |

## 3. Matrix `supabase/tests/0007_temporal_and_idempotency.sql` — `plan(24)`, unverändert

„nachher (PR)" = Stand `2b8cba2`; „nachher (korrigiert)" = Stand nach dieser Prüfung.

| #   | Zeile | Rolle vorher    | nachher (PR) | nachher (korrigiert) | misst                                                | Urteil                                |
| --- | ----- | --------------- | ------------ | -------------------- | ---------------------------------------------------- | ------------------------------------- |
| 1   | 49    | owner           | owner        | owner                | Zeitzonendatenbank                                   | unverändert                           |
| 2   | 55    | owner           | owner        | owner                | CET vor der Umstellung                               | unverändert                           |
| 3   | 61    | owner           | owner        | owner                | CEST nach der Umstellung                             | unverändert                           |
| 4   | 67    | owner           | owner        | owner                | erster Durchlauf der Faltung                         | unverändert                           |
| 5   | 73    | owner           | owner        | owner                | zweiter Durchlauf der Faltung                        | unverändert                           |
| 6   | 82    | owner           | owner        | owner                | `tstzrange` über die Lücke                           | unverändert                           |
| 7   | 89    | owner           | owner        | owner                | `tstzrange` über die Faltung                         | unverändert                           |
|     | _—_   |                 |              |                      | `set local role authenticated` entfernt              |                                       |
| 8   | 116   | `authenticated` | owner        | owner                | Entwurf W43 anlegen (Fixture)                        | erzwungen (0017 `plan_versions`)      |
| 9   | 123   | `authenticated` | owner        | owner                | Schicht durch die Faltung (Fixture)                  | erzwungen (0017 `assignments`)        |
|     | _148_ |                 |              |                      | `reset role`                                         |                                       |
| 10  | 150   | owner           | owner        | owner                | Umstellungswoche veröffentlichen                     | unverändert                           |
| 11  | 169   | `authenticated` | owner        | owner                | zweiter Entwurf derselben Woche                      | erzwungen                             |
| 12  | 176   | `authenticated` | owner        | owner                | überlappender Entwurf erlaubt                        | erzwungen                             |
|     | _188_ |                 |              |                      | `reset role`                                         |                                       |
| 13  | 190   | owner           | owner        | owner                | EXCLUDE an der Faltung (23P01)                       | unverändert                           |
| 14  | 205   | `authenticated` | owner        | owner                | Wirkungslosigkeit (`published_at` null)              | Kanal verschoben, Aussage **stärker** |
| 15  | 215   | `authenticated` | owner        | owner                | Verschieben der unveröff. Schicht                    | erzwungen (0017 entzieht UPDATE)      |
|     | _222_ |                 |              |                      | `reset role`                                         |                                       |
| 16  | 224   | owner           | owner        | owner                | Berührung ist kein Konflikt                          | unverändert                           |
|     | _249_ |                 |              |                      | **`set local role authenticated` wiederhergestellt** |                                       |
| 17  | 254   | `authenticated` | owner        | **`authenticated`**  | erste Outboxnachricht                                | **WEAKENED → korrigiert**             |
| 18  | 260   | `authenticated` | owner        | **`authenticated`**  | Idempotenz-Unique (23505)                            | **WEAKENED → korrigiert**             |
| 19  | 266   | `authenticated` | owner        | **`authenticated`**  | Wirkungslosigkeit (genau eine Zeile)                 | **WEAKENED → korrigiert**             |
| 20  | 278   | `authenticated` | owner        | **`authenticated`**  | Gegenprobe anderer Schlüssel                         | **WEAKENED → korrigiert**             |
| 21  | 287   | `authenticated` | owner        | **`authenticated`**  | Gegenprobe anderer Nachrichtentyp                    | **WEAKENED → korrigiert**             |
|     | _304_ |                 |              |                      | **`reset role` neu**                                 |                                       |
| 22  | 307   | `authenticated` | owner        | owner                | Entwurf W44 anlegen                                  | erzwungen (0017)                      |
| 23  | 313   | `authenticated` | owner        | owner                | partieller Unique-Index (23505)                      | erzwungen                             |
| 24  | 319   | `authenticated` | owner        | owner                | Wirkungslosigkeit (genau ein Entwurf)                | erzwungen (steht hinter #22/#23)      |

**Zu #14.** Der Wechsel auf den Eigentümerpfad ist hier keine Einbuße, sondern eine
Verbesserung, und das ist nicht offensichtlich: `select published_at … where id = …` liefert
NULL, wenn RLS die Zeile **filtert** — die Zusicherung „published_at ist null" wäre unter
`authenticated` also auch dann grün geworden, wenn die SELECT-Policy kaputt gewesen wäre.
Auf dem Eigentümerpfad wird der wahre Wert gelesen. Nicht wiederhergestellt, mit Begründung.

**Zu R4, `app.current_user_id()`.** Sie ist `auth.uid()` (Migration 0002, Z. 87-94), und
`auth.uid()` liest die transaktionslokale Einstellung `request.jwt.claims`. Diese wird in allen
drei Dateien mit `set_config(…, true)` gesetzt — **unabhängig von der Rolle**. Der
Eigentümerpfad löst sie also unverändert auf; geprüft an der einzigen Stelle, an der es
inhaltlich zählt: `app.reject_assignment_in_published_plan()` verzweigt über
`auth.uid() is null or pv.org_id in (select app.user_org_ids())` (Migration 0016, Z. 132-155).
Mit gesetzten Claims (User A, aktiv in Alpha) findet die Funktion die Alpha-Elternzeilen aller
hier berührten Planversionen. Das ist gelesen, nicht angenommen — ausgeführt wurde es nicht
(siehe Abschnitt 7).

## 4. Die geänderten Zusicherungen, mit den drei Pflichtspalten

| Ort (vorher)                     | alte Aussage                                                                                                                                     | warum in dieser Form nach 0017 nicht mehr messbar                                                                                                                          | wo dieselbe Invariante jetzt bewiesen wird                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `0004` Z. 203 (alt), heute 211   | CHECK `assignments_interval_ordered` lehnt `start == end` ab, gemessen über den Clientkanal                                                      | `assignments_insert_in_org` lehnt über `authenticated` mit 42501 ab, bevor der Constraint greift                                                                           | Constraintteil: `0004:211` (Eigentümerpfad). Kanalteil: `0012:142` (C1)                                                    |
| `0006` Z. 53 (alt), heute 71     | Spaltenmodell auf UPDATE ist granular: `starts_at_utc` **ja**, `published_at` **nein**                                                           | 0017 entzieht `update` auf `assignments` vollständig — die Aussage ist nicht unmessbar, sondern **falsch geworden**                                                        | Granularität heute auf der INSERT-Seite: `0006:81` (nein) + `0006:87` (**ja**); zusätzlich `0012:58` (A3) + `0012:63` (A4) |
| `0006` Z. 89 (alt), heute 126    | (i) EXCLUDE gilt nicht für Entwürfe **und** (ii) ein Mitglied darf über die Data-API Entwürfe anlegen                                            | (ii) ist der Angriffsweg A-1 und wurde absichtlich geschlossen                                                                                                             | (i) `0006:126` + `0012:187` (D1). (ii) als **Ablehnung**: `0012:142` (C1)                                                  |
| `0006` Z. 105 (alt), heute 142   | (i) der Unveränderlichkeitstrigger greift bei Entwürfen nicht **und** (ii) `authenticated` darf löschen                                          | (ii) ist Angriffsweg A-3, 0017 entzieht das Recht                                                                                                                          | (i) `0006:142` + `0012:198` (D2). (ii) als **Ablehnung**: `0012:51` (A2) + `0012:163` (C3)                                 |
| `0006` Z. 207 (alt), heute 259   | eine veröffentlichte Zuweisung lässt sich nicht verschieben — gemessen über 23514 unter `authenticated`                                          | `authenticated` hat kein `update` mehr; über den Clientkanal käme 42501 statt 23514, der Trigger bliebe ungemessen                                                         | zerlegt in zwei: Recht `0006:247` (42501, `authenticated`), Trigger `0006:259` (23514, Eigentümer)                         |
| `0006` Z. 223 (alt), heute 323   | (i) Trigger weist Zuweisungen in veröffentlichte Versionen ab **und** (ii) `security definer` trägt das `for share` außerhalb des Laufzeitkanals | (i) ist unverändert messbar; (ii) braucht eine Sitzung, die die INSERT-Policy passiert **und** an der `using`-Klausel der UPDATE-Policy scheitert — die gibt es nicht mehr | (i) `0006:323`. (ii) **behavioural verloren**, ersetzt durch die strukturelle Zusicherung `0006:311` — Befund B1           |
| `0006` Z. 244/251 (alt), 344/351 | ein neuer Entwurf derselben Woche und eine kollidierende Entwurfszuweisung sind erlaubt                                                          | beide Inserts fallen über `authenticated` in 42501                                                                                                                         | `0006:344` / `0006:351` (Eigentümerpfad); Kanalteil `0012:171` (C4) und `0012:142` (C1)                                    |
| `0006` Z. 282 (alt), heute 384   | (i) Halboffenheit `[start, end)` **und** (ii) `authenticated` darf Fachspalten ändern                                                            | (ii) ist entzogen                                                                                                                                                          | (i) `0006:384`. (ii) als **Ablehnung**: `0006:247`, `0012:46` (A1), `0012:155` (C2)                                        |
| `0007` Z. 111/118/159/166 (alt)  | Fixtures für die Umstellungswoche, angelegt über den Clientkanal                                                                                 | `plan_versions`/`assignments` INSERT verlangen den Laufzeitkanal                                                                                                           | Constraintteil `0007:116/123/169/176`; Kanalteil `0012:142` (C1) und `0012:171` (C4)                                       |
| `0007` Z. 200 (alt), heute 215   | die unveröffentlichte Schicht lässt sich verschieben                                                                                             | `update` auf `assignments` ist entzogen                                                                                                                                    | `0007:215` (Eigentümerpfad); Rechteteil `0012:46` (A1) + `0012:155` (C2)                                                   |
| `0007` Z. 222-277 (alt), Outbox  | Idempotenz über `outbox_messages` — **und** dass ein aktives Mitglied Nachrichten anfügen darf                                                   | **entfällt: 0017 fasst `outbox_messages` nicht an.** Der Kanalwechsel war nicht erzwungen                                                                                  | zurückgenommen — `0007:249` setzt `authenticated` wieder, Befund B2                                                        |

## 5. Befunde

### B1 — VERLOREN: der Verhaltensnachweis für `security definer`

`app.reject_assignment_in_published_plan()` liest die Elternzeile mit `select … for share`.
PostgreSQL zieht bei einer Sperrklausel zusätzlich die `using`-Klausel der UPDATE-Policy heran.
Bis EYT-136 lief der Fall in `0006` über `authenticated` **außerhalb** des Laufzeitkanals; dort
scheiterte diese Klausel, und ohne `security definer` (0015/0016) fände das `select` nichts, der
Zweig „nicht gefunden" ließe die Zuweisung durch — der Test wäre grün-falsch. Genau so fiel er
am 04.08.2026 in Lauf 30862744360 auf. Der Fall trug also zwei Aussagen.

Seit 0017 lehnt `assignments_insert_in_org` über `authenticated` mit 42501 ab, bevor der Trigger
feuert. PR #56 hat den Fall deshalb auf den Eigentümerpfad gezogen — dort umgeht `postgres` RLS,
und der Invoker-Pfad fände die Zeile ebenso. **Die Definer-Aussage ist damit hier weg.**

Die Kommentierung in PR #56 behauptete, sie sei nach
`apps/api/test/planning-write.integration.test.ts` umgezogen, in den Fall „eine veröffentlichte
Planversion nimmt über den Laufzeitkanal keine Zuweisung mehr auf" (dort Z. 1048-1088). **Das
trifft nicht zu, und der Grund steht in den Migrationen:**

- Dieser Fall läuft **im** Laufzeitkanal, mit `USER_A`.
- `USER_A` ist `owner` in Alpha (`seed.sql` Z. 46), und `role_permissions` gibt `owner` alle drei
  Planungsrechte, `planning.publish` eingeschlossen (Migration 0015, Z. 181-187).
- `plan_versions_update_in_org` (Migration 0015, Z. 243-255) fordert in `using` genau
  `app.is_runtime_channel() and org_id in (…) and app.has_permission(org_id,'planning.publish')`.
  Alle drei sind erfüllt.
- Das `for share` fände die Elternzeile also **auch als Invoker**. Die Definer-Eigenschaft wird
  dort weder gebraucht noch gemessen; der Fall beweist den Trigger.

Weiter: der Nachweis ist heute **nirgends** mehr behavioural erreichbar. Er bräuchte ein Subjekt
mit `planning.write` **ohne** `planning.publish`. `role_permissions` vergibt beide an dieselben
zwei Rollen (`owner`, `manager`); `member` bekommt keine. Ein solches Subjekt existiert im
Rechtemodell nicht.

**Korrektur.** `supabase/tests/0006_planning_invariants.sql:311` erhält eine **strukturelle**
Zusicherung — `prosecdef` der Funktion ist `true` — und sie wird im Kommentar ausdrücklich als
Stolperdraht und **nicht** als Verhaltensbeweis bezeichnet. `plan(25)` → `plan(26)`. Der
irreführende Kommentar in `0006` ist ersetzt.
Benannte Gegenmutation: die Funktion in einer Folgemigration als `security invoker` neu anlegen;
dann wird `0006:311` rot. **Nicht ausgeführt** (Abschnitt 7), offener Punkt.

Zwei Restpunkte, die diese Prüfung nicht schließt:

1. Der Docblock in `apps/api/test/planning-write.integration.test.ts` Z. 1027-1047 erhebt
   denselben unzutreffenden Anspruch („Hier ist sie es"). Die Datei ist in dieser Aufgabe
   ausdrücklich gesperrt und wurde **nicht** angefasst. → offener Punkt.
2. `supabase/tests/0011_planning_publish.sql` Z. 388-418 prüft den Zusatzfilter aus 0016
   (`auth.uid() is null …`) auf dem Eigentümerpfad. Auch dort ist Invoker == Definer, weil
   `postgres` RLS ohnehin umgeht — dieser Fall trägt die Definer-Aussage ebenfalls nicht.

### B2 — GESCHWÄCHT: der Outboxblock in `0007` hat den Kanal ohne Zwang gewechselt

PR #56 hat vier `set local role authenticated;` in `0007` durch Kommentare ersetzt. Drei der
vier Regionen sind erzwungen — sie legen Planversionen oder Zuweisungen an, und beides bindet
0017 an den Laufzeitkanal. Die vierte Region ist es **nicht**: sie enthält den kompletten
Idempotenzblock über `public.outbox_messages` (fünf Zusicherungen), und Migration 0017 fasst
diese Tabelle nicht an. Recht (`grant select, insert, update`, Migration 0008 Z. 99) und Policy
(`outbox_messages_insert_in_org`, ebd. Z. 135) sind unverändert.

Was der Wechsel gekostet hätte: unter `authenticated` belegten diese fünf Zeilen zusätzlich, dass
ein aktives Mitglied Nachrichten der **eigenen** Organisation überhaupt anfügen darf. Keine
andere pgTAP-Datei sagt das — geprüft über alle Dateien in `supabase/tests/`; `outbox_messages`
kommt sonst nur in `0011` (eine Zählabfrage) und `0005` (Meta-Gate-Liste) vor. Auf dem
Eigentümerpfad wäre ein Entzug dieses Rechts unbemerkt geblieben.

**Korrektur.** `supabase/tests/0007_temporal_and_idempotency.sql:249` setzt
`set local role authenticated;` wieder, `:304` schaltet vor dem `plan_versions`-Block auf den
Eigentümerpfad zurück — dort ist der Wechsel erzwungen. Beide Kommentare nennen den Unterschied.
Die Anzahl der Zusicherungen ändert sich nicht, `plan(24)` bleibt.

### B3 — NICHT geschwächt: die invertierte Spaltenrechtszeile (R2)

Die Ausgangslage ist real: `0006:53` („`published_at` ist nicht änderbar") kann heute nicht mehr
allein deshalb rot werden, weil das UPDATE-Recht auf `assignments` insgesamt fehlt. Die frühere
Gegenprobe darunter wurde invertiert statt ersetzt.

Trotzdem lautet das Urteil **nicht geschwächt**, und zwar aus einem prüfbaren Grund: die Rolle
der Gegenprobe ist, den Ausfallmodus „alles ist false, weil `authenticated` gar keine Rechte mehr
hat" auszuschließen. Diesen Ausfallmodus falsifiziert `0006:87` — `has_column_privilege(…,
'starts_at_utc', 'insert') = true` — **in derselben Datei, vier Zeilen weiter**, zusammen mit
`0006:81` als negativem Gegenstück. Das Paar auf der INSERT-Seite ist heute der lebende
Granularitätsnachweis, und `0012:58` (A3) sowie `0012:63` (A4) wiederholen ihn außerhalb.

Zudem ist `0006:53` nicht vakuos im Wortsinn dieses Repositories („grün aus einem Grund, der
nichts mit der Eigenschaft zu tun hat"): würde jemand `update (published_at)` erneut vergeben,
würde die Zeile rot. Sie ist von ihrer Nachbarin **impliziert**, nicht bedeutungslos. Zwei
Zusicherungen, die nur gemeinsam fallen können, sind redundant — sie sind keine Lücke.

Der bestehende Kommentar in `0006` benennt diesen Anker bereits ausdrücklich
(„Die Nicht-Vakuosität des Spaltenmodells trägt ab jetzt die insert-Seite weiter unten … sowie
0012 A1/A3"). **Keine Änderung.**

### B4 — NICHT geschwächt: das nackte `reset role` in `0004` (R1)

Begründung in Abschnitt 1. Es folgt keine Zusicherung mehr, die `authenticated` braucht; das
Leckrisiko tritt nicht ein. Restrisiko (nichtdeterministisches `limit 1`) ist dort benannt und
führt im Fehlerfall zu Rot, nicht zu falschem Grün. **Keine Änderung.**

### B5 — Dokumentationsungenauigkeit, keine Korrektur

Der Kopf von `0012_planning_data_api_boundary.sql` (Z. 30-37) sagt, D1/D2 „führen zwei
Zusicherungen weiter, die bis EYT-136 in `0006` unter `set local role authenticated` liefen".
Tatsächlich stehen die Originale **weiterhin** in `0006` (Z. 126 und 142), nur auf dem
Eigentümerpfad — sie sind gedoppelt, nicht umgezogen. Kein Beweisverlust, deshalb keine Änderung.

## 6. `plan(N)` vorher/nachher

| Datei                                 | `origin/master` | PR #56 (`2b8cba2`) | nach dieser Prüfung |
| ------------------------------------- | --------------- | ------------------ | ------------------- |
| `0004_core_domain.sql`                | 23              | 23                 | 23                  |
| `0006_planning_invariants.sql`        | 24              | 25                 | **26**              |
| `0007_temporal_and_idempotency.sql`   | 24              | 24                 | 24                  |
| `0012_planning_data_api_boundary.sql` | —               | 18                 | 18                  |

Alle vier Werte sind gegen die tatsächliche Zahl der Zusicherungen in der jeweiligen Datei
nachgezählt worden. Ein falsches `plan(N)` ist selbst ein Defekt — PR #57 hat mit `plan(16)`
bei 18 Tests die TAP-Ausgabe unlesbar gemacht.

## 7. Was hier NICHT ausgeführt wurde

Damit niemand Überlegung für Messung hält:

- **Kein einziges SQL dieser Prüfung ist lokal gelaufen.** Auf der Arbeitsmaschine existiert
  keine Container-Laufzeit; der lokale Supabase-Stack ist nicht startbar. Der CI-Job `db-gates`
  ist die erste und einzige Stelle, an der Migrationen und pgTAP dieses Repositories überhaupt
  ausgeführt werden. Die PO-Freigabe für „nur CI" liegt vor.
- **Alle Aussagen über Policies, Grants, Trigger und `prosecdef` in diesem Dokument sind aus dem
  Migrationstext gelesen**, nicht aus einem Katalog abgefragt. Wo eine Aussage aus einem
  gemessenen Zustand stammt, ist die Quelle genannt (Abschnitt 2, `BYPASSRLS`: aus dem grünen
  Bestand auf `origin/master`).
- **Befund B1 ist eine Ableitung, keine Gegenmutation.** Dass der Fall in
  `planning-write.integration.test.ts` die Definer-Eigenschaft nicht misst, folgt aus dem
  Zusammenspiel von `plan_versions_update_in_org` (0015 Z. 243-255), `role_permissions`
  (0015 Z. 181-187) und der Rolle von `USER_A` (`seed.sql` Z. 46). **Ausgeführt** wäre der
  Nachweis erst, wenn die Funktion einmal als `security invoker` liefe und der Test grün bliebe.
  Das steht aus.
- **Die Gegenmutation zur neuen Zusicherung `0006:311` ist benannt, aber nicht gefahren.** Sie
  verlangt eine Wegwerf-Folgemigration und einen eigenen `db-gates`-Lauf.
- **Nicht geprüft:** ob der Angriffsweg über PostgREST nach 0017 tatsächlich 42501 liefert. Das
  ist eine Aussage über das laufende Produktivsystem und gehört nicht in pgTAP.
