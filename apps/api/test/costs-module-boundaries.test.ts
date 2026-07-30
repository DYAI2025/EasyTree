/**
 * Erste rote Pruefung fuer REQ-001 / EYT-105 — explizites Kostenmodul.
 *
 * Quelle: `docs/prd/sprint-5-daily-cost-export.prd.md`, Abschnitt REQ-001,
 * „Binaere Akzeptanz (Baseline S5-REQ-01)", sowie
 * `docs/plans/2026-07-30-sprint-5-daily-cost-export.md` Abschnitt 4
 * („erste rote Pruefung je Requirement").
 *
 * Diese Datei ist ABSICHTLICH rot, solange `apps/api/src/modules/costs/` fehlt.
 * Sie beschreibt den Sollzustand, nicht den Ist-Zustand — Test vor Code.
 *
 * ## Was hier steht und was nicht
 *
 * Die Registrierung im Katalog (`MODULE_SLUGS`, `SCAFFOLDED_MODULES`,
 * `TABLE_OWNERSHIP`) liegt bewusst in `architecture.test.ts`: dort wohnen die
 * registergetriebenen Zusicherungen, und dort faellt auf, dass die Schleife
 * `it.each([...SCAFFOLDED_MODULES])` an einem nicht registrierten Modul
 * vollstaendig gruen vorbeilaeuft.
 *
 * Hier stehen die Grenzen, die man nur am echten Baum sehen kann: Schichten,
 * Importrichtungen, SQL-Zugriffsziele (lesend und schreibend), Verzeichnisnamen
 * und Exportnamen. Die
 * zugehoerigen Gegenmutationen laufen NICHT gegen dieses Repository, sondern
 * gegen einen synthetischen Baum in `os.tmpdir()` —
 * `costs-module-boundaries.red-case.test.ts`, gleiches Muster wie
 * `architecture-red-case.test.ts`.
 *
 * Laeuft im Pflichtjob `unit-tests` (`pnpm test` -> `turbo run test`).
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MODULE_SLUGS, TABLE_OWNERSHIP } from "../src/modules/module-catalogue";
import {
  COSTS_INDEX,
  COSTS_LAYER_DIRS,
  COSTS_MODULE_DIR,
  COSTS_RULES,
  evaluateCostsRules,
  render,
} from "./architecture/costs-rules";
import { evaluate, findStarReExports } from "./architecture/rules";
import { collectSourceFiles, extractImports, findRepoRoot } from "./architecture/scan";

const repoRoot = findRepoRoot(process.cwd());
const files = [
  ...collectSourceFiles(repoRoot, "apps"),
  ...collectSourceFiles(repoRoot, "packages"),
];
const refs = extractImports(repoRoot, files);
const costsFiles = files.filter((file) => file.startsWith(`${COSTS_MODULE_DIR}/`));

const { findings, seen } = evaluateCostsRules({
  repoRoot,
  files,
  refs,
  tableOwnership: TABLE_OWNERSHIP,
});

/** Nicht-Leerlauf-Bremse fuer die generischen Regeln aus `architecture/rules.ts`. */
const { scopeCounts } = evaluate(refs);

function filesIn(relativeDir: string): string[] {
  const abs = resolve(repoRoot, relativeDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name);
}

