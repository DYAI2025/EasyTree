/**
 * Architekturregeln als Daten (EYT-46).
 *
 * Zwei Entwurfsentscheidungen, beide aus der kritischen Prüfung des Entwurfs:
 *
 * 1. `domain-allowlist` ist eine **Allowlist**, keine Blockliste. ADR-001 Z. 74
 *    („Domain importiert keine Framework- oder Infrastrukturpakete") ist ein
 *    universelles Verbot; eine endliche Liste verbotener Pakete kann das nie
 *    ausdrücken. Belegte Gegenbeispiele einer Blockliste: `http` (statt
 *    `node:http`), `pg-pool` (statt `pg`), `kysely/dist/esm/index.js` (statt
 *    `kysely`), dazu `rxjs`, das eine echte Abhängigkeit von `@easytree/api`
 *    ist. Erlaubt ist deshalb nur, was ausdrücklich genannt ist.
 *
 * 2. Der Geltungsbereich von `module-public-api-only` ist **ganz**
 *    `apps/api/src/**`, nicht nur `apps/api/src/modules/**`. Sonst dürfte
 *    ausgerechnet die Kompositionswurzel `app.module.ts` in jedes
 *    `infrastructure/` greifen — der wahrscheinlichste reale Verstoss in einer
 *    NestJS-Anwendung.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ImportRef } from "./scan";

export interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface Rule {
  readonly id: string;
  /** Trifft zu, wenn die Datei von dieser Regel überwacht wird. */
  readonly inScope: (file: string) => boolean;
  readonly check: (ref: ImportRef) => string | null;
}

const API_MODULES = "apps/api/src/modules/";
const DOMAIN_PACKAGE = "packages/domain/src/";

