---
ticket: EYT-107
titel: "Reviewbefunde F1–F5 zur P1-Korrektur"
branch: fix/eyt-107-f1-insert-boundary
basis: 4a605dedc0e61bd4f12f15bb911ddbbfa8c41ab3
pr: neu
status: ready-for-execution
erstellt: 2026-08-04
---

# EYT-107 — Reviewbefunde F1 bis F5

> **Planänderung 04.08.2026, erzwungen.** Dieser Plan entstand gegen den offenen
> PR #52 und sah vor, Migration **0015 an Ort und Stelle** zu korrigieren — das
> war zulässig, solange sie nirgends angewandt und nicht gemergt war.
>
> **PR #52 wurde um 01:57 UTC gemergt** (Merge-Commit `4a605de`, Head `226f6b6`,
> elf Pflichtchecks grün). Nicht durch diese Sitzung. Damit gilt für 0015 wieder
> die append-only-Regel aus `CLAUDE.md`.
>
> Konsequenz: **T-05 wird zu einer neuen Vorwärtsmigration `0016`.** Inhalt und
> Nachweise bleiben unverändert; nur der Ort ändert sich. Basis ist jetzt
> `origin/master`, der Branch ist neu, und es braucht einen neuen PR.
>
> Zweite Konsequenz, die benannt gehört: **F1 liegt seit dem Merge auf
> `master`.** Die gehostete Datenbank ist davon nicht betroffen — sie steht auf
> 0013, 0014 und 0015 sind dort nicht angewandt.

<!-- GOAL_START -->

## Ziel

Das Selbstreview der P1-Korrektur hat fünf Befunde ergeben. **F1** macht die
gemeldete Erfüllung von Invariante 1 hinfällig: die Korrektur hat `UPDATE`
abgedichtet und `INSERT` nicht angesehen.

**F1 — kritisch.** Gemessen am gehosteten Projekt (read-only, 04.08.2026):

```
has_column_privilege('authenticated','public.plan_versions','published_at','insert') = true
has_column_privilege('authenticated','public.plan_versions','published_by','insert') = true
has_column_privilege('authenticated','public.assignments','published_at','insert')   = false
```

Beide Trigger auf `plan_versions` sind `after update of published_at` bzw.
`before update or delete` — **keiner feuert bei INSERT**. Die Insert-Policy
prüft nur die Organisation, und `plan_versions_one_draft_per_week` ist partiell
(`where published_at is null`), kollidiert also nicht.

Ein aktives Mitglied kann damit per `POST /rest/v1/plan_versions` mit gesetztem
`published_at`/`published_by` eine **von Geburt an veröffentlichte** Planversion
anlegen: unveränderlich, unlöschbar, ohne Wochenzuordnungs- und Konfliktprüfung,
ohne Idempotenz, ohne Audit, ohne Outbox.
`planning-window.repository.ts:130` gibt sie als `publishedVersionId` aus — die
Woche zeigt „Veröffentlicht", der echte Publish scheitert ab dann mit
`already-published`, und EYT-109 nähme sie als gültige Kostenquelle.

**F2 bis F5**, ausführlich unter „Die vier weiteren Befunde":

- **F2, mittel** — die Definer-Korrektur an
  `app.reject_assignment_in_published_plan()` hat eine bestehende Invariante
  verengt: ohne JWT-Claims ist `auth.uid()` NULL, `app.user_org_ids()` leer, und
  eine Zuweisung landet in einer veröffentlichten Planversion.
- **F3, mittel** — `authenticated` besitzt `delete` auf `plan_versions`, die
  Policy prüft nur die Organisation, kein Command löscht. Über die Data-API
  löscht jedes Mitglied einen Entwurf samt Zuweisungen (`on delete cascade`).
- **F4, gering** — Runbook-Kopf veraltet; `CLAUDE.md` erwähnt die Kanalgrenze
  mit keinem Wort.
- **F5, gering** — `db-gates` provisioniert das Passwort zweimal.

## Was hergestellt wird

