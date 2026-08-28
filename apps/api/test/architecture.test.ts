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

import { MODULE_SLUGS, SCAFFOLDED_MODULES, TABLE_OWNERSHIP } from "../src/modules/module-catalogue";
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
/**
 * Der Cloudflare-Entry importiert ABSICHTLICH das tsc-Ergebnis (EYT-142).
 *
 * Nest braucht `emitDecoratorMetadata`, das esbuild nicht erzeugen kann; der
 * Nest-Code muss deshalb aus `apps/api/dist/` kommen. `dist` steht in
 * `SKIP_DIRS` und wird nie gescannt — dieser Import kann also gar nicht
 * aufloesen, und zwar by design, nicht durch Versehen.
 *
 * Bewusst eng gefasst: nur `.mjs`-Dateien direkt unter einem
 * `cloudflare/`-Verzeichnis, und nur Spezifizierer nach `../dist/`. Alles
 * andere faellt weiter unter die Regel. Der Test darunter haelt die Liste der
 * tatsaechlich ausgenommenen Importe fest, damit die Ausnahme nicht wachsen
 * kann, ohne dass es jemand sieht.
 */
function istGewolltUnaufloesbar(von: string, spezifizierer: string): boolean {
  return /^apps\/[^/]+\/cloudflare\/[^/]+\.mjs$/.test(von) && spezifizierer.startsWith("../dist/");
}

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
      .filter((ref) => !istGewolltUnaufloesbar(ref.from, ref.specifier))
      .map((ref) => `${ref.from}:${ref.line} -> ${ref.specifier}`);
    expect(unresolved).toEqual([]);
  });

  it("die Ausnahme fuer Buildartefakte deckt GENAU die bekannten Importe", () => {
    // Ohne diese Zusicherung koennte die Ausnahme oben beliebig wachsen. Hier
    // steht die vollstaendige Liste; ein neuer `../dist/`-Import im
    // Cloudflare-Entry macht diesen Test rot und ist damit eine bewusste
    // Entscheidung im Diff statt einer stillen Erweiterung.
    const ausgenommen = refs
      .filter((ref) => istGewolltUnaufloesbar(ref.from, ref.specifier))
      .map((ref) => `${ref.from} -> ${ref.specifier}`)
      .sort();
    expect(ausgenommen).toEqual([
      "apps/api/cloudflare/entry.mjs -> ../dist/config/config.module.js",
      "apps/api/cloudflare/entry.mjs -> ../dist/main.js",
      "apps/api/cloudflare/entry.mjs -> ../dist/platform/database/role-privileges.js",
      "apps/api/cloudflare/entry.mjs -> ../dist/platform/runtime/role-gate-latch.js",
    ]);
  });

  it.each(RULES.map((rule) => rule.id))("Regel %s ueberwacht mindestens eine Datei", (ruleId) => {
    expect(scopeCounts.get(ruleId)?.size ?? 0).toBeGreaterThan(0);
  });

  it("Regel ui-dependency-allowlist ueberwacht JEDE Datei unter packages/ui/src", () => {
    // `scopeCounts >= 1` unterscheidet nicht zwischen „bewacht das Paket" und
    // „bewacht eine Datei". Gemessen 27.08.2026: eine Verengung auf
    // `packages/ui/src/b` bewacht 1 von 11 Dateien, und VOR dieser Zusicherung
    // blieben dabei beide Suiten vollstaendig gruen — der Waechter waere still
    // abgeruestet gewesen. Diese Zeile nennt die Verengung jetzt beim Namen
    // (1 statt 11); die Sichtbarkeitsprobe im Rot-Fall („laesst react und
    // paketinterne Pfade in packages/ui zu") faellt unabhaengig davon ebenfalls.
    //
    // Die linke Seite kommt aus dem Praefix ueber die eingesammelten Importe,
    // die rechte aus `inScope` der Regel. Beide Wege muessen dieselbe Menge
    // ergeben. Importfreie Dateien tauchen auf keiner Seite auf, deshalb kann
    // ein neues Primitive ohne Import diese Zusicherung nicht falsch rot machen.
    const ausDemPraefix = new Set(
      refs.filter((ref) => ref.from.startsWith("packages/ui/src/")).map((ref) => ref.from),
    );
    expect(ausDemPraefix.size).toBeGreaterThan(5);
    expect([...(scopeCounts.get("ui-dependency-allowlist") ?? [])].sort()).toEqual(
      [...ausDemPraefix].sort(),
    );
  });

  it("Regel feld-shell-boundary ueberwacht JEDE Datei der Feld-Shell", () => {
    // Dieselbe Lehre wie bei ui-dependency-allowlist: `>= 1` unterscheidet
    // nicht zwischen "bewacht die Shell" und "bewacht eine Datei". Die linke
    // Seite kommt aus den Praefixen ueber die eingesammelten Importe, die
    // rechte aus `inScope` der Regel — beide Wege muessen dieselbe Menge
    // ergeben. Importfreie Dateien tauchen auf keiner Seite auf.
    const feldPraefixe = ["apps/web/app/feld/", "apps/web/components/feld/", "apps/web/lib/feld/"];
    const ausDemPraefix = new Set(
      refs
        .filter((ref) => feldPraefixe.some((praefix) => ref.from.startsWith(praefix)))
        .map((ref) => ref.from),
    );
    expect(ausDemPraefix.size).toBeGreaterThan(3);
    expect([...(scopeCounts.get("feld-shell-boundary") ?? [])].sort()).toEqual(
      [...ausDemPraefix].sort(),
    );
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

  it("laesst kein Workspace-Paket ohne echte Testaufgabe zurueck", () => {
    // `turbo run test` fuehrt nur Aufgaben aus, die EXISTIEREN — ein Paket ohne
    // `test`-Skript wird still uebersprungen, nicht rot. Eine einzige geloeschte
    // Zeile in einer package.json wuerde also eine ganze Pflichtpruefung
    // entfernen, waehrend `pnpm test` weiterhin mit 0 endet. Diese Zusicherung
    // steht bewusst in apps/api und damit AUSSERHALB der Pakete, die sie schuetzt.
    const dirs = [
      ...readdirSync(resolve(repoRoot, "apps"), { withFileTypes: true }).map(
        (e) => `apps/${e.name}`,
      ),
      ...readdirSync(resolve(repoRoot, "packages"), { withFileTypes: true }).map(
        (e) => `packages/${e.name}`,
      ),
    ].filter((dir) => existsSync(resolve(repoRoot, dir, "package.json")));

    expect(dirs.length).toBeGreaterThan(4);

    const offenders = dirs.filter((dir) => {
      const pkg: unknown = JSON.parse(readFileSync(resolve(repoRoot, dir, "package.json"), "utf8"));
      const script = (pkg as { scripts?: Record<string, string> }).scripts?.["test"];
      return (
        script === undefined || !script.includes("vitest run") || script.includes("passWithNoTests")
      );
    });
    expect(offenders).toEqual([]);
  });

  it("haelt Modul-index.ts frei von Stern-Re-Exporten", () => {
    expect(starReExports.map((v) => `${v.file}:${v.line}`)).toEqual([]);
  });

  it("meldet keine Grenzverletzung", () => {
    const rendered = violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`);
    // Greppbare Zeile, wie beim Tenant-Gate. Kein eslint-disable noetig:
    // `no-console` ist fuer test/** nicht aktiv, die Direktive war tot.
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

/**
 * Kostenmodul im Katalog (EYT-105 / REQ-001, Baseline S5-REQ-01).
 *
 * Diese drei Zusicherungen koennen NICHT registergetrieben sein — das ist ihr
 * ganzer Zweck. `it.each([...SCAFFOLDED_MODULES])` weiter oben prueft nur, was
 * bereits im Register steht; fehlt `costs` dort, laeuft die Schleife
 * vollstaendig gruen an ihm vorbei. Der Katalog ist damit gegenueber einem
 * unregistrierten Modul blind, und genau diese Luecke schliesst der namentliche
 * Eintrag hier.
 *
 * Die uebrigen Grenzen des Moduls (Schichten, Importrichtungen,
 * SQL-Schreibziele, Verzeichnis- und Exportnamen) stehen in
 * `costs-module-boundaries.test.ts`; ihre Gegenmutationen in
 * `costs-module-boundaries.red-case.test.ts`.
 */
describe("Kostenmodul im Katalog (EYT-105, REQ-001)", () => {
  it("fuehrt `costs` als Modul-Slug", () => {
    expect(
      [...MODULE_SLUGS] as string[],
      "MODULE_SLUGS kennt `costs` nicht. Die Liste stammt aus ADR-001 Z. 60 plus ADR-003 §1 und gilt als eingefroren — die Ergaenzung ist eine Architekturaenderung mit ADR-Pflicht (EYT-105 AC 1, CAN-RISK-03).",
    ).toContain("costs");
  });

  it("fuehrt `costs` als geruestetes Modul", () => {
    // Erst dieser Eintrag richtet die bestehende Inhaltspruefung oben auf das
    // Kostenmodul aus. Ohne ihn duerfte `costs/` leer bleiben.
    expect(
      [...SCAFFOLDED_MODULES] as string[],
      "SCAFFOLDED_MODULES kennt `costs` nicht — der Architekturtest verlangt dann keine echten Dateien in domain/ und application/.",
    ).toContain("costs");
  });

  it("weist `costs` mindestens eine eigene, mandantengebundene Tabelle zu", () => {
    // Tabellenbesitz ist zur Laufzeit NICHT erzwungen (siehe Kopfkommentar von
    // module-catalogue.ts): eine Anwendungsrolle, RLS filtert nach Mandant,
    // nicht nach Modul. Das hier ist die Registereintragung, kein Nachweis
    // durchgesetzter Rechte — und darf auch nicht als solcher gemeldet werden.
    const owned = TABLE_OWNERSHIP.filter((entry) => (entry.owner as string | null) === "costs");
    expect(
      owned.map((entry) => entry.table),
      "TABLE_OWNERSHIP weist dem Kostenmodul keine Tabelle zu (EYT-105 AC 1: Registrierung in ADR, MODULE_SLUGS, SCAFFOLDED_MODULES und Tabellenbesitz).",
    ).not.toEqual([]);
    expect(
      owned.filter((entry) => !entry.tenantOwned).map((entry) => entry.table),
      "Kostentabellen ohne org_id: Kostendaten sind mandantengebunden (ADR-001 Z. 82).",
    ).toEqual([]);
  });

  it("ist in einer ADR beschlossen, nicht nur im Katalog eingetragen", () => {
    // `MODULE_SLUGS` nennt als Quellen ADR-001 Z. 60 plus ADR-003 §1 und
    // eingefroren. Ein elfter Slug ohne Beschluss waere eine stille Aenderung
    // des bindenden Architekturvertrags — EYT-105 AC 1 nennt die ADR deshalb an
    // erster Stelle. Welche Nummer sie traegt und ob sie ADR-001 fortschreibt
    // oder neu ist, entscheidet der Beschluss, nicht dieser Test.
    const adrDir = resolve(repoRoot, "docs/architecture");
    const adrs = readdirSync(adrDir).filter((name) => /^ADR-\d+.*\.md$/.test(name));
    expect(
      adrs.length,
      "keine ADR gefunden — die Suche ist kaputt, nicht das Repository.",
    ).toBeGreaterThan(1);
    const deciding = adrs.filter((name) => {
      const text = readFileSync(resolve(adrDir, name), "utf8");
      return text.includes("EYT-105") && /(^|[^a-z])costs([^a-z]|$)/.test(text);
    });
    expect(
      deciding,
      "Keine ADR unter docs/architecture/ nennt `costs` zusammen mit EYT-105 (EYT-105 AC 1).",
    ).not.toEqual([]);
  });
});
