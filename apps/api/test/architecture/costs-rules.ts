/**
 * Grenzregeln des Kostenmoduls (EYT-105 / REQ-001, Baseline S5-REQ-01).
 *
 * Kein `.test.ts`-Suffix: bewusst Helfer, keine eigene Suite — dieselbe
 * Konvention wie `architecture/scan.ts` und `architecture/rules.ts`.
 *
 * ## Warum eine eigene Regeldatei
 *
 * Die Regeln in `architecture/rules.ts` arbeiten ausschliesslich auf
 * Importbeziehungen. Vier der sieben Zusicherungen aus S5-REQ-01 sind aber
 * keine Importfragen: Verzeichnisnamen (`shared`/`services`), SQL-Zugriffsziele,
 * exportierte Deklarationsnamen (zweite Money-Implementierung) und die Frage,
 * aus welcher SCHICHT ein ueber `index.ts` re-exportiertes Symbol stammt.
 * Dafuer braucht es Dateisystem und AST — nicht die Importliste.
 *
 * ## Nicht-Leerlauf
 *
 * `evaluateCostsRules` liefert je Regel zurueck, WELCHE Dateien bzw.
 * Verzeichnisse sie tatsaechlich betrachtet hat. Der Test verlangt fuer jede
 * Regel mindestens eines. Ohne diese Bindung waere fast jede Regel gruen,
 * solange `apps/api/src/modules/costs/` fehlt — also ausgerechnet dann, wenn
 * REQ-001 nicht erfuellt ist.
 *
 * Eine Regel hat bewusst eine weite TREFFERSEITE: `costs-xlsx-behind-application-port`
 * sieht ganz `apps/**` und `packages/**`, damit eine XLSX-Bibliothek auch dann
 * auffaellt, wenn sie ausserhalb von `costs/` landet. Ihr Nicht-Leerlauf-Zaehler ist
 * davon getrennt und an `costs/` gebunden — er faellt ohne Modul auf 0, wie bei den
 * sechs anderen. Eine fruehere Fassung zaehlte dort alle gescannten Dateien (224) und
 * konnte deshalb nie fehlschlagen.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

import { moduleOf } from "./rules";
import type { ImportRef } from "./scan";

const MODULES_PREFIX = "apps/api/src/modules/";

export const COSTS_MODULE_DIR = `${MODULES_PREFIX}costs`;
export const COSTS_INDEX = `${COSTS_MODULE_DIR}/index.ts`;
export const PLANNING_INDEX = `${MODULES_PREFIX}planning/index.ts`;

/** Die vier eingefrorenen Schichten (ADR-001 Z. 65-69, PRD REQ-001). */
export const COSTS_LAYER_DIRS = ["domain", "application", "infrastructure", "interface"] as const;

/**
 * Bibliotheksfamilien, die im Domaincode des Kostenmoduls verboten sind.
 * Die Liste dient der MELDUNG, nicht der Entscheidung: entschieden wird per
 * Allowlist (nur relativ innerhalb `costs/domain/` und `@easytree/domain`).
 * Eine Sperrliste allein waere aus demselben Grund untauglich wie bei
 * `domain-allowlist` — `http` statt `node:http`, `pg-pool` statt `pg`.
 */
const FORBIDDEN_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^@nestjs\//, "NestJS"],
  [/^(node:)?(http|https|http2)$/, "HTTP"],
  [/^(pg|pg-pool|pg-promise|pg-native|postgres)(\/|$)/, "PostgreSQL"],
  [/^@supabase\//, "Supabase"],
];

/**
 * XLSX-Bibliotheken. Heute existiert keine im Monorepo (PRD REQ-007,
 * Repository-Befund 30.07.2026) — die erste ist eine bewusste Entscheidung mit
 * Supply-Chain-Pruefung, kein Nebeneffekt.
 */
export const XLSX_LIBRARY_PATTERN =
  /(^|\/)(xlsx|sheetjs|exceljs|excel4node|node-xlsx|write-excel-file|xlsx-populate)([/-]|$)/i;

/**
 * Unspezifische Sammelverzeichnisse. S5-REQ-01 verbietet den `shared`-/
 * `services`-Container; verboten ist die Sache, nicht nur die zwei Namen —
 * dieselbe Lehre wie bei `no-generic-shared-package` (ADR-001 Z. 77).
 */
const GENERIC_DIR_NAMES: ReadonlySet<string> = new Set([
  "shared",
  "services",
  "service",
  "common",
  "utils",
  "util",
  "helpers",
  "helper",
  "misc",
  "core",
  "lib",
  "libs",
]);

/**
 * Geld- und Rundungsvokabular. Exakte Namen treffen jede Exportart, die
 * Praefixe nur funktionsartige Exporte — sonst faellt `roundingRuleVersion`
 * (eine legitime Regelversion aus REQ-005) faelschlich mit hinein.
 */