| Befund | Korrektur                                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1     | `revoke insert on plan_versions from authenticated`, danach `grant insert (id, org_id, week_key)`; zusätzlich `published_at is null` im `with check` der Insert-Policy — zwei unabhängige Riegel, wie bei der Kanalgrenze. |
| F2     | Sichtbarkeitsbedingung auf `(auth.uid() is null or pv.org_id in (select app.user_org_ids()))`. Ohne Anwendungsidentität gilt wieder die alte, universelle Regel; mit Identität bleibt das Existenzleck geschlossen.        |
| F3     | `revoke delete on plan_versions from authenticated`. Ein Recht, das kein Command benutzt, ist reine Angriffsfläche.                                                                                                        |
| F4     | Runbook-Kopf richtigstellen; `CLAUDE.md` um die Kanal- und Spaltengrenze ergänzen.                                                                                                                                         |
| F5     | Den zweiten Provisionierungsschritt streichen.                                                                                                                                                                             |

## Nachweisebene

Drei Ebenen wie bei der P1-Korrektur, alle in **bestehenden** Pflichtjobs:
pgTAP für Katalogrechte und Verhalten, und für F1 zusätzlich ein realer
PostgREST-`POST` in `auth-journey` — der einzige Ort mit dem echten
Angriffskanal.

<!-- GOAL_END -->

## Die vier weiteren Befunde

**F2 — mittel.** `app.user_org_ids()` filtert auf `m.user_id = auth.uid()`; ohne
JWT-Claims ist `auth.uid()` NULL, die Menge leer, der Zweig „nicht gefunden"
greift — und eine Zuweisung landet in einer veröffentlichten Planversion.
Vorher (invoker, als `postgres` mit BYPASSRLS) fand das `for share` die Zeile
und lehnte ab. Betroffen sind Sitzungen ohne Anwendungsidentität: psql,
Migrationsskripte, Wartungszugriffe. Der Definer-Umbau selbst war richtig; sein
Zusatzfilter war zu breit.

**F3 — mittel.** `has_table_privilege('authenticated','public.plan_versions','delete')`
ist `true`, und die Delete-Policy prüft nur die Organisation. Kein Command
löscht Planversionen. Über die Data-API kann jedes Mitglied einen Entwurf
löschen — und `assignments.plan_version_id` ist `on delete cascade` (0007), die
Wochenplanung ist damit still weg. Veröffentlichtes schützt weiterhin der
Trigger aus 0010.

**F4 — gering.** Der Runbook-Kopf nennt „Stand 03.08.2026 · Basis-SHA d9b9607"
über 04.08.-Inhalt. `CLAUDE.md` erwähnt die Kanalgrenze mit **keinem Wort**
(`grep -c` = 0), obwohl die Login-Rolle jetzt Teil der Sicherheitsgrenze ist —
eine Regel derselben Klasse wie „PostgreSQL-Verbindungen werden an genau einer
Stelle gebaut", die dort ausführlich steht.

**F5 — gering.** `db-gates` provisioniert das Passwort für `easytree_app`
zweimal (Schritt 208 und 417). Zwischen beiden liegt kein Stack-Neustart; der
zweite ist wirkungslos.

## Non-Goals

