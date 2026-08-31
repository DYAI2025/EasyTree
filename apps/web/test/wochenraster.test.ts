/**
 * Wochenraster der Dispositionswerkbank (EYT-147 Slice 1).
 *
 * Feste Wochen, feste Zeitpunkte — kein `new Date()` ohne Argument. Die
 * tragenden Zusicherungen:
 *
 * - Der Kalendertag eines Einsatzes folgt der ZONE der Organisation, nicht dem
 *   UTC-Datum. Gegenmutation: in `wochenraster` den Beginn per
 *   `startUtc.slice(0, 10)` einem Tag zuordnen → „22:30 UTC ist schon der
 *   Folgetag in Berlin" geht rot.
 * - Kein Einsatz verschwindet: was nicht in die Woche fällt, steht in
 *   `ausserhalb`. Gegenmutation: den `ausserhalb`-Zweig zu `continue` machen →
 *   die Zählzusicherung geht rot.
 * - Die Tagessortierung hängt am BEGINN, nicht an der Id: die Fixtures
 *   widersprechen der Id-Reihenfolge absichtlich (Sortierschlüssel dürfen
 *   nicht vom einverstandenen Tiebreak maskiert werden).
 */
import { describe, expect, it } from "vitest";

import type { AssignmentDto } from "@easytree/contracts";

import { wochenraster, zeitText } from "../lib/wochenraster";

const ZONE = "Europe/Berlin";

function einsatz(id: string, startUtc: string, endUtc: string): AssignmentDto {
  return {
    id,
    employeeId: "33333333-3333-4333-8333-333333333333",
    worksiteId: "44444444-4444-4444-8444-444444444444",
    interval: { startUtc, endUtc },
  } as AssignmentDto;
}

