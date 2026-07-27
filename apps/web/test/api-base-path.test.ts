/**
 * Die Gateway-URL des PRODUKTIONSCODES verwendet den Vertragspfad (EYT-50).
 *
 * ## Zwei Fehler, die diese Datei hinter sich hat
 *
 * 1. Ein Kommentar in `app/providers.tsx` verwies auf genau diesen Test — den
 *    es nicht gab. Erfundene Fundstelle.
 * 2. Der erste echte Entwurf baute sich sein Gateway SELBST zusammen und
 *    verglich `API_BASE_PATH` gegen sich selbst. Er prueft damit weder den
 *    Produktionscode noch etwas Widerlegbares: haette `providers.tsx` eine
 *    voellig andere URL gebaut, waere er gruen geblieben.
 *
 * Jetzt gilt beides nicht mehr: geprueft wird `createPlanningGateway` — die
 * Funktion, die die Kompositionswurzel wirklich aufruft — und verglichen wird
 * gegen das ERZEUGTE Vertragsdokument, eine von der Konstante unabhaengige
 * Quelle.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPlanningApiBaseUrl, createPlanningGateway } from "../lib/planning-gateway-factory";

/** `servers[0].url` aus dem erzeugten Dokument. */
const DOCUMENT_BASE_PATH = (
  JSON.parse(
    readFileSync(
      resolve(__dirname, "..", "..", "..", "packages/contracts/openapi/v1.json"),
      "utf8",
    ),
  ) as { servers: { url: string }[] }
).servers[0]!.url;

const API_ORIGIN = "https://api.example.test";

describe("Same-Origin: relative Aufrufe", () => {
  it("baut ohne Origin einen RELATIVEN Pfad", () => {
    // Der Browser bleibt damit auf der Origin der Web-App; die Weiterleitung
    // macht das Rewrite in next.config.ts. Waere hier eine absolute URL,
    // braeuchte die API CORS.
    expect(buildPlanningApiBaseUrl("")).toBe(DOCUMENT_BASE_PATH);
    expect(buildPlanningApiBaseUrl("").startsWith("http")).toBe(false);
  });
});

describe("Vertragspfad im Produktionscode", () => {
  it("liest ueberhaupt einen Pfad aus dem Dokument — sonst prueft dieser Test nichts", () => {
    expect(DOCUMENT_BASE_PATH.length).toBeGreaterThan(1);
    expect(DOCUMENT_BASE_PATH.startsWith("/")).toBe(true);
  });

  it("baut die Basis-URL aus dem Pfad des Vertragsdokuments", () => {
    expect(buildPlanningApiBaseUrl(API_ORIGIN)).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}`);
  });

  it("entfernt einen abschliessenden Slash der Herkunft, statt ihn zu verdoppeln", () => {
    expect(buildPlanningApiBaseUrl(`${API_ORIGIN}/`)).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}`);
  });

  it("laesst das erzeugte Gateway unter genau diesem Pfad losfahren", async () => {
    // Nicht die Konstante, sondern die URL, die beim fetch ankommt — und das
    // Gateway stammt aus derselben Fabrik, die `providers.tsx` aufruft.
    let seen = "";
    const gateway = createPlanningGateway(API_ORIGIN, (url) => {
      seen = url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            weekKey: "2026-W32",
            timeZone: "Europe/Berlin",
            assignments: [],
            publishedVersionId: null,
            sourceVersion: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    await gateway.getPlanningWindow({ weekKey: "2026-W32" });
    expect(seen).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}/planung/fenster?weekKey=2026-W32`);
  });
});
