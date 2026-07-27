/**
 * Die Gateway-URL verwendet den Vertragspfad (EYT-50).
 *
 * ## Warum es diese Datei gibt
 *
 * In `app/providers.tsx` stand eine lokale Kopie `"/api/v1"` samt Kommentar,
 * der behauptete, genau dieser Test pruefe die Uebereinstimmung. Den Test gab
 * es nicht. Die Kopie und der Vertrag konnten also auseinanderlaufen, ohne dass
 * irgendetwas rot wurde — dieselbe Falle, aus der `/api/v1` serverseitig
 * ueberhaupt nicht existierte.
 *
 * Jetzt importiert die Kompositionswurzel `API_BASE_PATH` aus
 * `@easytree/contracts`, und dieser Test misst, dass die tatsaechlich
 * aufgerufene URL ihn enthaelt. Gemessen wird an der URL, die beim `fetch`
 * ankommt — nicht an einer Konstante, die man daneben halten koennte.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { API_BASE_PATH, HttpPlanningGateway } from "@easytree/contracts";
import { describe, expect, it } from "vitest";

/**
 * Der Pfad aus dem ERZEUGTEN Vertragsdokument — eine von `API_BASE_PATH`
 * unabhaengige Quelle.
 *
 * Ohne sie waere die Hauptzusicherung tautologisch: `API_BASE_PATH` auf
 * beiden Seiten eines Vergleichs kann nicht auseinanderlaufen. Genau das ist
 * beim ersten Entwurf dieser Datei passiert — die Gegenprobe mit geaendertem
 * Vertragspfad liess den Test gruen.
 */
const DOCUMENT_BASE_PATH = (
  JSON.parse(
    readFileSync(
      resolve(__dirname, "..", "..", "..", "packages/contracts/openapi/v1.json"),
      "utf8",
    ),
  ) as { servers: { url: string }[] }
).servers[0]!.url;

const API_ORIGIN = "https://api.example.test";

/** Fängt die URL ab, mit der das Gateway wirklich losläuft. */
async function calledUrl(): Promise<string> {
  let seen = "";
  const gateway = new HttpPlanningGateway({
    baseUrl: `${API_ORIGIN}${API_BASE_PATH}`,
    fetchImpl: (url) => {
      seen = url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            weekKey: "2026-W32",
            timeZone: "Europe/Berlin",
            assignments: [],
            publishedVersionId: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  });
  await gateway.getPlanningWindow({ weekKey: "2026-W32" });
  return seen;
}

describe("Vertragspfad im Web", () => {
  it("liefert ueberhaupt einen Pfad — sonst prueft dieser Test nichts", () => {
    expect(DOCUMENT_BASE_PATH.length).toBeGreaterThan(1);
    expect(DOCUMENT_BASE_PATH.startsWith("/")).toBe(true);
  });

  it("ruft unter dem Pfad des Vertragsdokuments auf", async () => {
    // Verglichen wird gegen das DOKUMENT, nicht gegen dieselbe Konstante, die
    // der Client benutzt. Sonst waere die Zusicherung nicht widerlegbar.
    const url = await calledUrl();
    expect(url).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}/planung/fenster?weekKey=2026-W32`);
  });

  it("wuerde eine abweichende Kopie bemerken", async () => {
    // Die Gegenprobe zur eigentlichen Aussage: waere der Pfad im Web eine
    // eigene Zeichenkette, entspraeche die URL ihr statt dem Vertrag. Genau
    // diesen Unterschied misst der Test oben — hier wird belegt, dass er ihn
    // ueberhaupt sehen KANN.
    const url = await calledUrl();
    expect(url).not.toContain("/api/v2");
    expect(url).not.toContain("/api/v1/api/v1");
    expect(url.split("/planung/")[0]).toBe(`${API_ORIGIN}${API_BASE_PATH}`);
  });
});
