/**
 * Die Containerbindung darf nicht stillschweigend wieder fail-open werden
 * (EYT-126).
 *
 * Zwei Regressionen sind hier schon passiert und beide sahen harmlos aus:
 * `GIT_SHA: ${GIT_SHA:-unknown}` und
 * `EASYTREE_API_PROXY_TARGET: ${EASYTREE_API_PROXY_TARGET:-http://api:3001}`.
 * Ein Vorgabewert, auf den sich niemand berufen darf, aber alle sich verlassen,
 * ist die schlechteste Sorte Vorgabe.
 *
 * Die Handproben aus dem Slice (`docker compose config` ohne die Variablen,
 * `docker build` ohne `--build-arg`) belegen dasselbe schaerfer, laufen aber
 * nie wieder, wenn sie niemand wiederholt. Dieser Test ist die dauerhafte
 * Fassung davon — er braucht kein Docker und laeuft in `unit-tests` mit.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..", "..");

function lies(datei: string): string {
  const inhalt = readFileSync(join(REPO, datei), "utf8");
  // Eingangsbremse: eine leere oder verschobene Datei liesse jede Zusicherung
  // unten vakuoes gruen werden.
  expect(inhalt.length, `${datei} ist leer oder fehlt`).toBeGreaterThan(200);
  return inhalt;
}

describe("docker-compose.yml", () => {
  const compose = lies("docker-compose.yml");

  it("gibt GIT_SHA keinen Vorgabewert", () => {
    expect(compose).not.toMatch(/\$\{GIT_SHA:-/);
    expect(compose).toMatch(/\$\{GIT_SHA:\?/);
  });

  it("gibt dem Proxyziel keinen Vorgabewert", () => {
    expect(compose).not.toMatch(/\$\{EASYTREE_API_PROXY_TARGET:-/);
    expect(compose).toMatch(/\$\{EASYTREE_API_PROXY_TARGET:\?/);
  });

  /**
   * Der Abschnitt wird eng geschnitten und nicht die ganze Datei durchsucht:
   * der Kopfkommentar NENNT die Variable (er erklaert, warum sie keinen
   * Vorgabewert hat), und eine dateiweite Suche waere daran haengengeblieben.
   */
  const webStart = compose.indexOf("\n  web:");
  const webBau = compose.slice(webStart, compose.indexOf("\n    environment:", webStart));

  it("schneidet ueberhaupt den Bauabschnitt des Web-Dienstes aus", () => {
    expect(webStart).toBeGreaterThan(0);
    expect(webBau).toContain("dockerfile: apps/web/Dockerfile");
    expect(webBau).toContain("GIT_SHA");
  });

  it("uebergibt das Proxyziel als Laufzeit- und nicht als Bauvariable", () => {
    expect(webBau).not.toContain("EASYTREE_API_PROXY_TARGET");
  });

  it("setzt das Proxyziel in der Laufzeitumgebung des Web-Dienstes", () => {
    const webUmgebung = compose.slice(compose.indexOf("\n    environment:", webStart));
    expect(webUmgebung).toContain("EASYTREE_API_PROXY_TARGET");
  });
});

describe("Dockerfiles", () => {
  it.each(["apps/web/Dockerfile", "apps/api/Dockerfile"])(
    "%s erzwingt GIT_SHA statt es vorzubelegen",
    (datei) => {
      const inhalt = lies(datei);
      expect(inhalt).not.toMatch(/ARG\s+GIT_SHA\s*=/);
      expect(inhalt).toMatch(/RUN\s+test\s+-n\s+"\$\{GIT_SHA\}"/);
    },
  );

  it("das Web-Image backt kein Proxyziel mehr ein", () => {
    const inhalt = lies("apps/web/Dockerfile");
    expect(inhalt).not.toMatch(/^ARG\s+EASYTREE_API_PROXY_TARGET/m);
    expect(inhalt).not.toMatch(/^ENV\s+EASYTREE_API_PROXY_TARGET/m);
  });
});

/**
 * Der Bauzeitweg darf nicht durch die Hintertuer zurueckkommen: solange
 * `next.config.ts` wieder ein `rewrites()` traegt, waere das Ziel erneut im
 * `routes-manifest.json` eingebacken — und der Container-Smoke faende es erst
 * viel spaeter.
 */
describe("apps/web/next.config.ts", () => {
  it("loest das Proxyziel nicht mehr beim Bauen auf", () => {
    const inhalt = lies("apps/web/next.config.ts");
    expect(inhalt).not.toMatch(/^\s*(async\s+)?rewrites\s*\(/m);
    expect(inhalt).not.toContain("resolveBuildProxyTarget");
    // Eingangsbremse: eine umbenannte Datei liesse beide Zusicherungen leer.
    expect(inhalt).toContain("outputFileTracingRoot");
  });
});
