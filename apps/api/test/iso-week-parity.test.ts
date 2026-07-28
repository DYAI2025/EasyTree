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
  // Auch hier NICHT `Date.UTC`: der Helfer selbst wuerde Jahre 0 bis 99 um
  // 1900 verschieben, und der Test pruefte dann etwas anderes als er behauptet.
  const instant = new Date(0);
  instant.setUTCFullYear(jahr, monat - 1, tag);
  instant.setUTCHours(12, 0, 0, 0);
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

/**
 * Die Jahresraender, an denen die Paritaet vorher NICHT galt (EYT-88).
 *
 * Der urspruengliche Paritaetstest pruefte ausschliesslich moderne Jahre. Damit
 * war die Behauptung "Vertrag und Domain rechnen dieselbe Woche" fuer kleine
 * Jahreszahlen unbelegt — und tatsaechlich falsch: `packages/contracts` rechnete
 * ueber `setUTCFullYear`, die Domain ueber `Date.UTC`, und `Date.UTC(99, 0, 1)`
 * ergibt **1999** statt des Jahres 99. Eine stille Verschiebung um 1900 Jahre.
 *
 * Diese Faelle schliessen die Luecke. Sie sind der Grund, warum die Domain
 * inzwischen denselben sicheren Weg geht.
 */
describe("Jahresraender: 0000 und 0099", () => {
  it("die Domain erzeugt fuer den 4. Januar 0099 den Schluessel 0099-W01", () => {
    // Der 4. Januar liegt per ISO-Definition immer in Woche 1. Mit `Date.UTC`
    // waere hier 1999-W01 herausgekommen.
    expect(domainSchluessel("0099-01-04")).toBe("0099-W01");
  });

  it("der Vertrag akzeptiert 0099-W01 und kennt die Wochenzahl des Jahres 99", () => {
    expect(isValidIsoWeekKey("0099-W01")).toBe(true);
    // Gemessen, nicht geraten: der 1. Januar 99 n. Chr. ist ein Donnerstag,
    // also hat das Jahr 53 ISO-Wochen. Meine erste Fassung dieses Tests
    // erwartete 52 — die Implementierung hatte recht, der Test nicht.
    expect(isoWochenImJahr(99)).toBe(53);
    expect(isValidIsoWeekKey("0099-W53")).toBe(true);
    // Ein Jahr mit 52 Wochen zum Vergleich, damit der Fall oben nicht
    // versehentlich "alles ist gueltig" bedeutet.
    expect(isoWochenImJahr(98)).toBe(52);
    expect(isValidIsoWeekKey("0098-W53")).toBe(false);
  });

  it("der Vertrag lehnt 0000-W01 ab — PostgreSQL kennt kein Jahr null", () => {
    expect(isValidIsoWeekKey("0000-W01")).toBe(false);
  });

  it("die Domain lehnt ein Geschaeftsdatum mit Jahr 0 ab, statt es umzudeuten", () => {
    // Umdeuten waere die schlechtere Antwort: ein Jahr, das die Datenbank nicht
    // speichern kann, darf nicht als gueltige Woche zurueckkommen.
    expect(() => isoWeekOfLocalDate({ year: 0, month: 1, day: 4 })).toThrow(RangeError);
  });

  it("formatIsoWeekKey erzeugt keinen ungueltigen Schluessel", () => {
    // `IsoWeek` ist ein reines Interface — ohne diese Pruefung haette die
    // Funktion aus einem handgebauten Objekt klaglos `2025-W53` geliefert.
    expect(() => formatIsoWeekKey({ isoYear: 2025, isoWeek: 53 })).toThrow(RangeError);
    expect(() => formatIsoWeekKey({ isoYear: 0, isoWeek: 1 })).toThrow(RangeError);
    expect(formatIsoWeekKey({ isoYear: 2026, isoWeek: 53 })).toBe("2026-W53");
  });
});
