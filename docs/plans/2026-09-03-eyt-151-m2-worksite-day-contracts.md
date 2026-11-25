# EYT-151 / EYT-147 M2 — WorksiteDay Contracts/OpenAPI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Die in M1 (Migration `0019`) geschaffenen Tabellen `worksite_days` / `worksite_day_configurations` bekommen eine additive, strikte, zur Laufzeit validierte Transportgrenze in `@easytree/contracts` — Schemata, Port, HTTP-Client, Mock, OpenAPI `v1.json` und Route-Konformitaet — ohne Serverlogik, DB-Mutation oder UI-Umbau.

**Architecture:** Alles entsteht aus Zod in `packages/contracts/src/planning/schemas.ts` und laeuft durch die bestehende Pipeline Zod → `buildOpenApiDocument()` → `openapi/v1.json` (Byte-Drift-Test). Zwei neue Kommandos `planWorksiteDay` / `updateWorksiteDayTeam` und eine optionale Projektion `PlanningWindow.worksiteDays[]`; die beiden Routen werden in `apps/api/test/openapi-route-conformance.test.ts` als `NOT_YET_IMPLEMENTED` gefuehrt (contract-only), bis M3/M4 sie bauen. Stabile Identitaet (`worksiteDayId`) und Revision (`configurationId`) sind zwei Pflichtfelder der Antwort; die Stale-Grenze ist `expectedLockVersion` gegen die IDENTITAET (Migration 0019: „Genau EINE Stale-Wahrheit je Tag (R-20)“).

**Tech Stack:** TypeScript strict, zod 4.4.3 (`z.strictObject`, `z.toJSONSchema`), vitest 4, pnpm 10.28 / Turbo, NestJS-Routentabelle (nur gelesen), Playwright nicht betroffen.

---

## 0. Ausgangslage — gemessen 03.09.2026, 02:16 Uhr (lokal, Evidenzstufe „lokaler Lauf“)

| Messung                  | Befehl                                                           | Ergebnis                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository               | `git remote -v`                                                  | `origin https://github.com/DYAI2025/EasyTree.git`                                                                                                                                                                                                                      |
| Remote-Head PR #101      | `git rev-parse origin/feat/eyt-147-dispositionswerkbank-slice-1` | `cc92ceb38dcd1f317c05a7a7caec2561c8d12f4f` — **kein DRIFT** gegen den Auftrag                                                                                                                                                                                          |
| PR #101                  | `gh pr view 101`                                                 | OPEN, base `master`, head `cc92ceb…`                                                                                                                                                                                                                                   |
| Worktree fuer den Branch | `git worktree list`                                              | `/Users/benjaminpoersch/EasyTree-worktrees/eyt-147-dispositionswerkbank` @ `cc92ceb`                                                                                                                                                                                   |
| Hauptcheckout            | `/Users/benjaminpoersch/EasyTree`                                | Branch `feat/eyt-126-container-staging`, schmutzig — **hier wird NICHT gearbeitet**                                                                                                                                                                                    |
| Confluence 41484289      | live gelesen                                                     | §4: `lock_version` wird in den Folgedraft uebernommen; §5: `app.lock_week_draft(weekKey)` ist der einzige Draft-Aufloesungspfad der drei Planning-Write-Commands; §8 nennt genau: `planWorksiteDay`, `updateWorksiteDayTeam`, additive `PlanningWindow.worksiteDays[]` |
| Jira EYT-151             | live gelesen                                                     | Status `In Arbeit`, AC deckungsgleich mit §8; Stop-Gates: Widerspruch zu 41484289, Breaking Change, neue Domainsemantik, Scope > M2                                                                                                                                    |
| Jira EYT-147             | Kommentar 15087 (03.09.)                                         | M2 = einziger offener Slice; M1 `ACCEPTED` (Kommentar 14911)                                                                                                                                                                                                           |

### 0.1 Es liegt bereits ein UNCOMMITTETER M2-Entwurf im Worktree (mtime 02.09.2026 09:08)

`git status --short` im Worktree zeigt 16 geaenderte Dateien plus `packages/contracts/test/worksite-day-schemas.test.ts` (untracked), zusammen 1687 Zeilen. Gemessen auf diesem Entwurf:

| Gate                     | Befehl                                                                               | Ergebnis                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts-Tests          | `pnpm --filter @easytree/contracts exec vitest run`                                  | `Test Files 10 passed (10)`, `Tests 264 passed (264)`                                                                                                                                                                                                                      |
| Contracts typecheck/lint | `pnpm --filter @easytree/contracts typecheck` · `… lint`                             | beide exit 0                                                                                                                                                                                                                                                               |
| Generator reproduzierbar | zweimal `openapi:write`, `/usr/bin/diff … \| wc -l`                                  | `0`                                                                                                                                                                                                                                                                        |
| Route-Konformitaet       | `pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts` | `Tests 6 passed (6)`                                                                                                                                                                                                                                                       |
| Web-Tests                | `pnpm --filter @easytree/web exec vitest run`                                        | `41 passed (41)`, `479 passed (479)`                                                                                                                                                                                                                                       |
| Repo-weit                | `pnpm exec turbo run typecheck lint --force`                                         | `Tasks: 16 successful, 16 total`, `Cached: 0 cached`                                                                                                                                                                                                                       |
| API-Tests                | `pnpm --filter @easytree/api exec vitest run`                                        | `2 failed \| 75 passed (77)`: `planning-invariants.integration` und `costs/rate-timestamp.integration` — Fehlertext `Idempotenzsatz verweist auf eine nicht mehr sichtbare Satzversion` = **Altbestand im lokalen Supabase-Stack (9 Container laufen), nicht der Entwurf** |

**Entscheidung fuer diesen Plan:** Der Entwurf ist fachlich richtig (siehe Contract Map), hat aber **keine Rot-Phase** — Auftrag §9 verlangt „Tests zuerst ausfuehren und erwartetes ROT dokumentieren“. Deshalb: Task 0 sichert den Entwurf als Patch und **stasht** ihn; jede Aufgabe fuehrt ihren Teil rot-zuerst wieder ein. Der Code in diesem Plan IST der (an drei Stellen ergaenzte) Entwurfscode — abtippen aus dem Plan, nicht aus dem Stash, damit die Reihenfolge Test → Rot → Code → Gruen real stattfindet.

Sicherungskopien (ausserhalb jedes Repos, bereits angelegt):
`/Users/benjaminpoersch/EasyTree-worktrees/eyt-151-m2-draft-2026-09-02.patch` (2056 Zeilen) und
`/Users/benjaminpoersch/EasyTree-worktrees/eyt-151-m2-draft-2026-09-02.worksite-day-schemas.test.ts` (521 Zeilen).

### 0.2 Drei Ergaenzungen gegenueber dem Entwurf (Reviewbefunde)

1. **OpenAPI-Kopplung gemessen, nicht behauptet** — neuer Testfall im Drift-Test: `WorksiteDayDto.required` enthaelt beide Ids, `team.minItems === 1` in beiden Kommandos, `PlanningWindow.required` enthaelt `worksiteDays` NICHT (Additivitaet), `localDate` traegt im Dokument nur das Muster. Damit haben die Gegenmutationen 1 und 2 je ZWEI unabhaengige Detektoren (Laufzeittest + Dokument).
2. **`LocalDateSchema`-Tests liegen bei den Primitiven** (`primitives.test.ts`), nicht im Tagesvertrag — dort steht das Schema.
3. **Public Surface benannt**: `public-surface.test.ts` fuehrt die fuenf neuen Schemata und die Konstante namentlich, sonst faellt ein vergessener Export erst in `apps/web` auf.

---

## 1. M2 Contract Map

| Begriff                  | stabile Identitaet                                                                                                 | Revision                                                                                                   | Client-sichtbares Feld                                                                                                                             | Quelle                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| WorksiteDay              | `worksite_days.id` — eine Zeile je `(org_id, worksite_id, local_date)`, `unique (org_id, worksite_id, local_date)` | keine (versionsuebergreifend)                                                                              | `WorksiteDayDto.worksiteDayId`, `.worksiteId`, `.localDate`; Kommando `UpdateWorksiteDayTeamCommand.worksiteDayId`                                 | Migration 0019 §1; 41484289 §1 (B1), §2 Nr. 1 |
| WorksiteDayConfiguration | — (haengt an `worksite_day_id`)                                                                                    | `worksite_day_configurations.id`, `unique (plan_version_id, worksite_day_id)`, `lock_version integer >= 0` | `WorksiteDayDto.configurationId`, `.lockVersion`; Kommando `expectedLockVersion`                                                                   | Migration 0019 §2; 41484289 §2 Nr. 2, §4      |
| Assignment               | `assignments.id`                                                                                                   | referenziert genau EINE `worksite_day_configuration_id` (nullable, kein Backfill)                          | `WorksiteDayTeamMember.assignmentId` (Antwort); `WorksiteDayTeamEntry` OHNE Id (Kommando); bestehendes `PlanningWindow.assignments[]` unveraendert | Migration 0019 §4; 41484289 §2 Nr. 3–4        |

Stabile Id und Configuration-Id fallen NICHT zusammen: zwei Pflichtfelder mit verschiedenen Fixturewerten, ein Test vertauscht sie und verlangt ein anderes Ergebnis (Task 3), Gegenmutation 1 entfernt eines davon (Task 13).

### 1.1 Vertragsentscheidungen (im Abschlussreport unter B zu wiederholen)

- **D1 Transportform** `WorksiteDayDto = { worksiteDayId, configurationId, worksiteId, localDate, lockVersion, team: WorksiteDayTeamMember[] }`, `z.strictObject`. `team` darf in der ANTWORT leer sein (ein unvollstaendiger Tag macht sonst das ganze Fenster unlesbar); in beiden KOMMANDOS ist `team: []` ungueltig (41484289 §2 Nr. 8).
- **D2 `planWorksiteDay`** adressiert `weekKey + worksiteId + localDate` (die Identitaet entsteht erst serverseitig), Antwort `201 WorksiteDayDto`. 409 → Gateway `REJECTED` (beim Anlegen gibt es keinen Stand, der veraltet sein koennte).
- **D3 `updateWorksiteDayTeam`** adressiert `weekKey + worksiteDayId + expectedLockVersion + team`, **ohne `configurationId`**. Begruendung, zitiert: Migration 0019 — `lock_version` ist „Nebenlaeufigkeits-Token der TAGESIDENTITAET, je Revision materialisiert und beim Kopieren uebernommen. Genau EINE Stale-Wahrheit je Tag (R-20)“; 41484289 §4 — „`lock_version` wird in den Folgedraft uebernommen und erst durch eine reale Tagesmutation erhoeht“; §5 — `app.lock_week_draft(weekKey)` ist der einzige Draft-Aufloesungspfad. Eine `configurationId` im Kommando waere eine ZWEITE Stale-Wahrheit und liefe nach jedem Publish ins Leere, obwohl der Inhalt unveraendert ist. „Kein implizites latest“ ist erfuellt: die Revision ist durch `weekKey` (hoechstens ein Draft je Woche, §4) eindeutig, der Stand durch `expectedLockVersion`. Antwort `200 WorksiteDayDto` mit fortgeschriebener `lockVersion`; 409 → Gateway `STALE_VERSION` (dieselbe Deutung wie `publishPlan`), Feinunterscheidung ueber `problem.type`. **Das ist PO-Reviewpunkt Nr. 1 im Report.**
- **D4 Teamregeln** (beide Kommandos, am Array): `min(1)`; kein doppeltes `(employeeId, interval)`; keine ueberlappenden Intervalle DERSELBEN Person; getrennte Intervalle derselben Person erlaubt (41484289 §2 Nr. 4). Intervalle: bestehendes `TimeIntervalDtoSchema` (halb-offen, `endUtc > startUtc`).
- **D5 Lokaler Tag** `LocalDateSchema` in `primitives.ts`: `JJJJ-MM-TT` plus Kalenderpruefung ueber den Rueckweg (`2026-02-30` faellt). Keine Zeitzone, keine Wochenrechnung — die Woche rechnet der Server aus `localDate` in der Organisationszone und vergleicht mit `weekKey` (dieselbe Redundanz wie `CreateAssignmentCommand.weekKey`). `BusinessDateSchema` (Kosten, nur Muster) bleibt unberuehrt — Verschaerfung waere eine Aenderung des Kostenvertrags, nicht additiv (Residualrisiko, im Report nennen).
- **D6 Idempotenz** ueber bestehendes `WriteOptions.idempotencyKey` + `Idempotency-Key`-Header; Replay-Semantik (Erstantwort) ist Serververhalten, M3/M4.
- **D7 Fehlervokabular** `WORKSITE_DAY_PROBLEM_TYPE` (URNs `urn:easytree:planning:<kebab>` wie `PLANNING_ERROR_TYPE` in `apps/api/src/modules/planning/interface/http/planning-problem.filter.ts`), in die 409-Beschreibung beider Routen eingesetzt. Kein 404 — das Dokument kennt nur 400/401/403/409 (`grep -c '"404"' v1.json` = 0), `*-not-found`-Typen laufen ueberall ueber diese vier. `WORKSITE_DAY_INCOMPLETE` bleibt draussen (Publish-Bedingung, M5). **M3/M4 muessen die Konstante importieren statt die URNs erneut zu tippen** — im Report als Hinweis fuer M3.
- **D8 Rueckwaertskompatibilitaet** `PlanningWindow.worksiteDays` ist `.optional()` — NICHT `.default([])`: gemessen mit zod 4.4.3 fuehrt `z.toJSONSchema` ein Feld mit Vorgabewert unter `required`, und der heutige Server sendet das Feld nicht. Bestehende `assignments[]` bleiben unveraendert. Kein Breaking Change → kein `BLOCKED_BREAKING_CHANGE`.

---

## 2. Regeln fuer JEDE Aufgabe

- **Arbeitsverzeichnis** ist ausschliesslich der Worktree: `cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-147-dispositionswerkbank` — jeder Befehl unten setzt das voraus. `$SCRATCH` = Scratchpad-Verzeichnis der ausfuehrenden Session.
- **Keine Zwischencommits.** Auftrag §13: committen erst, „nachdem alle lokalen Gates gruen sind“ — deshalb weicht dieser Plan vom „Commit pro Task“ der writing-plans-Skill ab. Jede Aufgabe endet statt dessen mit einem **Checkpoint**: `git status --short` zeigt genau die erwarteten Dateien, der genannte Test ist gruen mit gezaehlter Dateizahl.
- **vitest-Pfadfilter ist ein Substring** und laeuft bei 0 Treffern gruen: jede Testzeile unten nennt die erwartete `Test Files N`-Zahl — die ist zu lesen, nie der Exit-Code.
- **Rot zuerst, wirklich ausgefuehrt.** Jede Aufgabe fuehrt den neuen Test VOR dem Produktionscode aus und notiert die Fehlermeldung (Wortlaut, ein Satz) im Ausfuehrungsprotokoll `$SCRATCH/eyt-151-protokoll.md`.
- **`dist` ist Altbestand.** `apps/api`- und `apps/web`-Tests lesen `packages/contracts/dist`; vor jedem Lauf dieser Pakete `pnpm --filter @easytree/contracts build`.
- **Der lokale Supabase-Stack ist geteilt** (colima, 9 Container). Nicht stoppen, nicht resetten — andere Sessions koennen ihn benutzen. Integrationssuiten gegen den Stack werden mit der in Task 0 gemessenen Baseline verglichen; CI ist die hoehere Evidenzstufe.
- **Keine Regel abschwaechen**, um gruen zu werden. Wird ein bestehender Test rot und die Ursache ist nicht „Kommando-/Portoberflaeche gewachsen“, STOP und melden.
- Sprache: Code-Kommentare Deutsch ohne Umlaute (wie die Nachbardateien), Commit-Message Englisch mit Jira-Id.

---

### Task 0: Identity-Gate, Entwurf sichern, Baseline messen

**Files:**

- Keine Aenderung im Repo. Erzeugt: `$SCRATCH/eyt-151-protokoll.md`, `$SCRATCH/baseline-test.log`, `$SCRATCH/baseline-failures.txt`.

**Step 1: Identity-Gate (Auftrag §0) — Ausgabe waertlich ins Protokoll**

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-147-dispositionswerkbank
pwd
git rev-parse --show-toplevel
git remote -v
git status --short --branch
git rev-parse HEAD
git branch --show-current
```

Erwartet: `pwd` = `/Users/benjaminpoersch/EasyTree-worktrees/eyt-147-dispositionswerkbank`; `show-toplevel` identisch; remote `origin https://github.com/DYAI2025/EasyTree.git`; Branch `feat/eyt-147-dispositionswerkbank-slice-1`; HEAD `cc92ceb38dcd1f317c05a7a7caec2561c8d12f4f`; `status` zeigt 16 ` M`-Zeilen + `?? packages/contracts/test/worksite-day-schemas.test.ts` (der Entwurf). Weicht Repository oder Branch ab: **STOP, keine Mutation.**

**Step 2: Remote-Head erneut pruefen (DRIFT-Erkennung)**

```bash
git fetch origin feat/eyt-147-dispositionswerkbank-slice-1
git rev-parse origin/feat/eyt-147-dispositionswerkbank-slice-1
gh pr view 101 --json state,headRefOid --jq '.state + " " + .headRefOid'
```

Erwartet: `cc92ceb38dcd1f317c05a7a7caec2561c8d12f4f` beide Male, `OPEN`. Anderer Wert → **DRIFT melden, neuen Stand rekonstruieren, nicht implementieren.**

**Step 3: Entwurf sichern und stashen**

```bash
git diff > "$SCRATCH/m2-draft.patch"
cp packages/contracts/test/worksite-day-schemas.test.ts "$SCRATCH/m2-draft.worksite-day-schemas.test.ts"
wc -l "$SCRATCH/m2-draft.patch"          # erwartet: 2056
git stash push -u -m "EYT-151 M2 Entwurf vom 2026-09-02 (ungetestete Rot-Phase)"
git status --short | wc -l               # erwartet: 0
git stash list | head -1                 # erwartet: stash@{0}: On feat/eyt-147-…: EYT-151 M2 Entwurf …
```

Der Stash bleibt bis zum Abschlussreport liegen (nicht droppen). Er wird NICHT wieder angewendet — der Code kommt aus diesem Plan.

**Step 4: Abhaengigkeiten frisch bauen (dist des Entwurfs ueberschreiben)**

```bash
pnpm install --frozen-lockfile 2>&1 | tail -2
pnpm --filter @easytree/contracts build && pnpm --filter @easytree/domain build && pnpm --filter @easytree/config build && pnpm --filter @easytree/ui build
grep -c 'WorksiteDayDtoSchema' packages/contracts/dist/planning/schemas.js   # erwartet: 0 (kein Entwurfsrest im dist)
```

**Step 5: Baseline der Integrationssuiten gegen den geteilten Stack**

```bash
pnpm exec turbo run test --force --continue --concurrency=1 --env-mode=loose 2>&1 | tee "$SCRATCH/baseline-test.log" | grep -E 'Tasks:|Cached:|Test Files|Tests '
grep -oE 'FAIL +[^ ]+\.test\.tsx? ' "$SCRATCH/baseline-test.log" | sort -u > "$SCRATCH/baseline-failures.txt"
cat "$SCRATCH/baseline-failures.txt"
```

