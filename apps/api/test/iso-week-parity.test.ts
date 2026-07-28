/**
 * Paritaet der Wochenregel zwischen Vertrag und Domain (EYT-88).
 *
 * ## Warum es diesen Test gibt
 *
 * Die ISO-Wochenrechnung existiert an zwei Stellen, und das ist kein Versehen:
 *
 *   packages/domain/src/planning-week.ts   erzeugt Wochen aus Zeitpunkten
 *   packages/contracts/src/planning/…      prueft Wochenschluessel am Transport
 *
 * Zusammenlegen ginge nicht ohne Schaden: `@easytree/contracts` ist
 * transport-only und fuehrt `@easytree/domain` bewusst weder als Abhaengigkeit
 * noch als Import (Architekturtest). Zwei Implementierungen bedeuten aber das
 * Risiko zweier VERSCHIEDENER Regeln — genau die Doppelimplementierung, die als
 * `FIND-003` schon einmal Schaden angerichtet hat.
 *
 * Dieser Test ist die Klammer. Er liegt in `apps/api/test`, weil nur `apps/api`
 * beide Pakete sieht. Dieselbe Bauart wie `domain-invariant-coverage.test.ts`.
 *
 * ## Gegenmutation
 *
 * Eine der beiden Seiten auf eine andere Wochenregel aendern — etwa in
 * `iso-week.ts` die Schaltjahrbedingung entfernen, sodass 2020 nur noch 52
 * Wochen haette. Dann widersprechen sich die beiden Rechnungen an einem
 * Jahreswechsel und dieser Test wird rot. Ohne ihn faende das niemand, bis
 * eine Planversion in der falschen Woche landet.
 */
import {
  formatIsoWeekKey,
  isValidIsoWeekKey,
  isoWochenImJahr,
  parseIsoWeekKey,
} from "@easytree/contracts";
import {
  EUROPE_BERLIN,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekKey,
} from "@easytree/domain";
import { describe, expect, it } from "vitest";

/**
 * Tage rund um Jahreswechsel — dort weicht das ISO-Jahr vom Kalenderjahr ab,
 * und genau dort brechen falsche Wochenrechnungen. Ein Raster mitten im Jahr
 * fände nichts.
 */
const PRUEFTAGE = [
  "2019-12-30", // ISO 2020-W01, Kalenderjahr noch 2019
  "2020-01-01",
  "2020-12-28", // ISO 2020-W53 — 2020 hat 53 Wochen
  "2020-12-31",
  "2021-01-01", // ISO 2020-W53, Kalenderjahr schon 2021
  "2021-01-04",
  "2021-12-31", // ISO 2021-W52
  "2025-12-29", // ISO 2026-W01 — 2025 hat nur 52
  "2026-01-01",
  "2026-08-03",
  "2026-12-28", // ISO 2026-W53
  "2027-01-03",
] as const;

function domainSchluessel(iso: string): string {
  const [jahr, monat, tag] = iso.split("-").map(Number) as [number, number, number];
  // Mittags, damit eine Sommerzeitverschiebung den Tag nicht kippt: der Test
  // prueft die Wochenregel, nicht die Zeitzonenumrechnung.
  const instant = new Date(Date.UTC(jahr, monat - 1, tag, 12, 0, 0));
  return planningWeekKey(isoWeekOfLocalDate(localBusinessDate(instant, EUROPE_BERLIN)));
}

describe("Vertrag und Domain rechnen dieselbe ISO-Woche", () => {
  it("prueft ueberhaupt Tage — sonst misst dieser Test nichts", () => {
    expect(PRUEFTAGE.length).toBeGreaterThanOrEqual(10);
  });

  it("jeder von der Domain erzeugte Schluessel besteht die Vertragspruefung", () => {
    // Die Richtung, die zaehlt: was die Domain als Woche ausrechnet, muss der
    // Transport annehmen. Anders herum duerfte der Vertrag strenger sein.
    const abgelehnt = PRUEFTAGE.map(domainSchluessel).filter((k) => !isValidIsoWeekKey(k));
    expect(abgelehnt).toEqual([]);
  });

  it("beide kommen auf dasselbe ISO-Jahr und dieselbe Woche", () => {
    for (const tag of PRUEFTAGE) {
      const ausDerDomain = domainSchluessel(tag);
      const ausDemVertrag = parseIsoWeekKey(ausDerDomain);
      expect(ausDemVertrag.ok, `${tag}: Vertrag lehnt ${ausDerDomain} ab`).toBe(true);
      if (!ausDemVertrag.ok) continue;
      // Rueckformatierung muss denselben Schluessel ergeben — sonst weichen die
      // Formatierungen voneinander ab, auch wenn die Rechnung stimmt.
      expect(formatIsoWeekKey(ausDemVertrag.week), `${tag}`).toBe(ausDerDomain);
    }
  });

  it("die 53-Wochen-Jahre stimmen zwischen beiden Seiten ueberein", () => {
    // Unabhaengig von den Prueftagen: die Domain erzeugt fuer den 28. Dezember
    // eines 53-Wochen-Jahres tatsaechlich W53, fuer ein 52-Wochen-Jahr nicht.
    for (const jahr of [2020, 2021, 2025, 2026]) {
      const erwartet = isoWochenImJahr(jahr);
      const letzteWoche = Number(domainSchluessel(`${jahr}-12-28`).slice(-2));
      expect(letzteWoche, `${jahr}: Domain und Vertrag uneins ueber die Wochenzahl`).toBe(erwartet);
    }
  });
});
