/**
 * ISO-Wochenschluessel: jahresabhaengige Gueltigkeit (EYT-88).
 *
 * ## Der Befund
 *
 * `PlanningWindowQuerySchema` erzwingt heute `^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$`.
 * Das haelt `W00`, `W54` und `W99` draussen — aber es laesst `W53` in JEDEM
 * Jahr durch. Die meisten Jahre haben nur 52 ISO-Wochen; `2025-W53` bezeichnet
 * keine reale Woche und darf nicht in `plan_versions` landen.
 *
 * Der Dateikopf von `planning/schemas.ts` haelt das ausdruecklich fest:
 * "Jahrabhaengig ungueltige 53. Wochen bleiben erlaubt: dafuer braeuchte es
 * eine Kalenderrechnung, und die gibt es hier bewusst nicht." Diese Datei ist
 * der Anfang davon.
 *
 * ## Welche Jahre 53 Wochen haben
 *
 * Ein ISO-Jahr hat genau dann 53 Wochen, wenn der 1. Januar ein Donnerstag ist
 * ODER es ein Schaltjahr ist und der 1. Januar ein Mittwoch. Beides folgt aus
 * der Donnerstagsregel: Woche 1 ist die Woche, die den ersten Donnerstag des
 * Jahres enthaelt.
 *
 *   2020  1. Januar Mittwoch, Schaltjahr   -> 53
 *   2021  1. Januar Freitag                -> 52
 *   2025  1. Januar Mittwoch, kein Schaltjahr -> 52
 *   2026  1. Januar Donnerstag             -> 53
 *
 * Diese vier sind die Testvektoren, die auch die SQL-Seite verwenden wird.
 *
 * ## Zustand dieser Datei
 *
 * Geschrieben VOR der Implementierung. Die mit `ROT VOR DER UMSETZUNG`
 * markierten Faelle muessen jetzt fehlschlagen; taeten sie es nicht, waere der
 * Befund keiner und die Aufgabe erledigt.
 */
import { describe, expect, it } from "vitest";

/** Jahre mit 53 ISO-Wochen. Dieselben Vektoren gelten spaeter fuer SQL. */
const JAHRE_MIT_53 = [2020, 2026] as const;
/** Jahre mit 52 ISO-Wochen — hier ist `W53` ungueltig. */
const JAHRE_MIT_52 = [2021, 2025] as const;

function nimmtAn(weekKey: string): boolean {
  return PlanningWindowQuerySchema.safeParse({ weekKey }).success;
}

describe("Wochenschluessel: was heute schon stimmt", () => {
  it("lehnt W00, W54 und W99 ab", () => {
    for (const schluessel of ["2026-W00", "2026-W54", "2026-W99"]) {
      expect(nimmtAn(schluessel), `${schluessel} wurde angenommen`).toBe(false);
    }
  });

  it("nimmt regulaere Wochen an", () => {
    for (const schluessel of ["2026-W01", "2026-W32", "2026-W52", "2021-W52"]) {
      expect(nimmtAn(schluessel), `${schluessel} wurde abgelehnt`).toBe(true);
    }
  });

  it("lehnt formfremde Werte ab", () => {
    for (const schluessel of ["2026W32", "26-W32", "2026-32", "2026-w32", "", "2026-W3"]) {
      expect(nimmtAn(schluessel), `${schluessel} wurde angenommen`).toBe(false);
    }
  });
});

describe("Wochenschluessel: jahresabhaengige 53. Woche", () => {
  it("nimmt W53 in Jahren mit 53 ISO-Wochen an", () => {
    for (const jahr of JAHRE_MIT_53) {
      expect(nimmtAn(`${jahr}-W53`), `${jahr}-W53 wurde abgelehnt`).toBe(true);
    }
  });

  it("ROT VOR DER UMSETZUNG: lehnt W53 in Jahren mit nur 52 ISO-Wochen ab", () => {
    // Der Kern von EYT-88. Heute nimmt das Muster jede 53 an, weil es keine
    // Kalenderrechnung kennt — der Test muss deshalb jetzt fehlschlagen.
    for (const jahr of JAHRE_MIT_52) {
      expect(nimmtAn(`${jahr}-W53`), `${jahr}-W53 wurde angenommen, hat aber nur 52 Wochen`).toBe(
        false,
      );
    }
  });
});

