/**
 * Die automatische Werktagsableitung des Einsatzes (EYT-120, D-005/D-006).
 *
 * Fachlicher Vertrag (Confluence 49119274, `DEFAULT_WORKDAYS = MONDAY_TO_FRIDAY_AUTO`):
 * Montag bis Freitag im inklusiven lokalen Zeitraum entstehen OHNE Kalenderinteraktion.
 * Der Kalender ist Override — er waehlt Werktage ab und fuegt Wochenenden hinzu — und
 * ist kein Pflichtschritt.
 *
 * Diese Datei misst die reine Kalenderregel. Die Kommandogrenzen (Horizont-XOR,
 * Reichweite der Overrides, leere Menge) stehen in `engagement-schemas.test.ts`,
 * die Paritaet zur Domainfassung in `apps/api/test/planning-engagement-range.test.ts`.
 *
 * ## Gegenmutationen, die genau hier rot werden
 *
 * M3 Samstag zum Vorgabetag machen  -> "Wochenende ist kein Vorgabetag"
 * M4 Montag aus der Ableitung nehmen -> "fuenf Werktage ohne jede Kalendereingabe"
 * M10 Ausschluesse ignorieren        -> "ein abgewaehlter Werktag faellt weg"
 * M11 Wochenendaufnahmen ignorieren  -> "ein ausdruecklich gewaehlter Samstag kommt dazu"
 */
import { describe, expect, it } from "vitest";

import { deriveEffectiveWorkdays } from "../src/planning/workdays.js";

// 2031-01-06 ist ein Montag, 2031-01-10 der Freitag derselben Woche;
// 2031-01-04/05 und 2031-01-11/12 sind die umschliessenden Wochenenden.
const MONTAG = "2031-01-06";
const FREITAG = "2031-01-10";
const SAMSTAG_DAVOR = "2031-01-04";
const SONNTAG_DANACH = "2031-01-12";
const MITTWOCH = "2031-01-08";
const SAMSTAG_DANACH = "2031-01-11";

const WOCHE = ["2031-01-06", "2031-01-07", "2031-01-08", "2031-01-09", "2031-01-10"];

describe("deriveEffectiveWorkdays — Vorgabe Montag bis Freitag (EYT-120 D-005)", () => {
  it("R10 erzeugt fuenf Werktage ohne jede Kalendereingabe", () => {
    // Der Normalflow: kein Override-Objekt, trotzdem eine vollstaendige Woche.
    expect(deriveEffectiveWorkdays(MONTAG, FREITAG)).toEqual(WOCHE);
  });

  it("R14 akzeptiert ein fehlendes Override-Objekt und ein leeres gleichermassen", () => {
    expect(deriveEffectiveWorkdays(MONTAG, FREITAG, { include: [], exclude: [] })).toEqual(WOCHE);
  });

  it("R11 Wochenende ist kein Vorgabetag — auch nicht am Rand des Zeitraums", () => {
    // Der Zeitraum beginnt an einem Samstag und endet an einem Sonntag; genau
    // die fuenf Werktage dazwischen duerfen entstehen.
    expect(deriveEffectiveWorkdays(SAMSTAG_DAVOR, SONNTAG_DANACH)).toEqual(WOCHE);
  });

  it("R12 ein ausdruecklich gewaehlter Samstag kommt dazu — einsortiert, nicht angehaengt", () => {
    expect(
      deriveEffectiveWorkdays(SAMSTAG_DAVOR, SONNTAG_DANACH, {
        include: [SAMSTAG_DAVOR, SAMSTAG_DANACH],
        exclude: [],
      }),
    ).toEqual([SAMSTAG_DAVOR, ...WOCHE, SAMSTAG_DANACH]);
  });

  it("R13 ein abgewaehlter Werktag faellt weg", () => {
    expect(deriveEffectiveWorkdays(MONTAG, FREITAG, { include: [], exclude: [MITTWOCH] })).toEqual(
      WOCHE.filter((tag) => tag !== MITTWOCH),
    );
  });

  it("R25 Mengensemantik: die Reihenfolge der Overrides aendert das Ergebnis nicht", () => {
    const a = deriveEffectiveWorkdays(SAMSTAG_DAVOR, SONNTAG_DANACH, {
      include: [SAMSTAG_DAVOR, SAMSTAG_DANACH],
      exclude: [MITTWOCH, "2031-01-09"],
    });
    const b = deriveEffectiveWorkdays(SAMSTAG_DAVOR, SONNTAG_DANACH, {
      include: [SAMSTAG_DANACH, SAMSTAG_DAVOR],
      exclude: ["2031-01-09", MITTWOCH],
    });
    expect(b).toEqual(a);
    expect(a).toEqual([SAMSTAG_DAVOR, "2031-01-06", "2031-01-07", "2031-01-10", SAMSTAG_DANACH]);
  });

  it("liefert aufsteigend sortiert und ohne Duplikat — auch bei doppelt genannter Aufnahme", () => {
    // Mengensemantik: derselbe Tag zweimal aufgenommen bleibt EIN effektiver Tag.
    const tage = deriveEffectiveWorkdays(SAMSTAG_DAVOR, SONNTAG_DANACH, {
      include: [SAMSTAG_DANACH, SAMSTAG_DANACH],
      exclude: [],
    });
    expect(tage).toEqual([...WOCHE, SAMSTAG_DANACH]);
    expect(new Set(tage).size).toBe(tage.length);
    expect([...tage].sort()).toEqual(tage);
  });

  it("ein ausgeschlossener Tag bleibt draussen, auch wenn er gar kein Vorgabetag war", () => {
    expect(
      deriveEffectiveWorkdays(SAMSTAG_DAVOR, SONNTAG_DANACH, {
        include: [],
        exclude: [SAMSTAG_DAVOR],
      }),
    ).toEqual(WOCHE);
  });

  it("beachtet nur Overrides innerhalb des aktuellen Planungsumfangs", () => {
    // Die Kommandogrenze lehnt einen Tag ausserhalb ab (R16); die reine Rechnung
    // ignoriert ihn zusaetzlich, damit sie nie einen Tag ausserhalb erzeugt.
    expect(
      deriveEffectiveWorkdays(MONTAG, FREITAG, { include: ["2031-01-18"], exclude: [] }),
    ).toEqual(WOCHE);
  });
});

