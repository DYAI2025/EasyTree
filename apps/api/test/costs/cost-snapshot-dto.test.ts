/**
 * Die HTTP-Naht des Snapshots (EYT-139).
 *
 * ## Was hier gemessen wird
 *
 * Vier Aussagen, die kein anderer Test trifft:
 *
 * 1. Die Antwort entsteht AUS DEM GESPEICHERTEN STAND. Jedes Feld stammt aus
 *    `StoredCostSnapshot`; nichts wird aus einer Anfrage rekonstruiert.
 * 2. `days` ist eine ABLEITUNG aus den gespeicherten Positionen, keine zweite
 *    Datenquelle — und sie ist deterministisch sortiert.
 * 3. Kein Betrag und keine Dauer laeuft durch `number`. Der Nachweis ist ein
 *    Wert oberhalb von 2^53, den eine `Number()`-Umleitung still verfaelschte.
 * 4. Jedes Positionsfeld stammt aus SEINER Quelle. Das ist eine eigene Aussage,
 *    weil der Vertrag sie nicht treffen kann: `strictObject` prueft Anwesenheit
 *    und Typ, nicht Herkunft. Der Kopfkommentar von `PublishedPlanFacts`
 *    beschreibt genau diesen Fehler — „ein vertauschtes Paar faende niemand —
 *    der Bericht saehe vollstaendig aus und naennte die falsche Person."
 *
 * ## Gegenmutationen, die diese Datei rot machen — alle eingespielt und gemessen
 *
 * - `amountMinorUnits: String(Number(position.amountMinorUnits))` (Praezision).
 * - `days` aus der Reihenfolge der Positionen statt sortiert (Determinismus).
 * - `totalMinorUnits` aus der Summe der Positionen statt aus dem Kopf
 *   (Serverwahrheit).
 * - `employeeId: position.assignmentId` samt
 *   `employeeLabel: position.worksiteLabel` — zwei gleichtypige Felder
 *   vertauscht (Herkunft).
 * - `employeeLabel: "Person 1"` — Quelle durch eine Konstante ersetzt
 *   (Herkunft, und nur ueber Position 2 beobachtbar).
 */
import { describe, expect, it } from "vitest";

import { CostSnapshotSchema } from "@easytree/contracts";

// Ueber die oeffentliche Modul-API, wie die Nachbartests. Ein tiefer Pfad nach
// `costs/interface/http/cost-snapshot.dto` faellt am Waechter
// `costs-cross-module-public-api-only` — gemessen, nicht vermutet: mit ihm
// meldete `costs-module-boundaries.test.ts` genau eine Verletzung.
import { toCostSnapshotDto } from "../../src/modules/costs";
import type { StoredCostSnapshot } from "../../src/modules/costs";

const SNAPSHOT = "00000000-0000-4000-8000-00000000d001";
const ORG = "00000000-0000-4000-8000-00000000a001";
const PLAN = "00000000-0000-4000-8000-00000000b001";
const WORKSITE = "00000000-0000-4000-8000-0000005010a1";
const EMPLOYEE_1 = "00000000-0000-4000-8000-0000004010a1";
const EMPLOYEE_2 = "00000000-0000-4000-8000-0000004010a2";
const SATZ = "00000000-0000-4000-8000-0000006c5001";
const POS_1 = "00000000-0000-4000-8000-00000000e001";
const POS_2 = "00000000-0000-4000-8000-00000000e002";
const POS_3 = "00000000-0000-4000-8000-00000000e003";
// Benannt statt inline, damit der feldweise Vergleich weiter unten lesbar ist —
// und damit sichtbar bleibt, dass KEINE zwei Id-Felder derselben Position
// denselben Wert tragen. Genau diese Verschiedenheit ist die Voraussetzung
// dafuer, dass ein vertauschtes Paar auffaellt.
const ASSIGNMENT_1 = "00000000-0000-4000-8000-00000000c001";
const ASSIGNMENT_2 = "00000000-0000-4000-8000-00000000c002";
const ASSIGNMENT_3 = "00000000-0000-4000-8000-00000000c003";

