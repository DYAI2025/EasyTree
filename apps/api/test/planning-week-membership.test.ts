/**
 * Gehoert jede Zuweisung in die Woche ihrer Planversion? (EYT-107)
 *
 * ## Warum diese Funktion ueberhaupt existiert
 *
 * `plan_versions.week_key` ist mit KEINEM Zeitstempel seiner Zuweisungen
 * verknuepft. Migration 0007 prueft den Schluessel nur gegen ein Muster, 0011
 * zusaetzlich gegen den Kalender — aber nichts verbindet ihn mit
 * `assignments.starts_at_utc`. Das ist die bekannte Luecke aus EYT-49; sie ist
 * bis heute offen, und `planning-invariants.integration.test.ts` nutzt sie
 * sogar bewusst aus.
 *
 * Solange nur `createAssignment` schreibt, faellt das nicht auf: dieser Pfad
 * vergleicht die Woche selbst (`OUTSIDE_WEEK`). Beim Veroeffentlichen zaehlt
 * aber der GESAMTE Entwurf, auch Zeilen, die auf anderen Wegen entstanden sind
 * — etwa als Kopie der zuletzt veroeffentlichten Version. Ohne diese Pruefung
 * koennte eine Woche mit fachlich fremden Zeiten verbindlich werden, und ein
 * spaeterer Kosten-Snapshot rechnete auf ihnen.
 *
 * ## Warum die Wochenableitung hereingereicht wird
 *
 * Es gibt genau eine Wochenrechnung in diesem Projekt
 * (`@easytree/domain`), und `AppModule` reicht sie bereits in das
 * Schreibrepository hinein. Sie hier erneut zu importieren waere ein zweiter
 * Ableitungspfad — genau der Fehler, den `iso-week-parity.test.ts` bewacht.
 *
 * Gegenmutation, die diese Datei rot macht: in
 * `zuweisungenAusserhalbDerWoche` das Ergebnis fest auf `[]` setzen.
 */
import {
  createTimeZone,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekKey,
} from "@easytree/domain";
import { describe, expect, it } from "vitest";

import { zuweisungenAusserhalbDerWoche } from "../src/modules/planning/domain/week-membership";

/**
 * Dieselbe Ableitung, die `AppModule` produktiv hineinreicht.
 *
 * Bewusst hier nachgebaut statt importiert: der Test soll belegen, dass die
 * Funktion mit der ECHTEN Wochenregel arbeitet, nicht mit einer Attrappe, die
 * zufaellig dasselbe sagt.
 */
const wochenschluessel = (instant: Date, zone: string): string => {
  const geprueft = createTimeZone(zone);
  if (!geprueft.ok) throw new Error(`unbekannte Zeitzone ${zone}`);
  return planningWeekKey(isoWeekOfLocalDate(localBusinessDate(instant, geprueft.timeZone)));
};

const BERLIN = "Europe/Berlin";

describe("zuweisungenAusserhalbDerWoche", () => {
  it("meldet nichts bei einer leeren Liste", () => {
    expect(zuweisungenAusserhalbDerWoche([], "2026-W32", wochenschluessel, BERLIN)).toEqual([]);
  });

  it("laesst eine Zuweisung durch, die in der Woche liegt", () => {
    // Montag der ISO-Woche 32/2026, 06:00 UTC = 08:00 Europe/Berlin.
    const zuweisungen = [{ id: "a1", startsAtUtc: new Date("2026-08-03T06:00:00Z") }];
    expect(
      zuweisungenAusserhalbDerWoche(zuweisungen, "2026-W32", wochenschluessel, BERLIN),
    ).toEqual([]);
  });

  it("meldet eine Zuweisung, die in einer anderen Woche liegt", () => {
    const zuweisungen = [{ id: "a1", startsAtUtc: new Date("2026-08-10T06:00:00Z") }];
    expect(
      zuweisungenAusserhalbDerWoche(zuweisungen, "2026-W32", wochenschluessel, BERLIN),
    ).toEqual([{ id: "a1", tatsaechlicheWoche: "2026-W33" }]);
  });

  it("meldet jede abweichende Zuweisung, nicht nur die erste", () => {
    const zuweisungen = [
      { id: "a1", startsAtUtc: new Date("2026-08-03T06:00:00Z") },
      { id: "a2", startsAtUtc: new Date("2026-08-10T06:00:00Z") },
      { id: "a3", startsAtUtc: new Date("2026-07-27T06:00:00Z") },
    ];
    const abweichend = zuweisungenAusserhalbDerWoche(
      zuweisungen,
      "2026-W32",
      wochenschluessel,
      BERLIN,
    );
    expect(abweichend.map((eintrag) => eintrag.id)).toEqual(["a2", "a3"]);
  });

  it("rechnet in der Zone der Organisation, nicht in UTC", () => {
    // Sonntag 2026-08-09, 23:30 UTC ist in Berlin (UTC+2) bereits Montag
    // 2026-08-10, 01:30 — also Woche 33, obwohl UTC noch Woche 32 sagt.
    // Ohne Zonenbezug waere diese Zeile faelschlich „in der Woche".
    const zuweisungen = [{ id: "grenze", startsAtUtc: new Date("2026-08-09T23:30:00Z") }];

    expect(
      zuweisungenAusserhalbDerWoche(zuweisungen, "2026-W32", wochenschluessel, BERLIN),
    ).toEqual([{ id: "grenze", tatsaechlicheWoche: "2026-W33" }]);

    // Gegenprobe mit einer Zone ohne Versatz: in UTC gehoert derselbe Instant
    // noch zu Woche 32. Ohne diese Zeile bewiese der Fall oben nur, dass
    // irgendetwas gemeldet wird — nicht, dass die ZONE den Ausschlag gibt.
    expect(zuweisungenAusserhalbDerWoche(zuweisungen, "2026-W32", wochenschluessel, "UTC")).toEqual(
      [],
    );
  });

  it("verwendet den BEGINN, nicht das Ende", () => {
    // Eine Schicht, die ueber die Wochengrenze laeuft, gehoert zu der Woche,
    // in der sie beginnt — dieselbe Regel wie `planningWeekOf`.
    const zuweisungen = [{ id: "nacht", startsAtUtc: new Date("2026-08-09T20:00:00Z") }];
    expect(
      zuweisungenAusserhalbDerWoche(zuweisungen, "2026-W32", wochenschluessel, BERLIN),
    ).toEqual([]);
  });
});
