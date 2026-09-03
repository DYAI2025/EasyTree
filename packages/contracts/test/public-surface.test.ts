/**
 * Die oeffentliche Oberflaeche des Vertrags fuehrt keine Attrappe (EYT-50).
 *
 * ## Warum das ein Test ist und keine Konvention
 *
 * `@easytree/contracts` wird ab EYT-50 von `apps/web` benutzt und landet damit
 * im Browserbuendel. Ein aus der Hauptdatei importierbarer Mock ist dann einen
 * Tippfehler von der echten Implementierung entfernt — und AK10 verlangt
 * ausdruecklich, dass kein Mockzustand operative Wahrheit wird.
 *
 * Der Test prueft die tatsaechlichen Exporte des Moduls, nicht den Quelltext:
 * ein Re-Export ueber einen Zwischenpfad wuerde eine Textsuche umgehen, diese
 * Zusicherung nicht.
 */
import { describe, expect, it } from "vitest";

import * as publicSurface from "../src/index.js";

describe("oeffentliche Oberflaeche von @easytree/contracts", () => {
  const names = Object.keys(publicSurface);

  it("exportiert ueberhaupt etwas — sonst prueft dieser Test nichts", () => {
    expect(names.length).toBeGreaterThan(10);
  });

  it("fuehrt keinen Mock und keine Attrappe", () => {
    const suspicious = names.filter((name) => /mock|stub|fake|dummy|fixture/i.test(name));
    expect(
      suspicious,
      "Attrappen gehoeren nicht in die Hauptdatei: Tests importieren sie direkt " +
        "aus ihrem Modul (z. B. src/mock/planning.js). Aus der oeffentlichen " +
        "Oberflaeche waeren sie im Browserbuendel und damit eine Verwechslung " +
        "wert (EYT-50 AK10).",
    ).toEqual([]);
  });

  it("fuehrt weiterhin die Bausteine, die der Slice braucht", () => {
    // Gegenprobe zur Zeile oben: ohne sie waere das Verbot auch dann gruen,
    // wenn die Datei versehentlich gar nichts mehr exportiert.
    expect(names).toContain("IDEMPOTENCY_HEADER");
    expect(names).toContain("ProblemDocumentSchema");
  });

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
});
