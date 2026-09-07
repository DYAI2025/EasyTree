/**
 * Das Einsatz-Kommando (EYT-120 Inkrement 1) — Datumsvertrag, keine Uhrzeiten.
 *
 * Kanonisch ist Confluence 49119274 (`RECONCILED_2026_09_06_2344`) mit Jira EYT-120:
 * `ENGAGEMENT_START = REQUIRED_LOCAL_DATE`, `ENGAGEMENT_END = OPTIONAL_LOCAL_DATE`,
 * `ENGAGEMENT_CLOCK_TIMES = NOT_REQUIRED`, `DEFAULT_WORKDAYS = MONDAY_TO_FRIDAY_AUTO`,
 * `CALENDAR_OVERRIDE = OPTIONAL`, `PLANNED_DAY_TIMES = OPTIONAL`,
 * `OPEN_END = ALLOWED_WITH_PLANNING_HORIZON`.
 *
 * Alle Regeln unten sind BEZIEHUNGEN zwischen Feldern (Ende nicht vor Beginn, Horizont-XOR,
 * Overrides im Zeitraum, leere Tagesmenge) oder Striktheit — beides kann das erzeugte
 * OpenAPI-Dokument nicht ausdruecken, und der Drift-Test bleibt gruen, wenn eine davon
 * faellt. Diese Datei ist deshalb der einzige Detektor.
 *
 * Die reine Werktagsrechnung steht in `engagement-workdays.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  CreateEngagementCommandSchema,
  EngagementDtoSchema,
  ENGAGEMENT_PROBLEM_TYPE,
} from "../src/planning/schemas.js";

const WORKSITE = "00000000-0000-4000-8000-0000005010a1";
const ZWEITE_BAUSTELLE = "00000000-0000-4000-8000-0000005010b2";
const EMPLOYEE = "00000000-0000-4000-8000-0000004010a1";

/** Montag bis Freitag derselben Woche; 01-11 ist der Samstag danach. */
const basis = {
  worksiteId: WORKSITE,
  startDate: "2031-01-06",
  endDate: "2031-01-10",
  planningHorizonDate: null,
  defaults: {},
  team: [EMPLOYEE],
};

const gueltig = (kommando: unknown): boolean =>
  CreateEngagementCommandSchema.safeParse(kommando).success;

describe("CreateEngagementCommandSchema — Einsatzgrenzen sind Geschaeftsdaten (D-003)", () => {
  it("R1 verlangt startDate als lokales Datum JJJJ-MM-TT", () => {
    // Rest-Destrukturierung entfernt den Schluessel; das abgetrennte Feld wird
    // nicht gebraucht. `void` statt `_`-Praefix, weil die ESLint-Konfiguration
    // kein `varsIgnorePattern` kennt (Muster wie in planning-facts.adapter.test.ts).
    const { startDate, ...ohne } = basis;
    void startDate;
    expect(gueltig(ohne)).toBe(false);
    expect(gueltig({ ...basis, startDate: null })).toBe(false);
    expect(gueltig({ ...basis, startDate: "06.01.2031" })).toBe(false);
    // Ein Zeitpunkt ist kein Geschaeftsdatum — das ist genau die verworfene Fassung.
    expect(gueltig({ ...basis, startDate: "2031-01-06T07:00:00.000Z" })).toBe(false);
    expect(gueltig({ ...basis, startDate: { date: "2031-01-06", time: "07:00" } })).toBe(false);
    expect(gueltig(basis)).toBe(true);
  });

  it("R2 endDate ist ein lokales Datum ODER offen (null)", () => {
    expect(gueltig(basis)).toBe(true);
    expect(gueltig({ ...basis, endDate: null, planningHorizonDate: "2031-01-17" })).toBe(true);
    expect(gueltig({ ...basis, endDate: "2031-01-10T16:00:00.000Z" })).toBe(false);
    // Weglassen ist nicht dasselbe wie ausdruecklich offen: der Vertrag verlangt
    // die Entscheidung, statt sie aus einem fehlenden Feld zu raten.
    const { endDate, ...ohne } = basis;
    void endDate;
    expect(gueltig(ohne)).toBe(false);
  });

  it("R3 die verworfenen Uhrzeit-Grenzen startAt/endAt werden NICHT angenommen", () => {
    // Superseded 06.09.2026: EYT-120 kennt keine verpflichtenden Einsatz-Uhrzeiten.
    // `strictObject` laesst den alten Namen nicht als Zusatzfeld durchrutschen.
    expect(gueltig({ ...basis, startAt: { date: "2031-01-06", time: "07:00" } })).toBe(false);
    expect(gueltig({ ...basis, endAt: { date: "2031-01-10", time: "16:00" } })).toBe(false);
    expect(gueltig({ ...basis, startsAtUtc: "2031-01-06T06:00:00.000Z" })).toBe(false);
    expect(gueltig({ ...basis, endsAtUtc: "2031-01-10T15:00:00.000Z" })).toBe(false);
    // Und der alte Pflicht-Tagesliste-Schluessel ebenso wenig.
    expect(gueltig({ ...basis, days: [{ localDate: "2031-01-06" }] })).toBe(false);

    const felder = Object.keys(
      (CreateEngagementCommandSchema.safeParse(basis) as { data: Record<string, unknown> }).data,
    );
    expect(felder).toEqual(
      expect.arrayContaining([
        "worksiteId",
        "startDate",
        "endDate",
        "planningHorizonDate",
        "defaults",
        "team",
      ]),
    );
    for (const verboten of ["startAt", "endAt", "startsAtUtc", "endsAtUtc", "days"]) {
      expect(felder).not.toContain(verboten);
    }
  });

  it("R5 ein Ende VOR dem Beginn wird abgelehnt", () => {
    expect(gueltig({ ...basis, endDate: "2031-01-05" })).toBe(false);
  });

  it("R6 ein eintaegiger Einsatz hat startDate = endDate und ist gueltig (D-002)", () => {
    expect(gueltig({ ...basis, endDate: basis.startDate })).toBe(true);
  });
});

