/**
 * Metatest: das Invariantenregister ist vollstaendig und nicht verrottet
 * (EYT-61 AK1).
 *
 * Dieser Test prueft keine Domainlogik. Er prueft die AUSSAGE ueber die
 * Domainlogik — dass wirklich jede benannte Invariante beide Richtungen hat.
 * Ohne ihn waere AK1 eine Behauptung, die niemand nachrechnen kann.
 *
 * Vier Messungen:
 *   1. Jeder Wert-Export von `@easytree/domain` steht im Register.
 *      Ein neuer Export ohne Eintrag macht diesen Test rot.
 *   2. Kein Registereintrag nennt einen Export, den es nicht gibt.
 *   3. Jede Regel hat Positiv- UND Negativtest; nur `konstante` darf ohne
 *      Negativtest auskommen.
 *   4. Jeder genannte Testtitel kommt in der genannten Datei woertlich vor.
 *      Das faengt Umbenennungen und geloeschte Tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { INVARIANTS } from "./domain-invariants/registry";

/**
 * Warum diese Datei in `apps/api/test` liegt und nicht in `packages/domain`:
 * `packages/domain` setzt `"types": []` und hat bewusst keine Abhaengigkeiten
 * (ADR-001 Z. 74). Ein Test, der Dateien liest, braucht die Node-Typen — sie
 * dort verfuegbar zu machen hiesse, genau den Wall einzureissen, den das Paket
 * ausmacht. `apps/api/test` liest ohnehin das ganze Repository
 * (`architecture.test.ts`), also gehoert diese Messung dorthin.
 */
const repoRoot = resolve(__dirname, "..", "..", "..");
const domainRoot = resolve(repoRoot, "packages", "domain");

/**
 * Wert-Exporte aus `src/index.ts`.
 *
 * Gelesen wird die Quelle, nicht das gebaute Paket: `test`/`typecheck` haengen
 * zwar an `^build`, aber ein Test, der `dist/` liest, prueft im Zweifel einen
 * alten Stand. `export type { … }` wird bewusst uebersprungen — ein Typ traegt
 * zur Laufzeit keine Invariante.
 */
function exportedValues(): string[] {
  const source = readFileSync(resolve(domainRoot, "src", "index.ts"), "utf8");
  const names: string[] = [];
  const blockPattern = /export\s+(type\s+)?\{([^}]*)\}\s*from/g;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(source)) !== null) {
    if (match[1] !== undefined) continue; // `export type { … }`
    for (const raw of (match[2] ?? "").split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && name.length > 0) names.push(name);
    }
  }
  return names;
}

const EXPORTS = exportedValues();

/** Alle Testdateien des Pakets, einmal gelesen. */
const TEST_SOURCES = new Map<string, string>(
  readdirSync(resolve(domainRoot, "test"))
    .filter((name: string) => name.endsWith(".test.ts"))
    .map((name: string) => [
      `packages/domain/test/${name}`,
      readFileSync(resolve(domainRoot, "test", name), "utf8"),
    ]),
);

describe("Invariantenregister (EYT-61 AK1)", () => {
  it("liest ueberhaupt Exporte und Testdateien — sonst prueft dieser Test nichts", () => {
    // Nicht-Leerlauf-Bremse: ein kaputter Parser oder ein falscher Pfad wuerde
    // alle folgenden Zusicherungen still gruen machen.
    expect(EXPORTS.length).toBeGreaterThan(15);
    expect(TEST_SOURCES.size).toBeGreaterThan(3);
    expect(INVARIANTS.length).toBeGreaterThan(15);
  });

  it("fuehrt jeden Wert-Export von @easytree/domain", () => {
    const registered = new Set(INVARIANTS.map((entry) => entry.exportName));
    const missing = EXPORTS.filter((name) => !registered.has(name)).sort();
    expect(
      missing,
      "Neuer Export ohne Registereintrag. AK1 verlangt fuer JEDE benannte " +
        "Invariante einen Positiv- und einen Negativtest — der Eintrag ist die " +
        "Stelle, an der das im Review sichtbar wird.",
    ).toEqual([]);
  });

  it("nennt keinen Export, den es nicht gibt", () => {
    const known = new Set(EXPORTS);
    const phantom = INVARIANTS.map((entry) => entry.exportName)
      .filter((name) => !known.has(name))
      .sort();
    expect(phantom).toEqual([]);
  });

  it("vergibt jeden Eintrag genau einmal", () => {
    const names = INVARIANTS.map((entry) => entry.exportName);
    expect(names.length).toBe(new Set(names).size);
  });

  it("gibt jeder Regel beide Richtungen", () => {
    const oneSided = INVARIANTS.filter(
      (entry) => entry.kind === "regel" && entry.negative === null,
    ).map((entry) => entry.exportName);
    expect(
      oneSided,
      "Eine Regel ohne Negativtest ist eine Zusage ohne Beweis: der Positivtest " +
        "waere auch dann gruen, wenn die Regel gar nicht griffe.",
    ).toEqual([]);
  });

  it("belegt jeden genannten Test wirklich in der genannten Datei", () => {
    const broken: string[] = [];
    for (const entry of INVARIANTS) {
      for (const ref of [entry.positive, entry.negative]) {
        if (ref === null) continue;
        const source = TEST_SOURCES.get(ref.file);
        if (source === undefined) {
          broken.push(`${entry.exportName}: Datei ${ref.file} existiert nicht`);
          continue;
        }
        if (!source.includes(ref.title)) {
          broken.push(`${entry.exportName}: "${ref.title}" steht nicht in ${ref.file}`);
        }
      }
    }
    expect(
      broken,
      "Verrotteter Registereintrag. Ein umbenannter oder geloeschter Test darf " +
        "die Abdeckungszusage nicht stillschweigend entwerten.",
    ).toEqual([]);
  });

  it("erkennt einen verrotteten Eintrag tatsaechlich", () => {
    // Gegenprobe: ohne sie waere die Zeile oben auch dann gruen, wenn
    // `includes` nie fehlschlagen koennte.
    const source = TEST_SOURCES.get("packages/domain/test/time-interval.test.ts");
    expect(source).toBeDefined();
    expect(source?.includes("diesen Testtitel gibt es nicht")).toBe(false);
  });
});
