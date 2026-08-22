/**
 * Der Start ist die letzte Stelle, an der ein falsches Ziel billig auffaellt
 * (EYT-126).
 *
 * Ohne diese Sperre antworteten nur `/api`, `/health` und `/ready` mit einem
 * Fehler — die Anwendung selbst saehe gesund aus und zeigte im Browser eine
 * leere Woche.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidProxyTargetError } from "../lib/api-proxy-target";
import { register } from "../instrumentation";

const URSPRUNG = { ...process.env };
/**
 * Next deklariert `ProcessEnv.NODE_ENV` als `readonly`, deshalb der Umweg. Die
 * Umgebung MUSS hier echt umgestellt werden: `aktuellesProxyziel()` liest sie
 * selbst, und genau das ist die gemessene Eigenschaft.
 */
function setzeNodeEnv(wert: string): void {
  (process.env as Record<string, string | undefined>)["NODE_ENV"] = wert;
}

beforeEach(() => {
  setzeNodeEnv("production");
});

afterEach(() => {
  process.env = { ...URSPRUNG };
});

describe("register", () => {
  it("wirft in production, wenn das Ziel fehlt", () => {
    delete process.env.EASYTREE_API_PROXY_TARGET;
    expect(() => register()).toThrow(InvalidProxyTargetError);
  });

  it("nennt dabei die Variable, damit das Containerprotokoll brauchbar ist", () => {
    delete process.env.EASYTREE_API_PROXY_TARGET;
    expect(() => register()).toThrow(/EASYTREE_API_PROXY_TARGET/);
  });

  it("wirft in production bei einem ungueltigen Ziel", () => {
    process.env.EASYTREE_API_PROXY_TARGET = "ftp://api.invalid";
    expect(() => register()).toThrow(InvalidProxyTargetError);
  });

  it("wirft bei Zugangsdaten im Ziel", () => {
    process.env.EASYTREE_API_PROXY_TARGET = "http://nutzer:geheim@api.invalid:3001";
    expect(() => register()).toThrow(InvalidProxyTargetError);
  });

  it("laesst ein gueltiges Ziel durch", () => {
    process.env.EASYTREE_API_PROXY_TARGET = "http://api:3001";
    expect(() => register()).not.toThrow();
  });
});
