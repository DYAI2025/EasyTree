/**
 * Die reine Naht zwischen Tagesallokation, Satzauswahl und Geldregel (EYT-109).
 *
 * Keine Datenbank, kein NestJS, keine Uhr — was hier rot wird, ist eine
 * Fachregel und kein Verdrahtungsfehler.
 */
import { describe, expect, it } from "vitest";
import { unsafeIdentifier } from "@easytree/domain";
import type { AssignmentId, EmployeeId, PlanVersionId, WorksiteId } from "@easytree/domain";
// Ausschliesslich ueber die oeffentliche Modul-API, wie die Nachbartests:
// ein tiefer Pfad nach `costs/domain/` faellt am Waechter
// `costs-cross-module-public-api-only`. An der Modulgrenze heisst der
// Domaenensatz `RateVersion` — `RateVersionRecord` ist dort der Name desselben
// Typs aus dem Repository-Port; `rate-succession.test.ts` nutzt `RateVersion`.
import { assembleCostSnapshotPositions } from "../../src/modules/costs";
import type {
  PlannedWorkFact,
  PublishedPlanFacts,
  RateVersion,
  SnapshotAssemblyInput,
} from "../../src/modules/costs";

// 08:00–16:00 Berlin am 2026-06-15 = 06:00–14:00 UTC. Acht Stunden.
//
// Die Bezeichner werden hier GEBRANDET und nicht als nackte Zeichenketten
// gefuehrt: `PlannedWorkFact` verlangt die Marken aus `@easytree/domain`, und
// ein `as PublishedPlanFacts` auf dem ganzen Objekt haette die Marke nur
// behauptet — jede spaetere Ueberschreibung von `work` waere dann ein
// Typfehler gewesen, den erst `pnpm typecheck` gemeldet haette.
const EINSATZ: PlannedWorkFact = {
  assignmentId: unsafeIdentifier<AssignmentId>("11111111-1111-4111-8111-111111111111"),
  employeeId: unsafeIdentifier<EmployeeId>("22222222-2222-4222-8222-222222222222"),
  worksiteId: unsafeIdentifier<WorksiteId>("33333333-3333-4333-8333-333333333333"),
  startsAtUtc: new Date("2026-06-15T06:00:00.000Z"),
  endsAtUtc: new Date("2026-06-15T14:00:00.000Z"),
};

function fakten(ueberschreibung: Partial<PublishedPlanFacts> = {}): PublishedPlanFacts {
  return {
    planVersionId: unsafeIdentifier<PlanVersionId>("44444444-4444-4444-8444-444444444444"),
    weekKey: "2026-W25",
    timeZone: "Europe/Berlin",
    // EYT-109 Task 8: `PublishedPlanFacts` traegt seither auch den
    // Veroeffentlichungszeitpunkt und die Bezeichnungen. Die Montage liest
    // beides NICHT — sie bekommt die Labels weiterhin als eigene Eingabe
    // (`SnapshotAssemblyInput.employeeLabels`). Diese Werte stehen hier
    // deshalb nur, damit der Typ vollstaendig ist, und sind absichtlich
    // ANDERE als die der Eingabe: laese die Montage sie doch aus den Fakten,
    // faende dieser Test es.
    publishedAt: new Date("2026-06-10T09:15:00.000Z"),
    employeeLabels: new Map<string, string>([[EINSATZ.employeeId, "NICHT AUS DEN FAKTEN"]]),
    worksiteLabels: new Map<string, string>([[EINSATZ.worksiteId, "NICHT AUS DEN FAKTEN"]]),
    work: [EINSATZ],
    ...ueberschreibung,
  };
}