describe("Kostenmodul — Struktur (EYT-105, REQ-001)", () => {
  it("besitzt das Modulverzeichnis apps/api/src/modules/costs", () => {
    expect(
      existsSync(resolve(repoRoot, COSTS_MODULE_DIR)),
      `${COSTS_MODULE_DIR} fehlt — REQ-001 verlangt das Kostenmodul als abgegrenztes Fachmodul.`,
    ).toBe(true);
  });

  it.each([...COSTS_LAYER_DIRS])("besitzt eine nicht leere Schicht %s/", (layer) => {
    // Leere Schichten sind keine Grenzen, sondern Scheinkapselung mit gruenem
    // Haken (ADR-001 Z. 33) — deshalb wird Inhalt verlangt, nicht Existenz.
    expect(
      filesIn(`${COSTS_MODULE_DIR}/${layer}`).length,
      `${COSTS_MODULE_DIR}/${layer}/ enthaelt keine .ts-Datei.`,
    ).toBeGreaterThan(0);
  });

  it("besitzt die HTTP-Naht unter interface/http/", () => {
    expect(
      filesIn(`${COSTS_MODULE_DIR}/interface/http`).length,
      `${COSTS_MODULE_DIR}/interface/http/ fehlt oder ist leer — REQ-001 nennt autorisierte Controller mit explizitem Mapping.`,
    ).toBeGreaterThan(0);
  });

  it("besitzt eine schmale, benannte oeffentliche API in index.ts", () => {
    expect(existsSync(resolve(repoRoot, COSTS_INDEX)), `${COSTS_INDEX} fehlt.`).toBe(true);
    const stars = findStarReExports(repoRoot, files).filter((v) => v.file === COSTS_INDEX);
    expect(stars.map((v) => `${v.file}:${v.line}`)).toEqual([]);
    const reExports = refs.filter((ref) => ref.from === COSTS_INDEX);
    expect(
      reExports.length,
      `${COSTS_INDEX} re-exportiert nichts — eine leere oeffentliche API ist kein Vertrag.`,
    ).toBeGreaterThan(0);
  });

  it("deklariert mindestens einen Application-Port", () => {
    // REQ-001 nennt fuer `application/` ausdruecklich „Query- und Export-Ports".
    // Der XLSX-Adapter haengt an genau diesem Port (CAN-008: austauschbar).
    const ports = filesIn(`${COSTS_MODULE_DIR}/application`).filter((name) =>
      name.endsWith(".port.ts"),
    );
    expect(
      ports,
      `${COSTS_MODULE_DIR}/application/ fuehrt keine *.port.ts — ohne Port gibt es keine Naht, hinter der Renderer und Repository haengen koennten.`,
    ).not.toEqual([]);
  });

  it("bezieht Geld und Rundung aus @easytree/domain statt sie neu zu bauen", () => {
    // Die Gegenrichtung — eine eigene Money-Implementierung im Modul — prueft
    // die Regel `costs-single-money-implementation`. Beide zusammen ergeben
    // „genau eine Implementierung, und zwar die zentrale" (EYT-95).
    const usages = refs.filter(
      (ref) => ref.from.startsWith(`${COSTS_MODULE_DIR}/`) && ref.specifier === "@easytree/domain",
    );
    expect(
      usages.length,
      "Keine Kostendatei importiert @easytree/domain — der zentrale Geld-/Rundungsvertrag aus EYT-95 waere damit nicht in Benutzung.",
    ).toBeGreaterThan(0);
  });
});

describe("Kostenmodul — Grenzen (EYT-105, REQ-001)", () => {
  it("hat ueberhaupt Kostendateien gescannt", () => {
    // Ohne diese Zusicherung waeren fuenf der sieben Regeln unten still gruen,
    // solange das Modul fehlt — der Zustand, den REQ-001 gerade beendet.
    expect(
      costsFiles.length,
      `Keine Quelldatei unter ${COSTS_MODULE_DIR}/ gefunden.`,
    ).toBeGreaterThan(0);
  });

  it.each(COSTS_RULES.map((rule) => [rule.id, rule.summary] as const))(
    "Regel %s ueberwacht mindestens eine Datei",
    (ruleId, summary) => {
      expect(seen.get(ruleId)?.size ?? 0, `${ruleId} lief im Leerlauf. ${summary}`).toBeGreaterThan(
        0,
      );
    },
  );

  it.each([
    "domain-allowlist",
    "module-public-api-only",
    "layer-direction",
    "api-dependency-allowlist",
  ])("die generische Regel %s sieht auch Kostendateien", (ruleId) => {
    // Die Zusicherung in `architecture.test.ts` verlangt nur, dass eine Regel
    // IRGENDEINE Datei sieht — das ist schon durch planning/ erfuellt. Erst
    // diese Bindung stellt sicher, dass die bestehenden Grenzen auch ueber dem
    // neuen Modul liegen und nicht daran vorbeilaufen.
    const watched = [...(scopeCounts.get(ruleId) ?? new Set<string>())].filter((file) =>
      file.startsWith(`${COSTS_MODULE_DIR}/`),
    );
    expect(watched, `${ruleId} sieht keine Datei unter ${COSTS_MODULE_DIR}/.`).not.toEqual([]);
  });

  it("meldet keine Grenzverletzung im Kostenmodul", () => {
    // Greppbare Zeile, wie beim Architektur- und Tenant-Gate. Ohne
    // eslint-disable: `no-console` ist in eslint.config.mjs nicht aktiv, die
    // Direktive waere eine unbenutzte Direktive und selbst eine Warnung.
    console.log(
      `[costs-boundaries] slugs=${MODULE_SLUGS.length} costs-files=${costsFiles.length} rules=${COSTS_RULES.length} findings=${findings.length}`,
    );
    expect(render(findings)).toEqual([]);
  });
});