/**
 * Die gespeicherte Reihenfolge WIDERSPRICHT der Datumsreihenfolge — Absicht.
 *
 * Stimmten beide ueberein, waere die Sortierung von `days` durch die
 * Einfuegereihenfolge maskiert: der Test bliebe gruen, auch wenn niemand
 * sortierte. Position 1 traegt den SPAETEREN Tag.
 */
const GESPEICHERT: StoredCostSnapshot = {
  id: SNAPSHOT,
  organisationId: ORG,
  planVersionId: PLAN,
  worksiteId: null,
  weekKey: "2026-W33",
  timeZone: "Europe/Berlin",
  currency: "EUR",
  ruleVersion: "personnel-plan-cost-v1",
  // Bewusst NICHT die Summe der Positionen (7500 + 2500 + 1000 = 11000).
  // Der Kopf ist die Serverwahrheit; eine heimlich nachsummierende Naht faellt
  // an dieser Zahl auf.
  totalMinorUnits: 9007199254740993n,
  createdAt: new Date("2026-08-12T09:15:00.000Z"),
  createdBy: "00000000-0000-4000-8000-00000000aaa1",
  correlationId: "korrelation-1",
  positions: [
    {
      id: POS_1,
      assignmentId: ASSIGNMENT_1,
      worksiteId: WORKSITE,
      worksiteLabel: "Baustelle A",
      employeeId: EMPLOYEE_1,
      employeeLabel: "Person 1",
      localDate: "2026-08-12",
      durationMilliseconds: 28800000n,
      rateVersionId: SATZ,
      amountMinorUnits: 7500n,
    },
    {
      id: POS_2,
      assignmentId: ASSIGNMENT_2,
      worksiteId: WORKSITE,
      worksiteLabel: "Baustelle A",
      employeeId: EMPLOYEE_2,
      employeeLabel: "Person 2",
      localDate: "2026-08-11",
      durationMilliseconds: 14400000n,
      rateVersionId: SATZ,
      amountMinorUnits: 2500n,
    },
    {
      id: POS_3,
      assignmentId: ASSIGNMENT_3,
      worksiteId: WORKSITE,
      worksiteLabel: "Baustelle A",
      employeeId: EMPLOYEE_1,
      employeeLabel: "Person 1",
      localDate: "2026-08-11",
      durationMilliseconds: 3600000n,
      rateVersionId: SATZ,
      amountMinorUnits: 1000n,
    },
  ],
};

/**
 * Grundform einer Position fuer Faelle, die nur EINE Groesse variieren.
 *
 * Bewusst neben {@link GESPEICHERT} und nicht aus ihm herausgelesen: ein
 * `GESPEICHERT.positions[0]` waere `| undefined` unter
 * `noUncheckedIndexedAccess` und zwaenge zu einem `!`.
 */
const POSITION_VORLAGE: StoredCostSnapshot["positions"][number] = {
  id: POS_1,
  assignmentId: ASSIGNMENT_1,
  worksiteId: WORKSITE,
  worksiteLabel: "Baustelle A",
  employeeId: EMPLOYEE_1,
  employeeLabel: "Person 1",
  localDate: "2026-08-11",
  durationMilliseconds: 3600000n,
  rateVersionId: SATZ,
  amountMinorUnits: 1000n,
};

