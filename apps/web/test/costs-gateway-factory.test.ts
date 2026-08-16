/**
 * Der Kostenpfad geht durch DIESELBE Fabrik wie die Produktion (EYT-109, Task 16).
 *
 * ## Warum diese Datei existiert
 *
 * `apps/web/test/api-base-path.test.ts` sichert genau diese Eigenschaft — aber
 * nur fuer `planning-gateway-factory`. Fuer Kosten und Auth gab es sie nicht:
 * gemessen am 14.08.2026 nannte KEIN Test `buildCostsApiBaseUrl` oder
 * `buildAuthApiBaseUrl`. Ausgefuehrt wurden beide Fabriken in jedem
 * Browser-e2e-Lauf, weil `app/layout.tsx` `<Providers>` rendert — aber
 * ausgefuehrt ist nicht zugesichert: kein Test sagte etwas ueber die URLs, die
 * dort entstehen.
 *
 * `apps/web/test/kosten-ansicht.test.tsx` baut sich sein `CostsGateway` selbst
 * (Funktion `baue()`). Er bliebe gruen, was immer `providers.tsx` tut — genau
 * der Fehler, den der Kopf von `api-base-path.test.ts` als „Fehler 2" fuer den
 * Planungspfad beschreibt. Hier wird deshalb `createCostsGateway` gerufen, die
 * Funktion, die die Kompositionswurzel wirklich ruft, und verglichen wird gegen
 * das ERZEUGTE Vertragsdokument — eine von `API_BASE_PATH` unabhaengige Quelle.
 *
 * ## Gegenmutationen — eingespielt, gemessen, zurueckgenommen (14.08.2026)
 *
 * | Mutation in `lib/costs-gateway-factory.ts`                           | gemessen                                    |
 * | --------------------------------------------------------------------- | ------------------------------------------- |
 * | `buildCostsApiBaseUrl` gibt `apiOrigin` ohne `API_BASE_PATH` zurueck  | **4 failed / 4 passed** — die vier Pfadfaelle |
 * | `createCostsGateway` reicht `apiOrigin` statt der gebauten URL durch  | **1 failed** — „unter genau diesem Pfad"    |
 * | `createCostsGateway` reicht `() => null` statt des Rueckrufs durch     | **2 failed** — beide Organisationsfaelle    |
 * | `createCostsGateway` friert den Rueckruf beim Bauen einmal ein         | **1 failed** — „bei JEDEM Aufruf neu ab"    |
 *
 * Nach jeder Ruecknahme war `git diff` auf die mutierte Datei leer und der
 * Kontrolllauf 13/13 gruen.
 *
 * Eine Warnung fuer die naechste Person: die erste Mutation wurde per `perl -0pi`
 * versucht. Der Anker verfehlte, die Datei wurde dabei aber zerschossen — der
 * Lauf meldete `Test Files 1 failed, Tests no tests`, also einen Importfehler
 * und KEIN fachliches Rot. Wer nur auf „rot" schaut, haette hier eine
 * Gegenmutation abgehakt, die nie stattgefunden hat. Die Tabelle oben stammt
 * aus wiederholten, vor dem Lauf per `grep` verifizierten Einzeledits.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCostsApiBaseUrl, createCostsGateway } from "../lib/costs-gateway-factory";

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
const ORGANISATION = "00000000-0000-4000-8000-0000000000a1";
const SNAPSHOT_ID = "00000000-0000-4000-8000-0000000000b2";

/** Faehrt das Gateway aus der ECHTEN Fabrik und meldet, was beim fetch ankam. */
async function fahre(organisationId: () => string | null): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  let url = "";
  let headers: Record<string, string> = {};
  const gateway = createCostsGateway(
    API_ORIGIN,
    (eingang, init) => {
      url = String(eingang);
      headers = { ...((init?.headers ?? {}) as Record<string, string>) };
      // 401 statt eines erfundenen Snapshots: der Vertragspfad wird hier
      // gemessen, nicht die Antwortform. Eine ausgedachte gueltige Antwort
      // waere eine zweite, ungepruefte Behauptung ueber das Schema.
      return Promise.resolve(new Response(null, { status: 401 }));
    },
    organisationId,
  );
  const ergebnis = await gateway.snapshot(SNAPSHOT_ID);
  expect(ergebnis.ok).toBe(false);
  return { url, headers };
}