const MONEY_EXACT_NAMES: ReadonlySet<string> = new Set([
  "Money",
  "MoneyAmount",
  "Amount",
  "Betrag",
  "Currency",
  "Waehrung",
  "Rounding",
  "Rundung",
  "MinorUnits",
  "Cents",
]);

const MONEY_FUNCTION_PATTERN =
  /^(round|rund|toMinor|fromMinor|toCents|fromCents|toMajor|fromMajor|addMoney|subtractMoney|multiplyMoney|divideMoney|allocateMoney|splitMoney|formatMoney|formatEuro|parseMoney)/i;

/**
 * SQL-Zugriffsziele im Kostenmodul — LESEND und SCHREIBEND.
 *
 * Die Jira-Akzeptanz von EYT-105 sagt woertlich: modulfremde Planfakten werden
 * „nur ueber eine oeffentliche Planning-Application-API beziehungsweise einen
 * expliziten Port **gelesen**". Ein Kosten-Repository, das `public.assignments`
 * direkt selektiert, verletzt die AK — deshalb reichen Schreibverben nicht.
 *
 * `update` verlangt das nachfolgende `set`, sonst traefe das Wort Prosa.
 *
 * Bewusst NICHT abgedeckt (statt still durchzulassen):
 * - **Ueber Literalgrenzen zusammengesetztes SQL.** Jedes Literal wird fuer
 *   sich betrachtet; ein CTE-Name aus Fragment A gilt in Fragment B nicht als
 *   bekannt und wuerde dort als unregistrierte Tabelle gemeldet — laut, nicht
 *   still.
 * - **`FROM ONLY <tabelle>`** (Vererbungssyntax): erfasst wuerde `only`.
 * - **DDL ausser `truncate`.** Schema entsteht ausschliesslich in
 *   `supabase/migrations/`; `create/alter/drop table` in Modulcode waere ein
 *   anderes, groesseres Problem als Tabellenbesitz.
 * - **Dynamisch zusammengebaute Tabellennamen** (`from ${schema}.${name}`):
 *   der Platzhalter ist kein Bezeichner und wird nicht geraten.
 * - **Unqualifiziertes Ziel in einem verblosen Fragment** (`join assignments a`
 *   ohne `public.`, in einem Templateliteral-Stueck hinter einer Interpolation):
 *   dort greift weder die Statement- noch die Qualifizierungs-Zulassung. Der
 *   Hausstil schreibt schema-qualifiziert; die Luecke steht hier, damit sie
 *   nicht als Abdeckung gelesen wird.
 */
