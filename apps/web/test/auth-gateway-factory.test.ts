/**
 * Der Auth-Pfad geht durch DIESELBE Fabrik wie die Produktion (EYT-109, Task 16).
 *
 * ## Diese Datei schliesst eine erfundene Fundstelle
 *
 * `apps/web/lib/auth-gateway-factory.ts` behauptete im Dateikopf, „der Test
 * prueft GENAU die Funktion, die die Kompositionswurzel ruft" — und es gab
 * keinen. Das ist wortgleich „Fehler 1" aus dem Kopf von
 * `apps/web/test/api-base-path.test.ts`: dort verwies `providers.tsx` auf einen
 * Test, den es nicht gab. Derselbe Fehler, zwei Jahre spaeter, eine Datei
 * weiter. Gemessen am 14.08.2026 nannte kein Test `buildAuthApiBaseUrl`.
 *
 * Geprueft wird deshalb `createAuthGateway` — die Funktion, die
 * `app/providers.tsx` wirklich ruft — gegen das ERZEUGTE Vertragsdokument, eine
 * von `API_BASE_PATH` unabhaengige Quelle.
 *
 * ## Gegenmutationen — eingespielt, gemessen, zurueckgenommen (14.08.2026)
 *
 * | Mutation in `lib/auth-gateway-factory.ts`                            | gemessen                                    |
 * | -------------------------------------------------------------------- | ------------------------------------------- |
 * | `buildAuthApiBaseUrl` gibt `apiOrigin` ohne `API_BASE_PATH` zurueck  | **4 failed / 1 passed** — die vier Pfadfaelle |
 * | `createAuthGateway` reicht `apiOrigin` statt der gebauten URL durch   | **1 failed** — „unter genau diesem Pfad"    |
 *
 * Nach jeder Ruecknahme war `git diff` auf die mutierte Datei leer.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAuthApiBaseUrl, createAuthGateway } from "../lib/auth-gateway-factory";

/** `servers[0].url` aus dem erzeugten Dokument — nicht die Konstante des Codes. */
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
    expect(buildAuthApiBaseUrl("")).toBe(DOCUMENT_BASE_PATH);
    expect(buildAuthApiBaseUrl("").startsWith("http")).toBe(false);
  });
});

describe("Vertragspfad im Produktionscode", () => {
  it("liest ueberhaupt einen Pfad aus dem Dokument — sonst prueft dieser Test nichts", () => {
    expect(DOCUMENT_BASE_PATH.length).toBeGreaterThan(1);
    expect(DOCUMENT_BASE_PATH.startsWith("/")).toBe(true);
  });

  it("baut die Basis-URL aus dem Pfad des Vertragsdokuments", () => {
    expect(buildAuthApiBaseUrl(API_ORIGIN)).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}`);
  });

  it("entfernt einen abschliessenden Slash der Herkunft, statt ihn zu verdoppeln", () => {
    expect(buildAuthApiBaseUrl(`${API_ORIGIN}/`)).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}`);
  });

  it("laesst das erzeugte Gateway unter genau diesem Pfad losfahren", async () => {
    // Nicht die Konstante, sondern die URL, die beim fetch ankommt — und das
    // Gateway stammt aus derselben Fabrik, die `providers.tsx` aufruft.
    let gesehen = "";
    const gateway = createAuthGateway(API_ORIGIN, (eingang) => {
      gesehen = String(eingang);
      return Promise.resolve(new Response(null, { status: 401 }));
    });
    const ergebnis = await gateway.session();
    expect(ergebnis.ok).toBe(false);
    expect(gesehen).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}/auth/session`);
  });
});
