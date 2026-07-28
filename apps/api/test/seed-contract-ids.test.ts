/**
 * Der Standardseed haelt den Transportvertrag ein (EYT-91 AK4).
 *
 * ## Warum dieser Test existiert
 *
 * `supabase/seed.sql` verwendete IDs der Form `00000000-0000-0000-0000-…`.
 * PostgreSQL nimmt sie als `uuid` an, `IdSchema` nicht: das Versions-Nibble war
 * `0` statt `4`. Jede Route, die eine geseedete `employees`- oder
 * `worksites`-ID zurueckgab, antwortete daraufhin mit HTTP 500 — nicht als
 * kaputte Antwort, sondern als sauberer Serverfehler, weil der Controller seine
 * eigene Ausgabe gegen den Vertrag prueft.
 *
 * Der Befund fiel im Read-Through-Harness auf, und das Harness half sich mit
 * eigenen v4-Fixtures. Das war eine Umgehung, kein Fix: der Standardseed blieb
 * kaputt, und nichts machte das sichtbar. Dieser Test ist die fehlende
 * Sichtbarkeit.
 *
 * ## Gegenmutation
 *
 * Setze in `supabase/seed.sql` eine einzelne ID zurueck auf ein Versions-Nibble
 * ungleich `4` — etwa `00000000-0000-0000-0000-0000004010a1` zurueck auf
 * `00000000-0000-0000-0000-0000004010a1`. Dann wird dieser Test rot und nennt
 * die betroffene ID. Ohne diese Antwort waere er nur Ausfuehrungsevidenz.
 *
 * ## Warum der Test die Datei liest statt die Datenbank zu fragen
 *
 * Er soll ohne laufenden Supabase-Stack greifen. Ein Vertragsverstoss im Seed
 * ist eine Eigenschaft des Textes, nicht des Servers; ihn erst in `db-gates`
 * zu bemerken, verschiebt die Rueckmeldung um einen kompletten CI-Lauf. Die
 * Datenbankhaelfte (zwei Resets, pgTAP) bleibt davon unberuehrt und laeuft
 * weiterhin dort.
 *
 * ## Zur Null-UUID
 *
 * `00000000-0000-0000-0000-000000000000` steht im Seed dreimal — ausschliesslich
 * als `auth.users.instance_id`. Das ist GoTrues eigener Sentinel fuer "keine
 * Instanz" in einer Spalte, die uns nicht gehoert, die keine Route liest und die
 * kein Vertrag validiert. Sie bleibt bewusst unveraendert. `IdSchema` akzeptiert
 * sie ohnehin (RFC 9562 kennt die Nil-UUID), sie ist also auch kein stiller
 * Durchschluepfer.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { IdSchema } from "@easytree/contracts";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const seedPfad = resolve(repoRoot, "supabase", "seed.sql");
const seed = readFileSync(seedPfad, "utf8");

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const ids = [...new Set(seed.match(UUID) ?? [])];

describe("supabase/seed.sql erfuellt den Transportvertrag", () => {
  it("enthaelt ueberhaupt IDs — sonst misst dieser Test nichts", () => {
    // Nicht-Leerlauf-Bremse: ein umbenannter Seed, ein kaputter Pfad oder ein
    // geaendertes ID-Format wuerden die Liste leeren, und alle folgenden
    // Zusicherungen waeren stillschweigend erfuellt.
    expect(ids.length).toBeGreaterThanOrEqual(20);
  });

  it("jede ID besteht IdSchema", () => {
    const verstoesse = ids.filter((id) => !IdSchema.safeParse(id).success);
    expect(verstoesse).toEqual([]);
  });

  it("eine geseedete employeeId und eine worksiteId bestehen den Vertrag", () => {
    // EYT-91 AK4 woertlich: ohne diesen Fall waere der Befund nur verschoben.
    // Die beiden Praefixe stammen aus dem eingefrorenen ID-Katalog
    // (docs/plans/2026-07-28-eyt-91-id-katalog.md): 40… ist eine Beschaeftigte,
    // 50… eine Baustelle.
    const employee = ids.find((id) => id.endsWith("0000004010a1"));
    const worksite = ids.find((id) => id.endsWith("0000005010a1"));

    expect(employee, "geseedete employeeId nicht gefunden").toBeDefined();
    expect(worksite, "geseedete worksiteId nicht gefunden").toBeDefined();
    expect(IdSchema.safeParse(employee).success).toBe(true);
    expect(IdSchema.safeParse(worksite).success).toBe(true);
  });

  it("die Nil-UUID kommt nur als auth.users.instance_id vor", () => {
    // Sie ist kein Fixture und darf nicht in eine Fachtabelle wandern. Taucht
    // sie in einer anderen Zeile auf, ist das entweder ein versehentlicher
    // Platzhalter oder eine Abwesenheit, die als Entitaet maskiert wird.
    const zeilen = seed
      .split("\n")
      .filter((z) => z.includes("00000000-0000-0000-0000-000000000000"));

    expect(zeilen.length).toBeGreaterThan(0);
    for (const zeile of zeilen) {
      expect(zeile).toMatch(/'00000000-0000-0000-0000-000000000000',\s*'[0-9a-f-]+'/);
    }
  });
});