Erwartet: `Cached: 0 cached`. `--continue` laesst Turbo trotz eines roten Pakets ALLE zehn Tasks laufen (sonst bricht es nach dem ersten Fehler ab und api/web bleiben ungemessen; `Tasks: N successful, 10 total` mit `Failed:`-Zeile ist dann die erwartete Form), `--concurrency=1` fuehrt die Pakete nacheinander aus — gemessen 03.09.2026: bei fuenf parallelen vitest-Prozessen lief `packages/domain/test/local-day-allocation.property.test.ts` (fast-check) in den 5000-ms-Timeout, isoliert 4/4 gruen in 2,04 s. Das ist ein Lastartefakt des unveraenderten Heads, kein Befund. contracts/web/domain/config/ui gruen; in `apps/api` hoechstens die beiden Dateien `test/planning-invariants.integration.test.ts` und `test/costs/rate-timestamp.integration.test.ts` (Stack-Altbestand). Steht dort eine ANDERE Datei: notieren — sie ist Baseline, nicht M2-Befund, wird aber im Report unter I genannt.

**Step 6: Checkpoint** — `git status --short | wc -l` = `0`; Protokoll enthaelt Step-1/2-Ausgaben waertlich und die Baseline-Liste.

---

### Task 1: `LocalDateSchema` (Primitive)

**Files:**

- Modify: `packages/contracts/src/primitives.ts` (nach Zeile 49 `export const IdSchema …`)
- Modify: `packages/contracts/src/index.ts:11-21`
- Test: `packages/contracts/test/primitives.test.ts` (Block anhaengen)

**Step 1: Failing Test schreiben** — am Ende von `primitives.test.ts` anhaengen und den Import in Zeile 8 erweitern:

```ts
import {
  IdempotencyKeySchema,
  InstantSchema,
  LocalDateSchema,
  ProblemDocumentSchema,
} from "../src/primitives.js";
```

```ts
describe("LocalDateSchema — ein realer Kalendertag, keine Uhrzeit, keine Zone", () => {
  it.each(["2026-08-03", "2024-02-29", "2026-12-31"])("nimmt %s an", (tag) => {
    expect(LocalDateSchema.safeParse(tag).success).toBe(true);
  });

  it("lehnt einen syntaktisch gueltigen, kalendarisch unmoeglichen Tag ab", () => {
    // Der Pflichtfall. Ein reines Muster laesst ihn durch — genau die Luecke,
    // die `BusinessDateSchema` im Kostenbereich bis heute hat. `worksite_days.local_date`
    // ist vom Typ `date`; die Datenbank haette die Zeile abgelehnt.
    expect(LocalDateSchema.safeParse("2026-02-30").success).toBe(false);
  });

  it.each(["2025-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-8-3", "03.08.2026", ""])(
    "lehnt %s ab",
    (tag) => {
      expect(LocalDateSchema.safeParse(tag).success).toBe(false);
    },
  );
});
```

