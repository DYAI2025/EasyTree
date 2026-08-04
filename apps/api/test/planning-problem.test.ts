/**
 * Die stabilen Fehlercodes der Planung (EYT-92, EYT-107).
 *
 * ## Warum dieser Test ueberhaupt existiert
 *
 * `PLANNING_ERROR_TYPE` ist Teil des Vertrags: die Oberflaeche verzweigt auf
 * `problem.type`, weil der HTTP-Status es nicht kann — vier fachlich
 * verschiedene Publish-Ablehnungen sind alle 409, und der Client bildet 409
 * pauschal auf `STALE_VERSION` ab (`packages/contracts/src/http/planning-gateway.ts`).
 * Ohne den `type` waeren „veraltete Version", „bereits veroeffentlicht",
 * „blockierender Konflikt" und „Zuweisung ausserhalb der Woche" fuer die
 * Oberflaeche ein und derselbe Zustand.
 *
 * Der Test prueft deshalb drei Eigenschaften, nicht nur die Existenz der Werte:
 *
 *   1. Jeder Code traegt das gemeinsame Praefix und ist eindeutig — ein
 *      versehentlich doppelt vergebener Wert waere zur Laufzeit unauffaellig
 *      und im Client nicht unterscheidbar.
 *   2. Der Filter gibt einen bekannten Code UNVERAENDERT heraus. Ein Filter,
 *      der `type` auf `about:blank` normalisiert, macht die ganze Liste
 *      wirkungslos.
 *   3. Der Filter gibt einen UNBEKANNTEN Code NICHT heraus. Das ist die
 *      Gegenrichtung: die Ausnahme koennte Verbindungsdaten tragen, und ein
 *      durchgereichter Fremdtyp waere ein Leck.
 *
 * Gegenmutation, die diesen Test rot macht: im Filter `fachlich?.type` durch
 * `"about:blank"` ersetzen (Punkt 2 faellt) oder `BEKANNTE_TYPEN` auf
 * `has: () => true` aufweiten (Punkt 3 faellt).
 */
import { BadRequestException, ConflictException, HttpException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  PLANNING_ERROR_TYPE,
  PlanningProblemFilter,
} from "../src/modules/planning/interface/http/planning-problem.filter";

/** Die vier Codes, die EYT-107 hinzufuegt. Namentlich, nicht per Zaehlung. */
const PUBLISH_CODES = [
  "STALE_VERSION",
  "ALREADY_PUBLISHED",
  "BLOCKING_CONFLICT",
  "ASSIGNMENT_OUTSIDE_WEEK",
] as const;

/**
 * Minimaler `ArgumentsHost` mit aufzeichnender Antwort.
 *
 * Bewusst kein Nest-Testserver: geprueft wird der Filter, nicht das Routing.
 */
function hostMit(): {
  host: ArgumentsHost;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ correlationId: "korrelation-1" }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe("PLANNING_ERROR_TYPE (EYT-107)", () => {
  it.each(PUBLISH_CODES)("kennt den Publish-Code %s", (code) => {
    expect(PLANNING_ERROR_TYPE[code]).toBeTypeOf("string");
  });

  it("vergibt jeden Code genau einmal", () => {
    const werte = Object.values(PLANNING_ERROR_TYPE);
    expect(new Set(werte).size).toBe(werte.length);
  });

  it("praefixiert jeden Code einheitlich", () => {
    for (const wert of Object.values(PLANNING_ERROR_TYPE)) {
      expect(wert.startsWith("urn:easytree:planning:")).toBe(true);
    }
  });
});

describe("PlanningProblemFilter", () => {
  it.each(PUBLISH_CODES)("reicht den bekannten Code %s unveraendert heraus", (code) => {
    const { host, status, json } = hostMit();
    new PlanningProblemFilter().catch(
      new ConflictException({
        type: PLANNING_ERROR_TYPE[code],
        title: "Titel",
        detail: "Erklaerung fuer die Planerin.",
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PLANNING_ERROR_TYPE[code],
        title: "Titel",
        detail: "Erklaerung fuer die Planerin.",
        status: 409,
        correlationId: "korrelation-1",
      }),
    );
  });

  it("gibt einen UNBEKANNTEN type nicht heraus", () => {
    const { host, json } = hostMit();
    new PlanningProblemFilter().catch(
      new BadRequestException({
        type: "urn:easytree:planning:frei-erfunden",
        title: "Titel",
        detail: "postgresql://benutzer:geheim@host/db",
      }),
      host,
    );

    const [koerper] = json.mock.calls[0] as [Record<string, unknown>];
    expect(koerper["type"]).toBe("about:blank");
    expect(JSON.stringify(koerper)).not.toContain("geheim");
  });

  it("verraet bei einem Nicht-HTTP-Fehler nichts ueber die Ursache", () => {
    const { host, status, json } = hostMit();
    new PlanningProblemFilter().catch(new Error("connect ECONNREFUSED 10.0.0.5:5432"), host);

    expect(status).toHaveBeenCalledWith(500);
    const [koerper] = json.mock.calls[0] as [Record<string, unknown>];
    expect(JSON.stringify(koerper)).not.toContain("10.0.0.5");
  });

  it("behandelt eine HttpException ohne Planungscode generisch", () => {
    const { host, json } = hostMit();
    new PlanningProblemFilter().catch(new HttpException("Kaputt", 418), host);

    const [koerper] = json.mock.calls[0] as [Record<string, unknown>];
    expect(koerper["type"]).toBe("about:blank");
    expect(koerper["status"]).toBe(418);
  });
});