describe("CreateEngagementCommandSchema — offenes Ende und Planungshorizont (D-006)", () => {
  it("R7 offenes Ende ohne Planen-bis-Datum wird abgelehnt", () => {
    expect(gueltig({ ...basis, endDate: null, planningHorizonDate: null })).toBe(false);
  });

  it("R8 ein Horizont VOR dem Beginn wird abgelehnt", () => {
    expect(gueltig({ ...basis, endDate: null, planningHorizonDate: "2031-01-05" })).toBe(false);
    // Gleichheit ist erlaubt: ein Montag als Beginn und als Horizont ergibt einen Tag.
    expect(gueltig({ ...basis, endDate: null, planningHorizonDate: basis.startDate })).toBe(true);
  });

  it("R9 der Horizont bleibt vom fachlichen Ende getrennt — nie beides zugleich", () => {
    // Bei bekanntem Ende IST das Ende der Umfang. Ein zweiter Wert waere eine
    // zweite Wahrheit und wuerde spaeter als stilles `endDate` gelesen.
    expect(gueltig({ ...basis, planningHorizonDate: "2031-01-17" })).toBe(false);
    // Und umgekehrt: bei offenem Ende traegt AUSSCHLIESSLICH der Horizont den Umfang.
    const offen = CreateEngagementCommandSchema.safeParse({
      ...basis,
      endDate: null,
      planningHorizonDate: "2031-01-17",
    });
    expect(offen.success).toBe(true);
    if (!offen.success) return;
    expect(offen.data.endDate).toBeNull();
    expect(offen.data.planningHorizonDate).toBe("2031-01-17");
  });
});