- **NG-1** — `assignments` behält `delete` und `update` ohne fachliche
  Rechteprüfung. Das ist der schon protokollierte Folgebefund BEFUND-2; er
  betrifft Entwurfsdaten, nicht die Veröffentlichung, und eine Änderung dort
  bräche einen bestehenden, absichtlichen Test
  (`0006`: „Eine unveroeffentlichte Zuweisung laesst sich loeschen").
- **NG-2** — Keine Kanalgrenze auf `insert` oder `delete`. Der Entwurfspfad
  läuft heute legitim über beide, und `createAssignment` legt Entwürfe an.
- **NG-3** — EYT-109/EYT-110 unberührt; kein Remote-Anwenden von 0014/0015;
  kein Railway; kein Merge; Jira bleibt _In Arbeit_.

## Vorbedingungen und bekannte Lücken

### Gemessene Evidenz (04.08.2026)

| Nr.  | Aussage                                                                                 | Quelle                                                           |
| ---- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| E-1  | `published_at`/`published_by` sind für `authenticated` per INSERT beschreibbar          | Supabase-MCP `execute_sql`, read-only, `has_column_privilege`    |
| E-2  | `assignments.published_at` ist es nicht — 0010 hat dort einen Spalten-Grant gesetzt     | dieselbe Messung; `0010:84`                                      |
| E-3  | Auf `plan_versions` existieren genau zwei Trigger, beide nur für `update`/`delete`      | `git grep "create trigger" supabase/migrations` → `0010:129,188` |
| E-4  | `plan_versions_one_draft_per_week` ist partiell auf Entwürfe                            | `0007:36-38`                                                     |
| E-5  | `publishedVersionId` kommt aus der jüngsten veröffentlichten Zeile der Woche            | `planning-window.repository.ts:95-130`                           |
| E-6  | `app.user_org_ids()` filtert `m.user_id = auth.uid()` — ohne Claims leere Menge         | `0002_tenancy.sql`                                               |
| E-7  | `has_table_privilege(... plan_versions, 'delete') = true`                               | dieselbe MCP-Messung                                             |
| E-8  | Zwischen den beiden Passwortschritten liegt kein Stack-Neustart                         | `ci.yml`, Schrittliste 194–459                                   |
| E-9  | `plan_versions_publication_complete`: `(published_at is null) = (published_by is null)` | `0007:27-28`                                                     |
| E-10 | Kein Produktivpfad löscht `plan_versions`; die Testaufräumung nutzt die Adminverbindung | `git grep "delete from public.plan_versions"`                    |

### ASSUMPTION

- **A-1** — Der Publish-Command legt Planversionen ausschließlich mit
  `(org_id, week_key)` an (`planning-write.repository.ts:469`), Tests zusätzlich
  mit `id`. Der Spalten-Grant deckt genau diese drei. Fällt die Annahme,
  scheitert der Pfad mit `42501` — laut, nicht still.
- **A-2** — `auth.uid() is null` unterscheidet zuverlässig „keine
  Anwendungsidentität" von „angemeldeter Mensch". Über PostgREST setzt GoTrue
  die Claims immer; der Laufzeitkanal setzt sie im Runner. Der Nullfall ist
  damit Wartungszugriff.

### MISSING

- **M-1** — Weiterhin kein Docker auf diesem Rechner: jede SQL-Aussage wird zum
  ersten Mal in CI ausgeführt.

### BLOCKER

Keiner. Status: `ready-for-execution`.

## Anforderungen

| ID      | Anforderung                                                                          | Akzeptanz                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-F1a | `authenticated` kann `published_at`/`published_by` nicht per INSERT setzen.          | `has_column_privilege(...,'published_at','insert') = false`; ein `insert … published_at` wirft `42501`.                                                            |
| REQ-F1b | Auch ohne Spaltengrenze bliebe eine geborene Veröffentlichung ausgeschlossen.        | Die Insert-Policy trägt `published_at is null`; Gegenmutation „Spalten-Grant zurück" lässt den Fall weiterhin scheitern, Gegenmutation „Policy-Zusatz weg" ebenso. |
| REQ-F1c | Über die echte Data-API entsteht keine veröffentlichte Planversion.                  | `auth-journey`: `POST /rest/v1/plan_versions` mit `published_at` → keine Zeile; die Woche bleibt Entwurf.                                                          |
| REQ-F2  | Eine veröffentlichte Planversion nimmt auch **ohne** JWT-Claims keine Zuweisung auf. | pgTAP: Claims leeren, als Eigentümer einfügen → `23514`.                                                                                                           |
| REQ-F3  | `authenticated` besitzt kein `delete` auf `plan_versions`.                           | `has_table_privilege(...,'delete') = false`; der bestehende Löschversuch wirft `42501` statt `23514`, der Trigger wird auf dem Eigentümerpfad belegt.              |
| REQ-F4  | Runbook-Kopf und `CLAUDE.md` beschreiben den Stand.                                  | Kopf nennt Datum und Basis-SHA des aktuellen Stands; `grep -c "is_runtime_channel" CLAUDE.md ≥ 1`.                                                                 |
| REQ-F5  | `db-gates` provisioniert das Passwort genau einmal.                                  | `grep -c "alter role easytree_app password" .github/workflows/ci.yml` = 1; Job bleibt grün.                                                                        |

## Architektur- und Dateigrenzen

| Datei                                                            | Befund     | Art                                                |
| ---------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| `supabase/migrations/…0016_planning_publish_insert_boundary.sql` | F1, F2, F3 | **neu** — 0015 ist gemergt und bleibt unangetastet |
| `supabase/tests/0011_planning_publish.sql`                       | F1, F2, F3 | Ergänzung                                          |
| `supabase/tests/0006_planning_invariants.sql`                    | F3         | Aufteilung des Löschfalls                          |
| `apps/web/e2e/auth-journey/journey.pwtest.ts`                    | F1c        | neuer Schritt 9c3                                  |
| `docs/runbooks/planning-publish.md`                              | F4         | Kopf + Abschnitt                                   |
| `CLAUDE.md`                                                      | F4         | Kanalgrenze aufnehmen                              |
| `.github/workflows/ci.yml`                                       | F5         | Schritt entfernen                                  |
| `docs/reviews/2026-08-04-eyt-107-p1-gegenmutationen.md`          | alle       | Protokoll fortschreiben                            |

Alle Pfade liegen im bestehenden PRIL-Manifest. **Keine Scope-Änderung.**

## Aufgaben

### T-01 — pgTAP: rote Nachweise für F1, F2, F3 (40 min) · REQ-F1a/b, REQ-F2, REQ-F3

`supabase/tests/0011_planning_publish.sql`, neuer Abschnitt nach der
Spaltengrenze:

- `has_column_privilege('authenticated','public.plan_versions','published_at','insert')` → `false`;
  Gegenprobe `week_key` → `true`.
- `insert into public.plan_versions (org_id, week_key, published_at, published_by)` → `42501`.
- `has_table_privilege('authenticated','public.plan_versions','delete')` → `false`.
- Nach dem Eigentümer-Publish (Abschnitt 4): Claims leeren
  (`select set_config('request.jwt.claims', null, true)`), dann als Eigentümer
  eine Zuweisung in die veröffentlichte Version einfügen → `23514`. Danach
  Claims wiederherstellen.
- `plan(n)` anpassen.

### T-02 — pgTAP 0006: Löschfall aufteilen (15 min) · REQ-F3

`throws_ok(delete from public.plan_versions …, '23514')` läuft über
`authenticated` und wird nach dem Entzug `42501`. Aufteilen wie beim
`week_key`-Fall: über `authenticated` → `42501` (Recht), über den Eigentümer →
`23514` (Trigger). `plan(n)` +1.

### T-03 — auth-journey: `POST` über die echte Data-API (30 min) · REQ-F1c

Schritt **9c3**, unmittelbar nach 9c2, also weiterhin vor dem echten Publish.
Dasselbe Token wie in 9c2. `POST ${SUPABASE_URL}/rest/v1/plan_versions` mit
`org_id`, einer **anderen** Woche (`2026-W35`, damit der Entwurf von 9c/9d
unberührt bleibt), `published_at`, `published_by`, `Prefer: return=representation`.
Erwartung: keine Zeile. Danach über PostgREST prüfen, dass für diese Woche
keine Planversion existiert.

### T-04 — Roten Lauf erzeugen (20 min Wartezeit) · alle

T-01 bis T-03 committen, pushen, `db-gates` und `auth-journey` lesen. Erwartet:
beide rot mit den benannten Fällen.

### T-05 — Neue Migration `0016` (30 min) · REQ-F1a/b, REQ-F2, REQ-F3

`supabase/migrations/20260804020000_0016_planning_publish_insert_boundary.sql`.
**Nicht** in 0015 — die ist seit dem Merge von PR #52 append-only.

```sql
revoke insert, delete on table public.plan_versions from authenticated;
grant insert (id, org_id, week_key) on table public.plan_versions to authenticated;

drop policy plan_versions_insert_in_org on public.plan_versions;
create policy plan_versions_insert_in_org on public.plan_versions
  for insert to authenticated
  with check (
    org_id in (select app.user_org_ids())
    and published_at is null
  );
```

und `create or replace function app.reject_assignment_in_published_plan()` mit

```sql
and (auth.uid() is null or pv.org_id in (select app.user_org_ids()))
```

Kopfkommentar: F1 als Messung, nicht als Behauptung; F2 mit der Begründung,
warum der Nullfall Wartungszugriff ist; F3 mit „ein Recht ohne Command ist
Angriffsfläche". Eigener Rollbackblock; 0015 bleibt unangetastet.

### T-06 — Doku (25 min) · REQ-F4

- Runbook-Kopf auf den neuen Stand; Abschnitt „Rechte" um INSERT und DELETE
  ergänzen.
- `CLAUDE.md`: die Kanal- und Spaltengrenze als Regel aufnehmen, neben der
  bestehenden Regel zur einen Verbindungsfabrik. Mit dem Betriebshinweis zum
  Pooler.

### T-07 — CI entdoppeln (10 min) · REQ-F5

Schritt 417 entfernen; im verbleibenden Kommentar festhalten, dass er beides
trägt (Gates und Smokes) und warum er nach der Rollen-Probe stehen muss.

### T-08 — Grüner Lauf (20 min Wartezeit) · alle

Elf Pflichtchecks auf demselben Head.

### T-09 — Gegenmutationen (je ~20 min) · Nachweisgüte

| Nr.    | Mutation                                                      | Erwartet rot                                                                    |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GM-F1a | Insert-Spalten-Grant zurücknehmen (`grant insert on table …`) | pgTAP `has_column_privilege`-Fall; der `42501`-Fall fällt auf die Policy zurück |
| GM-F1b | `published_at is null` aus der Insert-Policy                  | mit GM-F1a zusammen: `auth-journey` 9c3                                         |
| GM-F2  | `auth.uid() is null or` entfernen                             | pgTAP: Einfügen ohne Claims                                                     |
| GM-F3  | `delete`-Grant zurückgeben                                    | pgTAP `has_table_privilege`-Fall                                                |

GM-F1a und GM-F1b müssen **gemeinsam** gefahren werden, um den Angriff wieder
zu öffnen — genau wie bei der Kanalgrenze. Einzeln gefahren zeigen sie, welcher
Riegel welchen Teil trägt; das wird getrennt protokolliert.

### T-10 — PRIL, PR-Beschreibung, Bericht (25 min)

## Validierungsbefehle

```bash
pnpm format && pnpm lint && pnpm typecheck
bash scripts/plumbline-scope-guard.sh
grep -c "alter role easytree_app password" .github/workflows/ci.yml   # muss 1 sein
grep -c "is_runtime_channel" CLAUDE.md                                # muss >= 1 sein
gh pr checks 52 --watch
```

## Risiken

- **RISK-1 — Der Insert-Spalten-Grant bricht einen Schreibpfad, den ich
  übersehen habe.** Abmilderung: `git grep "insert into public.plan_versions"`
  vor T-05; Fehlerbild wäre `42501`, laut und sofort.
- **RISK-2 — F3 bricht einen bestehenden Löschpfad.** Gemessen (E-10) existiert
  keiner im Produktivcode; die Aufräumung der Tests läuft über die
  Adminverbindung. Der einzige betroffene Nachweis ist der pgTAP-Löschfall, und
  der wird in T-02 bewusst aufgeteilt.
- **RISK-3 — F2 öffnet ein Existenzleck für claim-lose Sitzungen.** Zutreffend,
  und es ist die alte Semantik: eine Sitzung ohne Anwendungsidentität ist ein
  Wartungszugriff, der ohnehin Trigger abschalten könnte.
- **RISK-4 — F5 entfernt einen Schritt, den ein späterer Schritt doch braucht.**
  Gemessen (E-8) liegt kein Stack-Neustart dazwischen. Fehlerbild wären die
  Prozess-Smokes, die im selben Lauf rot würden.

## Rollback

`git revert` der Commits dieses Branches. 0016 ist nirgends angewandt (die
gehostete Datenbank steht auf 0013); alle Änderungen sind Rechte- und
Policy-Verschärfungen ohne Datenwirkung. Der Rollbackblock steht im Kopf von
0016 und lautet: `grant insert, delete on table public.plan_versions to
authenticated;` plus Wiederherstellung der Insert-Policy aus 0007 und der
Triggerfunktion aus dem Stand von 0015.

## Execution Handoff

Start bei T-01, Reihenfolge bindend, Halt bei T-04 bis der rote Lauf gelesen
ist. Kein Merge, kein Deploy, keine Remote-Migration.

## Stärkstes Gegenargument

> „F1 ist konstruiert. Wer eine Planversion mit `published_at` anlegt, erzeugt
> eine leere veröffentlichte Woche ohne Zuweisungen — nutzlos für einen
> Angreifer und sofort sichtbar. Das rechtfertigt keine weitere
> Rechteverschärfung mitten in einem offenen PR."

Der Nutzen für einen Angreifer ist tatsächlich gering; der Schaden für den
Betrieb ist es nicht. Die Zeile ist **unveränderlich und unlöschbar** (0010) —
niemand kann sie zurücknehmen, auch die Betreiberin nicht, ohne Trigger
abzuschalten. Sie besetzt `publishedVersionId` der Woche dauerhaft, der echte
Publish scheitert ab dann mit `already-published`, und EYT-109 bekäme eine
Kostenquelle ohne Zuweisungen. Das ist keine Spielerei, sondern eine
irreversible Sperre einer Planungswoche durch jedes Mitglied — auslösbar mit
einem einzigen HTTP-Aufruf.

## Failure-Mode-Kette

1. Spalten-Grant gesetzt, Policy-Zusatz vergessen → GM-F1a allein macht den
   pgTAP-Fall rot. **Gefangen.**
2. Beides gesetzt, aber der Command legt eine Spalte an, die nicht im Grant
   steht → Publish-Integrationstest scheitert mit `42501`. **Gefangen.**
3. F2 falsch herum implementiert (`auth.uid() is not null`) → der pgTAP-Fall
   ohne Claims bleibt rot. **Gefangen.**
4. F3 entfernt ein Recht, das ein Test braucht → `0006` wird rot beim ersten
   Lauf. **Gefangen.**
5. F5 entfernt den falschen Schritt → Prozess-Smokes rot. **Gefangen.**
6. Ein Schreibpfad außerhalb dieses Repositories (Studio, Skript) legt
   Planversionen mit `published_at` an → bricht. **Restrisiko, benannt**;
   Schemaänderungen über Studio sind laut CLAUDE.md ohnehin verboten.

## Truth- und Bias-Check

- Der Befund richtet sich gegen die eigene Arbeit von vor zwei Stunden und
  gegen die eigene Meldung `PASS_FOR_FINAL_REVIEW`. Das wird benannt, nicht
  umformuliert.
- Jede Rechteaussage ist an der laufenden Datenbank gemessen, nicht aus dem
  Migrationstext geschlossen — genau der Fehler, der zu F1 geführt hat.
- F2 ist ein Befund gegen die eigene Korrektur von F-Vortag: die Definer-Lösung
  war richtig, ihr Zusatzfilter war zu breit.
- Die Versuchung, F3 als „vorbestehend, nicht mein Thema" abzulegen, wird
  ausdrücklich zurückgewiesen; ebenso die Versuchung, `assignments` gleich
  mitzunehmen (NG-1) — das wäre die Gegenrichtung desselben Fehlers.