/** `apps/api/src/modules/<slug>/…` -> `<slug>`, sonst null. */
export function moduleOf(file: string): string | null {
  if (!file.startsWith(API_MODULES)) return null;
  const rest = file.slice(API_MODULES.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return rest.slice(0, slash);
}

/** `apps/<name>/…` -> `<name>`, sonst null. */
function appOf(file: string): string | null {
  if (!file.startsWith("apps/")) return null;
  const rest = file.slice("apps/".length);
  const slash = rest.indexOf("/");
  return slash > 0 ? rest.slice(0, slash) : null;
}

/** Schicht innerhalb eines Moduls, sonst null. */
function layerOf(file: string): string | null {
  const module = moduleOf(file);
  if (module === null) return null;
  const rest = file.slice(API_MODULES.length + module.length + 1);
  const slash = rest.indexOf("/");
  return slash > 0 ? rest.slice(0, slash) : null;
}

const LAYER_RANK: Record<string, number> = {
  domain: 0,
  application: 1,
  infrastructure: 2,
  interface: 3,
};

/** Unspezifische Sammelpakete. ADR-001 Z. 77 verbietet die Sache, nicht nur den Namen. */
const GENERIC_PACKAGE_NAMES = [
  "shared",
  "common",
  "utils",
  "util",
  "misc",
  "core",
  "helpers",
  "lib",
];

function isDomainFile(file: string): boolean {
  return file.startsWith(DOMAIN_PACKAGE) || layerOf(file) === "domain";
}

export const RULES: readonly Rule[] = [
  {
    // ADR-001 Z. 74 — als Allowlist formuliert, siehe Dateikopf.
    id: "domain-allowlist",
    inScope: isDomainFile,
    check: (ref): string | null => {
      if (ref.isTypeReference) {
        return `Domaincode darf keine /// <reference types="${ref.specifier}" /> fuehren — sie zieht eine ganze Ambient-Oberflaeche in den Scope.`;
      }
      if (ref.specifier === "@easytree/domain") return null;
      if (!ref.specifier.startsWith(".")) {
        return `Domaincode darf "${ref.specifier}" nicht importieren. Erlaubt sind ausschliesslich relative Pfade innerhalb der eigenen domain/-Schicht und "@easytree/domain" (ADR-001 Z. 74).`;
      }
      if (ref.resolved === null) {
        return `Relativer Import "${ref.specifier}" ist nicht aufloesbar — der Scanner koennte ihn sonst stillschweigend uebergehen.`;
      }
      if (!isDomainFile(ref.resolved)) {
        return `Domaincode darf nicht nach "${ref.resolved}" hinausgreifen; das liegt ausserhalb einer domain/-Schicht (ADR-001 Z. 74).`;
      }
      const fromModule = moduleOf(ref.from);
      const toModule = moduleOf(ref.resolved);
      if (fromModule !== toModule) {
        return `Domaincode von "${fromModule ?? "packages/domain"}" darf nicht in die domain/-Schicht von "${toModule ?? "packages/domain"}" greifen (ADR-001 Z. 76).`;
      }
      return null;
    },
  },
  {
    // ADR-001 Z. 76 — modulübergreifend nur über die öffentliche index.ts.
    id: "module-public-api-only",
    inScope: (file): boolean => file.startsWith("apps/api/src/"),
    check: (ref): string | null => {
      if (ref.resolved === null) return null;
      const toModule = moduleOf(ref.resolved);
      if (toModule === null) return null;
      const fromModule = moduleOf(ref.from);
      if (fromModule === toModule) return null;
      const publicApi = `${API_MODULES}${toModule}/index.ts`;
      if (ref.resolved === publicApi) return null;
      return `Zugriff auf Modul "${toModule}" nur ueber ${publicApi}, nicht ueber "${ref.resolved}" (ADR-001 Z. 76).`;
    },
  },
  {
    // Schichtrichtung innerhalb eines Moduls (ADR-001 Z. 65-69).
    id: "layer-direction",
    inScope: (file): boolean => layerOf(file) !== null,
    check: (ref): string | null => {
      if (ref.resolved === null) return null;
      if (moduleOf(ref.from) !== moduleOf(ref.resolved)) return null;
      const fromLayer = layerOf(ref.from);
      const toLayer = layerOf(ref.resolved);
      if (fromLayer === null || toLayer === null) return null;
      const fromRank = LAYER_RANK[fromLayer];
      const toRank = LAYER_RANK[toLayer];
      // Eine unbekannte Schicht darf die Regel NICHT abschalten. Sonst genuegte
      // ein Verzeichnis `planning/services/`, um die Richtungspruefung fuer
      // seine Importe stillzulegen — fail-open genau dort, wo sie wirken soll.
      if (fromRank === undefined) {
        return `Unbekannte Schicht "${fromLayer}". Erlaubt sind ausschliesslich ${Object.keys(LAYER_RANK).join(", ")} (ADR-001 Z. 65-69).`;
      }
      if (toRank === undefined) {
        return `Import nach unbekannter Schicht "${toLayer}". Erlaubt sind ausschliesslich ${Object.keys(LAYER_RANK).join(", ")} (ADR-001 Z. 65-69).`;
      }
      if (toRank <= fromRank) return null;
      return `Schicht "${fromLayer}" darf nicht nach "${toLayer}" importieren — erlaubt ist nur von aussen nach innen (ADR-001 Z. 65-69).`;
    },
  },
  {
    // Keine App-zu-App-Kopplung; Pakete duerfen ueberhaupt keine App importieren.
    id: "no-app-to-app",
    inScope: (file): boolean => file.startsWith("apps/") || file.startsWith("packages/"),
    check: (ref): string | null => {
      if (/^@easytree\/(api|web)$/.test(ref.specifier)) {
        const own = appOf(ref.from);
        if (own === null || `@easytree/${own}` !== ref.specifier) {
          return `"${ref.specifier}" ist eine Anwendung, kein Paket — Anwendungen duerfen einander nicht importieren.`;
        }
        return null;
      }
      if (ref.resolved === null) return null;
      const toApp = appOf(ref.resolved);
      if (toApp === null) return null;
      if (ref.from.startsWith("packages/")) {
        return `Paketcode darf nicht nach "${ref.resolved}" in eine Anwendung greifen.`;
      }
      const fromApp = appOf(ref.from);
      if (fromApp !== null && fromApp !== toApp) {
        return `Anwendung "${fromApp}" darf nicht nach "${ref.resolved}" in Anwendung "${toApp}" greifen.`;
      }
      return null;
    },
  },
  {
    // ADR-001 Z. 77 — nicht nur der Name `shared`, sondern das Muster.
    id: "no-generic-shared-package",
    inScope: (): boolean => true,
    check: (ref): string | null => {
      const scoped = /^@easytree\/([a-z-]+)$/.exec(ref.specifier);
      const name = scoped?.[1];
      if (name !== undefined && GENERIC_PACKAGE_NAMES.includes(name)) {
        return `"${ref.specifier}" ist ein unspezifisches Sammelpaket. ADR-001 Z. 77 erlaubt nur stabile, fachlich benannte Pakete.`;
      }
      if (ref.resolved !== null) {
        const pkg = /^packages\/([a-z-]+)\//.exec(ref.resolved);
        const dir = pkg?.[1];
        if (dir !== undefined && GENERIC_PACKAGE_NAMES.includes(dir)) {
          return `"packages/${dir}" ist ein unspezifisches Sammelpaket (ADR-001 Z. 77).`;
        }
      }
      return null;
    },
  },
  {
    // EYT-47 AK 5 + ADR-002 §5 — packages/contracts ist transport-only.
    //
    // TimeInterval ist eine Klasse mit privaten Feldern, die Bezeichner sind
    // nominal gebrandet: keiner von beiden kann ueber die Leitung. Duerfte der
    // Vertrag Domaintypen fuehren, waere die Trennung eine Konvention. So ist
    // sie eine Importregel, die im Pflichtjob unit-tests scheitert.
    id: "contracts-transport-only",
    inScope: (file): boolean => file.startsWith("packages/contracts/"),
    check: (ref): string | null =>
      ref.specifier === "@easytree/domain" || ref.resolved?.startsWith("packages/domain/") === true
        ? `packages/contracts darf "${ref.specifier}" nicht importieren — der Transportvertrag bleibt frei von Domaintypen (EYT-47 AK 5, ADR-002 §5).`
        : null,
  },
  {
    // ADR-002 §5 — Prototype-Fixtures sind ausschliesslich Clickdummy-/Testdaten.
    id: "no-fixtures-in-production-code",
    inScope: (file): boolean => !/(^|\/)(test|e2e|__tests__)\//.test(file),
    check: (ref): string | null =>
      ref.specifier === "@easytree/prototype-fixtures" ||
      ref.resolved?.startsWith("packages/prototype-fixtures/") === true
        ? `Produktionscode darf "${ref.specifier}" nicht importieren — Prototype-Fixtures sind ausschliesslich Clickdummy-/Testdaten (ADR-002 §5).`
        : null,
  },
];

export function evaluate(refs: readonly ImportRef[]): {
  violations: Violation[];
  scopeCounts: Map<string, Set<string>>;
} {
  const violations: Violation[] = [];
  const scopeCounts = new Map<string, Set<string>>();

  for (const rule of RULES) scopeCounts.set(rule.id, new Set<string>());

  for (const ref of refs) {
    for (const rule of RULES) {
      if (!rule.inScope(ref.from)) continue;
      scopeCounts.get(rule.id)?.add(ref.from);
      const message = rule.check(ref);
      if (message !== null) {
        violations.push({ rule: rule.id, file: ref.from, line: ref.line, message });
      }
    }
  }

  return { violations, scopeCounts };
}

/**
 * `export *` in einer Modul-`index.ts` traegt das gesamte Domainmodell ueber die
 * Grenze und macht aus mehreren Modulen ein globales Modell (EYT-46 AK 5).
 * Benannte Re-Exporte sind der Vertrag; ein Stern ist keiner.
 */
export function findStarReExports(repoRoot: string, files: readonly string[]): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    if (moduleOf(file) === null || !file.endsWith("/index.ts")) continue;
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    const lines = source.split("\n");
    lines.forEach((text, index) => {
      if (/^\s*export\s+(type\s+)?\*/.test(text)) {
        out.push({
          rule: "index-named-exports-only",
          file,
          line: index + 1,
          message:
            "Modul-index.ts darf kein `export *` verwenden — das laundert das Domainmodell ueber die Modulgrenze (EYT-46 AK 5).",
        });
      }
    });
  }
  return out;
}
