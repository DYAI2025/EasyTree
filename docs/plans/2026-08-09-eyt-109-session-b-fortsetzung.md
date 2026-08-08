# EYT-109 Session B — Fortsetzung ab Task 5 (Implementierungsplan)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Die reine Snapshot-Montage (Task 5) bauen und danach den persistierten,
unveränderlichen Tageskosten-Snapshot bis zur reviewfähigen PR führen — auf dem bereits
verifizierten Stand der Tasks 0–4.

**Architecture:** Dieser Plan ersetzt den Basisplan
[`2026-08-08-eyt-109-tageskosten-snapshot.md`](2026-08-08-eyt-109-tageskosten-snapshot.md)
**nicht**. Er ist die Fortsetzung: Abschnitt A hält den unabhängig gemessenen Istzustand fest,
Abschnitt B die fünf Divergenzen, die die Rekonstruktion gefunden hat, Abschnitt C den
korrigierten Task 5 in voller Tiefe, Abschnitt D die Deltas zu den Tasks 6–20. Für alles, was
in Abschnitt D nicht auftaucht, gilt der Basisplan unverändert.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
Vitest + SWC, NestJS, Zod, PostgreSQL/Supabase, pnpm + Turborepo.

---

## A. Rekonstruktion — unabhängig gemessen am 09.08.2026

Alles hier ist selbst ausgeführt, nicht aus dem Transkript der Vorsession übernommen.

### A.1 Lage der Arbeit

| Größe                | Gemessener Wert                                                                    |
| -------------------- | ---------------------------------------------------------------------------------- |
| `origin/master`      | `b44e38c6bf7e08a2996c2263309001a1304050f2`                                         |
| PO-Baseline          | `b44e38c6…` — **identisch**, kein Drift, kein Rebase nötig                         |
| EYT-109-Branch       | `feat/eyt-109-daily-plan-cost-snapshot` @ `aea0fb4`                                |
| Arbeitsbaum          | `…/53a83129-…/scratchpad/eyt109-wt` (separater Worktree der Vorsession)            |
| Stand zu Master      | **16 ahead / 0 behind**, `git status --short` leer                                 |
| Remote-Branch        | existiert **nicht** — noch kein `push`, noch kein PR                               |
| Offene PRs           | nur #57 (`[WEGWERF]` EYT-136 Rotnachweis, Draft) — nicht dieser Slice              |
| Nebenläufige Prozess | keiner (`ps` auf `eyt109\|vitest\|supabase` leer) — genau eine schreibende Session |

**Wichtig für die Ausführung:** Der Hauptarbeitsbaum `/Users/benjaminpoersch/EasyTree` steht auf
`fix/eyt-136-planning-data-api-boundary` und trägt uncommittete Fremdarbeit (u. a.
`docs/canvas/sprint-5-daily-cost-export.canvas.md`, `scripts/ops/`). **Dort wird nicht
gearbeitet und nichts aufgeräumt.** EYT-109 läuft ausschließlich im Worktree oben.

`fix/eyt-136-planning-data-api-boundary` @ `60a3ce3` ist vollständig in `origin/master`
enthalten (`merge-base --is-ancestor` = wahr, 0 Commits unmerged). Die PO-Vorbedingung aus dem
Jira-Kommentar vom 07.08.2026 — „EYT-136 schließt die Planning-Data-API-Bypässe vor der
belastbaren Freigabe von EYT-109" — ist damit **erfüllt**.

### A.2 Tasks 0–4 — verifiziert, nicht geglaubt

Rollen aus den **Diffs** bestimmt, nicht aus den Commitmessages:

| Task | Commits                                                                                | Was der Diff wirklich zeigt                                                                                        |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 0    | `ecc00c5`                                                                              | Plandokument, Worktree/Branch                                                                                      |
| 1    | `7be8ebb`, `ea49bac`, `f04b753`, `be5a246`, `643793b`, `f18ed7f`, `94a11ea`, `4bd2141` | Snapshot-/Planversionsschemata in `contracts` + Reviewrunden                                                       |
| 2    | `ade9137`, `b41b3a4`                                                                   | HTTP-Gateway + OpenAPI-Registrierung, `v1.json` regeneriert                                                        |
| 3    | `bd2daa2`                                                                              | `dayBefore` in `packages/domain/src/local-business-date.ts:131` + Invariantenregistrierung                         |
| 4    | `7bdb04c`, `5a140bb`                                                                   | `allocateAcrossLocalDays` (202 → 238 Z.) + Eigenschaftstests an die Umstellungen gezogen                           |
| —    | `aea0fb4`                                                                              | **nur** Plandokument (132 Z.), kein Code — die Vorsession nannte ihn task-4-relevant, er ist es nur dokumentarisch |

### A.3 Gemessene Grünlage (09.08.2026, frisch gebaut, Cache umgangen)

```text
pnpm --filter @easytree/{config,contracts,domain} build   → Done, Exit 0
pnpm --filter @easytree/domain    exec vitest run          → 11 Dateien, 235 Tests grün
pnpm --filter @easytree/contracts exec vitest run          → 9 Dateien, 184 Tests grün
pnpm --filter @easytree/api exec vitest run \
  test/architecture.test.ts test/costs-module-boundaries.test.ts \
  test/domain-invariant-coverage.test.ts test/openapi-route-conformance.test.ts \
  test/costs/rule-version-parity.test.ts test/no-local-time-construction.test.ts
                                                            → 6 Dateien, 68 Tests grün
pnpm exec turbo run typecheck --force                       → 10/10, Cached: 0 von 10
```

`--force` ist kein Schmuck: der Basisplan hat gemessen, dass turbo „1061 passed" meldet, ohne
ein Paket auszuführen. Jede Zahl in diesem Plan stammt aus einem Lauf mit `Cached: 0` oder aus
einem direkten Paketaufruf.

**Node v24.16.0**, `.nvmrc` verlangt 22. Vorbestehende Abweichung; lokale Läufe bleiben damit
eine Stufe unter dem CI-Nachweis. Für Task 5 (reine Domänenrechnung, `bigint`, keine Zeit-API
mit Versionsdrift) ohne Wirkung — im Abschlusspaket trotzdem ausweisen.

