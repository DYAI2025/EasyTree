/**
 * Das Proxyziel wird geprueft, nicht geglaubt (EYT-50/EYT-142).
 */
import { describe, expect, it } from "vitest";

import {
  CLOUDFLARE_API_FALLBACK_TARGET,
  DEFAULT_API_PROXY_TARGET,
  InvalidProxyTargetError,
  normalizeProxyTarget,
  resolveBuildProxyTarget,
} from "../lib/api-proxy-target";

describe("normalizeProxyTarget", () => {
  it("nimmt den dokumentierten Standard in development und test", () => {
    expect(normalizeProxyTarget(undefined, "test")).toBe(DEFAULT_API_PROXY_TARGET);
    expect(normalizeProxyTarget("", "development")).toBe(DEFAULT_API_PROXY_TARGET);
    expect(normalizeProxyTarget("   ", "development")).toBe(DEFAULT_API_PROXY_TARGET);
  });

  it("bricht in production ohne Wert ab", () => {
    expect(() => normalizeProxyTarget(undefined, "production")).toThrow(InvalidProxyTargetError);
    expect(() => normalizeProxyTarget("", "production")).toThrow(InvalidProxyTargetError);
  });

  it("lehnt Zugangsdaten in der Ziel-URL ab", () => {
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

describe("resolveBuildProxyTarget", () => {
  it("nimmt in Cloudflare Workers Builds den dokumentierten Railway-Fallback", () => {
    expect(resolveBuildProxyTarget({ NODE_ENV: "production", WORKERS_CI: "1" })).toBe(
      CLOUDFLARE_API_FALLBACK_TARGET,
    );
  });

  it("nimmt in Cloudflare Pages den dokumentierten Railway-Fallback", () => {
    expect(resolveBuildProxyTarget({ NODE_ENV: "production", CF_PAGES: "1" })).toBe(
      CLOUDFLARE_API_FALLBACK_TARGET,
    );
  });

  it("bevorzugt ein explizites API-Ziel auch in Cloudflare", () => {
    expect(
      resolveBuildProxyTarget({
        NODE_ENV: "production",
        WORKERS_CI: "1",
        EASYTREE_API_PROXY_TARGET: "https://api.example.org/",
      }),
    ).toBe("https://api.example.org");
  });

  it("bleibt ausserhalb Cloudflare in production fail-closed", () => {
    expect(() => resolveBuildProxyTarget({ NODE_ENV: "production" })).toThrow(
      InvalidProxyTargetError,
    );
  });
});
