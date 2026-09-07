/**
 * Der Einsatzzeitraum als reine Kalenderregel (EYT-120) — Domainfassung und Paritaet.
 *
 * Kanonisch ist Confluence 49119274 (`RECONCILED_2026_09_06_2344`) mit Jira EYT-120:
 * `ENGAGEMENT_CLOCK_TIMES = NOT_REQUIRED`, `DEFAULT_WORKDAYS = MONDAY_TO_FRIDAY_AUTO`,
 * `CALENDAR_OVERRIDE = OPTIONAL`, `PLANNED_DAY_TIMES = OPTIONAL`.
 *
 * Drei Dinge werden hier gemessen:
 *
 * 1. die Domainfassung von `deriveEffectiveWorkdays` (Vorgabe Mo–Fr, Override, Grenzen);
 * 2. ihre PARITAET zur Vertragsfassung in `@easytree/contracts` — die Datei liegt in
 *    `apps/api/test`, weil nur `apps/api` beide Pakete sieht (dieselbe Bauart wie
 *    `iso-week-parity.test.ts`);
 * 3. dass die aufgehobene Uhrzeit-Semantik des Einsatzes wirklich weg ist und die
 *    verbliebenen Sommerzeit-Helfer weiterhin geschlossen fallen.
 *
 * ## Gegenmutationen, die hier rot werden
 *
 * M3 Samstag zum Vorgabetag machen   -> "Wochenende ist kein Vorgabetag" UND die Paritaet
 * M4 Montag aus der Ableitung nehmen -> "fuenf Werktage ohne Kalendereingabe" UND die Paritaet
 * M10 Ausschluesse ignorieren        -> "ein abgewaehlter Werktag faellt weg"
 * M11 Wochenendaufnahmen ignorieren  -> "ein aufgenommener Samstag kommt dazu"
 * M9 startAt/endAt wieder einfuehren -> "das Modul kennt keine Einsatz-Uhrzeitgrenzen mehr"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { deriveEffectiveWorkdays as vertragsFassung } from "@easytree/contracts";
import { createTimeZone, type LocalBusinessDate } from "@easytree/domain";
import { describe, expect, it } from "vitest";

import {
  deriveEffectiveWorkdays,
  resolveLocalDateTime,
  resolveWorkingInterval,
} from "../src/modules/planning";

const berlin = (() => {
  const z = createTimeZone("Europe/Berlin");
  if (!z.ok) throw new Error("Zone");
  return z.timeZone;
})();

/** `JJJJ-MM-TT` -> Kalendertag der Domain. Nur fuer die Lesbarkeit der Faelle. */
function tag(iso: string): LocalBusinessDate {
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`kein Tag: ${iso}`);
  return { year: y, month: m, day: d };
}

/** Kalendertag -> `JJJJ-MM-TT`, damit sich beide Fassungen vergleichen lassen. */
function alsIso(datum: LocalBusinessDate): string {
  return `${String(datum.year).padStart(4, "0")}-${String(datum.month).padStart(2, "0")}-${String(datum.day).padStart(2, "0")}`;
}

const isoTage = (tage: readonly LocalBusinessDate[]): string[] => tage.map(alsIso);

// 2031-01-06 ist ein Montag, 2031-01-10 der Freitag derselben Woche.
const WOCHE = ["2031-01-06", "2031-01-07", "2031-01-08", "2031-01-09", "2031-01-10"];

