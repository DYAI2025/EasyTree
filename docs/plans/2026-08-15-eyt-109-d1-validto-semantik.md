# EYT-109 D1 — `validTo` auf EINE fachliche Bedeutung bringen

> **Für Claude:** REQUIRED SUB-SKILL: superpowers:executing-plans, Aufgabe für Aufgabe.
> Vorher lesen: `docs/handoff/AGENT_HANDOFF_v1.3.md`, `CLAUDE.md`.

**Ziel:** `validTo` bedeutet an jeder Grenze oberhalb der **Persistenzgrenze**
genau eines — den **letzten wirksamen Tag** (EYT-95 `[validFrom, validTo]`). Die
Datenbank bleibt unverändert halboffen `[valid_from, valid_to)`. Die Übersetzung
lebt an genau **vier** Aufrufstellen in **einer** Datei, und diese Datei liegt in
der **Infrastrukturschicht**.

**Architektur:** Option A (Boundary Translation) mit zwei Nähten, die nicht
verwechselt werden dürfen:

1. **DB-Naht** — `infrastructure/rate-interval-boundary.ts`, benutzt
   ausschließlich von `infrastructure/rate-repository.pg.ts`. Beim Lesen
   `valid_to → dbEndeZuValidTo(...)`, beim Schreiben
   `validTo → validToZuDbEnde(...)`. `null` bleibt `null`. **DB-Begriffe
   erreichen die Domänenschicht nicht** — das ist keine Konvention, sondern vom
   bestehenden Wächter `domain-allowlist` erzwungen.
2. **Fachliche Satzauswahl** — `domain/rate-effectivity.ts::effectiveRateVersion`
   bleibt bestehen, wird aber innen zur **Brücke** auf den kanonischen Vertrag:
   Record → geprüfte `HourlyRateVersion` → `@easytree/domain::selectRateVersion`
   → bestehende Kostenmodul-Fehlercodes. Controller **und** Snapshot-Montage
   rufen genau diese eine Funktion.

Oberhalb der DB-Naht — Port, Domänenregeln, Controller, Vertrag, UI — gilt
ausschließlich die einschließende Lesart.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), NestJS + SWC,
Vitest, Zod → OpenAPI, PostgreSQL/Supabase, Playwright.

**Merge-Vorbehalt:** Dieser Plan verändert **keine** Migration und **keine**
Produktionsdaten. PR #69 bleibt Draft bis zum erneuten Task-20-Gate.

**Revisionsstand.** Dieses Dokument ist die vom PO angeforderte Überarbeitung
(Findings P1–P12) der Erstfassung vom 15.08.2026, **plus die Nachprüfung R2**
vom selben Tag. Was sich geändert hat, steht in Abschnitt 17 (P1–P12) und
Abschnitt 17.1 (R2); Erstfassung und P1–P12-Fassung sind damit ersetzt, nicht
ergänzt. R2 hat die P1–P12-Fassung nicht fortgeschrieben, sondern **gegen Jira
und den Exact-Head nachgemessen** — Befunde und bestätigte Anker in §17.1.

**Ablagestatus: `DERIVED_NONCANONICAL`.** Diese Datei ist unversioniert und
bleibt es. Sie wird in diesem Lauf **nicht** gestaget, **nicht** committet und
**nicht** gepusht, damit sie nicht versehentlich Teil von PR #69 wird.

---

## 0. AUSFÜHRUNGSVORBEHALT (State Safety)

Der Plan-Patch durfte im bestehenden, unsauberen Haupt-Working-Tree entstehen —
er berührt nur diese eine unversionierte Datei.

**Für die spätere Produktivumsetzung gilt das nicht.** Verbindlich ist ein
sauberer, isolierter Worktree bzw. Klon auf **exakt dem dann aktuellen
Remote-PR-Head**:

```bash
git fetch origin
git worktree add ../easytree-eyt109-d1 "$(gh pr view 69 --repo DYAI2025/EasyTree --json headRefOid -q .headRefOid)"
```

Fremde Dateien im Haupt-Tree werden **nicht** gestasht, zurückgesetzt, gelöscht
oder überschrieben — weder vor noch nach der Umsetzung.

---

## 1. STATE GATE

Gemessen am 15.08.2026 im Arbeitsverzeichnis `/Users/benjaminpoersch/EasyTree`:

| Prüfung | Erwartet | Gemessen | Ergebnis |
| --- | --- | --- | --- |
| `git rev-parse HEAD` | `4012371…5211` | `40123711eaabc90d9a37c4dd65b2c2d56abd5211` | PASS |
| `git rev-parse @{u}` | = HEAD | `40123711eaabc90d9a37c4dd65b2c2d56abd5211` | PASS |
| `git rev-parse origin/master` | `b44e38c…050b2` | `b44e38c6bf7e08a2996c2263309001a1304050f2` | PASS |
| `git rev-list --left-right --count origin/master...HEAD` | 0 / 81 | `0  81` | PASS |
| `gh pr view 69` | OPEN, Draft, ungemergt | `state=OPEN isDraft=true headRefOid=4012371…` | PASS |

**Dirty-Worktree-Befund und warum trotzdem kein isolierter Worktree nötig war.**
`git status --short` meldet eine geänderte Datei (`docs/canvas/sprint-5-daily-cost-export.canvas.md`)
und zehn unversionierte Pfade — **alle unter `docs/` bzw. `scripts/ops/`**.
Gemessen, nicht angenommen:

```
git status --porcelain | grep -vE '^\?\? ' | grep -vE ' docs/'   -> (leer)
git diff --name-only HEAD -- apps packages supabase             -> (leer)
git ls-files --others --exclude-standard -- apps packages supabase -> (leer)
```

Der gesamte Quellbaum (`apps`, `packages`, `supabase`) ist damit **byteidentisch
mit dem Exact-Head**. Es wurde nichts gestasht, zurückgesetzt oder gelöscht.
(Der PO hat die Verletzung derselben Regel in Kommentar 13500 als
Prozessabweichung festgehalten — hier ist die Abweichung nicht wiederholt,
sondern die Bedingung nachweislich erfüllt.)

---

## 2. SOURCE MAP

**Jira** — gelesen: EYT-109 (Beschreibung + alle 6 Kommentare, insbesondere
**13533** = PO Final-Gate 15.08.2026), EYT-108 (Beschreibung, Status `Fertig`).

**EYT-95 — jetzt direkt aus Jira gelesen (15.08.2026, `getJiraIssue`).**
Die Erstfassung dieses Plans führte das Ticket als „nicht separat gelesen" und
stützte sich nur auf das Repository. Das ist nachgeholt; die Lücke ist damit
geschlossen, und der Befund bestätigt den Repository-Kommentar **wörtlich**:

| | |
| --- | --- |
| Vorgang | EYT-95 „Kostenmodell, Rundung und historische Berechnungsstände absichern" (Task) |
| Status | `Fertig`, Resolution `Fertig`, zuletzt geändert 31.07.2026 |
| Tragender Kommentar | **11425** („Abschluss — deterministischer Plan-Kostenvertrag geliefert") |

Der maßgebliche Satz, wörtlich aus Kommentar 11425 (Akzeptanzkriterium
„Satzversion an Grenzzeitpunkten eindeutig"):

> `validTo` ist einschließend, intern kanonisch halboffen
> `[validFrom, dayAfter(validTo))`. Überlappungen werden über alle Paare
> erkannt, mit stabiler kanonischer Paarordnung.

Das ist **wortgleich** mit `packages/domain/src/rate-version.ts:159-169`
(`exclusiveEnd`) und mit dem Kopfkommentar V3. Ticket und Code stimmen überein;
es gibt keine abweichende Fassung. **Damit ist der Falsifikationspfad E5 aus
Abschnitt 13 für den heutigen Stand ausgeschlossen** — er bleibt nur für eine
*künftige* PO-Quelle offen.

> **Zweite, unabhängige Lesung (Revision R2, 15.08.2026).** Weil ein
> Agentenbericht ein Anspruch und kein Beleg ist, wurde EYT-95 in dieser
> Revisionssitzung **erneut** live gelesen (`getJiraIssue`, `fields=comment`)
> statt aus dem Plan zitiert. Bestätigt: Vorgangstyp `Task`, Status `Fertig`,
> Resolution `Fertig`, `updated = 2026-07-31T00:04:43+0200`, genau **zwei**
> Kommentare (11372 Sprint-Einordnung, **11425** Abschluss). Der oben zitierte
> Satz steht wörtlich in 11425 unter dem Akzeptanzkriterium „Satzversion an
> Grenzzeitpunkten eindeutig"; ebenso die Abgrenzung „Lokale Tagesallokation,
> Mitternacht und DST gehören zu EYT-109". Kein Zeichen Abweichung zwischen
> Zitat und Quelle. P1 ist damit **zweifach** `VERIFIED_LIVE`.

Derselbe Kommentar zieht außerdem die Zuständigkeitsgrenze, die diesen Plan
überhaupt in EYT-109 verortet:

> EYT-95 liefert den deterministischen Plan-Kostenvertrag.
> Lokale Tagesallokation, Mitternacht und DST gehören zu EYT-109.

**EYT-108** — Option A+ darf einen offenen Vorgänger genau einmal atomar
schließen; die **interne** DB-Grenze `predecessor.valid_to = successor.valid_from`
bleibt korrekt. Diese beiden Jira-Verträge sind Autorität; dieser Plan
interpretiert sie nicht neu, sondern erfüllt sie erstmals auch oberhalb der
Persistenzgrenze.

**Produktionsdatenbank** — gelesen über den Supabase-MCP (read-only),
`public.employee_rate_versions` und `supabase_migrations.schema_migrations`.
Evidenzklasse siehe §5.0.

**Evidenzklassifikation der Quellen dieses Plans:**

| Klasse | Quellen | Bedeutung |
| --- | --- | --- |
| `VERIFIED_LIVE` | Jira EYT-109/108/**95**, `gh pr view 69`, `git rev-parse`, alle im Abschnitt 3 zitierten Codestellen, Architekturregeln `apps/api/test/architecture/{rules,costs-rules}.ts` | in dieser Sitzung selbst gelesen |
| `AGENT_REPORTED_RUNTIME_EVIDENCE` | die Produktionszählungen in §5.1 und §5.5 | von einer früheren Agentensitzung berichtet, hier **nicht** reproduziert — siehe §5.0 |
| `ASSUMPTION` | Abwesenheit unregistrierter externer Konsumenten (§5.3) | begründet, aber nicht beweisbar |

**Code (Ist-Zustand, alles auf dem Exact-Head gelesen):**

| Datei | Rolle für D1 |
| --- | --- |
| `packages/domain/src/rate-version.ts` | EYT-95-Vertrag. `validTo` **einschließend**, intern `[validFrom, dayAfter(validTo))`. `selectRateVersion`, `findRateVersionOverlaps`. |
| `packages/domain/src/local-business-date.ts` | `compareLocalBusinessDate`, `dayAfter`, **`dayBefore`** — letzteres bereits für EYT-109 angelegt und im Kopfkommentar exakt als diese Naht beschrieben. |
| `apps/api/src/modules/costs/domain/rate-version.ts` | `RateVersionRecord` — heute ein **rohes DB-Abbild**, `validTo: string \| null` ohne Semantikaussage. |
| `apps/api/src/modules/costs/domain/rate-effectivity.ts` | `effectiveRateVersion` (halboffen, `businessDate < validTo`) und `rateVersionStatus` (halboffen, `validTo <= businessDate → abgelaufen`). |
| `apps/api/src/modules/costs/domain/rate-succession.ts` | `pruefeAbloesung` → `validToDesVorgaengers = nachfolger.validFrom` (**DB-exklusiv**). |
| `apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts` | Wählt halboffen aus, **konvertiert danach schon heute** mit `dayBefore` (Z. 155–165) und rechnet einschließend weiter. Enthält private `parseLocalDate`/`formatLocalDate` (Z. 237–259). |
| `apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts` | `toRecord` (Z. 97–110) und `append` (Z. 302–319, 286–291) — **roher Durchgriff in beide Richtungen**. |
| `apps/api/src/modules/costs/application/rate-repository.port.ts` | `NewRateVersion.validTo: string \| null` (Z. 50), ohne Semantikaussage. |
| `apps/api/src/modules/costs/interface/http/costs.controller.ts` | Z. 253–254 Kommando → Port (roh); Z. 206 `effectiveRateVersion` für `activeVersionId`; Z. 638–652 `toDto` (roh) + `rateVersionStatus`. |
| `packages/contracts/src/costs/schemas.ts` | Z. 79–80 / 101–102: `validTo: BusinessDateSchema.nullable()` — **ohne `.describe()`**. |
| `apps/web/components/rate-management.tsx` | Z. 177/193 Formular → Gateway (roh); Z. 317 Label „Gültig bis (optional)"; Z. 370/388 Spalte „Gültig bis" zeigt `version.validTo` roh. |
| `supabase/migrations/…0013_cost_permissions_and_rates.sql` | Z. 116–117 Spalten, Z. 125 `check (valid_to is null or valid_to > valid_from)`, Z. 137–141 `exclude … daterange(valid_from, valid_to, '[)')`. |
| `supabase/migrations/…0014_rate_succession.sql` | Z. 53 `grant update (valid_to)`, Z. 67/71–73 UPDATE-Policy `using (valid_to is null)` / `with check (valid_to is not null and valid_to > valid_from)`. |

**Repo-weite Suche** (`validTo`, `valid_to`, `effectiveRateVersion`,
`selectRateVersion`, `rateVersionStatus`, `dayBefore`, `dayAfter`) ist unter
Abschnitt 8 vollständig als Dateiliste ausgewertet.

---

## 3. CURRENT SEMANTICS TRACE

Alle Zellen sind **gelesen**, nicht abgeleitet.

| # | Grenze | Datei / Stelle | Semantik heute |
| --- | --- | --- | --- |
| 1 | Nutzereingabe | `rate-management.tsx:317` Label „Gültig bis (optional)" | **behauptet einschließend** |
| 2 | Web-Wert | `rate-management.tsx:177,193` | **roher Durchgriff** (keine Prüfung, keine Umrechnung) |
| 3 | Gateway-DTO | `packages/contracts/src/costs/schemas.ts:102` | **unknown** — nur `^\d{4}-\d{2}-\d{2}$`, nullable |
| 4 | HTTP / OpenAPI | `packages/contracts/openapi/v1.json`, `CreateRateVersionCommand.validTo` | **unknown** — `type:string`, `pattern`, `nullable:true`, **keine `description`** |
| 5 | Controller (Schreiben) | `costs.controller.ts:254` | **roher Durchgriff** |
| 6 | Port / Kommando | `rate-repository.port.ts:50` | **unknown** (kein Kommentar) |
| 7 | Repository (Schreiben) | `rate-repository.pg.ts:307,313` INSERT `$5::date` | **roher Durchgriff** → wird zu DB-exklusiv |
| 8 | DB `valid_to` | Migration 0013 Z. 137–141 | **exklusiv** `[valid_from, valid_to)` |
| 9 | DB-Lesen | `rate-repository.pg.ts:51,133` `to_char(valid_to,…)` | **exklusiv** |
| 10 | Repository-DTO | `rate-repository.pg.ts:104` `toRecord` | **roher Durchgriff** → `RateVersionRecord.validTo` ist **exklusiv** |
| 11 | HTTP-Antwort | `costs.controller.ts:645` `toDto` | **roher Durchgriff** → API liefert **exklusiv** |
| 12 | Web-Anzeige | `rate-management.tsx:388` unter „Gültig bis" | **roher Durchgriff**, als **einschließend** gelesen |
| 13 | Satzauswahl Snapshot | `cost-snapshot-assembly.ts:143` → `rate-effectivity.ts:44-45` | **exklusiv** (`businessDate < validTo`) |
| 14 | Umrechnung im Snapshot | `cost-snapshot-assembly.ts:155-165` `dayBefore(...)` | **Konversion exklusiv → einschließend** |
| 15 | Geldregel | `costOfDuration(HourlyRateVersion, …)` | **einschließend** (EYT-95) |
| 16 | Statusanzeige | `rate-effectivity.ts:58` `validTo <= businessDate` | **exklusiv** |
| 17 | Ablösung (A+) | `rate-succession.ts:88` `= nachfolger.validFrom` | **exklusiv** |

### Antworten auf die fünf Prüffragen

**A. Was bedeutet `validTo` im heutigen API-Vertrag tatsächlich?**
Faktisch **DB-exklusiv**, weil Zeilen 5, 7, 10 und 11 rohe Durchgriffe sind.
Der Vertrag **sagt es nirgends** — es ist eine Folge der Implementierung, keine
Zusicherung. Genau das ist der Grund, warum 11/11 grüne Pflichtjobs den Defekt
nicht finden konnten.

**B. Ist OpenAPI eindeutig?** Nein. `validTo` trägt in
`RateVersionDto` und in `CreateRateVersionCommand` ausschließlich
`{"nullable":true,"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"}`.
Kein `description`, kein `format`. Verifiziert durch Auslesen von
`packages/contracts/openapi/v1.json`.

**C. Welche Semantik erwarten die heutigen Tests?**
Sie **frieren den rohen Durchgriff ein**:

- `apps/api/test/costs/rate-batch-read.test.ts:309-310` — DB `valid_to = '2025-12-31'`, erwartet `validTo === "2025-12-31"`.
- `apps/api/test/costs/rate-succession.test.ts:51` — erwartet `validToDesVorgaengers === "2026-07-01"` (= `nachfolger.validFrom`).
- `apps/api/test/costs/cost-snapshot-assembly.test.ts:149` — „*waehlt am Nahtstellentag den Nachfolger — dieser Fall friert D1 ein*", mit dem Kommentar „Wer hier auf `selectRateVersion` umstellt, bekommt RATE_AMBIGUOUS".
- `apps/web/test/rate-management.test.tsx:63,71` — Anzeigefixtures mit `validTo: "2026-07-01"` / `"2027-01-01"`.

**D. Wird `valid_to` heute schon irgendwo übersetzt?** **Ja, an genau einer
Stelle**: `cost-snapshot-assembly.ts:164` ruft `dayBefore(...)`. `dayBefore`
selbst hat **keinen zweiten Aufrufer** im Produktivcode (verifiziert per
`grep -rn dayBefore` über `apps/*/src`, `apps/*/test`, `packages/*/src`,
`packages/*/test`).

**Daraus folgt die wichtigste Korrektur an der Problembeschreibung:** Die
**Geldberechnung ist heute schon richtig**. Sie wählt halboffen (passend zur DB)
und gießt die gewählte Zeile danach in eine einschließende, geprüfte
`HourlyRateVersion`. Nachgerechnet an genau dem Fall aus Kommentar 13533
(Vorgänger `[2026-06-01, 2026-07-01)`, Nachfolger `[2026-07-01, ∞)`):

- 30.06.: `validFrom ≤ 30.06.` ✓ und `30.06. < 01.07.` ✓ → Vorgänger. Nachfolger scheidet aus (`01.07. > 30.06.`).
- 01.07.: `01.07. < 01.07.` ✗ → Vorgänger fällt weg; Nachfolger deckt. → Nachfolger.

D1 ist damit **kein Rechenfehler, sondern ein Darstellungs- und
Vertragsfehler**: die Oberfläche zeigt „gültig bis 01.07." für eine Version, die
am 01.07. nicht mehr gilt. Das ändert die Migrationsentscheidung (Abschnitt 10)
und schrumpft den Reparaturschnitt erheblich.

**E. Wie funktioniert EYT-108 Option A+ beim Erzeugen eines Nachfolgers?**
`pruefeAbloesung` (rein) prüft in dieser Reihenfolge: `expectedActiveVersionId`
→ Vorgänger noch offen → gleicher Mitarbeiter → `nachfolger.validFrom >
vorgaenger.validFrom`; und liefert dann `validToDesVorgaengers =
nachfolger.validFrom`. Das Repository sperrt die Vorgängerzeile mit
`select … for update`, schreibt `update … set valid_to = $2 where id = $1 and
valid_to is null`, prüft `rowCount === 1` und fügt danach den Nachfolger ein —
alles in **einer** Transaktion, geschützt durch die Idempotenz-Sperre.

Für den geforderten Fall bedeutet das nach der Reparatur:

| Größe | heute | nach Option A |
| --- | --- | --- |
| Nachfolger `validFrom` (fachlich = DB) | `2026-07-01` | `2026-07-01` |
| Vorgänger DB `valid_to` | `2026-07-01` | **`2026-07-01` (unverändert)** |
| Vorgänger fachlich `validTo` (API/UI) | `2026-07-01` ❌ | **`2026-06-30`** ✓ |
| Wirksamer Satz am 30.06. / 01.07. | Vorg. / Nachf. | **Vorg. / Nachf. (identisch)** |

---

## 4. VERIFIED CONTRADICTION

Belegt, nicht referiert:

1. `packages/domain/src/rate-version.ts:14-20` — „Warum `validTo` einschließend
   ist … `bis 30.06. / ab 01.07.` ist lückenlos und zulässig, `bis 30.06. /
   ab 30.06.` ist eine Überlappung."
2. `supabase/migrations/…0013…sql:141` — `daterange(valid_from, valid_to, '[)')`.
3. `apps/api/src/modules/costs/domain/rate-effectivity.ts:45` —
   `businessDate < version.validTo`.
4. `apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts:9-17` — der
   Kopfkommentar erklärt ausdrücklich, warum `selectRateVersion` **nicht**
   benutzt wird.
5. `apps/web/components/rate-management.tsx:317,370,388` — Label „Gültig bis",
   Wert roh.
6. `packages/contracts/openapi/v1.json` — `validTo` ohne jede Beschreibung.

**Der Widerspruch ist real und liegt zwischen (1)+(5) einerseits und
(2)+(3)+(6) andererseits.** Er trifft die EYT-109-AK „Für jeden Anteil wird
genau die am Leistungsdatum wirksame Mitarbeiter-Stundensatzversion gewählt"
nicht in der *Auswahl* (die stimmt), sondern in ihrer **Nachvollziehbarkeit**:
Historie und Berechnung erzählen am Wechseltag zwei verschiedene Geschichten.

---

## 5. EXISTING DATA / CLIENT COMPATIBILITY

Dies ist das Tor, das über Option A entscheidet.

### 5.0 Evidenzklasse dieses Abschnitts — bitte zuerst lesen

Die Zahlen in §5.1 und §5.5 stammen aus einer **früheren Agentensitzung**, die
read-only gegen das Produktivprojekt gemessen hat. Sie tragen deshalb die Klasse

```
AGENT_REPORTED_RUNTIME_EVIDENCE
```

und **nicht** `VERIFIED_LIVE`. Für den PO sind sie derzeit nicht unabhängig
reproduzierbar; ein Agentenbericht ist ein Anspruch, kein Beleg. Sie reichen aus,
um Option A zu *planen* — sie reichen **nicht** aus, um Produktcode zu schreiben
oder zu mergen.

> ### ✅ RUNTIME-1 AUSGEFÜHRT — 15.08.2026, 23:40 CEST
>
> **Der Agentenbericht ist unabhängig bestätigt.** Die drei Abfragen aus
> Aufgabe 0 wurden gegen das Produktivprojekt ausgeführt — read-only, als
> Rolle `supabase_read_only_user` (`current_user = session_user =
> supabase_read_only_user`, Host `2a05:d01c:b72:2a00:…`, Datenbank `postgres`,
> 14 Tabellen in `public`). Nur `select`; kein `insert`, `update`, `delete`,
> `alter`, `create`. Die Rolle kann per Konstruktion nicht schreiben.
>
> | Bedingung | Erwartet | Gemessen | Ergebnis |
> | --- | --- | --- | --- |
> | `mit_endtag` | `0` | **`0`** (`gesamt=1`, `mit_vorgaenger=0`) | PASS — `BLOCKER_DATA_SEMANTICS` greift nicht |
> | produktive Snapshotzeilen | Tabelle fehlt oder `0` | **Tabelle fehlt** (`to_regclass('public.cost_snapshots') = null`, `cost_snapshot%`-Tabellen `= 0`) | PASS — `BLOCKER_IMMUTABLE_SNAPSHOTS` greift nicht |
> | Migration `20260809120000` (0018) | fehlt | **fehlt**; 17 Versionen angewandt, `20260723214800` … `20260807220000` | PASS — `BLOCKER_MIGRATION_STATE` greift nicht |
>
> **Die eine Zeile ist dieselbe wie im Bericht**, Feld für Feld und
> unverändert seit dem 01.08.2026 — das trennt „Zahl stimmt zufällig" von
> „Zustand ist unverändert":
>
> ```
> id             644bd74d-d61a-4897-a4a7-a04dcdda3843
> employee_id    00000000-0000-4000-8000-00000de70011
> amount         3850 EUR
> valid_from     2026-08-01
> valid_to       NULL
> predecessor_id NULL
> created_at     2026-08-01 16:53:27+00
> ```
>
> **Migrationslage vollständig abgeglichen, nicht nur auf 0018 geprüft.** Der
> Arbeitsbaum führt **18** Migrationsdateien (0001–0018); Produktion hat
> **exakt die ersten 17** angewandt, in derselben Reihenfolge, ohne eine
> einzige Version, die es im Repository nicht gibt. Es fehlt genau
> `20260809120000_0018_cost_snapshots.sql`. Damit ist „unerwartete
> 0018-Lage" nicht bloß für 0018 verneint, sondern für den ganzen Stand.
>
> **Folge für die Evidenzklassen:** Die Zahlen in §5.1 und §5.5 sind ab jetzt
> `VERIFIED_LIVE` (gemessen 15.08.2026, 23:40 CEST). Die Aussage in §10, dass
> **keine Datenmigration** nötig ist, steht damit nicht mehr auf einem
> Agentenbericht. **Aufgabe 1 darf beginnen.**
>
> **Was das nicht ist:** kein Freibrief bis zum Merge. Der Befund gilt für
> diesen Zeitpunkt. **RUNTIME-2 (Aufgabe 12) bleibt Pflicht** und ist
> unverändert ungelaufen — zwischen jetzt und dem Merge kann die Produktion
> eine Zeile mit `valid_to IS NOT NULL` erzeugen (Risiko R4).

Deshalb hängt der Plan an zwei verpflichtenden Wiederholungsmessungen:

| Gate | Zeitpunkt | Wirkung |
| --- | --- | --- |
| **RUNTIME-1** | unmittelbar **vor dem ersten Produktcode-Write** (vor Aufgabe 1) | ohne grünes RUNTIME-1 wird keine Zeile Produktcode geschrieben |
| **RUNTIME-2** | unmittelbar **vor dem finalen Merge-Readiness-Gate** | fängt eine Zeile, die zwischen Umsetzung und Merge entstanden ist |

Beide sind in Abschnitt 9 als Aufgaben ausformuliert (RUNTIME-1 = Aufgabe 0,
RUNTIME-2 = Aufgabe 12), beide sind **read-only**, und beide stoppen bei
denselben drei Befunden. Es werden **keine Produktionsdaten verändert.**

### 5.1 Gibt es persistierte reale Satzversionen?

`AGENT_REPORTED_RUNTIME_EVIDENCE`, berichtet zum 15.08.2026 gegen das
Produktivprojekt (Supabase MCP, read-only):

```sql
select count(*) as gesamt,
       count(*) filter (where valid_to is not null) as mit_endtag,
       count(*) filter (where predecessor_id is not null) as mit_vorgaenger
  from public.employee_rate_versions;
```

```
gesamt = 1   mit_endtag = 0   mit_vorgaenger = 0
```

Die eine Zeile im Detail:

```
id            644bd74d-d61a-4897-a4a7-a04dcdda3843
employee_id   00000000-0000-4000-8000-00000de70011
amount        3850 EUR
valid_from    2026-08-01
valid_to      NULL
predecessor   NULL
reason        "DEMO — Kundendemonstration und Abnahmetest"
created_at    2026-08-01 16:53:27+00
```

**Es existiert in Produktion keine einzige Zeile mit `valid_to IS NOT NULL`.**
Eine reine Grenzübersetzung bildet `null → null` in beide Richtungen ab, kann
diese Zeile also nicht um einen Tag verschieben. `BLOCKER_DATA_SEMANTICS` greift
**nicht**.

### 5.2 Ist die Eingabesemantik dieser Zeile rekonstruierbar?

Ja, und die Frage ist ohnehin gegenstandslos: bei `valid_to = NULL` gibt es
keine Semantik zu rekonstruieren. Beide Lesarten stimmen überein.

### 5.3 Gibt es Clients außerhalb des EasyTree-Webclients?

**Die Erstfassung sagte hier „Nein". Diese absolute Aussage ist nicht haltbar
und wird ersetzt** — eine Abwesenheit lässt sich über einen begrenzten
Suchbereich nicht beweisen, nur nicht widerlegen. Was tatsächlich gemessen ist:

1. **Im Repository wurde kein zweiter Kosten-API-Client gefunden.** Vollständige
   Liste aller Dateien, die `employee_rate_versions` nennen (`grep -rln`, ohne
   `node_modules`/`dist`):
   - Produktivcode: `apps/api/src/modules/costs/{index.ts, infrastructure/rate-repository.pg.ts, infrastructure/cost-snapshot-repository.pg.ts}`, `apps/api/src/modules/module-catalogue.ts`
   - Tests: Dateien unter `apps/api/test/costs/`
   - Fixtures: `apps/web/e2e/auth-journey/{fixtures.sql, teardown.sql}` — die Fixture-Zeile hat `valid_to = null`
   - Schema: Migrationen 0013/0014/0018, pgTAP 0005/0009/0010/0013

   Kein Skript, kein Import, kein Job, kein zweiter Dienst im Repository.
2. **Die kanonische Architektur kennt zwei Client-Erlebnisse, beide intern:**
   den Admin-/Disponenten-Client und den Mitarbeiter-Client. Beide leben in
   `apps/web`.
3. **Der Mitarbeiter-Client darf Kostendaten gar nicht konsumieren** — die
   Kostenrouten hängen an `COST_PERMISSIONS` (`cost-access.policy.ts`); ein
   Mitarbeitersubjekt ohne Kostenrecht bekommt 403, nicht etwa gefilterte Daten.
4. **In den geprüften Jira-/Confluence-Quellen wurde kein externer
   `/kosten/stundensaetze`-Konsument gefunden** (EYT-109, EYT-108, EYT-95,
   Sprint-5-Seite 8552449).
5. **Ein nicht dokumentierter externer Konsument ist nicht beweisbar
   ausgeschlossen.** Es gibt keine Quelle, die eine solche Abwesenheit belegen
   könnte — Betriebsprozesse, Partnerintegrationen oder ad-hoc-Skripte außerhalb
   dieser vier Quellen wären hier unsichtbar.

Daraus folgt die ausdrücklich benannte Annahme, unter der dieser Plan steht:

```
ASSUMPTION_NO_UNREGISTERED_EXTERNAL_CONSUMERS
```

**Wenn zu irgendeinem Zeitpunkt Evidenz für einen externen Konsumenten
auftaucht — vor, während oder nach der Umsetzung — gilt:**

```
STOP API_COMPATIBILITY_REVIEW
```

Dann ist nicht mehr die Frage „Option A oder B", sondern „stille
Bedeutungsänderung oder API-Versionierung", und die entscheidet der PO, nicht
dieser Plan. Der Forward-Fix aus Abschnitt 11 ist genau für diesen Fall
dimensioniert.

### 5.4 Behandelt irgendetwas rohe DB-exklusive Werte als API-Werte?

Ja — genau die vier unter 3C genannten **Tests**, und sonst nichts im
Produktivcode. Diese Tests sind die RED-Kandidaten in Abschnitt 9, kein Blocker.

### 5.5 Würde die Übersetzung Bestandswerte korrekt interpretieren?

Ja — **unter der Evidenzklasse aus §5.0.** Prod: nur `null`. CI/lokal: Fixtures
werden pro Lauf neu erzeugt. Die Snapshot-Tabellen aus Migration `0018` sind in
Produktion nach demselben Agentenbericht **nicht vorhanden** —
`supabase_migrations.schema_migrations` listete 17 Versionen
(`20260723214800` … `20260807220000`), `20260809120000` fehlte. Trifft das zu,
kann es keinen produktiven unveränderlichen Snapshot geben, der eine
Fehlinterpretation konservieren würde.

> **Rest-Risiko und wie es geschlossen wird.** Der Bericht ist eine Momentaufnahme
> einer fremden Sitzung, und zwischen ihr und dem Merge kann die laufende
> Produktion eine Version mit `valid_to IS NOT NULL` oder eine angewandte
> Migration 0018 erzeugt haben. Deshalb **zwei** Wiederholungen statt einer:
> **RUNTIME-1** (Aufgabe 0) vor dem ersten Produktcode-Write und **RUNTIME-2**
> (Aufgabe 12) vor dem Merge-Gate. Beide read-only, beide mit denselben drei
> STOP-Bedingungen.

---

## 6. OPTIONS

### Option A — Boundary Translation (DB bleibt halboffen)

| Aspekt | Bewertung |
| --- | --- |
| Betroffene Dateien | 2 neu + 7 geändert unter `apps/api/src/modules/costs/`, plus `packages/contracts/src/costs/schemas.ts` + regeneriertes `openapi/v1.json`. Exakte Listen in Abschnitt 8. **`apps/web` braucht keine Produktivcodeänderung.** |
| Contract Impact | Bedeutung von `validTo` ändert sich (heute undokumentiert → künftig zugesichert einschließend); Typ und Muster bleiben. Kein Feld kommt oder geht. |
| Data Impact | Keiner. Gespeicherte Werte bleiben Byte für Byte gleich. |
| Migration nötig | **Nein** (Begründung Abschnitt 10). |
| EYT-108 A+ Impact | `pruefeAbloesung` liefert künftig den fachlichen Endtag; das Repository schreibt daraus denselben DB-Wert wie heute. Sperre, Idempotenz, `rowCount`-Prüfung und Fehlerabbildung unverändert. |
| Snapshot Impact | Beträge, `rateVersionId`, Summen bleiben identisch — nachgewiesen durch T7/T11. Die heutige `dayBefore`-Konversion im Assembly **entfällt** (sonst doppelte Umrechnung). |
| Rückwärtskompatibilität | Für den einzigen Client vollständig; er wird korrekt, ohne sich zu ändern. |
| Rollback | Ein `git revert` des Merge-Commits. Keine DB-Aktion. |
| Risiko | Mittel-niedrig. Hauptrisiko ist eine **doppelte** Umrechnung (Assembly + Repository) — T7 fängt das. |
| Testaufwand | 12 Testschichten, davon 4 bestehende Dateien angepasst. |

### Option B — Datenbank auf einschließende Semantik umstellen

| Aspekt | Bewertung |
| --- | --- |
| Betroffene Dateien | Neue Migration `0019`, Migration-0013/0014-Nachfolger, pgTAP 0009/0010/0013, alle Integrationstests mit `valid_to`, plus derselbe TS-Code wie A. |
| Contract Impact | Gleich wie A. |
| Data Impact | **Datenmigration nötig**: jedes nicht-`null` `valid_to` müsste um einen Tag zurück. |
| Migration nötig | **Ja, zwei**: Schema (`check (valid_to >= valid_from)`, `daterange(..., '[]')`) **und** Daten. |
| EYT-108 A+ Impact | `valid_to = nachfolger.validFrom` würde zur **Überlappung** — die Ablösungslogik und der EXCLUDE-Constraint müssten gleichzeitig umgebaut werden. |
| Snapshot Impact | `effectiveRateVersion` und alle DB-Abfragen müssten kippen; jeder Fehler dabei verschiebt Beträge. |
| Rückwärtskompatibilität | Bricht die abgenommene Migration 0013/0014-Semantik. Migrationen sind append-only; ein Rückbau braucht eine Vorwärtsmigration mit Restore-Nachweis. |
| Rollback | Teuer — Datenmigration rückwärts, mit Freigabe und Restore-Evidenz (CLAUDE.md, „No destructive migrations…"). |
| Risiko | **Hoch.** Berührt EXCLUDE-Constraint, UPDATE-Policy `with check (valid_to > valid_from)`, Spaltenrechte und drei pgTAP-Suiten gleichzeitig. |
| Testaufwand | Deutlich höher als A, mit einem `db-gates`-Lauf je Iteration. |

### Option C — Fachliche/API-Semantik auf exklusiv umstellen

| Aspekt | Bewertung |
| --- | --- |
| Betroffene Dateien | `packages/domain/src/rate-version.ts` (EYT-95-Kern), dessen Tests inkl. Property-Tests, `domain-invariants/registry.ts`, `cost-position.ts`, UI-Labels, Vertrag. |
| Contract Impact | Ändert einen **abgenommenen** Vertrag (EYT-95 V3), der ausdrücklich sagt: „Eine exklusiv gerechnete Implementierung verliert bei jedem Satzwechsel genau einen Arbeitstag." |
| Data Impact | Keiner. |
| Migration nötig | Nein. |
| EYT-108 A+ Impact | Gering. |
| Snapshot Impact | `dayBefore` würde ersatzlos entfallen; `HourlyRateVersion` bekäme eine zweite Bedeutung. |
| Rückwärtskompatibilität | UI müsste „Gültig bis" in „Gültig vor" o. Ä. umbenennen — eine fachlich schlechtere Oberfläche („bis 01.07." meint dann 30.06.). |
| Rollback | Mittel. |
| Risiko | Hoch an der falschen Stelle: verschiebt die Verwirrung zum Endnutzer statt sie aufzulösen. |
| Testaufwand | Am höchsten — `packages/domain` ist die am dichtesten abgesicherte Schicht. |
| PO-Deckung | **Keine.** Kommentar 13533: „Es liegt keine spätere explizite PO-Entscheidung vor, die die inklusive EYT-95-Semantik durch eine exklusive fachliche Oberfläche ersetzt." |

---

## 7. RECOMMENDATION

**OPTION A.** Sie ist von der Evidenz getragen, nicht nur von der PO-Präferenz:

1. **Keine berichteten Bestandsdaten stehen im Weg** — 0 Zeilen mit
   `valid_to IS NOT NULL` in Produktion (§5.1), Snapshot-Tabellen dort noch
   nicht angelegt (§5.5). **Evidenzklasse `AGENT_REPORTED_RUNTIME_EVIDENCE`,
   nicht `VERIFIED_LIVE`** (§5.0) — die Empfehlung steht deshalb unter
   RUNTIME-1 (Aufgabe 0) und RUNTIME-2 (Aufgabe 12).
2. **Im geprüften Suchbereich wurde kein externer Client gefunden**, der
   `validTo` konsumiert oder schreibt (§5.3). Das ist eine begründete
   Nichtauffindbarkeit, **keine bewiesene Abwesenheit**: es gilt
   `ASSUMPTION_NO_UNREGISTERED_EXTERNAL_CONSUMERS`, und jede gegenteilige
   Evidenz löst `STOP API_COMPATIBILITY_REVIEW` aus.
3. **Der bestehende Vertrag sagt nichts** über die Semantik (§3B), es wird also
   keine Zusicherung gebrochen, sondern erstmals eine gegeben.
4. **Die Beträge ändern sich nicht** (§3D) — die Reparatur ist beweisbar
   verhaltensneutral für Geld und nur wahrheitsstiftend für die Anzeige.
5. Der teuerste Teil von Option A — `dayBefore` samt Rand- und Schaltjahrfällen —
   **existiert bereits**, ist getestet und mit benannten Gegenmutationen belegt
   (`packages/domain/test/money-rate.test.ts:1082-1137`).

**Bewusst nicht getan (YAGNI).** Es werden **keine** getrennten Typen für
„rohe DB-Zeile" und „fachliche Satzversion" eingeführt. Das wäre der
lehrbuchmäßige Vorschlag, aber es verteilte eine Vierzeilenregel über zwanzig
Dateien. Stattdessen: **eine** Datei mit **einem** Funktionenpaar, **vier**
Aufrufstellen, alle im selben Adapter — und ein statischer Wächter (Aufgabe 10),
der eine fünfte Aufrufstelle woanders rot macht.

### 7.1 Wo die Umrechnung liegt — und warum nicht in `domain/`

Die Erstfassung legte die Datei nach
`apps/api/src/modules/costs/domain/rate-interval-boundary.ts`. **Das ist
zurückgenommen.** Eine Funktion, deren Existenzgrund `daterange(..., '[)')` aus
Migration 0013 ist, ist eine Aussage über die *Persistenz*, nicht über die
Fachlichkeit. In `domain/` wäre sie ein DB-Begriff in der innersten Schicht.

Zwei Kandidaten wurden am tatsächlichen Repository geprüft:

| Ort | Bewertung |
| --- | --- |
| **private Funktionen in `rate-repository.pg.ts`** | Am kleinsten, aber **nicht als Einheit prüfbar**. Die teuren Fälle sind Monats-, Jahres- und Schaltjahresränder (`2028-03-01 → 2028-02-29`). Privat wären sie nur über einen DB-Rundlauf erreichbar — also nur im CI-Job `db-gates`, nicht in `unit-tests`. Eine Off-by-one am 29.02. verdient einen Unit-Test, keinen Integrationslauf. **Verworfen.** |
| **`infrastructure/rate-interval-boundary.ts`** (gewählt) | Liegt an der Persistenzgrenze, wird von genau einer Produktivdatei benutzt, ist als reine Funktion unit-testbar. **Gewählt.** |

**Gemessene Konsequenz, die diese Wahl trägt:** `domain-allowlist`
(`apps/api/test/architecture/rules.ts:113-136`) erlaubt Domänencode
ausschließlich `@easytree/domain` und relative Pfade **innerhalb der eigenen
`domain/`-Schicht**. Ein Import von `domain/cost-snapshot-assembly.ts` nach
`infrastructure/rate-interval-boundary.ts` ist damit nicht bloß unerwünscht,
sondern **fällt am bestehenden Architekturtest rot**. Das Leck-Verbot aus P2 ist
also bereits erzwungen und muss nicht neu erfunden werden — der neue Wächter aus
Aufgabe 10 deckt nur die Schichten ab, die `domain-allowlist` nicht erreicht
(`application/` und `interface/`).

Gegenrichtung ist erlaubt und gewollt: `layer-direction`
(`rules.ts:152-176`, `LAYER_RANK = {domain: 0, application: 1, infrastructure: 2,
interface: 3}`) lässt `infrastructure → domain` zu.

**Ein Nebenbefund erzwingt eine zweite neue Datei.** Die Umrechnung braucht
`JJJJ-MM-TT ↔ LocalBusinessDate`. Diese Helfer sind **keine** DB-Begriffe, und
sie werden nach der Reparatur an vier Stellen gebraucht: der Brücke
(`rate-effectivity.ts`), der Ablösungsregel (`rate-succession.ts`), der Montage
(`cost-snapshot-assembly.ts`, hat heute eine private Kopie) und der Umrechnung
selbst. Vier Aufrufer, davon drei in `domain/` — sie müssen also **in `domain/`**
liegen, sonst wäre `domain-allowlist` verletzt. Deshalb:
`domain/local-business-date-format.ts`. Eine dritte private Kopie wäre die
Doppelung, die dieser Plan gerade beseitigt.

### 7.2 Warum `effectiveRateVersion` bleibt

Die Erstfassung wollte `effectiveRateVersion` **löschen** und Controller,
Barrel-Export und Montage auf `selectRateVersion` umverdrahten. Das ist
zurückgenommen: es erzeugt genau die doppelte Umwandlungslogik, die P4 verbietet.
`selectRateVersion` nimmt `HourlyRateVersion[]`, die Aufrufer halten aber
`RateVersionRecord[]` — jeder Aufrufer bräuchte seine eigene Konvertierung.

Gemessen sind es **drei** Aufrufstellen, die dieselbe Auswahl brauchen:

| Aufrufer | braucht | heute |
| --- | --- | --- |
| `cost-snapshot-assembly.ts:143` | gewählte Version **und** geprüfte `HourlyRateVersion` für `costOfDuration` | konvertiert selbst, inkl. `dayBefore` |
| `costs.controller.ts:206` | nur `version.id` für `activeVersionId` | `effectiveRateVersion` |
| `snapshot-immutability.integration.test.ts:289` | gewählte Version | `effectiveRateVersion` |

`effectiveRateVersion` bleibt deshalb als **fachliche Brücke** bestehen — gleicher
Name, gleiche Aufrufstellen, gleiche Fehlercodes, innen aber der kanonische
Vertrag. Sie liefert künftig **beides** in einem Ergebnis (`version` = Record für
Id und DTO, `checked` = geprüfte `HourlyRateVersion` für die Geldregel), damit
niemand ein zweites Mal konvertieren muss. Das ist der kleinste Schnitt: zwei
der drei Aufrufstellen ändern sich **gar nicht**.

---

## 8. EXACT AFFECTED FILES

Drei Listen, disjunkt und vollständig. **Jede Datei kommt genau einmal vor.**
Jede Datei in A und B nennt die Verhaltensänderung, die sie nötig macht; steht
dort nur „Kommentar", ist sie in Liste B als solche markiert. Es gibt **keine**
„bei Bedarf"-Writes: was hier nicht steht, wird nicht geschrieben.

### A. NEW FILES (5)

| # | Datei | Notwendige Verhaltensänderung |
| --- | --- | --- |
| A1 | `apps/api/src/modules/costs/infrastructure/rate-interval-boundary.ts` | **Neue Funktionen** `dbEndeZuValidTo` / `validToZuDbEnde`. Ohne sie gibt es die Übersetzung nicht. |
| A2 | `apps/api/src/modules/costs/domain/local-business-date-format.ts` | **Neuer Ort** für `parseLocalDate`/`formatLocalDate`. Ohne ihn bräuchten drei `domain/`-Dateien und A1 je eine eigene Kopie — und A1 dürfte aus `domain/` gar nicht importiert werden. |
| A3 | `apps/api/test/costs/rate-interval-boundary.test.ts` | Unit-Nachweis der Umrechnung inkl. Monats-, Jahres- und Schaltjahresrand. |
| A4 | `apps/api/test/costs/rate-effectivity.test.ts` | **Es gibt heute keinen Unit-Test für `effectiveRateVersion`/`rateVersionStatus`** (gemessen: beide Namen kommen in `apps/api/test/` nur in `snapshot-immutability.integration.test.ts` vor). Die Brücke bekommt ihren eigenen. |
| A5 | `apps/api/test/costs/rate-boundary-single-site.test.ts` | Statischer Wächter (Aufgabe 10): die Übersetzung hat genau eine Aufrufstelle. Ohne ihn ist „genau eine Naht" ein Kommentar, keine Zusicherung. |

> A4 ist ein Befund, kein Komfort: die Funktion, deren Semantik dieser Plan
> umbaut, hat bisher keinen eigenen Test. Sie über einen Integrationstest zu
> ändern, der nur in `db-gates` läuft, wäre der teuerste Weg zum Nachweis.

### B. MODIFY FILES (17)

**Produktivcode API (6):**

| # | Datei | Notwendige Verhaltensänderung |
| --- | --- | --- |
| B1 | `apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts` | Die **vier** Umrechnungsstellen: `toRecord` (lesen), INSERT-Parameter (schreiben), synthetischer Vorgänger für `pruefeAbloesung` (lesen), UPDATE `set valid_to` (schreiben). |
| B2 | `apps/api/src/modules/costs/domain/rate-effectivity.ts` | `effectiveRateVersion` wird zur Brücke auf `selectRateVersion` und liefert zusätzlich die geprüfte `HourlyRateVersion`; `rateVersionStatus` wird einschließend (`<=` → `<`); `RATE_EFFECTIVITY_PROBLEMS` bekommt `RATE_INVALID`. |
| B3 | `apps/api/src/modules/costs/domain/rate-succession.ts` | `validToDesVorgaengers` liefert den **fachlichen** Endtag (`dayBefore(nachfolger.validFrom)`) statt der DB-Grenze. |
| B4 | `apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts` | Eigene `dayBefore`-Konversion und eigene Factory-Aufrufe **entfallen** (sonst doppelte Umrechnung); private `parseLocalDate`/`formatLocalDate` werden gelöscht und aus A2 importiert. |
| B5 | `apps/api/src/modules/costs/index.ts` | Barrel-Export von A1 (Testzugriff — jeder Kostentest importiert über die `index.ts`, tiefe Pfade fallen am Wächter `costs-cross-module-public-api-only`) und der neue Ergebnistyp aus B2. |
| B6 | `apps/api/src/modules/costs/application/rate-repository.port.ts` | **Nur Kommentar**: `NewRateVersion.validTo` bekommt die Semantikaussage. Kein Verhalten. |

> `apps/api/src/modules/costs/domain/rate-version.ts` (Semantikkommentar auf
> `RateVersionRecord.validTo`) wird **im selben Commit wie B2** mitgeführt und
> ist ebenfalls reine Dokumentation. Es steht hier als **B7**, damit die Liste
> vollständig bleibt.

| # | Datei | Notwendige Verhaltensänderung |
| --- | --- | --- |
| B7 | `apps/api/src/modules/costs/domain/rate-version.ts` | **Nur Kommentar**: `validTo` ist der letzte wirksame Tag. Kein Verhalten. |

**Vertrag (2):**

| # | Datei | Notwendige Verhaltensänderung |
| --- | --- | --- |
| B8 | `packages/contracts/src/costs/schemas.ts` | `.describe(...)` auf beiden `validTo` (Z. 80 und 102). Ändert das generierte Dokument. |
| B9 | `packages/contracts/openapi/v1.json` | **Regeneriert** via `openapi:write`, nie von Hand. Sonst ist `openapi-drift.test.ts` rot. |

**Tests (7):**

| # | Datei | Notwendige Verhaltensänderung |
| --- | --- | --- |
| B10 | `apps/api/test/costs/rate-batch-read.test.ts` | Friert heute den rohen Durchgriff ein (`validTo === "2025-12-31"`). Erwartung wird fachlich. |
| B11 | `apps/api/test/costs/rate-succession.test.ts` | Friert `validToDesVorgaengers === "2026-07-01"` ein. Erwartung wird fachlich, plus Lückenlosigkeitsfall. |
| B12 | `apps/api/test/costs/rate-succession.integration.test.ts` | Neuer Fall: fachlicher Endtag rein, **rohe** DB-Grenze über eine Admin-Verbindung zurückgelesen. Der bestehende Fall (`valid_to = "2030-07-01"`) bleibt **unverändert grün** — das ist der Regressionsnachweis. |
| B13 | `apps/api/test/costs/cost-snapshot-assembly.test.ts` | Enthält den D1-Einfriertest, der den Defekt konserviert. Fixtures werden fachlich; Beträge und `rateVersionId` bleiben identisch. |
| B14 | `apps/api/test/costs/rate-http-contract.integration.test.ts` | Neuer Vertragsfall über den realen HTTP-Pfad: `validTo` rein = `validTo` raus, `status` am letzten Gültigkeitstag `aktiv`. |
| B15 | `apps/api/test/costs/snapshot-immutability.integration.test.ts` | Ruft `effectiveRateVersion` direkt; das Ergebnisobjekt hat ein Feld mehr. Beträge und IDs müssen **unverändert** bleiben. |
| B16 | `apps/web/test/rate-management.test.tsx` | Anzeigefixtures tragen heute DB-Werte (`"2026-07-01"`). Werden fachlich, plus Nahtstellen-Erzählung. |

**E2E (1):**

| # | Datei | Notwendige Verhaltensänderung |
| --- | --- | --- |
| B17 | `apps/web/e2e/auth-journey/journey.pwtest.ts` | Zusicherung an der bestehenden Task-17-Stelle: der Vorgänger zeigt unter `[data-testid="gueltig-bis"]` den Tag **vor** dem `validFrom` des Nachfolgers. **Keine `data-testid` wird umbenannt oder entfernt.** |

### C. READ / RUN ONLY — NICHT ÄNDERN

| Datei / Pfad | Rolle | Warum unverändert |
| --- | --- | --- |
| `apps/web/components/rate-management.tsx` | UI-Komponente | Wird durch die Reparatur der Repository-/API-Grenze *richtig*, ohne eine Zeile Produktcode. Siehe P10-Klausel unten. |
| `apps/api/src/modules/costs/interface/http/costs.controller.ts` | Controller | `effectiveRateVersion` behält Name und Aufrufform; `toDto` bleibt roher Durchgriff und ist danach korrekt, weil der Port fachlich spricht. **Wird gelesen, um das zu bestätigen — nicht geschrieben.** |
| `packages/domain/**` | EYT-95-Vertrag | Referenz, nicht Ziel. `selectRateVersion`, `hourlyRateVersion`, `dayBefore`/`dayAfter` werden benutzt, nicht geändert. |
| `supabase/migrations/**`, `supabase/tests/**` | Schema | Die DB-Semantik bleibt exakt. Kein DDL, keine neue Migration. |
| `apps/web/e2e/auth-journey/{fixtures.sql, teardown.sql}` | E2E-Fixtures | Die Fixture-Zeile hat `valid_to = null`; `null → null` ist in beide Richtungen identisch. |
| `apps/api/test/costs/create-cost-snapshot.use-case.test.ts` | Use-Case-Test | Prüft Idempotenz und Blockade, nicht Intervallsemantik. Wird **ausgeführt** als Regressionsnachweis, nicht geändert. |
| `apps/api/test/costs/snapshot-http.integration.test.ts` | HTTP-Snapshot-Test | Dito — **ausführen**, nicht ändern. Beträge müssen identisch bleiben. |
| `packages/contracts/test/openapi-drift.test.ts` | Drift-Wächter | Wird **ausgeführt** (rot vor, grün nach der Regenerierung). Nie angepasst. |
| `apps/api/test/architecture.test.ts`, `apps/api/test/architecture/{rules,costs-rules}.ts` | Architekturwächter | Erzwingen bereits, dass `domain/` nicht nach `infrastructure/` greift. **Ausführen**, nicht erweitern. |
| `docs/traceability/REQUIREMENT_TO_JIRA_v1.3.csv` | Traceability | PO-Entscheidung 13498. |

**Zählprobe:** **5 neue** (A1–A5: 2 Produktivcode, 3 Test) + **17 geänderte**
(B1–B17: 7 Produktivcode API, 2 Vertrag, 7 Test, 1 E2E) + 10 Einträge in C.
Keine Datei erscheint in zwei Listen; jede in Abschnitt 9 genannte Datei kommt
hier genau einmal vor.

### 8.1 UI-Klausel (P10) — verbindlich

`apps/web/components/rate-management.tsx` steht in Liste C und bleibt dort.
Die Begründung ist nachprüfbar, nicht bloß behauptet: die Komponente reicht
`version.validTo` roh durch (Z. 388) und beschriftet die Spalte „Gültig bis".
Genau das ist **richtig**, sobald die API den letzten wirksamen Tag liefert. Der
Fehler lag nie in der Anzeige, sondern im gelieferten Wert.

**Tests dürfen angepasst und ergänzt werden** (B16, B17) — Produktivcode nicht.

Sollte sich während der Umsetzung zeigen, dass dort doch eine Produktivänderung
nötig ist, gilt:

```
STOP — im Plan begründen, PO-Entscheidung einholen.
```

Kein stilles Ausweiten des Schnitts. Eine nötige UI-Änderung wäre ein Signal,
dass die Repository-/API-Grenze **nicht** vollständig repariert ist — die
richtige Reaktion ist dann, dort nachzusehen, nicht die Komponente zu flicken.

---

## 9. RED-FIRST TEST PLAN

Reihenfolge ist Absicht: erst der rote Test, dann die kleinste Änderung, die ihn
grün macht.

### 9.0 Commitstrategie (P9) — vor den Aufgaben lesen

**Die Erstfassung committete nach fast jeder Mikroaufgabe. Das ist
zurückgenommen, und zwar aus einem inhaltlichen Grund, nicht aus Stilgeschmack.**

Zwischen Aufgabe 2 (Repository liest einschließend) und Aufgabe 5 (Montage
rechnet einschließend) liegt ein Zustand, in dem das Repository bereits
`2026-06-30` liefert, während `cost-snapshot-assembly.ts` noch sein eigenes
`dayBefore` anwendet und daraus `2026-06-29` macht. **Das ist die doppelte
Umrechnung aus Risiko R1 — als Commit festgehalten.** Ein solcher Commit ist
nicht bloß unschön: er ist ein Stand, in dem `git bisect`, ein Cherry-Pick oder
ein Teil-Revert stille Geldfehler produziert.

Die Regel lautet deshalb:

1. **RED/GREEN darf lokal beliebig klein erfolgen** — Test schreiben, rot laufen
   lassen, minimal implementieren, grün laufen lassen. Das ist die Arbeitsweise,
   nicht die Commit-Granularität.
2. **Committet wird nur ein semantisch konsistenter Repositoryzustand.** Kein
   Commit darf gleichzeitig einschließende Werte liefern und exklusive erwarten
   — oder umgekehrt.
3. **Bevorzugt 1–3 kohärente Commits.** Der Schnitt unten ist der vorgeschlagene.
4. **Kein Push vor vollständig grünem D1-Slice** (Aufgabe 11).

**Vorgeschlagener Commit-Schnitt:**

| Commit | Umfang | Warum er für sich konsistent ist |
| --- | --- | --- |
| **C1** — `fix(costs): EYT-109 D1 — validTo bedeutet oberhalb der Persistenzgrenze den letzten wirksamen Tag` | A1, A2, A3, A4, A5, B1–B7, B10–B16 (Aufgaben 1–6, 9, 10) | Der **einzige** Schnitt, der die Semantik als Ganzes umlegt. Alles davor oder dazwischen mischt zwei Lesarten. Nach C1 gilt in Repository, Domäne, Brücke, Montage, Controller und Tests dieselbe Bedeutung. |
| **C2** — `docs(contracts): EYT-109 D1 — validTo als einschliessenden letzten Gueltigkeitstag zusichern` | B8, B9 (Aufgabe 8) | Reine Vertragsdokumentation über bereits korrektem Verhalten. Für sich konsistent, weil C1 die zugesicherte Bedeutung schon herstellt. Getrennt, damit der `v1.json`-Diff einzeln lesbar ist. |
| **C3** — `test(web): EYT-109 D1 — die Browserreise belegt den lueckenlosen Satzwechsel` | B17 (Aufgabe 7 Schritt 2) | Nur eine zusätzliche Zusicherung in der E2E-Reise, kein Produktcode. Optional an C1 anhängbar. |

> C1 ist bewusst groß. Ein „großer" Commit ist hier das **konservative**
> Vorgehen: die Alternative sind sechs kleine, von denen fünf einen
> Zwischenzustand mit gemischter Semantik festschreiben.

---

### Aufgabe 0 (RUNTIME-1): Bestandsdaten-Gate VOR dem ersten Produktcode-Write

**Diese Aufgabe schreibt nichts. Sie ist die Bedingung dafür, dass Aufgabe 1
überhaupt beginnen darf.** Die Zahlen aus §5.1/§5.5 sind
`AGENT_REPORTED_RUNTIME_EVIDENCE` und werden hier **neu gemessen, nicht
zitiert** — read-only, über den Supabase-MCP gegen das Produktivprojekt:

```sql
select count(*)                                          as gesamt,
       count(*) filter (where valid_to is not null)      as mit_endtag,
       count(*) filter (where predecessor_id is not null) as mit_vorgaenger
  from public.employee_rate_versions;
```

```sql
select count(*) as snapshotzeilen from public.cost_snapshots;
```

```sql
select version from supabase_migrations.schema_migrations order by version;
```

**Erwartet** (= Weiterarbeit erlaubt): `mit_endtag = 0`; die Snapshotabfrage
schlägt mit „relation does not exist" fehl **oder** liefert `0`; `20260809120000`
fehlt in der Migrationsliste.

**STOP — kein Produktcode, PO-Entscheidung einholen — bei jedem dieser Befunde:**

| Befund | Code |
| --- | --- |
| `mit_endtag > 0` | `BLOCKER_DATA_SEMANTICS` — diese Zeilen wären unter der neuen Lesart einen Tag früher zu Ende, und die Absicht ihres Erzeugers ist aus den Daten nicht rekonstruierbar. |
| produktive Snapshotzeilen existieren | `BLOCKER_IMMUTABLE_SNAPSHOTS` — Aufgabe 9 bräuchte eine zusätzliche Betragsgegenprobe gegen echte Zeilen, bevor irgendetwas gemergt wird. |
| Migration-0018-Lage unerwartet geändert | `BLOCKER_MIGRATION_STATE` — die Grundlage von §5.5 ist entfallen. |

**Keine Produktionsdaten verändern.** Nur `select`. Kein `insert`, `update`,
`delete`, `alter`, `create`.

Das Ergebnis wird mit Datum und Uhrzeit protokolliert und im PR-Text zitiert —
als `VERIFIED_LIVE`, nicht als Agentenbericht.

> **STATUS: AUSGEFÜHRT am 15.08.2026, 23:40 CEST — alle drei Bedingungen PASS.**
> Vollständiges Protokoll mit Rolle, Rohzeile und Migrationsabgleich in §5.0.
> Kurz: `gesamt=1, mit_endtag=0, mit_vorgaenger=0`;
> `to_regclass('public.cost_snapshots') = null`; 17 von 18 Migrationen
> angewandt, `20260809120000` fehlt. **Aufgabe 1 ist freigegeben.**
> Ausgeführt als `supabase_read_only_user` — ausschließlich `select`.

---

### 9.1 Revidierte Taskfolge im Überblick

| # | Aufgabe | Art | Commit |
| --- | --- | --- | --- |
| **0** | RUNTIME-1 — Bestandsdaten-Gate | **read-only, Produktion** | — (Voraussetzung) |
| 1 | Die eine Umrechnung, an der Persistenzgrenze (A1, A2, A3, B5) | RED/GREEN | offen |
| 2 | Lesen liefert den letzten wirksamen Tag (B1, B10) | RED/GREEN | offen |
| 3 | Schreiben persistiert die DB-Grenze (B1, B12) | RED/GREEN | offen |
| 4 | Ablösung rechnet fachlich (B3, B1, B11) | RED/GREEN | offen |
| 5 | Eine gemeinsame Satzauswahl (B2, B4, B7, B13) | RED/GREEN | offen |
| 5b | Die Brücke bekommt ihren Test (A4) | RED/GREEN | offen |
| 6 | HTTP-Vertragsnachweis (B14) — **kein** Controller-Write | RED/GREEN | offen |
| 7 | UI-Tests und Browserreise (B16, B17) | RED/GREEN | offen |
| 9 | Was sich NICHT ändern darf (B15 + Liste-C-Läufe) | Regression | offen |
| 10 | Der Wächter W1–W3 (A5) + Gegenmutationen | RED/GREEN | **→ C1** |
| 8 | Vertragstext und `v1.json` (B8, B9) | RED/GREEN | **→ C2** |
| 7·2 | E2E-Zusicherung (B17), falls getrennt geführt | Zusicherung | **→ C3** |
| 11 | Volles lokales Gate, dann Push und CI lesen | Gate | — |
| **12** | RUNTIME-2 — Bestandsdaten-Gate vor dem Merge | **read-only, Produktion** | — (Voraussetzung) |

Aufgabe 8 steht bewusst **nach** 10: der Vertragstext sichert eine Bedeutung zu,
die C1 erst herstellt. Umgekehrt wäre C2 ein Commit, der etwas verspricht, was
das Repository noch nicht liefert.

### Vor jeder Aufgabe ab Nummer 1

`typecheck`/`test` hängen an `^build`, und `vitest` über `exec` umgeht Turbo.
Ein veraltetes `packages/contracts/dist` macht Einzeltests grün, die nichts
messen. Deshalb **immer zuerst**:

```bash
pnpm --filter @easytree/config build
pnpm --filter @easytree/domain build
pnpm --filter @easytree/contracts build
```

Und: eine Zahl gilt nur mit `--force` und einer `Cached: 0 cached`-Zeile.

---

### Aufgabe 1: Die eine Umrechnung als benannte Grenze — an der Persistenzgrenze

**Dateien:**

- Neu: `apps/api/src/modules/costs/domain/local-business-date-format.ts` (A2)
- Neu: `apps/api/src/modules/costs/infrastructure/rate-interval-boundary.ts` (A1)
- Neu: `apps/api/test/costs/rate-interval-boundary.test.ts` (A3)
- Ändern: `apps/api/src/modules/costs/index.ts` (B5) — Barrel-Export

> **Warum der Import im Test über die `index.ts` läuft.** Gemessen am
> 15.08.2026 (`ls -1 apps/api/test/costs/*.test.ts | wc -l` und
> `grep -rl '"../../src/modules/costs"'`): das Verzeichnis enthält **24**
> Testdateien; **21** davon importieren `"../../src/modules/costs"`, und
> **keine einzige** einen tiefen Pfad nach `src/modules/costs/…` (gemessen:
> `grep -rn 'src/modules/costs/' apps/api/test/costs/` → leer). Die drei
> übrigen — `cost-access.integration.test.ts`,
> `rate-http-contract.integration.test.ts` (= B14) und
> `rule-version-parity.test.ts` — importieren das Kostenmodul **gar nicht**;
> sie fahren über `AppModule` und HTTP. **Der tragende Befund ist die Null bei
> den tiefen Pfaden, nicht die 21** — eine frühere Fassung dieses Absatzes
> schrieb „alle 21 Testdateien" und beschrieb damit das Verzeichnis falsch.
>
> Erzwungen ist das durch `costs-cross-module-public-api-only`
> (`apps/api/test/architecture/costs-rules.ts:712-753`), das für eine Datei
> ohne Modulzugehörigkeit, die tief nach `costs` greift, meldet:
> *„Modul '?' greift tief nach … ins Kostenmodul"* (Meldung gelesen in
> `costs-rules.ts:746`). Der Architekturscan deckt `apps/` vollständig ab,
> Tests eingeschlossen (`architecture.test.ts:34-37`, `collectSourceFiles`
> über `apps` und `packages`). **Die Erstfassung dieses Plans importierte den
> tiefen Pfad und wäre an diesem Wächter rot geworden.**

**Schritt 1: Den roten Test schreiben** (`rate-interval-boundary.test.ts`)

```ts
/**
 * Die EINE Naht zwischen halboffener Datenbank und einschliessender Fachwelt
 * (EYT-109 D1). Alles darueber liest `validTo` als LETZTEN wirksamen Tag.
 */
import { describe, expect, it } from "vitest";
import { dbEndeZuValidTo, validToZuDbEnde } from "../../src/modules/costs";

describe("rate-interval-boundary", () => {
  it("liest das exklusive DB-Ende als letzten wirksamen Tag", () => {
    // Gegenmutation: `dbEndeZuValidTo` die Eingabe durchreichen lassen -> rot.
    expect(dbEndeZuValidTo("2026-07-01")).toBe("2026-06-30");
    expect(dbEndeZuValidTo("2026-01-01")).toBe("2025-12-31");
    expect(dbEndeZuValidTo("2028-03-01")).toBe("2028-02-29");
    expect(dbEndeZuValidTo("2026-03-01")).toBe("2026-02-28");
  });

  it("schreibt den letzten wirksamen Tag als exklusives DB-Ende", () => {
    // Gegenmutation: `validToZuDbEnde` die Eingabe durchreichen lassen -> rot.
    expect(validToZuDbEnde("2026-06-30")).toBe("2026-07-01");
    expect(validToZuDbEnde("2025-12-31")).toBe("2026-01-01");
    expect(validToZuDbEnde("2028-02-29")).toBe("2028-03-01");
  });

  it("laesst `null` in beide Richtungen `null`", () => {
    // Gegenmutation: `null` auf ein Datum abbilden -> rot. Ohne diesen Fall
    // koennte die unbegrenzte Version still ein Ende bekommen.
    expect(dbEndeZuValidTo(null)).toBeNull();
    expect(validToZuDbEnde(null)).toBeNull();
  });

  it("ist in beide Richtungen verlustfrei — auch ueber Monat, Jahr, Schaltjahr", () => {
    // Gegenmutation: eine der Richtungen auf `dayAfter` umstellen -> rot.
    for (const tag of ["2026-06-30", "2026-12-31", "2028-02-29", "2026-02-28", "2026-01-01"]) {
      expect(dbEndeZuValidTo(validToZuDbEnde(tag))).toBe(tag);
    }
  });

  it("ein Ein-Tages-Satz ist ausdrueckbar und verletzt den DB-Check nicht", () => {
    // EYT-95 erlaubt `validTo === validFrom`. Migration 0013 verlangt
    // `valid_to > valid_from`. Beides gilt nur zusammen, wenn hier `dayAfter`
    // steht. Gegenmutation: Identitaet -> `validToZuDbEnde` liefert den
    // Starttag, der DB-Check schluege zu, und dieser Test wird rot.
    expect(validToZuDbEnde("2026-06-01")).toBe("2026-06-02");
  });
});
```

**Schritt 2: Rot laufen lassen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/rate-interval-boundary.test.ts
```

Erwartet: FAIL — `Cannot find module '.../rate-interval-boundary'`.

**Schritt 3a: Die Kalenderhelfer an ihren Ort** (A2, **`domain/`**, keine
DB-Begriffe)

`apps/api/src/modules/costs/domain/local-business-date-format.ts`:

```ts
/**
 * `JJJJ-MM-TT` <-> {@link LocalBusinessDate} — die Textform eines Kalendertages
 * (EYT-109).
 *
 * Bewusst KEINE Aussage ueber Intervallgrenzen: hier steht nichts ueber
 * halboffen oder einschliessend, ueber `valid_to` oder ueber PostgreSQL. Das
 * sind zwei verschiedene Dinge, und sie sind frueher deshalb verwechselt worden,
 * weil sie in derselben Funktion standen. Die Intervallgrenze uebersetzt
 * `infrastructure/rate-interval-boundary.ts`, und nur die.
 *
 * Liegt in `domain/`, weil drei Domaenendateien sie brauchen
 * (`rate-effectivity`, `rate-succession`, `cost-snapshot-assembly`) und
 * `domain-allowlist` Domaenencode verbietet, nach `infrastructure/` zu greifen.
 *
 * `@easytree/domain` exportiert bewusst KEINE solche Funktion:
 * `LocalBusinessDate` ist ein offenes Interface ohne Laufzeitvalidierung, und
 * das Paket sagt dazu ausdruecklich „wer diese Eingabe ausschliessen will, tut
 * das an der Grenze, an der das Datum entsteht". Diese Grenze ist hier: die
 * Zeichenkette kommt aus `date`-Spalten, die PostgreSQL bereits als Kalendertag
 * geprueft hat, oder aus `BusinessDateSchema` des Vertrags.
 *
 * Nie ueber `Date`: das machte aus einem Kalendertag einen Zeitpunkt in
 * irgendeiner Zone — genau das verbietet `no-local-time-construction.test.ts`.
 */
import type { LocalBusinessDate } from "@easytree/domain";

export function formatLocalDate(date: LocalBusinessDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${String(date.year).padStart(4, "0")}-${mm}-${dd}`;
}

export function parseLocalDate(iso: string): LocalBusinessDate {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}
```

**Schritt 3b: Die Umrechnung an der Persistenzgrenze** (A1,
**`infrastructure/`**)

`apps/api/src/modules/costs/infrastructure/rate-interval-boundary.ts`:

```ts
/**
 * Die EINZIGE Umrechnung zwischen der halboffenen Datenbank und der
 * einschliessenden Fachwelt (EYT-109 D1).
 *
 * ## Warum es diese Datei gibt
 *
 * Die Datenbank fuehrt `[valid_from, valid_to)` (Migration 0013,
 * `daterange(..., '[)')`), der abgenommene Vertrag EYT-95 fuehrt
 * `[validFrom, validTo]` einschliessend. Vor EYT-109 D1 reichte das Repository
 * `valid_to` roh nach oben durch, und die Oberflaeche zeigte unter „Gueltig bis"
 * einen Tag, an dem der Satz schon nicht mehr galt.
 *
 * ## Warum sie in `infrastructure/` liegt und nicht in `domain/`
 *
 * Ihr Existenzgrund ist eine Eigenschaft der SPEICHERUNG, nicht der Fachlichkeit:
 * ohne den `daterange`-Constraint aus Migration 0013 gaebe es sie nicht. In
 * `domain/` waere sie ein Datenbankbegriff in der innersten Schicht. Der
 * Architekturtest erzwingt das ohnehin in der Gegenrichtung —
 * `domain-allowlist` laesst Domaenencode nicht nach `infrastructure/` greifen,
 * womit ein Leck nach unten strukturell unmoeglich ist.
 *
 * Es gibt genau VIER Aufrufstellen, alle in `rate-repository.pg.ts`; der
 * statische Waechter `rate-boundary-single-site.test.ts` faellt rot, sobald eine
 * fuenfte in `application/` oder `interface/` entsteht.
 *
 * ## Warum `dayBefore`/`dayAfter` und nicht `tag ± 1`
 *
 * Die naheliegende Subtraktion ist am Monats-, Jahres- und Schaltjahresanfang
 * falsch — der 01.08. haette den „0. August" zum Vorgaenger — und fiele dort
 * niemandem auf. `@easytree/domain` rechnet das ohne `Date`, weil V3
 * ausdruecklich verbietet, Kalendertage in Zeitpunkte zu wandeln.
 */
import { dayAfter, dayBefore } from "@easytree/domain";

import { formatLocalDate, parseLocalDate } from "../domain/local-business-date-format";

/** DB-exklusives Ende -> letzter wirksamer Tag. `null` bleibt unbegrenzt. */
export function dbEndeZuValidTo(dbValidTo: string | null): string | null {
  return dbValidTo === null ? null : formatLocalDate(dayBefore(parseLocalDate(dbValidTo)));
}

/** Letzter wirksamer Tag -> DB-exklusives Ende. `null` bleibt unbegrenzt. */
export function validToZuDbEnde(validTo: string | null): string | null {
  return validTo === null ? null : formatLocalDate(dayAfter(parseLocalDate(validTo)));
}
```

**Schritt 3c: Barrel-Export** (B5) — in `apps/api/src/modules/costs/index.ts`:

```ts
// EYT-109 D1: die EINE Umrechnung zwischen halboffener Datenbank und
// einschliessender Fachwelt. Sie steht hier aus demselben Grund wie
// `toCostSnapshotDto` und `PgRateRepository`: ihr Test braucht sie von aussen,
// und ein tiefer Pfad nach `infrastructure/` faellt am Waechter
// `costs-cross-module-public-api-only` — auch aus Tests.
export { dbEndeZuValidTo, validToZuDbEnde } from "./infrastructure/rate-interval-boundary";
```

**Schritt 4: Grün laufen lassen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/rate-interval-boundary.test.ts
```

Erwartet: PASS, 5 Tests.

**Schritt 5: NICHT committen.** Siehe §9.0 — dieser Stand allein ist zwar
konsistent (nichts ruft die neuen Funktionen), aber der nächste Schritt macht
ihn es nicht mehr. Der Commit kommt gesammelt als **C1**.

---

### Aufgabe 2 (T2): Lesen liefert den letzten wirksamen Tag

**Dateien:** `apps/api/test/costs/rate-batch-read.test.ts` (ändern),
`apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts:97-110`

**Schritt 1: Bestehende Erwartung umdrehen** — Z. 309–310 werden zu:

```ts
    // EYT-109 D1: die DB fuehrt `[von, bis)`, die Fachwelt `[von, bis]`.
    // Gespeichert ist `2025-12-31` (exklusiv); fachlich endet die Version am
    // 30.12. Gegenmutation: `dbEndeZuValidTo` in `toRecord` entfernen -> rot.
    expect(abbildung.get(ANNA)?.[1]?.validTo).toBeNull();
    expect(abbildung.get(ANNA)?.[0]?.validTo).toBe("2025-12-30");
```

Zusätzlich einen Fall mit dem Wechseltag aus Kommentar 13533 ergänzen (DB
`valid_to = '2026-07-01'` → erwartet `"2026-06-30"`).

**Schritt 2: Rot**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/rate-batch-read.test.ts
```

Erwartet: FAIL — `expected "2025-12-31" to be "2025-12-30"`.

**Schritt 3: `toRecord` umstellen** — in `rate-repository.pg.ts`:

```ts
import { dbEndeZuValidTo, validToZuDbEnde } from "./rate-interval-boundary";

function toRecord(row: RateRow): RateVersionRecord {
  return {
    // …
    validFrom: row.valid_from,
    // Halboffen (DB) -> einschliessend (Fachwelt). Die einzige Leserichtung
    // dieser Naht; oberhalb gibt es keine zweite Lesart mehr (EYT-109 D1).
    validTo: dbEndeZuValidTo(row.valid_to),
    // …
  };
}
```

**Schritt 4: Grün** — derselbe Befehl, PASS.

**Schritt 5: NICHT committen.** Ab hier liefert das Repository einschließend,
während `cost-snapshot-assembly.ts` noch sein eigenes `dayBefore` anwendet — der
Zustand mit **doppelter Umrechnung**. Genau dieser Stand darf nach §9.0 nicht in
die Historie. Weiter zu Aufgabe 3; der Commit kommt als **C1**.

---

### Aufgabe 3 (T3): Schreiben persistiert die DB-Grenze

**Dateien:** `apps/api/test/costs/rate-succession.integration.test.ts` (ergänzen),
`rate-repository.pg.ts:302-319`

**Schritt 1: Roten Integrationstest ergänzen** — legt über
`repository.append(...)` eine Version mit **fachlich** `validTo: "2026-06-30"`
an und liest die Zeile mit einer **Admin-Verbindung** (`postgres`) roh zurück:

```ts
  it("persistiert den fachlichen Endtag als exklusive DB-Grenze", async () => {
    // Gegenmutation: `validToZuDbEnde` im INSERT entfernen -> die DB haelte
    // `2026-06-30`, und der Nahtstellentag verschoebe sich um einen Tag.
    const ergebnis = await repository.append({ /* …, */ validTo: "2026-06-30" });
    expect(ergebnis.ok).toBe(true);
    const roh = await admin.query<{ valid_to: string }>(
      `select to_char(valid_to,'YYYY-MM-DD') as valid_to
         from public.employee_rate_versions where id = $1`,
      [ergebnis.ok ? ergebnis.version.id : ""],
    );
    expect(roh.rows[0]?.valid_to).toBe("2026-07-01");
    // Und der Rundlauf: was zurueckkommt, ist wieder fachlich.
    expect(ergebnis.ok && ergebnis.version.validTo).toBe("2026-06-30");
  });
```

> Der Rundlauf allein genügt **nicht** — er wäre auch bei zwei sich aufhebenden
> Fehlern grün. Erst die rohe Admin-Abfrage trennt „richtig gespeichert" von
> „symmetrisch falsch" (Merkregel `net-count-checks-cancel-out`).
> Beachte `runtime-channel-tests-need-observer-connection`: die rohe Abfrage
> läuft auf `postgres`, nicht auf `easytree_app`.

**Schritt 2: Rot** — `EASYTREE_TENANT_TESTS=required pnpm --filter @easytree/api exec vitest run test/costs/rate-succession.integration.test.ts`
(braucht eine laufende Datenbank; ohne sie ist der Nachweis erst in `db-gates`).
Erwartet: FAIL — `expected "2026-06-30" to be "2026-07-01"`.

**Schritt 3: INSERT umstellen**

```ts
          [
            version.organisationId,
            version.employeeId,
            version.amountMinorUnits,
            version.validFrom,
            // Einschliessend (Fachwelt) -> halboffen (DB). Erst hier wird aus
            // dem letzten wirksamen Tag die Ausschlussgrenze (EYT-109 D1).
            validToZuDbEnde(version.validTo),
            version.expectedActiveVersionId,
            version.reason,
            version.correlationId,
          ],
```

**Schritt 4: Grün** — derselbe Befehl.

**Schritt 5: NICHT committen** (§9.0). Weiter zu Aufgabe 4.

---

### Aufgabe 4 (T4): Ablösung bleibt lückenlos und überlappungsfrei

**Dateien:** `apps/api/test/costs/rate-succession.test.ts`,
`apps/api/src/modules/costs/domain/rate-succession.ts:85-89`,
`rate-repository.pg.ts:263-291`

**Schritt 1: Erwartung in `rate-succession.test.ts:51` umdrehen**

```ts
    // EYT-109 D1: die Regel liefert jetzt den FACHLICHEN Endtag. Bei einem
    // Nachfolger ab 01.07. endet der Vorgaenger am 30.06. — lueckenlos und
    // ueberlappungsfrei. Der DB-Wert bleibt `2026-07-01`; die Umrechnung macht
    // der Adapter. Gegenmutation: `dayBefore` weglassen -> rot.
    if (ergebnis.ok) expect(ergebnis.validToDesVorgaengers).toBe("2026-06-30");
```

Zusätzlich einen Fall, der die Lückenlosigkeit **fachlich** prüft:
`dayAfter(vorgaenger.validTo) === nachfolger.validFrom`.

**Schritt 2: Rot** — `pnpm --filter @easytree/api exec vitest run test/costs/rate-succession.test.ts`.
Erwartet: FAIL — `expected "2026-07-01" to be "2026-06-30"`.

**Schritt 3: Regel und Adapter umstellen**

`rate-succession.ts` — Rückgabe wird fachlich:

```ts
import { dayBefore } from "@easytree/domain";

import { formatLocalDate, parseLocalDate } from "./local-business-date-format";

// …

  // Der Vorgaenger endet am Tag VOR dem Beginn des Nachfolgers: lueckenlos und
  // ueberlappungsfrei unter der einschliessenden Lesart von EYT-95. Nicht frei
  // waehlbar — ein Tag frueher risse eine Luecke, ein Tag spaeter eine
  // Ueberlappung.
  //
  // `dayBefore` ist hier ein KALENDERSCHRITT, keine Datenbankuebersetzung: die
  // Regel kennt nur fachliche Tage. Dass daraus zufaellig wieder
  // `nachfolger.validFrom` als DB-Wert wird, ist die Leistung des Adapters
  // (`validToZuDbEnde`), nicht die dieser Zeile — und deshalb steht sie hier und
  // nicht dort (EYT-109 D1).
  return {
    ok: true,
    validToDesVorgaengers: formatLocalDate(dayBefore(parseLocalDate(nachfolger.validFrom))),
  };
```

> **Dies ist der aufgelöste Widerspruch aus P3.** Die Erstfassung plante genau
> diese Zeile *und* einen Wächter, der jede `dayBefore`/`dayAfter`-Nutzung
> außerhalb der Grenzdatei verbietet — der Wächter hätte den eigenen Task rot
> gemacht. Der Wächter in Aufgabe 10 verbietet **keine Kalenderprimitive**; er
> sichert ausschließlich, dass die *Übersetzung* `valid_to ↔ validTo` nur an der
> Repository-Grenze stattfindet. `dayBefore` im Kopf einer Ablösungsregel ist
> Fachlogik und bleibt erlaubt.

`rate-repository.pg.ts` — beide verbleibenden Stellen:

```ts
          const abloesung = pruefeAbloesung({
            vorgaenger: {
              // …
              validFrom: vorgaenger.valid_from,
              // Auch dieser Weg fuehrt durch die Naht: `pruefeAbloesung` ist
              // eine FACHLICHE Regel und sieht nie eine DB-Grenze.
              validTo: dbEndeZuValidTo(vorgaenger.valid_to),
              // …
            },
            // …
          });
          // …
          const geschlossen = await tx.query(
            `update public.employee_rate_versions
                set valid_to = $2::date
              where id = $1 and valid_to is null`,
            [vorgaenger.id, validToZuDbEnde(abloesung.validToDesVorgaengers)],
          );
```

**Schritt 4: Grün** — Unit-Test plus, sobald eine DB verfügbar ist:

```bash
EASYTREE_TENANT_TESTS=required \
  pnpm --filter @easytree/api exec vitest run test/costs/rate-succession.integration.test.ts
```

Der bestehende Fall `rate-succession.integration.test.ts:244`
(`expect(zustand.rows[0]?.valid_to).toBe("2030-07-01")`) muss **unverändert grün
bleiben** — das ist der Beweis, dass der Rundlauf denselben DB-Wert erzeugt wie
vorher.

**Schritt 5: NICHT committen** (§9.0). Weiter zu Aufgabe 5.

---

### Aufgabe 5 (T7): Snapshot wählt kanonisch — und rechnet identisch

**Dateien:** `apps/api/test/costs/cost-snapshot-assembly.test.ts`,
`apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts`,
`apps/api/src/modules/costs/domain/rate-effectivity.ts`

**Schritt 1: Den D1-Einfriertest umschreiben** (Z. 149 ff.). Die Fixtures
werden **fachlich**, das Ergebnis bleibt gleich:

```ts
  it("waehlt am Nahtstellentag den Nachfolger — jetzt mit EINER Semantik", () => {
    // Fachlich: Satz A [2026-06-01, 2026-06-30], Satz B [2026-07-01, ∞).
    // In der DB steht dafuer weiterhin A.valid_to = 2026-07-01.
    // Der frueher hier eingefrorene Widerspruch (D1) ist aufgeloest: dieselbe
    // Auswahl faellt jetzt mit `@easytree/domain::selectRateVersion` — und
    // liefert dasselbe Ergebnis wie vorher.
    //
    // Gegenmutation: A.validTo auf "2026-07-01" setzen -> RATE_AMBIGUOUS, rot.
    const a = satz({ /* … */ validFrom: "2026-06-01", validTo: "2026-06-30" });
    const b = satz({ /* … */ validFrom: "2026-07-01", validTo: null, amountMinorUnits: "3000" });
    // …
    expect(ergebnis.positions[0]?.rateVersionId).toBe(b.id);
    expect(ergebnis.positions[0]?.amountMinorUnits).toBe(24000n); // 8 h * 30,00 — UNVERAENDERT
  });

  it("waehlt am letzten wirksamen Tag noch den Vorgaenger", () => {
    // Der Gegenpol. Ohne ihn waere „Nachfolger am 01.07." auch dann grün, wenn
    // der Vorgaenger schon am 30.06. verschwaende.
    // Gegenmutation: in `selectRateVersion` `dayAfter` durch Identitaet
    // ersetzen -> RATE_MISSING am 30.06., rot.
    // … Einsatz am 2026-06-30 -> rateVersionId === a.id
  });
```

**Schritt 2: Rot** — `pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts`.
Erwartet: FAIL — mit fachlichem `validTo: "2026-06-30"` liefert das heutige
halboffene `effectiveRateVersion` am 30.06. bereits `RATE_NOT_FOUND`.

**Schritt 3: EINE gemeinsame Satzauswahl (P4) — die Brücke in `rate-effectivity.ts`**

Die Erstfassung löschte `effectiveRateVersion` und ließ Controller und Montage
jeweils selbst konvertieren. **Zurückgenommen** — das wären zwei
Record→`HourlyRateVersion`-Konvertierungen und damit genau die Doppelung, die
D1 überhaupt erzeugt hat. Stattdessen wird `effectiveRateVersion` **innen**
umgebaut und bleibt außen unverändert benutzbar.

`apps/api/src/modules/costs/domain/rate-effectivity.ts` (B2) — die vollständige
neue Auswahl:

```ts
/**
 * Welche Satzversion gilt an einem Geschaeftstag? (EYT-108, EYT-109)
 *
 * ## Diese Funktion ENTSCHEIDET nicht mehr selbst — sie uebersetzt und delegiert
 *
 * Vor EYT-109 D1 stand hier eine zweite, handgeschriebene Intervallregel
 * (`businessDate < validTo`, halboffen), waehrend `@easytree/domain` dieselbe
 * Frage einschliessend beantwortete. Zwei Regeln fuer dieselbe Sache sind genau
 * ein Widerspruch zu viel; der abgenommene Vertrag EYT-95 (Jira-Kommentar 11425:
 * „`validTo` ist einschliessend, intern kanonisch halboffen
 * `[validFrom, dayAfter(validTo))`") ist die Autoritaet.
 *
 * Diese Datei ist deshalb nur noch eine BRUECKE:
 *   1. fachliche `RateVersionRecord`s -> gepruefte `HourlyRateVersion`s
 *   2. Auswahl durch `@easytree/domain::selectRateVersion` — die EINZIGE Regel
 *   3. Rueckabbildung auf die Fehlercodes, die dieses Modul nach aussen fuehrt
 *
 * Sie liefert BEIDE Formen zurueck: `version` fuer Id und DTO, `checked` fuer
 * `costOfDuration`. Ohne `checked` muesste die Montage ein zweites Mal
 * konvertieren — und eine zweite Konvertierung ist eine zweite Gelegenheit,
 * sich um einen Tag zu irren.
 *
 * Kein `versions.find(...)`: bei zwei deckenden Saetzen liefert das klaglos den
 * erstbesten und erzeugt einen Betrag, den hinterher niemand belegen kann.
 */
import {
  hourlyRateAmount,
  hourlyRateVersion,
  moneyOfMinorUnits,
  selectRateVersion,
  unsafeIdentifier,
} from "@easytree/domain";
import type { HourlyRateVersion, RateVersionId } from "@easytree/domain";

import { parseLocalDate } from "./local-business-date-format";
import type { RateVersionRecord } from "./rate-version";

export const RATE_EFFECTIVITY_PROBLEMS = [
  "RATE_NOT_FOUND",
  "RATE_AMBIGUOUS",
  /**
   * Eine gespeicherte Satzzeile passiert die Domaenenfactory nicht — negativer
   * Betrag oder `validTo` vor `validFrom`. Mit den Checks aus Migration 0013
   * unerreichbar; der Zweig steht trotzdem, weil ein `!` an dieser Stelle eine
   * Pruefung BEHAUPTEN wuerde, die niemand ausfuehrt.
   */
  "RATE_INVALID",
] as const;
export type RateEffectivityProblem = (typeof RATE_EFFECTIVITY_PROBLEMS)[number];

export type EffectiveRateResult =
  | {
      readonly ok: true;
      /** Die gewaehlte Zeile — fuer Id, Historie und DTO. */
      readonly version: RateVersionRecord;
      /** Dieselbe Version, geprueft — fuer `costOfDuration` (EYT-95). */
      readonly checked: HourlyRateVersion;
    }
  | { readonly ok: false; readonly problem: RateEffectivityProblem };

export function effectiveRateVersion(
  versions: readonly RateVersionRecord[],
  businessDate: string,
): EffectiveRateResult {
  // Alle Zeilen, nicht nur eine Vorauswahl: `selectRateVersion` muss
  // Mehrdeutigkeit ueber den GESAMTEN Katalog erkennen koennen. Eine vorherige
  // Filterung waere eine dritte Intervallregel durch die Hintertuer.
  const geprueft: HourlyRateVersion[] = [];
  const nachId = new Map<string, RateVersionRecord>();

  for (const record of versions) {
    const satzBetrag = hourlyRateAmount(
      moneyOfMinorUnits(BigInt(record.amountMinorUnits), record.currency),
    );
    if (!satzBetrag.ok) return { ok: false, problem: "RATE_INVALID" };

    // KEIN `dayBefore` mehr: `record.validTo` ist seit EYT-109 D1 bereits der
    // letzte wirksame Tag — dieselbe Lesart, die `HourlyRateVersion` fuehrt.
    // Ein `dayBefore` hier waere die doppelte Umrechnung aus Risiko R1.
    const version = hourlyRateVersion({
      rateVersionId: unsafeIdentifier<RateVersionId>(record.id),
      amountPerHour: satzBetrag.rate,
      validFrom: parseLocalDate(record.validFrom),
      validTo: record.validTo === null ? null : parseLocalDate(record.validTo),
    });
    if (!version.ok) return { ok: false, problem: "RATE_INVALID" };

    geprueft.push(version.version);
    nachId.set(record.id, record);
  }

  const gewaehlt = selectRateVersion(geprueft, parseLocalDate(businessDate));
  if (!gewaehlt.ok) {
    // Die EINZIGE Stelle, an der die Domaenennamen auf die Modulnamen treffen.
    // `RATE_MISSING` heisst hier `RATE_NOT_FOUND`, weil dieser Name bereits in
    // `SNAPSHOT_ASSEMBLY_PROBLEMS`, im Controller und im Vertrag steht; ihn zu
    // aendern waere eine Vertragsaenderung ohne fachlichen Anlass.
    return { ok: false, problem: gewaehlt.error === "RATE_MISSING" ? "RATE_NOT_FOUND" : "RATE_AMBIGUOUS" };
  }

  const record = nachId.get(gewaehlt.version.rateVersionId);
  if (record === undefined) {
    // Unerreichbar: jede gepruefte Version stammt aus `nachId`. LAUT abbrechen
    // statt still `RATE_NOT_FOUND` zu liefern — ein Waechter, der bei internem
    // Fehler in die fachliche Richtung faellt, verbirgt genau den Fall, den er
    // melden soll (gleiche Konvention wie `findRateVersionOverlaps`).
    throw new RangeError(
      `Invariante verletzt: gewaehlte Satzversion ${gewaehlt.version.rateVersionId} hat keine Ausgangszeile.`,
    );
  }
  return { ok: true, version: record, checked: gewaehlt.version };
}

/** Anzeigezustand einer Version relativ zum heutigen Geschaeftsdatum. */
export function rateVersionStatus(
  version: RateVersionRecord,
  businessDate: string,
): "aktiv" | "kommend" | "abgelaufen" {
  if (version.validFrom > businessDate) return "kommend";
  // EYT-109 D1: `validTo` ist der LETZTE wirksame Tag. `<=` waere hier der
  // Ein-Tages-Fehler — die Version erschiene an ihrem eigenen letzten
  // Gueltigkeitstag bereits als abgelaufen.
  if (version.validTo !== null && version.validTo < businessDate) return "abgelaufen";
  return "aktiv";
}
```

**Was damit ausdrücklich NICHT entsteht:**

| Verbot aus P4 | Warum es hier nicht verletzt wird |
| --- | --- |
| separate Record→`HourlyRateVersion`-Konvertierungen in Controller und Montage | Es gibt **eine**, in dieser Datei. Der Controller konvertiert nicht (er braucht nur `version.id`), die Montage konvertiert nicht (sie bekommt `checked`). |
| zweite handgeschriebene Intervallregel | `businessDate < validTo` ist **gelöscht**. Die einzige verbliebene Regel ist `coversDay` in `@easytree/domain`. |
| `Array.find` als Auswahl | Nirgends. `selectRateVersion` zählt alle Treffer und blockiert bei mehr als einem. |
| Verlust von `RATE_MISSING`/`RATE_AMBIGUOUS` | Beide bleiben, unter ihren bisherigen Modulnamen `RATE_NOT_FOUND`/`RATE_AMBIGUOUS`. Die Abbildung steht an genau einer Stelle. |

**Schritt 3b: Die Montage entschlacken** (B4)

In `cost-snapshot-assembly.ts`: den Kopfabschnitt „Warum `effectiveRateVersion`
und nicht `selectRateVersion`" **ersetzen** — er begründet heute genau den
Defekt. `dayBefore`, `hourlyRateAmount`, `hourlyRateVersion`, `moneyOfMinorUnits`,
`unsafeIdentifier` und `RateVersionId` aus dem Import entfernen; die privaten
`parseLocalDate`/`formatLocalDate` löschen und `formatLocalDate` aus
`./local-business-date-format` importieren. Die Schleife schrumpft auf:

```ts
      const gewaehlt = effectiveRateVersion(saetze, tag);
      if (!gewaehlt.ok) return scheitern(gewaehlt.problem, tag);

      const betrag = costOfDuration(gewaehlt.checked, anteil.quantity);
```

`gewaehlt.problem` ist bereits vom Typ `RateEffectivityProblem` und alle drei
Werte (`RATE_NOT_FOUND`, `RATE_AMBIGUOUS`, `RATE_INVALID`) stehen schon in
`SNAPSHOT_ASSEMBLY_PROBLEMS` — die Zuweisung typprüft ohne Cast.

> **Bewusste Ausweitung, die genannt werden muss (R8):** heute wird nur die
> *gewählte* Zeile durch `hourlyRateVersion` geprüft, künftig **alle** Zeilen des
> Beschäftigten — anders ist Mehrdeutigkeit nicht feststellbar. Mit den Checks
> aus Migration 0013 (`amount_minor_units >= 0`, `valid_to > valid_from`) ist der
> Zweig unerreichbar; er wird strenger, nicht lockerer. Ein Test hält das fest.

> **Bewusst nicht optimiert (YAGNI):** die Konvertierung läuft je Ortstag statt
> einmal je Beschäftigtem. Das ist O(Tage × Versionen) auf einer Liste, die pro
> Person einstellig ist. Ein Hochziehen vor die Tagesschleife bräuchte einen
> zweiten Einstiegspunkt in die Brücke — und damit wieder zwei Wege zur selben
> Auswahl. Korrektheit vor Mikrooptimierung.

**Schritt 4: Grün**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts
```

**Schritt 5: NICHT committen** (§9.0). Ab hier ist die Semantik zwar in
Repository, Domäne und Montage einheitlich — aber die Brücke hat noch keinen
eigenen Test und der Wächter fehlt. Weiter zu Aufgabe 5b.

---

### Aufgabe 5b: Die Brücke bekommt ihren eigenen Test (A4)

**Datei:** neu `apps/api/test/costs/rate-effectivity.test.ts`

Gemessen: `effectiveRateVersion` und `rateVersionStatus` haben **heute keinen
Unit-Test** — beide Namen erscheinen unter `apps/api/test/` ausschließlich in
`snapshot-immutability.integration.test.ts`, die nur mit laufender Datenbank
läuft. Die Funktion, deren Semantik dieser Plan umlegt, wäre also ohne diesen
Schritt nur im CI-Job `db-gates` abgesichert.

Der Test deckt genau die Grenzfälle ab, an denen die alte und die neue Lesart
auseinandergehen:

```ts
import { describe, expect, it } from "vitest";
import { effectiveRateVersion, rateVersionStatus } from "../../src/modules/costs";

// Fachlich: A [2026-06-01, 2026-06-30], B [2026-07-01, offen].
const A = satz({ id: ID_A, validFrom: "2026-06-01", validTo: "2026-06-30" });
const B = satz({ id: ID_B, validFrom: "2026-07-01", validTo: null });

describe("effectiveRateVersion — die eine Auswahl", () => {
  it("waehlt am LETZTEN wirksamen Tag noch den Vorgaenger", () => {
    // Gegenmutation: `coversDay` exklusiv lesen (bzw. das alte
    // `businessDate < validTo` zurueckholen) -> RATE_NOT_FOUND, rot.
    const e = effectiveRateVersion([A, B], "2026-06-30");
    expect(e.ok && e.version.id).toBe(ID_A);
  });

  it("waehlt am Nahtstellentag den Nachfolger", () => {
    // Gegenmutation: A.validTo auf "2026-07-01" setzen (= der alte DB-Wert)
    // -> beide decken den 01.07. -> RATE_AMBIGUOUS, rot. Das ist genau der
    // Widerspruch, den D1 beschreibt.
    const e = effectiveRateVersion([A, B], "2026-07-01");
    expect(e.ok && e.version.id).toBe(ID_B);
  });

  it("liefert die gepruefte Version mit — und zwar dieselbe", () => {
    // Gegenmutation: `checked` aus dem Ergebnis entfernen -> die Montage
    // muesste selbst konvertieren; der Typfehler ist der Nachweis.
    const e = effectiveRateVersion([A, B], "2026-06-30");
    expect(e.ok && e.checked.rateVersionId).toBe(ID_A);
    expect(e.ok && e.checked.validTo).toEqual({ year: 2026, month: 6, day: 30 });
  });

  it("blockiert statt zu waehlen — RATE_NOT_FOUND und RATE_AMBIGUOUS", () => {
    // Gegenmutation: auf `versions.find(...)` umstellen -> der ueberlappende
    // Fall liefert klaglos den erstbesten, rot.
    expect(effectiveRateVersion([A, B], "2026-05-31")).toEqual({
      ok: false,
      problem: "RATE_NOT_FOUND",
    });
    const ueberlappend = satz({ id: ID_C, validFrom: "2026-06-15", validTo: null });
    expect(effectiveRateVersion([A, ueberlappend], "2026-06-20")).toEqual({
      ok: false,
      problem: "RATE_AMBIGUOUS",
    });
  });

  it("nennt eine unbrauchbare Nachbarzeile RATE_INVALID statt sie zu ignorieren", () => {
    // Die bewusste Ausweitung aus R8, ausdruecklich festgehalten.
    // Gegenmutation: den `RATE_INVALID`-Zweig auf `continue` aendern -> die
    // kaputte Zeile verschwaende still und Mehrdeutigkeit bliebe unentdeckt.
    const kaputt = satz({ id: ID_D, validFrom: "2026-08-01", validTo: "2026-07-01" });
    expect(effectiveRateVersion([A, kaputt], "2026-06-30")).toEqual({
      ok: false,
      problem: "RATE_INVALID",
    });
  });
});

describe("rateVersionStatus — einschliessend", () => {
  it("ist am letzten Gueltigkeitstag noch `aktiv`", () => {
    // Gegenmutation: `<` zurueck auf `<=` -> "abgelaufen", rot. Das ist R2.
    expect(rateVersionStatus(A, "2026-06-30")).toBe("aktiv");
    expect(rateVersionStatus(A, "2026-07-01")).toBe("abgelaufen");
    expect(rateVersionStatus(B, "2026-06-30")).toBe("kommend");
  });
});
```

**Schritt 5: NICHT committen** (§9.0). Weiter zu Aufgabe 6.

---

### Aufgabe 6 (T5): API zeigt einschließende Enddaten und den richtigen Status

**Dateien:** `apps/api/test/costs/rate-http-contract.integration.test.ts` (B14)

**`costs.controller.ts` wird NICHT geändert** — es steht in Liste C. Das ist der
zweite Gewinn der Brücke aus Aufgabe 5: Z. 206 ruft weiterhin
`effectiveRateVersion(versionen, heute)` und benutzt weiterhin nur `.ok` und
`.version.id`. Ein zusätzliches Feld im Erfolgszweig ist für diesen Aufrufer
unsichtbar. `toDto` (Z. 638–646) bleibt ein roher Durchgriff — und ist jetzt
**korrekt**, weil der Port fachlich spricht.

**Der Controller wird trotzdem gelesen**, um genau das zu bestätigen; steht in
der Umsetzung etwas anderes dort, ist das ein Befund und keine stille Anpassung.

**Schritt 1: Roten Vertragstest ergänzen** — über den realen HTTP-Pfad eine
Version mit `validTo: "2026-06-30"` anlegen, dann `GET
/kosten/stundensaetze/{employeeId}` lesen. Erwartet: `validTo === "2026-06-30"`
(nicht `"2026-07-01"`) und `status === "aktiv"` an einem Geschäftsdatum
`2026-06-30`, `"abgelaufen"` ab `2026-07-01`.

> Dieser Test ist der einzige, der die **ganze** Kette am Stück misst:
> HTTP-Eingabe → Zod → Port → `validToZuDbEnde` → PostgreSQL → `dbEndeZuValidTo`
> → `toDto` → HTTP-Ausgabe. Ein Vorzeichenfehler in einer der beiden
> Umrechnungen hebt sich im Rundlauf auf; deshalb prüft **Aufgabe 3** zusätzlich
> die rohe Zeile über eine Admin-Verbindung. Erst beide zusammen trennen
> „richtig" von „symmetrisch falsch" (`net-count-checks-cancel-out`).

**Schritt 2: Rot.** **Schritt 3:** entfällt — Aufgabe 2 und 3 haben die
Umstellung bereits geliefert; dieser Test wird durch sie grün. Ist er es nicht,
ist die Kette unvollständig.

**Schritt 4: Grün.** **Schritt 5: NICHT committen** (§9.0).

---

### Aufgabe 7 (T6, T10): UI und Browserreise erzählen dieselbe Geschichte

**Dateien:** `apps/web/test/rate-management.test.tsx`,
`apps/web/e2e/auth-journey/journey.pwtest.ts`

**Kein Produktivcode in `apps/web`.** Die Komponente wird durch die Reparatur
richtig; geändert werden nur die Fixtures und die Zusicherungen.

**Schritt 1:** In `rate-management.test.tsx` die Fixtures (Z. 63, 71) auf
fachliche Enddaten setzen und einen Test ergänzen, der die Nahtstelle als
**Geschichte** prüft: Vorgänger zeigt „30.06.", Nachfolger beginnt „01.07.",
kein Tag doppelt, kein Tag fehlt. Gegenmutation: die Fixtures auf den DB-Wert
zurückdrehen → die Erzählung hat den 01.07. zweimal, rot.

**Schritt 2:** In `journey.pwtest.ts` an die bestehende Task-17-Stelle, die
bereits über den realen `POST /api/v1/kosten/stundensaetze` eine zweite Version
anlegt, eine Zusicherung anhängen: `[data-testid="gueltig-bis"]` des Vorgängers
zeigt den Tag **vor** dem `validFrom` des Nachfolgers.

> Vorsicht: `removing-a-testid-breaks-e2e-silently` — `gueltig-bis` existiert
> (`rate-management.tsx:388`) und darf nicht umbenannt werden. Playwright läuft
> nicht in `pnpm test`; der Nachweis kommt aus dem CI-Job `auth-journey`.

**Schritt 3–4:** Rot, grün. **Schritt 5:** Der Web-Unit-Test (B16) gehört in
**C1**, die E2E-Zusicherung (B17) darf als **C3** getrennt bleiben oder mit C1
zusammenfallen — beides ist konsistent, weil B17 nur eine zusätzliche Prüfung
ist und nichts an der Semantik dreht.

---

### Aufgabe 8 (T12): Die Semantik steht im Vertrag, nicht nur im Code

**Dateien:** `packages/contracts/src/costs/schemas.ts`,
`packages/contracts/openapi/v1.json` (regeneriert),
`packages/contracts/test/openapi-drift.test.ts` (nur ausführen)

**Schritt 1:** Beide `validTo`-Felder beschreiben:

```ts
  validTo: BusinessDateSchema.nullable().describe(
    "Letzter Tag, an dem diese Satzversion gilt — EINSCHLIESSEND (EYT-95). " +
      "`null` = unbegrenzt. Ein Nachfolger ab dem Folgetag schliesst lueckenlos " +
      "an. Die interne Speicherung ist halboffen; die Umrechnung ist nicht Teil " +
      "des Vertrags.",
  ),
```

**Schritt 2: Rot** — `pnpm --filter @easytree/contracts exec vitest run test/openapi-drift.test.ts`.
Erwartet: FAIL, weil das eingecheckte `v1.json` noch keine `description` trägt.
Genau dafür gibt es diesen Test.

**Schritt 3:** `pnpm --filter @easytree/contracts run openapi:write`

**Schritt 4: Grün** — Drift-Test erneut, plus:

```bash
node -e "const d=require('./packages/contracts/openapi/v1.json');
console.log(d.components.schemas.RateVersionDto.properties.validTo.description);
console.log(d.components.schemas.CreateRateVersionCommand.properties.validTo.description);"
```

Erwartet: zweimal der Beschreibungstext, nicht `undefined`.

**Schritt 5: Committen als C2** — Schema **und** regeneriertes `v1.json`
zusammen. Getrennt vom Semantik-Commit C1, weil der `v1.json`-Diff sonst im
großen Commit untergeht und weil dieser Commit für sich konsistent ist: er
dokumentiert eine Bedeutung, die C1 bereits hergestellt hat.

> **P6 — was im öffentlichen Vertrag NICHT stehen darf.** Der Beschreibungstext
> oben nennt bewusst weder **PostgreSQL** noch **`daterange`** noch die interne
> halboffene Speicherung. Ein API-Vertrag beschreibt **Clientsemantik**, nicht
> die Persistenz des Anbieters. Die Kernaussage ist genau eine Zeile:
>
> > `validTo` = letzter wirksamer Tag, **einschließend**; `null` = unbegrenzt.
>
> Der letzte Halbsatz des Entwurfs („Die interne Speicherung ist halboffen; die
> Umrechnung ist nicht Teil des Vertrags") ist deshalb **zu streichen** — er
> beschreibt die Speicherung, um sie im selben Atemzug für irrelevant zu
> erklären, und lädt genau die Frage ein, die ein Client nie stellen sollte.
> Verbindlicher Text:
>
> ```ts
>   validTo: BusinessDateSchema.nullable().describe(
>     "Letzter Tag, an dem diese Satzversion gilt — einschliesslich. " +
>       "`null` = unbegrenzt. Eine Nachfolgeversion ab dem Folgetag schliesst " +
>       "lueckenlos an; derselbe Tag waere eine Ueberlappung (EYT-95).",
>   ),
> ```

---

### Aufgabe 9 (T8, T9, T11): Was sich NICHT ändern darf

**Dateien:** `apps/api/test/costs/snapshot-immutability.integration.test.ts`,
`apps/api/test/costs/snapshot-http.integration.test.ts`,
`apps/api/test/costs/create-cost-snapshot.use-case.test.ts`

- **T8** — `RATE_NOT_FOUND`/`RATE_AMBIGUOUS` blockieren weiterhin total und
  erscheinen nie als 0,00 €. Die Namen bleiben; nur ihr Ursprung wechselt von
  `effectiveRateVersion` zu `selectRateVersion`.
- **T9** — Idempotenz, Retry und `STALE_ACTIVE_VERSION` sind von der Umrechnung
  unberührt. **Aber:** `anfrageFingerabdruck` (Z. 68–82) hasht `version.validTo`.
  Das ist der **fachliche** Wert, auf beiden Seiten der Änderung konsistent —
  ein Retry mit demselben Körper erzeugt denselben Abdruck. Ein Test hält das
  ausdrücklich fest, weil ein Abdruck über dem umgerechneten Wert hier still
  hätte falsch sein können.
- **T11** — `snapshot-immutability.integration.test.ts:289` benutzt
  `effectiveRateVersion` direkt; auf die neue Auswahl umstellen. Die geprüften
  **Beträge und IDs müssen unverändert bleiben** — das ist der eigentliche
  Regressionsnachweis von Option A.

Befehle, alle mit laufender Datenbank:

```bash
EASYTREE_TENANT_TESTS=required pnpm --filter @easytree/api exec vitest run \
  test/costs/snapshot-immutability.integration.test.ts \
  test/costs/snapshot-http.integration.test.ts
```

> `vitest-silently-skips-missing-files`: ein Pfadfilter ohne Treffer endet mit
> Exit 0. Die gemeldete Dateizahl gegenprüfen — erwartet: 2.

---

### Aufgabe 10: Der Wächter gegen die fünfte Aufrufstelle (A5)

**Datei:** neu `apps/api/test/costs/rate-boundary-single-site.test.ts`

**Die Erstfassung dieses Wächters war falsch und ist zurückgenommen.** Sie
verbot jede `dayBefore`/`dayAfter`-Nutzung im Kostenmodul außerhalb der
Grenzdatei — und hätte damit Aufgabe 4 rot gemacht, die `dayBefore`
berechtigterweise in `rate-succession.ts` einsetzt. Ein Wächter, der den eigenen
Plan verbietet, misst nicht die Invariante, sondern einen Denkfehler.

**Was der Wächter sichert — und nur das:**

> Die Übersetzung zwischen der DB-Grenze `valid_to` und dem fachlichen `validTo`
> findet ausschließlich an der Repository-Grenze statt.

**Was er ausdrücklich NICHT verbietet:** allgemeine Kalenderprimitive.
`dayBefore`, `dayAfter`, `compareLocalBusinessDate`, `parseLocalDate`,
`formatLocalDate` sind Fachrechnung und dürfen überall im Modul stehen. Der
Unterschied ist nicht die Funktion, sondern was sie überquert.

**Die drei Zusicherungen:**

```ts
/**
 * Die Uebersetzung DB-Grenze <-> fachliches validTo hat genau EINE Stelle
 * (EYT-109 D1).
 *
 * Bewusst KEIN Verbot von `dayBefore`/`dayAfter`: das sind Kalenderprimitive,
 * und `rate-succession.ts` braucht `dayBefore` fuer eine rein fachliche Regel.
 * Ein Waechter, der sie generell verbietet, verbietet Fachlogik statt
 * Schichtvermischung — und wuerde die Ablutzsungsregel rot machen, die er
 * schuetzen soll.
 */
```

| # | Zusicherung | Gegenmutation, die sie rot macht |
| --- | --- | --- |
| **W1** | `dbEndeZuValidTo` / `validToZuDbEnde` werden im Produktivcode **nur** in `infrastructure/rate-repository.pg.ts` aufgerufen (Definitionsdatei und `index.ts`-Re-Export ausgenommen). | In `interface/http/costs.controller.ts` eine Zeile `const x = dbEndeZuValidTo(version.validTo);` einfügen → **rot**. Diese Mutation **kompiliert** und passiert alle bestehenden Wächter: `layer-direction` erlaubt `interface(3) → infrastructure(2)`, `module-public-api-only` greift nicht bei modulinternen Pfaden, und `domain-allowlist` erreicht `interface/` nicht. **W1 ist der einzige Wächter, der sie fängt** — die Gegenmutation ist damit nachweislich nicht vakuum. |
| **W2** | Der Spaltenname `valid_to` erscheint im Kostenmodul **nur** unter `infrastructure/` (dort in SQL) — außerhalb ausschließlich in Kommentaren. | In `domain/rate-effectivity.ts` ein Feld `valid_to` einführen oder eine SQL-artige Zeichenkette mit `valid_to` in `application/` ablegen → **rot**. Der Wächter zählt Vorkommen außerhalb von Kommentarzeilen; gemessen ist der Ist-Stand bereits sauber (zwei Treffer, beide in Kommentaren: `cost-snapshot-assembly.ts:156`, `rate-succession.ts:12`). |
| **W3** | `rate-interval-boundary.ts` wird von genau **einer** Produktivdatei importiert. | Einen Import in `application/rate-repository.port.ts` einfügen → **rot**. |

**Was der Wächter NICHT abdecken muss, weil es schon abgedeckt ist.** Ein Import
von `domain/` nach `infrastructure/rate-interval-boundary.ts` fällt bereits am
bestehenden `domain-allowlist` (`rules.ts:113-136`, red-case-belegt in
`architecture-red-case.test.ts`). Diese Hälfte der Invariante hier zu
wiederholen wäre eine zweite Regel für dieselbe Sache — genau die Doppelung, die
dieser Plan beseitigt. **Der neue Wächter deckt deshalb `application/` und
`interface/` ab, die `domain-allowlist` nicht erreicht.**

**Durchführung der Gegenmutation** (gilt für alle drei):
einspielen → Test laufen lassen und die **rote Ausgabe lesen** → zurücknehmen →
Test erneut grün → `git diff -- <die eine Datei>` ist leer.

> `counter-mutation-must-be-executed-not-imagined`: eine benannte Gegenmutation
> zählt erst, wenn sie eingespielt, gemessen und zurückgenommen wurde.
> `revert-evidence-must-be-scoped`: der leere `git diff` wird **auf die mutierte
> Datei eingegrenzt** — global ist er vor dem Commit unerreichbar.
> `scripted-mutations-need-unique-anchors`: `dbEndeZuValidTo(` kommt nach der
> Umsetzung mehrfach vor; die Mutation wird von Hand an einer benannten Zeile
> gesetzt, nicht per `sed`.

> Ohne diesen Wächter ist „es gibt genau eine Umrechnung" eine Behauptung im
> Kommentar, keine Zusicherung. Genau diese Sorte Behauptung hat D1 überhaupt
> erst entstehen lassen.

**Hier endet C1.** Der Repositoryzustand ist jetzt zum ersten Mal seit Aufgabe 1
wieder semantisch geschlossen: eine Lesart, eine Auswahl, eine Übersetzung, ein
Wächter darüber.

```bash
git add apps/api/src/modules/costs/domain/local-business-date-format.ts \
        apps/api/src/modules/costs/infrastructure/rate-interval-boundary.ts \
        apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts \
        apps/api/src/modules/costs/domain/rate-effectivity.ts \
        apps/api/src/modules/costs/domain/rate-succession.ts \
        apps/api/src/modules/costs/domain/rate-version.ts \
        apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts \
        apps/api/src/modules/costs/application/rate-repository.port.ts \
        apps/api/src/modules/costs/index.ts \
        apps/api/test/costs/rate-interval-boundary.test.ts \
        apps/api/test/costs/rate-effectivity.test.ts \
        apps/api/test/costs/rate-boundary-single-site.test.ts \
        apps/api/test/costs/rate-batch-read.test.ts \
        apps/api/test/costs/rate-succession.test.ts \
        apps/api/test/costs/rate-succession.integration.test.ts \
        apps/api/test/costs/rate-http-contract.integration.test.ts \
        apps/api/test/costs/cost-snapshot-assembly.test.ts \
        apps/api/test/costs/snapshot-immutability.integration.test.ts \
        apps/web/test/rate-management.test.tsx
git diff --cached --name-only    # LESEN: exakt 19 Pfade, keiner mehr
git commit -m "fix(costs): EYT-109 D1 — validTo bedeutet oberhalb der Persistenzgrenze den letzten wirksamen Tag"
```

> Nur benannte Pfade stagen und `git diff --cached --name-only` **lesen** — ein
> verzeichnisweites `git add` hat in Sprint 3 zweimal fremde Dateien
> eingesammelt, und dieser Working Tree enthält zehn unversionierte Pfade unter
> `docs/` und `scripts/ops/`, **darunter diese Plandatei** (§12/P12).

---

### Aufgabe 11: Volles lokales Gate

```bash
pnpm exec prettier --check apps packages docs
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
```

Bei jedem Lauf die `Cached:`-Zeile lesen — nur `0 cached` beweist Ausführung.
`pnpm build` an der Wurzel ist **vorbestehend rot** (Turbo-Strict-Env); statt
dessen:

```bash
EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @easytree/web... build
pnpm --filter @easytree/api... build
```

Dann pushen und **die CI lesen**, nicht den lokalen Lauf zitieren:

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600
```

`db-gates` muss **13 Gate-Zeilen** mit `mode=required`, `passed=executed`,
`skipped=0` zeigen — insbesondere `[rate-succession]`, `[rate-timestamp]`,
`[rate-http-contract]`, `[cost-snapshot]`, `[snapshot-immutability]`:

```bash
gh run view <run> --log --job <db-gates-job-id> \
  | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' | sort -u
```

> `db-gates-aborts-at-first-failing-step`: ein roter Schritt lässt alles danach
> ungeprüft. Die **Zeilen** zählen, nicht den grünen Haken.
> `gh-ci-wait-exit-1-can-mean-cancelled`: bei Exit 1 zuerst prüfen, ob ein
> nachgeschobener Push den Lauf verdrängt hat.

---

### Aufgabe 12 (RUNTIME-2): Bestandsdaten-Gate unmittelbar vor dem Merge-Gate

**Identisch zu Aufgabe 0 (RUNTIME-1), erneut ausgeführt** — nicht zitiert, auch
nicht aus RUNTIME-1. Zwischen dem ersten Produktcode-Write und dem Merge liegen
mehrere Tage CI, Review und Nacharbeit; in dieser Zeit läuft die Produktion
weiter.

Dieselben drei read-only-Abfragen, dieselben drei STOP-Bedingungen:

| Befund | Code | Wirkung |
| --- | --- | --- |
| `mit_endtag > 0` | `BLOCKER_DATA_SEMANTICS` | STOP. Diese Zeilen wären unter der neuen Lesart einen Tag früher zu Ende, und ob das die Absicht ihres Erzeugers trifft, kann niemand aus den Daten rekonstruieren. |
| produktive Snapshotzeilen existieren | `BLOCKER_IMMUTABLE_SNAPSHOTS` | STOP. Ein unveränderlicher Snapshot mit einem betroffenen `rateVersionId` braucht einen Betragsvergleich vor/nach, bevor irgendetwas gemergt wird. |
| Migration-0018-Lage unerwartet geändert | `BLOCKER_MIGRATION_STATE` | STOP. Die Grundlage von §5.5 ist entfallen. |

Alle drei grün → weiter zum Task-20-/Merge-Readiness-Gate.
**Keine Produktionsdaten verändern.** Nur `select`.

> Warum zweimal messen und nicht einmal: RUNTIME-1 schützt davor, Code auf einer
> falschen Annahme zu **schreiben**; RUNTIME-2 schützt davor, ihn auf einer
> inzwischen falsch gewordenen Annahme zu **mergen**. Das sind zwei verschiedene
> Risiken, und ein Gate deckt nur eines davon ab.

---

## 10. MIGRATION DECISION

**MIGRATION_REQUIRED = NO — konditional auf RUNTIME-1.**

| Art | Nötig? | Begründung | Bedingung |
| --- | --- | --- | --- |
| **Schema-Migration** | **NO** | Spalten, `check (valid_to > valid_from)`, EXCLUDE-Constraint, Spaltenrechte und UPDATE-Policy behalten exakt ihre Bedeutung. Es wird kein DDL angefasst. | unbedingt |
| **Datenmigration** | **NO** | Die gespeicherten Werte sind bereits korrekte exklusive Grenzen. Die API hat sie nur roh gespiegelt. Eine Verschiebung würde die Daten *kaputtmachen*, nicht reparieren. | **konditional: RUNTIME-1 zeigt `mit_endtag = 0`** |
| **Code-/Boundary-Migration** | **YES** | Genau das ist dieser Plan. | unbedingt |
| **API-Versionierung** | **NO** | Der Vertrag hat die Semantik nie zugesichert (§3B); Typ, Muster und Nullbarkeit bleiben unverändert. Eine `/v2` für eine erstmals dokumentierte Bedeutung wäre Zeremonie ohne Adressat. | **konditional: `ASSUMPTION_NO_UNREGISTERED_EXTERNAL_CONSUMERS` (§5.3) hält** |

**Die beiden konditionalen Zeilen sind der Kern von P11.** Sie sind keine
Feststellungen, sondern Schlussfolgerungen aus zwei Voraussetzungen, die zum
Zeitpunkt dieses Plans nicht `VERIFIED_LIVE` sind:

- Fällt RUNTIME-1 oder RUNTIME-2 mit `mit_endtag > 0` aus, kippt Zeile 2 von
  „NO" auf **offen**, und die Entscheidung liegt beim PO
  (`BLOCKER_DATA_SEMANTICS`).
- Taucht Evidenz für einen externen Konsumenten auf, kippt Zeile 4, und es gilt
  `STOP API_COMPATIBILITY_REVIEW`.

**In diesem Plan wird keine Migration vorbereitet.** Kein Migrationsentwurf, kein
Dateiname, kein DDL im Voraus — auch nicht „nur für den Fall". Eine
vorbereitete Migration im Slice ist eine Einladung, sie anzuwenden, und ihr
Vorhandensein würde die Entscheidung vorwegnehmen, die ausdrücklich beim PO
liegt.

> Der Fehlschluss, den dieser Abschnitt ausdrücklich abwehrt: „die API zeigt
> jetzt etwas anderes, **also** müssen die Daten wandern". Nein — die Daten
> waren richtig, die Darstellung war falsch.

---

## 11. ROLLBACK / FORWARD FIX

**Rollback** ist trivial und vollständig: `git revert` des Merge-Commits (bzw.
`git reset` auf dem Branch vor dem Merge). Es gibt keine DB-Aktion, keine
Datenwanderung und keinen Zustand außerhalb des Repositories. Weil PR #69
**Draft** ist und bleibt, entsteht der Rollback-Bedarf frühestens nach einem
ausdrücklichen Merge-Gate.

**Forward-Fix**, falls sich nach dem Merge zeigt, dass ein bisher unbekannter
Konsument die rohe exklusive Semantik erwartet (`STOP API_COMPATIBILITY_REVIEW`,
§5.3): die Umrechnung sitzt an **vier Aufrufstellen in einer Datei**,
`infrastructure/rate-interval-boundary.ts`, abgesichert durch W1/W3 aus
Aufgabe 10. Ein Zurückdrehen ist ein Vier-Zeilen-Diff plus die Testanpassungen
aus den Aufgaben 2–7 — kein Umbau. Genau deshalb ist die Grenze eine benannte
Datei und nicht ein Dutzend verstreuter `± 1`-Stellen: der Forward-Fix ist
**vorab bezifferbar**, und das ist die eigentliche Rechtfertigung dafür, unter
einer nicht beweisbaren Annahme (§5.3) überhaupt loszulaufen.

**Was ausdrücklich nicht rückholbar wäre:** ein erzeugter Kosten-Snapshot. Er
ist unveränderlich. Deshalb ist der Nachweis aus Aufgabe 9 (T11 — Beträge und
IDs identisch) kein Nice-to-have, sondern die Bedingung, unter der dieser Plan
überhaupt sicher ist.

---

## 12. RISKS

| # | Risiko | Warum es beißt | Gegenmaßnahme im Plan |
| --- | --- | --- | --- |
| R1 | **Doppelte Umrechnung** — `dayBefore` bleibt im Assembly stehen, während das Repository schon übersetzt | Zwei Tage Versatz; die Nahtstelle verschiebt sich, und die Beträge werden still falsch | Aufgabe 5 löscht die Assembly-Konversion; Aufgabe 10 macht eine zweite Stelle statisch rot |
| R2 | **`rateVersionStatus` vergessen** | Eine Version zeigte an ihrem letzten Gültigkeitstag „abgelaufen" — die Anzeige wäre wieder um einen Tag daneben, diesmal andersherum | Aufgabe 5 Schritt 3 stellt `<=` auf `<`; Aufgabe 6 prüft es über HTTP |
| R3 | **Synthetischer Vorgängersatz** in `rate-repository.pg.ts:263-281` bleibt roh | `pruefeAbloesung` bekäme eine DB-Grenze als fachlichen Wert; heute wird nur auf `null` geprüft, morgen vielleicht mehr | Aufgabe 4 Schritt 3 führt auch diesen Weg durch die Naht |
| R4 | **Neue Produktionszeile mit `valid_to`** zwischen Messung und Merge | Genau die Zeile würde still um einen Tag reinterpretiert | **Zwei** Gates: Aufgabe 0 (RUNTIME-1) vor dem ersten Produktcode-Write, Aufgabe 12 (RUNTIME-2) vor dem Merge; beide stoppen bei `mit_endtag > 0` |
| R5 | **Rundlauf-Test allein** als Nachweis | Zwei sich aufhebende Fehler bleiben grün | Aufgabe 3 prüft zusätzlich die rohe Zeile über eine Admin-Verbindung |
| R6 | **Turbo-Replay** liefert eine grüne Zahl ohne Lauf | Eine Gegenmutation, die nach dem Zurücknehmen „rot war" behauptet, ohne je gelaufen zu sein | Aufgabe 11 verlangt `--force` und das Lesen der `Cached:`-Zeile |
| R7 | **Ein-Tages-Satz** wird erst jetzt ausdrückbar (`validTo === validFrom`) | Eine stille Verhaltensänderung: was heute 500 wirft, gelingt morgen | Aufgabe 1 letzter Test hält den Fall ausdrücklich fest; im PR-Text nennen |
| R8 | **Alle Versionen** statt nur der gewählten durchlaufen die Domänenfactory | Ein defekter Nachbarsatz könnte einen bisher erfolgreichen Snapshot blockieren | Aufgabe 5 nennt die Ausweitung; die DB-Checks aus 0013 machen den Zweig unerreichbar |
| R9 | **Playwright läuft nicht in `pnpm test`** | Eine gebrochene `data-testid` fällt erst im CI-Job `auth-journey` auf | Aufgabe 7 ändert keine testids; der Nachweis kommt aus `auth-journey` |
| R10 | **Zwischenstand mit gemischter Semantik wird committet** | Nach Aufgabe 2 liefert das Repository einschließend, während die Montage noch `dayBefore` anwendet — ein Commit dieses Stands friert die doppelte Umrechnung ein und macht `git bisect`, Cherry-Pick und Teil-Revert zu Geldfehlerquellen | §9.0: alle Aufgaben tragen „NICHT committen"; **C1** ist der einzige Semantik-Commit und per Konstruktion geschlossen |
| R11 | **Die Modul-API wird für einen Test erweitert** — `dbEndeZuValidTo`/`validToZuDbEnde` stehen künftig in `costs/index.ts` | Ein Adapterdetail wird öffentlich; ein anderes Modul könnte es importieren und die Übersetzung anderswo wiederholen | Unvermeidbar: `costs-cross-module-public-api-only` verbietet tiefe Testpfade, und der Alternativweg (private Funktionen) verlöre die Unit-Nachweise für Monats-, Jahres- und Schaltjahresrand. W1 aus Aufgabe 10 macht jeden Aufruf außerhalb von `rate-repository.pg.ts` rot — auch aus einem fremden Modul |
| R12 | **Die Verhaltensneutralität ist abgeleitet, nicht gemessen** | §16 Frage 8 rechnet auf Papier nach; ein Denkfehler dort bliebe bis `db-gates` unentdeckt | B13 und B15 messen Beträge und `rateVersionId` gegen eine echte Datenbank; E4 aus Abschnitt 13 ist der benannte Falsifikationspfad |

---

## 13. STRONGEST COUNTERARGUMENT

> „EYT-108 ist abgeschlossen (`Fertig`). Eine Semantikänderung jetzt
> reinterpretiert bestehende Daten oder Clients still um einen Tag. Der PR ist
> 81 Commits schwer und 11/11 grün — der billigere Schnitt wäre, D1 als
> Dokumentationsschuld in ein Folgeticket zu schieben und EYT-109 zu mergen."

**Was daran stimmt.** Die Gefahr ist real und ist die richtige Frage. Eine
Grenzübersetzung, die auf Bestandsdaten trifft, deren Eingabesemantik man nicht
kennt, ist ein Datenfehler mit Ansage — und im Kostenpfad landet er in einem
unveränderlichen Snapshot.

**Warum das Argument hier trotzdem nicht trägt — mit der Evidenzklasse je
Punkt, nicht pauschal „gemessen":**

1. Es sind **keine** Bestandsdaten berichtet, die reinterpretiert würden:
   0 Zeilen mit `valid_to IS NOT NULL` in Produktion.
   → `AGENT_REPORTED_RUNTIME_EVIDENCE` (§5.0). Dieser Punkt trägt das Argument
   **nur, solange RUNTIME-1 und RUNTIME-2 ihn bestätigen**; genau dafür gibt es
   sie. Fällt einer aus, ist dieser Punkt hinfällig und E1 tritt ein.
2. Im geprüften Suchbereich wurde **kein** zweiter Client gefunden, der die rohe
   Semantik konsumiert. → `ASSUMPTION` (§5.3), nicht Beweis. Ein
   unregistrierter Konsument bliebe unsichtbar; die Reaktion darauf ist
   `STOP API_COMPATIBILITY_REVIEW`, nicht eine Korrektur dieses Satzes.
3. EYT-108s Akzeptanzkriterium sagt wörtlich „die Intervallsemantik ist
   **zentral definiert**" — es legt sich gerade **nicht** auf exklusiv fest.
   Zentral definiert ist sie in EYT-95, und zwar einschließend. Option A
   *erfüllt* EYT-108 zum ersten Mal, statt es zu brechen.
4. Die **Beträge ändern sich nicht** (§3D). Das Argument setzt eine
   Verhaltensänderung voraus, die nachweislich nicht eintritt.
5. „Später reparieren" ist hier teurer, nicht billiger: sobald der erste
   produktive Snapshot existiert, ist jede falsche Anzeige historisch
   konserviert und nicht mehr durch eine Satzkorrektur einzuholen.

**Was Option A widerlegen würde — ausdrücklich benannt.** Jeder dieser Befunde
kippt die Empfehlung und erzwingt einen STOP:

- E1: In Produktion existiert **mindestens eine** Zeile mit `valid_to IS NOT NULL`,
  deren Eingabesemantik nicht rekonstruierbar ist. → `BLOCKER_DATA_SEMANTICS`.
- E2: Ein Konsument außerhalb `apps/web` liest oder schreibt `validTo`
  (Skript, Import, Partner-API, Betriebsprozess). → API-Versionierung statt
  stiller Bedeutungsänderung.
- E3: Migration `0018` ist doch in Produktion angewendet **und** es existieren
  Snapshotzeilen, deren `rateVersionId` von einem Satzwechsel betroffen ist.
  → zusätzlicher Betragsvergleich vor/nach, bevor irgendetwas gemergt wird.
- E4: Ein Test zeigt, dass `selectRateVersion` und die heutige Auswahl an
  irgendeinem Tag **unterschiedliche** Versionen wählen. → dann ist die
  Verhaltensneutralität falsch, und der Schnitt muss neu bewertet werden.
- E5: Eine PO-Quelle nach dem 15.08.2026 ersetzt die einschließende
  EYT-95-Semantik durch eine exklusive Oberfläche. → Option C.

---

## 14. FAILURE CHAIN

```
falsche Grenzkonvertierung (oder eine vergessene / eine doppelte)
  -> am Wechseltermin gilt der falsche Stundensatz
  -> die Tagesposition traegt einen falschen Betrag
  -> die Tages- und Gesamtsumme sind falsch
  -> `POST /kosten/snapshots` friert den falschen Betrag ein
  -> der Snapshot ist unveraenderlich (kein UPDATE-Recht, kein DELETE-Recht)
  -> eine spaetere Satzkorrektur repariert ihn NICHT
  -> der Excel-Export (EYT-110) traegt den Fehler nach draussen
  -> und niemand sucht nach einer Zeile, die vollstaendig aussieht
```

Der letzte Schritt ist der teuerste und derselbe, den `rate-version.ts` im
Kopfkommentar für den Nullbetrag beschreibt: **ein falscher Betrag ist teurer als
eine sichtbare Blockade**, weil niemand nach ihm sucht.

Die Kette wird an drei Stellen unterbrochen: Aufgabe 1 (die Umrechnung ist
richtig, inkl. Monats-, Jahres- und Schaltjahresrand), Aufgabe 10 (es gibt keine
zweite), Aufgabe 9/T11 (die Beträge sind nachweislich identisch geblieben).

---

## 15. MISSING / SOURCE_NEEDED / BLOCKERS

**Keine Blocker.** Alles, was für die Entscheidung nötig war, ist gemessen.

Offen, aber **nicht** blockierend für diesen Plan:

| Punkt | Status |
| --- | --- |
| ~~**EYT-95 als Jira-Ticket** nicht gelesen~~ | **ERLEDIGT (P1).** Am 15.08.2026 direkt aus Jira gelesen; Kommentar 11425 bestätigt die einschließende Semantik wörtlich. Siehe §2. Kein offener Punkt mehr. |
| **Produktionszahlen nicht selbst gemessen** | `AGENT_REPORTED_RUNTIME_EVIDENCE` (§5.0). Bewusst **nicht** in dieser Planungssitzung nachgeholt — die Messung gehört unmittelbar vor den ersten Produktcode-Write (RUNTIME-1, Aufgabe 0), nicht Tage davor, sonst ist sie beim Schreiben schon wieder alt. |
| **Externe Konsumenten nicht ausschließbar** | `ASSUMPTION_NO_UNREGISTERED_EXTERNAL_CONSUMERS` (§5.3). Dauerhaft offen, per Konstruktion nicht schließbar; Reaktion ist `STOP API_COMPATIBILITY_REVIEW`. |
| **Folgeticket für D1** existiert noch nicht | Kommentar 13431 hält fest: „Folgeticket ist noch nicht angelegt." Dieser Plan wird innerhalb EYT-109 ausgeführt (PO-Gate 13533 nennt D1 merge-blockierend für EYT-109), nicht in einem neuen Ticket. **Ein Jira-Schreibvorgang ist in diesem Lauf nicht erfolgt.** |
| **D3** — mehrere Snapshots je Planversion | Unberührt von D1, offene PO-Annahme. |
| Lokale Datenbank nicht verfügbar | Auf dieser Maschine läuft kein Supabase-Stack; die Integrations- und pgTAP-Nachweise entstehen erst in `db-gates`. Das ist die bekannte Lage, keine neue Einschränkung. |
| Task-15-`data-testid`-Abweichung, `.nvmrc`/Node-24, rotes `pnpm build` an der Wurzel | Alle drei vorbestehend und in Kommentar 13431 protokolliert. |

**Selbstprüfung auf die vier genannten Verzerrungen:**

- *Confirmation Bias* — die Empfehlung wurde gegen ihre eigene Falsifikation
  geprüft: die Produktionsabfrage wurde ausgeführt, **bevor** Option A empfohlen
  wurde, und hätte sie gekippt. **Einschränkung, die diese Fassung ergänzt:**
  ausgeführt hat sie eine *frühere Agentensitzung* (§5.0). Der Schutz gegen
  Confirmation Bias ist damit nur so stark wie dieser Bericht — genau deshalb
  steht RUNTIME-1 **vor** dem ersten Produktcode-Write und nicht danach.
- *Sunk Cost* — der D1-Einfriertest wird gelöscht, obwohl er bewusst geschrieben
  wurde. Er hat einen Defekt eingefroren, keine Entscheidung. Dieselbe Prüfung
  gegen diese Fassung selbst: der Wächter aus Aufgabe 10 und die
  Commit-für-Commit-Struktur der Erstfassung waren durchdachte Arbeit und werden
  trotzdem verworfen, weil sie falsch waren (§17, P3/P9).
- *Automation Bias* — 11/11 grüne Pflichtjobs sind hier **kein** Argument: der
  Vertrag trägt keine Semantikaussage, also konnte kein Test sie prüfen. Grün
  hieß nur „konsistent mit sich selbst".
- *Overengineering* — getrennte Typen für DB-Zeile und Fachversion wurden
  erwogen und **verworfen** (§7); an ihre Stelle tritt ein statischer Wächter,
  der dieselbe Zusicherung für ein Zwanzigstel des Aufwands gibt. Gegenprobe in
  die andere Richtung: die zweite neue Datei
  (`domain/local-business-date-format.ts`) ist **kein** Overengineering, sondern
  von `domain-allowlist` erzwungen — ohne sie müsste die Umrechnung entweder in
  `domain/` liegen (P2 verletzt) oder die Kalenderhelfer wären dreifach kopiert.

---

## 16. ADVERSARISCHE SELBSTPRÜFUNG DES PLANS

Die **zehn** vom PO geforderten Fragen, gegen die überarbeitete Fassung geprüft.
Eine frühere Fassung dieses Abschnitts beantwortete nur acht davon; die Fragen 9
und 10 waren im Plan zwar inhaltlich abgedeckt (Aufgabe 9/T9 bzw. §8.1), aber
hier nicht beantwortet — das ist nachgeholt.

**1. Gibt es noch einen Task, dessen eigener Wächter ihn rot machen würde?**
**Nein — der Widerspruch ist behoben.** Der Wächter aus Aufgabe 10 verbietet
keine Kalenderprimitive mehr, nur noch die Übersetzung außerhalb der
Repository-Grenze. `dayBefore` in `rate-succession.ts` (Aufgabe 4) und
`parseLocalDate` in `rate-effectivity.ts` (Aufgabe 5) sind dadurch erlaubt.
Zweiter beseitigter Selbstwiderspruch: der Boundary-Test importiert jetzt über
die `index.ts` — die Erstfassung importierte einen tiefen Pfad und wäre am
Wächter `costs-cross-module-public-api-only` rot geworden.

**2. Nennt jede WRITE-Datei eine notwendige Verhaltensänderung?**
**Ja.** Die Tabellen in §8 A und B tragen die Spalte „Notwendige
Verhaltensänderung"; wo nur ein Kommentar geändert wird (B6, B7), steht das
ausdrücklich als **„Nur Kommentar"** dort. Vier Dateien, die die Erstfassung als
Write führte, sind nach C gewandert, weil ihre Änderung nicht mehr nötig ist —
allen voran `costs.controller.ts`.

**3. Gibt es zwei Satzauswahlregeln?**
**Nein.** `businessDate < validTo` in `rate-effectivity.ts` wird **gelöscht**.
Danach existiert genau eine Regel: `coversDay`/`exclusiveEnd` in
`packages/domain/src/rate-version.ts`. `effectiveRateVersion` wählt nicht mehr,
sie übersetzt und delegiert. Beide Aufrufer — Controller und Montage — gehen
durch dieselbe Funktion; die Montage konvertiert nicht mehr selbst, weil sie die
geprüfte Version im Ergebnis mitbekommt.

**4. Gibt es zwei DB-boundary conversions?**
**Nein.** `dbEndeZuValidTo`/`validToZuDbEnde` existieren einmal, in
`infrastructure/rate-interval-boundary.ts`, mit vier Aufrufstellen in
`rate-repository.pg.ts`. Die zweite Konversion, die es heute gibt —
`dayBefore(...)` in `cost-snapshot-assembly.ts:164` — wird in Aufgabe 5
**entfernt**; bliebe sie stehen, wäre das Risiko R1 (doppelte Umrechnung).
W1/W3 aus Aufgabe 10 machen eine fünfte Stelle statisch rot, `domain-allowlist`
deckt die Domänenrichtung bereits ab.

**5. Gibt es einen commitbaren Zwischenzustand mit gemischter Semantik?**
**Nein — das war der Zweck der Commit-Umstellung (§9.0).** Die Erstfassung hätte
nach Aufgabe 2 einen Commit erzeugt, in dem das Repository einschließend liefert
und die Montage nochmals `dayBefore` anwendet. Die Aufgaben 1–7, 9 und 10 tragen
jetzt sämtlich „NICHT committen"; der einzige Semantik-Commit ist **C1**, und er
ist per Konstruktion geschlossen. C2 (Vertragstext) und C3 (E2E-Zusicherung)
sind für sich konsistent, weil sie nichts an der Bedeutung drehen.

**6. Ist irgendeine Runtime-/Client-Abwesenheitsbehauptung absolut formuliert?**
**Nein mehr.** „Es gibt keinen externen Client" ist ersetzt durch fünf
abgestufte Aussagen plus `ASSUMPTION_NO_UNREGISTERED_EXTERNAL_CONSUMERS` (§5.3),
und die Produktionszahlen tragen `AGENT_REPORTED_RUNTIME_EVIDENCE` statt
„gemessen" (§5.0). Beide Punkte haben eine benannte STOP-Reaktion.

**7. Plant irgendein Task DDL oder Produktionsdatenmutation?**
**Nein.** Kein Task schreibt eine Migration, keiner erzeugt eine Migrationsdatei,
keiner bereitet eine vor (§10). Die einzigen Berührungen der Produktion sind
RUNTIME-1 und RUNTIME-2, beide ausschließlich `select`. `supabase/migrations/**`
und `supabase/tests/**` stehen in Liste C.

**8. Bleibt die bestehende Snapshotgeldberechnung verhaltensgleich?**
**Ja — und das ist die tragende Zusicherung des ganzen Plans, nicht ein
Nebenprodukt.** Nachgerechnet für den Fall aus Kommentar 13533 (DB: Vorgänger
`[2026-06-01, 2026-07-01)`, Nachfolger `[2026-07-01, ∞)`):

| Stichtag | heute (halboffen auf DB-Werten) | nach C1 (`selectRateVersion` auf fachlichen Werten) |
| --- | --- | --- |
| 30.06. | `validFrom ≤ 30.06.` ✓, `30.06. < 01.07.` ✓ → **Vorgänger** | fachlich `validTo = 30.06.`, `exclusiveEnd = 01.07.`, `30.06. < 01.07.` ✓ → **Vorgänger** |
| 01.07. | `01.07. < 01.07.` ✗ → **Nachfolger** | `01.07. < 01.07.` ✗ → **Nachfolger** |

Identisch, weil beide Wege am Ende dieselbe halboffene Grenze auswerten — der
eine liest sie aus der Datenbank, der andere rechnet sie aus dem fachlichen
Endtag zurück (`dayAfter(30.06.) = 01.07.`). Auch `costOfDuration` bekommt
dieselbe `HourlyRateVersion` wie heute: die Montage baute sie bisher mit
`dayBefore(DB-Wert)`, künftig kommt sie fertig aus der Brücke — derselbe Wert,
eine Umrechnung weniger. Nachweis in der Umsetzung: B13 (Beträge und
`rateVersionId` unverändert), B15 (T11, unveränderliche Snapshots), und die
Liste-C-Läufe von `create-cost-snapshot.use-case.test.ts` und
`snapshot-http.integration.test.ts`.

**Restrisiko dieser Antwort:** Sie ist **abgeleitet**, nicht gemessen — die
Rechnung oben ist Papier. Gemessen wird sie erst durch B13/B15 in `db-gates`.
Fällt E4 aus Abschnitt 13 ein (irgendein Tag, an dem alte und neue Auswahl
auseinandergehen), ist diese Antwort falsch und der Schnitt neu zu bewerten.

**9. Bleibt EYT-108 Option A+ (Retry, Idempotenz, Nebenläufigkeit) unverändert?**
**Ja — die Änderung fasst keine der vier tragenden Mechaniken an.** Gelesen auf
dem Exact-Head, Stelle für Stelle:

| Mechanik | Stelle | Wirkung der D1-Änderung |
| --- | --- | --- |
| Zeilensperre | `rate-repository.pg.ts` `select … for update` | keine — die Sperre steht vor der Umrechnung und sieht nur `id` |
| Genau-einmal-Schließen | `update … where id = $1 and valid_to is null`, `rowCount === 1` | keine — die `where`-Klausel prüft weiterhin auf `null`, und `null` bleibt unter `validToZuDbEnde` `null`; **der gesetzte Wert ist derselbe wie heute** (`validToZuDbEnde(dayBefore(nachfolger.validFrom)) = nachfolger.validFrom`) |
| Idempotenz-Abdruck | `anfrageFingerabdruck` hasht `version.validTo` | keine — gehasht wird der **fachliche** Eingabewert, auf beiden Seiten der Änderung derselbe; ein Retry mit gleichem Körper erzeugt denselben Abdruck (T9 hält das ausdrücklich fest) |
| `STALE_ACTIVE_VERSION` | `expectedActiveVersionId`-Prüfung in `pruefeAbloesung` | keine — vergleicht Ids, keine Datumsgrenzen |

Der einzige berührte Punkt ist der **Rückgabewert** von `pruefeAbloesung`
(`validToDesVorgaengers`, künftig fachlich). Er wird auf dem Weg in die Datenbank
durch `validToZuDbEnde` geführt und ergibt **denselben** gespeicherten Wert —
nachgewiesen dadurch, dass der bestehende Integrationsfall
`rate-succession.integration.test.ts:244` (`valid_to === "2030-07-01"`)
**unverändert grün bleiben muss** (Aufgabe 4, Schritt 4). Genau das ist der
Regressionsnachweis; ginge er rot, wäre EYT-108 berührt und der Schnitt zu
stoppen. Der Gate-Lauf `[rate-succession]` in `db-gates` ist die CI-Ebene
desselben Nachweises.

**10. Ist die UI-Spalte „Gültig bis" danach fachlich wahr?**
**Ja — und zwar ohne eine Zeile Produktivcode in `apps/web`.** Gelesen:
`rate-management.tsx:370` beschriftet die Spalte „Gültig bis",
`rate-management.tsx:388` rendert `{version.validTo ?? "—"}` roh unter
`data-testid="gueltig-bis"`, und `rate-management.tsx:317` beschriftet das
Eingabefeld „Gültig bis (optional)". Alle drei behaupten heute schon die
**einschließende** Lesart; falsch war nicht die Beschriftung, sondern der
gelieferte Wert.

Nach C1 liefert die API für den Fall aus Kommentar 13533 `"2026-06-30"` statt
`"2026-07-01"` — die Anzeige „Gültig bis 30.06." wird damit zu einer wahren
Aussage über eine Version, die am 01.07. nicht mehr gilt. Zusätzlich zeigt
`rateVersionStatus` die Version an ihrem letzten Gültigkeitstag als `aktiv`
statt `abgelaufen` (R2). Nachgewiesen wird beides in B16 (Anzeigefixtures
fachlich, Nahtstellen-Erzählung ohne doppelten und ohne fehlenden Tag) und B17
(Browserreise, `[data-testid="gueltig-bis"]` zeigt den Tag vor dem `validFrom`
des Nachfolgers).

**Einschränkung, die dazugehört:** Eingabeseitig bleibt das Formular ein roher
Durchgriff (`rate-management.tsx:177,193`). Was der Nutzer als „Gültig bis"
eingibt, wird ab C1 auch als letzter wirksamer Tag gespeichert — das ist die
Reparatur. Eine Zeitreise für bereits *angezeigte* Altwerte gibt es nicht, weil
es keine gibt: laut §5.1 trägt keine Produktionszeile ein `valid_to`. Sollte
sich in der Umsetzung zeigen, dass die Komponente doch Produktivcode braucht,
gilt die STOP-Klausel aus §8.1 — das wäre ein Signal, dass die API-Grenze noch
nicht vollständig repariert ist.

---

## 17. WAS SICH GEGENÜBER DER ERSTFASSUNG GEÄNDERT HAT

| Finding | Änderung |
| --- | --- |
| **P1** | EYT-95 live aus Jira gelesen (Kommentar 11425); §2 um Quellenklassifikation `VERIFIED_LIVE` / `AGENT_REPORTED_RUNTIME_EVIDENCE` / `ASSUMPTION` erweitert; der offene Punkt in §15 gestrichen; E5 für den heutigen Stand ausgeschlossen. |
| **P2** | Grenzdatei von `domain/` nach `infrastructure/rate-interval-boundary.ts` verschoben; Kandidatenvergleich in §7.1 mit dem Grund, warum private Funktionen in `rate-repository.pg.ts` verworfen wurden (nicht unit-testbar). Neue Datei `domain/local-business-date-format.ts` für die Kalenderhelfer, weil drei `domain/`-Dateien sie brauchen und `domain-allowlist` ihnen den Zugriff auf `infrastructure/` verbietet. |
| **P3** | Wächter neu definiert: **kein** Verbot von `dayBefore`/`dayAfter`, sondern drei Zusicherungen W1–W3 über die Übersetzung. Für W1 eine Gegenmutation benannt, die nachweislich alle bestehenden Wächter passiert und nur von W1 gefangen wird. Aufgabe 4 darf `dayBefore` benutzen. |
| **P4** | `effectiveRateVersion` **bleibt** als Brücke (Erstfassung wollte sie löschen). Innen: Record → geprüfte `HourlyRateVersion` → `selectRateVersion` → Modulfehlercodes. Ergebnis trägt `version` **und** `checked`, damit die Montage nicht ein zweites Mal konvertiert. Verbotstabelle in Aufgabe 5. |
| **P5** | §8 durch drei disjunkte Listen ersetzt (A: 5 neu, B: 17 geändert, C: 10 read/run-only) mit Zählprobe. Vier Dateien nach C verschoben, darunter `costs.controller.ts`. Zwei Dateien ergänzt, die die Erstfassung nicht führte: `rate-http-contract.integration.test.ts` und `rate-effectivity.test.ts`. |
| **P6** | Vertragstext gekürzt: „letzter wirksamer Tag, einschließend; `null` = unbegrenzt". PostgreSQL, `daterange` und die halboffene Speicherung sind aus dem öffentlichen Vertrag gestrichen. |
| **P7** | „Es gibt keinen externen Client" ersetzt durch fünf abgestufte Aussagen plus `ASSUMPTION_NO_UNREGISTERED_EXTERNAL_CONSUMERS` und `STOP API_COMPATIBILITY_REVIEW`. |
| **P8** | §5.0 eingefügt: Produktionszahlen als `AGENT_REPORTED_RUNTIME_EVIDENCE`. Zwei Pflicht-Gates statt einem — RUNTIME-1 als **Aufgabe 0** vor dem ersten Produktcode-Write, RUNTIME-2 als Aufgabe 12 vor dem Merge-Gate, beide read-only mit drei STOP-Bedingungen. |
| **P9** | Commitstrategie §9.0: von ~9 Commits auf **1–3**. Jede Aufgabe trägt jetzt „NICHT committen"; C1 ist der einzige Semantik-Commit, mit benannter Stageliste und `git diff --cached --name-only`-Lesepflicht. |
| **P10** | UI-Klausel §8.1: `rate-management.tsx` in Liste C, Tests dürfen geändert werden, Produktivcode nicht; bei Bedarf **STOP mit Begründung** statt stiller Scope-Erweiterung. |
| **P11** | §10 als konditionale Entscheidung neu gefasst: Schema NO, Daten NO **konditional auf RUNTIME-1**, Boundary-Code YES, API-Versionierung NO **konditional auf der dokumentierten Annahme**. Ausdrücklich: keine Migration vorbereiten. |
| **P12** | Ablagestatus `DERIVED_NONCANONICAL` im Kopf; Warnung an der C1-Stageliste, dass diese Plandatei unversioniert im Working Tree liegt und nicht in PR #69 geraten darf. |
| — | Neuer Abschnitt 0 (Ausführungsvorbehalt): isolierter Worktree auf dem dann aktuellen Remote-PR-Head ist für die Umsetzung verbindlich. |

### 17.1 Revision R2 (15.08.2026) — Nachprüfung der P1–P12-Fassung

Die Fassung oben trug bereits das Verdikt `REVISED_PLAN_READY_FOR_PO_REVIEW`.
**Ein Plan, der sich selbst für fertig erklärt, ist ein Anspruch, kein Beleg** —
diese Revision hat ihn deshalb gegen Jira und das Repository nachgemessen, statt
ihn fortzuschreiben. Ergebnis: die Architektur (P2, P3, P4), der Wächterentwurf,
die Commitstrategie und sämtliche **Zeilenanker** halten der Nachmessung stand;
gefunden wurden fünf Mängel, alle in der *Evidenzsprache* und in *Zählungen*,
keiner in der Konstruktion.

| # | Befund | Korrektur |
| --- | --- | --- |
| **R2-1** | §7 Punkt 2 sagte weiterhin absolut „**Kein externer Client** konsumiert oder schreibt `validTo`" — ein Rest der Erstfassung, den P7 in §5.3 zwar beseitigt hatte, aber nicht in der **Empfehlung**. Eine Empfehlung, die sich auf einen absoluten Satz stützt, hebt die abgestufte Fassung faktisch wieder auf. | Punkt 1 und 2 tragen jetzt ihre Evidenzklasse (`AGENT_REPORTED_RUNTIME_EVIDENCE` bzw. `ASSUMPTION`) samt STOP-Reaktion. |
| **R2-2** | §13 leitete mit „**jeder Punkt gemessen**" ein und nannte dann Produktionszahlen, die nach §5.0 gerade **nicht** `VERIFIED_LIVE` sind. Das ist derselbe Fehler wie P8, eine Sektion weiter unten. | Einleitung und die Punkte 1/2 tragen jetzt die Evidenzklasse je Punkt; Punkt 1 ist ausdrücklich an RUNTIME-1/2 gebunden. |
| **R2-3** | Überschrift „### B. MODIFY FILES (**16**)" widersprach den 17 Einträgen B1–B17, der Zählprobe („17 geänderte") und der P5-Zeile in §17. Bei einer Liste, deren Zweck „jede Datei genau einmal" ist, ist eine falsche Anzahl kein Schönheitsfehler. | Überschrift auf **(17)** korrigiert; Zählprobe und §17 waren bereits richtig. |
| **R2-4** | „Gemessen: **alle 21 Testdateien** unter `apps/api/test/costs/`" beschrieb das Verzeichnis falsch — es enthält **24** Testdateien, von denen 21 den Barrel importieren und **drei** das Kostenmodul gar nicht (darunter B14 `rate-http-contract.integration.test.ts`, das über `AppModule`/HTTP fährt). | Absatz neu gemessen und umformuliert; der tragende Befund ist die **Null** bei den tiefen Pfaden, nicht die 21. Zusätzlich exakte Anker (`costs-rules.ts:746`, `architecture.test.ts:34-37`). |
| **R2-5** | §16 beantwortete **acht** der **zehn** vom PO geforderten Selbstprüfungsfragen. Die Fragen 9 (EYT-108 A+ unberührt) und 10 (UI fachlich wahr) waren im Plan inhaltlich abgedeckt, aber im Audit nicht beantwortet — ein Audit mit Lücke ist genau die Sorte grüner Haken, die dieser Plan sonst bekämpft. | §16 um die Fragen **9** und **10** ergänzt, beide mit gelesenen Stellen und benanntem Regressionsnachweis (`rate-succession.integration.test.ts:244`, B16/B17). |

**Was in R2 nachgemessen wurde und unverändert bleibt** — als Ausschluss eines
stillen Fehlers, nicht als Lob:

- **P1 zweifach `VERIFIED_LIVE`:** EYT-95 erneut aus Jira gelesen; Zitat, Status,
  Änderungsdatum und Kommentarzahl stimmen (§2, Kasten „Zweite Lesung").
- **Alle Zeilenanker aus §2/§3 gegen den Exact-Head geprüft** und exakt
  bestätigt: `rate-effectivity.ts:45` (`businessDate < version.validTo`) und
  `:58` (`<=`), `rate-succession.ts:88`, `cost-snapshot-assembly.ts:143/164` und
  die privaten Helfer bei `237`/`253`, `rate-repository.pg.ts:97/104/273/289/305`,
  `costs.controller.ts:206/254/638/645`, `schemas.ts:80/102` (beide **ohne**
  `.describe()`), `rate-repository.port.ts:50`,
  `rate-management.tsx:177/193/317/370/388`, sowie die Testanker
  `rate-batch-read:309-310`, `rate-succession.test:51`,
  `cost-snapshot-assembly.test:149`, `rate-management.test.tsx:63/71`,
  `snapshot-immutability:289`, `rate-succession.integration:244`.
- **W1 ist nachweislich nicht vakuum:** `LAYER_RANK` ist gelesen
  (`rules.ts:68-73`, `domain:0, application:1, infrastructure:2, interface:3`)
  und `layer-direction` erlaubt wegen `if (toRank <= fromRank) return null`
  (`rules.ts:174`) tatsächlich `interface → infrastructure`. Die für W1 benannte
  Gegenmutation im Controller passiert diesen Wächter also wirklich.
- **W2 ist exakt gemessen:** `valid_to` erscheint im Kostenmodul außerhalb von
  `infrastructure/` an genau zwei Stellen, beide Kommentare
  (`cost-snapshot-assembly.ts:156`, `rate-succession.ts:12`).
- **A4 ist ein echter Befund:** `effectiveRateVersion`/`rateVersionStatus`
  kommen unter `apps/api/test/` ausschließlich in
  `snapshot-immutability.integration.test.ts` vor (6 Treffer, eine Datei).
- **`dayBefore` hat im Produktivcode genau einen Aufrufer**
  (`cost-snapshot-assembly.ts:164`); die Gegenmutationen in
  `packages/domain/test/money-rate.test.ts:1082-1137` existieren.
- **Die fünf NEW FILES existieren noch nicht**, alle 26 Pfade aus B und C
  existieren. Kein Pfad in zwei Listen.
- **§5.3 stimmt:** die Dateiliste zu `employee_rate_versions` ist vollständig und
  enthält keinen zweiten Kosten-API-Client.

---

## 18. FINAL VERDICT

**REVISED_PLAN_READY_FOR_PO_REVIEW**

Stand nach Revision **R2** (Nachprüfung der P1–P12-Fassung, §17.1): fünf Mängel
gefunden und behoben, alle in Evidenzsprache und Zählungen — zwei absolute
Restaussagen (§7, §13), eine falsche Listenanzahl, eine falsche
Verzeichnismessung, zwei fehlende Auditfragen. Die Architektur (Boundary in
`infrastructure/`, eine Satzauswahl über die Brücke, Wächter W1–W3,
Commitschnitt C1–C3) ist unverändert und hat der Nachmessung standgehalten.

Kein Produktcode geändert. Keine Migration erzeugt oder vorbereitet. Kein
`git add`, kein Commit, kein Push. PR #69 unverändert (OPEN, Draft, Head
`40123711eaabc90d9a37c4dd65b2c2d56abd5211`). Kein Jira-Schreibvorgang — EYT-95
wurde ausschließlich **gelesen**. Kein Merge.

**RUNTIME-1 wurde am 15.08.2026 um 23:40 CEST ausgeführt** — read-only als
`supabase_read_only_user`, ausschließlich `select`. **Keine Produktionsdaten
verändert.** Alle drei STOP-Bedingungen PASS (Protokoll §5.0): `mit_endtag=0`,
`public.cost_snapshots` existiert nicht, Migration `0018` nicht angewandt (17 von
18 Dateien angewandt, lückenlos die ersten 17). Die Zahlen in §5.1/§5.5 sind
damit `VERIFIED_LIVE` statt `AGENT_REPORTED_RUNTIME_EVIDENCE`; die konditionale
Zeile „Datenmigration NO" in §10 ist für diesen Zeitpunkt aufgelöst.
**Aufgabe 1 ist freigegeben.**

**RUNTIME-2 (Aufgabe 12) bleibt ungelaufen** und ist unverändert Bedingung für
die Merge-Readiness — der Befund oben gilt für einen Zeitpunkt, nicht für einen
Zeitraum (Risiko R4).

Geändert wurde in diesem Lauf **genau eine Datei**, unversioniert und
absichtlich nicht auf GitHub:
`docs/plans/2026-08-15-eyt-109-d1-validto-semantik.md`.