describe("Same-Origin: relative Aufrufe", () => {
  it("baut ohne Origin einen RELATIVEN Pfad", () => {
    // Sonst braeuchte die API CORS und eine zweite oeffentliche Flaeche.
    expect(buildCostsApiBaseUrl("")).toBe(DOCUMENT_BASE_PATH);
    expect(buildCostsApiBaseUrl("").startsWith("http")).toBe(false);
  });
});

describe("Vertragspfad im Produktionscode", () => {
  it("liest ueberhaupt einen Pfad aus dem Dokument — sonst prueft dieser Test nichts", () => {
    expect(DOCUMENT_BASE_PATH.length).toBeGreaterThan(1);
    expect(DOCUMENT_BASE_PATH.startsWith("/")).toBe(true);
  });

  it("baut die Basis-URL aus dem Pfad des Vertragsdokuments", () => {
    expect(buildCostsApiBaseUrl(API_ORIGIN)).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}`);
  });

  it("entfernt einen abschliessenden Slash der Herkunft, statt ihn zu verdoppeln", () => {
    expect(buildCostsApiBaseUrl(`${API_ORIGIN}/`)).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}`);
  });

  it("laesst das erzeugte Gateway unter genau diesem Pfad losfahren", async () => {
    const { url } = await fahre(() => ORGANISATION);
    expect(url).toBe(`${API_ORIGIN}${DOCUMENT_BASE_PATH}/kosten/snapshots/${SNAPSHOT_ID}`);
  });
});

describe("Organisationskontext der Kompositionswurzel", () => {
  it("traegt die Organisation als Kopf, die die Wurzel zum Aufrufzeitpunkt kennt", async () => {
    // Die Wurzel reicht eine FUNKTION durch, keinen Wert (providers.tsx liest
    // eine Ref). Der Kopf muss deshalb aus dem Aufruf stammen, nicht aus dem
    // Zustand beim Bauen des Gateways.
    const { headers } = await fahre(() => ORGANISATION);
    expect(headers["X-EasyTree-Organization-Id"]).toBe(ORGANISATION);
  });

  it("laesst den Kopf WEG, solange die Wurzel noch keine Organisation kennt", async () => {
    // Genau der Zustand, den `providers.tsx` vor dem ersten
    // `onOrganisationChange` hat. Ein leerer String statt eines fehlenden
    // Kopfes waere serverseitig eine andere Frage.
    const { headers } = await fahre(() => null);
    expect(Object.keys(headers)).not.toContain("X-EasyTree-Organization-Id");
  });

  it("fragt die Organisation bei JEDEM Aufruf neu ab", async () => {
    // Wuerde das Gateway den Wert einmal beim Bauen einfrieren, bliebe ein
    // Organisationswechsel in der Oberflaeche ohne Wirkung auf die Anfrage.
    const werte = ["org-1", "org-2"];
    let index = 0;
    const gesehen: (string | undefined)[] = [];
    const gateway = createCostsGateway(
      API_ORIGIN,
      (_eingang, init) => {
        gesehen.push((init?.headers as Record<string, string>)["X-EasyTree-Organization-Id"]);
        return Promise.resolve(new Response(null, { status: 401 }));
      },
      () => werte[index]!,
    );
    await gateway.snapshot(SNAPSHOT_ID);
    index = 1;
    await gateway.snapshot(SNAPSHOT_ID);
    expect(gesehen).toEqual(["org-1", "org-2"]);
  });
});
