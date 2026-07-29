/**
 * Das Proxyziel wird geprueft, nicht geglaubt (EYT-50).
 *
 * Ein Tippfehler hier erzeugt keinen sichtbaren Fehler, sondern eine
 * Weiterleitung ins Leere — und die sieht im Browser aus wie eine leere Woche.
 * Genau die Verwechslung, die der Slice ausschliessen soll.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_PROXY_TARGET,
  InvalidProxyTargetError,
  normalizeProxyTarget,
} from "../lib/api-proxy-target";

describe("normalizeProxyTarget", () => {
  it("nimmt den dokumentierten Standard in development und test", () => {
    expect(normalizeProxyTarget(undefined, "test")).toBe(DEFAULT_API_PROXY_TARGET);
    expect(normalizeProxyTarget("", "development")).toBe(DEFAULT_API_PROXY_TARGET);
    expect(normalizeProxyTarget("   ", "development")).toBe(DEFAULT_API_PROXY_TARGET);
  });

  it("bricht in production ohne Wert ab", () => {
    // Fail-closed: ein Proxy auf localhost, waehrend die API woanders laeuft,
    // erzeugt keinen Fehler beim Bauen — sondern eine Weiterleitung ins Leere,
    // die im Browser wie eine leere Woche aussieht.
    expect(() => normalizeProxyTarget(undefined, "production")).toThrow(InvalidProxyTargetError);
    expect(() => normalizeProxyTarget("", "production")).toThrow(InvalidProxyTargetError);
  });

  it("lehnt Zugangsdaten in der Ziel-URL ab", () => {
    // Sie landen sonst in Konfiguration, Logs und Fehlermeldungen.
    expect(() => normalizeProxyTarget("http://nutzer:geheim@127.0.0.1:3001")).toThrow(
      InvalidProxyTargetError,
    );
    expect(() => normalizeProxyTarget("http://nutzer@127.0.0.1:3001")).toThrow(
      InvalidProxyTargetError,
    );
  });

  it("laesst eine absolute http- oder https-URL durch", () => {
    expect(normalizeProxyTarget("http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(normalizeProxyTarget("https://api.example.org")).toBe("https://api.example.org");
  });

  it("entfernt abschliessende Slashes", () => {
    // `//api/...` ist ein anderer Pfad als `/api/...`.
    expect(normalizeProxyTarget("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001");
    expect(normalizeProxyTarget("http://127.0.0.1:3001///")).toBe("http://127.0.0.1:3001");
  });

  it("behaelt einen Basispfad des Ziels", () => {
    expect(normalizeProxyTarget("https://gateway.example.org/easytree/")).toBe(
      "https://gateway.example.org/easytree",
    );
  });

  it.each([
    ["relativ", "/api"],
    ["ohne Schema", "127.0.0.1:3001"],
    ["falsches Schema", "ftp://127.0.0.1:3001"],
    ["mit Querystring", "http://127.0.0.1:3001?x=1"],
    ["mit Fragment", "http://127.0.0.1:3001#frag"],
  ])("lehnt ein %s Ziel ab", (_name, wert) => {
    expect(() => normalizeProxyTarget(wert)).toThrow(InvalidProxyTargetError);
  });
});
