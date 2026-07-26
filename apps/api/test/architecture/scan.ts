/**
 * Quelltext-Scanner für den Architekturtest (EYT-46).
 *
 * Kein `.test.ts`-Suffix: bewusst Helfer, keine eigene Suite (Konvention aus
 * `CLAUDE.md`, wie `test/tenant-context.helper.ts`).
 *
 * Importe werden mit `ts.preProcessFile` aus dem TypeScript-Compiler extrahiert,
 * nicht per Regex. Grund: `import type`, `export … from`, `export *`,
 * dynamisches `import()`, `require()`, Seiteneffekt-Importe und
 * Typposition-`import("x")` müssen alle erfasst werden, auskommentierte Importe
 * und importförmige String-Literale dagegen nicht. Eine Regex bekommt genau das
 * nicht zuverlässig hin.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

/** Verzeichnisse, die nie gescannt werden. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  ".git",
  // Untracked Fremdverzeichnisse im Repo-Root (siehe CLAUDE.md, Konventionen).
  "penpot",
  "_sprint2-transfer",
]);

/** Erweiterungen, die als Quelltext gelten. Vollständigkeit prüft der Test. */
export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export interface ImportRef {
  /** Repo-relativer Pfad der importierenden Datei, immer mit "/". */
  readonly from: string;
  /** Der Spezifizierer, wie er im Quelltext steht. */
  readonly specifier: string;
  /** Repo-relativer Zielpfad, falls relativ und auflösbar; sonst null. */
  readonly resolved: string | null;
  readonly line: number;
  /** true bei `/// <reference types="…" />`. */
  readonly isTypeReference: boolean;
}

/** Sucht aufwärts nach dem Repo-Root (erkannt an `pnpm-workspace.yaml`). */
export function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Repo-Root nicht gefunden ab ${startDir} (pnpm-workspace.yaml fehlt).`);
    }
    dir = parent;
  }
}

/** Alle Quelldateien unterhalb von `dir`, repo-relativ und mit "/" normalisiert. */
export function collectSourceFiles(repoRoot: string, dir: string): string[] {
  const out: string[] = [];
  const absDir = resolve(repoRoot, dir);
  if (!existsSync(absDir)) return out;

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const abs = join(current, entry.name);
      if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        out.push(toPosix(relative(repoRoot, abs)));
      }
    }
  };

  walk(absDir);
  return out.sort();
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Auflösung relativer Spezifizierer. Muss drei Modulstile abdecken, die im
 * Repo gleichzeitig vorkommen: `apps/api` (NodeNext, endungslos), die
 * ESM-Pakete (`.js`-Endung, Ziel ist `.ts`) und `apps/web`
 * (`moduleResolution: Bundler`, endungslos).
 */
function resolveRelative(repoRoot: string, fromFile: string, specifier: string): string | null {
  const base = resolve(repoRoot, dirname(fromFile), specifier);
  const candidates = [base];

  for (const ext of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
    candidates.push(`${base}${ext}`);
  }
  // ESM-Konvention: `./x.js` im Quelltext zeigt auf `./x.ts`.
  for (const [from, to] of [
    [".js", ".ts"],
    [".js", ".tsx"],
    [".mjs", ".mts"],
    [".cjs", ".cts"],
  ] as const) {
    if (base.endsWith(from)) candidates.push(`${base.slice(0, -from.length)}${to}`);
  }
  for (const index of ["index.ts", "index.tsx", "index.js", "index.mjs"]) {
    candidates.push(join(base, index));
  }

  for (const candidate of candidates) {
    if (isFile(candidate)) return toPosix(relative(repoRoot, candidate));
  }
  return null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Zeilennummer (1-basiert) zu einem Zeichen-Offset. */
function lineOf(source: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Extrahiert alle Importbeziehungen einer Datei.
 *
 * `declare module "x" { … }` landet in `importedFiles`, ist aber eine
 * Moduldeklaration und kein Import — sonst entstünden Falschtreffer.
 */
export function extractImports(repoRoot: string, files: readonly string[]): ImportRef[] {
  const refs: ImportRef[] = [];

  for (const file of files) {
    const abs = resolve(repoRoot, file);
    const source = readFileSync(abs, "utf8");
    const info = ts.preProcessFile(source, true, true);

    const declaredModules = new Set<string>();
    for (const match of source.matchAll(/declare\s+module\s+["']([^"']+)["']/g)) {
      const name = match[1];
      if (name !== undefined) declaredModules.add(name);
    }

    for (const imported of info.importedFiles) {
      if (declaredModules.has(imported.fileName)) continue;
      refs.push({
        from: file,
        specifier: imported.fileName,
        resolved: imported.fileName.startsWith(".")
          ? resolveRelative(repoRoot, file, imported.fileName)
          : null,
        line: lineOf(source, imported.pos),
        isTypeReference: false,
      });
    }

    // `/// <reference types="node" />` zieht eine ganze Ambient-Oberfläche in
    // den Scope, taucht aber NICHT in importedFiles auf. Ohne diese Schleife
    // wäre das ein unsichtbarer Weg an der Domain-Allowlist vorbei.
    for (const typeRef of info.typeReferenceDirectives) {
      refs.push({
        from: file,
        specifier: typeRef.fileName,
        resolved: null,
        line: lineOf(source, typeRef.pos),
        isTypeReference: true,
      });
    }
  }

  return refs;
}