**Step 2: Rot sehen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/primitives.test.ts
```

Erwartet: `Test Files 1 failed (1)`; Fehler nennt `LocalDateSchema` (undefined / `does not provide an export named 'LocalDateSchema'`). Wortlaut ins Protokoll.

**Step 3: Implementieren** — in `primitives.ts` direkt nach `export const IdSchema = z.uuid().describe("UUID");` einfuegen:

```ts
/**
 * Lokaler Kalendertag ohne Uhrzeit und ohne Zone — `2026-08-03`.
 *
 * ## Warum das Muster allein nicht genuegt
 *
 * `^\d{4}-\d{2}-\d{2}$` nimmt `2026-02-30` an. Diesen Tag gibt es nicht, und ein
 * Baustellentag darauf koennte nie aus `worksite_days.local_date` (Typ `date`)
 * stammen — die Datenbank haette die Zeile abgelehnt. Ein Vertrag, der
 * nachsichtiger ist als der Speicher, verschiebt den Fehler nur nach hinten.
 *
 * Geprueft wird ueber den Rueckweg, dieselbe Bauart wie bei {@link InstantSchema}:
 * `Date` normalisiert `2026-02-30` still zum 2. Maerz, und der Vergleich mit der
 * Eingabe faellt dann auseinander (gemessen: `2026-02-30` -> `2026-03-02`,
 * `2026-04-31` -> `2026-05-01`, `2025-02-29` -> `2025-03-01`; `2026-13-01` und
 * `2026-00-10` ergeben gar kein Datum). Das angehaengte `T00:00:00.000Z` gehoert
 * dazu: ohne Zeitanteil duerfte eine Laufzeit den Wert als LOKALE Zeit lesen, und
 * eine westliche Zone verschoebe den Rueckweg um einen Tag.
 *
 * ## Abgrenzung zu `BusinessDateSchema`
 *
 * `costs/schemas.ts` fuehrt fuer denselben Begriff ein SCHWAECHERES Schema: nur
 * das Muster, ohne Kalenderregel. Das ist bekannt und bleibt hier absichtlich
 * unberuehrt — es zu verschaerfen aenderte die Laufzeitsemantik von
 * Satzversionen und Kostenpositionen, und das ist keine additive
 * Vertragserweiterung. Bis die beiden jemand mit eigenen Kostentests
 * zusammenfuehrt, ist DIES die strengere Seite, und neue Felder nehmen dieses
 * Schema, nicht das andere.
 */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Lokales Datum im Format JJJJ-MM-TT")
  .refine((wert) => {
    const parsed = new Date(`${wert}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === wert;
  }, "Kein realer Kalendertag im gregorianischen Kalender")
  .describe("Lokaler Kalendertag im Format 2026-08-03 — ohne Uhrzeit, ohne Zone");

export type LocalDate = z.infer<typeof LocalDateSchema>;
```

In `index.ts` den ersten Exportblock ergaenzen (alphabetisch nach `InstantSchema`) und den Typexport erweitern:

```ts
export {
  IDEMPOTENCY_HEADER,
  IdSchema,
  IdempotencyKeySchema,
  INSTANT_PATTERN,
  InstantSchema,
  LocalDateSchema,
  ProblemDocumentSchema,
  cursorPage,
  newIdempotencyKey,
} from "./primitives.js";
export type { IdempotencyKey, Instant, LocalDate, ProblemDocument } from "./primitives.js";
```

**Step 4: Gruen sehen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/primitives.test.ts
```

Erwartet: `Test Files 1 passed (1)`, Tests-Zahl = vorher + 11.

**Step 5: Checkpoint** — `git status --short` zeigt genau: ` M packages/contracts/src/index.ts`, ` M packages/contracts/src/primitives.ts`, ` M packages/contracts/test/primitives.test.ts`.

---

### Task 2: Teameintrag und Teamregeln (`WorksiteDayTeamEntrySchema`, `WorksiteDayTeamCommandSchema`)

**Files:**

- Create: `packages/contracts/test/worksite-day-schemas.test.ts`
- Modify: `packages/contracts/src/planning/schemas.ts` (Import Zeile 25; neuer Block nach `PlanningResourcesSchema`, vor `PlanningWindowSchema`)

**Step 1: Failing Test schreiben** — neue Datei mit Kopf, Konstanten und dem ersten `describe`. Die Konstanten werden von den Tasks 3–6 weiterbenutzt; der Importblock waechst mit jeder Aufgabe.

```ts
/**
 * Die WorksiteDay-Transportgrenze (EYT-147, Meilenstein M2, Jira EYT-151).
 *
 * ## Was hier gemessen wird — und was ausdruecklich nicht
 *
 * Nur der VERTRAG. M2 baut keine Businesslogik: es gibt keinen Server, der
 * einen Baustellentag anlegt, und keine Repository-Projektion, die
 * `worksiteDays` fuellt. Was diese Datei belegt, ist die Form, die beide Seiten
 * spaeter einhalten muessen — Schemata, Regeln, Asymmetrien.
 *
 * ## Die Asymmetrie, die keine Nachlaessigkeit ist
 *
 * `team: []` ist im KOMMANDO verboten und in der ANTWORT erlaubt. Confluence
 * 41484289 §2 Nr. 8 verlangt das erste ("ein leerer Baustellentag wird nicht
 * still erzeugt oder veroeffentlicht"). Das zweite folgt aus der Gegenrichtung:
 * ein Antwortschema, das den leeren Tag verbietet, macht aus einer einzelnen
 * unvollstaendigen Zeile eine unlesbare GESAMTE Planungsantwort — der Client
 * verwirft dann das ganze Fenster. Wer die beiden Seiten vereinheitlicht,
 * bricht genau eine der zwei Zusagen.
 */
import { describe, expect, it } from "vitest";

import {
  WorksiteDayTeamCommandSchema,
  WorksiteDayTeamEntrySchema,
} from "../src/planning/schemas.js";

const WORKSITE_DAY_ID = "00000000-0000-4000-8000-00000000d001";
const CONFIGURATION_ID = "00000000-0000-4000-8000-00000000c001";
const WORKSITE_ID = "00000000-0000-4000-8000-00000000a001";
const WORKSITE_FREMD = "00000000-0000-4000-8000-00000000a999";
const PERSON_A = "00000000-0000-4000-8000-0000000000a1";
const PERSON_B = "00000000-0000-4000-8000-0000000000b1";
const EINSATZ_1 = "00000000-0000-4000-8000-0000000000e1";
const EINSATZ_2 = "00000000-0000-4000-8000-0000000000e2";
const ENTWURF_ID = "00000000-0000-4000-8000-00000000f001";

/** Halb-offen, wie `TimeIntervalDtoSchema` es verlangt. */
const FRUEH = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T10:00:00.000Z" };
const SPAET = { startUtc: "2026-08-03T12:00:00.000Z", endUtc: "2026-08-03T16:00:00.000Z" };
/** Ueberschneidet FRUEH um eine Stunde. */
const UEBERLAPPEND = { startUtc: "2026-08-03T09:00:00.000Z", endUtc: "2026-08-03T11:00:00.000Z" };

const WOCHE = "2026-W32";
const TAG = "2026-08-03";

describe("WorksiteDayTeamCommand — Regeln eines Kommandoteams", () => {
  it("nimmt einen einzelnen Eintrag an", () => {
    expect(
      WorksiteDayTeamEntrySchema.safeParse({ employeeId: PERSON_A, interval: FRUEH }).success,
    ).toBe(true);
    expect(
      WorksiteDayTeamCommandSchema.safeParse([{ employeeId: PERSON_A, interval: FRUEH }]).success,
    ).toBe(true);
  });

  it("lehnt ein verkehrtes Intervall im Eintrag ab — dieselbe Regel wie ueberall", () => {
    // `TimeIntervalDtoSchema` verlangt endUtc > startUtc; der Teameintrag erbt
    // die Regel, statt sie nachzubauen. Ohne diesen Fall koennte jemand hier ein
    // eigenes, lockereres Intervallschema einsetzen, und niemand merkte es.
    const verkehrt = { startUtc: FRUEH.endUtc, endUtc: FRUEH.startUtc };
    expect(
      WorksiteDayTeamCommandSchema.safeParse([{ employeeId: PERSON_A, interval: verkehrt }])
        .success,
    ).toBe(false);
  });

  it("lehnt ein identisches (employeeId, interval)-Paar doppelt ab — als DUPLIKAT benannt", () => {
    const ergebnis = WorksiteDayTeamCommandSchema.safeParse([
      { employeeId: PERSON_A, interval: FRUEH },
      { employeeId: PERSON_A, interval: { ...FRUEH } },
    ]);
    expect(ergebnis.success).toBe(false);
    if (ergebnis.success) return;

    // ## Warum die MELDUNG geprueft wird und nicht nur `success`
    //
    // Ein identisches Paar ueberlappt sich selbst. Ein Fall, der nur `success`
    // zusichert, bleibt deshalb auch dann rot, wenn man den Duplikatzweig
    // ersatzlos loescht — die Ueberlappungsregel faengt ihn dann. Der Test waere
    // gruen, die Regel weg, und die Planerin suchte nach einer Zeitkollision, wo
    // sie zweimal dieselbe Zeile abgeschickt hat. Erst die Meldung trennt die
    // beiden Regeln, und erst damit gibt es eine Gegenmutation, die feuert.
    const meldungen = ergebnis.error.issues.map((i) => i.message).join(" | ");
    expect(meldungen).toContain("zweimal im Team");
    expect(meldungen).not.toContain("ueberlappen sich");
  });

  it("lehnt ueberlappende Intervalle derselben Person ab — als UEBERLAPPUNG benannt", () => {
    const ergebnis = WorksiteDayTeamCommandSchema.safeParse([
      { employeeId: PERSON_A, interval: FRUEH },
      { employeeId: PERSON_A, interval: UEBERLAPPEND },
    ]);
    expect(ergebnis.success).toBe(false);
    if (ergebnis.success) return;
    // Gegenstueck zum Duplikatfall: hier muss GENAU die andere Meldung stehen.
    // Zusammen zwingen die beiden Faelle die zwei Regeln auseinander.
    const meldungen = ergebnis.error.issues.map((i) => i.message).join(" | ");
    expect(meldungen).toContain("ueberlappen sich");
    expect(meldungen).not.toContain("zweimal im Team");
  });

  it("nimmt zwei getrennte, nicht ueberlappende Intervalle derselben Person an", () => {
    // Der Fall, den die Ueberlappungsregel NICHT verschlucken darf: eine Person
    // kann vormittags und nachmittags auf derselben Baustelle stehen
    // (Confluence 41484289 §2 Nr. 4).
    expect(
      WorksiteDayTeamCommandSchema.safeParse([
        { employeeId: PERSON_A, interval: FRUEH },
        { employeeId: PERSON_A, interval: SPAET },
      ]).success,
    ).toBe(true);
  });

  it("nimmt mehrere unterschiedliche Teammitglieder an", () => {
    expect(
      WorksiteDayTeamCommandSchema.safeParse([
        { employeeId: PERSON_A, interval: FRUEH },
        { employeeId: PERSON_B, interval: FRUEH },
      ]).success,
    ).toBe(true);
  });

  it("bezieht die Ueberlappungsregel auf die Person, nicht auf den Tag", () => {
    // Gegenprobe zur Zeile darueber: waere die Regel personenblind, waere
    // dasselbe Intervall fuer zwei verschiedene Personen bereits ein Konflikt.
    expect(
      WorksiteDayTeamCommandSchema.safeParse([
        { employeeId: PERSON_A, interval: UEBERLAPPEND },
        { employeeId: PERSON_B, interval: FRUEH },
      ]).success,
    ).toBe(true);
  });

  it("lehnt ein leeres Team ab — ein Baustellentag entsteht nicht ohne Besetzung", () => {
    expect(WorksiteDayTeamCommandSchema.safeParse([]).success).toBe(false);
  });
});
```

Die noch unbenutzten Konstanten (`WORKSITE_DAY_ID`, `CONFIGURATION_ID`, `WORKSITE_FREMD`, `EINSATZ_1`, `EINSATZ_2`, `ENTWURF_ID`, `WOCHE`, `TAG`) meldet ESLint als `no-unused-vars` — das ist in dieser Aufgabe erwartet und verschwindet mit Task 3–6. `pnpm lint` laeuft erst in Task 11.

**Step 2: Rot sehen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/worksite-day-schemas.test.ts
```

Erwartet: `Test Files 1 failed (1)`; Fehler nennt `WorksiteDayTeamCommandSchema` bzw. `WorksiteDayTeamEntrySchema`. Wortlaut ins Protokoll.

**Step 3: Implementieren** — in `schemas.ts` Zeile 25 den Import erweitern:

```ts
import { IdSchema, InstantSchema, LocalDateSchema } from "../primitives.js";
```

(`InstantSchema` bleibt: `PublishedPlanVersionSchema` benutzt es.) Dann nach `export type PlanningResources = z.infer<typeof PlanningResourcesSchema>;` und VOR `export const PlanningWindowSchema` einfuegen:

```ts
/**
 * Ein Teameintrag, wie ihn ein KOMMANDO traegt — Person und Intervall.
 *
 * Ohne Assignment-Id, und das ist kein Versehen: beim Anlegen existiert sie noch
 * nicht, der Server vergibt sie. Die Antwort fuehrt sie dann mit (siehe
 * {@link WorksiteDayTeamMemberSchema}). Ein gemeinsames Schema fuer beide
 * Richtungen brauchte ein optionales Feld — und ein optionales Feld heisst,
 * dass niemand mehr sagen kann, ob eine fehlende Id ein neuer Eintrag oder ein
 * Datenverlust ist.
 */
export const WorksiteDayTeamEntrySchema = z.strictObject({
  employeeId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type WorksiteDayTeamEntry = z.infer<typeof WorksiteDayTeamEntrySchema>;

/**
 * Die zwei Teamregeln — einmal geschrieben, von beiden Kommandos benutzt.
 *
 * 1. Dasselbe `(employeeId, interval)`-Paar darf nicht zweimal vorkommen.
 * 2. Zwei Intervalle DERSELBEN Person duerfen sich nicht ueberlappen.
 *
 * Getrennte, nicht ueberlappende Intervalle derselben Person bleiben ausdruecklich
 * erlaubt: jemand steht vormittags und nachmittags auf derselben Baustelle, und
 * das ist ein normaler Tag, kein Konflikt (Confluence 41484289 §2 Nr. 4).
 *
 * ## Warum das Duplikat VOR der Ueberlappung geprueft wird
 *
 * Ein identisches Paar ueberlappt sich selbst. Ohne Vorrang traege der
 * Doppeleintrag die Ueberlappungsmeldung, und die Planerin suchte nach einer
 * Zeitkollision, wo sie in Wahrheit zweimal dieselbe Zeile abgeschickt hat.
 *
 * ## Warum Zeichenketten verglichen werden und nicht `Date`
 *
 * `InstantSchema` laesst genau EINE Schreibweise zu: UTC, drei Nachkommastellen,
 * `Z`. Damit haben alle Werte dieselbe Laenge und dieselbe Stellenordnung, und
 * die lexikografische Reihenfolge IST die zeitliche. Ein `Date.parse` waere ein
 * zweiter Weg zur selben Aussage — und einer, der bei einem kaputten Wert still
 * `NaN` liefert, womit jeder Vergleich `false` ergaebe und die Regel schwiege.
 */
function pruefeTeamregeln(eintraege: readonly WorksiteDayTeamEntry[], ctx: z.RefinementCtx): void {
  for (let i = 0; i < eintraege.length; i += 1) {
    for (let j = i + 1; j < eintraege.length; j += 1) {
      const a = eintraege[i];
      const b = eintraege[j];
      if (a === undefined || b === undefined) continue;
      if (a.employeeId !== b.employeeId) continue;

      if (a.interval.startUtc === b.interval.startUtc && a.interval.endUtc === b.interval.endUtc) {
        ctx.addIssue({
          code: "custom",
          path: [j],
          message:
            "Derselbe Eintrag steht zweimal im Team: gleiche Person, gleiches Intervall. " +
            "Gemeint ist vermutlich ein zweites, anderes Intervall.",
        });
        continue;
      }

      if (a.interval.startUtc < b.interval.endUtc && b.interval.startUtc < a.interval.endUtc) {
        ctx.addIssue({
          code: "custom",
          path: [j],
          message:
            "Zwei Intervalle derselben Person ueberlappen sich. Getrennte Intervalle am " +
            "selben Tag sind erlaubt, sich ueberschneidende nicht.",
        });
      }
    }
  }
}

/**
 * Das Team eines Kommandos: mindestens EINE Person, und die Regeln oben.
 *
 * `min(1)` ist eine Produktentscheidung, keine Vorsicht: Confluence 41484289
 * §2 Nr. 8 verlangt, dass ein leerer Baustellentag nicht still entsteht. Die
 * ANTWORT darf `[]` trotzdem tragen — siehe {@link WorksiteDayDtoSchema}.
 *
 * Die Regeln sitzen am Array und nicht am umgebenden Kommando. Das ist kein
 * Stil: `z.toJSONSchema` gibt fuer ein Objekt mit `superRefine` weiterhin
 * `additionalProperties: false` aus, aber die Regel gehoert fachlich zur Liste,
 * und so tragen beide Kommandos sie ohne eine zweite Ableitung.
 */
export const WorksiteDayTeamCommandSchema = z
  .array(WorksiteDayTeamEntrySchema)
  .min(1, "Ein Baustellentag wird nicht ohne Team angelegt oder geleert")
  .superRefine(pruefeTeamregeln);
```

**Step 4: Gruen sehen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/worksite-day-schemas.test.ts
```

Erwartet: `Test Files 1 passed (1)`, `Tests 8 passed (8)`.

**Step 5: Checkpoint** — `git status --short` zeigt zusaetzlich ` M packages/contracts/src/planning/schemas.ts` und `?? packages/contracts/test/worksite-day-schemas.test.ts`.

---

### Task 3: Antwortform — `WorksiteDayTeamMemberSchema` und `WorksiteDayDtoSchema` (stabile Id ≠ Revision)

**Files:**

- Modify: `packages/contracts/src/planning/schemas.ts` (nach `WorksiteDayTeamCommandSchema`)
- Test: `packages/contracts/test/worksite-day-schemas.test.ts` (Import + Helfer + zwei `describe`)

**Step 1: Failing Test schreiben** — Import erweitern:

```ts
import {
  WorksiteDayDtoSchema,
  WorksiteDayTeamCommandSchema,
  WorksiteDayTeamEntrySchema,
  WorksiteDayTeamMemberSchema,
} from "../src/planning/schemas.js";
```

Nach `const TAG = "2026-08-03";` den Helfer und nach dem ersten `describe` die zwei neuen Bloecke anhaengen:

```ts
function baustellentag(team: unknown = []): Record<string, unknown> {
  return {
    worksiteDayId: WORKSITE_DAY_ID,
    configurationId: CONFIGURATION_ID,
    worksiteId: WORKSITE_ID,
    localDate: TAG,
    lockVersion: 0,
    team,
  };
}
```

```ts
describe("WorksiteDayDto", () => {
  it("traegt Identitaet und Konfigurationsrevision unabhaengig voneinander", () => {
    const dto = WorksiteDayDtoSchema.parse(baustellentag());
    expect(dto.worksiteDayId).toBe(WORKSITE_DAY_ID);
    expect(dto.configurationId).toBe(CONFIGURATION_ID);
    expect(dto.worksiteDayId).not.toBe(dto.configurationId);

    // Die eigentliche Aussage: vertauscht ergibt ein ANDERES Objekt. Waere eins
    // ein Alias des anderen, waeren beide Ergebnisse gleich.
    const vertauscht = WorksiteDayDtoSchema.parse({
      ...baustellentag(),
      worksiteDayId: CONFIGURATION_ID,
      configurationId: WORKSITE_DAY_ID,
    });
    expect(vertauscht).not.toEqual(dto);
    expect(vertauscht.worksiteDayId).toBe(CONFIGURATION_ID);
  });

  it("verlangt BEIDE Ids — ohne Revision ist der Tag nicht adressierbar, ohne Identitaet nicht wiedererkennbar", () => {
    const { configurationId: _c, ...ohneRevision } = baustellentag();
    const { worksiteDayId: _w, ...ohneIdentitaet } = baustellentag();
    expect(WorksiteDayDtoSchema.safeParse(ohneRevision).success).toBe(false);
    expect(WorksiteDayDtoSchema.safeParse(ohneIdentitaet).success).toBe(false);
  });

  it("nimmt ein leeres Team an", () => {
    expect(WorksiteDayDtoSchema.safeParse(baustellentag([])).success).toBe(true);
  });

  it("nimmt ein Teammitglied mit Assignment-Id an", () => {
    const mitglied = { assignmentId: EINSATZ_1, employeeId: PERSON_A, interval: FRUEH };
    expect(WorksiteDayTeamMemberSchema.safeParse(mitglied).success).toBe(true);
    expect(WorksiteDayDtoSchema.safeParse(baustellentag([mitglied])).success).toBe(true);
  });

  it("verlangt lockVersion als ganze Zahl ab null", () => {
    expect(WorksiteDayDtoSchema.safeParse({ ...baustellentag(), lockVersion: 0 }).success).toBe(
      true,
    );
    expect(WorksiteDayDtoSchema.safeParse({ ...baustellentag(), lockVersion: -1 }).success).toBe(
      false,
    );
    expect(WorksiteDayDtoSchema.safeParse({ ...baustellentag(), lockVersion: 1.5 }).success).toBe(
      false,
    );
  });

  it("lehnt einen kalendarisch unmoeglichen localDate ab", () => {
    expect(
      WorksiteDayDtoSchema.safeParse({ ...baustellentag(), localDate: "2026-02-30" }).success,
    ).toBe(false);
  });
});
```

Hinweis zu `_c`/`_w`: ESLint-Regel `no-unused-vars` mit `ignoreRestSiblings`? Falls Lint in Task 11 die beiden meldet, statt dessen `delete`-frei so schreiben: `const ohneRevision = Object.fromEntries(Object.entries(baustellentag()).filter(([k]) => k !== "configurationId"));`.

**Step 2: Rot sehen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/worksite-day-schemas.test.ts
```

Erwartet: `Test Files 1 failed (1)`; die 6 neuen Faelle rot, Fehler nennt `WorksiteDayDtoSchema`.

**Step 3: Implementieren** — nach `WorksiteDayTeamCommandSchema` einfuegen:

```ts
/**
 * Ein Teammitglied, wie es die ANTWORT traegt — mit der Assignment-Id.
 *
 * Sie ist die Bruecke zur bestehenden Assignment-Projektion: dieselbe Zuweisung
 * erscheint einmal unter `assignments` und einmal hier. Das Fenster prueft, dass
 * beide Seiten dasselbe sagen (siehe {@link PlanningWindowSchema}).
 */
export const WorksiteDayTeamMemberSchema = z.strictObject({
  assignmentId: IdSchema,
  employeeId: IdSchema,
  interval: TimeIntervalDtoSchema,
});

export type WorksiteDayTeamMember = z.infer<typeof WorksiteDayTeamMemberSchema>;

/**
 * Ein Baustellentag, wie ihn die Antwort zeigt.
 *
 * ## Zwei Ids, zwei Lebensdauern — und keine ist ein Alias der anderen
 *
 * `worksiteDayId` ist die IDENTITAET: eine Zeile je (Organisation, Baustelle,
 * lokaler Tag), versionsuebergreifend stabil (Migration `0019`). Sie ueberlebt
 * jede Veroeffentlichung. `configurationId` ist die REVISION: der Planungsstand
 * genau dieses Tages in genau einer Planversion. Wird eine Version kopiert,
 * entsteht eine NEUE Konfiguration auf DERSELBEN Identitaet.
 *
 * Wer die beiden zusammenlegt, verliert genau die Faehigkeit, um derentwillen
 * es sie gibt: denselben Tag ueber Draft -> Publish -> Folgedraft
 * wiederzuerkennen. `UpdateWorksiteDayTeamCommandSchema` adressiert deshalb die
 * IDENTITAET und nennt die Revision gar nicht.
 *
 * ## Warum `team` hier leer sein darf
 *
 * Die Kommandos verbieten `[]`, dieser Vertrag erlaubt es — die Asymmetrie ist
 * Absicht. Ein Antwortschema, das den leeren Tag ablehnt, macht aus EINER
 * unvollstaendigen Zeile eine unlesbare GESAMTE Planungsantwort: der Client
 * verwirft dann das ganze Fenster und die Planerin sieht nichts mehr. Die
 * Vollstaendigkeit eines Tages ist eine Publish-Bedingung, keine Lesebedingung.
 */
export const WorksiteDayDtoSchema = z.strictObject({
  /** Stabile Identitaet des Baustellentags. Ueberlebt jede Planversion. */
  worksiteDayId: IdSchema,
  /** Die konkrete revisionsgebundene Konfiguration in EINER Planversion. */
  configurationId: IdSchema,
  worksiteId: IdSchema,
  localDate: LocalDateSchema,
  /** Fortschreibungszaehler der Konfiguration; `expectedLockVersion` vergleicht dagegen. */
  lockVersion: z.number().int().min(0),
  team: z.array(WorksiteDayTeamMemberSchema),
});

export type WorksiteDayDto = z.infer<typeof WorksiteDayDtoSchema>;
```

**Step 4: Gruen sehen** — gleicher Befehl; erwartet `Test Files 1 passed (1)`, `Tests 14 passed (14)`.

**Step 5: Checkpoint** — `git status --short` unveraendert gegenueber Task 2 (dieselben 5 Pfade).

---

### Task 4: Die beiden Kommandos — `PlanWorksiteDayCommandSchema`, `UpdateWorksiteDayTeamCommandSchema`

**Files:**

- Modify: `packages/contracts/src/planning/schemas.ts` (am Dateiende, nach `PublishedPlanVersionSchema`)
- Test: `packages/contracts/test/worksite-day-schemas.test.ts` (Import + Helfer + drei `describe`)
- Test: `packages/contracts/test/iso-week-key.test.ts` (Import + zwei `STELLEN`-Zeilen)

**Step 1: Failing Tests schreiben** — Import erweitern:

```ts
import {
  PlanWorksiteDayCommandSchema,
  UpdateWorksiteDayTeamCommandSchema,
  WorksiteDayDtoSchema,
  WorksiteDayTeamCommandSchema,
  WorksiteDayTeamEntrySchema,
  WorksiteDayTeamMemberSchema,
} from "../src/planning/schemas.js";
```

Helfer neben `baustellentag`:

```ts
function kommando(team: unknown): unknown {
  return { weekKey: WOCHE, worksiteId: WORKSITE_ID, localDate: TAG, team };
}

function teamAenderung(team: unknown): unknown {
  return { weekKey: WOCHE, worksiteDayId: WORKSITE_DAY_ID, expectedLockVersion: 0, team };
}
```

Drei Bloecke anhaengen:

```ts
describe("Kommando/Antwort-Asymmetrie beim leeren Team", () => {
  it("lehnt team: [] im PlanWorksiteDayCommand ab", () => {
    expect(PlanWorksiteDayCommandSchema.safeParse(kommando([])).success).toBe(false);
  });

  it("lehnt team: [] im UpdateWorksiteDayTeamCommand ab", () => {
    expect(UpdateWorksiteDayTeamCommandSchema.safeParse(teamAenderung([])).success).toBe(false);
  });

  it("nimmt team: [] im WorksiteDayDto an", () => {
    expect(WorksiteDayDtoSchema.safeParse(baustellentag([])).success).toBe(true);
  });
});

describe("UpdateWorksiteDayTeamCommand adressiert die stabile Identitaet", () => {
  it("nimmt weekKey, worksiteDayId, expectedLockVersion und team an", () => {
    const ergebnis = UpdateWorksiteDayTeamCommandSchema.safeParse(
      teamAenderung([{ employeeId: PERSON_A, interval: FRUEH }]),
    );
    expect(ergebnis.success).toBe(true);
  });

  it("kennt weder configurationId noch localDate", () => {
    // Beide waeren stille Zweitwahrheiten: die Revision ist durch weekKey
    // eindeutig (hoechstens ein Draft je Woche, 41484289 §4), der Stand durch
    // expectedLockVersion, der Tag steht an der Identitaet. Ein Kommando, das
    // sie mitschickt, koennte ihnen widersprechen.
    const basis = teamAenderung([{ employeeId: PERSON_A, interval: FRUEH }]) as Record<
      string,
      unknown
    >;
    expect(
      UpdateWorksiteDayTeamCommandSchema.safeParse({ ...basis, configurationId: CONFIGURATION_ID })
        .success,
    ).toBe(false);
    expect(UpdateWorksiteDayTeamCommandSchema.safeParse({ ...basis, localDate: TAG }).success).toBe(
      false,
    );
  });

  it("verlangt expectedLockVersion als ganze Zahl ab null", () => {
    const team = [{ employeeId: PERSON_A, interval: FRUEH }];
    for (const wert of [-1, 1.5, "0", null, undefined]) {
      expect(
        UpdateWorksiteDayTeamCommandSchema.safeParse({
          ...(teamAenderung(team) as Record<string, unknown>),
          expectedLockVersion: wert,
        }).success,
        `expectedLockVersion ${JSON.stringify(wert)} wurde angenommen`,
      ).toBe(false);
    }
  });

  it("wendet dieselben Teamregeln an wie das Anlegekommando", () => {
    expect(
      UpdateWorksiteDayTeamCommandSchema.safeParse(
        teamAenderung([
          { employeeId: PERSON_A, interval: FRUEH },
          { employeeId: PERSON_A, interval: UEBERLAPPEND },
        ]),
      ).success,
    ).toBe(false);
  });
});

describe("Striktheit der neuen Schemata", () => {
  /**
   * ## Warum das ein eigener Fall ist und nicht der Drift-Test genuegt
   *
   * `openapi-drift.test.ts` sichert zu, dass jedes Antwortobjekt im erzeugten
   * Dokument `additionalProperties: false` traegt. Fuer DIESE Eigenschaft misst
   * das nichts: gemessen mit zod 4.4.3 gibt `z.toJSONSchema` fuer `z.object` und
   * `z.strictObject` dasselbe `additionalProperties: false` aus. Der Unterschied
   * existiert nur zur LAUFZEIT — `z.object` entfernt einen unbekannten Schluessel
   * still und meldet Erfolg. Faellt eines dieser Schemata auf `z.object` zurueck,
   * bliebe `v1.json` byteweise gleich und der Drift-Test gruen, waehrend ein
   * undokumentiertes Feld durch die Leitung ginge.
   *
   * Geprueft wird deshalb das Verhalten, tabellengetrieben, damit ein spaeter
   * hinzugefuegtes Schema als fehlende Zeile auffaellt und nicht als Luecke.
   */
  const STRENGE: ReadonlyArray<{
    readonly name: string;
    readonly schema: { safeParse: (wert: unknown) => { success: boolean } };
    readonly gueltig: () => Record<string, unknown>;
  }> = [
    {
      name: "WorksiteDayTeamEntrySchema",
      schema: WorksiteDayTeamEntrySchema,
      gueltig: () => ({ employeeId: PERSON_A, interval: FRUEH }),
    },
    {
      name: "WorksiteDayTeamMemberSchema",
      schema: WorksiteDayTeamMemberSchema,
      gueltig: () => ({ assignmentId: EINSATZ_1, employeeId: PERSON_A, interval: FRUEH }),
    },
    {
      name: "WorksiteDayDtoSchema",
      schema: WorksiteDayDtoSchema,
      gueltig: () => baustellentag(),
    },
    {
      name: "PlanWorksiteDayCommandSchema",
      schema: PlanWorksiteDayCommandSchema,
      gueltig: () =>
        kommando([{ employeeId: PERSON_A, interval: FRUEH }]) as Record<string, unknown>,
    },
    {
      name: "UpdateWorksiteDayTeamCommandSchema",
      schema: UpdateWorksiteDayTeamCommandSchema,
      gueltig: () =>
        teamAenderung([{ employeeId: PERSON_A, interval: FRUEH }]) as Record<string, unknown>,
    },
  ];

  it("deckt jedes neue Objektschema ab — sonst misst diese Tabelle zu wenig", () => {
    // Vakanzschutz: ohne diese Zeile waere die Tabelle auch dann gruen, wenn sie
    // versehentlich leer liefe oder ein Schema stillschweigend herausfiele.
    expect(STRENGE.map((s) => s.name)).toEqual([
      "WorksiteDayTeamEntrySchema",
      "WorksiteDayTeamMemberSchema",
      "WorksiteDayDtoSchema",
      "PlanWorksiteDayCommandSchema",
      "UpdateWorksiteDayTeamCommandSchema",
    ]);
  });

  for (const eintrag of STRENGE) {
    it(`${eintrag.name} nimmt seinen gueltigen Rumpf an und lehnt einen Fremdschluessel ab`, () => {
      // Beide Richtungen. Ohne die positive Haelfte waere die negative auch dann
      // gruen, wenn der Rumpf aus einem ganz anderen Grund durchfaellt.
      expect(eintrag.schema.safeParse(eintrag.gueltig()).success).toBe(true);
      expect(
        eintrag.schema.safeParse({ ...eintrag.gueltig(), fremdesFeld: "geheim" }).success,
        `${eintrag.name} verschluckt unbekannte Schluessel — z.object statt z.strictObject?`,
      ).toBe(false);
    });
  }
});
```

In `iso-week-key.test.ts` Import (Zeile 115 ff.) erweitern und `WORKSITE_DAY_ID` neben die anderen Ids setzen:

```ts
import {
  CreateAssignmentCommandSchema,
  PlanWorksiteDayCommandSchema,
  PlanningWindowQuerySchema,
  PlanningWindowSchema,
  PublishPlanCommandSchema,
  PublishedPlanVersionSchema,
  UpdateWorksiteDayTeamCommandSchema,
  ValidatePlanCommandSchema,
} from "../src/planning/schemas.js";
```

```ts
const WORKSITE_DAY_ID = "00000000-0000-4000-8000-0000009010a1";
```

Am Ende des `STELLEN`-Arrays (nach der `SelectablePlanVersionSchema`-Zeile) zwei Eintraege:

```ts
  {
    // EYT-147 M2. Beide Tagescommands tragen die Woche aus demselben Grund wie
    // `CreateAssignmentCommandSchema`: sie ist die Woche, die die Planerin
    // GEOEFFNET hat, und der Server vergleicht sie mit der, die er selbst aus
    // dem Tag ausrechnet.
    name: "PlanWorksiteDayCommandSchema",
    schema: PlanWorksiteDayCommandSchema,
    baue: (weekKey) => ({
      weekKey,
      worksiteId: WORKSITE_ID,
      localDate: "2026-08-03",
      // Mindestens ein Eintrag: ein Baustellentag ohne Team wird nicht angelegt.
      team: [{ employeeId: EMPLOYEE_ID, interval: { startUtc: INSTANT, endUtc: INSTANT_SPAETER } }],
    }),
  },
  {
    name: "UpdateWorksiteDayTeamCommandSchema",
    schema: UpdateWorksiteDayTeamCommandSchema,
    baue: (weekKey) => ({
      weekKey,
      worksiteDayId: WORKSITE_DAY_ID,
      expectedLockVersion: 0,
      team: [{ employeeId: EMPLOYEE_ID, interval: { startUtc: INSTANT, endUtc: INSTANT_SPAETER } }],
    }),
  },
```

(`INSTANT`, `INSTANT_SPAETER`, `EMPLOYEE_ID`, `WORKSITE_ID` existieren dort bereits — mit `grep -n 'INSTANT_SPAETER' packages/contracts/test/iso-week-key.test.ts` pruefen.)

**Step 2: Rot sehen**

```bash
pnpm --filter @easytree/contracts exec vitest run test/worksite-day-schemas.test.ts test/iso-week-key.test.ts
```

Erwartet: `Test Files 2 failed (2)`. Beide Dateien rot, weil die Kommandoschemata fehlen. Wortlaut ins Protokoll.

**Step 3: Implementieren** — am Ende von `schemas.ts` nach `export type PublishedPlanVersion …` anhaengen:

```ts
/**
 * Einen Baustellentag anlegen (EYT-147 M2).
 *
 * Adressiert wird die Baustelle und der lokale Tag — nicht eine Id, denn die
 * gibt es noch nicht. Der Server loest daraus die Identitaet auf (anlegen oder
 * finden) und haengt sie an die Konfiguration des Wochenentwurfs. Welche
 * Planversion das ist, entscheidet ausschliesslich er ueber
 * `app.lock_week_draft(weekKey)` (Confluence 41484289 §5); ein Kommando, das
 * die Revision mitbraechte, koennte ihr widersprechen.
 *
 * `weekKey` ist dieselbe Redundanz wie bei {@link CreateAssignmentCommandSchema}:
 * die Woche, die die Planerin GEOEFFNET hat. Der Server rechnet sie aus
 * `localDate` in der Zone der Organisation selbst aus und vergleicht. Ohne das
 * Feld landete ein Tag am Wochenrand still in einer Woche, die niemand ansieht.
 */
export const PlanWorksiteDayCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  worksiteId: IdSchema,
  localDate: LocalDateSchema,
  team: WorksiteDayTeamCommandSchema,
});

export type PlanWorksiteDayCommand = z.infer<typeof PlanWorksiteDayCommandSchema>;

/**
 * Die Tagesbesetzung eines bestehenden Baustellentags ersetzen (EYT-147 M2).
 *
 * ## Was hier bewusst FEHLT
 *
 * Kein `configurationId` und kein `localDate`. Beide waeren stille
 * Zweitwahrheiten: die Revision ist durch `weekKey` eindeutig — hoechstens ein
 * unveroeffentlichter Entwurf je Woche (Confluence 41484289 §4) —, und der Tag
 * haengt unveraenderlich an der Identitaet. Ein Kommando, das sie mitschickte,
 * koennte ihnen widersprechen — und dann muesste jemand entscheiden, welche
 * Angabe gewinnt. Diese Entscheidung gibt es hier nicht, weil die Frage nicht
 * gestellt werden kann.
 *
 * Adressiert wird deshalb die STABILE `worksiteDayId`. Sie ueberlebt
 * Draft -> Publish -> Folgedraft; eine Konfigurations-Id waere nach der
 * naechsten Veroeffentlichung ins Leere gelaufen, obwohl sich am Tag nichts
 * geaendert hat.
 *
 * `expectedLockVersion` ist die Stale-Erkennung, dieselbe Bauart wie
 * `expectedVersionId` beim Veroeffentlichen: der Client sagt, auf welchem Stand
 * er arbeitet. `lock_version` ist das Nebenlaeufigkeits-Token der
 * TAGESIDENTITAET, wird beim Kopieren in den Folgedraft uebernommen und nur
 * durch eine reale Tagesmutation erhoeht (Migration 0019, R-20: "genau EINE
 * Stale-Wahrheit je Tag"). Weicht der Server ab, hat jemand anders den Tag
 * zwischenzeitlich umgeplant, und das Kommando wird abgelehnt, statt fremde
 * Arbeit zu ueberschreiben.
 */
export const UpdateWorksiteDayTeamCommandSchema = z.strictObject({
  weekKey: IsoWeekKeySchema,
  worksiteDayId: IdSchema,
  expectedLockVersion: z.number().int().min(0),
  team: WorksiteDayTeamCommandSchema,
});

export type UpdateWorksiteDayTeamCommand = z.infer<typeof UpdateWorksiteDayTeamCommandSchema>;
```

**Step 4: Gruen sehen** — gleicher Befehl; erwartet `Test Files 2 passed (2)`; `worksite-day-schemas`: `Tests 27 passed (27)`.

**Step 5: Checkpoint** — `git status --short` zeigt zusaetzlich ` M packages/contracts/test/iso-week-key.test.ts` (jetzt 6 Pfade).

---

### Task 5: Fehlervokabular `WORKSITE_DAY_PROBLEM_TYPE`

**Files:**

- Modify: `packages/contracts/src/planning/schemas.ts` (Dateiende)
- Test: `packages/contracts/test/worksite-day-schemas.test.ts` (Import + ein `describe`)

**Step 1: Failing Test schreiben** — Import um `CONFLICT_CODE_VALUES` und `WORKSITE_DAY_PROBLEM_TYPE` erweitern (alphabetisch einsortieren), dann anhaengen:

```ts
describe("WORKSITE_DAY_PROBLEM_TYPE — Vokabular der Tagescommands", () => {
  it("folgt dem URN-Muster der Planung und traegt genau die fuenf M3/M4-Faelle", () => {
    // Dasselbe Muster wie PLANNING_ERROR_TYPE in apps/api
    // (planning-problem.filter.ts): urn:easytree:planning:<kebab>. M3/M4 IMPORTIEREN
    // diese Konstante, statt die Zeichenketten erneut zu tippen.
    expect(Object.keys(WORKSITE_DAY_PROBLEM_TYPE).sort()).toEqual([
      "DUPLICATE_WORKSITE_DAY",
      "INTERVAL_OUTSIDE_DAY",
      "STALE_WORKSITE_DAY",
      "WORKSITE_DAY_NOT_FOUND",
      "WORKSITE_DAY_TEAM_REQUIRED",
    ]);
    for (const urn of Object.values(WORKSITE_DAY_PROBLEM_TYPE)) {
      expect(urn).toMatch(/^urn:easytree:planning:[a-z-]+$/);
    }
    expect(new Set(Object.values(WORKSITE_DAY_PROBLEM_TYPE)).size).toBe(5);
  });

  it("fuehrt WORKSITE_DAY_INCOMPLETE NICHT — das ist ein reiner Publish-Typ (M5)", () => {
    // Ein unvollstaendiger Baustellentag ist beim Lesen und Bearbeiten voellig in
    // Ordnung und wird erst beim Veroeffentlichen zum Hindernis. Stuende er in
    // `CONFLICT_CODE_VALUES`, veroeffentlichte `v1.json` ihn als gewoehnlichen
    // Konfliktcode und ein Client duerfte ihn wie eine Ueberlappung behandeln.
    const alles = [...CONFLICT_CODE_VALUES, ...Object.keys(WORKSITE_DAY_PROBLEM_TYPE)].join(" ");
    expect(alles).not.toContain("WORKSITE_DAY_INCOMPLETE");
    expect(Object.values(WORKSITE_DAY_PROBLEM_TYPE).join(" ")).not.toContain(
      "worksite-day-incomplete",
    );
  });

  it("laesst die bestehende Konfliktcodeliste unveraendert", () => {
    // Gegenprobe zur Zeile darueber: ohne sie waere das Verbot auch dann gruen,
    // wenn jemand die Liste komplett leerte.
    expect([...CONFLICT_CODE_VALUES]).toEqual([
      "EMPLOYEE_INTERVAL_OVERLAP",
      "EMPLOYEE_WEEKLY_CAPACITY",
      "EMPLOYEE_INACTIVE",
      "WORKSITE_NOT_PUBLISHABLE",
    ]);
  });
});
```

**Step 2: Rot sehen** — `pnpm --filter @easytree/contracts exec vitest run test/worksite-day-schemas.test.ts` → `Test Files 1 failed (1)`, Fehler nennt `WORKSITE_DAY_PROBLEM_TYPE`.

**Step 3: Implementieren** — am Ende von `schemas.ts`:

```ts
/**
 * Die Problem-Types der Tagescommands — das VOKABULAR, nicht die Implementierung.
 *
 * Sie stehen hier, weil sie Teil des Transportvertrags sind: ein Client
 * unterscheidet daran, ob er neu laden (`STALE_WORKSITE_DAY`), den Tag suchen
 * (`WORKSITE_DAY_NOT_FOUND`) oder die Eingabe korrigieren muss. Die
 * Zuordnung Domainfehler -> URN gehoert dagegen an die HTTP-Naht in `apps/api`
 * (`PLANNING_ERROR_TYPE` in `planning-problem.filter.ts`) und entsteht mit der
 * Businesslogik (M3/M4) — die dort diese Konstante IMPORTIERT, damit die URNs
 * nicht an zwei Stellen stehen.
 *
 * Damit diese Liste kein blosser Kommentar bleibt, wird sie in die
 * 409-Beschreibung der beiden Routen eingesetzt (`openapi/document.ts`) und ist
 * dadurch Teil des erzeugten `v1.json` — der Drift-Test schuetzt sie
 * byteweise mit.
 *
 * NICHT enthalten: `WORKSITE_DAY_INCOMPLETE`. Das ist ein
 * VEROEFFENTLICHUNGS-Problem und gehoert weder hierher noch in
 * {@link CONFLICT_CODE_VALUES} — ein unvollstaendiger Tag ist beim Lesen und
 * Bearbeiten voellig in Ordnung und wird erst beim Publish zum Hindernis (M5).
 */
export const WORKSITE_DAY_PROBLEM_TYPE = {
  /** Die genannte `worksiteDayId` gibt es in dieser Organisation nicht. */
  WORKSITE_DAY_NOT_FOUND: "urn:easytree:planning:worksite-day-not-found",
  /** `expectedLockVersion` passt nicht: der Tag wurde zwischenzeitlich umgeplant. */
  STALE_WORKSITE_DAY: "urn:easytree:planning:stale-worksite-day",
  /** Fuer diese Baustelle und diesen Tag existiert bereits ein Baustellentag. */
  DUPLICATE_WORKSITE_DAY: "urn:easytree:planning:duplicate-worksite-day",
  /** Ein Intervall liegt ausserhalb des lokalen Tages, den es besetzen soll. */
  INTERVAL_OUTSIDE_DAY: "urn:easytree:planning:interval-outside-day",
  /** Das Kommando kam ohne Team an; ein leerer Tag entsteht nicht still. */
  WORKSITE_DAY_TEAM_REQUIRED: "urn:easytree:planning:worksite-day-team-required",
} as const;

export type WorksiteDayProblemType =
  (typeof WORKSITE_DAY_PROBLEM_TYPE)[keyof typeof WORKSITE_DAY_PROBLEM_TYPE];
```

**Step 4: Gruen sehen** — `Test Files 1 passed (1)`, `Tests 30 passed (30)`.

**Step 5: Checkpoint** — `git status --short` unveraendert (6 Pfade).

---

### Task 6: `PlanningWindow.worksiteDays[]` — additiv, mit Querbezuegen

**Files:**

- Modify: `packages/contracts/src/planning/schemas.ts` (`PlanningWindowSchema`: ein Feld, ein Block im `superRefine`)
- Test: `packages/contracts/test/worksite-day-schemas.test.ts` (Import `PlanningWindowSchema` + Helfer + ein `describe`)

**Step 1: Failing Test schreiben** — Import um `PlanningWindowSchema` erweitern; Helfer und Block anhaengen:

```ts
/** Ein Fenster, das ohne die WorksiteDay-Erweiterung schon gueltig ist. */
function fenster(zusatz: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    weekKey: WOCHE,
    timeZone: "Europe/Berlin",
    assignments: [
      { id: EINSATZ_1, employeeId: PERSON_A, worksiteId: WORKSITE_ID, interval: FRUEH },
      { id: EINSATZ_2, employeeId: PERSON_B, worksiteId: WORKSITE_ID, interval: SPAET },
    ],
    sourceVersion: { id: ENTWURF_ID, state: "draft" },
    publishedVersionId: null,
    resources: {
      employees: [
        { id: PERSON_A, label: "Anna", active: true },
        { id: PERSON_B, label: "Bruno", active: true },
      ],
      worksites: [{ id: WORKSITE_ID, label: "Baustelle Nord", active: true }],
    },
    ...zusatz,
  };
}

function tagImFenster(team: unknown): Record<string, unknown> {
  return { ...baustellentag(team), worksiteId: WORKSITE_ID };
}

const MITGLIED_1 = { assignmentId: EINSATZ_1, employeeId: PERSON_A, interval: FRUEH };
const MITGLIED_2 = { assignmentId: EINSATZ_2, employeeId: PERSON_B, interval: SPAET };

describe("PlanningWindow.worksiteDays — additive Projektion", () => {
  it("bleibt ohne das Feld gueltig: Legacy-Assignments ohne Baustellentag", () => {
    // Die Kernzusage der Additivitaet. Der heutige Server sendet `worksiteDays`
    // nicht; seine Antwort muss weiterhin parsen.
    expect(PlanningWindowSchema.safeParse(fenster()).success).toBe(true);
  });

  it("nimmt ein vollstaendiges Fenster mit Assignments UND Baustellentagen an", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([MITGLIED_1, MITGLIED_2])] }),
    );
    expect(ergebnis.success).toBe(true);
  });

  it("nimmt ein leeres worksiteDays-Array an", () => {
    expect(PlanningWindowSchema.safeParse(fenster({ worksiteDays: [] })).success).toBe(true);
  });

  it("lehnt einen Baustellentag auf einer unbekannten Baustelle ab", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({
        worksiteDays: [{ ...tagImFenster([MITGLIED_1]), worksiteId: WORKSITE_FREMD }],
      }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt eine unbekannte assignmentId im Team ab", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({
        worksiteDays: [
          tagImFenster([{ ...MITGLIED_1, assignmentId: "00000000-0000-4000-8000-0000000000ff" }]),
        ],
      }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt ein Teammitglied ab, dessen employeeId dem Assignment widerspricht", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([{ ...MITGLIED_1, employeeId: PERSON_B }])] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt ein Teammitglied ab, dessen Intervall dem Assignment widerspricht", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([{ ...MITGLIED_1, interval: SPAET }])] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt dieselbe Assignment-Id in zwei Baustellentagen ab", () => {
    const zweiterTag = {
      ...tagImFenster([MITGLIED_1]),
      worksiteDayId: "00000000-0000-4000-8000-00000000d002",
      configurationId: "00000000-0000-4000-8000-00000000c002",
      localDate: "2026-08-04",
    };
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([MITGLIED_1]), zweiterTag] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt Baustellentage ohne sourceVersion ab", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({
        assignments: [],
        sourceVersion: null,
        publishedVersionId: null,
        worksiteDays: [tagImFenster([])],
      }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("laesst die bestehende Assignment-Projektion unangetastet", () => {
    // Gegenprobe: die alten Regeln muessen weiter feuern, sonst haette die
    // Erweiterung sie ersetzt statt ergaenzt.
    const unaufloesbar = PlanningWindowSchema.safeParse(
      fenster({
        assignments: [
          { id: EINSATZ_1, employeeId: PERSON_A, worksiteId: WORKSITE_FREMD, interval: FRUEH },
        ],
      }),
    );
    expect(unaufloesbar.success).toBe(false);

    const ohneHerkunft = PlanningWindowSchema.safeParse(
      fenster({ sourceVersion: null, publishedVersionId: null }),
    );
    expect(ohneHerkunft.success).toBe(false);
  });
});
```

**Step 2: Rot sehen** — gleicher Befehl. Erwartet: `Test Files 1 failed (1)` und **genau ZWEI rote Faelle**, `Tests 2 failed | 38 passed (40)`:

```
× nimmt ein vollstaendiges Fenster mit Assignments UND Baustellentagen an
× nimmt ein leeres worksiteDays-Array an
```

Das sind die beiden Faelle, die `worksiteDays` senden UND `success === true` erwarten; `z.strictObject` lehnt den noch unbekannten Schluessel ab.

**Die uebrigen fuenf sendenden Faelle sind in dieser Phase gruen — aus dem FALSCHEN Grund.** Sie sichern `success === false` zu, und `strictObject` liefert dieses `false` schon wegen des unbekannten Schluessels, nicht wegen der Querbezugsregel. Ihre Rot-Phase ist damit keine Evidenz; die Regel wird erst durch **GM-5 in Task 13** gemessen (dort gemessen 03.09.2026: Block entfernt ⇒ 6 Faelle rot). Wer diese Zeile liest und den Block spaeter anfasst, braucht GM-5, nicht diesen Schritt. Zaehlung verbatim ins Protokoll.

**Step 3: Implementieren** — in `PlanningWindowSchema` nach `resources: PlanningResourcesSchema,` das Feld einfuegen:

```ts
    /**
     * Die Baustellentage dieser Woche (EYT-147 M2) — ADDITIV, deshalb optional.
     *
     * Fehlt das Feld, ist die Antwort ein Bestandsfenster ohne Baustellentage
     * und bleibt gueltig. Das ist keine Nachlaessigkeit, sondern die Bedingung
     * dafuer, dass diese Erweiterung additiv IST: der heutige Server sendet das
     * Feld nicht, und ein Pflichtfeld haette seine Antwort ab sofort als
     * Vertragsbruch verworfen — die Planung waere leer, ohne dass sich am
     * Server etwas geaendert haette.
     *
     * `.default([])` waere hier die falsche Abkuerzung: gemessen mit zod 4.4.3
     * fuehrt `z.toJSONSchema` ein Feld mit Vorgabewert unter `required`. Das
     * veroeffentlichte Dokument behauptete dann ein Feld, das nie mitkommt.
     *
     * Die bestehende `assignments`-Projektion bleibt unberuehrt: Zuweisungen
     * ohne Baustellentag sind weiterhin gueltig (Migration `0019` legt die
     * Referenz ausdruecklich NULLABLE an, ohne Backfill).
     */
    worksiteDays: z.array(WorksiteDayDtoSchema).optional(),
```

Im `superRefine` direkt nach der `fenster.assignments.forEach(…)`-Schleife und VOR `if (fenster.sourceVersion === null) {` einfuegen:

```ts
// Baustellentage (EYT-147 M2). Bewusst HIER und nicht am Ende dieser
// Funktion: die Zweige unten enden jeweils mit `return`, und angehaengte
// Regeln liefen bei `sourceVersion === null` oder `"published"` nie —
// ausgerechnet der Fall, den Regel (6) pruefen soll.
const tage = fenster.worksiteDays;
if (tage !== undefined) {
  // Jede Zuweisung EINMAL nachschlagbar machen. Ein lineares Suchen je
  // Teammitglied waere nicht nur quadratisch, es verleitete auch dazu, den
  // Treffer als Beweis zu nehmen — geprueft werden muss er trotzdem.
  const einsaetze = new Map(fenster.assignments.map((einsatz) => [einsatz.id, einsatz]));
  /** Assignment-Id -> Index des Tages, dessen Team sie zuerst nannte. */
  const belegtVon = new Map<string, number>();

  tage.forEach((tag, tagIndex) => {
    if (!bekannteBaustellen.has(tag.worksiteId)) {
      ctx.addIssue({
        code: "custom",
        path: ["worksiteDays", tagIndex, "worksiteId"],
        message:
          "Baustellentag verweist auf eine Baustelle, die nicht in resources.worksites steht — nicht aufloesbar.",
      });
    }

    tag.team.forEach((mitglied, mitgliedIndex) => {
      const pfad: (string | number)[] = ["worksiteDays", tagIndex, "team", mitgliedIndex];
      const einsatz = einsaetze.get(mitglied.assignmentId);

      if (einsatz === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [...pfad, "assignmentId"],
          message:
            "Teammitglied verweist auf eine Zuweisung, die nicht unter assignments steht. " +
            "Die Tageskarte zeigte damit eine Besetzung, die das Fenster selbst nicht kennt.",
        });
        return;
      }

      // Die Tageskarte und die Zuweisungsliste sind ZWEI Sichten auf
      // dieselbe Tatsache. Weichen sie ab, zeigt die Oberflaeche je nach
      // Ansicht etwas anderes an — und beide Male sieht es richtig aus.
      if (einsatz.employeeId !== mitglied.employeeId) {
        ctx.addIssue({
          code: "custom",
          path: [...pfad, "employeeId"],
          message: "Teammitglied und referenzierte Zuweisung nennen verschiedene Personen.",
        });
      }
      if (
        einsatz.interval.startUtc !== mitglied.interval.startUtc ||
        einsatz.interval.endUtc !== mitglied.interval.endUtc
      ) {
        ctx.addIssue({
          code: "custom",
          path: [...pfad, "interval"],
          message: "Teammitglied und referenzierte Zuweisung nennen verschiedene Intervalle.",
        });
      }

      const zuerst = belegtVon.get(mitglied.assignmentId);
      if (zuerst === undefined) {
        belegtVon.set(mitglied.assignmentId, tagIndex);
      } else {
        // Eine Zuweisung gehoert zu genau EINER Tageskonfiguration
        // (Migration `0019`: `assignments.worksite_day_configuration_id` ist
        // eine einzelne Spalte). Zweimal genannt hiesse, dieselbe Person
        // waere zur selben Zeit auf zwei Karten verplant.
        ctx.addIssue({
          code: "custom",
          path: [...pfad, "assignmentId"],
          message:
            `Dieselbe Zuweisung steht bereits im Team von worksiteDays[${zuerst}]. ` +
            "Eine Zuweisung gehoert zu genau einem Baustellentag.",
        });
      }
    });
  });

  if (tage.length > 0 && fenster.sourceVersion === null) {
    ctx.addIssue({
      code: "custom",
      path: ["worksiteDays"],
      message:
        "Ohne sourceVersion kann es keine Baustellentage geben — sie haetten keine Herkunft.",
    });
  }
}
```

**Step 4: Gruen sehen**

```bash
pnpm --filter @easytree/contracts exec vitest run
```

Erwartet: `Test Files 1 failed | 9 passed (10)`. **Rot ist ausschliesslich `openapi-drift.test.ts` › „das eingecheckte Dokument entspricht byteweise den Schemata“** — `PlanningWindowSchema` steht in `NAMED_SCHEMAS`, das erzeugte Dokument traegt jetzt `worksiteDays`, `v1.json` noch nicht. Das ist der Drift-Test bei der Arbeit und wird in Task 9 mit `openapi:write` aufgeloest; JEDE andere rote Datei ist ein Befund. `worksite-day-schemas`: `Tests 40 passed (40)`. `planning-window-provenance` und `primitives` bleiben gruen: das optionale Feld aendert keine alte Antwort.

**Step 5: Checkpoint** — `git status --short`: 6 Pfade wie nach Task 4.

---

### Task 7: Oeffentliche Oberflaeche — Exporte in `index.ts`

**Files:**

- Modify: `packages/contracts/src/index.ts:26-58`
- Test: `packages/contracts/test/public-surface.test.ts` (ein `it` anhaengen)

**Step 1: Failing Test schreiben** — im bestehenden `describe` anhaengen:

```ts
it("fuehrt die WorksiteDay-Bausteine von EYT-147 M2 namentlich", () => {
  // Ein vergessener Export fiele sonst erst in apps/web auf — als Typfehler in
  // einem anderen Paket, weit weg von der Ursache.
  for (const name of [
    "LocalDateSchema",
    "WorksiteDayTeamEntrySchema",
    "WorksiteDayTeamCommandSchema",
    "WorksiteDayTeamMemberSchema",
    "WorksiteDayDtoSchema",
    "PlanWorksiteDayCommandSchema",
    "UpdateWorksiteDayTeamCommandSchema",
    "WORKSITE_DAY_PROBLEM_TYPE",
  ]) {
    expect(names, `${name} fehlt in src/index.ts`).toContain(name);
  }
});
```

**Step 2: Rot sehen** — `pnpm --filter @easytree/contracts exec vitest run test/public-surface.test.ts` → `Test Files 1 failed (1)`, Meldung `WorksiteDayTeamEntrySchema fehlt in src/index.ts` (LocalDateSchema ist seit Task 1 da).

**Step 3: Implementieren** — die beiden `planning/schemas.js`-Exportbloecke in `index.ts` ersetzen:

```ts
export {
  AssignmentDtoSchema,
  CONFLICT_CODE_VALUES,
  ConflictCodeSchema,
  CreateAssignmentCommandSchema,
  PlanValidationResultSchema,
  PlanWorksiteDayCommandSchema,
  PlanningConflictDtoSchema,
  IsoWeekKeySchema,
  PlanningResourceSchema,
  PlanningResourcesSchema,
  PlanningWindowQuerySchema,
  PlanningWindowSchema,
  SourceVersionSchema,
  PublishPlanCommandSchema,
  PublishedPlanVersionSchema,
  TimeIntervalDtoSchema,
  UpdateWorksiteDayTeamCommandSchema,
  ValidatePlanCommandSchema,
  WORKSITE_DAY_PROBLEM_TYPE,
  WorksiteDayDtoSchema,
  WorksiteDayTeamCommandSchema,
  WorksiteDayTeamEntrySchema,
  WorksiteDayTeamMemberSchema,
} from "./planning/schemas.js";
export type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanValidationResult,
  PlanWorksiteDayCommand,
  PlanningConflictDto,
  PlanningResource,
  PlanningResources,
  PlanningWindow,
  PlanningWindowQuery,
  SourceVersion,
  PublishPlanCommand,
  PublishedPlanVersion,
  TimeIntervalDto,
  UpdateWorksiteDayTeamCommand,
  ValidatePlanCommand,
  WorksiteDayDto,
  WorksiteDayProblemType,
  WorksiteDayTeamEntry,
  WorksiteDayTeamMember,
} from "./planning/schemas.js";
```

**Step 4: Gruen sehen** — gleicher Befehl → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.

**Step 5: Checkpoint** — `git status --short` zeigt zusaetzlich ` M packages/contracts/test/public-surface.test.ts` (7 Pfade).

---

### Task 8: Port, HTTP-Client, Mock — und die Konsumenten, die den Port stubben

Der Port `PlanningGateway` waechst um zwei Methoden. Das macht ALLE Implementierungen und alle Objektliterale vom Typ `PlanningGateway` zu Typfehlern: `HttpPlanningGateway`, `MockPlanningGateway` und vier Test-Stubs in `apps/web`. Reihenfolge: (a) Test rot am HTTP-Client, (b) Port + HTTP-Client, (c) Mock + Mock-Tests, (d) Web-Stubs, (e) typecheck ueber alle drei Pakete.

**Files:**

- Modify: `packages/contracts/src/planning/gateway.ts` (Import + zwei Methoden)
- Modify: `packages/contracts/src/http/planning-gateway.ts` (Import + zwei Methoden vor `private async send`)
- Modify: `packages/contracts/src/mock/planning.ts` (Imports, `MockPlanningState`, zwei Methoden + Helfer)
- Modify: `apps/web/test/dispositionswerkbank.test.tsx`, `apps/web/test/planning-window-view.test.tsx` (4 Stellen), `apps/web/test/werkbank-oberflaechenguards.test.tsx`
- Test: `packages/contracts/test/http-planning-gateway.test.ts`, `packages/contracts/test/planning-gateway.contract.test.ts`

**Step 1: Failing Test am HTTP-Client** — am Ende von `http-planning-gateway.test.ts` anhaengen (Helfer `BASE`, `Recorded`, `stubFetch`, `gatewayWith`, `KEY_A`, `IDEMPOTENCY_HEADER` existieren dort):

```ts
/**
 * Die Baustellentag-Kommandos (EYT-147 M2).
 *
 * Ohne diese Faelle war an den beiden neuen Methoden NICHTS bewacht: Pfad,
 * Methode, Idempotenzkopf und die 409-Deutung standen nur im Quelltext. Der
 * Drift-Test prueft das erzeugte DOKUMENT, der Konformitaetstest Dokument gegen
 * SERVERROUTEN — keiner von beiden sieht, wohin dieser Client tatsaechlich
 * greift. Ein Tippfehler im Pfad waere durch alle Gates gelaufen und erst in
 * einer Browserreise als 404 aufgefallen.
 */
const BAUSTELLENTAG = {
  worksiteDayId: "44444444-4444-4444-8444-444444444444",
  configurationId: "55555555-5555-4555-8555-555555555555",
  worksiteId: "66666666-6666-4666-8666-666666666666",
  localDate: "2026-08-03",
  lockVersion: 0,
  team: [],
} as const;

const ANLEGEN = {
  weekKey: "2026-W32",
  worksiteId: BAUSTELLENTAG.worksiteId,
  localDate: "2026-08-03",
  team: [
    {
      employeeId: "77777777-7777-4777-8777-777777777777",
      interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T10:00:00.000Z" },
    },
  ],
};

const TEAMWECHSEL = {
  weekKey: "2026-W32",
  worksiteDayId: BAUSTELLENTAG.worksiteDayId,
  expectedLockVersion: 0,
  team: ANLEGEN.team,
};

describe("HttpPlanningGateway — Baustellentag-Kommandos (EYT-147 M2)", () => {
  it("greift beim Anlegen auf POST /planung/baustellentage", async () => {
    const recorded: Recorded[] = [];
    const result = await gatewayWith(stubFetch(201, BAUSTELLENTAG, recorded)).planWorksiteDay(
      ANLEGEN,
      { idempotencyKey: KEY_A },
    );
    expect(result.ok).toBe(true);
    // Die Adresse ganz, nicht als Teilstring: `toContain` waere auch bei
    // "/planung/baustellentage/team" gruen und truege damit genau die
    // Verwechslung mit, gegen die dieser Fall existiert.
    expect(recorded[0]?.url).toBe(`${BASE}/planung/baustellentage`);
    expect(recorded[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(recorded[0]?.init?.body))).toEqual(ANLEGEN);
  });

  it("greift beim Teamwechsel auf POST /planung/baustellentage/team", async () => {
    const recorded: Recorded[] = [];
    const result = await gatewayWith(stubFetch(200, BAUSTELLENTAG, recorded)).updateWorksiteDayTeam(
      TEAMWECHSEL,
      { idempotencyKey: KEY_A },
    );
    expect(result.ok).toBe(true);
    expect(recorded[0]?.url).toBe(`${BASE}/planung/baustellentage/team`);
    expect(recorded[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(recorded[0]?.init?.body))).toEqual(TEAMWECHSEL);
  });

  it("sendet bei beiden Kommandos den Idempotenzschluessel", async () => {
    for (const aufruf of ["planWorksiteDay", "updateWorksiteDayTeam"] as const) {
      const recorded: Recorded[] = [];
      const gateway = gatewayWith(
        stubFetch(aufruf === "planWorksiteDay" ? 201 : 200, BAUSTELLENTAG, recorded),
      );
      await (aufruf === "planWorksiteDay"
        ? gateway.planWorksiteDay(ANLEGEN, { idempotencyKey: KEY_A })
        : gateway.updateWorksiteDayTeam(TEAMWECHSEL, { idempotencyKey: KEY_A }));
      const headers = recorded[0]?.init?.headers as Record<string, string> | undefined;
      expect(headers?.[IDEMPOTENCY_HEADER], `${aufruf} ohne Schluessel`).toBe(KEY_A);
    }
  });

  it("deutet 409 je Kommando verschieden: Teamwechsel ist STALE_VERSION", async () => {
    // Der Unterschied ist der ganze Punkt. Beim Anlegen gibt es keinen Stand,
    // auf dem der Client haette arbeiten koennen — ein 409 ist dort eine
    // fachliche Ablehnung. Beim Teamwechsel passte `expectedLockVersion` nicht,
    // und die Oberflaeche muss neu laden statt die Eingabe zu bemaengeln.
    const anlegen = await gatewayWith(stubFetch(409, null, [])).planWorksiteDay(ANLEGEN, {
      idempotencyKey: KEY_A,
    });
    expect(anlegen.ok).toBe(false);
    if (anlegen.ok) return;
    expect(anlegen.failure).toBe("REJECTED");

    const wechsel = await gatewayWith(stubFetch(409, null, [])).updateWorksiteDayTeam(TEAMWECHSEL, {
      idempotencyKey: KEY_A,
    });
    expect(wechsel.ok).toBe(false);
    if (wechsel.ok) return;
    expect(wechsel.failure).toBe("STALE_VERSION");
  });

  it("vertraut einer formal falschen Erfolgsantwort NICHT", async () => {
    // Dieselbe Zusicherung wie fuer das Fenster, jetzt fuer den Tagesvertrag:
    // ein 200 mit fremdem Rumpf ist ein gebrochener Vertrag, keine Nutzlast.
    const kaputt = { ...BAUSTELLENTAG, lockVersion: -1 };
    const result = await gatewayWith(stubFetch(200, kaputt, [])).updateWorksiteDayTeam(
      TEAMWECHSEL,
      { idempotencyKey: KEY_A },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("CONTRACT_VIOLATION");
  });
});
```

**Step 2: Rot sehen** — `pnpm --filter @easytree/contracts exec vitest run test/http-planning-gateway.test.ts` → `Test Files 1 failed (1)`, `TypeError: … planWorksiteDay is not a function`. Ins Protokoll.

**Step 3a: Port** — `packages/contracts/src/planning/gateway.ts`: Import erweitern und zwei Methoden anhaengen:

```ts
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanValidationResult,
  PlanWorksiteDayCommand,
  PlanningWindow,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  UpdateWorksiteDayTeamCommand,
  ValidatePlanCommand,
  WorksiteDayDto,
} from "./schemas.js";
```

```ts
  /**
   * Einen Baustellentag anlegen (EYT-147 M2).
   *
   * Antwortet mit dem angelegten Tag, nicht mit einer nackten Id: der Aufrufer
   * braucht `lockVersion` fuer die naechste Aenderung und `team` mit den
   * vergebenen Assignment-Ids, um die Karte zu zeichnen. Ein zweiter Leseaufruf
   * dafuer koennte bereits einen anderen Stand sehen.
   */
  planWorksiteDay(
    input: PlanWorksiteDayCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<WorksiteDayDto>>;
  /**
   * Die Tagesbesetzung eines bestehenden Baustellentags ersetzen (EYT-147 M2).
   *
   * Gibt denselben Typ zurueck wie das Anlegen — mit der FORTGESCHRIEBENEN
   * `lockVersion`. Ohne sie muesste der Client fuer jede zweite Aenderung neu
   * laden, und genau in dieser Luecke entstuende der veraltete Stand, den
   * `expectedLockVersion` verhindern soll.
   */
  updateWorksiteDayTeam(
    input: UpdateWorksiteDayTeamCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<WorksiteDayDto>>;
```

**Step 3b: HTTP-Client** — `packages/contracts/src/http/planning-gateway.ts`: Import erweitern (`WorksiteDayDtoSchema`, `type PlanWorksiteDayCommand`, `type UpdateWorksiteDayTeamCommand`) und vor `private async send` einfuegen:

```ts
  planWorksiteDay(
    input: PlanWorksiteDayCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<z.infer<typeof WorksiteDayDtoSchema>>> {
    return this.send({
      path: "/planung/baustellentage",
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey,
      schema: WorksiteDayDtoSchema,
      // Ein 409 ist hier eine fachliche Ablehnung — der Tag existiert schon,
      // oder ein Intervall passt nicht. Kein veralteter Stand: beim Anlegen
      // gibt es noch keinen, auf dem der Client haette arbeiten koennen.
      conflictAs: "REJECTED",
    });
  }

  updateWorksiteDayTeam(
    input: UpdateWorksiteDayTeamCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<z.infer<typeof WorksiteDayDtoSchema>>> {
    return this.send({
      path: "/planung/baustellentage/team",
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey,
      schema: WorksiteDayDtoSchema,
      // Dieselbe Bedeutung wie beim Veroeffentlichen: `expectedLockVersion`
      // passte nicht, jemand anders hat den Tag zwischenzeitlich umgeplant. Die
      // Oberflaeche muss darauf neu laden — nicht die Eingabe der Planerin
      // bemaengeln, an der nichts falsch war. Welcher der 409-Typen es genau
      // war, steht in `problem.type` (WORKSITE_DAY_PROBLEM_TYPE).
      conflictAs: "STALE_VERSION",
    });
  }
```

Gruen sehen: `pnpm --filter @easytree/contracts exec vitest run test/http-planning-gateway.test.ts` → `Test Files 1 passed (1)`.

**Step 3c: Mock — zuerst der Test** — in `planning-gateway.contract.test.ts` Import `import { WorksiteDayDtoSchema } from "../src/planning/schemas.js";` ergaenzen, in `makeMock()` nach `nextAssignmentId: …,` das Fixture, und am Dateiende den Block:

```ts
    // EYT-147 M2: Antwortform der Tagescommands. Die Ids stehen hier und nicht
    // im Mock, damit keine Zusicherung gegen eine eingebaute Konstante prueft.
    nextWorksiteDay: {
      worksiteDayId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305",
      // Die Baustelle des Tages — bewusst die BEKANNTE aus `resources`, damit eine
      // Antwort, die statt dessen eine der beiden anderen Ids traegt, auffliegt.
      worksiteId: WORKSITE_ID,
      localDate: "2026-08-03",
      configurationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3306",
      assignmentIds: [
        "3f2504e0-4f89-41d3-9a0c-0305e82c3307",
        "3f2504e0-4f89-41d3-9a0c-0305e82c3308",
      ],
    },
```

```ts
describe("Baustellentag-Kommandos des Mocks (EYT-147 M2)", () => {
  const SCHLUESSEL = PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey;
  const TEAM = [
    {
      employeeId: EMPLOYEE_ID,
      interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T10:00:00.000Z" },
    },
  ];

  it("liefert beim Anlegen eine vertragskonforme Antwort mit getrennten Ids", async () => {
    const result = await makeMock().planWorksiteDay(
      { weekKey: "2026-W32", worksiteId: WORKSITE_ID, localDate: "2026-08-03", team: TEAM },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Gegen das VEROEFFENTLICHTE Schema geparst, nicht nur auf Felder geprueft:
    // eine Attrappe, die etwas anderes liefert, faellt hier durch.
    expect(() => WorksiteDayDtoSchema.parse(result.value)).not.toThrow();
    expect(result.value.worksiteDayId).not.toBe(result.value.configurationId);
    // Dieselbe Dreierprobe wie beim Aendern: die Baustelle stammt aus dem
    // KOMMANDO, die beiden anderen Ids aus dem Fixture.
    expect(result.value.worksiteId).toBe(WORKSITE_ID);
    expect(result.value.worksiteDayId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3305");
    expect(result.value.configurationId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3306");
    expect(result.value.lockVersion).toBe(0);
    expect(result.value.team).toHaveLength(1);
    expect(result.value.team[0]?.employeeId).toBe(EMPLOYEE_ID);
    // Die Assignment-Id kommt aus dem Fixture — der Mock erfindet keine.
    expect(result.value.team[0]?.assignmentId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3307");
  });

  it("schreibt beim Ersetzen der Besetzung die lockVersion fort", async () => {
    const result = await makeMock().updateWorksiteDayTeam(
      {
        weekKey: "2026-W32",
        worksiteDayId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305",
        expectedLockVersion: 3,
        team: TEAM,
      },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => WorksiteDayDtoSchema.parse(result.value)).not.toThrow();
    // Ohne Fortschreibung muesste der Client fuer jede zweite Aenderung neu
    // laden — genau die Luecke, in der der veraltete Stand entsteht.
    expect(result.value.lockVersion).toBe(4);

    // ## Warum die drei Ids EINZELN zugesichert werden
    //
    // `WorksiteDayDtoSchema.parse` kann sie nicht auseinanderhalten: alle drei
    // sind `IdSchema`, also bestaetigt ein Rundlauf jede Belegung. Drei getrennte
    // Zusicherungen auf drei verschiedene Fixturewerte sind die einzige Form, die
    // einen Tausch nicht ueberlebt.
    expect(result.value.worksiteId).toBe(WORKSITE_ID);
    expect(result.value.worksiteDayId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3305");
    expect(result.value.configurationId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3306");
    expect(
      new Set([result.value.worksiteId, result.value.worksiteDayId, result.value.configurationId])
        .size,
    ).toBe(3);
  });

  it("lehnt ein leeres Team ab, statt einen leeren Tag anzulegen", async () => {
    const result = await makeMock().planWorksiteDay(
      { weekKey: "2026-W32", worksiteId: WORKSITE_ID, localDate: "2026-08-03", team: [] },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("REJECTED");
  });

  it("erfindet keine Assignment-Id, wenn das Fixture nicht reicht", async () => {
    // Der Mock haelt zwei Ids bereit. Ein drittes Teammitglied muss auffallen —
    // eine still abgeschnittene Besetzung waere die schlimmere Antwort.
    const zuGross = [0, 1, 2].map((tag) => ({
      employeeId: EMPLOYEE_ID,
      interval: {
        startUtc: `2026-08-0${3 + tag}T06:00:00.000Z`,
        endUtc: `2026-08-0${3 + tag}T10:00:00.000Z`,
      },
    }));
    const result = await makeMock().planWorksiteDay(
      { weekKey: "2026-W32", worksiteId: WORKSITE_ID, localDate: "2026-08-03", team: zuGross },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem?.detail).toContain("Fixture erweitern");
  });
});
```

Rot sehen: `pnpm --filter @easytree/contracts exec vitest run test/planning-gateway.contract.test.ts` → `Test Files 1 failed (1)` (`planWorksiteDay is not a function`).

**Step 3d: Mock implementieren** — `packages/contracts/src/mock/planning.ts`. Imports ersetzen:

```ts
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanWorksiteDayCommand,
  PlanValidationResult,
  PlanningWindow,
  PlanningResources,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  UpdateWorksiteDayTeamCommand,
  WorksiteDayDto,
  WorksiteDayTeamEntry,
  ValidatePlanCommand,
} from "../planning/schemas.js";
import {
  CreateAssignmentCommandSchema,
  PlanWorksiteDayCommandSchema,
  UpdateWorksiteDayTeamCommandSchema,
  ValidatePlanCommandSchema,
} from "../planning/schemas.js";
```

In `MockPlanningState` nach `readonly nextAssignmentId: string;`:

```ts
  /**
   * Ids fuer den Baustellentag, den `planWorksiteDay` zurueckgibt.
   *
   * Ohne Vorgabewert, aus demselben Grund wie `resources`: was der Clickdummy
   * zeigt, hat ein Test ausdruecklich hingeschrieben. Eine eingebaute Konstante
   * liesse eine Antwort echt aussehen, ohne dass jemand sie gewaehlt hat.
   *
   * `assignmentIds` werden den Teameintraegen der Reihe nach zugeteilt. Reicht
   * die Liste nicht, antwortet der Mock mit einer Ablehnung, die genau das sagt
   * — er erfindet keine Id und schneidet das Team nicht still ab.
   */
  readonly nextWorksiteDay: {
    readonly worksiteDayId: string;
    /**
     * Die Baustelle des Tages. Sie MUSS im Fixture stehen: das Aenderungskommando
     * nennt sie nicht, und ohne sie gaebe es hier nichts Richtiges zu uebergeben.
     */
    readonly worksiteId: string;
    /** Der lokale Tag der Identitaet. Das Aenderungskommando nennt ihn nicht — der Mock muss ihn also mitbekommen haben. */
    readonly localDate: string;
    readonly configurationId: string;
    readonly assignmentIds: readonly string[];
  };
```

In der Klasse vor `publishPlan(`:

```ts
  /**
   * Legt einen Baustellentag an — als ANTWORTFORM, nicht als Fachlogik.
   *
   * Der Mock fuehrt keinen Tagesbestand: er prueft das Kommando gegen das
   * Schema und setzt aus den Fixture-Ids eine vertragskonforme Antwort
   * zusammen. Er erkennt deshalb weder ein Duplikat noch eine Kollision mit
   * bestehenden Zuweisungen. Wer das pruefen will, braucht den echten Server —
   * dieselbe Grenze, die schon fuer `validateDraft` gilt.
   */
  planWorksiteDay(
    input: PlanWorksiteDayCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<WorksiteDayDto>> {
    const failed = this.#maybeFail<WorksiteDayDto>();
    if (failed !== null) return Promise.resolve(failed);

    const parsed = PlanWorksiteDayCommandSchema.safeParse(input);
    const key = IdempotencyKeySchema.safeParse(options.idempotencyKey);
    if (!parsed.success || !key.success) {
      // Der Mock sagt NICHT, welche Regel gebrochen wurde. Eine geratene
      // Zuordnung waere schlimmer als keine: sie schickte den Leser auf die
      // falsche Faehrte, und der echte Server vergibt seine eigene.
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Baustellentag unvollstaendig, Team leer oder Intervall ungueltig",
          400,
        ),
      );
    }

    return Promise.resolve(
      this.#baustellentag({
        worksiteId: parsed.data.worksiteId,
        localDate: parsed.data.localDate,
        lockVersion: 0,
        team: parsed.data.team,
      }),
    );
  }

  /**
   * Ersetzt die Tagesbesetzung — mit einer FORTGESCHRIEBENEN `lockVersion`.
   *
   * Ehrlichkeitshinweis: der Mock kennt den echten Stand des Tages nicht und
   * kann deshalb keinen veralteten erkennen. Er schreibt schlicht die vom
   * Aufrufer genannte Erwartung um eins fort. Der `STALE_WORKSITE_DAY`-Fall ist
   * hier NICHT ueberbar — er gehoert dem echten Server.
   */
  updateWorksiteDayTeam(
    input: UpdateWorksiteDayTeamCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<WorksiteDayDto>> {
    const failed = this.#maybeFail<WorksiteDayDto>();
    if (failed !== null) return Promise.resolve(failed);

    const parsed = UpdateWorksiteDayTeamCommandSchema.safeParse(input);
    const key = IdempotencyKeySchema.safeParse(options.idempotencyKey);
    if (!parsed.success || !key.success) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Teamaenderung unvollstaendig, Team leer oder Intervall ungueltig",
          400,
        ),
      );
    }

    return Promise.resolve(
      this.#baustellentag({
        // Baustelle UND Tag haengen an der IDENTITAET und stehen bewusst nicht im
        // Kommando — der Mock nimmt beide aus seinem Fixture.
        worksiteId: this.state.nextWorksiteDay.worksiteId,
        localDate: this.state.nextWorksiteDay.localDate,
        lockVersion: parsed.data.expectedLockVersion + 1,
        team: parsed.data.team,
        worksiteDayId: parsed.data.worksiteDayId,
      }),
    );
  }

  /**
   * Setzt die Antwortform zusammen — ohne Fachlogik, nur aus Fixture-Ids.
   *
   * BENANNTE Felder statt Stellungsparameter, und das ist kein Stil: drei
   * aufeinanderfolgende `string`-Parameter fuer `worksiteId`, `localDate` und
   * `worksiteDayId` liessen sich vertauschen, ohne dass Typsystem, Schema oder
   * ein Rundlauf durch `parse` es meldeten. Mit Feldnamen muss ein Tausch
   * ausgeschrieben werden und faellt beim Lesen auf.
   */
  #baustellentag(eingabe: {
    readonly worksiteId: string;
    readonly localDate: string;
    readonly lockVersion: number;
    readonly team: readonly WorksiteDayTeamEntry[];
    readonly worksiteDayId?: string;
  }): GatewayResult<WorksiteDayDto> {
    const { worksiteId, localDate, lockVersion, team } = eingabe;
    const worksiteDayId = eingabe.worksiteDayId ?? this.state.nextWorksiteDay.worksiteDayId;
    const ids = this.state.nextWorksiteDay.assignmentIds;
    if (team.length > ids.length) {
      return planningRejected<WorksiteDayDto>(
        "urn:easytree:planning:invalid-interval",
        `Der Clickdummy haelt ${ids.length} Assignment-Ids bereit, das Team hat ${team.length}. ` +
          "Fixture erweitern statt Ids zu erfinden.",
        400,
      );
    }
    return gatewayOk<WorksiteDayDto>({
      worksiteDayId,
      configurationId: this.state.nextWorksiteDay.configurationId,
      worksiteId,
      localDate,
      lockVersion,
      team: team.map((eintrag, index) => {
        const assignmentId = ids[index];
        // Der Laengenriegel oben schliesst das aus. Ein `?? ""` stuende hier
        // als stille Ersatz-Id und ergaebe eine Antwort, die kein Schema mehr
        // annimmt — der Fehler waere dann beim Aufrufer statt hier.
        if (assignmentId === undefined) {
          throw new Error("Clickdummy: Assignment-Id fehlt trotz Laengenpruefung");
        }
        return { assignmentId, employeeId: eintrag.employeeId, interval: eintrag.interval };
      }),
    });
  }
```

(`planningRejected`, `gatewayOk`, `#maybeFail`, `WriteOptions`, `IdempotencyKeySchema` existieren in der Datei; `this.state` ist das Konstruktorfeld — Namen mit `grep -n 'this.state\|#maybeFail\|function planningRejected' packages/contracts/src/mock/planning.ts` bestaetigen.)

Gruen sehen: `pnpm --filter @easytree/contracts exec vitest run test/planning-gateway.contract.test.ts` → `Test Files 1 passed (1)`.

**Step 3e: Web-Stubs** — in jedem der vier Objektliterale vom Typ `PlanningGateway` (1× `dispositionswerkbank.test.tsx` in `gatewayMit`, 4× `planning-window-view.test.tsx`, 1× `werkbank-oberflaechenguards.test.tsx` in `gatewayMit`) VOR `getPlanningWindow:` einfuegen:

```ts
    // EYT-147 M2: neue Portmethoden. Diese Ansicht ruft sie nicht auf —
    // ein Wurf faellt auf, eine stille Leerantwort nicht.
    planWorksiteDay: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
    updateWorksiteDayTeam: () => {
      throw new Error("in dieser Ansicht nicht benutzt");
    },
```

Nachweis der Vollstaendigkeit (Zahlen lesen, nicht Exit-Codes):

```bash
grep -c 'planWorksiteDay' apps/web/test/dispositionswerkbank.test.tsx      # 1
grep -c 'planWorksiteDay' apps/web/test/planning-window-view.test.tsx      # 4
grep -c 'planWorksiteDay' apps/web/test/werkbank-oberflaechenguards.test.tsx  # 1
grep -rln 'PlanningGateway = {\|): PlanningGateway {' apps/web --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Die letzte Zeile nennt **sechs** Dateien, nicht drei (gemessen 03.09.2026) — das Muster trifft auch Rueckgabetyp-Annotationen, nicht nur Objektliterale. Drei davon brauchen die Methoden NICHT:

| Datei                                           | Warum kein Stub                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/web/lib/planning-gateway-provider.tsx:34` | Hook `usePlanningGateway(): PlanningGateway` — reicht durch, implementiert nichts |
| `apps/web/lib/planning-gateway-factory.ts:22`   | gibt `new HttpPlanningGateway(...)` zurueck, das die Methoden seit Step 3b traegt |
| `apps/web/test/planung-page.test.tsx:77`        | Objektliteral, aber mit `} as unknown as PlanningGateway;`                        |

**Der dritte Fall ist ein Befund, kein Freibrief.** Der Doppelcast `as unknown as` loescht die Vollstaendigkeitspruefung der Schnittstelle: die Funktion ist `function gateway(seen: string[]): PlanningGateway` deklariert, aber TypeScript vergleicht das Literal nie gegen den Port. Der Stub ist seit dieser Aufgabe unvollstaendig und faellt trotzdem nicht auf — gruen ist er nur, weil die Seite die zwei Methoden nicht ruft. Dieselbe Bauart steht fuenfmal fuer `AuthGateway` (`planung-page`, `kosten-page-gate` 2x, `session-provider-auswahl`, `planung-zugang` 3x).

**In M2 wird daran nichts geaendert** — es ist Bestand ausserhalb des Slices, und ein Umbau dieser Tests waere Scope Creep. Der Befund gehoert in den Abschlussreport unter I: waechst der Port in M3/M4 erneut, meldet diese Stelle es nicht.

Ein Objektliteral OHNE Doppelcast, das die Methoden nicht traegt, ist dagegen sehr wohl ein Fehler — es waere ein Typfehler und `turbo run typecheck` unten faengt ihn.

**Step 4: Gruen sehen — ueber die Paketgrenze**

```bash
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/contracts exec vitest run          # Test Files 1 failed | 9 passed (10) — nur openapi-drift (Byte-Drift, siehe Task 6)
pnpm exec turbo run typecheck --force --filter=@easytree/contracts --filter=@easytree/web --filter=@easytree/api   # Tasks: 7 successful, 7 total; Cached: 0 cached, 7 total
pnpm --filter @easytree/web exec vitest run                 # Test Files 41 passed (41), Tests 479 passed (479)
```

**Step 5: Checkpoint** — `git status --short` zeigt jetzt 15 Pfade: die 7 aus Task 7 plus ` M packages/contracts/src/planning/gateway.ts`, ` M packages/contracts/src/http/planning-gateway.ts`, ` M packages/contracts/src/mock/planning.ts`, ` M packages/contracts/test/http-planning-gateway.test.ts`, ` M packages/contracts/test/planning-gateway.contract.test.ts`, plus die drei ` M apps/web/test/…` — zusammen 15.

---

### Task 9: OpenAPI — `NAMED_SCHEMAS`, zwei Routen, `openapi:write`, Drift-Test

**Files:**

- Modify: `packages/contracts/src/openapi/document.ts` (Import, `NAMED_SCHEMAS`, Helfer `konfliktMit`, zwei `paths`-Eintraege)
- Generated: `packages/contracts/openapi/v1.json` (NUR via `openapi:write`)
- Test: `packages/contracts/test/openapi-drift.test.ts` (Imports + ein `describe`)

**Step 1: Failing Test schreiben** — Imports ergaenzen:

```ts
import { WORKSITE_DAY_PROBLEM_TYPE } from "../src/planning/schemas.js";
import { LocalDateSchema } from "../src/primitives.js";
```

Am Dateiende anhaengen:

```ts
describe("Baustellentag-Routen (EYT-147 M2)", () => {
  const doc = buildOpenApiDocument();
  const paths = doc["paths"] as Record<string, Record<string, Record<string, unknown>>>;
  const schemas = (doc["components"] as { schemas: Record<string, Record<string, unknown>> })
    .schemas;

  /** Pfad -> erwartete Operation. Tabelle statt vier Einzelfaelle. */
  const ROUTEN = [
    { pfad: "/planung/baustellentage", operationId: "planWorksiteDay", erfolg: "201" },
    { pfad: "/planung/baustellentage/team", operationId: "updateWorksiteDayTeam", erfolg: "200" },
  ] as const;

  it.each(ROUTEN)("dokumentiert POST $pfad als $operationId", ({ pfad, operationId, erfolg }) => {
    const eintrag = paths[pfad];
    expect(eintrag, `Pfad ${pfad} fehlt im Vertrag`).toBeDefined();

    // Vakanzschutz: ohne diese Zeile waeren die Zusicherungen unten auch dann
    // gruen, wenn die Operation gar keine POST-Methode traegt.
    const op = eintrag?.["post"];
    expect(op, `${pfad} hat keine POST-Operation`).toBeDefined();
    expect(op?.["operationId"]).toBe(operationId);

    const responses = op?.["responses"] as Record<string, unknown> | undefined;
    expect(Object.keys(responses ?? {})).toContain(erfolg);

    // Und der Erfolgsfall traegt WIRKLICH den Baustellentag — nicht irgendein
    // Objekt. Ohne diese Zeile bliebe der Fall gruen, wenn jemand die Antwort
    // versehentlich auf `AssignmentDto` umhaengt.
    const erfolgsantwort = responses?.[erfolg] as
      { content: { "application/json": { schema: { $ref: string } } } } | undefined;
    expect(erfolgsantwort?.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/WorksiteDayDto",
    );
  });

  it.each(ROUTEN)("verlangt bei $pfad den Idempotenzschluessel", ({ pfad }) => {
    const params = (paths[pfad]?.["post"]?.["parameters"] ?? []) as Array<{
      name: string;
      required: boolean;
    }>;
    const header = params.find((p) => p.name === "Idempotency-Key");
    expect(header, `${pfad} ohne Idempotency-Key`).toBeDefined();
    expect(header?.required).toBe(true);
  });

  it("nennt die neuen Problem-Types im 409-Zweig, aus der Konstante abgeleitet", () => {
    // Gemessen wird die KOPPLUNG an `WORKSITE_DAY_PROBLEM_TYPE`, nicht der
    // Wortlaut. Schriebe jemand die URNs als Literale in `document.ts`, bliebe
    // `v1.json` byteweise gleich und der Drift-Test gruen — die Konstante waere
    // dann ein Kommentar, und eine Umbenennung liefe still auseinander.
    const anlegen = paths["/planung/baustellentage"]?.["post"]?.["responses"] as
      Record<string, { description: string }> | undefined;
    expect(anlegen?.["409"]?.description).toContain(
      WORKSITE_DAY_PROBLEM_TYPE.DUPLICATE_WORKSITE_DAY,
    );

    const team = paths["/planung/baustellentage/team"]?.["post"]?.["responses"] as
      Record<string, { description: string }> | undefined;
    expect(team?.["409"]?.description).toContain(WORKSITE_DAY_PROBLEM_TYPE.STALE_WORKSITE_DAY);
    expect(team?.["409"]?.description).toContain(WORKSITE_DAY_PROBLEM_TYPE.WORKSITE_DAY_NOT_FOUND);

    // Gegenprobe: der Publish-Typ gehoert NICHT hierher. Er ist eine
    // Veroeffentlichungsbedingung, keine Konfliktantwort dieser Routen.
    for (const beschreibung of [anlegen?.["409"]?.description, team?.["409"]?.description]) {
      expect(beschreibung).not.toContain("worksite-day-incomplete");
    }
  });

  it("traegt im Dokument genau die Zod-Grenzen, die JSON Schema ausdruecken KANN", () => {
    // ## Warum dieser Fall existiert
    //
    // Der Ehrlichkeitsabsatz an `NAMED_SCHEMAS` (document.ts) nennt vier Regeln,
    // die bei der Erzeugung wegfallen, und drei, die ankommen. Bis hierher war
    // beides Prosa. Dieser Fall misst die Haelfte, die ANKOMMEN muss — und
    // damit haben die Gegenmutationen "eine Id entfernen" und "team.min(1)
    // entfernen" neben dem Laufzeittest einen ZWEITEN, unabhaengigen Detektor.

    // (1) Stabile Identitaet und Revision sind ZWEI Pflichtfelder — ein
    // Generator sieht sie getrennt, keines ist optional oder abgeleitet.
    const dto = schemas["WorksiteDayDto"];
    expect(dto, "Komponente WorksiteDayDto fehlt — der Rest misst nichts").toBeDefined();
    expect(dto?.["required"]).toEqual(
      expect.arrayContaining(["worksiteDayId", "configurationId", "lockVersion"]),
    );
    expect(dto?.["additionalProperties"]).toBe(false);

    // (2) `team.min(1)` kommt als `minItems: 1` an — in BEIDEN Kommandos.
    for (const name of ["PlanWorksiteDayCommand", "UpdateWorksiteDayTeamCommand"] as const) {
      const team = (
        schemas[name]?.["properties"] as Record<string, Record<string, unknown>> | undefined
      )?.["team"];
      expect(team, `${name}.team fehlt`).toBeDefined();
      expect(team?.["minItems"], `${name}.team ohne minItems — team.min(1) gefallen?`).toBe(1);
    }

    // (3) Additiv heisst: NICHT required. `.default([])` fuehrte das Feld unter
    // `required` (gemessen zod 4.4.3) und behauptete ein Feld, das der heutige
    // Server nie sendet.
    const fenster = schemas["PlanningWindow"];
    expect(Object.keys((fenster?.["properties"] ?? {}) as object)).toContain("worksiteDays");
    expect(fenster?.["required"]).not.toContain("worksiteDays");

    // (4) Und die Ehrlichkeit zur Kalenderregel: `localDate` traegt im Dokument
    // nur das Muster — `2026-02-30` geht dort durch, zur Laufzeit nicht.
    // Beide Haelften gemessen, wie beim Kostenschnappschuss.
    const localDate = (
      schemas["PlanWorksiteDayCommand"]?.["properties"] as Record<string, Record<string, unknown>>
    )["localDate"];
    expect(typeof localDate?.["pattern"]).toBe("string");
    expect(new RegExp(String(localDate?.["pattern"])).test("2026-02-30")).toBe(true);
    expect(localDate?.["format"]).toBeUndefined();
    expect(LocalDateSchema.safeParse("2026-02-30").success).toBe(false);
  });
});
```

**Step 2: Rot sehen** — `pnpm --filter @easytree/contracts exec vitest run test/openapi-drift.test.ts` → `Test Files 1 failed (1)`; rot: der Byte-Vergleich (seit Task 6) UND alle neuen Faelle (`Pfad /planung/baustellentage fehlt im Vertrag`, `Komponente WorksiteDayDto fehlt`). Ins Protokoll.

**Step 3: Implementieren** — `document.ts`:

Import aus `../planning/schemas.js` erweitern um `PlanWorksiteDayCommandSchema`, `UpdateWorksiteDayTeamCommandSchema`, `WORKSITE_DAY_PROBLEM_TYPE`, `WorksiteDayDtoSchema`, `WorksiteDayTeamEntrySchema`, `WorksiteDayTeamMemberSchema` (alphabetisch, wie die Nachbarn).

In `NAMED_SCHEMAS` nach `PublishedPlanVersion: PublishedPlanVersionSchema,`:

```ts
  // EYT-147 M2: die baustellenzentrierte Planung. Zwei Ids mit verschiedener
  // Lebensdauer — `worksiteDayId` ist versionsuebergreifend stabil,
  // `configurationId` gilt in genau einer Planversion. Ein Generator soll
  // beide als getrennte Felder sehen und nicht als denselben Begriff.
  //
  // ## Ehrlichkeitshinweis: VIER Regeln fallen bei der Erzeugung weg
  //
  // 1. `WorksiteDayTeamCommandSchema.superRefine` verbietet doppelte
  //    `(employeeId, interval)`-Paare und ueberlappende Intervalle derselben
  //    Person. Beides sind Beziehungen zwischen ARRAYELEMENTEN; JSON Schema
  //    kann sie nicht ausdruecken.
  // 2. `LocalDateSchema` verlangt zusaetzlich zum Muster einen realen
  //    Kalendertag. Im Dokument steht nur `pattern` — `2026-02-30` geht dort
  //    durch.
  // 3. Die Querbezuege von `PlanningWindow.worksiteDays` auf `assignments`
  //    und `resources.worksites` sind Feldbeziehungen und erscheinen ebenfalls
  //    nicht.
  // 4. Ebenso wenig die Regel "worksiteDays nicht leer => sourceVersion nicht
  //    null".
  //
  // Was dagegen ANKOMMT und in `openapi-drift.test.ts` gemessen wird:
  // `minItems: 1` fuer `team`, beide Ids unter `required`, `worksiteDays` NICHT
  // unter `required` (additiv), `additionalProperties: false`.
  //
  // Ein generierter Client kann die vier Regeln oben also verletzen. Abgelehnt
  // wird es trotzdem — zur Laufzeit, von diesen Schemata. Dieselbe
  // Grenzziehung wie bei `weekKeyParam` und `TimeIntervalDtoSchema`.
  WorksiteDayTeamEntry: WorksiteDayTeamEntrySchema,
  WorksiteDayTeamMember: WorksiteDayTeamMemberSchema,
  WorksiteDayDto: WorksiteDayDtoSchema,
  PlanWorksiteDayCommand: PlanWorksiteDayCommandSchema,
  UpdateWorksiteDayTeamCommand: UpdateWorksiteDayTeamCommandSchema,
```

Nach `function jsonOk(…)` den Helfer:

```ts
/**
 * Die 409-Antwort EINER Route, samt der `problem.type`-Werte, die dort vorkommen.
 *
 * `problemResponses["409"]` sagt nur "Konflikt oder veralteter Planstand" und
 * laesst offen, WELCHER. Fuer die Tagescommands ist das zu wenig: der Client
 * muss `STALE_WORKSITE_DAY` (neu laden) von `DUPLICATE_WORKSITE_DAY` (Eingabe
 * korrigieren) unterscheiden koennen, und ohne die Liste im Vertrag bliebe ihm
 * nur, die Zeichenketten aus dem Servercode abzuschreiben.
 *
 * Die Werte kommen aus {@link WORKSITE_DAY_PROBLEM_TYPE} und nicht als Literale
 * hierher: sonst stuenden dieselben URNs an zwei Stellen, und die Kopie im
 * veroeffentlichten Dokument koennte der Konstante widersprechen.
 *
 * Der Rest des Fehlerobjekts bleibt unangetastet — es ist dasselbe
 * `ProblemDocument` wie ueberall, nur mit einer genaueren Beschreibung.
 */
function konfliktMit(...typen: readonly string[]): unknown {
  return {
    ...problemResponses["409"],
    description:
      `Konflikt oder veralteter Planstand. Moegliche problem.type-Werte dieser Route: ` +
      `${typen.join(", ")}. Zusaetzlich gelten die allgemeinen Planungstypen der uebrigen ` +
      `Schreibrouten unveraendert (Idempotenzschluessel wiederverwendet, ueberlappende ` +
      `Zuweisung, ausserhalb der Woche, nicht auswaehlbare Ressource) - sie werden hier ` +
      `wiederverwendet und nicht neu erfunden.`,
  };
}
```

In `paths` nach dem `"/planung/versionen"`-Eintrag und VOR `"/einsatz/plan"`:

```ts
      "/planung/baustellentage": {
        post: {
          operationId: "planWorksiteDay",
          summary: "Baustellentag anlegen",
          description:
            "Legt den Baustellentag fuer eine Baustelle an einem expliziten lokalen Kalendertag an " +
            "und besetzt ihn. Adressiert wird Baustelle plus Tag, nicht eine Id: die stabile " +
            "worksiteDayId entsteht erst hier. Der Server loest sie auf, haengt sie an die " +
            "Konfiguration des Wochenentwurfs und antwortet mit dem angelegten Tag einschliesslich " +
            "lockVersion und der vergebenen assignmentIds. Neu gegenueber den uebrigen " +
            "Planungsrouten sind die problem.type-Werte " +
            `${WORKSITE_DAY_PROBLEM_TYPE.DUPLICATE_WORKSITE_DAY}, ` +
            `${WORKSITE_DAY_PROBLEM_TYPE.INTERVAL_OUTSIDE_DAY} und ` +
            `${WORKSITE_DAY_PROBLEM_TYPE.WORKSITE_DAY_TEAM_REQUIRED}.`,
          parameters: [idempotencyHeader],
          requestBody: jsonBody("PlanWorksiteDayCommand"),
          responses: {
            "201": jsonOk("WorksiteDayDto", "Angelegter Baustellentag"),
            ...problemResponses,
            "409": konfliktMit(
              WORKSITE_DAY_PROBLEM_TYPE.DUPLICATE_WORKSITE_DAY,
              WORKSITE_DAY_PROBLEM_TYPE.INTERVAL_OUTSIDE_DAY,
              WORKSITE_DAY_PROBLEM_TYPE.WORKSITE_DAY_TEAM_REQUIRED,
            ),
          },
        },
      },
      "/planung/baustellentage/team": {
        post: {
          operationId: "updateWorksiteDayTeam",
          summary: "Tagesbesetzung eines Baustellentags ersetzen",
          description:
            "Ersetzt die Besetzung eines BESTEHENDEN Baustellentags. Adressiert wird die stabile " +
            "worksiteDayId - nicht die configurationId, denn die Revision ist durch weekKey " +
            "eindeutig (hoechstens ein Entwurf je Woche), und nicht der localDate, denn der " +
            "haengt unveraenderlich an der Identitaet. expectedLockVersion ist die " +
            "Stale-Erkennung gegen die Tagesidentitaet (lock_version wird beim Kopieren in den " +
            "Folgedraft uebernommen); weicht sie vom Server ab, " +
            `antwortet er mit ${WORKSITE_DAY_PROBLEM_TYPE.STALE_WORKSITE_DAY}, statt fremde ` +
            "Aenderungen zu ueberschreiben. Kennt er die Id nicht, mit " +
            `${WORKSITE_DAY_PROBLEM_TYPE.WORKSITE_DAY_NOT_FOUND}. Die Antwort traegt die ` +
            "fortgeschriebene lockVersion, damit die naechste Aenderung ohne Zwischenladen moeglich ist.",
          parameters: [idempotencyHeader],
          requestBody: jsonBody("UpdateWorksiteDayTeamCommand"),
          responses: {
            "200": jsonOk("WorksiteDayDto", "Baustellentag mit ersetzter Besetzung"),
            ...problemResponses,
            "409": konfliktMit(
              WORKSITE_DAY_PROBLEM_TYPE.STALE_WORKSITE_DAY,
              WORKSITE_DAY_PROBLEM_TYPE.WORKSITE_DAY_NOT_FOUND,
              WORKSITE_DAY_PROBLEM_TYPE.INTERVAL_OUTSIDE_DAY,
              WORKSITE_DAY_PROBLEM_TYPE.WORKSITE_DAY_TEAM_REQUIRED,
            ),
          },
        },
      },
```

**Step 4: Dokument erzeugen und Gruen sehen**

```bash
pnpm --filter @easytree/contracts openapi:write
git diff --stat packages/contracts/openapi/v1.json           # erwartet: 1 file changed, ~560 insertions(+), 0 deletions
cp packages/contracts/openapi/v1.json "$SCRATCH/v1.first.json"
pnpm --filter @easytree/contracts openapi:write >/dev/null
/usr/bin/diff "$SCRATCH/v1.first.json" packages/contracts/openapi/v1.json | wc -l   # erwartet: 0
node -e 'const d=JSON.parse(require("fs").readFileSync("packages/contracts/openapi/v1.json","utf8"));console.log(Object.keys(d.components.schemas).length, Object.values(d.paths).reduce((a,p)=>a+Object.keys(p).length,0))'   # erwartet: 39 21
pnpm --filter @easytree/contracts exec vitest run             # erwartet: Test Files 10 passed (10)
```

Byteweise reproduzierbar (0 Diffzeilen), 39 Schemata (vorher 34), 21 Operationen (vorher 19); `0 deletions` belegt, dass keine bestehende Zeile des Dokuments verschwunden ist.

**Step 5: Checkpoint** — `git status --short`: 18 Pfade = die 15 aus Task 8 plus ` M packages/contracts/openapi/v1.json`, ` M packages/contracts/src/openapi/document.ts`, ` M packages/contracts/test/openapi-drift.test.ts`.

---

### Task 10: Route-Konformitaet — die zwei Routen als contract-only fuehren

**Files:**

- Modify: `apps/api/test/openapi-route-conformance.test.ts` (`NOT_YET_IMPLEMENTED`, nach der `/einsatz/zeiten/stopp`-Zeile)

Die Mechanik existiert: `NOT_YET_IMPLEMENTED` ist die explizite Allowlist „im Vertrag, nicht im Server“, die `stale`-Zusicherung macht den Eintrag in genau dem Lauf rot, in dem M3/M4 die Route registrieren. Auftrag §8 ist damit ohne neue Mechanik erfuellt — nur erweitern.

**Step 1: Rot sehen — natuerlich, ohne neuen Test**

```bash
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts
```

Erwartet: `Test Files 1 failed (1)`, rot ist „fuehrt jede noch offene Vertragsoperation mit Begruendung“ mit `Vertragsoperation ohne Route und ohne Eintrag in NOT_YET_IMPLEMENTED` und den zwei Operationen `POST /planung/baustellentage`, `POST /planung/baustellentage/team`. Ins Protokoll — das ist der Beweis, dass das Gate den vertragserst-Zustand SIEHT.

**Step 2: Implementieren** — nach `["POST /einsatz/zeiten/stopp", "Zeiterfassung. Gleiche Begruendung wie der Start."],` einfuegen:

```ts
  // EYT-147, vertragserster Slice: Meilenstein M2 (EYT-151) hat NUR den
  // Transport gebaut — Schemata, Port, Gateway, Dokument. Die beiden Eintraege
  // sind deshalb keine vergessene Zusage, sondern die benannte Reihenfolge.
  // Entfernt werden sie von den Meilensteinen, die die Routen bauen; die
  // `stale`-Zusicherung weiter unten meldet sie in genau dem Lauf rot, in dem
  // das geschieht.
  [
    "POST /planung/baustellentage",
    "Baustellentag anlegen. Braucht die Draft-Aufloesung (app.lock_week_draft), den " +
      "Lock und die get-or-create-Logik auf worksite_days — EYT-147 M3.",
  ],
  [
    "POST /planung/baustellentage/team",
    "Tagesbesetzung ersetzen. Braucht zusaetzlich die Lock-Version-Fortschreibung " +
      "und das atomare Ersetzen der Zuweisungen — EYT-147 M4.",
  ],
```

**Step 3: Gruen sehen** — gleicher Befehl → `Test Files 1 passed (1)`, `Tests 6 passed (6)`.

**Step 4: Checkpoint** — `git status --short`: 19 Pfade (+ ` M apps/api/test/openapi-route-conformance.test.ts`). Das ist die vollstaendige Liste fuer den Commit (Task 12).

---

### Task 11: Vollstaendige lokale Gates (Auftrag §11)

**Files:** keine Aenderung erwartet. Jede Zeile wird mit Exitstatus UND der genannten Kennzahl ins Protokoll uebernommen — das ist Abschnitt G des Reports.

**Step 1: Paketgates contracts**

```bash
pnpm --filter @easytree/contracts test;      echo "exit=$?"   # Test Files 10 passed (10); Tests ≈ 280
pnpm --filter @easytree/contracts typecheck; echo "exit=$?"   # 0
pnpm --filter @easytree/contracts lint;      echo "exit=$?"   # 0 — meldet Lint `_c`/`_w` aus Task 3, Variante mit Object.entries nehmen
pnpm --filter @easytree/contracts build;     echo "exit=$?"   # 0
pnpm --filter @easytree/contracts openapi:write; echo "exit=$?"
git diff --stat packages/contracts/openapi/v1.json                # unveraendert gegenueber Task 9 (dieselbe Zeilenzahl)
```

`git diff --exit-code packages/contracts/openapi/v1.json` aus dem Auftrag ist hier NICHT das richtige Werkzeug — es vergleicht gegen den Commit, und dort fehlt das Dokument noch. Die Repo-Konvention ist der Byte-Drift-Test (`openapi-drift.test.ts`, in `test` oben enthalten) plus die Zweifachschreibung aus Task 9 Step 4. Nach dem Commit (Task 12) ist `git diff --exit-code packages/contracts/openapi/v1.json` = 0 dann die dritte Bestaetigung.

**Step 2: Betroffene Nachbarpakete**

```bash
pnpm --filter @easytree/api exec vitest run test/openapi-route-conformance.test.ts   # 1 passed, 6 tests
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts                 # 1 passed
pnpm --filter @easytree/web exec vitest run                                           # 41 passed (41), 479 passed (479)
```

**Step 3: Formatierung — die getrackte Menge PLUS die neue Datei**

```bash
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check; echo "exit=$?"     # 0
pnpm exec prettier --check packages/contracts/test/worksite-day-schemas.test.ts; echo "exit=$?"   # 0 — untracked, sonst unsichtbar
```

Bei Findings: `pnpm exec prettier --write <genannte Datei>` NUR auf die 19 Pfade aus Task 10 anwenden, dann beide Zeilen wiederholen.

**Step 4: Repository-Gates ueber Turbo — erzwungen, mit Cache-Zeile**

```bash
pnpm exec turbo run lint --force      2>&1 | grep -E 'Tasks:|Cached:'   # Tasks: 8 successful, 8 total · Cached: 0 cached
pnpm exec turbo run typecheck --force 2>&1 | grep -E 'Tasks:|Cached:'   # Tasks: 8 successful · Cached: 0 cached
env -u EASYTREE_API_PROXY_TARGET pnpm exec turbo run build --force 2>&1 | grep -E 'Tasks:|Cached:'   # alle erfolgreich · Cached: 0 cached
pnpm exec turbo run test --force --continue --concurrency=1 --env-mode=loose 2>&1 | tee "$SCRATCH/final-test.log" | grep -E 'Tasks:|Cached:|Test Files|Tests '
grep -oE 'FAIL +[^ ]+\.test\.tsx? ' "$SCRATCH/final-test.log" | sort -u > "$SCRATCH/final-failures.txt"
/usr/bin/diff "$SCRATCH/baseline-failures.txt" "$SCRATCH/final-failures.txt"; echo "diff-exit=$?"
```

Erwartet: `Cached: 0 cached` in allen vier Laeufen; der `diff` ist leer (`diff-exit=0`) — dieselben Stack-Altbestand-Suiten wie in der Baseline, keine neue rote Datei. Ist der `diff` NICHT leer: die neue Datei ist ein M2-Befund → **STOP, Gate `BLOCKED_TEST_FAILURE`**, nichts committen.

(Die Taskzahlen `8` sind die Zahl der Pakete mit dem jeweiligen Script; die tatsaechliche Zahl aus der Ausgabe lesen und im Protokoll nennen.)

**Step 5: Scope-Audit am Diff**

```bash
git status --short | wc -l                                       # 19
git diff --check; echo "exit=$?"                                 # 0 (kein Whitespace-Fehler)
git diff --stat | tail -1

# (1) Harte Marker — hier ist null die Bedingung
grep -rncE '\b(TODO|FIXME|TOOL_GAP|XXX|HACK)\b' packages/contracts/src packages/contracts/test apps/api/test/openapi-route-conformance.test.ts | grep -v ':0$'   # erwartet: keine Ausgabe

# (2) Das deutsche Wort "offen" NUR in neuen Zeilen, und dann ANGESEHEN statt gezaehlt
git diff -U0 | grep -E '^\+' | grep -nE 'offen'

git diff -- apps/api/src supabase apps/web/app apps/web/lib apps/web/components | wc -l   # 0 — kein Server-, DB- oder UI-Code
git diff | grep -iE 'service_role|secret|password|token=' | wc -l                            # 0
```

**Zur Markerpruefung, korrigiert 03.09.2026.** CLAUDE.md nennt `offen|TODO|TOOL_GAP|FIXME`; in einer deutschsprachigen Codebasis ist `offen` als Teilstring aber wertlos — gemessen sechs Treffer, alle Prosa: „halb-offenes Intervall“ (2x), „ausserhalb der offenen Woche“, „welche Operationen noch offen sind“, „laesst offen, WELCHER“, „Halb-offen, wie `TimeIntervalDtoSchema` es verlangt“. Vier davon stehen byteidentisch schon in HEAD. Deshalb zwei getrennte Fragen:

- **(1) ist die Zusicherung**: `TODO`, `FIXME`, `TOOL_GAP`, `XXX`, `HACK` als ganze Woerter, ueber den GANZEN Paketbaum statt sechs handverlesener Dateien — keine Ausgabe, sonst Blocker.
- **(2) ist eine Lesehilfe**, keine Zaehlung: nur NEUE Zeilen, und jeder Treffer wird angesehen. Fachprosa ist in Ordnung; ein Treffer wie `// offen: …` oder „noch offen, kommt in M3“ waere ein Blocker. Gemessen am fertigen Slice: eine neue Zeile (`document.ts:321`, „laesst offen, WELCHER“) plus eine in der untracked Testdatei (`worksite-day-schemas.test.ts:45`, „Halb-offen“) — beide Prosa.

`git diff -U0` sieht die untracked Datei nicht; die faellt unter (1) mit, weil dort der ganze Baum durchsucht wird.

---

### Task 12: EIN Commit (Auftrag §13)

**Files:** die 19 Pfade — namentlich gestaged, kein `git add -A`, kein `git add .`.

**Step 1: Namentlich stagen**

```bash
git add \
  apps/api/test/openapi-route-conformance.test.ts \
  apps/web/test/dispositionswerkbank.test.tsx \
  apps/web/test/planning-window-view.test.tsx \
  apps/web/test/werkbank-oberflaechenguards.test.tsx \
  packages/contracts/openapi/v1.json \
  packages/contracts/src/http/planning-gateway.ts \
  packages/contracts/src/index.ts \
  packages/contracts/src/mock/planning.ts \
  packages/contracts/src/openapi/document.ts \
  packages/contracts/src/planning/gateway.ts \
  packages/contracts/src/planning/schemas.ts \
  packages/contracts/src/primitives.ts \
  packages/contracts/test/http-planning-gateway.test.ts \
  packages/contracts/test/iso-week-key.test.ts \
  packages/contracts/test/openapi-drift.test.ts \
  packages/contracts/test/planning-gateway.contract.test.ts \
  packages/contracts/test/primitives.test.ts \
  packages/contracts/test/public-surface.test.ts \
  packages/contracts/test/worksite-day-schemas.test.ts
git diff --cached --name-only | wc -l      # 19
git status --short | grep -v '^[AM] ' | wc -l   # 0 — nichts Ungestagtes, nichts Unerwartetes
```

**Step 2: Commit**

```bash
git commit -F - <<'MSG'
feat(contracts): EYT-151 add worksite-day planning contracts (M2)

Additive transport boundary for the worksite-centred planning of EYT-147,
milestone M2 of Confluence 41484289 — contracts only, no server logic.

- WorksiteDayDto: stable worksiteDayId and revision-bound configurationId as
  two required fields, lockVersion, localDate (LocalDateSchema, calendar-checked),
  team with assignmentIds; team may be empty in the RESPONSE only.
- planWorksiteDay (POST /planung/baustellentage, 201) and updateWorksiteDayTeam
  (POST /planung/baustellentage/team, 200): strict commands, team.min(1),
  duplicate/overlap rules per employee, expectedLockVersion against the day
  IDENTITY (migration 0019 R-20: one stale truth per day), Idempotency-Key.
- PlanningWindow.worksiteDays[] optional (additive: today's server omits it),
  cross-checked against assignments and resources.worksites.
- WORKSITE_DAY_PROBLEM_TYPE vocabulary, published in the 409 descriptions.
- openapi/v1.json regenerated from the same Zod source (39 schemas, 21 ops).
- Both routes listed in NOT_YET_IMPLEMENTED (contract-only until M3/M4); the
  stale assertion turns red in the run that implements them.

Not in this commit: application services, DB mutations, publish/copy path, UI.
MSG
git rev-parse HEAD
git show --stat HEAD | tail -22
git diff --exit-code packages/contracts/openapi/v1.json; echo "exit=$?"   # 0 — jetzt ist der Auftragsbefehl sinnvoll
```

Das Commit-Trailerpaar (`Co-Authored-By`, `Claude-Session`) haengt die Umgebung an; im Report den vollstaendigen SHA nennen.

---

### Task 13: Gegenmutationen — ausgefuehrt, rot, zurueckgenommen (Auftrag §10)

Reihenfolge NACH dem Commit, VOR dem Push: dann ist die Ruecknahme `git checkout -- <datei>` exakt der committete Stand, und `git diff --exit-code -- <datei>` (Exit 0) ist der Beleg. Nichts davon wird committed; `git status --short` muss vor Task 14 leer sein.

Fuer JEDE Mutation ins Protokoll: (a) die Mutation als `git diff -- <datei> | head -20`, (b) erwarteter roter Test, (c) tatsaechliche rote Tests — Zeilen `×`/`FAIL` aus der Ausgabe waertlich, (d) Ruecknahme mit `git diff --exit-code -- <datei>; echo exit=$?` = 0, (e) Gruen danach.

**GM-1: Stabile Id und Revision zusammenfallen lassen — `configurationId` aus dem DTO entfernen**

```bash
sed -i '' '/^  configurationId: IdSchema,$/d' packages/contracts/src/planning/schemas.ts
grep -c 'configurationId: IdSchema' packages/contracts/src/planning/schemas.ts   # 0 — die Mutation hat gegriffen
pnpm --filter @easytree/contracts exec vitest run 2>&1 | grep -E '×|FAIL|Test Files'
```

Erwartet rot (mindestens): `worksite-day-schemas` › „traegt Identitaet und Konfigurationsrevision unabhaengig voneinander“, „verlangt BEIDE Ids“, STRENGE-Zeile `WorksiteDayDtoSchema` (positive Haelfte), alle `PlanningWindow.worksiteDays`-Faelle mit Tag; `openapi-drift` › Byte-Vergleich UND „traegt im Dokument genau die Zod-Grenzen“ (`required` ohne `configurationId`); `http-planning-gateway` › beide Erfolgsfaelle (`CONTRACT_VIOLATION`, Fixture traegt `configurationId`); `planning-gateway.contract` › Mock-Antwort faellt am Schema. Bleibt eine dieser Dateien GRUEN, misst sie nicht, was sie behauptet — als Befund notieren.

```bash
git checkout -- packages/contracts/src/planning/schemas.ts
git diff --exit-code -- packages/contracts/src/planning/schemas.ts; echo "exit=$?"   # 0
pnpm --filter @easytree/contracts exec vitest run 2>&1 | grep -E 'Test Files'         # 10 passed (10)
```

**GM-2: `team.min(1)` entfernen**

```bash
sed -i '' 's/^  \.min(1, "Ein Baustellentag wird nicht ohne Team angelegt oder geleert")$/  .min(0)/' packages/contracts/src/planning/schemas.ts
git diff -- packages/contracts/src/planning/schemas.ts | grep -c '^[+-][^+-]'   # 2 — genau EINE Zeile getauscht
grep -n '\.min(0)' packages/contracts/src/planning/schemas.ts   # DREI Treffer, nicht einer
pnpm --filter @easytree/contracts exec vitest run 2>&1 | grep -E '×|FAIL|Test Files'
```

**Zur Trefferzahl** (korrigiert 03.09.2026): `grep -c '\.min(0)'` zaehlt **drei**, nicht eins — `lockVersion: z.number().int().min(0)` (Zeile 332) und `expectedLockVersion: z.number().int().min(0)` (Zeile 676) tragen dieselbe Zeichenfolge und standen schon vor der Mutation da. Die Zahl beweist also nichts. Der Beleg, dass die Mutation gegriffen hat, ist der `git diff` darueber: genau eine getauschte Zeile.

Erwartet rot: `worksite-day-schemas` › „lehnt ein leeres Team ab“, „lehnt team: [] im PlanWorksiteDayCommand ab“, „… im UpdateWorksiteDayTeamCommand ab“; `planning-gateway.contract` › „lehnt ein leeres Team ab, statt einen leeren Tag anzulegen“; `openapi-drift` › Byte-Vergleich (`minItems` wird `0`) UND „traegt im Dokument genau die Zod-Grenzen“ (`minItems` ≠ 1). Zwei unabhaengige Detektoren — beide muessen feuern.

Ruecknahme wie bei GM-1 (`git checkout --`, `git diff --exit-code` = 0, Suite `10 passed`).

**GM-3: Unknown-Field-Grenze eines kritischen Kommandos abschwaechen — `UpdateWorksiteDayTeamCommandSchema` auf `z.object`**

```bash
sed -i '' 's/^export const UpdateWorksiteDayTeamCommandSchema = z\.strictObject({$/export const UpdateWorksiteDayTeamCommandSchema = z.object({/' packages/contracts/src/planning/schemas.ts
grep -c 'UpdateWorksiteDayTeamCommandSchema = z.object' packages/contracts/src/planning/schemas.ts   # 1
pnpm --filter @easytree/contracts exec vitest run 2>&1 | grep -E '×|FAIL|Test Files'
```

Erwartet rot: `worksite-day-schemas` › STRENGE-Zeile `UpdateWorksiteDayTeamCommandSchema … lehnt einen Fremdschluessel ab`, „kennt weder configurationId noch localDate“. **Erwartet GRUEN und im Report ausdruecklich zu nennen:** `openapi-drift` — `z.object` erzeugt dasselbe `additionalProperties: false`, das Dokument aendert sich um kein Byte. Diese Grenze ist NUR zur Laufzeit messbar; genau deshalb existiert die STRENGE-Tabelle.

Ruecknahme wie oben.

**GM-4 (Zusatz, Additivitaet): `worksiteDays` zum Pflichtfeld machen**

```bash
sed -i '' 's/^    worksiteDays: z\.array(WorksiteDayDtoSchema)\.optional(),$/    worksiteDays: z.array(WorksiteDayDtoSchema),/' packages/contracts/src/planning/schemas.ts
grep -c 'worksiteDays: z.array(WorksiteDayDtoSchema),' packages/contracts/src/planning/schemas.ts   # 1
pnpm --filter @easytree/contracts exec vitest run 2>&1 | grep -E '×|FAIL|Test Files'
```

Erwartet rot: `worksite-day-schemas` › „bleibt ohne das Feld gueltig: Legacy-Assignments ohne Baustellentag“; `planning-window-provenance` (alle vier Zustandsfaelle) und `iso-week-key` (die positiven Fenster-Fixtures) — NICHT `primitives`: dessen einzige `PlanningWindowSchema`-Zusicherung ist negativ (`toBe(false)`, Zeile 63), ein zusaetzliches Pflichtfeld kann sie nicht rot machen; `openapi-drift` › „… Zod-Grenzen“ (`required` enthaelt `worksiteDays`) und Byte-Vergleich. Das ist der Beweis fuer D8 (kein Breaking Change) — die Tests, die den HEUTIGEN Server abbilden, gehen rot.

**GM-5 (PFLICHT, nachgetragen 03.09.2026): den Querbezugsblock aus `PlanningWindowSchema.superRefine` entfernen**

Warum diese Mutation die wichtigste des Satzes ist: in der Rot-Phase von Task 6 waren fuenf der Querbezugsfaelle **gruen aus dem falschen Grund** — sie sichern `success === false` zu, und `z.strictObject` lieferte dieses `false` schon wegen des unbekannten Schluessels `worksiteDays`, bevor es die Regel ueberhaupt gab. Ohne GM-5 waeren „unbekannte assignmentId“, „employeeId widerspricht“, „Intervall widerspricht“, „dieselbe Zuweisung zweimal“, „unbekannte Baustelle“ und „ohne sourceVersion“ sechs Tests ohne jede Evidenz.

**Zuerst sichern — `git checkout --` ist hier VERBOTEN** (es stellt den Commit-Stand her; Task 13 laeuft zwar nach dem Commit, aber die Sicherungskopie macht die Ruecknahme unabhaengig von der Schnittgenauigkeit):

```bash
cp packages/contracts/src/planning/schemas.ts "$SCRATCH/gm5-schemas-before.ts"
grep -n 'Baustellentage (EYT-147 M2). Bewusst HIER' packages/contracts/src/planning/schemas.ts   # Startzeile des Kommentars, erwartet 413
grep -n 'if (fenster.sourceVersion === null) {' packages/contracts/src/planning/schemas.ts       # erwartet 501
```

Der Block laeuft vom Kommentarbeginn bis zur Leerzeile vor `if (fenster.sourceVersion === null) {` — gemessen 03.09.2026: Zeilen **413 bis 500**. **Die Zeilennummern vor dem Schnitt neu ermitteln**, ein Bereich daneben ergibt einen Syntaxfehler und damit `Tests no tests` statt roter Faelle (genau so gemessen bei `411,499d`: die Datei laedt nicht mehr, und eine Datei, die nicht laedt, misst nichts).

```bash
sed -i '' '413,500d' packages/contracts/src/planning/schemas.ts
grep -c 'const tage = fenster.worksiteDays' packages/contracts/src/planning/schemas.ts   # 0 — Block weg
grep -c 'worksiteDays: z.array' packages/contracts/src/planning/schemas.ts               # 1 — das FELD bleibt, sonst misst die Mutation nur GM-4 noch einmal
pnpm --filter @easytree/contracts exec vitest run test/worksite-day-schemas.test.ts 2>&1 | grep -E '×|Test Files|Tests '
```

Erwartet (gemessen 03.09.2026 am Stand nach Task 6, `Tests 6 failed | 34 passed (40)`):

```
× lehnt einen Baustellentag auf einer unbekannten Baustelle ab
× lehnt eine unbekannte assignmentId im Team ab
× lehnt ein Teammitglied ab, dessen employeeId dem Assignment widerspricht
× lehnt ein Teammitglied ab, dessen Intervall dem Assignment widerspricht
× lehnt dieselbe Assignment-Id in zwei Baustellentagen ab
× lehnt Baustellentage ohne sourceVersion ab
```

Sechs rote Faelle, keiner weniger. Steht dort `Tests no tests`, ist der Schnitt inkohaerent — Datei aus der Sicherungskopie zurueckholen und die Zeilennummern neu ermitteln, NICHT die Erwartung anpassen.

```bash
cp "$SCRATCH/gm5-schemas-before.ts" packages/contracts/src/planning/schemas.ts
/usr/bin/diff "$SCRATCH/gm5-schemas-before.ts" packages/contracts/src/planning/schemas.ts | wc -l   # 0
git diff --exit-code -- packages/contracts/src/planning/schemas.ts; echo "exit=$?"                   # 0
pnpm --filter @easytree/contracts exec vitest run 2>&1 | grep -E 'Test Files'                        # 10 passed (10)
```

Ruecknahme wie oben. Abschliessend:

```bash
git status --short | wc -l   # 0
git rev-parse HEAD           # unveraendert gegenueber Task 12
```

---

### Task 14: Push, CI auf dem exakten Head, Abschlussreport (Auftrag §13/§14)

**Step 1: Push**

```bash
git status --short | wc -l                                            # 0
git log --oneline origin/feat/eyt-147-dispositionswerkbank-slice-1..HEAD   # genau EINE Zeile: der M2-Commit
git push origin feat/eyt-147-dispositionswerkbank-slice-1
git fetch origin feat/eyt-147-dispositionswerkbank-slice-1
git rev-parse origin/feat/eyt-147-dispositionswerkbank-slice-1        # = git rev-parse HEAD → im Report als Remote-Head-SHA
gh pr view 101 --json headRefOid,state --jq '.headRefOid + " " + .state'   # derselbe SHA, OPEN
```

**Step 2: CI beobachten**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 2400; echo "exit=$?"
gh run list --commit "$(git rev-parse HEAD)" --json databaseId,name,status,conclusion --jq '.[] | "\(.databaseId) \(.name) \(.status) \(.conclusion)"'
```

Exit 0 heisst nicht automatisch gruen (Memory: Exit 0 kann Timeout heissen; Exit 1 kann „cancelled“ heissen): den Endstand IMMER ueber `gh run view <id>` gegenpruefen. Dann die Gate-Zeilen lesen, nicht den Haken:

```bash
RUN=<id aus der Liste>
JOB=$(gh run view "$RUN" --json jobs --jq '.jobs[] | select(.name=="db-gates") | .databaseId')
gh run view "$RUN" --log --job "$JOB" | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' | sort -u
gh run view "$RUN" --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'
```

Erwartet: 11 Jobs `success`, jede Gate-Zeile `mode=required … skipped=0`. Ist etwas rot: die betroffene Datei benennen, KEINEN Reparatur-Push ohne Neubewertung (ein Push nach Push verdraengt den laufenden Run — `cancel-in-progress`).

**Step 3: Nicht tun** — EYT-151 nicht transitionieren, EYT-147 nicht transitionieren, PR #101 nicht mergen, keinen M3-Code beginnen. Ein Jira-Kommentar auf EYT-151 mit dem Report ist erlaubt, wenn der Auftraggeber ihn will — vorher nachfragen (compose → re-read → send).

**Step 4: Abschlussreport** nach der Vorlage unten; Gate-Vorschlag `M2_CANDIDATE_FOR_PO_REVIEW`, wenn Task 11–14 ohne Befund waren.

---

## Abschlussreport — Vorlage (Auftrag §14, exakt diese Abschnitte)

```
## A. Repository Identity
cwd · repo root · remote · branch · starting SHA cc92ceb38dcd1f317c05a7a7caec2561c8d12f4f · ending SHA <aus Task 14>

## B. Contract Decision
D1–D8 aus Abschnitt 1.1, je ein Satz, mit Quelle. Ausdruecklich: Update-Kommando ohne
configurationId (D3, R-20) = PO-Reviewpunkt Nr. 1.

## C. Changed Files
19 Zeilen: Pfad · Grund · Requirement (EYT-151-AC oder 41484289-§).

## D. TDD Evidence
Je Task 1–10: der rote Lauf (Datei, Fehlertext, Dateizahl) und der gruene Lauf (Dateizahl, Testzahl).

## E. Countermutation Evidence
GM-1 … GM-5: Mutation (diff-Auszug) · erwartete rote Tests · tatsaechliche rote Tests (waertlich) ·
Ruecknahme (`git diff --exit-code -- <datei>` exit=0) · gruen danach. Bei GM-3 ausdruecklich:
openapi-drift blieb gruen, weil z.object dasselbe Dokument erzeugt. Bei GM-5 ausdruecklich: sie schliesst die Luecke, dass fuenf Querbezugsfaelle in der Rot-Phase von Task 6 aus dem falschen Grund gruen waren.

## F. OpenAPI Evidence
Generator `openapi:write` zweimal, 0 Diffzeilen · v1.json +N Zeilen, 0 Loeschungen · 39 Schemata /
21 Operationen · Drift-Test gruen · contract-only Routen: die zwei NOT_YET_IMPLEMENTED-Eintraege,
`stale`-Zusicherung als Entfernungszwang fuer M3/M4.

## G. Validation
Jeder Befehl aus Task 11 und 14 mit Exitstatus und Kennzahl (Cached: 0 cached, Dateizahlen,
Baseline-Diff leer, CI-Run-Id, 11/11, Gate-Zeilen).

## H. Scope Audit
keine M3-Logik · keine M4-Logik · keine DB-Mutation (git diff -- supabase = 0 Zeilen) ·
kein UI-Umbau (git diff -- apps/web/app apps/web/lib apps/web/components = 0 Zeilen; nur
Test-Stubs) · kein Merge.

## I. Residual Risks / MISSING
- Zwei Datumsschemata: LocalDateSchema (streng) neben BusinessDateSchema (Muster) — Zusammenfuehrung
  braucht eigene Kostentests, nicht additiv.
- WORKSITE_DAY_PROBLEM_TYPE lebt in contracts; M3/M4 muessen es in PLANNING_ERROR_TYPE importieren,
  sonst zwei Literalstellen.
- Lokale DB-Integrationssuiten wurden nur gegen die Baseline verglichen (geteilter Stack mit
  Altbestand); die Evidenz dafuer ist der CI-Run.
- HttpPlanningGateway bildet JEDEN 409 des Teamwechsels auf STALE_VERSION ab; die Feinunterscheidung
  traegt problem.type — die Oberflaeche (M6) muss sie lesen.
- `apps/web/test/planung-page.test.tsx:77` stubbt den Port mit `} as unknown as PlanningGateway;` — der Doppelcast loescht die Vollstaendigkeitspruefung, der Stub blieb ohne Typfehler unvollstaendig (gruen nur, weil die Seite die Methoden nicht ruft). Dieselbe Bauart fuenfmal fuer `AuthGateway`. Bestand ausserhalb des Slices, in M2 bewusst nicht angefasst; waechst der Port in M3/M4, meldet diese Stelle es nicht.
- Der uncommittete Vorentwurf liegt weiter im Stash (stash@{0}) und als Patch ausserhalb des Repos.

## J. Proposed Gate
M2_CANDIDATE_FOR_PO_REVIEW  (oder BLOCKED_… mit dem Befund aus Task 11/14)
Nicht selbst EYT-151 abschliessen, nicht M3 beginnen.
```