describe("CreateEngagementCommandSchema — Kalender ist Override, kein Pflichtschritt (D-005)", () => {
  it("R14 ein Kommando ohne jedes Kalenderobjekt ist gueltig", () => {
    expect(gueltig(basis)).toBe(true);
    const { calendar, ...ohne } = { ...basis, calendar: { include: [], exclude: [] } };
    void calendar;
    expect(gueltig(ohne)).toBe(true);
    expect(gueltig({ ...basis, calendar: { include: [], exclude: [] } })).toBe(true);
  });

  it("R15 derselbe Tag zugleich auf- und abgewaehlt wird abgelehnt statt geraten", () => {
    expect(
      gueltig({
        ...basis,
        calendar: { include: ["2031-01-08"], exclude: ["2031-01-08"] },
      }),
    ).toBe(false);
  });

  it("R16 ein Override ausserhalb des aktuellen Planungsumfangs wird abgelehnt", () => {
    // Innerhalb des Zeitraums: der Samstag 2031-01-11 liegt in [06.01., 12.01.].
    const bisSonntag = { ...basis, endDate: "2031-01-12" };
    expect(gueltig({ ...bisSonntag, calendar: { include: ["2031-01-11"], exclude: [] } })).toBe(
      true,
    );
    // Ausserhalb: derselbe Samstag, aber der Zeitraum endet am Freitag davor.
    expect(gueltig({ ...basis, calendar: { include: ["2031-01-11"], exclude: [] } })).toBe(false);
    expect(gueltig({ ...basis, calendar: { include: [], exclude: ["2031-01-05"] } })).toBe(false);
    // Auch am offenen Ende zaehlt der Horizont als Obergrenze, nicht die Unendlichkeit.
    expect(
      gueltig({
        ...basis,
        endDate: null,
        planningHorizonDate: "2031-01-10",
        calendar: { include: ["2031-01-11"], exclude: [] },
      }),
    ).toBe(false);
  });

  it("R17 ein Kommando ohne einen einzigen effektiven Tag wird abgelehnt", () => {
    // Ein eintaegiger Einsatz an einem Samstag ohne Aufnahme — der Vertrag
    // erzeugt keinen leeren Einsatz (`EMPTY_ENGAGEMENT_NORMAL_FLOW = NOT_REQUIRED`).
    expect(gueltig({ ...basis, startDate: "2031-01-11", endDate: "2031-01-11" })).toBe(false);
    // Mit ausdruecklicher Aufnahme desselben Samstags entsteht ein Tag.
    expect(
      gueltig({
        ...basis,
        startDate: "2031-01-11",
        endDate: "2031-01-11",
        calendar: { include: ["2031-01-11"], exclude: [] },
      }),
    ).toBe(true);
    // Und ebenso, wenn alle Vorgabetage abgewaehlt werden.
    expect(
      gueltig({
        ...basis,
        calendar: {
          include: [],
          exclude: ["2031-01-06", "2031-01-07", "2031-01-08", "2031-01-09", "2031-01-10"],
        },
      }),
    ).toBe(false);
  });
});

describe("CreateEngagementCommandSchema — geplante Uhrzeiten sind optional (D-004)", () => {
  it("R18 ein Kommando OHNE jede geplante Uhrzeit ist gueltig", () => {
    expect(gueltig({ ...basis, defaults: {} })).toBe(true);
  });

  it("R19 eine mitgegebene gueltige Arbeitszeit bleibt gueltig", () => {
    expect(gueltig({ ...basis, defaults: { workingTime: { from: "08:00", to: "18:00" } } })).toBe(
      true,
    );
    // Und bleibt in sich geprueft: `to` muss nach `from` liegen. Das ist die
    // Tagesarbeitszeit, nicht die Einsatzgrenze — sie wird hier NICHT geschwaecht.
    expect(gueltig({ ...basis, defaults: { workingTime: { from: "18:00", to: "08:00" } } })).toBe(
      false,
    );
    expect(gueltig({ ...basis, defaults: { workingTime: { from: "8:00", to: "18:00" } } })).toBe(
      false,
    );
  });

  it("R20 die Arbeitszeit wird gegen KEINE Einsatz-Uhrzeitgrenze geprueft", () => {
    // Der Einsatz hat keine Uhrzeitgrenzen mehr, gegen die geprueft werden
    // koennte. Eine Arbeitszeit ueber den ganzen Tag ist deshalb genauso
    // gueltig wie eine kurze — an einem eintaegigen Einsatz wie an einem langen.
    for (const zeit of [
      { from: "00:00", to: "23:59" },
      { from: "05:00", to: "06:00" },
      { from: "22:00", to: "23:00" },
    ]) {
      expect(gueltig({ ...basis, defaults: { workingTime: zeit } })).toBe(true);
      expect(gueltig({ ...basis, endDate: basis.startDate, defaults: { workingTime: zeit } })).toBe(
        true,
      );
    }
    // Und es gibt keinen Problem-Type mehr, der so eine Ablehnung benennen wuerde.
    expect(Object.keys(ENGAGEMENT_PROBLEM_TYPE)).not.toContain("WORKING_TIME_OUTSIDE_ENGAGEMENT");
    expect(Object.keys(ENGAGEMENT_PROBLEM_TYPE)).not.toContain("ENGAGEMENT_START_IN_PAST");
  });
});

