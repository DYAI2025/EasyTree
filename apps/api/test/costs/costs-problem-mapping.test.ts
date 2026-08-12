/**
 * Jeder Ablehnungsgrund des Snapshot-Pfades hat genau einen stabilen URN
 * (EYT-139).
 *
 * ## Warum ein eigener Test und nicht bloss `satisfies`
 *
 * `satisfies Record<Problem, string>` erzwingt VOLLSTAENDIGKEIT zur Compilezeit
 * — es erzwingt nicht, dass die Werte verschieden sind. Zwei Gruende mit
 * demselben URN saehen fuer den Compiler korrekt aus, und die Oberflaeche
 * koennte „Satz fehlt" nicht von „Satz mehrdeutig" unterscheiden. Diese Datei
 * misst die Injektivitaet.
 *
 * ## Gegenmutationen — alle eingespielt und gemessen
 *
 * - Zwei Eintraege auf denselben URN legen -> „URNs … paarweise verschieden"
 *   wird rot.
 * - `RATE_INVALID` auf `RATE_ERROR_TYPE.RATE_INTERVAL_OVERLAP` legen, also auf
 *   einen FREMDEN URN mit fester Bedeutung -> derselbe Fall wird rot. Vorher
 *   blieb genau diese Kollision gruen, weil `RATE_ERROR_TYPE` nicht im
 *   Vergleich stand.
 * - `RATE_NOT_FOUND` auf einen neu erfundenen URN legen -> „wiederverwendet die
 *   bestehenden Satz-URNs" wird rot.
 * - Die Zeile `this.name = "CostsProblem"` streichen -> der letzte Fall wird
 *   rot.
 * - Einen Eintrag aus einer Tabelle streichen -> der Compiler wird rot, nicht
 *   dieser Test. Das ist die Arbeitsteilung: `satisfies` misst
 *   Vollstaendigkeit, diese Datei Verschiedenheit und Herkunft.
 */
import { describe, expect, it } from "vitest";

// AUSSCHLIESSLICH ueber die Modulwurzel. Ein tiefer Pfad nach `interface/http/`
// faellt am Waechter `costs-cross-module-public-api-only`, auch aus einem Test.
import {
  COSTS_ERROR_TYPE,
  CostsProblem,
  PLAN_COST_FACTS_PROBLEMS,
  RATE_ERROR_TYPE,
  SNAPSHOT_ASSEMBLY_ERROR_TYPE,
  SNAPSHOT_ASSEMBLY_PROBLEMS,
  SNAPSHOT_READ_ERROR_TYPE,
  SNAPSHOT_READ_PROBLEMS,
  SNAPSHOT_WRITE_ERROR_TYPE,
  SNAPSHOT_WRITE_PROBLEMS,
} from "../../src/modules/costs";

/**
 * Je Tabelle: ihr Name, sie selbst, und die Gruende, die sie decken muss.
 *
 * Eine Zeile je Tabelle statt drei Schleifen in einem `it`: scheitert die erste
 * Schleife, laufen die uebrigen nie — und die Fehlermeldung nennt dann nicht
 * einmal, welche Tabelle die Luecke hat.
 */
const TABELLEN: [string, Record<string, string>, readonly string[]][] = [
  ["SNAPSHOT_ASSEMBLY_ERROR_TYPE", SNAPSHOT_ASSEMBLY_ERROR_TYPE, SNAPSHOT_ASSEMBLY_PROBLEMS],
  ["SNAPSHOT_WRITE_ERROR_TYPE", SNAPSHOT_WRITE_ERROR_TYPE, SNAPSHOT_WRITE_PROBLEMS],
  ["SNAPSHOT_READ_ERROR_TYPE", SNAPSHOT_READ_ERROR_TYPE, SNAPSHOT_READ_PROBLEMS],
  ["COSTS_ERROR_TYPE", COSTS_ERROR_TYPE, PLAN_COST_FACTS_PROBLEMS],
];

