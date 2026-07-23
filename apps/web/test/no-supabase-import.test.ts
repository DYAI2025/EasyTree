import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Statischer Guard (EYT-41 / ADR-001 §5): Das Web-Paket greift NIE direkt
 * operativ auf Supabase zu — API-Zugriff ausschließlich über den
 * injizierten ApiClient. Der verbotene Paketname wird aus Teilen
 * zusammengesetzt, damit diese Testdatei selbst den externen
 * `grep -r`-Check (muss leer bleiben) nicht auslöst.
 */
const BANNED_IMPORT = ["@supabase", "supabase-js"].join("/");
const IGNORED_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "coverage"]);

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (stats.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no direct supabase usage in apps/web", () => {
  it(`contains no reference to "${BANNED_IMPORT}" anywhere under apps/web`, () => {
    // Testlauf-cwd ist das Paketverzeichnis apps/web.
    const offenders = collectFiles(process.cwd()).filter((file) =>
      readFileSync(file, "utf8").includes(BANNED_IMPORT),
    );
    expect(offenders).toEqual([]);
  });
});
