# EYT-109 — Task 19 Gegenmutationsnachweis

**Basis**

- PR: [#69](https://github.com/DYAI2025/EasyTree/pull/69), Branch `feat/eyt-109-daily-plan-cost-snapshot`
- Akzeptierter Ausgangsstand: `9be7b457e0a132cba0b3e716d0642239367b8dff` (CI `31685599719`, 11/11)
- Datum: 13.08.2026, Ticket EYT-145
- Jede Gegenmutation lebt ausschliesslich in einem **Wegwerfzustand**: entweder in
  einem uncommitteten Arbeitsstand, der nach der Messung zurueckgenommen wurde, oder
  auf einem Wegwerf-Branch mit eigenem Wegwerf-PR, der ungemergt geschlossen wurde.
  Auf `feat/eyt-109-daily-plan-cost-snapshot` liegt **keine** davon.
- Massgeblich fuer die Definitionen ist die Matrix in
  `docs/plans/2026-08-08-eyt-109-tageskosten-snapshot.md`, Abschnitt „Task 19".

| GM  | Definition (Kurzform)                                                    | Evidenzquelle                      | Zieltest ausgefuehrt                                                              | Beobachtetes Rot                                                      | Status         |
| --- | ------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| GM1 | `and published_at is not null` aus `publishedAssignments` entfernt       | Wegwerf-PR #73, Lauf `31694802980` | `[planning-published-reads] mode=required executed=9 passed=8 skipped=0`          | „lehnt eine Entwurfsversion ab": `expected true to be false`          | VERIFIED_EXACT |
| GM2 | `POST /kosten/snapshots` von `costs.calculate` auf `costs.read`          | lokal, Arbeitsstand auf `9be7b45`  | `snapshot-http.test.ts`, 22 Faelle ausgefuehrt                                    | H10: `expected 403 "Forbidden", got 201 "Created"`                    | VERIFIED_EXACT |
| GM3 | `WORKSITE_NOT_IN_ORG` entfernt **und** Baustellen-FK in 0018 einspaltig  | Wegwerf-PR #74, Lauf `31694805896` | `unit-tests` (Fall 6) **und** pgTAP `0013` (2 von 34)                             | Fall 6: `expected [ [] ] to deeply equal []`; pgTAP A4/A5             | VERIFIED_EXACT |
| GM4 | `effectiveRateVersion(...)` durch „groesstes `validFrom`" ersetzt        | lokal, Arbeitsstand auf `9be7b45`  | `cost-snapshot-assembly.test.ts`, 18 Faelle ausgefuehrt                           | „waehlt vor der Nahtstelle den Vorgaenger": `'bbbb…'` statt `'aaaa…'` | VERIFIED_EXACT |
| GM5 | Snapshot-Lesepfad rechnet aus AKTUELLEN Saetzen statt zu lesen           | Wegwerf-PR #72, Lauf `31655413717` | `[snapshot-immutability] mode=required executed=3 passed=2 skipped=0`             | `rateVersionId`: `'615f64a1-…'` statt `'00000000-…-0000006d1431'`     | VERIFIED_EXACT |
| GM6 | `allocateAcrossLocalDays` kohaerent auf UTC-Tage statt Organisationszone | lokal, Arbeitsstand auf `9be7b45`  | Beispiel- **und** Eigenschaftssuite, 18 Faelle ausgefuehrt                        | Ortstagszuordnung und Verankerung erster/letzter Tag                  | VERIFIED_EXACT |
| GM7 | `costOfDuration(...)` durch `Math.round(satz * ms / 3_600_000)` ersetzt  | lokal, Arbeitsstand auf `9be7b45`  | `cost-snapshot-assembly.test.ts`, 18 Faelle ausgefuehrt                           | `expected 72057594037927936n to be 72057594037927944n`                | VERIFIED_EXACT |
| GM8 | `app.is_runtime_channel()` aus BEIDEN insert-Policies in 0018 entfernt   | Wegwerf-PR #75, Lauf `31694808099` | pgTAP `0013` (7 von 34) **und** `[cost-snapshot] executed=11 passed=10 skipped=0` | Fall 8: `expected null to be '42501'`                                 | VERIFIED_EXACT |
| GM9 | `grant update … to authenticated` auf beiden Snapshot-Tabellen ergaenzt  | Wegwerf-PR #76, Lauf `31694809822` | pgTAP `0013` (4 von 34) **und** `[cost-snapshot] executed=11 passed=10 skipped=0` | Fall 3: `expected null to be '42501'`                                 | VERIFIED_EXACT |

---

## GM1 — Verbindlichkeitswaechter der Planversion

- **Geaendertes Verhalten:** `publishedAssignments` fragt `plan_versions` ohne
  `and published_at is not null` ab; eine Entwurfsversion gilt damit als
  verbindlicher Stand und wird zur Kostengrundlage.
- **Datei im Wegwerfzustand:** `apps/api/src/modules/planning/infrastructure/planning-window.repository.ts` (1 Datei, −1 Zeile)
- **Wegwerfzustand:** Branch `eyt145/gm1-wegwerf`, Head `580ddbc96bcb675c0eff6ca7c9abec557402349b`, PR #73 (geschlossen, ungemergt)
- **Lauf:** `31694802980`, `db-gates` scheitert am Schritt „Planungslesungen fuer
  veroeffentlichte Staende (fail-closed, zwei Verbindungen, EYT-109)". Kein
  frueherer Schritt bricht ab; die acht vorangehenden Gates melden
  `passed = executed`, `skipped=0`.
- **Uebersetzung:** `tsc --noEmit` fuer `@easytree/api` beendet sich mit 0;
  `typecheck` und `unit-tests` sind im Lauf gruen.
- **Ausfuehrung des Zieltests:** `[planning-published-reads] mode=required executed=9 passed=8 skipped=0`
- **Fachliches Rot:** `lehnt eine Entwurfsversion ab` —
  `AssertionError: expected true to be false`, gefolgt von
  `[planning-published-reads] fail-closed: 1 von 9 Pflichttests sind nicht bestanden (EYT-109)`.
  Der Entwurf lieferte `ok: true` statt `PLAN_NOT_PUBLISHED`.
- **Abwesenheit auf dem PR-Branch:** `git show 9be7b45:…/planning-window.repository.ts | grep -c 'and published_at is not null'` = `1`.

## GM2 — Recht der Snapshot-Erzeugung

- **Geaendertes Verhalten:** `POST /kosten/snapshots` verlangt `costs.read` statt
  `costs.calculate`; eine ausschliesslich lesende Person darf einen revisionsfesten
  Stand einfrieren.
- **Datei im Wegwerfzustand:** `apps/api/src/modules/costs/interface/http/costs.controller.ts` (1 Zeile)
- **Wegwerfzustand:** uncommitteter Arbeitsstand auf `9be7b45`, danach
  `git checkout --` und `git status --porcelain` leer.
- **Kommando:** `pnpm --filter @easytree/api exec vitest run test/costs/snapshot-http.test.ts`
- **Uebersetzung:** `tsc --noEmit` Exit 0.
- **Ausfuehrung:** 22 Faelle, 2 rot, 20 gruen (Ausgangsstand: 22 gruen).
- **Fachliches Rot:** `H10 — POST ohne costs.calculate wird abgelehnt, auch mit costs.read`:
  `expected 403 "Forbidden", got 201 "Created"`. Zusaetzlich `H12`: das
  protokollierte Recht lautet `costs.read` statt `costs.calculate`.
- **Abwesenheit auf dem PR-Branch:** `grep -c '"costs.calculate"'` im Controller = `1`.

## GM3 — Fremde Baustelle, zwei Ebenen

- **Geaendertes Verhalten:** (A) der Use-Case prueft den Baustellenfilter nicht mehr
  gegen die Bezeichnungen der Planversion; (B) beide mandantengebundenen FKs
  `(worksite_id, org_id) -> worksites (id, org_id)` in Migration `0018` sind durch
  einspaltige `(worksite_id) -> worksites (id)` ersetzt. Erst beide Ebenen zusammen
  lassen den verbotenen Zustand zu.
- **Dateien im Wegwerfzustand:** `apps/api/src/modules/costs/application/create-cost-snapshot.use-case.ts`,
  `supabase/migrations/20260809120000_0018_cost_snapshots.sql`
- **Wegwerfzustand:** Branch `eyt145/gm3-wegwerf`, Head `109890576bd981d4d872eca260d550c4dfb7efe7`, PR #74 (geschlossen, ungemergt)
- **Lauf:** `31694805896`. Keine CI-Aenderung noetig.
- **Uebersetzung/Anwendung:** `tsc --noEmit` Exit 0, `typecheck` gruen; die Migration
  wird von `supabase db reset` fehlerfrei angewandt (der pgTAP-Schritt danach ist der
  rote, nicht der Reset).
- **Ebene A, ausgefuehrt und rot:** Job `unit-tests`,
  `create-cost-snapshot.use-case.test.ts > Fall 6 — fremde Baustellen-Id ergibt WORKSITE_NOT_IN_ORG,
ohne Satzlesung und ohne Schreiben`: `AssertionError: expected [ [] ] to deeply equal []`
  — es wurden Saetze gelesen, statt vorher zu blockieren. Zusaetzlich rot:
  `snapshot-http.test.ts > H7 — fremde Baustelle wird fail-closed abgelehnt`.
- **Ebene B, ausgefuehrt und rot:** `db-gates`, pgTAP `supabase/tests/0013_cost_snapshots.sql`,
  `Failed 2/34`: Test 4 („A4 die Positionen tragen genau fuenf FKs, drei davon
  mandantengebunden") und Test 5 („A5 der Snapshotkopf hat KEINEN FK auf
  plan_versions oder assignments") vermissen beide
  `worksite_id,org_id -> public.worksites(id,org_id)`.
- **Anmerkung zur Abdeckung:** einen INTEGRATIONSFALL, der eine FREMDE Baustelle auf
  Datenbankebene schreibt, gibt es in der Suite nicht (der Cross-Tenant-Fall in
  `cost-snapshot.integration.test.ts` Fall 2 nutzt eine fremde SATZVERSION). Der
  Detektor fuer Ebene B ist deshalb die strukturelle pgTAP-Zusicherung, nicht ein
  Verhaltenstest. Das ist eine Feststellung, keine Behauptung ueber Verhalten.
- **Abwesenheit auf dem PR-Branch:** `grep -c 'problem: WORKSITE_NOT_IN_ORG'` = `1`;
  `grep -c 'foreign key (worksite_id, org_id)'` in `0018` = `2`.

## GM4 — Wirksamer Satz, nicht neuester Satz

- **Geaendertes Verhalten:** die Montage waehlt die Satzversion mit dem groessten
  `validFrom`, unabhaengig vom Leistungsdatum.
- **Datei im Wegwerfzustand:** `apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts`
- **Wegwerfzustand:** uncommitteter Arbeitsstand auf `9be7b45`, danach zurueckgenommen,
  `git status --porcelain` leer.
- **Kommando:** `pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts`
- **Uebersetzung:** `tsc --noEmit` Exit 0.
- **Ausfuehrung:** 18 Faelle, 3 rot, 15 gruen (Ausgangsstand: 18 gruen).
- **Fachliches Rot:** `waehlt vor der Nahtstelle den Vorgaenger, nicht den neuesten Satz` —
  `expected 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' to be 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`.
  Ebenfalls rot: `blockiert bei zwei gueltigen Saetzen` und `waehlt den Satz je Ortstag`.
- **Abwesenheit auf dem PR-Branch:** `grep -c 'effectiveRateVersion(saetze, tag)'` = `1`.

## GM5 — Historischer Lesepfad

- **Geaendertes Verhalten:** `PgCostSnapshotRepository::read` ersetzt den
  gespeicherten `rate_version_id` und den gespeicherten Betrag durch die HEUTE
  wirksame Satzversion (Join auf `employee_rate_versions`, Betrag neu gerechnet).
- **Dateien im Wegwerfzustand:** `apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts`
  sowie ein temporaeres `continue-on-error` auf dem Schritt „Snapshot-HTTP-Naht",
  damit `db-gates` das Unveraenderlichkeitsgate ueberhaupt erreicht. **Keine
  Testdatei geaendert.**
- **Wegwerfzustand:** Branch `throwaway/eyt-143-gegenmutation`, Head
  `e4801e34f9b5df723576042b68efebc8d40fbe41`, PR #72 (geschlossen, ungemergt)
- **Lauf:** `31655413717`
- **Uebernahme auf den heutigen Ausgangsstand:** die mutierte Datei ist zwischen der
  Basis jenes PR (`68c573e8`, Vorfahre von `9be7b45`) und `9be7b45` unveraendert —
  `git diff 68c573e8 9be7b45 -- <Datei>` ist leer. Die Messung gilt damit fuer den
  heutigen Ausgangsstand.
- **Ausfuehrung des Zieltests:** `[snapshot-immutability] mode=required executed=3 passed=2 skipped=0`
- **Fachliches Rot:** `eine rueckwirkend wirksame V2 laesst Zeile, Antwort und Summe unveraendert` —
  `expected '615f64a1-e8ea-49c4-9c80-659490ff9d29' to be '00000000-0000-4000-8000-0000006d1431'`
  auf `positions[0].rateVersionId`; also der aktuelle statt des eingefrorenen Satzes.
- **Abwesenheit auf dem PR-Branch:** im Repository-Lesepfad steht kein Join auf
  `employee_rate_versions`; die einzige Fundstelle des Namens ist der Kommentar
  „kein Join auf `employee_rate_versions`".

## GM6 — Ortstag statt UTC-Tag

- **Geaendertes Verhalten:** `allocateAcrossLocalDays` bestimmt Tag **und** Tagesgrenze
  kohaerent in UTC statt in der Organisationszone. Bewusst keine halbe Fassung: eine
  widerspruechliche Mutation zerbraeche am Monotoniewaechter und maesse diesen statt
  der Regel.
- **Datei im Wegwerfzustand:** `packages/domain/src/local-day-allocation.ts`
- **Wegwerfzustand:** uncommitteter Arbeitsstand auf `9be7b45`, danach zurueckgenommen,
  `git status --porcelain` leer.
- **Kommando:** `pnpm --filter @easytree/domain exec vitest run test/local-day-allocation.test.ts test/local-day-allocation.property.test.ts`
- **Uebersetzung:** `tsc --noEmit` fuer `@easytree/domain` Exit 0.
- **Ausfuehrung:** 18 Faelle, 13 rot, 5 gruen (Ausgangsstand: 18 gruen).
- **Fachliches Rot, beide benannten Detektoren:**
  - Beispiel `ordnet einer UTC-Zuordnung widersprechend dem ORTSTAG zu`:
    `expected [ { tag: '2026-08-02', … }, … ] to deeply equal [ { tag: '2026-08-03', stunden: 8 } ]`
  - Eigenschaft `erzeugt keinen leeren Anteil und verankert ersten und letzten Tag am Ortstag`:
    `Property failed after 2 tests`, Counterexample `[["Australia/Lord_Howe",1767272339996],60005]`,
    `expected { year: 2026, month: 1, day: 1 } to deeply equal { year: 2026, month: 1, day: 2 }`
- **Abwesenheit auf dem PR-Branch:** `grep -c 'createTimeZone'` in
  `local-day-allocation.ts` = `0`; die Zone kommt weiterhin als Parameter.

## GM7 — Exakte Geldregel

- **Geaendertes Verhalten:** statt des exakten `bigint`-Produkts mit
  `roundHalfUp` rechnet die Montage `BigInt(Math.round(Number(satz) * Number(ms) / 3_600_000))`.
  Die Fassung ist bewusst so gebaut, dass sie uebersetzt — ein `Cannot mix BigInt`
  waere ein Scheinrot aus einem Absturz.
- **Datei im Wegwerfzustand:** `apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts`
- **Wegwerfzustand:** uncommitteter Arbeitsstand auf `9be7b45`, danach zurueckgenommen,
  `git status --porcelain` leer.
- **Uebersetzung:** `tsc --noEmit` Exit **0** — die Mutation ist uebersetzbar.
- **Ausfuehrung:** 18 Faelle, 1 rot, 17 gruen.
- **Fachliches Rot:** `rechnet oberhalb von 2^53 exakt, statt ueber Gleitkomma zu driften` —
  `expected 72057594037927936n to be 72057594037927944n`. Die Differenz ist reine
  Gleitkommadrift, nicht Rundungsrichtung.
- **Abwesenheit auf dem PR-Branch:** `grep -c 'costOfDuration(version.version, anteil.quantity)'` = `1`.

## GM8 — Kanalgrenze beim Einfuegen

- **Geaendertes Verhalten:** `app.is_runtime_channel()` steht in KEINER der beiden
  insert-Policies von `0018` mehr; ein angemeldetes Mitglied mit `costs.calculate`
  kann ueber die Data-API einen Snapshot anlegen.
- **Dateien im Wegwerfzustand:** `supabase/migrations/20260809120000_0018_cost_snapshots.sql`
  und `.github/workflows/ci.yml`.
- **Temporaerer CI-Eingriff, genau benannt:** `continue-on-error: true` auf den beiden
  Schritten „pgTAP suite (run 1)" und „pgTAP suite (run 2, must be identical)".
  Grund: die pgTAP-Policy-Zusicherung wird unter der Mutation korrekt rot, und
  `db-gates` endete dort — der zweite benannte Zieltest (Kanalfall im
  Integrationstest) waere nie gelaufen. **Kein Zieltest wurde abgeschwaecht.**
- **Wegwerfzustand:** Branch `eyt145/gm8-wegwerf`, Head `ccb135131d389f950eafeb41d9373d7c43a96d47`, PR #75 (geschlossen, ungemergt)
- **Lauf:** `31694808099`
- **Anwendung:** `supabase db reset` laeuft fehlerfrei durch; die Migration ist gueltig.
- **Strukturelles Rot (pgTAP `0013`, 7 von 34):** C2 und C3 („die INSERT-Policy …
  prueft Laufzeitkanal …"), D1 bis D4 (Anlage ausserhalb des Laufzeitkanals gelingt
  und hinterlaesst Zeilen), E1.
- **Verhaltensrot:** `[cost-snapshot] mode=required executed=11 passed=10 skipped=0`,
  `Fall 8 — dieselbe Anlage ausserhalb des Laufzeitkanals wird abgelehnt`:
  `AssertionError: expected null to be '42501'` — es kam ueberhaupt kein Fehler
  zurueck, der Fremdkanal-Insert gelang.
- **Abwesenheit auf dem PR-Branch:** `grep -n 'app.is_runtime_channel()'` in `0018`
  liefert drei Zeilen — 55 (Kopfkommentar), 272 und 290. Die beiden Policyzeilen
  tragen die Bedingung unveraendert an erster Stelle.

## GM9 — Aenderungsrecht auf Snapshots

- **Geaendertes Verhalten:** `grant update on public.cost_snapshots to authenticated`
  und dasselbe fuer `public.cost_snapshot_positions` in `0018`.
- **Dateien im Wegwerfzustand:** `supabase/migrations/20260809120000_0018_cost_snapshots.sql`
  und `.github/workflows/ci.yml`.
- **Temporaerer CI-Eingriff, genau benannt:** dasselbe `continue-on-error` auf den
  beiden pgTAP-Schritten, aus demselben Grund. Kein Zieltest wurde abgeschwaecht.
- **Wegwerfzustand:** Branch `eyt145/gm9-wegwerf`, Head `fd82e0f0a1d88fdc26d675b3a2278f884299a6f2`, PR #76 (geschlossen, ungemergt)
- **Lauf:** `31694809822`
- **Anwendung:** `supabase db reset` laeuft fehlerfrei durch.
- **Strukturelles Rot (pgTAP `0013`, 4 von 34):** B1 und B2 —
  „authenticated traegt auf KEINER Spalte von `cost_snapshots` / `cost_snapshot_positions`
  ein update-Recht".
- **Verhaltensrot (dieselbe Suite):** D5 und D7 — „ein Snapshotkopf / eine Position
  laesst sich nicht aendern".
- **Verhaltens- UND Rechtsrot im Laufzeitgate:**
  `[cost-snapshot] mode=required executed=11 passed=10 skipped=0`,
  `Fall 3 — Unveraenderlichkeit: Verhalten UND fehlendes Recht`:
  `AssertionError: expected null to be '42501'` — der Aenderungsversuch lief ohne
  Fehler durch. Beide vom Ticket geforderten Aspekte sind damit abgedeckt.
- **Nicht erreicht:** der spaetere Schritt „Snapshot-Unveraenderlichkeit gegen
  spaetere Saetze" lief in diesem Lauf nicht mehr, weil `db-gates` bereits am
  Kosten-Snapshot-Gate endete. Das ist keine Luecke — Fall 3 traegt beide Aspekte —,
  aber es ist die Stelle, an der der Lauf abbrach.
- **Abwesenheit auf dem PR-Branch:** `grep -c 'grant update'` in `0018` = `0`.