describe("deriveEffectiveWorkdays — Vorgabe Montag bis Freitag (EYT-120 D-005)", () => {
  it("erzeugt fuenf Werktage ohne jede Kalendereingabe", () => {
    expect(isoTage(deriveEffectiveWorkdays(tag("2031-01-06"), tag("2031-01-10")))).toEqual(WOCHE);
  });

  it("Wochenende ist kein Vorgabetag — auch nicht am Rand des Zeitraums", () => {
    expect(isoTage(deriveEffectiveWorkdays(tag("2031-01-04"), tag("2031-01-12")))).toEqual(WOCHE);
  });

  it("ein aufgenommener Samstag kommt dazu, ein abgewaehlter Werktag faellt weg", () => {
    expect(
      isoTage(
        deriveEffectiveWorkdays(tag("2031-01-04"), tag("2031-01-12"), {
          include: [tag("2031-01-11")],
          exclude: [tag("2031-01-08")],
        }),
      ),
    ).toEqual(["2031-01-06", "2031-01-07", "2031-01-09", "2031-01-10", "2031-01-11"]);
  });

  it("Mengensemantik: die Reihenfolge der Overrides aendert das Ergebnis nicht", () => {
    const a = deriveEffectiveWorkdays(tag("2031-01-04"), tag("2031-01-12"), {
      include: [tag("2031-01-04"), tag("2031-01-11")],
      exclude: [tag("2031-01-08"), tag("2031-01-09")],
    });
    const b = deriveEffectiveWorkdays(tag("2031-01-04"), tag("2031-01-12"), {
      include: [tag("2031-01-11"), tag("2031-01-04")],
      exclude: [tag("2031-01-09"), tag("2031-01-08")],
    });
    expect(isoTage(b)).toEqual(isoTage(a));
    expect(isoTage(a)).toEqual([
      "2031-01-04",
      "2031-01-06",
      "2031-01-07",
      "2031-01-10",
      "2031-01-11",
    ]);
  });

  it("Eintagesfaelle: Montag ergibt einen Tag, Samstag keinen — mit Aufnahme doch einen", () => {
    expect(isoTage(deriveEffectiveWorkdays(tag("2031-01-06"), tag("2031-01-06")))).toEqual([
      "2031-01-06",
    ]);
    expect(deriveEffectiveWorkdays(tag("2031-01-11"), tag("2031-01-11"))).toEqual([]);
    expect(
      isoTage(
        deriveEffectiveWorkdays(tag("2031-01-11"), tag("2031-01-11"), {
          include: [tag("2031-01-11")],
          exclude: [],
        }),
      ),
    ).toEqual(["2031-01-11"]);
  });

  it("Monats-, Jahres- und Schaltjahresgrenze", () => {
    expect(isoTage(deriveEffectiveWorkdays(tag("2031-01-29"), tag("2031-02-04")))).toEqual([
      "2031-01-29",
      "2031-01-30",
      "2031-01-31",
      "2031-02-03",
      "2031-02-04",
    ]);
    expect(isoTage(deriveEffectiveWorkdays(tag("2027-12-29"), tag("2028-01-04")))).toEqual([
      "2027-12-29",
      "2027-12-30",
      "2027-12-31",
      "2028-01-03",
      "2028-01-04",
    ]);
    expect(isoTage(deriveEffectiveWorkdays(tag("2028-02-28"), tag("2028-03-01")))).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
    // Gegenprobe: im Gemeinjahr 2027 gibt es den 29. Februar nicht.
    expect(isoTage(deriveEffectiveWorkdays(tag("2027-02-26"), tag("2027-03-01")))).toEqual([
      "2027-02-26",
      "2027-03-01",
    ]);
  });

  it("die Sommerzeitwoche aendert die Tagesfolge nicht — es wird kein Zeitpunkt gebildet", () => {
    // In Europe/Berlin faellt am 26.03.2028 eine Stunde aus. Eine Aufzaehlung ueber
    // +24h auf einem Instant kippte hier um einen Tag; diese Rechnung kennt gar
    // keine Zeitpunkte.
    expect(isoTage(deriveEffectiveWorkdays(tag("2028-03-23"), tag("2028-03-30")))).toEqual([
      "2028-03-23",
      "2028-03-24",
      "2028-03-27",
      "2028-03-28",
      "2028-03-29",
      "2028-03-30",
    ]);
  });

  it("verweigert einen vertauschten Zeitraum und einen unwirklichen Tag", () => {
    expect(() => deriveEffectiveWorkdays(tag("2031-01-10"), tag("2031-01-06"))).toThrow(RangeError);
    expect(() => deriveEffectiveWorkdays(tag("2027-02-29"), tag("2027-03-01"))).toThrow(RangeError);
    expect(() => deriveEffectiveWorkdays(tag("0000-01-01"), tag("0000-01-05"))).toThrow(RangeError);
  });
});

describe("Paritaet der Werktagsregel zwischen Vertrag und Domain (EYT-120)", () => {
  /**
   * Beide Fassungen rechnen absichtlich verschieden: der Vertrag ueber UTC-Mitternacht
   * und `getUTCDay`, die Domain ueber `dayAfter` und die Kongruenzformel von Sakamoto.
   * Ohne diesen Test koennten sie auseinanderlaufen und die Oberflaeche andere Tage
   * zeigen, als der Server materialisiert.
   *
   * Gegenmutation: in EINER der beiden Fassungen den Wochentagsbereich verschieben —
   * etwa den Samstag aufnehmen. Dann widersprechen sich die Rechnungen und dieser
   * Test wird rot.
   */
  const ZEITRAEUME: readonly (readonly [string, string])[] = [
    ["2031-01-04", "2031-01-12"], // Wochenende an beiden Raendern
    ["2031-01-06", "2031-01-06"], // ein Montag
    ["2031-01-11", "2031-01-11"], // ein Samstag: leere Menge
    ["2031-01-29", "2031-02-04"], // Monatsgrenze
    ["2027-12-27", "2028-01-05"], // Jahresgrenze
    ["2028-02-24", "2028-03-03"], // Schalttag
    ["2027-02-22", "2027-03-05"], // Gemeinjahr ohne 29. Februar
    ["2028-03-20", "2028-04-02"], // Sommerzeitbeginn Europe/Berlin
    ["2031-10-20", "2031-11-03"], // Sommerzeitende, Monatsgrenze
    ["0001-01-01", "0001-01-31"], // Untergrenze des Jahresbereichs
  ];

  it.each(ZEITRAEUME)("stimmt fuer %s … %s ohne Override ueberein", (von, bis) => {
    expect(isoTage(deriveEffectiveWorkdays(tag(von), tag(bis)))).toEqual(vertragsFassung(von, bis));
  });

  it("stimmt auch mit Aufnahmen und Ausschluessen ueberein", () => {
    const von = "2031-01-04";
    const bis = "2031-01-18";
    const include = ["2031-01-11", "2031-01-04", "2031-01-25"]; // der letzte liegt draussen
    const exclude = ["2031-01-08", "2031-01-14"];
    expect(
      isoTage(
        deriveEffectiveWorkdays(tag(von), tag(bis), {
          include: include.map(tag),
          exclude: exclude.map(tag),
        }),
      ),
    ).toEqual(vertragsFassung(von, bis, { include, exclude }));
  });

  it("ist nicht leerlaufend: die verglichenen Mengen sind nicht ueberall leer", () => {
    // Ohne diese Zeile bliebe die Paritaet auch dann gruen, wenn BEIDE Fassungen
    // nichts mehr lieferten.
    const gesamt = ZEITRAEUME.reduce(
      (summe, [von, bis]) => summe + vertragsFassung(von, bis).length,
      0,
    );
    expect(gesamt).toBeGreaterThan(40);
  });
});