/**
 * Alle oeffentlichen weekKey-Stellen tragen DIESELBE Regel (EYT-88).
 *
 * Zuvor stand an fuenf Stellen ein eigener regulaerer Ausdruck, und nur einer
 * davon kannte die Kalenderregel. `2025-W53` waere ueber die Leseabfrage
 * abgelehnt und ueber das Publish-Kommando angenommen worden — dieselbe Woche,
 * zwei Urteile.
 *
 * Tabellengetrieben, damit eine weitere Stelle nicht durchrutscht: wer ein
 * Schema hinzufuegt und hier nicht eintraegt, hat keine Abdeckung — und wer es
 * eintraegt, aber `IsoWeekKeySchema` nicht verwendet, wird rot.
 *
 * ## Warum die Vollstaendigkeit GEZAEHLT und nicht behauptet wird
 *
 * Hier stand eine feste Zahl. Eine feste Zahl kann genau den einen Fall nicht
 * erkennen, fuer den sie da ist: eine FEHLENDE Zeile. Sie schlaegt an, wenn
 * jemand eine Zeile hinzufuegt, nie wenn jemand eine vergisst — und so trug die
 * Tabelle laenger die Aufschrift "vollstaendig", waehrend
 * `CreateAssignmentCommandSchema` nie geprueft wurde. Die Zahl kommt deshalb
 * jetzt aus dem Quelltext (siehe unten), nicht aus dem Gedaechtnis.
 *
 * Die Stellen aus dem Kostenbereich kamen mit EYT-109 dazu. Sie stehen hier und
 * nicht nur in `costs-snapshot-schemas.test.ts`, weil die dortige Zusicherung
 * nur `2026-W54` prueft — das faengt schon das Muster. Erst `2025-W53` aus
 * VEKTOREN unten trennt die Kalenderregel vom blossen Bereich.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

import { CostSnapshotSchema, SelectablePlanVersionSchema } from "../src/costs/schemas.js";

const VERSION_ID = "00000000-0000-4000-8000-0000006010a1";
const INSTANT = "2026-08-03T06:00:00.000Z";
const INSTANT_SPAETER = "2026-08-03T14:00:00.000Z";
const EMPLOYEE_ID = "00000000-0000-4000-8000-0000004010a1";
const WORKSITE_ID = "00000000-0000-4000-8000-0000005010a1";
const SNAPSHOT_ID = "00000000-0000-4000-8000-0000007010a1";
const USER_ID = "00000000-0000-4000-8000-0000008010a1";
const WORKSITE_DAY_ID = "00000000-0000-4000-8000-0000009010a1";

/** Je Schema ein minimal gueltiger Rumpf, in den der Wochenschluessel eingesetzt wird. */
const STELLEN: ReadonlyArray<{
  readonly name: string;
  readonly baue: (weekKey: string) => unknown;
  readonly schema: { safeParse: (wert: unknown) => { success: boolean } };
}> = [
  {
    name: "PlanningWindowQuerySchema",
    schema: PlanningWindowQuerySchema,
    baue: (weekKey) => ({ weekKey }),
  },
  {
    name: "PlanningWindowSchema",
    schema: PlanningWindowSchema,
    baue: (weekKey) => ({
      weekKey,
      timeZone: "Europe/Berlin",
      assignments: [],
      sourceVersion: null,
      publishedVersionId: null,
      resources: { employees: [], worksites: [] },
    }),
  },
  {
    name: "ValidatePlanCommandSchema",
    schema: ValidatePlanCommandSchema,
    baue: (weekKey) => ({
      weekKey,
      draft: {
        employeeId: EMPLOYEE_ID,
        worksiteId: WORKSITE_ID,
        interval: { startUtc: INSTANT, endUtc: INSTANT_SPAETER },
      },
    }),
  },
  {
    name: "PublishPlanCommandSchema",
    schema: PublishPlanCommandSchema,
    baue: (weekKey) => ({ weekKey, expectedVersionId: null }),
  },
  {
    name: "PublishedPlanVersionSchema",
    schema: PublishedPlanVersionSchema,
    baue: (weekKey) => ({
      versionId: VERSION_ID,
      weekKey,
      publishedAtUtc: INSTANT,
      assignmentIds: [],
    }),
  },
  {
    name: "CreateAssignmentCommandSchema",
    schema: CreateAssignmentCommandSchema,
    baue: (weekKey) => ({
      weekKey,
      employeeId: EMPLOYEE_ID,
      worksiteId: WORKSITE_ID,
      interval: { startUtc: INSTANT, endUtc: INSTANT_SPAETER },
    }),
  },
  {
    name: "CostSnapshotSchema",
    schema: CostSnapshotSchema,
    baue: (weekKey) => ({
      id: SNAPSHOT_ID,
      planVersionId: VERSION_ID,
      worksiteId: null,
      weekKey,
      timeZone: "Europe/Berlin",
      currency: "EUR",
      ruleVersion: "personnel-plan-cost-v1",
      createdAt: INSTANT,
      createdBy: USER_ID,
      correlationId: "eyt-109",
      totalMinorUnits: "0",
      days: [],
      positions: [],
    }),
  },
  {
    name: "SelectablePlanVersionSchema",
    schema: SelectablePlanVersionSchema,
    baue: (weekKey) => ({ id: VERSION_ID, weekKey, publishedAt: INSTANT }),
  },
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
];