const SQL_WRITE_TARGETS: ReadonlyArray<readonly [string, RegExp]> = [
  ["insert into", /\binsert\s+into\b\s+([\w$".]+)/gi],
  ["merge into", /\bmerge\s+into\b\s+([\w$".]+)/gi],
  ["update … set", /\bupdate\b\s+([\w$".]+)\s+set\b/gi],
  ["delete from", /\bdelete\s+from\b\s+([\w$".]+)/gi],
  ["truncate", /\btruncate\b(?:\s+table\b)?\s+([\w$".]+)/gi],
];

/**
 * Sieht das Literal ueberhaupt nach SQL aus?
 *
 * Verlangt ein Statement-Verb. Das ist absichtlich eng: `from` und `join`
 * allein kommen in deutscher Prosa vor, `select … from` nicht.
 *
 * `with` steht bewusst NICHT in dieser Liste, obwohl es ein Statement einleitet:
 * es ist ein gewoehnliches englisches Wort, und gemessen genuegte es, um
 * "Compare with the published plan, values taken from planung" zu einem
 * Tabellenzugriff `public.planung` zu machen. CTEs werden stattdessen an
 * `SQL_CTE_NAMES` erkannt — die Form `with x as (` kommt in Prosa nicht vor.
 */
const SQL_STATEMENT_HINT = /\b(select|insert|update|delete|merge|truncate)\b/i;

/** `from`, `join` und `using` als Lesequellen. */
const SQL_READ_TARGETS = /\b(from|join|using)\b\s+([\w$".]+)/gi;

/** Kommagetrennte Fortsetzung einer Lesequelle, mit optionalem Alias: `from a x, b y`. */
const SQL_READ_CONTINUATION = /^\s*(?:as\s+)?(?:[\w$"]+\s*)?,\s*([\w$".]+)/i;

/**
 * `extract(day FROM ts)`, `substring(x FROM 1)`, `trim(both 'x' FROM y)`:
 * dort ist `from` ein Operator, keine Tabellenquelle. Wird auf den Text VOR dem
 * Schluesselwort angewandt.
 */
const SQL_FROM_OPERATOR = /\b(extract|substring|trim|overlay|position)\s*\([^()]*$/i;

/** Namen von Common Table Expressions — sie sind keine Tabellen. */
const SQL_CTE_NAMES = /(?:\bwith\s+(?:recursive\s+)?|,\s*)("?[\w$]+"?)\s+as\s*\(/gi;

/**
 * Ein qualifiziertes Ziel: `bezeichner.bezeichner`, GANZ, nicht bloss irgendwo
 * ein Punkt.
 *
 * Der Anker `^…$` ist der Kern der Aussage. `SQL_READ_TARGETS` zieht ein
 * folgendes Satzzeichen mit ins Ziel, also verwirft ein blosser Punkttest
 * nichts: gemessen las er `from planung.` (deutscher Satzpunkt),
 * `from ./infrastructure` und `using 2.5` als Tabellenzugriffe. Der Anker
 * verwirft genau diese drei Formen, weil keine davon zwei vollstaendige
 * Bezeichner um den Punkt hat.
 *
 * BEWUSST KEINE SCHEMA-LISTE. Eine erste Fassung fuehrte hier
 * `public|app|auth|storage` als Positivliste — von Hand aus den Migrationen
 * abgelesen und dabei unvollstaendig: `pg_catalog` (z. B.
 * `pg_catalog.pg_timezone_names` in Migration `0004`) und `extensions` fehlten.
 * Die Folge waere still gewesen, nicht laut: Regel `costs-touches-only-own-tables`
 * meldet auch UNregistrierte Tabellen, ein Zugriff auf ein unbekanntes Schema
 * waere also einfach verschwunden. Eine Positivliste, die veralten kann und
 * beim Veralten stumm wird, ist an einem Waechter die falsche Bauart.
 *
 * Preis dieser Entscheidung, benannt statt verschwiegen: ein Prosaziel der Form
 * `bezeichner.bezeichner` — etwa "Vorlage stammt from vorlage.xlsx" — feuert.
 * Das ist die gewollte Richtung: ein Ueberfeuer macht `unit-tests` rot und wird
 * bemerkt, ein Unterfeuer nicht.
 */
const SQL_QUALIFIED_TARGET = /^"?[a-z_][\w$]*"?\."?[a-z_][\w$]*"?$/i;

interface SqlAccess {
  readonly verb: string;
  readonly access: "lesend" | "schreibend";
  /** Immer schemaqualifiziert und kleingeschrieben. */
  readonly table: string;
  /** Zeilenversatz innerhalb des Literals, 1-basiert. */
  readonly line: number;
}

function qualify(raw: string): string {
  const bare = raw.replace(/"/g, "").toLowerCase();
  return bare.includes(".") ? bare : `public.${bare}`;
}

/**
 * Alle Tabellenzugriffe eines SQL-Literals.
 *
 * Erwartet den INHALT eines String-/Templateliterals, nicht den Rohquelltext:
 * `from` steht in TypeScript in jedem `import … from "…"`, ein Rohtextscan
 * wuerde daraus Falschtreffer wie `public.../planning` machen und die Regel
 * unbrauchbar.
 */
export function sqlAccesses(literal: string): SqlAccess[] {
  const out: SqlAccess[] = [];
  // Zwei Ueberfeuer-/Unterfeuer-Faelle, beide gemessen, beide hier balanciert.
  //
  // Ohne jede Vorpruefung lief der Leseabgleich ueber JEDES Stringliteral, und
  // deutsche Prosa traf ihn sofort: "Konflikt entsteht beim join mehrerer
  // Zeilen" ergab `public.mehrerer`, "Wert stammt from planung" ergab
  // `public.planung`. Ein Waechter, der bei einer harmlosen Meldung feuert,
  // wird abgeschaltet.
  //
  // Ein FRUEHER ABBRUCH auf ein Statement-Verb war aber die Ueberkorrektur:
  // `stringLiterals` liefert Templateliterale STUECKWEISE, und das Stueck hinter
  // einer Interpolation (` s\n join public.assignments a on …`) traegt kein Verb.
  // Gemessen ging damit ein echter EYT-105-Verstoss still durch — die
  // schlechtere Richtung, weil ein stummer Waechter nicht auffaellt.
  //
  // Deshalb ZWEI Zulassungen statt eines Tors: entweder das Literal sieht nach
  // einem Statement aus, oder das Ziel traegt ein Schemapraefix dieses Projekts.
  //
  // Die zweite Zulassung war zuerst ein blosser Punkttest (`raw.includes(".")`),
  // begruendet mit "Prosa nennt keine qualifizierten Tabellennamen". Gemessen ist
  // das falsch: `SQL_READ_TARGETS` zieht den Satzpunkt mit ins Ziel, also wurden
  // "Der Wert stammt from planung." zu `from planung.`, "…beim join mehrerer." zu
  // `join mehrerer.`, "from ./infrastructure" zu `from .` und "using 2.5 Stunden"
  // zu `using 2.5`. `SQL_QUALIFIED_TARGET` verlangt stattdessen zwei
  // vollstaendige Bezeichner um den Punkt, ueber dem GANZEN Ziel.
  const cteNames = new Set<string>();
  for (const match of literal.matchAll(SQL_CTE_NAMES)) {
    const name = match[1];
    if (name !== undefined) cteNames.add(qualify(name));
  }
  // CTEs sind der Grund, warum `with` aus SQL_STATEMENT_HINT entfernt wurde: die
  // Form `with x as (` erkennt sie praeziser als das blosse englische Wort.
  const looksLikeSql = SQL_STATEMENT_HINT.test(literal) || cteNames.size > 0;

  const push = (verb: string, access: SqlAccess["access"], raw: string, index: number): void => {
    // Zwei Restluecken, beide benannt statt verschwiegen:
    //
    // UNTERFEUER: ein unqualifiziertes Ziel in einem verblosen Fragment
    // (`join assignments a on …` ohne `public.`) faellt durch beide Zulassungen.
    // Der Hausstil schreibt schema-qualifiziert — gemessen ist JEDES Ziel im
    // echten `apps/api/src/modules/` `public.`-qualifiziert; wer das aendert,
    // muss diese Zeile mitaendern.
    //
    // UEBERFEUER: Prosa, die ein Statement-Verb UND ein `from`/`join`/`using`
    // enthaelt ("Diese Methode wird beim update aufgerufen, Werte kommen from
    // planung"), meldet weiterhin einen Zugriff. Das ist die bewusst gewaehlte
    // Richtung: ein Ueberfeuer macht `unit-tests` rot und wird bemerkt, ein
    // Unterfeuer ist still.
    if (!looksLikeSql && !SQL_QUALIFIED_TARGET.test(raw)) return;
    const table = qualify(raw);
    if (cteNames.has(table)) return;
    out.push({ verb, access, table, line: lineOf(literal, index) });
  };

  for (const [verb, pattern] of SQL_WRITE_TARGETS) {
    for (const match of literal.matchAll(pattern)) {
      const raw = match[1];
      if (raw === undefined || match.index === undefined) continue;
      push(verb, "schreibend", raw, match.index);
    }
  }

  for (const match of literal.matchAll(SQL_READ_TARGETS)) {
    const keyword = match[1]?.toLowerCase();
    const raw = match[2];
    if (keyword === undefined || raw === undefined || match.index === undefined) continue;
    const before = literal.slice(0, match.index);
    // `delete from` ist bereits als Schreibziel erfasst — nicht doppelt melden.
    if (keyword === "from" && /\bdelete\s+$/i.test(before)) continue;
    if (keyword === "from" && SQL_FROM_OPERATOR.test(before)) continue;
    let cursor = match.index + match[0].length;
    // `from unnest(...)`, `from now()`: mengenliefernde Funktion, keine Tabelle.
    if (/^\s*\(/.test(literal.slice(cursor))) continue;
    push(keyword, "lesend", raw, match.index);
    for (;;) {
      const next = SQL_READ_CONTINUATION.exec(literal.slice(cursor));
      const table = next?.[1];
      if (next === undefined || next === null || table === undefined) break;
      push(keyword, "lesend", table, cursor);
      cursor += next[0].length;
    }
  }

  return out;
}

export interface CostsFinding {
  readonly rule: string;
  /** Repo-relativer Pfad, bei Bedarf mit `:zeile`. */
  readonly location: string;
  readonly message: string;
}

export interface TableOwner {
  readonly table: string;
  readonly owner: string | null;
}

export interface CostsInput {
  readonly repoRoot: string;
  /** Repo-relative Quelldateien, wie sie `collectSourceFiles` liefert. */
  readonly files: readonly string[];
  readonly refs: readonly ImportRef[];
  /** Tabellenbesitzregister. Injiziert, damit der Rot-Fall sein eigenes fuehren kann. */
  readonly tableOwnership: readonly TableOwner[];
}

export interface CostsRuleResult {
  readonly findings: readonly CostsFinding[];
  /** Dateien bzw. Verzeichnisse, die die Regel wirklich betrachtet hat. */
  readonly seen: ReadonlySet<string>;
}

export interface CostsRule {
  readonly id: string;
  readonly summary: string;
  readonly evaluate: (input: CostsInput) => CostsRuleResult;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function isInCosts(file: string): boolean {
  return file.startsWith(`${COSTS_MODULE_DIR}/`);
}

function isCostsLayer(file: string, layer: string): boolean {
  return file.startsWith(`${COSTS_MODULE_DIR}/${layer}/`);
}

function read(input: CostsInput, file: string): string {
  return readFileSync(resolve(input.repoRoot, file), "utf8");
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function familyOf(specifier: string): string | null {
  for (const [pattern, name] of FORBIDDEN_FAMILIES) {
    if (pattern.test(specifier)) return name;
  }
  if (XLSX_LIBRARY_PATTERN.test(specifier)) return "XLSX";
  return null;
}

/** Alle Verzeichnisse unterhalb von `rel`, repo-relativ, rekursiv. */
export function collectDirectories(repoRoot: string, rel: string): string[] {
  const out: string[] = [];
  if (!existsSync(resolve(repoRoot, rel))) return out;
  const walk = (currentRel: string): void => {
    for (const entry of readdirSync(resolve(repoRoot, currentRel), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const childRel = `${currentRel}/${entry.name}`;
      out.push(childRel);
      walk(childRel);
    }
  };
  walk(rel);
  return out.sort();
}

export interface SourceLiteral {
  /** Inhalt des Literals, ohne Anfuehrungszeichen. */
  readonly text: string;
  /** Zeile im Quelltext, in der das Literal beginnt (1-basiert). */
  readonly line: number;
}

/**
 * Alle String- und Templateliterale einer Datei.
 *
 * Templateliterale mit Platzhaltern werden stueckweise geliefert (Head und je
 * Span das Literalstueck) — der Platzhalter selbst ist kein Bezeichner und wird
 * nicht geraten.
 */
export function stringLiterals(source: string, fileName: string): SourceLiteral[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const out: SourceLiteral[] = [];
  const push = (node: ts.Node, text: string): void => {
    out.push({
      text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      push(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      push(node.head, node.head.text);
      for (const span of node.templateSpans) push(span.literal, span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

interface ExportedDeclaration {
  readonly name: string;
  readonly line: number;
  readonly functionLike: boolean;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false
  );
}

/** Top-Level-Exporte einer Datei mit der Information, ob sie funktionsartig sind. */
export function exportedDeclarations(source: string, fileName: string): ExportedDeclaration[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const out: ExportedDeclaration[] = [];
  const lineAt = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name !== undefined) {
        out.push({ name: statement.name.text, line: lineAt(statement), functionLike: true });
      }
      continue;
    }
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      out.push({ name: statement.name.text, line: lineAt(statement), functionLike: false });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        const functionLike =
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer) ||
            ts.isClassExpression(initializer));
        out.push({ name: declaration.name.text, line: lineAt(declaration), functionLike });
      }
    }
  }
  return out;
}

interface BoundSymbols {
  readonly names: readonly string[];
  /** `import * as x` bzw. `export * from` — verdeckt, welche Symbole benutzt werden. */
  readonly wildcard: boolean;
  readonly line: number;
}

/**
 * Welche Symbole eine Datei aus den genannten Spezifizierern bindet.
 *
 * Die Spezifizierer kommen aus der bereits aufgeloesten Importliste
 * (`ImportRef.resolved`); hier wird nur noch nach dem Textliteral gesucht. So
 * bleibt die Pfadaufloesung an genau einer Stelle — in `architecture/scan.ts`.
 */
export function boundSymbolsFrom(
  source: string,
  fileName: string,
  specifiers: ReadonlySet<string>,
): BoundSymbols[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const out: BoundSymbols[] = [];
  const lineAt = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!specifiers.has(statement.moduleSpecifier.text)) continue;
      const clause = statement.importClause;
      const names: string[] = [];
      let wildcard = false;
      if (clause?.name !== undefined) names.push(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamespaceImport(bindings)) wildcard = true;
        else
          for (const element of bindings.elements)
            names.push(element.propertyName?.text ?? element.name.text);
      }
      out.push({ names, wildcard, line: lineAt(statement) });
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      if (!specifiers.has(specifier.text)) continue;
      const clause = statement.exportClause;
      if (clause === undefined) {
        out.push({ names: [], wildcard: true, line: lineAt(statement) });
        continue;
      }
      if (ts.isNamedExports(clause)) {
        out.push({
          names: clause.elements.map((element) => element.propertyName?.text ?? element.name.text),
          wildcard: false,
          line: lineAt(statement),
        });
      }
    }
  }
  return out;
}

/**
 * Symbol -> Quellspezifizierer einer oeffentlichen Modul-`index.ts`.
 * Damit ist beantwortbar, aus welcher SCHICHT ein re-exportiertes Symbol kommt.
 */
export function publicExportSources(source: string, fileName: string): Map<string, string> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const map = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    const specifier = statement.moduleSpecifier;
    const from = specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : "";
    for (const element of clause.elements) map.set(element.name.text, from);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

export const COSTS_RULES: readonly CostsRule[] = [
  {
    id: "costs-domain-purity",
    summary:
      "Domaincode des Kostenmoduls importiert weder NestJS, HTTP, PostgreSQL, Supabase noch XLSX (S5-REQ-01, ADR-001 Z. 74).",
    evaluate: ({ refs }): CostsRuleResult => {
      const findings: CostsFinding[] = [];
      const seen = new Set<string>();
      for (const ref of refs) {
        if (!isCostsLayer(ref.from, "domain")) continue;
        seen.add(ref.from);
        const at = `${ref.from}:${ref.line}`;
        if (ref.isTypeReference) {
          findings.push({
            rule: "costs-domain-purity",
            location: at,
            message: `/// <reference types="${ref.specifier}" /> zieht eine ganze Ambient-Oberflaeche in den Domaincode.`,
          });
          continue;
        }
        if (ref.specifier === "@easytree/domain") continue;
        if (!ref.specifier.startsWith(".")) {
          const family = familyOf(ref.specifier);
          findings.push({
            rule: "costs-domain-purity",
            location: at,
            message:
              family === null
                ? `Kosten-Domaincode darf "${ref.specifier}" nicht importieren. Erlaubt sind ausschliesslich relative Pfade innerhalb von ${COSTS_MODULE_DIR}/domain/ und "@easytree/domain".`
                : `Kosten-Domaincode darf keine ${family}-Bibliothek importieren ("${ref.specifier}") — S5-REQ-01.`,
          });
          continue;
        }
        if (ref.resolved === null) {
          findings.push({
            rule: "costs-domain-purity",
            location: at,
            message: `Relativer Import "${ref.specifier}" ist nicht aufloesbar — sonst uebergeht der Scanner ihn stillschweigend.`,
          });
          continue;
        }
        if (!isCostsLayer(ref.resolved, "domain")) {
          findings.push({
            rule: "costs-domain-purity",
            location: at,
            message: `Kosten-Domaincode darf nicht nach "${ref.resolved}" hinausgreifen; das liegt ausserhalb von ${COSTS_MODULE_DIR}/domain/.`,
          });
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "costs-cross-module-public-api-only",
    summary:
      "Modulgrenzen des Kostenmoduls werden in beide Richtungen nur ueber die oeffentliche index.ts ueberquert (S5-REQ-01, ADR-001 Z. 76).",
    // Die generische Regel `module-public-api-only` prueft dasselbe Muster, ihr
    // Nicht-Leerlauf-Zaehler ist aber global und schon durch planning/ erfuellt.
    // Diese Regel bindet ihn an das Kostenmodul: ohne Kostendateien ist sie rot,
    // nicht still gruen.
    evaluate: ({ refs }): CostsRuleResult => {
      const findings: CostsFinding[] = [];
      const seen = new Set<string>();
      for (const ref of refs) {
        if (ref.resolved === null) continue;
        const fromModule = moduleOf(ref.from);
        const toModule = moduleOf(ref.resolved);
        if (toModule === null || fromModule === toModule) continue;

        if (fromModule === "costs") {
          seen.add(ref.from);
          const publicApi = `${MODULES_PREFIX}${toModule}/index.ts`;
          if (ref.resolved !== publicApi) {
            findings.push({
              rule: "costs-cross-module-public-api-only",
              location: `${ref.from}:${ref.line}`,
              message: `Das Kostenmodul greift an der oeffentlichen API vorbei nach "${ref.resolved}"; erlaubt ist nur ${publicApi}.`,
            });
          }
          continue;
        }
        if (toModule === "costs") {
          seen.add(ref.from);
          if (ref.resolved !== COSTS_INDEX) {
            findings.push({
              rule: "costs-cross-module-public-api-only",
              location: `${ref.from}:${ref.line}`,
              message: `Modul "${fromModule ?? "?"}" greift tief nach "${ref.resolved}" ins Kostenmodul; erlaubt ist nur ${COSTS_INDEX}.`,
            });
          }
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "costs-planning-facts-via-application-port",
    summary:
      "Veroeffentlichte Planfakten erreichen das Kostenmodul ausschliesslich ueber die oeffentliche Application-API der Planung (S5-REQ-01).",
    evaluate: (input): CostsRuleResult => {
      const findings: CostsFinding[] = [];
      const seen = new Set<string>();
      const planningPrefix = `${MODULES_PREFIX}planning/`;

      // Welche Textliterale einer Kostendatei zeigen auf planning/index.ts?
      const indexSpecifiers = new Map<string, Set<string>>();
      for (const ref of input.refs) {
        if (moduleOf(ref.from) !== "costs") continue;
        if (ref.resolved === null || !ref.resolved.startsWith(planningPrefix)) continue;
        seen.add(ref.from);
        if (ref.resolved !== PLANNING_INDEX) continue; // Tiefimport: gehoert der Regel oben.
        const bucket = indexSpecifiers.get(ref.from) ?? new Set<string>();
        bucket.add(ref.specifier);
        indexSpecifiers.set(ref.from, bucket);
      }

      if (indexSpecifiers.size === 0) return { findings, seen };

      const planningIndexAbs = resolve(input.repoRoot, PLANNING_INDEX);
      if (!existsSync(planningIndexAbs)) return { findings, seen };
      const sources = publicExportSources(readFileSync(planningIndexAbs, "utf8"), PLANNING_INDEX);

      for (const [file, specifiers] of indexSpecifiers) {
        const source = read(input, file);
        for (const bound of boundSymbolsFrom(source, file, specifiers)) {
          const at = `${file}:${bound.line}`;
          if (bound.wildcard) {
            findings.push({
              rule: "costs-planning-facts-via-application-port",
              location: at,
              message:
                "Sternimport aus dem Planungsmodul verdeckt, welche Symbole benutzt werden — benannte Bindungen sind Pflicht.",
            });
            continue;
          }
          for (const name of bound.names) {
            const from = sources.get(name);
            if (from === undefined) {
              findings.push({
                rule: "costs-planning-facts-via-application-port",
                location: at,
                message: `"${name}" wird von ${PLANNING_INDEX} nicht benannt re-exportiert — die Herkunftsschicht ist damit nicht pruefbar.`,
              });
              continue;
            }
            if (!from.startsWith("./application/")) {
              findings.push({
                rule: "costs-planning-facts-via-application-port",
                location: at,
                message: `"${name}" stammt aus "${from}". Das Kostenmodul darf Planfakten nur ueber die Application-Schicht der Planung beziehen (S5-REQ-01), nicht aus domain/, infrastructure/ oder interface/.`,
              });
            }
          }
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "costs-touches-only-own-tables",
    summary:
      "SQL im Kostenmodul liest UND schreibt ausschliesslich Tabellen, die im Besitzregister dem Modul `costs` gehoeren (S5-REQ-01, EYT-105 AK).",
    // Der Regelname sagt bewusst „touches", nicht „writes": aus einem
    // Schreibverbot allein liest spaeter jemand heraus, Lesen sei erlaubt. Die
    // EYT-105-AK nennt „gelesen" ausdruecklich.
    //
    // Statischer Quelltextwaechter, KEINE Laufzeitdurchsetzung: zur Laufzeit gibt
    // es genau eine Anwendungsrolle, RLS filtert nach Mandant, nicht nach Modul
    // (module-catalogue.ts, Kopfkommentar). Das darf nicht als erfuellte
    // ADR-001-Z.-78-Haelfte gemeldet werden.
    evaluate: (input): CostsRuleResult => {
      const findings: CostsFinding[] = [];
      const seen = new Set<string>();
      const ownerOf = new Map<string, string | null>(
        input.tableOwnership.map((entry) => [entry.table.toLowerCase(), entry.owner]),
      );

      for (const file of input.files) {
        if (!isInCosts(file)) continue;
        seen.add(file);
        for (const literal of stringLiterals(read(input, file), file)) {
          for (const access of sqlAccesses(literal.text)) {
            const at = `${file}:${literal.line + access.line - 1}`;
            const quoted = `"${access.verb} ${access.table}"`;
            if (!ownerOf.has(access.table)) {
              findings.push({
                rule: "costs-touches-only-own-tables",
                location: at,
                message: `${quoted} greift ${access.access} auf eine Tabelle zu, die im Besitzregister TABLE_OWNERSHIP fehlt — unregistrierte Tabellen sind kein Besitz, sondern eine Luecke. Die Regel gilt lesend UND schreibend.`,
              });
              continue;
            }
            const owner = ownerOf.get(access.table) ?? null;
            if (owner !== "costs") {
              findings.push({
                rule: "costs-touches-only-own-tables",
                location: at,
                message: `${quoted} greift ${access.access} auf eine fremde Tabelle zu (Besitzer: ${owner ?? "global"}). Das Kostenmodul liest UND schreibt ausschliesslich eigene Tabellen; modulfremde Planfakten kommen nur ueber die oeffentliche Planning-Application-API bzw. einen expliziten Port (EYT-105 AK).`,
              });
            }
          }
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "costs-no-generic-container",
    summary:
      "Unterhalb von costs/ existieren nur die vier Schichten; kein generischer shared-/services-Container (S5-REQ-01, ADR-001 Z. 77).",
    // Verzeichnis-, nicht Importpruefung: `layer-direction` faengt eine
    // unbekannte Schicht nur, wenn eine ihrer Dateien modulintern importiert.
    // Ein `costs/shared/money.ts` ganz ohne Import passiert jede Importregel.
    evaluate: (input): CostsRuleResult => {
      const findings: CostsFinding[] = [];
      const seen = new Set<string>();
      const layers = new Set<string>(COSTS_LAYER_DIRS);

      for (const dir of collectDirectories(input.repoRoot, COSTS_MODULE_DIR)) {
        seen.add(dir);
        const segments = dir.slice(COSTS_MODULE_DIR.length + 1).split("/");
        const generic = segments.filter((segment) => GENERIC_DIR_NAMES.has(segment));
        if (generic.length > 0) {
          findings.push({
            rule: "costs-no-generic-container",
            location: dir,
            message: `"${generic.join("/")}" ist ein unspezifischer Sammelcontainer. S5-REQ-01 verbietet ihn im Kostenmodul.`,
          });
          continue;
        }
        const top = segments[0];
        if (top !== undefined && !layers.has(top)) {
          findings.push({
            rule: "costs-no-generic-container",
            location: dir,
            message: `"${top}" ist keine der vier Schichten (${[...layers].join(", ")}) — ein fuenftes Verzeichnis auf Modulebene ist keine Grenze.`,
          });
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "costs-single-money-implementation",
    summary:
      "Das Kostenmodul fuehrt keine zweite Geld-/Rundungsimplementierung; der Vertrag kommt aus @easytree/domain (S5-REQ-01, EYT-95).",
    evaluate: (input): CostsRuleResult => {
      const findings: CostsFinding[] = [];
      const seen = new Set<string>();
      for (const file of input.files) {
        if (!isInCosts(file)) continue;
        seen.add(file);
        for (const declaration of exportedDeclarations(read(input, file), file)) {
          const exact = MONEY_EXACT_NAMES.has(declaration.name);
          const prefixed =
            declaration.functionLike && MONEY_FUNCTION_PATTERN.test(declaration.name);
          if (!exact && !prefixed) continue;
          findings.push({
            rule: "costs-single-money-implementation",
            location: `${file}:${declaration.line}`,
            message: `"${declaration.name}" ist eine zweite Geld-/Rundungsimplementierung. Geld, Minor Units und Rundung gehoeren nach @easytree/domain (EYT-95) und werden von dort importiert.`,
          });
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "costs-xlsx-behind-application-port",
    summary:
      "Eine XLSX-Bibliothek erscheint nur in costs/infrastructure/, haengt dort an einem Application-Port und rechnet nicht neu (S5-REQ-01, REQ-007).",
    evaluate: ({ refs, files }): CostsRuleResult => {
      const findings: CostsFinding[] = [];
      // Gemessen: mit `new Set(files)` stand hier 224, waehrend die sechs anderen
      // Regeln 1 bis 6 zaehlten — die Bremse konnte also nie fehlschlagen und war
      // eine falsche Sicherheit, genau das Muster "zaehlt Dateien, die es nicht
      // geprueft hat". Gezaehlt wird jetzt, was die Regel tatsaechlich entscheidet:
      // jede Datei unterhalb von `costs/`, deren Importe sie durchsieht.
      const seen = new Set<string>(files.filter((file) => isInCosts(file)));
      const rendererFiles = new Set<string>();
      const infrastructure = `${COSTS_MODULE_DIR}/infrastructure/`;

      for (const ref of refs) {
        // Relative Pfade sind keine Bibliothek, sondern eigene Dateien. Ohne
        // diesen Guard traf das Muster `./infrastructure/xlsx-cost-renderer`
        // und `../infrastructure/xlsx-cost-renderer` — gemessen, beide `true`,
        // weil `([/-]|$)` auch den Bindestrich zulaesst. Sobald EYT-110 den
        // Adapter liefert und `costs/index.ts` ihn re-exportiert, haette die
        // Regel den eigenen, vertragskonformen Code als Verstoss gemeldet:
        // `ref.from` waere dann `costs/index.ts` und nicht `infrastructure/`.
        // `costs-domain-purity` fuehrt denselben Guard (Zeile weiter unten).
        if (ref.specifier.startsWith(".")) continue;
        if (!XLSX_LIBRARY_PATTERN.test(ref.specifier)) continue;
        if (!ref.from.startsWith(infrastructure)) {
          findings.push({
            rule: "costs-xlsx-behind-application-port",
            location: `${ref.from}:${ref.line}`,
            message: `"${ref.specifier}" ist eine XLSX-Bibliothek und gehoert ausschliesslich nach ${infrastructure} — nicht in Domain, Application, HTTP-Interface oder in den Browser.`,
          });
          continue;
        }
        rendererFiles.add(ref.from);
      }

      for (const renderer of rendererFiles) {
        const own = refs.filter((ref) => ref.from === renderer && ref.resolved !== null);
        const usesDomain = own.filter(
          (ref) => ref.resolved?.startsWith(`${COSTS_MODULE_DIR}/domain/`) === true,
        );
        for (const ref of usesDomain) {
          findings.push({
            rule: "costs-xlsx-behind-application-port",
            location: `${renderer}:${ref.line}`,
            message: `Der XLSX-Renderer importiert "${ref.resolved}" aus der Kosten-Domain. Er rendert einen gespeicherten Snapshot und rechnet nicht neu (S5-REQ-01, REQ-007).`,
          });
        }
        const usesPort = own.some(
          (ref) => ref.resolved?.startsWith(`${COSTS_MODULE_DIR}/application/`) === true,
        );
        if (!usesPort) {
          findings.push({
            rule: "costs-xlsx-behind-application-port",
            location: renderer,
            message: `Der XLSX-Renderer haengt an keinem Port aus ${COSTS_MODULE_DIR}/application/ — ohne Port ist der Adapter nicht austauschbar (S5-REQ-01, CAN-008).`,
          });
        }
      }
      return { findings, seen };
    },
  },
];

export function evaluateCostsRules(input: CostsInput): {
  findings: CostsFinding[];
  seen: Map<string, ReadonlySet<string>>;
} {
  const findings: CostsFinding[] = [];
  const seen = new Map<string, ReadonlySet<string>>();
  for (const rule of COSTS_RULES) {
    const result = rule.evaluate(input);
    findings.push(...result.findings);
    seen.set(rule.id, result.seen);
  }
  return { findings, seen };
}

export function render(findings: readonly CostsFinding[]): string[] {
  return findings.map((finding) => `${finding.location} [${finding.rule}] ${finding.message}`);
}