describe("CreateEngagementCommandSchema — Striktheit, Team und Parallelitaet", () => {
  it("lehnt unbekannte Schluessel ab und verlangt ein Team ohne Duplikate", () => {
    expect(gueltig({ ...basis, extra: 1 })).toBe(false);
    expect(gueltig({ ...basis, defaults: { workingTime: undefined, extra: 1 } })).toBe(false);
    expect(gueltig({ ...basis, calendar: { include: [], exclude: [], extra: 1 } })).toBe(false);
    expect(gueltig({ ...basis, team: [] })).toBe(false);
    expect(gueltig({ ...basis, team: [EMPLOYEE, EMPLOYEE] })).toBe(false);
  });

  it("R26 zwei Einsaetze an VERSCHIEDENEN Baustellen am selben Tag sind hier beide gueltig", () => {
    // `PARALLEL_ENGAGEMENTS_DIFFERENT_WORKSITES = ALLOWED`. Die Eindeutigkeit
    // gilt je Baustelle und lokalem Tag und wird in der Datenbank durchgesetzt —
    // diese reine Vertragsschicht darf sie nicht vorwegnehmen.
    expect(gueltig(basis)).toBe(true);
    expect(gueltig({ ...basis, worksiteId: ZWEITE_BAUSTELLE })).toBe(true);
  });

  it("lehnt das Jahr 0000 ab — die Domain und PostgreSQL kennen es nicht", () => {
    // `Date` nimmt `0000-01-01` an und gibt es unveraendert zurueck; der
    // Rueckweg-Test allein liesse den Wert durch.
    expect(gueltig({ ...basis, startDate: "0000-01-01", endDate: "0000-01-08" })).toBe(false);
    // Gegenprobe: das Jahr 1 ist die Untergrenze und bleibt gueltig.
    expect(gueltig({ ...basis, startDate: "0001-01-01", endDate: "0001-01-08" })).toBe(true);
  });
});

describe("EngagementDtoSchema — die Antwort traegt Datumsgrenzen, keine Zeitpunkte", () => {
  const tag = {
    worksiteDayId: "00000000-0000-4000-8000-0000006010a1",
    configurationId: "00000000-0000-4000-8000-0000006010a2",
    worksiteId: WORKSITE,
    localDate: "2031-01-06",
    lockVersion: 0,
    team: [
      {
        assignmentId: "00000000-0000-4000-8000-0000006010a3",
        employeeId: EMPLOYEE,
        interval: { startUtc: "2031-01-06T07:00:00.000Z", endUtc: "2031-01-06T17:00:00.000Z" },
      },
    ],
    weekKey: "2031-W02",
  };
  const dto = {
    engagementId: "00000000-0000-4000-8000-0000007010a1",
    worksiteId: WORKSITE,
    startDate: "2031-01-06",
    endDate: "2031-01-10",
    planningHorizonDate: null,
    days: [tag],
  };

  it("R4 nimmt startDate/endDate an und weist startsAtUtc/endsAtUtc als Grenzen zurueck", () => {
    expect(EngagementDtoSchema.safeParse(dto).success).toBe(true);
    expect(
      EngagementDtoSchema.safeParse({ ...dto, startsAtUtc: "2031-01-06T06:00:00.000Z" }).success,
    ).toBe(false);
    expect(
      EngagementDtoSchema.safeParse({ ...dto, endsAtUtc: "2031-01-10T15:00:00.000Z" }).success,
    ).toBe(false);
    const { startDate, ...ohneStart } = dto;
    void startDate;
    expect(EngagementDtoSchema.safeParse(ohneStart).success).toBe(false);
    expect(
      EngagementDtoSchema.safeParse({ ...dto, startDate: "2031-01-06T06:00:00.000Z" }).success,
    ).toBe(false);
  });

  it("R9 zeigt am offenen Ende den Horizont, ohne endDate zu setzen", () => {
    const offen = EngagementDtoSchema.safeParse({
      ...dto,
      endDate: null,
      planningHorizonDate: "2031-01-17",
    });
    expect(offen.success).toBe(true);
    if (!offen.success) return;
    expect(offen.data.endDate).toBeNull();
    expect(offen.data.planningHorizonDate).toBe("2031-01-17");
  });

  it("ein Einsatz ohne Tage ist im Vertrag kein Einsatz", () => {
    expect(EngagementDtoSchema.safeParse({ ...dto, days: [] }).success).toBe(false);
  });
});
