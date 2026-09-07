// apps/api/test/planning-engagement-range.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTimeZone } from "@easytree/domain";
import { describe, expect, it } from "vitest";
import {
  resolveEngagementBounds,
  resolveWorkingInterval,
  workingIntervalWithinBounds,
} from "../src/modules/planning";

const berlin = (() => {
  const z = createTimeZone("Europe/Berlin");
  if (!z.ok) throw new Error("Zone");
  return z.timeZone;
})();

/** Letzter Sonntag eines Monats — EU-Sommerzeitwechsel, jahresunabhaengig. */
function letzterSonntag(jahr: number, monat: number): string {
  const d = new Date(Date.UTC(jahr, monat, 0)); // letzter Tag des Monats (monat 1-basiert)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
const JAHR = new Date().getUTCFullYear() + 1;
const DST_BEGINN = letzterSonntag(JAHR, 3);
const DST_ENDE = letzterSonntag(JAHR, 10);
const JETZT = new Date(`${JAHR - 1}-12-01T10:00:00.000Z`);

describe("resolveEngagementBounds (EYT-120)", () => {
  it("8 lehnt einen Beginn vor dem serverautoritativen Jetzt ab", () => {
    const r = resolveEngagementBounds(
      { startAt: { date: `${JAHR - 1}-12-01`, time: "10:59" }, endAt: null },
      berlin,
      JETZT,
    );
    expect(r).toEqual({ ok: false, problem: { kind: "ENGAGEMENT_START_IN_PAST" } });
  });
  it("9 akzeptiert denselben Tag ab jetzt (Gleichheit) und spaeter", () => {
    const gleich = resolveEngagementBounds(
      { startAt: { date: `${JAHR - 1}-12-01`, time: "11:00" }, endAt: null },
      berlin,
      JETZT,
    );
    expect(gleich.ok).toBe(true);
    const spaeter = resolveEngagementBounds(
      { startAt: { date: `${JAHR - 1}-12-01`, time: "11:01" }, endAt: null },
      berlin,
      JETZT,
    );
    expect(spaeter.ok).toBe(true);
  });
  it("10 nicht existente lokale Startzeit (Sommerzeitbeginn 02:30) faellt geschlossen", () => {
    const r = resolveEngagementBounds(
      { startAt: { date: DST_BEGINN, time: "02:30" }, endAt: null },
      berlin,
      JETZT,
    );
    expect(r).toEqual({ ok: false, problem: { kind: "LOCAL_TIME_NONEXISTENT", feld: "startAt" } });
  });
  it("11 mehrdeutige lokale Start-/Endzeit (Sommerzeitende 02:30) faellt geschlossen", () => {
    expect(
      resolveEngagementBounds(
        { startAt: { date: DST_ENDE, time: "02:30" }, endAt: null },
        berlin,
        JETZT,
      ),
    ).toEqual({ ok: false, problem: { kind: "LOCAL_TIME_AMBIGUOUS", feld: "startAt" } });
    expect(
      resolveEngagementBounds(
        { startAt: { date: DST_ENDE, time: "01:00" }, endAt: { date: DST_ENDE, time: "02:30" } },
        berlin,
        JETZT,
      ),
    ).toEqual({ ok: false, problem: { kind: "LOCAL_TIME_AMBIGUOUS", feld: "endAt" } });
  });
  it("bekanntes Ende nach Beginn — auch nach der Aufloesung als Instants", () => {
    const r = resolveEngagementBounds(
      {
        startAt: { date: `${JAHR}-01-06`, time: "07:00" },
        endAt: { date: `${JAHR}-01-06`, time: "07:00" },
      },
      berlin,
      JETZT,
    );
    expect(r).toEqual({ ok: false, problem: { kind: "ENGAGEMENT_END_NOT_AFTER_START" } });
  });
});

describe("Tagesarbeitszeit innerhalb der Einsatzgrenzen (D-009)", () => {
  const grenzen = {
    startsAtUtc: new Date(`${JAHR}-01-06T09:00:00.000Z`),
    endsAtUtc: new Date(`${JAHR}-01-08T14:00:00.000Z`),
  }; // 10:00–15:00 Berlin
  const intervall = (tag: string, from: string, to: string) => {
    const r = resolveWorkingInterval(tag, { from, to }, berlin);
    if (!r.ok) throw new Error(r.problem.kind);
    return r.interval;
  };
  it("13 Arbeitszeit vor dem Einsatzbeginn wird abgelehnt", () => {
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-06`, "08:00", "18:00"), grenzen)).toBe(
      false,
    );
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-06`, "10:00", "18:00"), grenzen)).toBe(
      true,
    );
  });
  it("14 Arbeitszeit nach dem bekannten Ende wird abgelehnt", () => {
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-08`, "08:00", "18:00"), grenzen)).toBe(
      false,
    );
    expect(workingIntervalWithinBounds(intervall(`${JAHR}-01-08`, "08:00", "15:00"), grenzen)).toBe(
      true,
    );
  });
  it("15 ohne Ende gibt es keine kuenstliche Endgrenze, die Startgrenze gilt weiter", () => {
    const ohneEnde = { startsAtUtc: grenzen.startsAtUtc, endsAtUtc: null };
    expect(
      workingIntervalWithinBounds(intervall(`${JAHR}-12-31`, "08:00", "23:59"), ohneEnde),
    ).toBe(true);
    expect(
      workingIntervalWithinBounds(intervall(`${JAHR}-01-06`, "09:00", "18:00"), ohneEnde),
    ).toBe(false);
  });
  it("12 die Instants entstehen aus der Wanduhrzeit je Tag — ueber die Sommerzeitgrenze hinweg keine +24h-Arithmetik", () => {
    const vortag = `${DST_BEGINN.slice(0, 8)}${String(Number(DST_BEGINN.slice(8)) - 1).padStart(2, "0")}`;
    const vor = intervall(vortag, "08:00", "18:00");
    const nach = intervall(DST_BEGINN, "08:00", "18:00");
    expect(nach.start.getTime() - vor.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
  it("16 kein stilles Clipping: das Modul exportiert keine Kuerzungs-/Klemmfunktion (Namensheuristik ueber alle Exportformen)", () => {
    const quelle = readFileSync(
      join(process.cwd(), "src/modules/planning/domain/engagement-range.ts"),
      "utf8",
    );
    // Alle benannten Exportformen, nicht nur `export function`: ein
    // `export const clampEnd = () => …` ging an `/export function/` vorbei (gemessen).
    const exporte = [
      ...quelle.matchAll(/export (?:function|const|let|class) ([A-Za-z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(exporte.length).toBeGreaterThanOrEqual(4);
    expect(exporte.some((name) => /clip|clamp|kuerz|trim|adjust/i.test(name ?? ""))).toBe(false);
  });
});
