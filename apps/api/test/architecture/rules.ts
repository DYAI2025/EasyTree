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

/**
 * Was `apps/api/src` ausserhalb von `platform/` importieren darf (EYT-45).
 *
 * Absichtlich kurz und absichtlich vollstaendig: `pg` fehlt hier, weil
 * Datenbankzugriff nur in `platform/` gehoert. Eine neue Zeile in dieser Liste
 * ist eine Entscheidung, die im Review sichtbar wird.
 */
const API_ALLOWED_PACKAGES: readonly RegExp[] = [
  /^@easytree\/(config|domain|contracts)$/,
  /^@nestjs\/(common|core)$/,
  /^express$/,
  /^rxjs$/,
  /^reflect-metadata$/,
  /^node:(crypto|http)$/,
  // EYT-106: die EINE JWT/JWKS-Bibliothek der API (PO-Freigabe 31.07.2026).
  // Erzwingt die Algorithmus-Allowlist statt einer Auswahl nach Token-Header.
  /^jose$/,
];

/**
 * Was `packages/ui/src` importieren darf (EYT-80).
 *
 * Absichtlich eine ALLOWLIST — dieselbe Lehre wie bei `domain-allowlist` im
 * Dateikopf: „domaenenfrei" ist ein universelles Verbot, und eine endliche
 * Liste verbotener Pakete kann es nie ausdruecken. Eine Sperrliste
 * `["@easytree/domain", "next"]` liesse `next/link`, `@easytree/domain/dist/…`
 * und jedes kuenftige Fachpaket durch.
 *
 * `react` steht hier, weil ein React-Primitive ohne React keins ist — und ist
 * der EINZIGE Eintrag. Ein Routerpaket steht bewusst NICHT hier:
 * `DateRangeControl` bekommt sein Link-Element injiziert, damit dasselbe
 * Primitive spaeter die Feld-App bedienen kann (EYT-80,
 * Zwei-Client-Architektur, Confluence 8486960).
 *
 * `react/jsx-runtime` steht ebenfalls nicht hier, und das ist kein Versehen:
 * `tsconfig.build.json` setzt `jsx: "react-jsx"`, der Laufzeitimport entsteht
 * also beim EMIT und nie im Quelltext. `ts.preProcessFile` liest Quelltext,
 * der Spezifizierer kann diese Regel damit gar nicht erreichen. Ein Eintrag,
 * der nie feuern kann, verbraucht die Reviewsichtbarkeit dieser Liste fuer
 * nichts.
 *
 * Dass `"react"` der einzige nicht-relative Spezifizierer unter
 * `packages/ui/src` ist, steht hier bewusst OHNE Dateizahl: die Regel selbst
 * prueft es bei jedem Lauf, denn jeder weitere Spezifizierer waere eine
 * Verletzung. Eine mitgeschriebene Zahl waere dagegen sofort veraltet — genau
 * das ist in diesem Slice passiert, als `4a6429e` eine zwoelfte Datei anlegte.
 */
const UI_ALLOWED_PACKAGES: readonly RegExp[] = [/^react$/];

const UI_PACKAGE = "packages/ui/src/";

/**
 * Was die FELD-SHELL importieren darf (EYT-113).
 *
 * Die Mitarbeiter-Shell (`apps/web/app/feld/`, `apps/web/components/feld/`,
 * `apps/web/lib/feld/`) teilt Auth-, API-, Vertrags- und Domainbasis mit der
 * Werkbank — aber KEINE Werkbank-Oberflaeche: Admin- und Kosten-Komponenten
 * duerfen das Mitarbeiter-Bundle nicht erreichen, auch nicht unbeabsichtigt.
 * Wieder eine ALLOWLIST (dieselbe Lehre wie `domain-allowlist`): eine
 * Sperrliste `components/kosten-*` liesse jede kuenftige Admin-Komponente
 * durch, bis jemand die Liste pflegt.
 *
 * `@easytree/domain` steht bewusst NICHT hier: die Feld-Shell dieses
 * Inkrements braucht es nicht, und eine Allowlist waechst erst, wenn ein
 * realer Konsument es verlangt.
 */
