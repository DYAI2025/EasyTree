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
 * ## Gegenmutation
 *
 * Zwei Eintraege auf denselben URN legen -> „URNs sind paarweise verschieden"
 * wird rot. Einen Eintrag streichen -> der Compiler wird rot, nicht dieser Test.
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

describe("Fehlercodes des Snapshot-Pfades (EYT-139)", () => {
  it("nennt fuer JEDEN Montagegrund einen Code", () => {
    for (const problem of SNAPSHOT_ASSEMBLY_PROBLEMS) {
      expect(SNAPSHOT_ASSEMBLY_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
  });

  it("nennt fuer JEDEN Schreib- und Lesegrund einen Code", () => {
    for (const problem of SNAPSHOT_WRITE_PROBLEMS) {
      expect(SNAPSHOT_WRITE_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
    for (const problem of SNAPSHOT_READ_PROBLEMS) {
      expect(SNAPSHOT_READ_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
    for (const problem of PLAN_COST_FACTS_PROBLEMS) {
      expect(COSTS_ERROR_TYPE[problem], problem).toMatch(/^urn:easytree:costs:/);
    }
  });

  it("haelt die URNs des Snapshot-Pfades paarweise verschieden", () => {
    const alle = [
      ...Object.values(SNAPSHOT_ASSEMBLY_ERROR_TYPE),
      ...Object.values(SNAPSHOT_WRITE_ERROR_TYPE),
      ...Object.values(SNAPSHOT_READ_ERROR_TYPE),
      ...Object.values(COSTS_ERROR_TYPE),
    ];
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
    expect(problem).toBeInstanceOf(Error);
  });
});