describe("deriveEffectiveWorkdays — Eintagesfaelle (D-002)", () => {
  it("Montag als eintaegiger Einsatz ergibt genau einen Tag", () => {
    expect(deriveEffectiveWorkdays(MONTAG, MONTAG)).toEqual([MONTAG]);
  });

  it("Samstag als eintaegiger Einsatz ohne Override ergibt keinen Tag", () => {
    expect(deriveEffectiveWorkdays(SAMSTAG_DANACH, SAMSTAG_DANACH)).toEqual([]);
  });

  it("Samstag als eintaegiger Einsatz MIT ausdruecklicher Aufnahme ergibt einen Tag", () => {
    expect(
      deriveEffectiveWorkdays(SAMSTAG_DANACH, SAMSTAG_DANACH, {
        include: [SAMSTAG_DANACH],
        exclude: [],
      }),
    ).toEqual([SAMSTAG_DANACH]);
  });
});

describe("deriveEffectiveWorkdays — Kalendergrenzen (EYT-120)", () => {
  it("R21 Monatsgrenze: der Februar folgt auf den 31. Januar", () => {
    // 2031-01-31 Fr, 02-01 Sa, 02-02 So, 02-03 Mo, 02-04 Di.
    expect(deriveEffectiveWorkdays("2031-01-29", "2031-02-04")).toEqual([
      "2031-01-29",
      "2031-01-30",
      "2031-01-31",
      "2031-02-03",
      "2031-02-04",
    ]);
  });

  it("R22 Jahresgrenze: der 1. Januar folgt auf den 31. Dezember", () => {
    // 2027-12-31 Fr, 2028-01-01 Sa, 01-02 So, 01-03 Mo, 01-04 Di.
    expect(deriveEffectiveWorkdays("2027-12-29", "2028-01-04")).toEqual([
      "2027-12-29",
      "2027-12-30",
      "2027-12-31",
      "2028-01-03",
      "2028-01-04",
    ]);
  });

  it("R23 Schalttag: 2028-02-29 existiert und ist ein Dienstag", () => {
    expect(deriveEffectiveWorkdays("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("R23 Gegenprobe: im Gemeinjahr 2027 gibt es keinen 29. Februar", () => {
    const tage = deriveEffectiveWorkdays("2027-02-26", "2027-03-01");
    expect(tage).toEqual(["2027-02-26", "2027-03-01"]);
    expect(tage).not.toContain("2027-02-29");
  });

  it("R24 Sommerzeitwoche: die Tagesfolge kennt die Zeitumstellung nicht", () => {
    // In Europe/Berlin faellt am 26.03.2028 eine Stunde aus. Eine Aufzaehlung
    // ueber +24h auf einem Zeitpunkt kippte hier um einen Tag; diese Rechnung
    // wandelt Kalendertage ueberhaupt nicht in Zeitpunkte einer Zone um.
    expect(deriveEffectiveWorkdays("2028-03-23", "2028-03-30")).toEqual([
      "2028-03-23",
      "2028-03-24",
      "2028-03-27",
      "2028-03-28",
      "2028-03-29",
      "2028-03-30",
    ]);
  });

  it("verweigert einen Zeitraum, dessen Ende vor dem Beginn liegt", () => {
    // Die Kommandogrenze faengt das vorher ab; die Rechnung schweigt trotzdem
    // nicht, statt still eine leere Menge zu liefern und den Fehler zu decken.
    expect(() => deriveEffectiveWorkdays(FREITAG, MONTAG)).toThrow(RangeError);
  });

  it("verweigert einen Wert, der kein realer Kalendertag ist", () => {
    expect(() => deriveEffectiveWorkdays("2027-02-29", "2027-03-01")).toThrow(RangeError);
    expect(() => deriveEffectiveWorkdays("0000-01-01", "0000-01-05")).toThrow(RangeError);
  });
});