function satz(ueberschreibung: Partial<RateVersion> = {}): RateVersion {
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
    employeeLabels: new Map<string, string>([[EINSATZ.employeeId, "Anna Bauer"]]),
    worksiteLabels: new Map<string, string>([[EINSATZ.worksiteId, "Baustelle Nord"]]),
    ratesByEmployee: new Map<string, readonly RateVersion[]>([[EINSATZ.employeeId, [satz()]]]),
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
      eingabe({
        ratesByEmployee: new Map<string, readonly RateVersion[]>([[EINSATZ.employeeId, []]]),
      }),
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
        ratesByEmployee: new Map<string, readonly RateVersion[]>([
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
        ratesByEmployee: new Map<string, readonly RateVersion[]>([[EINSATZ.employeeId, [a, b]]]),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions[0]?.rateVersionId).toBe(b.id);
    expect(ergebnis.positions[0]?.amountMinorUnits).toBe(24000n); // 8 h * 30,00
  });

  /**
   * Der Gegenpol zum Nahtstellentag: hier ist der wirksame Satz der AELTERE.
   *
   * Gemessen (GM4, 09.08.2026): ohne diesen Fall faellt bei der Fehlregel „nimm
   * die Version mit dem groessten `validFrom`" ausschliesslich die
   * Mehrdeutigkeitsprobe — also die BLOCKADE. Die Auswahl selbst blieb
   * ununterscheidbar, weil im Nahtstellenfall der wirksame Satz zufaellig auch
   * der neueste ist. Erst dieser Fall trennt die beiden Regeln.
   */
  it("waehlt vor der Nahtstelle den Vorgaenger, nicht den neuesten Satz", () => {
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
    // Der Einsatz liegt am 2026-06-15, also VOR dem Wechsel.
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        ratesByEmployee: new Map<string, readonly RateVersion[]>([[EINSATZ.employeeId, [a, b]]]),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions[0]?.rateVersionId).toBe(a.id);
    expect(ergebnis.positions[0]?.amountMinorUnits).toBe(20000n); // 8 h * 25,00
  });

  it("liefert kein Teilergebnis, wenn ein einziger Einsatz blockiert", () => {
    const heil: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("88888888-8888-4888-8888-888888888888"),
    };
    const kaputt: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("99999999-9999-4999-8999-999999999999"),
      employeeId: unsafeIdentifier<EmployeeId>("aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"),
    };
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({ work: [heil, kaputt] }),
        employeeLabels: new Map<string, string>([
          [EINSATZ.employeeId, "Anna Bauer"],
          [kaputt.employeeId, "Bea Cordes"],
        ]),
        // Fuer `kaputt` liegt kein Satz vor.
        ratesByEmployee: new Map<string, readonly RateVersion[]>([[EINSATZ.employeeId, [satz()]]]),
      }),
    );
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    // Der Verursacher wird benannt — nicht "irgendwas ging schief".
    expect(ergebnis.assignmentId).toBe(kaputt.assignmentId);
  });

  /**
   * Die Geldregel bleibt oberhalb von 2^53 exakt (GM7).
   *
   * `2^53 + 1` Minor Units je Stunde ist als `number` nicht mehr darstellbar —
   * `Number("9007199254740993")` ergibt `9007199254740992`. Genau deshalb
   * reist `amountMinorUnits` als Zeichenkette und wird als `bigint` gerechnet
   * (`rate-version.ts`). Ueber acht Stunden trennt das die beiden Verfahren um
   * 8 Minor Units: exakt `72057594037927944`, ueber `Number`/`Math.round`
   * `72057594037927936`.
   *
   * Gemessen am 09.08.2026, und damit eine Korrektur am Plan: bei
   * NICHTNEGATIVEN Halbwerten gehen `HALF_UP_NON_NEGATIVE` und `Math.round`
   * NICHT auseinander (`333` Minor Units ueber 30 min ergibt beidseitig `167`).
   * Der Halbwert taugt hier also nicht als Nachweis — die Gleitkommadrift schon.
   */
  it("rechnet oberhalb von 2^53 exakt, statt ueber Gleitkomma zu driften", () => {
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        ratesByEmployee: new Map<string, readonly RateVersion[]>([
          [EINSATZ.employeeId, [satz({ amountMinorUnits: "9007199254740993" })]],
        ]),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions[0]?.amountMinorUnits).toBe(72057594037927944n);
  });

  it("blockiert bei fehlendem Label, statt einen Platzhalter zu erfinden", () => {
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({ worksiteLabels: new Map<string, string>() }),
    );
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("LABEL_MISSING");
  });

  it("ordnet deterministisch nach (localDate, worksiteId, employeeLabel, assignmentId)", () => {
    // Zwei Einsaetze am selben Tag, absichtlich in falscher Reihenfolge geliefert.
    const spaet: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("ffffffff-ffff-4fff-8fff-ffffffffffff"),
    };
    const frueh: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("00000000-0000-4000-8000-000000000000"),
    };
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

  /**
   * Der zweite Ordnungsschluessel. Gemessen: ohne diesen Fall bleibt die Suite
   * gruen, wenn man `worksiteId` aus dem Vergleich streicht — der Schluessel
   * waere dann unbelegt.
   */
  it("ordnet bei gleichem Tag nach worksiteId", () => {
    const b: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("00000000-0000-4000-8000-00000000000b"),
      worksiteId: unsafeIdentifier<WorksiteId>("bbbbbbbb-3333-4333-8333-333333333333"),
    };
    const a: PlannedWorkFact = {
      ...EINSATZ,
      // Groessere assignmentId, kleinere worksiteId: nur wenn `worksiteId`
      // VOR `assignmentId` verglichen wird, kommt dieser Einsatz zuerst.
      assignmentId: unsafeIdentifier<AssignmentId>("ffffffff-ffff-4fff-8fff-fffffffffffa"),
      worksiteId: unsafeIdentifier<WorksiteId>("aaaaaaaa-3333-4333-8333-333333333333"),
    };
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({ work: [b, a] }),
        worksiteLabels: new Map<string, string>([
          [a.worksiteId, "Baustelle A"],
          [b.worksiteId, "Baustelle B"],
        ]),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions.map((p) => p.worksiteId)).toEqual([a.worksiteId, b.worksiteId]);
  });

  /**
   * Der dritte Ordnungsschluessel — und zugleich der Fall, der den Vergleicher
   * auf Codepoint-Ordnung festnagelt.
   *
   * Die Namen sind mit Absicht kollationsunterscheidend gewaehlt:
   * `Z` ist U+005A, `Ä` ist U+00C4, also steht `Zimmermann` in
   * Codepoint-Ordnung VOR `Ärgel`. Deutsche Kollation dreht das um
   * (`localeCompare` liest `Ä` als `A`), schwedische und daenische ebenfalls,
   * jeweils andersherum. Dieser Test ist deshalb der Waechter ueber
   * `vergleiche()`: wer dort auf `localeCompare` zurueckgeht, faellt hier —
   * gemessen am 09.08.2026 (`de` = +1, `sv` = -1, Codepoint = -1).
   */
  it("ordnet bei gleicher Baustelle nach employeeLabel in Codepoint-Ordnung", () => {
    // Die `assignmentId`s stehen mit Absicht GEGEN die erwartete Reihenfolge:
    // Zimmermann traegt die groessere. Nur so unterscheidet der Fall den
    // `employeeLabel`-Schluessel vom nachgelagerten `assignmentId`-Schluessel —
    // gemessen: mit gleichlaufenden Ids blieb die Suite gruen, als der
    // `employeeLabel`-Vergleich entfernt wurde, und der Test mass nichts.
    const zimmermann: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("00000000-0000-4000-8000-000000000002"),
      employeeId: unsafeIdentifier<EmployeeId>("11111111-2222-4222-8222-222222222222"),
    };
    const aergel: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("00000000-0000-4000-8000-000000000001"),
      employeeId: unsafeIdentifier<EmployeeId>("22222222-2222-4222-8222-222222222222"),
    };
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({ work: [aergel, zimmermann] }),
        employeeLabels: new Map<string, string>([
          [zimmermann.employeeId, "Zimmermann"],
          [aergel.employeeId, "Ärgel"],
        ]),
        ratesByEmployee: new Map<string, readonly RateVersion[]>([
          [zimmermann.employeeId, [satz({ employeeId: zimmermann.employeeId })]],
          [aergel.employeeId, [satz({ employeeId: aergel.employeeId })]],
        ]),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    // Codepoint: "Zimmermann" (0x5A) vor "Ärgel" (0xC4). Unter `localeCompare`
    // in de-DE waere die Reihenfolge genau umgekehrt.
    expect(ergebnis.positions.map((p) => p.employeeLabel)).toEqual(["Zimmermann", "Ärgel"]);
  });

  /**
   * Die Naht, fuer die diese Datei existiert: der Satz wird PRO ORTSTAG
   * gewaehlt, nicht einmal je Einsatz.
   *
   * Ein Einsatz ueber Mitternacht, der zugleich einen Satzwechsel kreuzt. Eine
   * Umsetzung, die den Satz einmal am Startdatum nachschlaegt und fuer alle
   * Anteile wiederverwendet, kaeme hier auf zweimal 25,00 und faellt.
   */
  it("waehlt den Satz je Ortstag, nicht einmal je Einsatz", () => {
    const a = satz({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      validFrom: "2026-06-01",
      validTo: "2026-06-16",
    });
    const b = satz({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      validFrom: "2026-06-16",
      validTo: null,
      amountMinorUnits: "3000",
    });
    // 22:00–02:00 Berlin, 15.06. -> 16.06. Je zwei Stunden pro Ortstag.
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
        ratesByEmployee: new Map<string, readonly RateVersion[]>([[EINSATZ.employeeId, [a, b]]]),
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions.map((p) => p.localDate)).toEqual(["2026-06-15", "2026-06-16"]);
    expect(ergebnis.positions.map((p) => p.rateVersionId)).toEqual([a.id, b.id]);
    // 2 h * 25,00 am 15.06., 2 h * 30,00 am 16.06.
    expect(ergebnis.positions.map((p) => p.amountMinorUnits)).toEqual([5000n, 6000n]);
  });

  it("blockiert bei unbekannter Zeitzone, bevor irgendein Tag entsteht", () => {
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({ facts: fakten({ timeZone: "Europa/Buxtehude" }) }),
    );
    expect(ergebnis).toEqual({
      ok: false,
      problem: "TIME_ZONE_UNKNOWN",
      assignmentId: null,
      employeeId: null,
      localDate: null,
    });
  });

  /**
   * Die kaputte Mitternacht — beide Richtungen, an echten Zonen gemessen.
   *
   * Gemessen am 09.08.2026 gegen die tz-Datenbank dieser Node-Version:
   * in `America/Santiago` existiert die lokale Mitternacht des 2026-09-06
   * nicht (Sprung 00:00 -> 01:00), in `America/Havana` existiert die des
   * 2026-11-01 zweimal. Gegenprobe: derselbe Santiago-Kalender an einem
   * gewoehnlichen Tag liefert klaglos zwei Anteile — die Zone allein ist also
   * nicht der Grund.
   *
   * Fuer den Pilotbetrieb (`Europe/Berlin`, Umstellung 02:00) unerreichbar;
   * der Zweig steht trotzdem unter Test, weil die Totalblockade sonst nur fuer
   * Satz und Label belegt waere.
   */
  it.each([
    [
      "America/Santiago",
      "2026-09-06T02:00:00.000Z",
      "2026-09-06T08:00:00.000Z",
      "DAY_BOUNDARY_NONEXISTENT",
    ],
    [
      "America/Havana",
      "2026-11-01T02:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
      "DAY_BOUNDARY_AMBIGUOUS",
    ],
  ])("blockiert total an der kaputten Mitternacht (%s -> %s)", (zone, start, ende, erwartet) => {
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({
          timeZone: zone,
          work: [{ ...EINSATZ, startsAtUtc: new Date(start), endsAtUtc: new Date(ende) }],
        }),
      }),
    );
    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe(erwartet);
    // Der Verursacher wird benannt, und es ueberlebt keine Teilposition.
    expect(ergebnis.assignmentId).toBe(EINSATZ.assignmentId);
  });

  it("nimmt nur die Baustelle des Filters auf", () => {
    const fremd: PlannedWorkFact = {
      ...EINSATZ,
      assignmentId: unsafeIdentifier<AssignmentId>("00000000-0000-4000-8000-0000000000ff"),
      worksiteId: unsafeIdentifier<WorksiteId>("77777777-3333-4333-8333-333333333333"),
    };
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({
        facts: fakten({ work: [EINSATZ, fremd] }),
        worksiteFilter: EINSATZ.worksiteId,
        // Fuer `fremd` gibt es bewusst KEIN Label: wuerde der Filter ihn nicht
        // aussortieren, faellt der Lauf mit LABEL_MISSING statt still zu passen.
      }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions).toHaveLength(1);
    expect(ergebnis.positions[0]?.worksiteId).toBe(EINSATZ.worksiteId);
  });

  /**
   * Ein Filter, der nichts trifft, ergibt einen LEEREN Snapshot — kein Fehler.
   *
   * Dass die Baustelle ueberhaupt zur Organisation gehoert, prueft diese
   * Funktion NICHT; das ist Aufgabe des Use-Case (Task 10,
   * `WORKSITE_NOT_IN_ORG`), der die Baustelle gegen den Mandanten aufloest.
   * Das leere Ergebnis ist hier also Zuschnitt und keine Luecke — wer es in
   * dieser Schicht "repariert", baut die Mandantenpruefung an der falschen
   * Stelle nach.
   */
  it("liefert einen leeren Snapshot, wenn der Baustellenfilter nichts trifft", () => {
    const ergebnis = assembleCostSnapshotPositions(
      eingabe({ worksiteFilter: "99999999-3333-4333-8333-333333333333" }),
    );
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.positions).toEqual([]);
  });
});
