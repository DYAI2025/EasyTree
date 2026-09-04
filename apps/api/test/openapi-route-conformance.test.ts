/**
 * Konformitaet: Routentabelle gegen OpenAPI-Vertrag (EYT-50).
 *
 * ## Der Befund, den dieser Test in eine Messung verwandelt
 *
 * `packages/contracts/openapi/v1.json` beschreibt neun Operationen unter dem
 * Basispfad `/api/v1`. Serverseitig existierte davon KEINE — und niemand
 * bemerkte es, weil kein Test beide Seiten je verglichen hat. Der
 * Drift-Test in `packages/contracts` prueft nur, dass das Dokument zum
 * VERTRAGSCODE passt, nicht dass irgendein Server es erfuellt.
 *
 * ## Was hier gemessen wird
 *
 * 1. Das Praefix des Servers ist dasselbe, das der Vertrag als `servers[0].url`
 *    nennt. Zwei Zeichenketten, die dasselbe bedeuten muessen.
 * 2. Jede implementierte Fachroute steht im Vertrag. Eine Route ohne
 *    Vertragseintrag ist ein undokumentierter Endpunkt — rot.
 * 3. Jede Vertragsoperation ist entweder implementiert ODER steht mit
 *    Begruendung in {@link NOT_YET_IMPLEMENTED}. Wer eine Route baut und den
 *    Eintrag stehen laesst, wird rot; wer eine Operation vergisst, sieht sie
 *    hier.
 *
 *    Frueher stand hier "die Liste darf nur schrumpfen". Das war Prosa, kein
 *    Mechanismus, und seit EYT-109 ausserdem falsch: ein vertragserster Slice
 *    registriert den Pfad, BEVOR die Route existiert, und laesst die Liste
 *    dabei zwangslaeufig wachsen. Erlaubt ist das nur unter einer Bedingung —
 *    der Eintrag nennt die Aufgabe, die ihn wieder entfernt. Verbindlich wird
 *    die Entfernung nicht durch diesen Satz, sondern durch die
 *    `stale`-Zusicherung weiter unten: sobald die Route existiert, ist der
 *    Eintrag rot. Ein Eintrag kann also nicht vergammeln, nur zu frueh
 *    dastehen.
 *
 * Damit ist die Luecke nicht mehr unsichtbar, sondern abzaehlbar — dieselbe
 * Bauart wie `EXPECTED_TABLES` im katalogweiten Metagate (EYT-86).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { Application } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_BASE_PATH } from "../src/common/api-base-path";
import { createApiApp } from "../src/main";

const repoRoot = resolve(__dirname, "..", "..", "..");

interface OpenApiDocument {
  readonly servers: readonly { readonly url: string }[];
  readonly paths: Record<string, Record<string, unknown>>;
}

const CONTRACT = JSON.parse(
  readFileSync(resolve(repoRoot, "packages/contracts/openapi/v1.json"), "utf8"),
) as OpenApiDocument;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** `POST /planung/einsaetze` — Methode und Pfad, so wie beide Seiten sie kennen. */
function contractOperations(): string[] {
  const operations: string[] = [];
  for (const [path, item] of Object.entries(CONTRACT.paths)) {
    for (const method of HTTP_METHODS) {
      if (method in item) operations.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return operations.sort();
}

/**
 * Vertragsoperationen ohne Route — mit Grund, nicht nur mit Namen.
 *
 * Jeder Eintrag ist eine Zusage, die noch aussteht. Die Liste ist absichtlich
 * unbequem: sie steht im Testcode und nicht in einer Dokumentationsdatei, weil
 * eine Dokumentationsdatei niemanden rot macht.
 */
const NOT_YET_IMPLEMENTED: ReadonlyMap<string, string> = new Map([
  [
    "GET /einsatz/plan",
    "Mitarbeiter-Lesesicht. Ohne sie kann AK9 (gleiche Assignment- und Planversions-IDs in beiden Ansichten) nicht belegt werden.",
  ],
  [
    "POST /einsatz/bestaetigungen",
    "Bestaetigung durch die beschaeftigte Person. Braucht das Subjektmodell aus EYT-14 — bis dahin waere jede Bestaetigung organisationsweit schreibbar.",
  ],
  [
    "POST /einsatz/ablehnungen",
    "Ablehnung mit Grund. Gleiche Abhaengigkeit wie die Bestaetigung (EYT-14).",
  ],
  [
    "POST /einsatz/zeiten/start",
    "Zeiterfassung. Es gibt keine time_entries-Tabelle — bewusst, siehe Migration 0010 Kopfkommentar (EYT-14).",
  ],
  ["POST /einsatz/zeiten/stopp", "Zeiterfassung. Gleiche Begruendung wie der Start."],
  [
    "POST /planung/baustellentage/team",
    "Tagesbesetzung ersetzen. Braucht zusaetzlich die Lock-Version-Fortschreibung " +
      "und das atomare Ersetzen der Zuweisungen — EYT-147 M4.",
  ],
  // `GET /kosten/planversionen` stand hier bis EYT-144. Die Route ist am
  // `CostsController` registriert; die `stale`-Zusicherung weiter unten hat den
  // Eintrag in genau dem Lauf rot gemeldet, in dem die Route entstand.
  //
  // Die beiden Snapshot-Operationen standen hier bis EYT-139. Sie sind am
  // `CostsController` registriert; die `stale`-Zusicherung weiter unten hat
  // ihre Eintraege in genau dem Lauf rot gemeldet, in dem die Routen entstanden
  // — deshalb sind sie gestrichen und nicht bloss umformuliert.
]);

/**
 * Express-Pfadparameter in die OpenAPI-Schreibweise bringen.
 *
 * `:employeeId` und `{employeeId}` bezeichnen DIESELBE Route in zwei
 * Notationen. Ohne diese Umschrift meldete der Test jede parametrisierte
 * Route als undokumentiert — ein Fehlalarm, der die echte Aussage
 * ("Route ohne Vertragseintrag") unbrauchbar machte. Die Umschrift ist
 * bewusst eng: nur der Parametername, keine Musterlockerung.
 */
function toContractPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Fachrouten des laufenden Servers, ohne health/ready (unversionierte Betriebsschnittstellen). */
function implementedOperations(app: INestApplication): string[] {
  const server = app.getHttpAdapter().getInstance() as Application;
  const stack = (server.router as unknown as { stack?: unknown[] } | undefined)?.stack ?? [];
  const found: string[] = [];

  for (const entry of stack) {
    const layer = entry as {
      route?: { path?: string; methods?: Record<string, boolean> };
    };
    const path = layer.route?.path;
    const methods = layer.route?.methods;
    if (typeof path !== "string" || methods === undefined) continue;
    const prefix = `/${API_BASE_PATH}`;
    if (!path.startsWith(`${prefix}/`)) continue;
    for (const method of HTTP_METHODS) {
      if (methods[method] === true) {
        found.push(`${method.toUpperCase()} ${toContractPath(path.slice(prefix.length))}`);
      }
    }
  }
  return found.sort();
}

describe("Routentabelle gegen OpenAPI-Vertrag (EYT-50)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // GENAU die Verdrahtung aus dem Produktionsstart, nur ohne `listen`.
    //
    // Ein eigener Testaufbau mit eigenem setGlobalPrefix waere bequemer und
    // wertlos: er bliebe gruen, wenn jemand das Praefix aus main.ts entfernt.
    // Der Test soll die BEZIEHUNG Server/Vertrag schuetzen, nicht seine eigene
    // Nachbildung davon.
    //
    // Die Rollenpruefung ist der einzige eingespritzte Teil — sie braucht sonst
    // eine echte Datenbank. Der zurueckgegebene Stand ist der gewuenschte:
    // keine Rechte, die RLS umgehen (EYT-45).
    app = await createApiApp(
      () => () =>
        Promise.resolve({
          role: "easytree_app",
          isSuperuser: false,
          bypassesRls: false,
          inheritsPrivileges: false,
        }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("liest ueberhaupt einen Vertrag mit Operationen — sonst prueft dieser Test nichts", () => {
    expect(contractOperations().length).toBeGreaterThan(5);
    expect(CONTRACT.servers.length).toBeGreaterThan(0);
  });

  it("setzt genau den Basispfad, den der Vertrag nennt", () => {
    // Der Vertrag fuehrt ihn mit fuehrendem Slash, setGlobalPrefix ohne.
    expect(CONTRACT.servers[0]?.url).toBe(`/${API_BASE_PATH}`);
  });

  it("laesst health und ready unversioniert", () => {
    // Betriebsschnittstellen. scripts/smoke-api.sh und die Playwright-Suite
    // fragen genau /health und /ready ab; ein Praefix daran waere ein
    // stiller Bruch beider.
    const server = app.getHttpAdapter().getInstance() as Application;
    const paths = (
      (server.router as unknown as { stack?: unknown[] } | undefined)?.stack ?? []
    ).flatMap((entry) => {
      const path = (entry as { route?: { path?: string } }).route?.path;
      return typeof path === "string" ? [path] : [];
    });
    expect(paths).toContain("/health");
    expect(paths).toContain("/ready");
  });

  it("kennt keine Fachroute ohne Vertragseintrag", () => {
    const contract = new Set(contractOperations());
    const undocumented = implementedOperations(app).filter((op) => !contract.has(op));
    expect(
      undocumented,
      "Undokumentierter Endpunkt. Erst den Vertrag erweitern (packages/contracts) " +
        "und `pnpm --filter @easytree/contracts run openapi:write` laufen lassen.",
    ).toEqual([]);
  });

  it("fuehrt jede noch offene Vertragsoperation mit Begruendung", () => {
    const implemented = new Set(implementedOperations(app));
    const open = contractOperations().filter((op) => !implemented.has(op));

    const undeclared = open.filter((op) => !NOT_YET_IMPLEMENTED.has(op));
    expect(
      undeclared,
      "Vertragsoperation ohne Route und ohne Eintrag in NOT_YET_IMPLEMENTED. " +
        "Eine offene Zusage gehoert benannt, nicht uebersehen.",
    ).toEqual([]);

    const stale = [...NOT_YET_IMPLEMENTED.keys()].filter((op) => implemented.has(op));
    expect(
      stale,
      "Diese Operation ist implementiert, steht aber noch als offen gefuehrt. " +
        "Eintrag entfernen — die Liste darf nur schrumpfen.",
    ).toEqual([]);
  });

  it("nennt in NOT_YET_IMPLEMENTED nur Operationen, die es im Vertrag gibt", () => {
    const contract = new Set(contractOperations());
    const phantom = [...NOT_YET_IMPLEMENTED.keys()].filter((op) => !contract.has(op));
    expect(phantom).toEqual([]);
  });
});
