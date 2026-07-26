/**
 * Rot-Fall-Beweis für den Architekturtest (EYT-46).
 *
 * Ein Wächter, der nie rot war, ist kein Wächter. Diese Suite baut einen
 * synthetischen Repo-Baum in einem temporären Verzeichnis, lässt exakt dieselbe
 * Pipeline darüber laufen (`collectSourceFiles` → `extractImports` → `evaluate`)
 * und verlangt, dass jede Regel dort anschlägt.
 *
 * Bewusst NICHT im echten Baum: eine Fixture-Datei unter `apps/api/src/` würde
 * mit `architecture.test.ts` um dieselben Dateien rennen und zusätzlich den
 * `typecheck`-Job brechen.
 *
 * Die Gegenbeispiele sind nicht ausgedacht: `http`, `pg-pool`,
 * `kysely/dist/esm/index.js`, `rxjs` und `typeorm` passieren jede naheliegende
 * Blockliste (`^node:(http|…)$`, `^pg$`, `^kysely$`) und sind der Grund, warum
 * `domain-allowlist` als Allowlist formuliert ist.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluate, findStarReExports } from "./architecture/rules";
import { collectSourceFiles, extractImports } from "./architecture/scan";

let root: string;

function write(relative: string, contents: string): void {
  const abs = join(root, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf8");
}

function violationsFor(): ReturnType<typeof evaluate> {
  const files = [...collectSourceFiles(root, "apps"), ...collectSourceFiles(root, "packages")];
  return evaluate(extractImports(root, files));
}

function rulesTriggered(): Set<string> {
  return new Set(violationsFor().violations.map((v) => v.rule));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "eyt-arch-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n', "utf8");

  // Zielmodul, damit relative Importe aufloesbar sind.
  write("apps/api/src/modules/workforce/index.ts", "export const marker = 1;\n");
  write("apps/api/src/modules/workforce/domain/employee.ts", "export const employee = 1;\n");
  write("apps/api/src/modules/workforce/application/port.ts", "export const port = 1;\n");
  write("apps/api/src/modules/workforce/infrastructure/repo.ts", "export const repo = 1;\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Rot-Fall", () => {
  it("faengt Framework- und Infrastrukturimporte im Domaincode", () => {
    write(
      "apps/api/src/modules/planning/domain/bad.ts",
      [
        'import http from "http";',
        'import { Pool } from "pg-pool";',
        'import type { Kysely } from "kysely/dist/esm/index.js";',
        'import { firstValueFrom } from "rxjs";',
        'import { Entity } from "typeorm";',
        'import { Injectable } from "@nestjs/common";',
        "export const bad = [http, Pool, firstValueFrom, Entity, Injectable] as const;",
        "export type Db = Kysely<unknown>;",
      ].join("\n") + "\n",
    );

    const found = violationsFor().violations.filter((v) => v.rule === "domain-allowlist");
    const specifiers = found.map((v) => v.message);
    for (const needle of [
      "http",
      "pg-pool",
      "kysely/dist/esm/index.js",
      "rxjs",
      "typeorm",
      "@nestjs/common",
    ]) {
      expect(
        specifiers.some((m) => m.includes(`"${needle}"`)),
        `${needle} nicht erkannt`,
      ).toBe(true);
    }
    rmSync(join(root, "apps/api/src/modules/planning"), { recursive: true, force: true });
  });

  it("faengt eine /// <reference types> im Domaincode", () => {
    write(
      "apps/api/src/modules/planning/domain/ambient.ts",
      '/// <reference types="node" />\nexport const ambient = 1;\n',
    );
    expect(rulesTriggered().has("domain-allowlist")).toBe(true);
    rmSync(join(root, "apps/api/src/modules/planning"), { recursive: true, force: true });
  });

  it("faengt einen Querimport an der oeffentlichen Modul-API vorbei", () => {
    write(
      "apps/api/src/modules/planning/application/bypass.ts",
      'import { employee } from "../../workforce/domain/employee";\nexport const bypass = employee;\n',
    );
    expect(rulesTriggered().has("module-public-api-only")).toBe(true);
    rmSync(join(root, "apps/api/src/modules/planning"), { recursive: true, force: true });
  });

  it("faengt den Griff der Kompositionswurzel in ein Modul-Innenleben", () => {
    // Der wahrscheinlichste reale Verstoss in einer NestJS-Anwendung — und der
    // Grund, warum der Geltungsbereich ganz apps/api/src/** ist.
    write(
      "apps/api/src/app.module.ts",
      'import { repo } from "./modules/workforce/infrastructure/repo";\nexport const app = repo;\n',
    );
    expect(rulesTriggered().has("module-public-api-only")).toBe(true);
    rmSync(join(root, "apps/api/src/app.module.ts"), { force: true });
  });

  it("faengt eine verkehrte Schichtrichtung", () => {
    write(
      "apps/api/src/modules/workforce/application/wrong-direction.ts",
      'import { repo } from "../infrastructure/repo";\nexport const wrong = repo;\n',
    );
    expect(rulesTriggered().has("layer-direction")).toBe(true);
    rmSync(join(root, "apps/api/src/modules/workforce/application/wrong-direction.ts"), {
      force: true,
    });
  });

  it("faengt einen App-zu-App-Import", () => {
    write(
      "apps/web/lib/leak.ts",
      'import { marker } from "../../api/src/modules/workforce/index";\nexport const leak = marker;\n',
    );
    expect(rulesTriggered().has("no-app-to-app")).toBe(true);
    rmSync(join(root, "apps/web"), { recursive: true, force: true });
  });

  it("faengt ein unspezifisches Sammelpaket, auch unter anderem Namen", () => {
    write(
      "apps/api/src/uses-grab-bag.ts",
      'import { x } from "@easytree/common";\nexport const y = x;\n',
    );
    expect(rulesTriggered().has("no-generic-shared-package")).toBe(true);
    rmSync(join(root, "apps/api/src/uses-grab-bag.ts"), { force: true });
  });

  it("faengt Prototype-Fixtures im Produktionscode", () => {
    write(
      "apps/api/src/uses-fixtures.ts",
      'import { f } from "@easytree/prototype-fixtures";\nexport const g = f;\n',
    );
    expect(rulesTriggered().has("no-fixtures-in-production-code")).toBe(true);
    rmSync(join(root, "apps/api/src/uses-fixtures.ts"), { force: true });
  });

  it("faengt ein `export *` in einer Modul-index.ts", () => {
    write("apps/api/src/modules/workforce/index.ts", 'export * from "./domain/employee";\n');
    const files = [...collectSourceFiles(root, "apps"), ...collectSourceFiles(root, "packages")];
    expect(findStarReExports(root, files).length).toBeGreaterThan(0);
    write("apps/api/src/modules/workforce/index.ts", "export const marker = 1;\n");
  });

  it("faengt einen echten Import trotz gleichnamiger Moduldeklaration", () => {
    // Ein Namensfilter fuer `declare module` wuerde hier den echten rxjs-Import
    // mitverwerfen und den Verstoss unsichtbar machen. Deshalb filtert der
    // Scanner nach Position, nicht nach Name.
    write(
      "apps/api/src/modules/planning/domain/augmented.ts",
      [
        'import { firstValueFrom } from "rxjs";',
        'declare module "rxjs" {',
        "  interface Observable<T> {",
        "    eytMarker?: T;",
        "  }",
        "}",
        "export const used = firstValueFrom;",
      ].join("\n") + "\n",
    );
    const found = violationsFor().violations.filter((v) => v.rule === "domain-allowlist");
    expect(found.some((v) => v.message.includes('"rxjs"'))).toBe(true);
    rmSync(join(root, "apps/api/src/modules/planning"), { recursive: true, force: true });
  });

  it("faengt eine unbekannte Schicht, statt die Richtungsregel abzuschalten", () => {
    // Ohne diese Behandlung genuegte ein Verzeichnis `services/`, um die
    // Richtungspruefung fuer alle seine Importe stillzulegen — fail-open.
    write(
      "apps/api/src/modules/workforce/services/sneaky.ts",
      'import { repo } from "../infrastructure/repo";\nexport const sneaky = repo;\n',
    );
    const found = violationsFor().violations.filter((v) => v.rule === "layer-direction");
    expect(found.some((v) => v.message.includes("Unbekannte Schicht"))).toBe(true);
    rmSync(join(root, "apps/api/src/modules/workforce/services"), { recursive: true, force: true });
  });

  it("ist am sauberen Baum gruen — der Rot-Fall kommt von den Verstoessen, nicht vom Aufbau", () => {
    expect(violationsFor().violations).toEqual([]);
  });
});