describe("toCostSnapshotDto (EYT-139)", () => {
  it("erfuellt den Vertrag CostSnapshotSchema", () => {
    const geprueft = CostSnapshotSchema.safeParse(toCostSnapshotDto(GESPEICHERT));
    expect(geprueft.success, JSON.stringify(geprueft.error?.issues)).toBe(true);
  });

  it("uebernimmt Kopffelder unveraendert aus dem gespeicherten Stand", () => {
    const dto = toCostSnapshotDto(GESPEICHERT);
    expect(dto.id).toBe(SNAPSHOT);
    expect(dto.planVersionId).toBe(PLAN);
    expect(dto.worksiteId).toBeNull();
    expect(dto.weekKey).toBe("2026-W33");
    expect(dto.timeZone).toBe("Europe/Berlin");
    expect(dto.currency).toBe("EUR");
    expect(dto.ruleVersion).toBe("personnel-plan-cost-v1");
    expect(dto.createdAt).toBe("2026-08-12T09:15:00.000Z");
    expect(dto.createdBy).toBe("00000000-0000-4000-8000-00000000aaa1");
    expect(dto.correlationId).toBe("korrelation-1");
  });

  it("gibt die Gesamtsumme des KOPFES zurueck, nicht die Summe der Positionen", () => {
    // 9007199254740993 = 2^53 + 1. Ueber `number` wuerde daraus 9007199254740992.
    expect(toCostSnapshotDto(GESPEICHERT).totalMinorUnits).toBe("9007199254740993");
  });

  it("haelt die gespeicherte Positionsreihenfolge und wandelt bigint zu String", () => {
    const dto = toCostSnapshotDto(GESPEICHERT);
    expect(dto.positions.map((p) => p.id)).toEqual([POS_1, POS_2, POS_3]);
    expect(dto.positions[0]?.amountMinorUnits).toBe("7500");
    expect(dto.positions[0]?.durationMilliseconds).toBe("28800000");
  });

  /**
   * Die HERKUNFT jedes Positionsfeldes — nicht bloss seine Anwesenheit.
   *
   * ## Warum EIN `toEqual` ueber das ganze Objekt und nicht drei `expect`
   *
   * Weil der Fehler, den dieser Fall abwehrt, in keinem einzelnen Feld sichtbar
   * ist. Werden zwei gleichtypige Spalten vertauscht — `employeeId` aus
   * `assignmentId`, `employeeLabel` aus `worksiteLabel` —, ist danach jedes Feld
   * einzeln vorhanden, nicht leer und vom richtigen Typ. `CostSnapshotSchema`
   * winkt das durch: `strictObject` prueft Anwesenheit und Form, niemals
   * Herkunft. Nur der vollstaendige Vergleich gegen die Fixture bindet jeden
   * Zielschluessel an SEINE Quelle. Einzelne `expect` haetten dieselbe Luecke in
   * klein: geprueft waere, was jemand aufzuschreiben dachte, und ein Tausch
   * zwischen zwei ungeprueften Feldern bliebe unsichtbar.
   *
   * Voraussetzung dafuer ist, dass die zehn Werte einer Position paarweise
   * verschieden sind — siehe die benannten Konstanten oben. Traegen zwei Felder
   * denselben Wert, ist ihr Tausch nicht beobachtbar.
   *
   * ## Warum ALLE Positionen und nicht nur `positions[0]`
   *
   * Das Gegenargument war, `toPositionDto` sei eine Funktion ohne
   * Indexabhaengigkeit, ein Fall genuege also. Gemessen stimmt das nicht: mit
   * `employeeLabel: "Person 1"` — einer festverdrahteten Konstanten statt der
   * Quelle — blieben alle sieben vorherigen Faelle gruen, und ein Vergleich nur
   * ueber `positions[0]` waere ebenfalls gruen geblieben, weil Position 1
   * zufaellig genau diesen Wert traegt. Erst Position 2 („Person 2") entlarvt
   * sie. Die Fixture ist deshalb so gebaut, dass die drei Positionen sich in
   * Mitarbeiter, Tag, Dauer und Betrag unterscheiden.
   *
   * Gemessene Gegenmutationen: der Feldtausch oben und die festverdrahtete
   * Konstante. Beide kompilieren (`TSC_EXIT=0`) und waren vor diesem Fall gruen.
   */
  it("uebernimmt jedes Positionsfeld aus SEINER Quelle, nicht aus einer gleichtypigen Nachbarspalte", () => {
    expect(toCostSnapshotDto(GESPEICHERT).positions).toEqual([
      {
        id: POS_1,
        assignmentId: ASSIGNMENT_1,
        worksiteId: WORKSITE,
        worksiteLabel: "Baustelle A",
        employeeId: EMPLOYEE_1,
        employeeLabel: "Person 1",
        localDate: "2026-08-12",
        durationMilliseconds: "28800000",
        rateVersionId: SATZ,
        amountMinorUnits: "7500",
      },
      {
        id: POS_2,
        assignmentId: ASSIGNMENT_2,
        worksiteId: WORKSITE,
        worksiteLabel: "Baustelle A",
        employeeId: EMPLOYEE_2,
        employeeLabel: "Person 2",
        localDate: "2026-08-11",
        durationMilliseconds: "14400000",
        rateVersionId: SATZ,
        amountMinorUnits: "2500",
      },
      {
        id: POS_3,
        assignmentId: ASSIGNMENT_3,
        worksiteId: WORKSITE,
        worksiteLabel: "Baustelle A",
        employeeId: EMPLOYEE_1,
        employeeLabel: "Person 1",
        localDate: "2026-08-11",
        durationMilliseconds: "3600000",
        rateVersionId: SATZ,
        amountMinorUnits: "1000",
      },
    ]);
  });

  it("gruppiert days aus den gespeicherten Positionen, aufsteigend nach lokalem Tag", () => {
    // Die Positionsreihenfolge beginnt mit dem 12., die Tagesliste mit dem 11. —
    // erst dieser Widerspruch beweist, dass sortiert und nicht eingefuegt wird.
    expect(toCostSnapshotDto(GESPEICHERT).days).toEqual([
      { localDate: "2026-08-11", amountMinorUnits: "3500" },
      { localDate: "2026-08-12", amountMinorUnits: "7500" },
    ]);
  });

  /**
   * Ergaenzt, weil die oben genannte Gegenmutation auf den POSITIONEN sonst
   * nicht feuert — gemessen, nicht vermutet: mit
   * `amountMinorUnits: String(Number(position.amountMinorUnits))` blieben alle
   * sechs urspruenglichen Faelle gruen. Die Betraege 7500/2500/1000 liegen weit
   * unter 2^53; der Praezisionsverlust war allein an `totalMinorUnits`
   * verankert, also am Kopf, den die Naht gar nicht rechnet.
   *
   * Dieser Fall legt den grossen Wert dorthin, wo tatsaechlich gerechnet wird:
   * auf eine Position UND damit in die Tagessumme. Zwei Positionen desselben
   * Tages, deren Summe nur in `bigint` stimmt — eine `number`-Addition ergaebe
   * 9007199254740992 statt 9007199254740994.
   */
  it("verliert oberhalb von 2^53 weder im Positionsbetrag noch in der Tagessumme", () => {
    const gross = toCostSnapshotDto({
      ...GESPEICHERT,
      positions: [
        {
          ...POSITION_VORLAGE,
          id: POS_1,
          localDate: "2026-08-11",
          amountMinorUnits: 9007199254740993n,
        },
        { ...POSITION_VORLAGE, id: POS_2, localDate: "2026-08-11", amountMinorUnits: 1n },
      ],
    });
    expect(gross.positions[0]?.amountMinorUnits).toBe("9007199254740993");
    expect(gross.days).toEqual([{ localDate: "2026-08-11", amountMinorUnits: "9007199254740994" }]);
  });

  it("erzeugt fuer einen Snapshot ohne Positionen eine leere Tagesliste", () => {
    const leer = toCostSnapshotDto({ ...GESPEICHERT, positions: [], totalMinorUnits: 0n });
    expect(leer.days).toEqual([]);
    expect(leer.positions).toEqual([]);
    expect(leer.totalMinorUnits).toBe("0");
  });
});