describe("wochenraster", () => {
  it("legt die Woche 2026-W36 als Montag 31.08. bis Sonntag 06.09. aus", () => {
    const raster = wochenraster({ weekKey: "2026-W36", timeZone: ZONE, assignments: [] });
    if (raster.art !== "raster") throw new Error(`unerwartet: ${raster.art}`);

    expect(raster.tage).toHaveLength(7);
    expect(raster.tage.map((t) => t.wochentagsText)).toEqual([
      "Montag",
      "Dienstag",
      "Mittwoch",
      "Donnerstag",
      "Freitag",
      "Samstag",
      "Sonntag",
    ]);
    expect(raster.tage[0]?.datumsText).toBe("31.08.");
    expect(raster.tage[0]?.tagKey).toBe("2026-08-31");
    expect(raster.tage[6]?.datumsText).toBe("06.09.");
    expect(raster.tage[6]?.tagKey).toBe("2026-09-06");
    expect(raster.ausserhalb).toHaveLength(0);
  });

  it("überquert die Jahresgrenze: 2026-W53 endet am 03.01.2027", () => {
    const raster = wochenraster({ weekKey: "2026-W53", timeZone: ZONE, assignments: [] });
    if (raster.art !== "raster") throw new Error(`unerwartet: ${raster.art}`);
    expect(raster.tage[0]?.tagKey).toBe("2026-12-28");
    expect(raster.tage[6]?.tagKey).toBe("2027-01-03");
  });

  it("ordnet einen Einsatz dem Kalendertag seines Beginns in der Organisationszone zu", () => {
    // 22:30 UTC am 31.08. ist in Berlin bereits der 01.09., 00:30 — der
    // Einsatz gehört auf den DIENSTAG. Eine UTC-Datumszuordnung legte ihn auf
    // den Montag.
    const nachtbeginn = einsatz(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "2026-08-31T22:30:00.000Z",
      "2026-09-01T04:00:00.000Z",
    );
    const raster = wochenraster({
      weekKey: "2026-W36",
      timeZone: ZONE,
      assignments: [nachtbeginn],
    });
    if (raster.art !== "raster") throw new Error(`unerwartet: ${raster.art}`);
    expect(raster.tage[0]?.einsaetze).toHaveLength(0);
    expect(raster.tage[1]?.einsaetze.map((e) => e.id)).toEqual([nachtbeginn.id]);
  });

  it("hält eine Nachtschicht am Tag ihres Beginns — dieselbe Regel wie planningWeekOf", () => {
    // Freitag 20:00 Berlin bis Samstag 04:00 Berlin: die Karte steht am Freitag.
    const nachtschicht = einsatz(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "2026-09-04T18:00:00.000Z",
      "2026-09-05T02:00:00.000Z",
    );
    const raster = wochenraster({
      weekKey: "2026-W36",
      timeZone: ZONE,
      assignments: [nachtschicht],
    });
    if (raster.art !== "raster") throw new Error(`unerwartet: ${raster.art}`);
    expect(raster.tage[4]?.einsaetze.map((e) => e.id)).toEqual([nachtschicht.id]);
    expect(raster.tage[5]?.einsaetze).toHaveLength(0);
  });

  it("sortiert einen Tag nach Beginn — gegen die Id-Reihenfolge", () => {
    // Die Ids sind absichtlich GEGENLÄUFIG zum Beginn: bestünde die Sortierung
    // aus dem Id-Tiebreak allein, wäre die Reihenfolge genau falsch.
    const spaet = einsatz(
      "11111111-0000-4000-8000-000000000001",
      "2026-09-02T12:00:00.000Z",
      "2026-09-02T14:00:00.000Z",
    );
    const frueh = einsatz(
      "99999999-0000-4000-8000-000000000009",
      "2026-09-02T06:00:00.000Z",
      "2026-09-02T08:00:00.000Z",
    );
    const raster = wochenraster({
      weekKey: "2026-W36",
      timeZone: ZONE,
      assignments: [spaet, frueh],
    });
    if (raster.art !== "raster") throw new Error(`unerwartet: ${raster.art}`);
    expect(raster.tage[2]?.einsaetze.map((e) => e.id)).toEqual([frueh.id, spaet.id]);
  });

  it("verschluckt keinen Einsatz ausserhalb der Woche — er steht sichtbar in ausserhalb", () => {
    const fremd = einsatz(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "2026-09-14T06:00:00.000Z",
      "2026-09-14T14:00:00.000Z",
    );
    const eigen = einsatz(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "2026-09-01T06:00:00.000Z",
      "2026-09-01T14:00:00.000Z",
    );
    const raster = wochenraster({
      weekKey: "2026-W36",
      timeZone: ZONE,
      assignments: [fremd, eigen],
    });
    if (raster.art !== "raster") throw new Error(`unerwartet: ${raster.art}`);
    expect(raster.ausserhalb.map((e) => e.id)).toEqual([fremd.id]);
    const verteilt = raster.tage.reduce((summe, tag) => summe + tag.einsaetze.length, 0);
    expect(verteilt + raster.ausserhalb.length).toBe(2);
  });

  it("meldet eine unbekannte Zone als unbestimmbar statt ein leeres Raster zu liefern", () => {
    const raster = wochenraster({
      weekKey: "2026-W36",
      timeZone: "Nicht/Vorhanden",
      assignments: [],
    });
    expect(raster).toEqual({ art: "unbestimmbar", grund: "zone-unbekannt" });
  });

  it("meldet einen unlesbaren Wochenschlüssel als unbestimmbar", () => {
    const raster = wochenraster({ weekKey: "keine-woche", timeZone: ZONE, assignments: [] });
    expect(raster).toEqual({ art: "unbestimmbar", grund: "woche-unlesbar" });
  });

  it("ordnet in der DST-Endwoche den Umstellungssonntag korrekt zu", () => {
    // 2026-W43: 19.10.–25.10.2026; am Sonntag, 25.10., endet die Sommerzeit.
    // 00:30 UTC ist 02:30 CEST — noch Sonntag; die Karte steht am Sonntag.
    const umstellung = einsatz(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T06:00:00.000Z",
    );
    const raster = wochenraster({
      weekKey: "2026-W43",
      timeZone: ZONE,
      assignments: [umstellung],
    });
    if (raster.art !== "raster") throw new Error(`unerwartet: ${raster.art}`);
    expect(raster.tage[6]?.tagKey).toBe("2026-10-25");
    expect(raster.tage[6]?.einsaetze.map((e) => e.id)).toEqual([umstellung.id]);
  });
});

describe("zeitText", () => {
  it("formatiert einen UTC-Zeitpunkt als Berliner Wanduhrzeit", () => {
    expect(zeitText("2026-09-01T06:00:00.000Z", ZONE)).toBe("08:00");
  });

  it("formatiert Winterzeit mit dem Winter-Versatz", () => {
    expect(zeitText("2026-12-01T06:00:00.000Z", ZONE)).toBe("07:00");
  });

  it("gibt einen unlesbaren Zeitpunkt roh zurück statt zu raten", () => {
    expect(zeitText("keine-zeit", ZONE)).toBe("keine-zeit");
  });

  it("gibt bei unbekannter Zone den Rohwert zurück", () => {
    expect(zeitText("2026-09-01T06:00:00.000Z", "Nicht/Vorhanden")).toBe(
      "2026-09-01T06:00:00.000Z",
    );
  });
});