### A.4 Status der Behauptungen der Vorsession

| Behauptung              | Befund                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5/20 Tasks fertig       | **BESTÄTIGT** (Task 0 + 1–4)                                                                                                                                                                               |
| 17 Commits              | **KORRIGIERT: 16.** Kein inhaltlicher Unterschied, aber Zahlen dieser Art werden zitiert.                                                                                                                  |
| Domänenschicht komplett | **BESTÄTIGT** für Tasks 3+4; `cost-snapshot-assembly.ts` existiert nicht → Task 5 ist offen                                                                                                                |
| Task 5 als nächstes     | **BESTÄTIGT**                                                                                                                                                                                              |
| 30 Gegenmutationen      | **PARTIALLY_VERIFIED.** Sie stecken als Task-Nachweise in den Commits; die Plan-Matrix GM1–GM9 ist Task 19 und noch nicht gefahren. Nicht als „30 gemessen" zitieren, ohne die Commits einzeln zu belegen. |
| `D1` unauffindbar       | **WIDERLEGT.** D1 ist vollständig dokumentiert, Basisplan Z. 127–156. **Kein `MISSING_CONTEXT_D1`.**                                                                                                       |

### A.5 Jira / Confluence

**Jira EYT-109** gelesen (09.08.2026): Story, Priorität _Highest_, Status **In Arbeit**,
`resolution: null`, unassigned. Akzeptanzkriterien und Out-of-Scope wörtlich übernommen in
Abschnitt B.1. Zwei Kommentare, beide relevant:

- 31.07.2026 — Schnitt aus EYT-105: **Migration der Snapshot-Tabellen gehört zu EYT-109.**
  Transportschicht der Operationen gehört zu **EYT-130**. Lokale Tagesallokation, Mitternacht
  und DST gehören **ausdrücklich** zu EYT-109.
- 07.08.2026 — EYT-136 vor EYT-109. **Erfüllt** (A.1).

> **Folge für die Zuordnung:** Tasks 1+2 (Contract/Gateway/OpenAPI) sind laut diesem Kommentar
> fachlich **EYT-130**, nicht EYT-109. Sie liegen bereits im Branch. Nicht zurückbauen — im
> PR-Body und im Abschlusspaket als Mitlieferung ausweisen, damit der PO entscheidet, ob
> EYT-130 dadurch ganz oder teilweise erledigt ist. Kennung: `SCOPE_OVERLAP_EYT130`.

**Confluence:** in dieser Sitzung **nicht** gelesen → `SOURCE_NEEDED` für `5505026`, `7766017`
(PRD v1.4), `8552449`, `8814623`, `9306113`. Der Basisplan führt dieselbe Kennung (Anhang B).
Sie bleibt offen und wird **vor Task 15** (UI) eingelöst, weil erst dort Basisdesign v2
verbindlich wird. Für Task 5 ist keine dieser Seiten entscheidungsrelevant — Task 5 ist reine
Rechnung gegen den bereits eingefrorenen Vertrag.

---

## B. Divergenzen, die die Rekonstruktion gefunden hat

Fünf Punkte. Drei davon ändern Task 5 substanziell.

### B.1 `D-A` — Task 5 widerspricht sich selbst: Totalblockade vs. Tagesablehnung

**Der Widerspruch.** Basisplan Task 5 sagt an zwei Stellen Gegensätzliches:

- Z. 1181, Testfall 6: „Blockade ist **total**: enthält irgendeine Position einen Fehler, gibt
  es **kein** Teilergebnis." Die Signatur Z. 1209–1217 setzt das um: **ein** Fehlerobjekt für
  den ganzen Lauf.
- Z. 1243–1252, als „verbindlich" markiert: „Abgelehnt werden die betroffenen **TAGE**, nicht
  der ganze Snapshot" — plus Forderung nach einem Summentyp
  `{ ok: true, total } | { ok: false, reasons }` je Tag.

Beides zugleich ist nicht implementierbar.

**Gemessene Auflösung — die Totalblockade gewinnt.** Drei unabhängige Belege, alle bereits im
Repository:

1. **Der Vertrag ist schon gebaut und grün.** `CostDayTotalDtoSchema`
   (`packages/contracts/src/costs/schemas.ts:162`) ist
   `{ localDate, amountMinorUnits }` — eine schlichte Summe. **Kein** Summentyp, **kein**
   `reasons`, **kein** `incomplete`. Committed in Task 1, 184 Tests grün.
2. **Die Migration ist schon entworfen.** Basisplan Task 6 DDL:
   `total_minor_units bigint not null check (total_minor_units >= 0)` im Kopf, keine
   Unvollständigkeitsspalte, keine Gründe­tabelle.
3. **Jira ist wörtlich.** AC: „Fehlende oder mehrdeutige Sätze **blockieren die
   Snapshot-Erzeugung**." Nicht „blockieren den Tag".

Die Fünf-Punkte-Empfehlung in Z. 1235–1260 ist damit ein Vorschlag, der **nach** dem Vertrag
geschrieben wurde und ihn nicht eingeholt hat. Sie ist nicht falsch gedacht — sie ist nur nicht
das, was dieser Slice gebaut hat.

**Entscheidung.** Task 5 blockiert **total**, mit benanntem Verursacher (`assignmentId`,
`employeeId`, `localDate`). Das erfüllt alle vier tragenden Anliegen der Empfehlung: kein
stilles Verschwinden, kein geratener Zweig, kein `0,00 €`, keine Zahl mit Flagge, die ein
Export fallen lassen kann.

**Was das kostet, ehrlich benannt:** in `America/Santiago`, `America/Havana`, `Asia/Beirut`,
`Atlantic/Azores` macht **ein** Einsatz über die kaputte Mitternacht den Snapshot der ganzen
Woche unerzeugbar. Für den Pilotbetrieb (`Europe/Berlin`, Umstellung 02:00) unerreichbar.
Kennung `PO_DECISION_DAY_PARTIAL`: die Tagesablehnung nachzurüsten ist eine **Vertrags-**
änderung (`CostDayTotalDto` + Migration + EYT-110-Exportsemantik), kein Refactoring. Gehört in
den PR-Body als benannte, bewusst nicht getroffene Entscheidung.