/**
 * Zaehlt `weekKey: IsoWeekKeySchema,` im Quelltext — die Gegenprobe zur Handliste.
 *
 * Dieselbe Bauart wie `redact.test.ts`, das `SECRET_CONFIG_KEYS` an
 * `ENV_VAR_META` koppelt: nicht die Liste gegen sich selbst pruefen, sondern
 * gegen die Wirklichkeit, die sie beschreibt. Der Quelltextscan ist hier
 * erlaubt, weil das Paket `types: ["node"]` fuehrt und `openapi-drift.test.ts`
 * ohnehin schon aus `node:fs` liest.
 */
function weekKeyStellenImQuelltext(): readonly string[] {
  const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const gefunden: string[] = [];
  const laufe = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const pfad = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        laufe(pfad);
        continue;
      }
      if (!eintrag.name.endsWith(".ts")) continue;
      for (const zeile of readFileSync(pfad, "utf8").split("\n")) {
        if (/^\s*weekKey:\s*IsoWeekKeySchema,/.test(zeile)) gefunden.push(pfad);
      }
    }
  };
  laufe(wurzel);
  return gefunden;
}

const VEKTOREN = [
  { key: "2026-W53", gueltig: true, warum: "2026 hat 53 ISO-Wochen" },
  { key: "2025-W53", gueltig: false, warum: "2025 hat nur 52" },
  { key: "2026-W00", gueltig: false, warum: "Woche 0 gibt es nicht" },
  { key: "2026-W54", gueltig: false, warum: "Woche 54 gibt es nicht" },
  { key: "2026-W32", gueltig: true, warum: "regulaere Woche" },
] as const;

describe("alle oeffentlichen weekKey-Stellen tragen dieselbe Regel", () => {
  it("kennt jede weekKey-Stelle im Quelltext — sonst misst diese Tabelle zu wenig", () => {
    const gefunden = weekKeyStellenImQuelltext();
    // Erst die Gegenprobe: findet der Scan ueberhaupt etwas? Sonst waere die
    // Gleichheit unten auch bei einem kaputten Muster erfuellbar (0 === 0).
    expect(gefunden.length).toBeGreaterThan(5);
    expect(
      STELLEN.length,
      `Der Quelltext bindet IsoWeekKeySchema an ${gefunden.length} Stellen, STELLEN fuehrt ${STELLEN.length}. ` +
        `Gefunden in:\n${[...new Set(gefunden)].join("\n")}`,
    ).toBe(gefunden.length);
  });

  for (const stelle of STELLEN) {
    for (const vektor of VEKTOREN) {
      it(`${stelle.name}: ${vektor.key} ist ${vektor.gueltig ? "gueltig" : "ungueltig"} (${vektor.warum})`, () => {
        const ergebnis = stelle.schema.safeParse(stelle.baue(vektor.key));
        expect(ergebnis.success).toBe(vektor.gueltig);
      });
    }
  }
});
