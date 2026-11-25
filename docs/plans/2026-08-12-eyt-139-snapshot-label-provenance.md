# EYT-139 — Snapshot-Label-Provenance (Nachweisreparatur): Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Belegen, dass der unveränderlich gespeicherte Kosten-Snapshot die **semantische Herkunft**
beider Bezeichnungen bewahrt — `worksiteLabel` steht in `worksite_label`, `employeeLabel` in
`employee_label` — sodass ein typkorrekter Tausch der beiden benachbarten `text[]`-Parameter in
`PgCostSnapshotRepository` einen benannten Test **rot** macht statt unbemerkt zu bleiben.

**Architecture:** Reine **Nachweisreparatur**. Der Produktionscode ist heute korrekt und wird
**nicht** verändert. Erweitert wird genau eine Datei — `apps/api/test/costs/cost-snapshot.integration.test.ts`,
Fall 1 — um (a) je Position unterscheidbare Bezeichnungen, (b) zwei Rundlauf-Zusicherungen über
`read`, und (c) eine Messung der **gespeicherten Spalten** über die Beobachterverbindung (`postgres`),
weil ein beim Schreiben **und** beim Lesen gleich falscher Tausch sich im Rundlauf sonst aufhebt.
Die Gegenmutationen laufen auf einem **Wegwerf-PR**, nie auf `feat/eyt-109-daily-plan-cost-snapshot`.

**Tech Stack:** Vitest (SWC-Transform), `pg` (zwei echte Verbindungen: `postgres` als Beobachter,
`easytree_app` als Laufzeitkanal), PostgreSQL/Supabase mit RLS, GitHub Actions Job `db-gates`,
pnpm/Turborepo, `gh` CLI.

---

## 0. Verifizierter Ausgangsstand (gemessen 12.08.2026)

| Größe                                        | Wert                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| PR                                           | `#69 — EYT-109: daily personnel cost snapshot`, **Draft**, `MERGEABLE`   |
| Branch                                       | `feat/eyt-109-daily-plan-cost-snapshot`                                  |
| `origin`-Head des Branches                   | `df07d396e86df0a7fca37ceddf1b63d332f890d3` — **kein `HEAD_DRIFT`**       |
| PR-Base                                      | `master`, Tip `b44e38c6bf7e08a2996c2263309001a1304050f2`                 |
| merge-base gegen `origin/master`             | `b44e38c6bf7e08a2996c2263309001a1304050f2`                               |
| ahead/behind gegen `origin/master`           | `0 behind / 61 ahead`                                                    |
| Letzter grüner CI-Lauf auf diesem Head       | `31623352976`, alle 11 Pflichtjobs `success`                             |
| `snapshot-http` / `cost-snapshot` / `p-p-r`  | `executed=7 passed=7 skipped=0` / `11/11/0` / `9/9/0`                    |
| Docker auf dieser Maschine                   | **nicht verfügbar** (`docker info` schlägt fehl) → DB-Suiten laufen NUR in CI |

Reproduktion (erster Schritt jeder Session, siehe Task 0):

```bash
git fetch --all --prune
git ls-remote origin refs/heads/feat/eyt-109-daily-plan-cost-snapshot
gh pr view 69 --json number,headRefName,headRefOid,baseRefName,isDraft,state,mergeStateStatus
git rev-list --left-right --count origin/master...df07d396e86df0a7fca37ceddf1b63d332f890d3
```

---

## 1. Die gemessene Lücke — und warum sie genau hier sitzt

`PgCostSnapshotRepository.create` schreibt alle Positionen mit **einer** Anweisung
(`insert … select … from unnest(...)`). Die beiden Bezeichnungen reisen darin als **zwei
benachbarte, gleich getypte `text[]`-Parameter** — `$5` (`worksite_label`) und `$7`
(`employee_label`):

`apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts:280-286`

```ts
            eingabe.positions.map((position) => position.assignmentId),
            eingabe.positions.map((position) => position.worksiteId),
            eingabe.positions.map((position) => position.worksiteLabel),   // $5
            eingabe.positions.map((position) => position.employeeId),
            eingabe.positions.map((position) => position.employeeLabel),   // $7
```

Ein Tausch von `$5` und `$7` ist:

- **typkorrekt** — beide sind `string[]`, `tsc` sieht nichts;
- **datenbankverträglich** — beide Spalten sind
  `text not null check (length(trim(...)) > 0)` (Migration 0018, Zeilen 172/174), es gibt keinen
  Fremdschlüssel und keine Bedingung, die die Verwechslung bemerkt;
- **heute unentdeckt** — gemessen am Quelltext auf `df07d39`:

| Suite                                                   | prüft Bezeichnungen? | Beleg                                                                                          |
| ------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `test/costs/cost-snapshot.integration.test.ts` (Fall 1)  | **nein**             | prüft `localDate`, `amountMinorUnits`, `durationMilliseconds`, `rateVersionId`, `id.length`      |
| `test/costs/snapshot-http.integration.test.ts` (I1)      | **nein**             | prüft `employeeId`, `worksiteId`, `rateVersionId`, `durationMilliseconds`, `amountMinorUnits`    |
| `test/costs/cost-snapshot-repository.test.ts` (DB-freier Zwilling) | **nein**  | `"Baustelle Nord"`/`"Anna Bauer"` kommen nur in Fixtures vor, in keiner Zusicherung              |

