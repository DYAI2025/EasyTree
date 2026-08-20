/**
 * Metatest: die zusaetzlichen Belege des Invariantenregisters verrotten nicht
 * (EYT-140, Korrekturbefund K6).
 *
 * ## Warum es diese Datei zusaetzlich zu `domain-invariant-coverage` gibt
 *
 * Jener Test misst genau zwei Fundstellen je Eintrag, `positive` und
 * `negative`, und er verbietet einen zweiten Eintrag zum selben Export
 * ("vergibt jeden Eintrag genau einmal"). Beides ist richtig so. Die Folge ist
 * aber, dass eine Registeraussage, die MEHRERE Zusagen buendelt, Tests hat, die
 * in keinem Slot stehen — gemessen am 18.08.2026 waren das die beiden Tests
 * `lehnt eine im ISO-Jahr nicht existierende Woche ab …`, die die
 * Ablehnungsrichtung von `shiftPlanningWeek` und `planningWeekDateRange`
 * tragen. Ein Umbenennen haette niemand bemerkt.
 *
 * Diese Datei schliesst die Luecke mit derselben Methode: der genannte Titel
 * muss im Quelltext der genannten Datei woertlich vorkommen. Sie liegt neben
 * dem Register statt in `domain-invariant-coverage.test.ts`, weil jene Datei in
 * dieser Runde ausserhalb des freigegebenen Scopes liegt.
 *
 * ## Gegenmutation
 *
 * Einen Titel in `weitereBelege` verfaelschen (oder den zugehoerigen Test in
 * `packages/domain/test/planning-week.test.ts` umbenennen) — dieser Test wird
 * rot und nennt Export, Titel und Datei. Ausgefuehrt, nicht ausgedacht:
 * gemessen am 18.08.2026 mit dem Titel "diesen Test gibt es nicht".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { INVARIANTS } from "./registry";

const repoRoot = resolve(__dirname, "..", "..", "..", "..");

/** Jede in `weitereBelege` genannte Datei genau einmal gelesen. */
function quelltexte(): Map<string, string> {
  const gelesen = new Map<string, string>();
  for (const eintrag of INVARIANTS) {
    for (const ref of eintrag.weitereBelege ?? []) {
      if (gelesen.has(ref.file)) continue;
      gelesen.set(ref.file, readFileSync(resolve(repoRoot, ref.file), "utf8"));
    }
  }
  return gelesen;
}

describe("Zusaetzliche Registerbelege (EYT-140 K6)", () => {
  it("fuehrt ueberhaupt zusaetzliche Belege — sonst prueft dieser Test nichts", () => {
    // Nicht-Leerlauf-Bremse: eine geleerte Liste waere sonst still gruen, und
    // genau der Zustand war der Befund.
    const anzahl = INVARIANTS.reduce((summe, e) => summe + (e.weitereBelege?.length ?? 0), 0);
    expect(anzahl).toBeGreaterThanOrEqual(4);
  });

  it("belegt jeden zusaetzlich genannten Test woertlich in der genannten Datei", () => {
    const quellen = quelltexte();
    const kaputt: string[] = [];
    let geprueft = 0;
    for (const eintrag of INVARIANTS) {
      for (const ref of eintrag.weitereBelege ?? []) {
        geprueft += 1;
        const quelle = quellen.get(ref.file);
        if (quelle === undefined) {
          kaputt.push(`${eintrag.exportName}: Datei ${ref.file} existiert nicht`);
          continue;
        }
        if (!quelle.includes(ref.title)) {
          kaputt.push(`${eintrag.exportName}: "${ref.title}" steht nicht in ${ref.file}`);
        }
      }
    }
    expect(
      kaputt,
      "Verrotteter Zusatzbeleg. Ein umbenannter oder geloeschter Test darf die " +
        "Abdeckungszusage nicht stillschweigend entwerten.",
    ).toEqual([]);
    expect(geprueft).toBeGreaterThanOrEqual(4);
  });

  it("erkennt einen verrotteten Zusatzbeleg tatsaechlich", () => {
    // Gegenprobe: ohne sie waere die Zeile oben auch dann gruen, wenn
    // `includes` nie fehlschlagen koennte.
    const quellen = quelltexte();
    const eine = [...quellen.values()][0];
    expect(eine).toBeDefined();
    expect(eine?.includes("diesen Test gibt es nicht")).toBe(false);
  });

  it("nennt in den Zusatzbelegen nur Exporte, die auch einen Registereintrag haben", () => {
    // Die Liste haengt am Eintrag, kann also keinen fremden Export nennen — die
    // Zusicherung haelt das fest, damit ein spaeterer Umbau es nicht still
    // aufweicht.
    const mitBelegen = INVARIANTS.filter((e) => (e.weitereBelege?.length ?? 0) > 0).map(
      (e) => e.exportName,
    );
    expect(mitBelegen).toEqual(["shiftPlanningWeek", "planningWeekDateRange"]);
  });
});