### B.2 `D-B` — Task 5 braucht Labels, die es zu diesem Zeitpunkt nicht gibt

`CostPositionDtoSchema` (`schemas.ts:131,133`) verlangt `worksiteLabel` und `employeeLabel`
jeweils als `z.string().min(1)`. Ohne sie kann Task 5 keine vertragsfähige Position bauen.

`PublishedPlanFacts` (`costs/domain/planned-work-fact.ts:61`) trägt heute
`{ planVersionId, weekKey, timeZone, work[] }` — **keine Labels**. Sie kommen laut Basisplan
erst in **Task 8**.

**Entscheidung.** Task 5 nimmt die Labels als **eigene Eingabefelder**
(`employeeLabels`/`worksiteLabels` als `ReadonlyMap<string, string>`), statt `PublishedPlanFacts`
vorzuziehen. Grund: `PublishedPlanFacts` jetzt um Pflichtfelder zu erweitern bricht sofort
`planning-facts.adapter.ts` und zieht Task 8 zur Hälfte in Task 5 — genau das, was der Auftrag
(„nicht mehrere große Tasks halb implementieren") ausschließt. So bleibt Task 5 **rein additiv**:
eine neue Datei, ein neuer Test, kein bestehender Aufrufer berührt.

Fehlendes Label ist ein benannter Ablehnungsgrund (`LABEL_MISSING`), keine Ausnahme und kein
Platzhaltertext. Ein `"—"` an dieser Stelle wäre eine erfundene Tatsache in einem historischen
Dokument.

### B.3 `D-C` — `RATE_MISSING` existiert nicht, `RATE_NOT_FOUND` schon

Basisplan Task 5 Z. 1173/1202 fordert `RATE_MISSING`. Gemessen:

- `effectiveRateVersion` liefert `RATE_NOT_FOUND` (`rate-effectivity.ts:24`).
- `RATE_ERROR_TYPE` führt bereits `RATE_NOT_FOUND: "urn:easytree:costs:rate-not-found"` und
  `RATE_AMBIGUOUS: "urn:easytree:costs:rate-ambiguous"` (`costs-error-type.ts`).

`RATE_MISSING` einzuführen hieße, für einen Sachverhalt zwei Namen und zwei URNs zu führen. Die
Datei sagt selbst: „Diese Werte sind Teil des Vertrags. Sie umzubenennen ist eine
Vertragsänderung, kein Refactoring."

**Entscheidung.** Task 5 reicht `RATE_NOT_FOUND` und `RATE_AMBIGUOUS` unverändert durch.

### B.4 `D-D` — `computedAt` ist in Task 5 unbenutzt

Basisplan Z. 1198 gibt der Montage `computedAt: Date` als Eingabe. Gemessen: `costOfDuration`
(`cost-position.ts:178`) nimmt nur `(rate, quantity)`. `computedAt` bräuchte nur
`computeCostPosition` — und das ist per D1 ausdrücklich **nicht** im Einsatz. Der
Erstellungszeitpunkt gehört in den Snapshotkopf und entsteht im Use-Case (Task 10).

**Entscheidung.** `computedAt` entfällt in Task 5. Ein Feld, das niemand liest, ist eine
Behauptung über Reinheit, die keinen Träger hat.

### B.5 `D-E` — Zählung

16 Commits, nicht 17. Bereits in A.4 festgehalten.

---

## C. Task 5 — Costs-Domain: Snapshot-Montage (korrigiert)

**Dateien:**

- Erstellen: `apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts`
- Erstellen: `apps/api/test/costs/cost-snapshot-assembly.test.ts`
- Sonst **nichts**. Berührt dieser Task eine weitere Datei, ist etwas aus Task 8 hereingerutscht.

Diese Datei ist die einzige Stelle, an der Tagesallokation, Satzauswahl und Geldrechnung
zusammenkommen. Rein: kein NestJS, kein `pg`, keine Uhr. Die Architekturregel
`costs-domain-purity` erlaubt hier nur relative Pfade innerhalb `costs/domain/` und
`@easytree/domain`.

### Vor dem Start

```bash
cd /private/tmp/claude-501/-Users-benjaminpoersch-EasyTree/53a83129-a6b7-4e6a-9575-6b82421267b5/scratchpad/eyt109-wt
git branch --show-current      # erwartet: feat/eyt-109-daily-plan-cost-snapshot
git status --short             # erwartet: leer
pnpm --filter @easytree/domain build   # apps/api liest dist/, nicht src/
```

Der `build` ist Pflicht, nicht Vorsicht: `noEmitOnError` ist nirgends gesetzt, ein alter
`dist/` färbt den Einzeltest grün, ohne die neue Regel je auszuführen.

### Schritt 1: Den roten Test schreiben

`apps/api/test/costs/cost-snapshot-assembly.test.ts`. Acht Fälle — die sechs des Basisplans plus
zwei aus B.1/B.2:

```ts
import { describe, expect, it } from "vitest";
import {
  assembleCostSnapshotPositions,
  type SnapshotAssemblyInput,
} from "../../src/modules/costs/domain/cost-snapshot-assembly";
import type { RateVersionRecord } from "../../src/modules/costs/domain/rate-version";
import type { PublishedPlanFacts } from "../../src/modules/costs/domain/planned-work-fact";

// 08:00–16:00 Berlin am 2026-06-15 = 06:00–14:00 UTC. Acht Stunden.
const EINSATZ = {
  assignmentId: "11111111-1111-4111-8111-111111111111",
  employeeId: "22222222-2222-4222-8222-222222222222",
  worksiteId: "33333333-3333-4333-8333-333333333333",
  startsAtUtc: new Date("2026-06-15T06:00:00.000Z"),
  endsAtUtc: new Date("2026-06-15T14:00:00.000Z"),
} as const;

function fakten(ueberschreibung: Partial<PublishedPlanFacts> = {}): PublishedPlanFacts {
  return {
    planVersionId: "44444444-4444-4444-8444-444444444444",
    weekKey: "2026-W25",
    timeZone: "Europe/Berlin",
    work: [EINSATZ],
    ...ueberschreibung,
  } as PublishedPlanFacts;
}

function satz(ueberschreibung: Partial<RateVersionRecord> = {}): RateVersionRecord {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    employeeId: EINSATZ.employeeId,
    amountMinorUnits: "2500", // 25,00 EUR/h
    currency: "EUR",
    validFrom: "2026-01-01",
    validTo: null,
    predecessorId: null,
    reason: "Ersteintrag",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "66666666-6666-4666-8666-666666666666",
    ...ueberschreibung,
  };
}

function eingabe(ueberschreibung: Partial<SnapshotAssemblyInput> = {}): SnapshotAssemblyInput {
  return {
    facts: fakten(),
    worksiteFilter: null,
    employeeLabels: new Map([[EINSATZ.employeeId, "Anna Bauer"]]),
    worksiteLabels: new Map([[EINSATZ.worksiteId, "Baustelle Nord"]]),
    ratesByEmployee: new Map([[EINSATZ.employeeId, [satz()]]]),
    ...ueberschreibung,
  };
}

describe("assembleCostSnapshotPositions", () => {
  it("rechnet einen Einsatz mit einem Satz zu genau einer Position", () => {
    const ergebnis = assembleCostSnapshotPositions(eingabe());
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions).toHaveLength(1);
    // 8 h * 25,00 EUR = 200,00 EUR. Exakt, nicht gerundet.
    expect(ergebnis.positions[0]?.amountMinorUnits).toBe(20000n);
    expect(ergebnis.positions[0]?.localDate).toBe("2026-06-15");
    expect(ergebnis.positions[0]?.employeeLabel).toBe("Anna Bauer");
  });

  it("teilt einen Einsatz ueber Mitternacht auf zwei Ortstage", () => {
    // 22:00–02:00 Berlin = 20:00Z (15.06.) bis 00:00Z (16.06.).
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({
          work: [
            {
              ...EINSATZ,
              startsAtUtc: new Date("2026-06-15T20:00:00.000Z"),
              endsAtUtc: new Date("2026-06-16T00:00:00.000Z"),
            },
          ],
        }),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions.map((p) => p.localDate)).toEqual(["2026-06-15", "2026-06-16"]);
    // Beide tragen DENSELBEN Einsatz — das ist die Aussage.
    expect(new Set(ergebnis.positions.map((p) => p.assignmentId)).size).toBe(1);
    const summe = ergebnis.positions.reduce((s, p) => s + p.amountMinorUnits, 0n);
    expect(summe).toBe(10000n); // 4 h * 25,00
  });

  it("blockiert ohne Satz am Leistungsdatum und nennt Person und Tag", () => {
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({ ratesByEmployee: new Map([[EINSATZ.employeeId, []]]) }),
    );
    expect(ergebnis).toEqual({
      ok: false,
      problem: "RATE_NOT_FOUND",
      assignmentId: EINSATZ.assignmentId,
      employeeId: EINSATZ.employeeId,
      localDate: "2026-06-15",
    });
  });

  it("blockiert bei zwei gueltigen Saetzen, statt einen zu greifen", () => {
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        ratesByEmployee: new Map([
          [EINSATZ.employeeId, [satz(), satz({ id: "77777777-7777-4777-8777-777777777777" })]],
        ]),
      }),
    );
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("RATE_AMBIGUOUS");
  });

  it("waehlt am Nahtstellentag den Nachfolger — dieser Fall friert D1 ein", () => {
    // Satz A [2026-06-01, 2026-07-01), Satz B [2026-07-01, ∞).
    // Am 2026-07-01 gilt GENAU B.
    //
    // Wer hier auf `selectRateVersion` aus `@easytree/domain` umstellt, bekommt
    // RATE_AMBIGUOUS: die einschliessende Lesart der Domaene passt nicht zur
    // halboffenen Lesart der Datenbank (Migration 0013). Siehe D1.
    const a = satz({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      validFrom: "2026-06-01",
      validTo: "2026-07-01",
    });
    const b = satz({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      validFrom: "2026-07-01",
      validTo: null,
      amountMinorUnits: "3000",
    });
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({
          weekKey: "2026-W27",
          work: [
            {
              ...EINSATZ,
              startsAtUtc: new Date("2026-07-01T06:00:00.000Z"),
              endsAtUtc: new Date("2026-07-01T14:00:00.000Z"),
            },
          ],
        }),
        ratesByEmployee: new Map([[EINSATZ.employeeId, [a, b]]]),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions[0]?.rateVersionId).toBe(b.id);
    expect(ergebnis.positions[0]?.amountMinorUnits).toBe(24000n); // 8 h * 30,00
  });

  it("liefert kein Teilergebnis, wenn ein einziger Einsatz blockiert", () => {
    const heil = { ...EINSATZ, assignmentId: "88888888-8888-4888-8888-888888888888" };
    const kaputt = {
      ...EINSATZ,
      assignmentId: "99999999-9999-4999-8999-999999999999",
      employeeId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
    };
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({ work: [heil, kaputt] }),
        employeeLabels: new Map([
          [EINSATZ.employeeId, "Anna Bauer"],
          [kaputt.employeeId, "Bea Cordes"],
        ]),
        // Fuer `kaputt` liegt kein Satz vor.
        ratesByEmployee: new Map([[EINSATZ.employeeId, [satz()]]]),
      }),
    );
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    // Der Verursacher wird benannt — nicht "irgendwas ging schief".
    expect(ergebnis.assignmentId).toBe(kaputt.assignmentId);
  });

  it("blockiert bei fehlendem Label, statt einen Platzhalter zu erfinden", () => {
    const ergebnis = assembleCostSnapshotPositions(eingabe({ worksiteLabels: new Map() }));
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("LABEL_MISSING");
  });

  it("ordnet deterministisch nach (localDate, worksiteId, employeeLabel, assignmentId)", () => {
    // Zwei Einsaetze am selben Tag, absichtlich in falscher Reihenfolge geliefert.
    const spaet = { ...EINSATZ, assignmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
    const frueh = { ...EINSATZ, assignmentId: "00000000-0000-4000-8000-000000000000" };
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({ facts: fakten({ work: [spaet, frueh] }) }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions.map((p) => p.assignmentId)).toEqual([
      frueh.assignmentId,
      spaet.assignmentId,
    ]);
  });
});
```

### Schritt 2: Rot bestätigen

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts
```

Erwartet: **FAIL**, `Cannot find module '../../src/modules/costs/domain/cost-snapshot-assembly'`.

> Ein Modul-nicht-gefunden ist hier **kein** fachlicher Rotnachweis, sondern nur der Beweis,
> dass der Test wirklich läuft. Der fachliche Rotnachweis kommt in Schritt 6 als Gegenmutation.

### Schritt 3: Implementieren — die kleinste tragfähige Fassung

`apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts`:

```ts
/**
 * Montage der Snapshotpositionen (EYT-109).
 *
 * Die EINZIGE Stelle, an der Tagesallokation (EYT-109), Satzauswahl (EYT-108)
 * und Geldregel (EYT-95) zusammentreffen. Rein: kein NestJS, kein `pg`, keine
 * Uhr — der Erstellungszeitpunkt gehoert in den Snapshotkopf und entsteht im
 * Use-Case.
 *
 * ## Warum `effectiveRateVersion` und nicht `selectRateVersion`
 *
 * Die Datenbank liest `[validFrom, validTo)` halboffen (Migration 0013,
 * EXCLUDE-Constraint). `@easytree/domain::selectRateVersion` liest `validTo`
 * EINSCHLIESSEND. An jedem Nahtstellentag — Satz A endet, Satz B beginnt am
 * selben Tag — lieferte die Domaenenlesart RATE_AMBIGUOUS fuer eine
 * Konstellation, die die Datenbank ausdruecklich zulaesst. Deshalb waehlt die
 * Modulregel, und `costOfDuration` bekommt die einmal uebersetzte Version.
 * Siehe D1 im Plan; ein Test friert den Fall ein.
 *
 * ## Warum die Blockade total ist
 *
 * Jira EYT-109: "Fehlende oder mehrdeutige Saetze blockieren die
 * Snapshot-Erzeugung." Ein Teilergebnis waere eine Summe, die vollstaendig
 * aussieht und es nicht ist — und der Export (EYT-110) bekaeme kein Feld, an
 * dem er die Luecke bemerken koennte.
 */
import {
  allocateAcrossLocalDays,
  costOfDuration,
  createTimeZone,
  dayBefore,
  hourlyRateAmount,
  hourlyRateVersion,
  moneyOfMinorUnits,
  TimeInterval,
  unsafeIdentifier,
  COST_RULE_VERSION,
} from "@easytree/domain";
import type { LocalBusinessDate, RateVersionId } from "@easytree/domain";
import { effectiveRateVersion } from "./rate-effectivity";
import type { RateVersionRecord } from "./rate-version";
import type { PublishedPlanFacts } from "./planned-work-fact";

export interface AssembledPosition {
  readonly assignmentId: string;
  readonly worksiteId: string;
  readonly worksiteLabel: string;
  readonly employeeId: string;
  readonly employeeLabel: string;
  /** Ortstag in der Zone der Organisation, `JJJJ-MM-TT`. */
  readonly localDate: string;
  readonly durationMilliseconds: bigint;
  readonly rateVersionId: string;
  readonly amountMinorUnits: bigint;
  readonly ruleVersion: typeof COST_RULE_VERSION;
}

export interface SnapshotAssemblyInput {
  readonly facts: PublishedPlanFacts;
  /** `null` = alle Baustellen der Planversion. */
  readonly worksiteFilter: string | null;
  readonly employeeLabels: ReadonlyMap<string, string>;
  readonly worksiteLabels: ReadonlyMap<string, string>;
  readonly ratesByEmployee: ReadonlyMap<string, readonly RateVersionRecord[]>;
}

export const SNAPSHOT_ASSEMBLY_PROBLEMS = [
  "RATE_NOT_FOUND",
  "RATE_AMBIGUOUS",
  /**
   * Die gespeicherte Satzzeile passiert die Domaenenfactory nicht — negativer
   * Betrag oder `validTo` vor `validFrom`. Mit den Checks aus Migration 0013
   * unerreichbar; der Zweig steht trotzdem, weil ein `!` an dieser Stelle eine
   * Pruefung BEHAUPTEN wuerde, die niemand ausfuehrt.
   */
  "RATE_INVALID",
  "LABEL_MISSING",
  "DAY_BOUNDARY_NONEXISTENT",
  "DAY_BOUNDARY_AMBIGUOUS",
  "TIME_ZONE_UNKNOWN",
  "INTERVAL_INVALID",
] as const;
export type SnapshotAssemblyProblem = (typeof SNAPSHOT_ASSEMBLY_PROBLEMS)[number];

export type SnapshotAssemblyResult =
  | { readonly ok: true; readonly positions: readonly AssembledPosition[] }
  | {
      readonly ok: false;
      readonly problem: SnapshotAssemblyProblem;
      /** Genug fuer eine handlungsorientierte Meldung — und nicht mehr. */
      readonly assignmentId: string | null;
      readonly employeeId: string | null;
      readonly localDate: string | null;
    };

export function assembleCostSnapshotPositions(
  input: SnapshotAssemblyInput,
): SnapshotAssemblyResult {
  // Die Zonenpruefung passiert HIER, wo die Zone angewendet wird — so steht es
  // im Kopfkommentar von `planned-work-fact.ts`.
  const zone = createTimeZone(input.facts.timeZone);
  if (!zone.ok) {
    return {
      ok: false,
      problem: "TIME_ZONE_UNKNOWN",
      assignmentId: null,
      employeeId: null,
      localDate: null,
    };
  }

  const positionen: AssembledPosition[] = [];

  for (const einsatz of input.facts.work) {
    if (input.worksiteFilter !== null && einsatz.worksiteId !== input.worksiteFilter) continue;

    const scheitern = (problem: SnapshotAssemblyProblem, localDate: string | null) => ({
      ok: false as const,
      problem,
      assignmentId: einsatz.assignmentId,
      employeeId: einsatz.employeeId,
      localDate,
    });

    const intervall = TimeInterval.create(einsatz.startsAtUtc, einsatz.endsAtUtc);
    if (!intervall.ok) return scheitern("INTERVAL_INVALID", null);

    const anteile = allocateAcrossLocalDays(intervall.interval, zone.timeZone);
    if (!anteile.ok) return scheitern(anteile.error, null);

    const worksiteLabel = input.worksiteLabels.get(einsatz.worksiteId);
    const employeeLabel = input.employeeLabels.get(einsatz.employeeId);
    if (worksiteLabel === undefined || employeeLabel === undefined) {
      return scheitern("LABEL_MISSING", null);
    }

    const saetze = input.ratesByEmployee.get(einsatz.employeeId) ?? [];

    for (const anteil of anteile.parts) {
      const tag = formatLocalDate(anteil.date);
      const gewaehlt = effectiveRateVersion(saetze, tag);
      if (!gewaehlt.ok) return scheitern(gewaehlt.problem, tag);

      // `hourlyRateAmount` und `hourlyRateVersion` sind BEIDE Result-Factories,
      // nicht direkte Konstruktoren. Das Ergebnis auszupacken statt `!` zu
      // schreiben ist der Unterschied zwischen einer Pruefung und ihrer
      // Behauptung (`money.ts:266`, `rate-version.ts:138`).
      const satzBetrag = hourlyRateAmount(
        moneyOfMinorUnits(BigInt(gewaehlt.version.amountMinorUnits), gewaehlt.version.currency),
      );
      if (!satzBetrag.ok) return scheitern("RATE_INVALID", tag);

      // Halboffen (DB) -> einschliessend (Domaene). `null` bleibt `null`.
      // Der DB-Check `valid_to > valid_from` schliesst das leere Intervall aus.
      const version = hourlyRateVersion({
        rateVersionId: unsafeIdentifier<RateVersionId>(gewaehlt.version.id),
        amountPerHour: satzBetrag.rate,
        validFrom: parseLocalDate(gewaehlt.version.validFrom),
        validTo:
          gewaehlt.version.validTo === null
            ? null
            : dayBefore(parseLocalDate(gewaehlt.version.validTo)),
      });
      if (!version.ok) return scheitern("RATE_INVALID", tag);

      const betrag = costOfDuration(version.version, anteil.quantity);

      positionen.push({
        assignmentId: einsatz.assignmentId,
        worksiteId: einsatz.worksiteId,
        worksiteLabel,
        employeeId: einsatz.employeeId,
        employeeLabel,
        localDate: tag,
        durationMilliseconds: BigInt(anteil.quantity.milliseconds),
        rateVersionId: gewaehlt.version.id,
        amountMinorUnits: betrag.minorUnits,
        ruleVersion: COST_RULE_VERSION,
      });
    }
  }

  // Feste Ordnung: ohne sie waeren zwei Laeufe nicht vergleichbar und der
  // Export (EYT-110) nicht reproduzierbar. Die Reihenfolge wird in Task 11 als
  // `ordinal` eingefroren.
  positionen.sort(
    (a, b) =>
      a.localDate.localeCompare(b.localDate) ||
      a.worksiteId.localeCompare(b.worksiteId) ||
      a.employeeLabel.localeCompare(b.employeeLabel) ||
      a.assignmentId.localeCompare(b.assignmentId),
  );

  return { ok: true, positions: positionen };
}

/**
 * `JJJJ-MM-TT` aus einem geprueften Ortstag — mit String-Padding, nie ueber
 * `Date`. Ein `new Date(...)` machte aus einem Kalendertag wieder einen
 * Zeitpunkt in irgendeiner Zone; genau das verbietet
 * `no-local-time-construction.test.ts`.
 */
function formatLocalDate(date: LocalBusinessDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${String(date.year).padStart(4, "0")}-${mm}-${dd}`;
}

/**
 * `JJJJ-MM-TT` -> {@link LocalBusinessDate}, ohne `Date`.
 *
 * `@easytree/domain` exportiert bewusst KEINE solche Funktion: `LocalBusinessDate`
 * ist ein offenes Interface ohne Laufzeitvalidierung, und das Paket sagt dazu
 * ausdruecklich „wer diese Eingabe ausschliessen will, tut das an der Grenze, an
 * der das Datum entsteht" (`local-business-date.ts`). Diese Grenze ist hier: die
 * Zeichenkette kommt aus `date`-Spalten, die PostgreSQL bereits als Kalendertag
 * gepruft hat.
 */
function parseLocalDate(iso: string): LocalBusinessDate {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}
```

> **Jeder Name oben ist am 09.08.2026 gegen `packages/domain/src/index.ts` gemessen.** Der
> erste Entwurf dieses Plans hatte zwei Funktionen erfunden (`timeInterval`,
> `parseLocalBusinessDate`) und vier Result-Factories als direkte Konstruktoren behandelt.
> Gemessene Vertragslage, auf die sich der Code oben stützt:
>
> | Aufruf                    | Rückgabe                                      | Quelle                        |
> | ------------------------- | --------------------------------------------- | ----------------------------- |
> | `TimeInterval.create`     | `{ok:true, interval}` \| `{ok:false, error}`  | `time-interval.ts:95,144`     |
> | `createTimeZone`          | `{ok:true, timeZone}` \| `{ok:false, error}`  | `planning-week.ts:55,66`      |
> | `moneyOfMinorUnits`       | `Money` **direkt**, kein Result               | `money.ts:125`                |
> | `hourlyRateAmount`        | `{ok:true, rate}` \| `{ok:false, error}`      | `money.ts:266`                |
> | `hourlyRateVersion`       | `{ok:true, version}` \| `{ok:false, error}`   | `rate-version.ts:138`         |
> | `costOfDuration`          | `PlanCostAmount` (Money-Marke, `.minorUnits`) | `cost-position.ts:178`        |
> | `dayBefore`               | `LocalBusinessDate` **direkt**                | `local-business-date.ts:131`  |
> | `allocateAcrossLocalDays` | `{ok:true, parts}` \| `{ok:false, error}`     | `local-day-allocation.ts:104` |
>
> Zwei Fallen, die daraus folgen: `HourlyRateVersionInput` verlangt ein **gebrandetes**
> `rateVersionId: RateVersionId` (deshalb `unsafeIdentifier`), und
> `parseLocalBusinessDate` existiert **nicht** — der lokale Helfer unten ersetzt ihn.
> Weicht bei der Umsetzung dennoch etwas ab, gilt der Export, nicht dieser Plan; die
> Abweichung kommt in Abschnitt E.

### Schritt 4: Grün bestätigen

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts
```

Erwartet: 8 Tests grün.

### Schritt 5: Grenzen und Typen halten

```bash
pnpm --filter @easytree/api exec vitest run \
  test/costs-module-boundaries.test.ts test/architecture.test.ts \
  test/no-local-time-construction.test.ts
pnpm exec turbo run typecheck --force
```

`costs-domain-purity` und `costs-single-money-implementation` müssen grün bleiben. Werden sie
rot, ist ein Import hereingekommen, der dort nicht hingehört — das ist die Regel, die arbeitet,
nicht ein Hindernis, das man umgeht.

### Schritt 6: Gegenmutation GM4 — ausführen, messen, zurücknehmen

Der fachliche Rotnachweis. **Ausführen, nicht ausdenken.**

```bash
cp apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts /tmp/gm4-backup.ts
```

Mutation: in `assembleCostSnapshotPositions` den Aufruf `effectiveRateVersion(saetze, tag)`
ersetzen durch „nimm die Version mit dem größten `validFrom`" — eine **kohärente** falsche
Implementierung, keine halbe:

```ts
const sortiert = [...saetze].sort((x, y) => y.validFrom.localeCompare(x.validFrom));
const gewaehlt =
  sortiert.length === 0
    ? ({ ok: false, problem: "RATE_NOT_FOUND" } as const)
    : ({ ok: true, version: sortiert[0] as RateVersionRecord } as const);
```

```bash
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts
```

**Erwartet rot:** „waehlt am Nahtstellentag den Nachfolger" bleibt grün (B ist ohnehin der
neueste), aber **„blockiert bei zwei gueltigen Saetzen"** fällt — die Mutation greift still
einen Satz, statt zu blockieren. Genau die Schadensform, die EYT-109 ausschließt.

> Fällt **kein** Test, ist das ein Befund, keine Formalie: die Testmenge misst die Satzauswahl
> dann nicht. Dann fehlt ein Fall, in dem der wirksame Satz **nicht** der neueste ist — z. B.
> ein Einsatz am 2026-06-15 bei Sätzen `[2026-06-01, 2026-07-01)` und `[2026-07-01, ∞)`.
> Diesen Fall ergänzen, bevor die Mutation zurückgenommen wird.

Zurücknehmen und Grün wiederherstellen:

```bash
cp /tmp/gm4-backup.ts apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts
rm /tmp/gm4-backup.ts
pnpm --filter @easytree/api exec vitest run test/costs/cost-snapshot-assembly.test.ts
```

`cp` und nicht `git checkout --`: die Datei ist zu diesem Zeitpunkt **uncommittet**, ein
`checkout` stellte den Commit-Stand her und verwürfe die ganze Implementierung.

### Schritt 7: Zweite Gegenmutation GM7 — die Geldregel

```bash
cp apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts /tmp/gm7-backup.ts
```

Mutation: `costOfDuration(version, anteil.quantity)` ersetzen durch

```ts
const betrag = {
  minorUnits: BigInt(
    Math.round(
      (Number(gewaehlt.version.amountMinorUnits) * anteil.quantity.milliseconds) / 3_600_000,
    ),
  ),
};
```

**Erwartet rot:** ein Fall mit exaktem Halbwert. Der Testsatz oben enthält ihn **noch nicht** —
25,00 EUR über 8 h ergibt glatt 20000. Vor der Messung deshalb einen Fall ergänzen, dessen
Produkt exakt auf `,5` Minor Units fällt (z. B. Satz `333` Minor Units über 30 Minuten →
`333 * 1_800_000 / 3_600_000 = 166,5` → `HALF_UP_NON_NEGATIVE` ⇒ `167`, `Math.round` ⇒ `167`;
also einen Halbwert wählen, bei dem die Verfahren **auseinandergehen**, etwa einen negativen
oder einen mit Gleitkommadrift wie `Number.MAX_SAFE_INTEGER`-nahe Beträge).

> **Ehrlich:** Ob `Math.round` und `HALF_UP_NON_NEGATIVE` bei nichtnegativen Werten überhaupt je
> auseinandergehen, ist in dieser Sitzung **nicht gemessen**. Bei nichtnegativen Halbwerten
> runden beide aufwärts. Der echte Unterschied ist die **Gleitkommadrift**: `Number(...)` über
> `2^53` verliert Präzision, `bigint` nicht. Der Testfall muss also ein Produkt erzeugen, das
> `Number` nicht mehr exakt darstellt — z. B. `amountMinorUnits: "9007199254740993"`. Geht auch
> das nicht auf, ist GM7 **kein tragfähiger Rotnachweis** und wird als solcher gemeldet
> (`GM7_NOT_ACHIEVABLE`) statt behauptet. Die Geldregel bleibt dann durch
> `costs-single-money-implementation` (statischer Wächter) belegt, nicht durch eine Mutation.

Zurücknehmen wie in Schritt 6.

### Schritt 8: Committen

```bash
git add apps/api/src/modules/costs/domain/cost-snapshot-assembly.ts \
        apps/api/test/costs/cost-snapshot-assembly.test.ts
git diff --cached --name-only     # erwartet: GENAU diese zwei Zeilen
git commit -m "feat(costs): EYT-109 — reine Snapshot-Montage aus Tagesanteilen, Satzversion und zentraler Geldregel"
```

Zeigt `--name-only` mehr als zwei Dateien: **nicht committen**, sondern klären, was
hereingerutscht ist.

### Schritt 9: Plan fortschreiben

Die drei Divergenzen B.1–B.3 und jede in Schritt 3 gemessene Namensabweichung in Abschnitt E
dieses Dokuments eintragen. Separater Commit:

```bash
git add docs/plans/2026-08-09-eyt-109-session-b-fortsetzung.md
git commit -m "docs(plan): EYT-109 — Task-5-Divergenzen und gemessene Korrekturen"
```

---

## D. Deltas zu den Tasks 6–20

Für alles hier nicht Genannte gilt der Basisplan unverändert.

### Task 6 — Migrationsnummer prüfen, nicht annehmen

`0018` ist eine Hypothese aus dem alten Plan. **Vor dem Anlegen messen:**

```bash
ls supabase/migrations/ | tail -5
git log origin/master --oneline -- supabase/migrations/ | head -5
```

Ist `0018` belegt, die nächste freie Nummer nehmen und den Dateinamen der Konvention
`<timestamp>_NNNN_<slug>.sql` folgen lassen (`supabase migration new` liefert nur den
Timestamp — **umbenennen**).

Zusatz gegenüber dem Basisplan: **keine** Unvollständigkeitsspalte, **keine** Gründetabelle
(B.1). `total_minor_units` bleibt eine einzelne Summe.

### Task 8 — `PublishedPlanFacts` erweitern, Task 5 nicht anfassen

Task 8 fügt `publishedAt`, `worksiteLabels`, `employeeLabels` zu `PublishedPlanFacts` hinzu.
Die Montage aus Task 5 nimmt die Labels weiterhin als **eigene Parameter** (B.2) — der Use-Case
(Task 10) reicht sie aus den Fakten durch. Das ist eine Zeile im Use-Case und hält die reine
Funktion frei von einer Struktur, die nur die Infrastruktur kennt.

### Task 10 — `createdAt` entsteht hier

`computedAt` ist aus Task 5 entfallen (B.4). Der Erstellungszeitpunkt des Snapshotkopfes wird im
Use-Case gesetzt und ist dort testbar zu injizieren (Uhr als Abhängigkeit, nicht `new Date()` im
Rumpf).

### Task 13 — `NOT_YET_IMPLEMENTED` muss schrumpfen

Der Basisplan hat das bereits korrigiert: nach Task 2 stehen **acht** Einträge, Task 13 muss auf
**fünf** schrumpfen, erzwungen durch die `stale`-Zusicherung in
`openapi-route-conformance.test.ts:212-217`. Keine weitere Änderung.

### Task 15 — Confluence vorher lesen

`SOURCE_NEEDED` aus A.5 wird **vor** Task 15 eingelöst: `8814623` (Basisdesign v2.0) und
`8552449` (Sprint 5) bestimmen Zustandsmuster und Pflichtangaben der `/kosten`-Fläche.
Abweichungen melden, nicht still einarbeiten.

### Task 19 — Matrix um GM4/GM7 kürzen

GM4 und GM7 sind in Task 5 Schritt 6/7 bereits ausgeführt und gemessen. In Task 19 werden sie
mit **Commit-SHA und Messergebnis** referenziert, nicht erneut gefahren. GM7 ggf. als
`GM7_NOT_ACHIEVABLE` (siehe Schritt 7).

### Task 20 — Abschlusspaket

Zusätzlich zu den Punkten des Basisplans in das PO-Paket aufnehmen:

- `SCOPE_OVERLAP_EYT130` — Tasks 1+2 sind laut Jira-Kommentar fachlich EYT-130 (A.5).
- `PO_DECISION_DAY_PARTIAL` — Totalblockade statt Tagesablehnung, mit Kostenaussage (B.1).
- `DOC_DRIFT` D1 — zwei Satzauswahlen, Folgeticket vorschlagen.
- Node v24 statt 22 bei lokalen Läufen.
- `pnpm build` an der Wurzel vorbestehend kaputt (turbo Strict-Env), CI umgeht es.

---

## E. Korrekturen am Plan, gemessen während der Ausführung

Hier trägt der Ausführende ein, wo dieser Plan falsch lag. Leer zu bleiben ist das
unwahrscheinlichste Ergebnis.

| Datum      | Planaussage                                                           | Gemessen                                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 09.08.2026 | Erster Entwurf dieses Plans rief `timeInterval(start, end)` auf       | Existiert nicht. `TimeInterval` ist eine **Klasse**; der Einstieg heisst `TimeInterval.create` (`index.ts:32-40` exportiert sie ausdruecklich als Wert, damit `create` erreichbar ist). |
| 09.08.2026 | Erster Entwurf rief `parseLocalBusinessDate(iso)` auf                 | Existiert nicht und ist bewusst nicht exportiert. `local-business-date.ts` sagt: Validierung gehoert an die Grenze, an der das Datum entsteht. Lokaler Helfer `parseLocalDate`.         |
| 09.08.2026 | `hourlyRateAmount(...)` direkt als `amountPerHour` eingesetzt         | Ist eine Result-Factory (`money.ts:266`). Ebenso `hourlyRateVersion` (`rate-version.ts:138`). Beide auspacken; daraus entstand der Code `RATE_INVALID`.                                 |
| 09.08.2026 | `hourlyRateVersion` bekomme nur `{validFrom, validTo, amountPerHour}` | `HourlyRateVersionInput` verlangt zusaetzlich `rateVersionId: RateVersionId` — **gebrandet**, also ueber `unsafeIdentifier`.                                                            |

---

## F. Abbruchbedingungen

Anhalten und melden statt weiterzubauen, wenn:

- ein Export aus `@easytree/domain` anders heißt oder eine andere Signatur hat und die
  Abweichung mehr als eine Umbenennung ist (dann stimmt das Modell von Task 5 nicht);
- `costs-domain-purity` rot wird und die einzige Abhilfe ein Import wäre, den die Regel
  verbietet;
- eine Gegenmutation **keinen** Test rot macht (Befund, nicht Formalie);
- der Kontext nach Task 11 (PostgreSQL-Repository) stark angewachsen ist — dann ist der
  Architekturmeilenstein „persistierter Snapshot" erreicht und ein sauberer Handoff besser als
  ein Durchlauf bis Task 20.

**Nicht** mergen. **Nicht** EYT-109 auf _Fertig_ setzen. **Nicht** EYT-110 beginnen.