Der Rest der Kette ist bereits abgesichert und wird **nicht** angefasst:
`create-cost-snapshot.use-case.test.ts:285-290` hält genau diese Verwechslung eine Ebene höher fest
(„benachbarte, identisch getypte" Maps), `cost-snapshot-dto.test.ts` deckt
`employeeLabel: position.worksiteLabel` an der HTTP-Naht ab, `planning-facts.adapter.test.ts`
die Faktenlage. Die **einzige** offene Ebene ist die Persistenzgrenze gegen echtes PostgreSQL —
und genau dort setzt dieser Plan an.

### Entscheidung: eine Datei, nicht zwei

Der Nachweis kommt nach `test/costs/cost-snapshot.integration.test.ts`, **nicht** zusätzlich nach
`snapshot-http.integration.test.ts`. Drei Gründe:

1. Es ist die **direkte** Persistenzgrenze — genau die Naht, an der der PO die Lücke benannt hat.
2. Diese Datei besitzt bereits die **Beobachterverbindung** (`admin`, Rolle `postgres`), die für
   den Herkunftsbeweis nötig ist. `snapshot-http.integration.test.ts` hätte sie zwar auch, misst
   aber laut eigenem Kopfkommentar bewusst „die Datenreise" und nicht die Spaltenzuordnung.
3. Jede zusätzliche Zusicherung braucht nach der Hausregel eine **ausgeführte** Gegenmutation.
   Zwei Dateien bedeuteten zwei rote Schritte in `db-gates` — und da die Schritte sequenziell
   laufen und `cost-snapshot` **vor** `snapshot-http` kommt, käme der zweite Beleg im
   Mutationslauf gar nicht mehr zur Ausführung. Ein Beleg, der nicht läuft, ist keiner.

### Warum der Rundlauf allein nicht genügt

Ein Tausch, der in `create` **und** in `zuPosition` gleich falsch ist, hebt sich im Rundlauf auf:
geschrieben wird `worksite_label := E`, gelesen wird `worksiteLabel := zeile.employee_label`,
zurück kommt wieder `W`. Der Snapshot in der Datenbank — das unveränderliche Dokument, das der
Export EYT-110 liest — trüge trotzdem die vertauschten Werte. Deshalb steht neben den beiden
Rundlauf-Zusicherungen die Messung der **gespeicherten Spalten** über die Beobachterverbindung.
Diese eine Zusicherung ist der eigentliche Herkunftsbeweis; sie bekommt in Task 5 ihre eigene
Gegenmutation.

---

## 2. Ablauf im Überblick

| Phase | Zustand des Codes                                  | Ort                | Erwartung                                                        |
| ----- | -------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| A     | Mutation M-A (Schreibseite), **keine** Teständerung | Wegwerf-PR, Lauf 1 | **grün** — belegt die Lücke                                       |
| B     | Mutation M-A **+** neue Zusicherungen               | Wegwerf-PR, Lauf 2 | **rot** — Fall 1 fällt, `passed=10 executed=11`                   |
| C     | Mutation M-B (symmetrisch) **+** neue Zusicherungen | Wegwerf-PR, Lauf 3 | **rot** — nur die Spaltenzusicherung fällt, Rundlauf bleibt grün |
| D     | **nur** neue Zusicherungen (Reparatur)             | echter Branch      | **grün** — `executed=11 passed=11 skipped=0`                      |

Alle vier Läufe sind Pflicht. Phase A und B setzt die Aufgabenstellung ausdrücklich voraus;
Phase C ist die Hausregel („jede Zusicherung braucht eine ausgeführte Gegenmutation") auf die
Spaltenzusicherung angewandt.

**Warum ein Wegwerf-PR:** `db-gates` läuft ausschliesslich in CI (kein Docker auf dieser Maschine),
CI feuert nur `on: pull_request`. Mutationen auf `feat/eyt-109-…` würden die Historie eines PRs
verschmutzen, der bereits ein PO-Urteil trägt.

**Warum je Lauf ein eigener Push:** `.github/workflows/ci.yml` setzt
`concurrency: cancel-in-progress: true`, gruppiert nach `github.ref`. Ein zweiter Push bricht den
ersten Lauf ab. **Nie pushen, bevor der vorige Lauf abgeschlossen und gelesen ist.**

---

## Task 0: Arbeitsplatz herstellen und Head prüfen

**Files:** keine Änderung.

**Step 1: Head gegen die Erwartung prüfen — Stoppbedingung `HEAD_DRIFT`**

```bash
git fetch --all --prune
git ls-remote origin refs/heads/feat/eyt-109-daily-plan-cost-snapshot
```

Erwartet, **exakt**: `df07d396e86df0a7fca37ceddf1b63d332f890d3`.
Weicht der Wert ab → **STOPP**, `HEAD_DRIFT` melden, nichts weiter tun.

**Step 2: Losgelösten Arbeitsbaum anlegen**

Der Branch ist möglicherweise bereits in einem alten Arbeitsbaum ausgecheckt
(`git worktree list` zeigte am 12.08.2026 `…/eyt109-wt` auf einem **veralteten** Stand `b8a96a9`).
Deshalb **losgelöst** arbeiten und am Ende explizit auf die Referenz pushen — das vermeidet jeden
Eingriff in fremde Arbeitsbäume:

```bash
git worktree add --detach \
  /private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/<session>/scratchpad/eyt139-prov-wt \
  df07d396e86df0a7fca37ceddf1b63d332f890d3
cd /private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/<session>/scratchpad/eyt139-prov-wt
git rev-parse HEAD
git status --porcelain
```

Erwartet: `df07d396e86df0a7fca37ceddf1b63d332f890d3`, danach **leere** Ausgabe.

**Step 3: Abhängigkeiten und Vorbauten**

`vitest` über `--filter … exec` umgeht Turbos `^build`; ohne `dist/` lesen die Tests einen
**veralteten** Stand oder scheitern beim Auflösen.

```bash
pnpm install --frozen-lockfile
pnpm --filter @easytree/config build
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/domain build
```

Erwartet: alle drei mit Exit 0. Ein roter Build hinterlässt ein benutzbares altes `dist/` —
deshalb den Exit-Code jedes einzelnen Befehls lesen, nicht nur den letzten.

**Step 4: Die Anker der Mutation auf Eindeutigkeit prüfen**

Ein Skript, das stumm zwei Stellen trifft, macht jede Messung wertlos.

```bash
grep -c "eingabe.positions.map((position) => position.worksiteLabel)," \
  apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
grep -c "eingabe.positions.map((position) => position.employeeLabel)," \
  apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
grep -c "    worksiteLabel: zeile.worksite_label," \
  apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
```

Erwartet: dreimal `1`. Jeder andere Wert → **STOPP** und Anker neu wählen.

**Step 5: Kein Commit.** Task 0 ändert nichts.

---

## Task 1: Gegenmutation M-A einspielen (Schreibseite)

**Files:**

- Modify: `apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts:280-286`

**Step 1: Sicherungskopie anlegen**

`git checkout --` stellt den **Commit**-Stand her, nicht den Arbeitsstand. Bei Mutationen an noch
nicht committeten Dateien ist das ein Datenverlust. Hier ist die Datei zwar unverändert, aber die
Gewohnheit bleibt:

```bash
cp apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts /tmp/repo-original.ts
```

**Step 2: Die Mutation (Edit, kein `sed`)**

Ersetze **exakt** diesen Dreizeiler:

```ts
            eingabe.positions.map((position) => position.worksiteLabel),
            eingabe.positions.map((position) => position.employeeId),
            eingabe.positions.map((position) => position.employeeLabel),
```

durch:

```ts
            eingabe.positions.map((position) => position.employeeLabel),
            eingabe.positions.map((position) => position.employeeId),
            eingabe.positions.map((position) => position.worksiteLabel),
```

**Step 3: Die Mutation belegen — das Ergebnis greppen, nicht den Exit-Code lesen**

```bash
diff /tmp/repo-original.ts apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
git diff --stat
```

Erwartet: genau zwei geänderte Zeilen in genau dieser einen Datei.

**Step 4: Beweisen, dass die Mutation kompiliert**

```bash
pnpm typecheck
```

Erwartet: **Exit 0**. Schlägt der typecheck fehl, ist die Mutation nicht typkorrekt und damit nicht
die Mutation, um die es geht → **STOPP**.

**Step 5: Commit auf den Wegwerf-Branch**

```bash
git add apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
git diff --cached --name-only
git commit -m "test(costs): EYT-139 — Gegenmutation M-A: worksiteLabel/employeeLabel beim Schreiben tauschen

WEGWERF-COMMIT. Belegt, dass die heutigen Zusicherungen den Tausch nicht sehen.
Wird nie nach master oder in den Feature-Branch gemergt."
git push origin HEAD:refs/heads/throwaway/eyt-139-label-provenance
```

Erwartet bei `git diff --cached --name-only`: **genau eine** Zeile.

---

## Task 2: Lauf 1 — die Lücke messen (Phase A, Erwartung GRÜN)

**Files:** keine.

**Step 1: Wegwerf-PR als Draft öffnen**

Base ist der Feature-Branch, damit der Diff nur die Mutation zeigt.

```bash
gh pr create --draft \
  --base feat/eyt-109-daily-plan-cost-snapshot \
  --head throwaway/eyt-139-label-provenance \
  --title "WEGWERF — EYT-139 Gegenmutationen Label-Provenance (DO NOT MERGE)" \
  --body "Wegwerf-PR fuer die ausgefuehrten Gegenmutationen zu EYT-139. DO NOT MERGE. Wird nach der Messung geschlossen und der Branch geloescht."
```

**Step 2: Auf CI warten**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600
```

Exit 0 = alle Läufe `success`, 1 = Fehlschlag, 2 = Timeout.

**Step 3: Die Gate-Zeilen unabhängig lesen — nicht dem Exit-Code allein glauben**

```bash
RUN=$(gh run list --repo DYAI2025/EasyTree --commit "$(git rev-parse HEAD)" \
      --json databaseId,conclusion --jq '.[0].databaseId')
echo "Lauf: $RUN"
gh run view "$RUN" --repo DYAI2025/EasyTree --json jobs \
  --jq '.jobs[] | "\(.name)\t\(.conclusion)"'
gh run view "$RUN" --repo DYAI2025/EasyTree --log \
  | grep -E "\[(cost-snapshot|snapshot-http|planning-published-reads)\] (mode=required|Gate OK)"
```

**Erwartet (das IST die Lückenreproduktion):**

- alle 11 Jobs `success`;
- `[cost-snapshot] Gate OK: executed=11 passed=11 skipped=0`;
- `[snapshot-http] Gate OK: executed=7 passed=7 skipped=0`.

**Stoppbedingung:** Ist irgendetwas rot, war die Mutation **nicht** unentdeckt. Dann ist die
Prämisse der Aufgabe falsch → **STOPP**, Befund melden, nichts reparieren.

**Step 4: Kein Commit.**

---

## Task 3: Die Reparatur schreiben (auf der Mutation aufsetzend)

**Files:**

- Modify: `apps/api/test/costs/cost-snapshot.integration.test.ts` (Konstanten + Fall 1)

Die Mutation M-A bleibt in diesem Task **liegen** — dieser Zustand ist Phase B und muss rot werden.

**Step 1: Die vier Bezeichnungskonstanten einfügen**

Direkt **vor** `function position(` (heute Zeile 152, unmittelbar nach der `PLANVERSION`-Konstante
und `runnerAuf`/`neueVerbindung`-Block — maßgeblich ist die Position vor `position()`, nicht die
Zeilennummer):

```ts
/**
 * Bezeichnungen, die einander nicht vertreten koennen (EYT-139).
 *
 * `worksite_label` und `employee_label` reisen als zwei BENACHBARTE, gleich
 * getypte `text[]`-Parameter in dieselbe `insert … select … from unnest(...)`-
 * Anweisung ($5 und $7). Ein Tausch der beiden ist typkorrekt, uebersteht
 * `tsc` und verletzt keine Datenbankbedingung — beide Spalten sind
 * `text not null check (length(trim(...)) > 0)` (Migration 0018). Nur ein Test
 * kann ihn sehen.
 *
 * Die beiden Sorten teilen deshalb kein Wort, und die beiden Positionen tragen
 * VERSCHIEDENE Werte: eine je Sorte wiederholte Bezeichnung maskierte
 * zusaetzlich einen Ordnungsfehler.
 */
const BAUSTELLE_ERSTE = "Baustelle Alpha Nord";
const BAUSTELLE_ZWEITE = "Baustelle Alpha Sued";
const PERSON_ERSTE = "Anna Alpha";
const PERSON_ZWEITE = "Bernd Beispiel";
```

**Step 2: Fall 1 unterscheidbar machen**

In `dbIt("Fall 1 — schreibt Kopf und Positionen und liest sie unveraendert zurueck", …)` den
`positions`-Block ersetzen:

```ts
      positions: [
        position({ localDate: "2026-08-24", amountMinorUnits: 20_000n }),
        position({
          localDate: "2026-08-25",
          amountMinorUnits: 10_000n,
          durationMilliseconds: 14_400_000n,
        }),
      ],
```

durch:

```ts
      positions: [
        position({
          localDate: "2026-08-24",
          amountMinorUnits: 20_000n,
          worksiteLabel: BAUSTELLE_ERSTE,
          employeeLabel: PERSON_ERSTE,
        }),
        position({
          localDate: "2026-08-25",
          amountMinorUnits: 10_000n,
          durationMilliseconds: 14_400_000n,
          worksiteLabel: BAUSTELLE_ZWEITE,
          employeeLabel: PERSON_ZWEITE,
        }),
      ],
```

**Step 3: Die drei Zusicherungen anhängen**

Unmittelbar **nach** der letzten Zeile von Fall 1
(`expect(gelesen.snapshot.positions.every((p) => p.id.length === 36)).toBe(true);`) einfügen:

```ts
    // Herkunft beider Bezeichnungen — nicht blosse Anwesenheit (EYT-139).
    //
    // Der Rundlauf zuerst: er faengt einen Tausch, der NUR beim Schreiben
    // passiert.
    expect(gelesen.snapshot.positions.map((p) => p.worksiteLabel)).toEqual([
      BAUSTELLE_ERSTE,
      BAUSTELLE_ZWEITE,
    ]);
    expect(gelesen.snapshot.positions.map((p) => p.employeeLabel)).toEqual([
      PERSON_ERSTE,
      PERSON_ZWEITE,
    ]);

    // Und dann die GESPEICHERTEN Spalten, ueber die Beobachterverbindung.
    //
    // Diese Zusicherung ist der eigentliche Herkunftsbeweis: ein Tausch, der in
    // `create` UND in `zuPosition` gleich falsch ist, hebt sich im Rundlauf auf
    // — zurueck kaeme das Richtige, waehrend in der Tabelle das Vertauschte
    // steht. Ein Snapshot laesst sich weder aendern noch loeschen (Migration
    // 0018 erteilt kein update- und kein delete-Grant); was hier falsch liegt,
    // bleibt falsch und wandert so in den Export (EYT-110).
    const gespeicherteBezeichnungen = await admin.query<{
      worksite_label: string;
      employee_label: string;
    }>(
      `select worksite_label, employee_label
         from public.cost_snapshot_positions
        where snapshot_id = $1
        order by ordinal`,
      [geschrieben.snapshotId],
    );
    expect(gespeicherteBezeichnungen.rows).toEqual([
      { worksite_label: BAUSTELLE_ERSTE, employee_label: PERSON_ERSTE },
      { worksite_label: BAUSTELLE_ZWEITE, employee_label: PERSON_ZWEITE },
    ]);
```

**Step 4: Den Kopfkommentar der Datei um die Gegenmutation ergänzen**

Der Abschnitt über den Zusicherungen sagt heute nichts zu Bezeichnungen. Ergänze im
Dateikopf-Kommentar, vor dem schliessenden ` */`:

```
 * ## Gegenmutation zur Bezeichnungs-Herkunft (EYT-139)
 *
 * In `cost-snapshot-repository.pg.ts::create` die Parameter $5 und $7 tauschen
 * (`position.worksiteLabel` <-> `position.employeeLabel`) -> Fall 1 rot, in
 * Rundlauf UND Spalten. Denselben Tausch zusaetzlich in `zuPosition`
 * einbauen -> der Rundlauf bleibt gruen und NUR die Spaltenzusicherung faellt.
 * Beide Mutationen sind am 12.08.2026 in `db-gates` ausgefuehrt worden, nicht
 * ausgedacht; die Laufnummern stehen im Plan
 * `docs/plans/2026-08-12-eyt-139-snapshot-label-provenance.md`.
```

**Step 5: Formatierung und Typen prüfen**

```bash
pnpm exec prettier --check apps/api/test/costs/cost-snapshot.integration.test.ts
pnpm typecheck
```

Erwartet: beide Exit 0. Bei Prettier-Beanstandung `pnpm exec prettier --write <datei>` und erneut
prüfen.

**Step 6: Commit auf den Wegwerf-Branch**

```bash
git add apps/api/test/costs/cost-snapshot.integration.test.ts
git diff --cached --name-only
git commit -m "test(costs): EYT-139 — Herkunft von worksiteLabel und employeeLabel zusichern

WEGWERF-COMMIT (liegt auf M-A auf). Belegt, dass die neuen Zusicherungen den
Tausch sehen."
```

Erwartet bei `git diff --cached --name-only`: **genau eine** Zeile
(`apps/api/test/costs/cost-snapshot.integration.test.ts`).

---

## Task 4: Lauf 2 — Nachweis, dass die Reparatur greift (Phase B, Erwartung ROT)

**Files:** keine.

**Step 1: Erst prüfen, dass Lauf 1 abgeschlossen ist, dann pushen**

```bash
gh run list --repo DYAI2025/EasyTree --branch throwaway/eyt-139-label-provenance --limit 3 \
  --json databaseId,status,conclusion,headSha
git push origin HEAD:refs/heads/throwaway/eyt-139-label-provenance
```

**Step 2: Warten und lesen**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600 || true
RUN=$(gh run list --repo DYAI2025/EasyTree --commit "$(git rev-parse HEAD)" \
      --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --repo DYAI2025/EasyTree --json jobs --jq '.jobs[] | "\(.name)\t\(.conclusion)"'
gh run view "$RUN" --repo DYAI2025/EasyTree --log-failed \
  | grep -E "Fall 1|cost-snapshot\]|AssertionError|expected|worksite_label|employee_label" | head -60
```

**Erwartet:**

- Job `db-gates` = `failure`;
- der Schritt „Kosten-Snapshot — Persistenz, Atomizität, Rechte, Kanal" fällt;
- der Testname im Log, **wörtlich**:
  `Kosten-Snapshot gegen echtes PostgreSQL > Fall 1 — schreibt Kopf und Positionen und liest sie unveraendert zurueck`;
- die Reportzeile `[cost-snapshot] mode=required executed=11 passed=10 skipped=0` **und**
  `::error::[cost-snapshot] passed=10 von executed=11 …` aus `assert-tenant-report.sh`;
- der Fehler ist ein Bezeichnungs-Vergleich (`"Baustelle Alpha Nord"` vs `"Anna Alpha"`), **nicht**
  ein Timeout, kein Verbindungsfehler, kein `42501`.

**Notiere wörtlich:** Laufnummer, Jobfazit je Job, den vollständigen Testnamen, die Reportzeile und
den Assertion-Diff. Diese Zeilen sind die Belege 4 und 5 des Abschlussberichts.

**Stoppbedingung:** Bleibt der Lauf grün, sehen die neuen Zusicherungen die Mutation nicht → die
Reparatur ist wertlos → **STOPP** und neu entwerfen.

Der Schritt `snapshot-http` läuft in diesem Lauf **nicht mehr** (Schritte sind sequenziell, der
vorherige ist rot). Das ist erwartet und im Bericht so zu benennen — nicht als „übersprungen"
schönzureden.

---

## Task 5: Lauf 3 — die Spaltenzusicherung eigenständig belegen (Phase C, Erwartung ROT)

**Files:**

- Modify: `apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts` (`zuPosition`)

**Step 1: Den Tausch symmetrisch machen**

M-A liegt bereits. Zusätzlich in `zuPosition` ersetzen:

```ts
    worksiteLabel: zeile.worksite_label,
    employeeId: zeile.employee_id,
    employeeLabel: zeile.employee_label,
```

durch:

```ts
    worksiteLabel: zeile.employee_label,
    employeeId: zeile.employee_id,
    employeeLabel: zeile.worksite_label,
```

Wirkung: geschrieben wird vertauscht, gelesen wird zurückgetauscht — der Rundlauf liefert wieder
die richtigen Werte, die **Tabelle** trägt die falschen.

**Step 2: Kompilieren und Mutation belegen**

```bash
git diff --stat
pnpm typecheck
```

Erwartet: eine geänderte Datei, zwei geänderte Zeilen; typecheck Exit 0.

**Step 3: Commit und Push**

```bash
git add apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
git diff --cached --name-only
git commit -m "test(costs): EYT-139 — Gegenmutation M-B: Tausch symmetrisch in create UND zuPosition

WEGWERF-COMMIT. Belegt, dass die Spaltenzusicherung eigenstaendig traegt: der
Rundlauf hebt den Tausch auf, die gespeicherte Zeile nicht."
git push origin HEAD:refs/heads/throwaway/eyt-139-label-provenance
```

**Step 4: Warten und lesen**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600 || true
RUN=$(gh run list --repo DYAI2025/EasyTree --commit "$(git rev-parse HEAD)" \
      --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --repo DYAI2025/EasyTree --log-failed \
  | grep -E "Fall 1|gespeicherteBezeichnungen|worksite_label|employee_label|cost-snapshot\]" | head -60
```

**Erwartet:** derselbe Testname fällt, aber der Assertion-Diff nennt **`gespeicherteBezeichnungen.rows`**
bzw. die Objekte mit `worksite_label`/`employee_label` — und **nicht** die beiden
`positions.map(...)`-Vergleiche. Genau das belegt: der Rundlauf war grün, nur die Spalten waren
falsch.

**Stoppbedingung:** Fällt hier ein `positions.map(...)`-Vergleich, ist der Tausch nicht symmetrisch
eingebaut → korrigieren und wiederholen.

---

## Task 6: Beide Mutationen zurücknehmen und die Rücknahme belegen

**Files:**

- Modify: `apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts` (zurück auf den Originalstand)

**Step 1: Datei aus der Sicherungskopie herstellen**

```bash
cp /tmp/repo-original.ts apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
```

**Step 2: Die Rücknahme belegen — eng eingegrenzt, nicht global**

Ein globaler leerer `git diff` ist hier **unerreichbar**: die Testdatei trägt gewollt Änderungen.
Der Beleg muss auf die mutierte Datei eingegrenzt sein:

```bash
git diff df07d396e86df0a7fca37ceddf1b63d332f890d3 -- \
  apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
git diff df07d396e86df0a7fca37ceddf1b63d332f890d3 --stat -- apps/api/src apps/api/src/modules
```

Erwartet: **leere** Ausgabe beim ersten Befehl. Zusätzlich der positive Gegenbeleg, dass der
Originalzustand wieder da ist:

```bash
grep -n "position.worksiteLabel),\|position.employeeLabel)," \
  apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
grep -n "worksiteLabel: zeile.worksite_label,\|employeeLabel: zeile.employee_label," \
  apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
```

Erwartet: `worksiteLabel` steht **vor** `employeeLabel` in beiden Ausgaben, mit den ursprünglichen
Zeilennummern 282/284 bzw. 148/150.

**Step 3: Den echten Reparatur-Commit bauen**

Die Wegwerf-Commits bleiben auf dem Wegwerf-Branch. Für den echten Branch wird der Arbeitsbaum auf
den Ausgangsstand gesetzt und **nur** die Testdatei neu committet:

```bash
git stash push -- apps/api/test/costs/cost-snapshot.integration.test.ts
git checkout df07d396e86df0a7fca37ceddf1b63d332f890d3 -- .
git status --porcelain
git stash pop
git status --porcelain
```

Erwartet nach `git stash pop`: **genau eine** geänderte Datei,
`apps/api/test/costs/cost-snapshot.integration.test.ts`.

Falls `git checkout … -- .` den Arbeitsbaum nicht sauber trifft, ist der einfachere Weg ein frischer
losgelöster Arbeitsbaum auf `df07d39` plus erneutes Anwenden der Teständerung aus Task 3 —
Ergebnis ist dasselbe und muss dieselbe Prüfung bestehen.

**Step 4: Kein Commit in diesem Task** — der Commit entsteht in Task 8, nach den Gates.

---

## Task 7: Lokale Gates

**Files:** keine.

**Step 1: Fokussierter Lauf — mit Ehrlichkeit über das, was er misst**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot.integration.test.ts 2>&1 | tee /tmp/focus.log
grep -E "Test Files|Tests |\[cost-snapshot\]" /tmp/focus.log
```

**Erwartet:** `Test Files  1` — und **alle** Fälle als `skipped`, weil auf dieser Maschine kein
Docker läuft. Der Lauf beweist damit **nur**, dass die Datei existiert, lädt und transformiert;
er beweist **nichts** über die Zusicherungen. Genau so ist er im Bericht zu benennen.
Zeigt die Zeile `Test Files 0`, hat der Pfadfilter nichts getroffen und der grüne Exit ist wertlos
→ Pfad korrigieren.

**Step 2: Der zweite fokussierte Lauf — der DB-freie Zwilling, der wirklich läuft**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-repository.test.ts 2>&1 | tail -20
```

Erwartet: `Test Files  1 passed`, keine Skips. Er ist von der Änderung nicht betroffen und dient
als Gegenprobe, dass die Umgebung überhaupt Tests ausführt.

**Step 3: Die vier Pflichtbefehle, jeder einzeln, jeder mit gelesenem Exit-Code**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

Erwartet: viermal Exit 0. `pnpm format` kann lokal Dateien aus `penpot/` oder `_sprint2-transfer/`
beanstanden, die CI nie sieht — in dem Fall zusätzlich eingegrenzt messen und **beides** berichten:

```bash
pnpm exec prettier --check apps packages docs
```

**Step 4: Kein Commit.**

---

## Task 8: Wegwerf-PR schliessen, Reparatur pushen

**Files:** keine Codeänderung.

**Step 1: Wegwerf-PR schliessen und Branch löschen — VOR dem Push auf den echten Branch**

Ein offener PR mit Base `feat/eyt-109-…` würde beim nächsten Push auf den Feature-Branch erneut CI
auf der Merge-Referenz auslösen und die Läufe vermischen.

```bash
gh pr close 70 --repo DYAI2025/EasyTree \
  --comment "Wegwerf-PR: Gegenmutationen ausgefuehrt und belegt. Wird nicht gemergt."
git push origin --delete throwaway/eyt-139-label-provenance
gh pr list --repo DYAI2025/EasyTree --state open --json number,headRefName
```

Erwartet: der Wegwerf-PR erscheint nicht mehr in der offenen Liste.

**Step 2: Commit auf dem echten Branch**

```bash
git add apps/api/test/costs/cost-snapshot.integration.test.ts
git diff --cached --name-only
git commit -m "test(costs): EYT-139 — Herkunft von worksiteLabel und employeeLabel im Snapshot zusichern

Die beiden Bezeichnungen reisen als benachbarte, gleich getypte text[]-Parameter
(\$5 und \$7) in dieselbe insert-Anweisung. Ein Tausch war typkorrekt und wurde
von keiner Zusicherung gesehen — weder von Fall 1, noch von der HTTP-Naht, noch
vom DB-freien Zwilling.

Fall 1 traegt jetzt je Position verschiedene Bezeichnungen und prueft beides:
den Rundlauf ueber read() und die GESPEICHERTEN Spalten ueber die
Beobachterverbindung. Die Spaltenmessung ist noetig, weil ein beim Schreiben und
beim Lesen gleich falscher Tausch sich im Rundlauf aufhebt, waehrend die
unveraenderliche Zeile falsch bleibt.

Beide Gegenmutationen wurden in db-gates AUSGEFUEHRT, nicht benannt:
Laeufe 31645195574 (rot: Rundlauf) und 31645800409 (rot: nur Spalten).

Kein Produktionscode geaendert."
git push origin HEAD:refs/heads/feat/eyt-109-daily-plan-cost-snapshot
git rev-parse HEAD
```

Erwartet bei `git diff --cached --name-only`: **genau eine** Zeile.
Die ausgegebene SHA ist der „final pushed SHA" des Berichts.

---

## Task 9: Lauf 4 — der grüne Nachweis auf dem echten Branch (Phase D)

**Files:** keine.

**Step 1: Warten**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600
```

**Step 2: Alle elf Jobs einzeln lesen — nicht dem Sammelstatus glauben**

```bash
RUN=$(gh run list --repo DYAI2025/EasyTree --commit "$(git rev-parse HEAD)" \
      --json databaseId,headSha --jq '.[0].databaseId')
echo "Lauf: $RUN"
gh run view "$RUN" --repo DYAI2025/EasyTree --json headSha --jq .headSha
gh run view "$RUN" --repo DYAI2025/EasyTree --json jobs \
  --jq '.jobs[] | "\(.name)\t\(.conclusion)"'
gh run view "$RUN" --repo DYAI2025/EasyTree --json jobs --jq '[.jobs[]] | length'
```

Erwartet: `headSha` gleich dem gepushten SHA, 11 Jobs, **jeder** `success`:
`format`, `lint`, `typecheck`, `unit-tests`, `build-web`, `web-smoke`, `build-api`, `secret-scan`,
`db-gates`, `read-through`, `auth-journey`.

**Step 3: Die drei Pflicht-Gatezeilen wörtlich belegen**

```bash
gh run view "$RUN" --repo DYAI2025/EasyTree --log \
  | grep -E "\[(cost-snapshot|snapshot-http|planning-published-reads)\] (mode=required|Gate OK)"
```

Erwartet, unverändert gegenüber dem Ausgangsstand — die Reparatur fügt **keinen** neuen Testfall
hinzu, sondern erweitert einen bestehenden:

- `[cost-snapshot] Gate OK: executed=11 passed=11 skipped=0`
- `[snapshot-http] Gate OK: executed=7 passed=7 skipped=0`
- `[planning-published-reads] Gate OK: executed=9 passed=9 skipped=0`

Weicht `executed` ab, wurde versehentlich ein Fall hinzugefügt oder entfernt → im Bericht benennen.

**Step 4: Kein Commit.**

---

## Task 10: PR #69 — Zustand sichern, Rumpf nur bei Bedarf ergänzen

**Files:** keine im Repository.

**Step 1: Zustand messen**

```bash
gh pr view 69 --repo DYAI2025/EasyTree \
  --json number,isDraft,state,headRefOid,mergeStateStatus,title,body --jq \
  '{number,isDraft,state,headRefOid,mergeStateStatus,title}'
```

Erwartet: `isDraft: true`, `state: OPEN`, `headRefOid` gleich dem gepushten SHA.
**Nicht** auf „Ready for review" setzen, **nicht** mergen, **keine** Jira-Transition.

**Step 2: Rumpf nur ergänzen, wenn er eine Evidenztabelle führt, die jetzt unvollständig wäre**

Falls ja: den bestehenden Rumpf **erst lesen**, dann einen Absatz **anfügen** — nichts ersetzen,
nichts umschreiben:

```bash
gh pr view 69 --repo DYAI2025/EasyTree --json body --jq .body > /tmp/pr69-body.md
# Absatz anfuegen, Datei erneut lesen, DANN senden:
cat /tmp/pr69-body.md | tail -30
gh pr edit 69 --repo DYAI2025/EasyTree --body-file /tmp/pr69-body.md
```

Der neue Absatz enthält: Datum, den gepushten SHA, die Laufnummer aus Task 9, die drei Gatezeilen,
beide Gegenmutations-Laufnummern und den Satz, dass **kein Produktionscode** geändert wurde.
Vor dem Senden noch einmal lesen — Entwurfsfragmente dürfen nicht in den sichtbaren Rumpf gelangen.

Falls der Rumpf keine solche Tabelle führt: **nichts ändern** und das im Bericht so sagen.

**Step 3: „DO NOT MERGE" prüfen**

Trägt Titel oder Rumpf den Hinweis bereits, bleibt es dabei. Fehlt er, als Kommentar ergänzen — den
Titel nicht umbenennen:

```bash
gh pr comment 69 --repo DYAI2025/EasyTree \
  --body "DO NOT MERGE — EYT-139 Nachweisreparatur; PR bleibt Draft bis zur PO-Freigabe."
```

---

## Task 11: Abschlussbericht

**Files:** keine.

Berichte **wörtlich** und in dieser Reihenfolge; jede Zeile ist eine gemessene Ausgabe, keine
Zusammenfassung:

1. **Start-Head** — `df07d396e86df0a7fca37ceddf1b63d332f890d3`, plus die Ausgabe von `git ls-remote`.
2. **Geänderte Dateien** — Ausgabe von `git diff --name-only df07d39..<neuer SHA>`.
3. **Exakte neue Zusicherungen** — der eingefügte Codeblock, aus der Datei auf der Platte gelesen.
4. **Gegenmutation vor der Reparatur** — Laufnummer, alle 11 Jobfazite, beide Gatezeilen (grün).
5. **Gegenmutation nach der Reparatur** — zwei Läufe: M-A (Rundlauf **und** Spalten rot, mit dem
   wörtlichen Testnamen und der Zeile `executed=11 passed=10 skipped=0`) und M-B (nur Spalten rot).
   Dazu der Rücknahmebeleg: leerer, auf die Repository-Datei eingegrenzter `git diff`.
6. **Fokussierter Testlauf** — mit dem ausdrücklichen Hinweis, dass er lokal **skippt** und nichts
   über die Zusicherungen beweist.
7. **format / lint / typecheck / test** — je Exit-Code und die letzten Zeilen der Ausgabe.
8. **Final gepushter SHA.**
9. **Exakter CI-Lauf** (Nummer + `headSha`).
10. **Alle 11 Jobfazite**, einzeln aufgezählt.
11. **Die drei Gatezeilen** `executed/passed/skipped`.
12. **PR-Draft-Zustand** (`isDraft`, `state`, `headRefOid`).
13. **Urteil:** `REPAIR VERIFIED` — nur wenn 4, 5, 9, 10 und 11 alle wie erwartet gemessen wurden.
    Sonst `BLOCKED` mit der Ausgabe, die den Block belegt.

**Danach STOPP.** Keine weitere EYT-109-Scheibe, kein Merge, keine Jira-Transition.

---

---

## Ausführungsprotokoll (13.08.2026, nachgetragen)

Alle vier Phasen wurden gefahren. Gemessene Werte, nicht geplante:

| Phase | Commit    | Lauf          | Ergebnis                                                                                            |
| ----- | --------- | ------------- | --------------------------------------------------------------------------------------------------- |
| A     | `f40dc00` | `31644316549` | **grün**, 11/11 Jobs, `[cost-snapshot] executed=11 passed=11 skipped=0` — Lücke reproduziert          |
| B     | `037cb7e` | `31645195574` | **rot**, nur `db-gates`; `executed=11 passed=10 skipped=0`; Rundlauf `'Erste Kraft'` statt Baustelle |
| C     | `397a7bf` | `31645800409` | **rot**, nur `db-gates`; Rundlauf grün, allein die Spaltenzusicherung fällt (`:457`)                  |
| D     | `16093f5` | `31646690404` | **grün**, 11/11 Jobs, alle drei Gatezeilen unverändert                                               |

Abweichungen vom Plan:

- Die Spec-Review nach Task 3 fand drei echte Mängel, bevor irgendetwas nach CI ging: die vier
  Bezeichnungen teilten das Wort `Alpha`, obwohl der eingefügte Kommentar drei Zeilen darunter das
  Gegenteil behauptete; `PERSON_ERSTE` war identisch mit dem `position()`-Vorgabewert, sodass eine
  weggefallene Überschreibung unbemerkt geblieben wäre; und der Kopfkommentar zitierte diesen Plan,
  der gar nicht eingecheckt ist. Alle drei repariert (`037cb7e`), Werte jetzt
  `Baustelle Rosenweg`/`Baustelle Ulmenpfad` gegen `Erste Kraft`/`Zweite Kraft`, Zitat auf den
  Wegwerf-PR #70 umgestellt.
- In Phase B fiel die erste der drei neuen Zusicherungen (Rundlauf `worksiteLabel`), weshalb die
  Spaltenzusicherung dort gar nicht mehr zur Ausführung kam. Erst Phase C misst sie — das war der
  Zweck des dritten Laufs.
- `pnpm typecheck` spielte 9 von 10 Turbo-Aufgaben aus einem **fremden** Worktree ein (die Logpfade
  zeigten auf `…/eyt109-wt`). Jede Kompilierbarkeitsaussage dieses Laufs stammt deshalb aus einem
  direkten `tsc -p apps/api/tsconfig.json --noEmit`, nicht aus Turbo. Bei den Schlussgates wurde
  stattdessen belegt, dass `@easytree/api` ein `cache miss, executing` war.

---

## Stoppbedingungen (jederzeit gültig)

| Bedingung                                                                 | Reaktion                                      |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| `origin`-Head ≠ `df07d39…`                                                | STOPP, `HEAD_DRIFT` melden                     |
| Lauf 1 (Mutation ohne Teständerung) ist **rot**                           | STOPP — Prämisse falsch, nichts reparieren     |
| Lauf 2 (Mutation mit Teständerung) ist **grün**                           | STOPP — Reparatur wertlos, neu entwerfen       |
| Der Nachweis verlangt eine Migration oder eine Produktionscodeänderung     | STOPP, melden — Nachweisreparatur ist der Auftrag |
| Fehlschläge in Jobs ohne Bezug (`web-smoke`, `auth-journey`, `read-through`) | STOPP, melden, nicht „durchreichen"          |
| `pnpm typecheck` scheitert an einer Mutation                              | STOPP — die Mutation ist nicht typkorrekt      |

## Ausdrücklich außerhalb des Auftrags

Repository-Refactor · UNNEST-Architektur ersetzen · `jsonb_to_recordset` · Performance ·
Zuweisungsdauer-Regel · Body-Size · ProblemDetails-Umbau · 5xx im OpenAPI · UI · EYT-110 ·
Sprint 6 · Jira-Transition · Merge · Änderungen an `snapshot-http.integration.test.ts` ·
Änderungen am DB-freien Zwilling.
