/**
 * Die Routen selbst sind der Nachweis (EYT-126).
 *
 * Ein Test, der nur `durchreichen` prueft, bliebe gruen, wenn eine der drei
 * Routen fehlte oder eine Methode nicht exportiert waere — und genau das waere
 * im Browser ein 404 auf `/ready` statt eines Fehlers.
 */
import { describe, expect, it } from "vitest";

import * as apiRoute from "../app/api/[[...pfad]]/route";
import * as healthRoute from "../app/health/route";
import * as readyRoute from "../app/ready/route";
import { durchreichen } from "../lib/proxy-durchreichen";

describe("Proxyrouten", () => {
  it("reicht /api mit allen Methoden an dieselbe Durchreiche", () => {
    for (const methode of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      expect(apiRoute[methode as keyof typeof apiRoute]).toBe(durchreichen);
    }
  });

  it("reicht /health und /ready lesend an dieselbe Durchreiche", () => {
    expect(healthRoute.GET).toBe(durchreichen);
    expect(healthRoute.HEAD).toBe(durchreichen);
    expect(readyRoute.GET).toBe(durchreichen);
    expect(readyRoute.HEAD).toBe(durchreichen);
  });

  it("erzwingt dynamisches Rendern — sonst waere das Ziel wieder eingebacken", () => {
    expect(apiRoute.dynamic).toBe("force-dynamic");
    expect(healthRoute.dynamic).toBe("force-dynamic");
    expect(readyRoute.dynamic).toBe("force-dynamic");
  });
});
