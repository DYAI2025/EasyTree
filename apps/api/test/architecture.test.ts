/**
 * Architekturgrenzen, automatisiert (EYT-46, ADR-001 Z. 72-78).
 *
 * Läuft im Pflichtjob `unit-tests` (`pnpm test` -> `turbo run test`).
 *
 * Der eigentliche Wert steckt nicht in `violations === []`, sondern in den
 * Nicht-Leerlauf-Zusicherungen davor: eine Regel, die null Dateien sieht, meldet
 * ebenfalls null Verstösse. Genau so wird aus einem Sicherheitsnetz ein grüner
 * Haken ohne Inhalt. Deshalb ist der Umfang **registergetrieben**
 * (`SCAFFOLDED_MODULES`) statt glob-getrieben: ein Modul steht dort, weil ein
 * Ticket seinen Code geschrieben hat, und der Test verlangt daraufhin echte
 * Dateien — er belohnt nicht das Anlegen leerer Dateien, um einen Zähler zu heben.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MODULE_SLUGS, SCAFFOLDED_MODULES } from "../src/modules/module-catalogue";
import { evaluate, findStarReExports, RULES } from "./architecture/rules";
import {
  collectFilesNamed,
  collectSourceFiles,
  extractImports,
  findRepoRoot,
} from "./architecture/scan";

// Nicht `import.meta.dirname`: apps/api baut nach CommonJS (NodeNext ohne
// "type": "module"), dort ist das ein harter Compilerfehler (TS1470). Vitest
// setzt cwd auf die Paketwurzel; `findRepoRoot` laeuft von dort aufwaerts und
// wirft laut, falls pnpm-workspace.yaml nicht gefunden wird.
const repoRoot = findRepoRoot(process.cwd());

const files = [
  ...collectSourceFiles(repoRoot, "apps"),
  ...collectSourceFiles(repoRoot, "packages"),
];
const tsconfigFiles = [
  ...collectFilesNamed(repoRoot, "apps", /^tsconfig(\..+)?\.json$/),
  ...collectFilesNamed(repoRoot, "packages", /^tsconfig(\..+)?\.json$/),
  "tsconfig.base.json",
];
const refs = extractImports(repoRoot, files);
const { violations, scopeCounts } = evaluate(refs);
const starReExports = findStarReExports(repoRoot, files);

describe("Architekturgrenzen", () => {
  it("hat ueberhaupt Quelltext gescannt", () => {
    // Untergrenze bewusst niedrig, aber weit ueber null: sie faengt einen
    // kaputten Walker oder ein falsches Arbeitsverzeichnis ab, nicht das
    // normale Wachsen des Repos.
    expect(files.length).toBeGreaterThan(30);
    expect(refs.length).toBeGreaterThan(30);
  });

  it("loest jeden relativen Import auf", () => {
    // Ein nicht aufgeloester relativer Import wuerde jede pfadbasierte Regel
    // stillschweigend ueberspringen — der gefaehrlichste Fehlerzustand des
    // Scanners, weil er wie ein sauberer Lauf aussieht.
    const unresolved = refs
      .filter((ref) => ref.specifier.startsWith(".") && ref.resolved === null)
      .map((ref) => `${ref.from}:${ref.line} -> ${ref.specifier}`);
    expect(unresolved).toEqual([]);
  });

  it.each(RULES.map((rule) => rule.id))("Regel %s ueberwacht mindestens eine Datei", (ruleId) => {
    expect(scopeCounts.get(ruleId)?.size ?? 0).toBeGreaterThan(0);
  });

  it.each([...SCAFFOLDED_MODULES])(
    "Modul %s besitzt echten Inhalt und eine oeffentliche API",
    (slug) => {
      const base = `apps/api/src/modules/${slug}`;
      expect(existsSync(resolve(repoRoot, `${base}/index.ts`))).toBe(true);
      for (const layer of ["domain", "application"]) {
        const inLayer = files.filter((file) => file.startsWith(`${base}/${layer}/`));
        expect(
          inLayer.length,
          `${base}/${layer}/ ist leer — leere Schichten sind keine Grenzen`,
        ).toBeGreaterThan(0);
      }
    },
  );

  it("verwendet keine tsconfig-Pfadaliase", () => {
    // Ein Alias wie "@/*" wuerde relative Regeln aushebeln: der Spezifizierer
    // saehe aus wie ein Paketname und liefe an jeder pfadbasierten Pruefung
    // vorbei. Die Regeln setzen die Abwesenheit voraus — also wird sie geprueft,
    // nicht kommentiert.
    //
    // Die tsconfigs kommen NICHT aus `files`: `collectSourceFiles` sammelt nur
    // Quelltextendungen, JSON ist nicht dabei. Ein Filter ueber `files` waere
    // immer leer und diese Zusicherung damit selbst der leere Haken, den sie
    // verhindern soll.
    expect(tsconfigFiles.length, "keine tsconfig gefunden — Suche kaputt").toBeGreaterThan(4);
    const withPaths = tsconfigFiles.filter((file) =>
      /"paths"\s*:/.test(readFileSync(resolve(repoRoot, file), "utf8")),
    );
    expect(withPaths).toEqual([]);
  });

  it("bleibt an die Wurzel-Skripte gebunden", () => {
    // Der Test wirkt nur, solange `pnpm test` ihn ueberhaupt startet. Ein
    // spaeterer Aufraeum-Commit am Wurzel-Skript wuerde ihn sonst lautlos
    // entfernen, waehrend alle neun Pflichtchecks gruen bleiben.
    const rootPkg: unknown = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const scripts = (rootPkg as { scripts?: Record<string, string> }).scripts ?? {};
    expect(scripts["test"]).toContain("turbo run test");
  });

  it("haelt Modul-index.ts frei von Stern-Re-Exporten", () => {
    expect(starReExports.map((v) => `${v.file}:${v.line}`)).toEqual([]);
  });

  it("meldet keine Grenzverletzung", () => {
    const rendered = violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`);
    // eslint-disable-next-line no-console -- greppbare Zeile, wie beim Tenant-Gate.
    console.log(
      `[architecture] files=${files.length} imports=${refs.length} modules=${SCAFFOLDED_MODULES.length} rules=${RULES.length} violations=${rendered.length}`,
    );
    expect(rendered).toEqual([]);
  });

  it("kennt jedes Modulverzeichnis aus dem Katalog", () => {
    // `moduleOf` liefert das erste Verzeichnissegment unter `modules/` — auch
    // fuer einen Tippfehler wie `workfroce/`. Ohne diese Pruefung waere ein
    // solches Verzeichnis ein vollwertiges Modul, das keine der
    // registergetriebenen Zusicherungen erfasst: der Katalog waere Dekoration.
    const known = new Set<string>(MODULE_SLUGS);
    const onDisk = readdirSync(resolve(repoRoot, "apps/api/src/modules"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(onDisk.filter((dir) => !known.has(dir))).toEqual([]);
    // Jedes geruestete Modul muss auch wirklich auf der Platte liegen.
    expect([...SCAFFOLDED_MODULES].filter((slug) => !onDisk.includes(slug))).toEqual([]);
  });
});