describe("Die aufgehobene Uhrzeit-Semantik des Einsatzes ist weg (D-003)", () => {
  const quelle = readFileSync(
    join(process.cwd(), "src/modules/planning/domain/engagement-range.ts"),
    "utf8",
  );
  const exporte = [...quelle.matchAll(/export (?:function|const|let|class) ([A-Za-z0-9_]+)/g)].map(
    (m) => m[1] ?? "",
  );

  it("das Modul kennt keine Einsatz-Uhrzeitgrenzen mehr", () => {
    // Alle benannten Exportformen, nicht nur `export function`: ein
    // `export const resolveEngagementBounds = () => …` ginge an `/export function/`
    // vorbei (gemessen).
    expect(exporte.length).toBeGreaterThanOrEqual(3);
    for (const verboten of ["resolveEngagementBounds", "workingIntervalWithinBounds"]) {
      expect(exporte, `${verboten} ist wieder da`).not.toContain(verboten);
    }
    // Und die Problemarten, die es ohne Uhrzeitgrenzen nicht geben kann.
    for (const verboten of ["ENGAGEMENT_START_IN_PAST", "ENGAGEMENT_END_NOT_AFTER_START"]) {
      expect(quelle.includes(`"${verboten}"`), `${verboten} wird wieder erzeugt`).toBe(false);
    }
  });

  it("kein stilles Clipping: das Modul exportiert keine Kuerzungs-/Klemmfunktion", () => {
    expect(exporte.some((name) => /clip|clamp|kuerz|trim|adjust/i.test(name))).toBe(false);
  });
});

describe("OPTIONAL geplante Tagesarbeitszeit (D-004)", () => {
  it("wird gegen keine Einsatzgrenze geprueft — es gibt keine Funktion dafuer", () => {
    // Eine Arbeitszeit ueber den ganzen Tag loest genauso auf wie eine kurze; es
    // existiert nichts, wogegen sie verstossen koennte.
    for (const zeit of [
      { from: "00:00", to: "23:59" },
      { from: "08:00", to: "18:00" },
    ]) {
      const r = resolveWorkingInterval("2031-01-06", zeit, berlin);
      expect(r.ok).toBe(true);
    }
  });

  it("eine nicht existente lokale Zeit faellt geschlossen und wird benannt", () => {
    // Europe/Berlin, Sommerzeitbeginn 2028: 02:30 gibt es nicht.
    const r = resolveWorkingInterval("2028-03-26", { from: "02:30", to: "10:00" }, berlin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.kind).toBe("LOCAL_TIME_NONEXISTENT");
    expect(r.problem).toHaveProperty("feld", "workingTime.from@2028-03-26");
  });

  it("eine mehrdeutige lokale Zeit faellt geschlossen und wird benannt", () => {
    // Sommerzeitende 2028 in Europe/Berlin ist der 29.10.; 02:30 gibt es zweimal.
    const r = resolveWorkingInterval("2028-10-29", { from: "01:00", to: "02:30" }, berlin);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.kind).toBe("LOCAL_TIME_AMBIGUOUS");
    expect(r.problem).toHaveProperty("feld", "workingTime.to@2028-10-29");
  });

  it("die Instants entstehen je Tag aus der Wanduhrzeit — keine +24h-Arithmetik", () => {
    const vor = resolveLocalDateTime({ date: "2028-03-25", time: "08:00" }, berlin, "a");
    const nach = resolveLocalDateTime({ date: "2028-03-26", time: "08:00" }, berlin, "b");
    expect(vor.ok && nach.ok).toBe(true);
    if (!vor.ok || !nach.ok) return;
    // Ueber den Sommerzeitbeginn hinweg liegen zwischen 08:00 und 08:00 nur 23 Stunden.
    expect(nach.instant.getTime() - vor.instant.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