const FELD_SHELL_SCOPES: readonly string[] = [
  "apps/web/app/feld/",
  "apps/web/components/feld/",
  "apps/web/lib/feld/",
];

const FELD_ALLOWED_PACKAGES: readonly RegExp[] = [
  /^react$/,
  /^next$/,
  /^next\/.+$/,
  /^@easytree\/ui$/,
  /^@easytree\/contracts$/,
];

/**
 * Wohin relative Importe der Feld-Shell aufgeloest zeigen duerfen: in die
 * Feld-Verzeichnisse selbst und in die geteilte Infrastruktur `lib/`
 * (Session-Provider, Gateways, Proxyziel). `components/` ausserhalb von
 * `components/feld/` ist Werkbank-Oberflaeche und bleibt draussen.
 */
const FELD_ALLOWED_RESOLVED: readonly string[] = [
  "apps/web/app/feld/",
  "apps/web/components/feld/",
  "apps/web/lib/",
];

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
    // EYT-45 — Datenbankzugriff nur aus der Datenbankplattform.
    //
    // Der eigentliche Fund, der diese Regel ausgeloest hat: `pg` ist bereits
    // Abhaengigkeit von @easytree/api. Ein Repository mit
    // `import { Pool } from "pg"` und `config.databaseUrl` haette alle neun
    // Pflichtchecks passiert und ohne jeden Tenantkontext gequert — an
    // Transaktionsgrenze, Rollenwechsel und RLS vorbei.
    //
    // Formuliert als ALLOWLIST, nicht als Sperrliste fuer Treibernamen. Eine
    // Sperrliste haette `pg-pool`, `postgres`, `typeorm`, `drizzle-orm` und
    // jedes kuenftige SDK einzeln fuehren muessen — dieselbe Lehre wie bei
    // `domain-allowlist` (siehe Dateikopf). Ausserhalb von
    // `apps/api/src/platform/` darf nur importiert werden, was hier steht;
    // alles Neue ist eine bewusste Entscheidung, kein Nebeneffekt.
    id: "api-dependency-allowlist",
    inScope: (file): boolean =>
      file.startsWith("apps/api/src/") && !file.startsWith("apps/api/src/platform/"),
    check: (ref): string | null => {
      if (ref.specifier.startsWith(".")) return null;
      if (API_ALLOWED_PACKAGES.some((allowed) => allowed.test(ref.specifier))) return null;
      return `"${ref.specifier}" steht nicht auf der Importliste von apps/api/src. Datenbanktreiber und Query-Builder gehoeren ausschliesslich nach apps/api/src/platform/ (EYT-45); jede andere neue Abhaengigkeit gehoert zuerst in diese Liste.`;
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
  {
    // EYT-103 — die kanonische Gateway-Suite importiert Vitest und ist
    // ausdrücklich Testinfrastruktur. Ein Import aus Produktionscode würde
    // Test-Runner und Fixtures in die Laufzeitoberfläche ziehen.
    id: "no-contract-testing-in-production-code",
    inScope: (file): boolean => !/(^|\/)(test|testing|e2e|__tests__)\//.test(file),
    check: (ref): string | null =>
      ref.specifier.startsWith("@easytree/contracts/testing/") ||
      ref.resolved?.startsWith("packages/contracts/src/testing/") === true
        ? `Produktionscode darf "${ref.specifier}" nicht importieren — @easytree/contracts/testing/* ist ausschliesslich Testinfrastruktur (EYT-103).`
        : null,
  },
  {
    // EYT-80 — `packages/ui` ist domaenenfrei, API-frei, auth-frei und
    // routerunabhaengig (ADR-001 Z. 77, Basisdesign v2.0, Zwei-Client-
    // Architektur). Bis EYT-80 stand das als Zusage im Dateikopf von
    // `packages/ui/src/index.ts` und sonst nirgends. Vier Regeln sahen
    // `packages/ui` zwar im Geltungsbereich (`no-app-to-app`,
    // `no-generic-shared-package`, `no-fixtures-in-production-code`,
    // `no-contract-testing-in-production-code`), aber alle vier sind enge
    // Verbote: KEINE beschraenkte die Abhaengigkeitsoberflaeche, und
    // `@easytree/domain` wie `next/link` waeren durch alle vier gelaufen
    // (gemessen 27.08.2026 am Stand vor dieser Regel: 11 Dateien unter
    // packages/ui/src, und 0 Regeln mit Importliste).
    //
    // Die Dateizahl ist eine Momentaufnahme und waechst mit dem Paket — sie
    // traegt hier nichts und darf nicht nachgepflegt werden. Verbindlich ist
    // die Zusicherung „Regel ui-dependency-allowlist ueberwacht JEDE Datei
    // unter packages/ui/src" in `architecture.test.ts`: sie vergleicht den
    // Geltungsbereich bei JEDEM Lauf gegen die tatsaechlich eingesammelten
    // Dateien und geht rot, wenn die Regel eine davon nicht sieht. Genau
    // diese Zeile war schon einmal falsch: `4a6429e` legte `app-shell.tsx`
    // an und machte aus 11 zwoelf, ohne dass irgendetwas rot wurde.
    //
    // Geltungsbereich ist `src/` und NICHT das ganze Paket: `test/` importiert
    // zu Recht vitest und @testing-library, die eine Paket-Allowlist ablehnen
    // muesste. `src/` ist zugleich genau die ausgelieferte Oberflaeche
    // (tsconfig.build.json `include: ["src"]`, package.json `files: ["dist"]`).
    id: "ui-dependency-allowlist",
    inScope: (file): boolean => file.startsWith(UI_PACKAGE),
    check: (ref): string | null => {
      if (ref.isTypeReference) {
        return `packages/ui darf keine /// <reference types="${ref.specifier}" /> fuehren — sie zieht eine ganze Ambient-Oberflaeche in den Scope.`;
      }
      if (!ref.specifier.startsWith(".")) {
        if (UI_ALLOWED_PACKAGES.some((allowed) => allowed.test(ref.specifier))) return null;
        return `"${ref.specifier}" steht nicht auf der Importliste von packages/ui/src. Erlaubt sind ausschliesslich react und paketinterne relative Pfade — Fachbegriffe, Vertraege, Router und HTTP-Clients gehoeren in die Anwendung. Der Ausweg ist NICHT, diese Liste zu erweitern: ein Primitive bekommt sein Link-Element, seinen Formatierer oder seine Daten als Prop injiziert, damit es auch die Feld-App bedienen kann (EYT-80).`;
      }
      if (ref.resolved === null) {
        return `Relativer Import "${ref.specifier}" ist nicht aufloesbar — der Scanner koennte ihn sonst stillschweigend uebergehen.`;
      }
      if (!ref.resolved.startsWith(UI_PACKAGE)) {
        return `packages/ui darf nicht nach "${ref.resolved}" hinausgreifen (EYT-80).`;
      }
      return null;
    },
  },
  {
    // EYT-113 — die Import-Grenze der Zwei-Client-Architektur, als Allowlist.
    id: "feld-shell-boundary",
    inScope: (file): boolean => FELD_SHELL_SCOPES.some((scope) => file.startsWith(scope)),
    check: (ref): string | null => {
      if (ref.isTypeReference) {
        return `Die Feld-Shell darf keine /// <reference types="${ref.specifier}" /> fuehren — sie zieht eine ganze Ambient-Oberflaeche in den Scope.`;
      }
      if (!ref.specifier.startsWith(".")) {
        if (FELD_ALLOWED_PACKAGES.some((allowed) => allowed.test(ref.specifier))) return null;
        return `"${ref.specifier}" steht nicht auf der Importliste der Feld-Shell (EYT-113). Erlaubt sind react, next, @easytree/ui und @easytree/contracts. Der Ausweg ist NICHT, diese Liste blind zu erweitern: was die Feld-Shell braucht, kommt als geteiltes Primitive nach packages/ui oder als geteilte Infrastruktur nach apps/web/lib.`;
      }
      const resolved = ref.resolved;
      if (resolved === null) {
        return `Relativer Import "${ref.specifier}" ist nicht aufloesbar — der Scanner koennte ihn sonst stillschweigend uebergehen.`;
      }
      if (!FELD_ALLOWED_RESOLVED.some((prefix) => resolved.startsWith(prefix))) {
        return `Die Feld-Shell darf nicht nach "${resolved}" greifen (EYT-113): Werkbank-Komponenten und -Seiten bleiben aus dem Mitarbeiter-Bundle draussen.`;
      }
      return null;
    },
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
 * EYT-113 Inkrement 2 — das Server-Gate der Kosten-Seiten.
 *
 * Jede `page.tsx` unter `apps/web/app/(werkbank)/kosten/` MUSS
 * `lib/kosten-freigabe` importieren: dort liegt `leseKostenFreigabe()`, die
 * serverseitige, fail-closed Ladegrenze (costs.read der AUSGEWAEHLTEN
 * Organisation). Eine Kosten-Seite ohne diesen Import rendert Kosteninhalt
 * ohne Grenze — genau der Gate-Bypass, den EYT-113 verbietet.
 *
 * Wie `findStarReExports` bewusst KEIN Eintrag in `RULES`: das dortige
 * `check(ref)` sieht einen einzelnen Import und kann Anwesenheit nur
 * VERBIETEN. Eine Anwesenheits-PFLICHT braucht den Blick auf die ganze Datei
 * samt Dateiliste — eine Seite ohne den Import erzeugt schlicht keinen `ref`,
 * an dem eine ref-basierte Regel feuern koennte.
 *
 * Geprueft wird ueber den AUFGELOESTEN Importgraphen (`ref.resolved`), nicht
 * ueber rohen Quelltext: `../../../lib/kosten-freigabe` und
 * `../../../../lib/kosten-freigabe` treffen beide dieselbe Datei, und ein
 * auskommentierter oder stringfoermiger Treffer zaehlt dank
 * `ts.preProcessFile` gar nicht erst als Import.
 *
 * Nicht-Leerlauf: unter dem Muster MUESSEN mindestens 2 Seiten liegen
 * (`/kosten` und `/kosten/stundensaetze`). Faellt die Zahl darunter —
 * Umbenennung, Glob-Rost, SKIP_DIRS-Fehler —, meldet die Regel das als
 * eigene Verletzung, statt still gruen zu bleiben.
 */
const KOSTEN_SEITEN_MUSTER = /^apps\/web\/app\/\(werkbank\)\/kosten\/(?:.+\/)?page\.tsx$/;
const KOSTEN_FREIGABE_DATEI = "apps/web/lib/kosten-freigabe.ts";
const KOSTEN_SEITEN_MINDESTZAHL = 2;

export function findKostenSeitenOhneServerGate(
  files: readonly string[],
  refs: readonly ImportRef[],
): Violation[] {
  const out: Violation[] = [];
  const seiten = files.filter((file) => KOSTEN_SEITEN_MUSTER.test(file));
  if (seiten.length < KOSTEN_SEITEN_MINDESTZAHL) {
    out.push({
      rule: "kosten-server-gate",
      file: "apps/web/app/(werkbank)/kosten/",
      line: 0,
      message: `Nur ${seiten.length} Kosten-Seite(n) unter apps/web/app/(werkbank)/kosten/ gefunden, erwartet sind mindestens ${KOSTEN_SEITEN_MINDESTZAHL}. Entweder wurden Seiten verschoben/umbenannt (dann Muster UND Mindestzahl bewusst nachziehen) oder der Scanner sieht sie nicht mehr — in beiden Faellen darf die Regel nicht still gruen bleiben (EYT-113 Inkrement 2).`,
    });
  }
  for (const seite of seiten) {
    const hatGate = refs.some(
      (ref) => ref.from === seite && ref.resolved === KOSTEN_FREIGABE_DATEI,
    );
    if (!hatGate) {
      out.push({
        rule: "kosten-server-gate",
        file: seite,
        line: 1,
        message: `${seite} importiert lib/kosten-freigabe nicht — jede Kosten-Seite MUSS die serverseitige Ladegrenze leseKostenFreigabe() vor jedem Kosteninhalt rufen (EYT-113 Inkrement 2, fail-closed).`,
      });
    }
  }
  return out;
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
