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
 * ## Beide Richtungen, seit EYT-140
 *
 * Bis 18.08.2026 mass diese Datei ausschliesslich die Richtung Tag -> Woche;
 * importiert waren aus `@easytree/domain` nur `EUROPE_BERLIN`,
 * `isoWeekOfLocalDate`, `localBusinessDate` und `planningWeekKey`. Mit EYT-140
 * kam mit `mondayOfIsoWeekMs` eine zweite Kopie von `montagDerIsoWoche` hinzu —
 * die GEGENRICHTUNG Woche -> Montag — und der Dateikopf der Domain berief sich
 * auf diesen Test, obwohl er sie nicht anfasste (Korrekturbefund K2). Der Block
 * "Rueckrichtung" weiter unten loest die Behauptung ein.
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
import type { LocalBusinessDate } from "@easytree/domain";
import {
  compareLocalBusinessDate,
  dayAfter,
  dayBefore,
  EUROPE_BERLIN,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekDateRange,
  planningWeekKey,
  shiftPlanningWeek,
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

/**
 * Die RUECKRICHTUNG Woche -> Montag (EYT-140, Korrekturbefund K2).
 *
 * `mondayOfIsoWeekMs` in `packages/domain/src/planning-week.ts` ist die zweite
 * Kopie von `montagDerIsoWoche` (`packages/contracts/src/planning/iso-week.ts`).
 *
 * ## Warum die beiden Montage nicht direkt verglichen werden
 *
 * `montagDerIsoWoche` ist im Vertrag nicht exportiert — und soll es nicht
 * werden: die Transportgrenze braucht kein Datum, sondern ein Ja/Nein zum
 * Schluessel. Der Montag der Domain wird deshalb gegen die REGEL geprueft, aus
 * der der Vertrag seinen eigenen ableitet, mit ausschliesslich Vertrags-
 * funktionen als Torwaechter: `parseIsoWeekKey` liefert die Woche,
 * `isoWochenImJahr` die Zahl der Wochen, `formatIsoWeekKey` den Schluessel.
 *
 * Der Vergleich "gehoert der Montag zur Woche" allein reichte nicht — er gilt
 * fuer jeden der sieben Tage. Erst mit dem Vortag ist er als ERSTER Tag
 * festgenagelt; dieselbe Luecke hatte der Sweep im Domainpaket (Korrekturbefund K4).
 */
describe("Rueckrichtung: die Domain trifft den Montag, den der Vertrag meint", () => {
  /** Woche eines Kalendertags als Schluessel. Nur die vorbestehende Hinrichtung. */
  function schluesselVonTag(tag: LocalBusinessDate): string {
    return planningWeekKey(isoWeekOfLocalDate(tag));
  }

  it("grenzt fuer jeden Prueftag die Woche des Vertrags exakt ab", () => {
    let geprueft = 0;
    for (const tag of PRUEFTAGE) {
      const schluessel = domainSchluessel(tag);
      // Der Vertrag entscheidet, WELCHE Woche gemeint ist — nicht die Domain.
      const ausDemVertrag = parseIsoWeekKey(schluessel);
      expect(ausDemVertrag.ok, `${tag}: Vertrag lehnt ${schluessel} ab`).toBe(true);
      if (!ausDemVertrag.ok) continue;

      const { monday, sunday } = planningWeekDateRange(ausDemVertrag.week);

      expect(schluesselVonTag(monday), `${schluessel}: Montag`).toBe(schluessel);
      expect(schluesselVonTag(sunday), `${schluessel}: Sonntag`).toBe(schluessel);
      // Die beiden entscheidenden Zeilen: eine gleichfoermige Verschiebung um
      // einen Tag liesse die zwei darueber unberuehrt.
      expect(schluesselVonTag(dayBefore(monday)), `${schluessel}: Vortag`).not.toBe(schluessel);
      expect(schluesselVonTag(dayAfter(sunday)), `${schluessel}: Folgetag`).not.toBe(schluessel);
      // Und der Prueftag selbst liegt im Zeitraum — sonst beschriebe die
      // Rueckrichtung eine andere Woche als die Hinrichtung.
      const [jahr, monat, tagImMonat] = tag.split("-").map(Number) as [number, number, number];
      const alsDatum = { year: jahr, month: monat, day: tagImMonat };
      expect(compareLocalBusinessDate(monday, alsDatum) <= 0, `${schluessel}: ab Montag`).toBe(
        true,
      );
      expect(compareLocalBusinessDate(sunday, alsDatum) >= 0, `${schluessel}: bis Sonntag`).toBe(
        true,
      );
      geprueft += 1;
    }
    // Nicht-Leerlauf-Bremse: eine leere Schleife waere sonst still gruen.
    expect(geprueft).toBe(PRUEFTAGE.length);
  });

  it("zieht je Jahr dieselbe Wochenzahl wie isoWochenImJahr", () => {
    // Die Domain hat keine eigene `isoWochenImJahr`; ihre Wochenzahl steckt
    // implizit in der Rueckrechnung von `assertRealIsoWeek`. Genau die wird hier
    // gegen die explizite Zahl des Vertrags gehalten — eine Woche mehr muss die
    // Domain ablehnen.
    let geprueft = 0;
    for (const jahr of [2019, 2020, 2021, 2025, 2026, 2027, 9999]) {
      const wochen = isoWochenImJahr(jahr);
      expect(() => planningWeekDateRange({ isoYear: jahr, isoWeek: wochen })).not.toThrow();
      expect(() => planningWeekDateRange({ isoYear: jahr, isoWeek: wochen + 1 })).toThrow(
        RangeError,
      );
      expect(isValidIsoWeekKey(formatIsoWeekKey({ isoYear: jahr, isoWeek: wochen }))).toBe(true);
      geprueft += 1;
    }
    expect(geprueft).toBe(7);
  });

  it("legt den 4. Januar in Woche 1 — die Regel, aus der beide Seiten ihren Montag ableiten", () => {
    // Beide Implementierungen ankern Woche 1 am 4. Januar. Wer den Anker
    // verschiebt, faellt hier auf.
    let geprueft = 0;
    for (const jahr of [2019, 2020, 2021, 2025, 2026, 2027]) {
      const { monday, sunday } = planningWeekDateRange({ isoYear: jahr, isoWeek: 1 });
      const jan4 = { year: jahr, month: 1, day: 4 };
      expect(compareLocalBusinessDate(monday, jan4) <= 0, `${jahr}: Montag <= 4. Januar`).toBe(
        true,
      );
      expect(compareLocalBusinessDate(sunday, jan4) >= 0, `${jahr}: Sonntag >= 4. Januar`).toBe(
        true,
      );
      expect(schluesselVonTag(jan4), `${jahr}`).toBe(
        formatIsoWeekKey({ isoYear: jahr, isoWeek: 1 }),
      );
      geprueft += 1;
    }
    expect(geprueft).toBe(6);
  });
});

/**
 * Der Sweep gegen die ECHTE Vertragspruefung (EYT-140, Korrekturbefund K3).
 *
 * Der M2-Plan verlangte: "fuer 520 Verschiebungen … muss `formatIsoWeekKey`
 * (Ergebnis) von `isValidIsoWeekKey` akzeptiert werden". In
 * `packages/domain/test/planning-week.test.ts` ist das nicht schreibbar —
 * `@easytree/contracts` darf dort nicht importiert werden — und stattdessen
 * stand dort die lokale Regex `^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$`: genau das
 * Muster, das der Kopf von `iso-week.ts` als unzureichend bezeichnet, weil es
 * `W53` in JEDEM Jahr durchlaesst. Hier laeuft die Vorgabe woertlich.
 */
describe("Sweep gegen isValidIsoWeekKey, nicht gegen ein Muster", () => {
  it("laesst jede der 520 verschobenen Wochen vom Vertrag annehmen", () => {
    const start = { isoYear: 2020, isoWeek: 1 } as const;
    let geprueft = 0;
    for (let delta = 0; delta < 520; delta += 1) {
      const woche = shiftPlanningWeek(start, delta);
      const schluessel = planningWeekKey(woche);
      expect(isValidIsoWeekKey(schluessel), schluessel).toBe(true);
      // Und der Vertrag formatiert dieselbe Woche zeichengleich — sonst weichen
      // die Formatierungen ab, auch wenn beide Rechnungen stimmen.
      expect(formatIsoWeekKey(woche), schluessel).toBe(schluessel);
      geprueft += 1;
    }
    expect(geprueft).toBe(520);
    expect(planningWeekKey(shiftPlanningWeek(start, 519))).toBe("2029-W50");
  });

  it("ist strenger als das Muster, das im Domainpaket allein moeglich waere", () => {
    // Nicht-Leerlauf: ohne diesen Vergleich waere die Zusicherung oben auch dann
    // gruen, wenn `isValidIsoWeekKey` alles annaehme, was wohlgeformt aussieht.
    const WOHLGEFORMT = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
    for (const schluessel of ["2025-W53", "2027-W53"]) {
      expect(WOHLGEFORMT.test(schluessel), `${schluessel}: Muster`).toBe(true);
      expect(isValidIsoWeekKey(schluessel), `${schluessel}: Vertrag`).toBe(false);
    }
  });

  it("erzeugt keinen Schluessel oberhalb der Vertragsgrenze 9999", () => {
    // Korrekturbefund K1: `assertRealIsoWeek` prueft frueher nur `isoYear >= 1`;
    // gemessen lieferte `shiftPlanningWeek({9999, 52}, 1)` den Schluessel
    // "10000-W01", den der Vertrag ablehnt. Beide Haelften stehen hier
    // nebeneinander, weil nur `apps/api` beide Pakete sieht.
    expect(isValidIsoWeekKey("10000-W01")).toBe(false);
    expect(() => shiftPlanningWeek({ isoYear: 9999, isoWeek: 52 }, 1)).toThrow(RangeError);
    // Gegenprobe, damit die Zeile darueber nicht "wirft immer" bedeutet:
    expect(
      isValidIsoWeekKey(planningWeekKey(shiftPlanningWeek({ isoYear: 9999, isoWeek: 51 }, 1))),
    ).toBe(true);
  });
});