// Die drei beabsichtigten Mehrfachnutzungen — einmal benannt, damit jede
// WEITERE eine Aenderung an dieser Liste erzwingt, also eine Entscheidung.
// Der Fall „wiederverwendet die bestehenden Satz-URNs" sichert sie einzeln ab;
// hier stehen sie nur als Ausnahme.
const BEABSICHTIGT = new Set<string>([
  RATE_ERROR_TYPE.RATE_NOT_FOUND,
  RATE_ERROR_TYPE.RATE_AMBIGUOUS,
  RATE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
]);

describe("Fehlercodes des Snapshot-Pfades (EYT-139)", () => {
  it.each(TABELLEN)("nennt in %s fuer JEDEN Grund einen Code", (_name, tabelle, gruende) => {
    // Ohne diese Zeile liefe die Schleife an einer leeren Liste vakuum-gruen.
    expect(gruende.length).toBeGreaterThan(0);
    for (const grund of gruende) {
      expect(tabelle[grund], grund).toMatch(/^urn:easytree:costs:/);
    }
  });

  it("haelt die URNs des Kostenmoduls paarweise verschieden — auch gegen die Satz-URNs", () => {
    // `RATE_ERROR_TYPE` steht bewusst MIT im Vergleich. Ohne es mass dieser
    // Fall nur die Verschiedenheit innerhalb der neuen Tabellen: gemessen blieb
    // `RATE_INVALID: RATE_ERROR_TYPE.RATE_INTERVAL_OVERLAP` gruen, und die
    // Oberflaeche zeigte „zwei Saetze ueberlappen sich", wo ein Satz bloss
    // fehlerhaft ist. Die drei beabsichtigten Doppelungen fallen vorher raus —
    // beide Vorkommen, weil `BEABSICHTIGT` ueber den WERT filtert.
    const alle = [
      ...Object.values(SNAPSHOT_ASSEMBLY_ERROR_TYPE),
      ...Object.values(SNAPSHOT_WRITE_ERROR_TYPE),
      ...Object.values(SNAPSHOT_READ_ERROR_TYPE),
      ...Object.values(COSTS_ERROR_TYPE),
      ...Object.values(RATE_ERROR_TYPE),
    ].filter((urn) => !BEABSICHTIGT.has(urn));
    expect(new Set(alle).size).toBe(alle.length);
  });

  it("wiederverwendet die bestehenden Satz-URNs statt neue zu erfinden", () => {
    // RATE_NOT_FOUND und RATE_AMBIGUOUS gibt es seit EYT-108. Ein zweiter URN
    // fuer dieselbe Aussage waere ein neuer Problemname ohne Vertragsdeckung.
    expect(SNAPSHOT_ASSEMBLY_ERROR_TYPE.RATE_NOT_FOUND).toBe(RATE_ERROR_TYPE.RATE_NOT_FOUND);
    expect(SNAPSHOT_ASSEMBLY_ERROR_TYPE.RATE_AMBIGUOUS).toBe(RATE_ERROR_TYPE.RATE_AMBIGUOUS);
    expect(SNAPSHOT_WRITE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED).toBe(
      RATE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
    );
  });

  it("traegt in CostsProblem Status, Titel, Typ und Text — jeden aus SEINEM Feld", () => {
    // Vier paarweise verschiedene Werte, drei davon `string`: nur so faellt eine
    // vertauschte Zuweisung auf. Siehe die Begruendung im Kopf von
    // `costs-problem.ts`, warum der Konstruktor ueberhaupt ein Objekt nimmt.
    const problem = new CostsProblem({
      status: 400,
      title: "Ungueltige Anfrage",
      type: "urn:easytree:costs:probe",
      detail: "Beschreibender Text",
    });
    expect(problem.status).toBe(400);
    expect(problem.title).toBe("Ungueltige Anfrage");
    expect(problem.type).toBe("urn:easytree:costs:probe");
    expect(problem.message).toBe("Beschreibender Text");
    // `name` statt `toBeInstanceOf(Error)`: letzteres kann ohne inkohaerenten
    // Umbau gar nicht rot werden, waehrend `this.name` nirgends zugesichert
    // war — obwohl alle fuenf Geschwisterklassen es setzen und der Wert im
    // Betriebsprotokoll erscheint. Gegenmutation: die `name`-Zeile streichen.
    expect(problem.name).toBe("CostsProblem");
  });
});
