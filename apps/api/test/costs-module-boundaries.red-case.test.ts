/**
 * Rot-Fall-Beweis fuer die Kostenmodul-Grenzen (EYT-105 / REQ-001).
 *
 * Ein Waechter, der nie rot war, ist kein Waechter. Zu jeder Zusicherung in
 * `costs-module-boundaries.test.ts` steht hier die benannte Gegenmutation, die
 * sie ausloest — als DAUERHAFTES Szenario in der Suite, nicht als einmalige
 * Quelltextaenderung, die niemand wiederholt.
 *
 * Bewusst NICHT im echten Baum: eine Fixture unter `apps/api/src/modules/costs/`
 * wuerde mit `costs-module-boundaries.test.ts` und `architecture.test.ts` um
 * dieselben Dateien rennen und zusaetzlich `typecheck` brechen. Gleiches Muster
 * und gleicher Grund wie in `architecture-red-case.test.ts`: synthetischer Baum
 * in `os.tmpdir()`, dieselbe Pipeline (`collectSourceFiles` -> `extractImports`
 * -> `evaluateCostsRules`).
 *
 * Das Besitzregister wird injiziert statt importiert. Andernfalls haette der
 * Rot-Fall fuer „schreibt fremde Tabellen" auf die echte `TABLE_OWNERSHIP`
 * warten muessen und waere bis dahin nicht ausfuehrbar gewesen.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COSTS_RULES,
  evaluateCostsRules,
  type CostsFinding,
  type TableOwner,
} from "./architecture/costs-rules";
import { collectSourceFiles, extractImports } from "./architecture/scan";

let root: string;

/** Synthetisches Besitzregister — deckungsgleich im Aufbau mit `TABLE_OWNERSHIP`. */
const TABLES: readonly TableOwner[] = [
  { table: "public.cost_snapshots", owner: "costs" },
  { table: "public.cost_snapshot_items", owner: "costs" },
  { table: "public.assignments", owner: "planning" },
  { table: "public.plan_versions", owner: "planning" },
  { table: "public.items", owner: null },
];

/** Sauberer Renderer — steht als Konstante, damit die Gegenmutationen exakt zuruecksetzen. */
const CLEAN_RENDERER =
  [
    'import { utils, write } from "xlsx";',
    'import type { CostExportPort } from "../application/cost-export.port";',
    "export class XlsxCostRenderer {",
    "  readonly port: CostExportPort | null = null;",
    "  readonly tools = [utils, write] as const;",
    "}",
  ].join("\n") + "\n";

const RENDERER_PATH = "apps/api/src/modules/costs/infrastructure/xlsx-cost-renderer.ts";

function write(relative: string, contents: string): void {
  const abs = join(root, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf8");
}

function drop(relative: string): void {
  rmSync(join(root, relative), { recursive: true, force: true });
}

function run(): ReturnType<typeof evaluateCostsRules> {
  const files = [...collectSourceFiles(root, "apps"), ...collectSourceFiles(root, "packages")];
  const refs = extractImports(root, files);
  return evaluateCostsRules({ repoRoot: root, files, refs, tableOwnership: TABLES });
}

/**
 * Der `index.ts`-Stand des sauberen Baums.
 *
 * Eine Quelle fuer `beforeAll` UND fuer jeden Test, der die Datei ueberschreibt:
 * sonst laufen die beiden Abschlusszusicherungen „am sauberen Baum" gegen einen
 * anderen Baum als den, den `beforeAll` beschreibt.
 */
const SAUBERE_INDEX_TS =
  [
    'export type { CostExportPort } from "./application/cost-export.port";',
    'export { COST_EXPORT_PORT } from "./application/cost-export.port";',
  ].join("\n") + "\n";

function findingsOf(ruleId: string): CostsFinding[] {
  return run().findings.filter((finding) => finding.rule === ruleId);
}

function messagesOf(ruleId: string): string[] {
  return findingsOf(ruleId).map((finding) => finding.message);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "eyt-costs-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n', "utf8");

  // Planungsmodul mit einer index.ts, die aus ALLEN drei Schichten
  // re-exportiert — nur so ist pruefbar, dass das Kostenmodul ausgerechnet die
  // Application-Symbole nimmt und nicht die anderen.
  write(
    "apps/api/src/modules/planning/index.ts",
    [
      'export type { PublishedPlanFacts } from "./application/published-plan-facts.port";',
      'export { PUBLISHED_PLAN_FACTS } from "./application/published-plan-facts.port";',
      'export { validateDraft } from "./domain/draft-validation";',
      'export { PlanningWriteRepository } from "./infrastructure/planning-write.repository";',
    ].join("\n") + "\n",
  );
  write(
    "apps/api/src/modules/planning/application/published-plan-facts.port.ts",
    [
      "export interface PublishedPlanFacts {",
      "  readonly planVersionId: string;",
      "}",
      'export const PUBLISHED_PLAN_FACTS = "PUBLISHED_PLAN_FACTS";',
    ].join("\n") + "\n",
  );
  write(
    "apps/api/src/modules/planning/domain/draft-validation.ts",
    "export const validateDraft = (): boolean => true;\n",
  );
  write(
    "apps/api/src/modules/planning/infrastructure/planning-write.repository.ts",
    "export class PlanningWriteRepository {}\n",
  );

  // Sauberes Kostenmodul.
  write("apps/api/src/modules/costs/index.ts", SAUBERE_INDEX_TS);
  write(
    "apps/api/src/modules/costs/domain/daily-allocation.ts",
    [
      'import type { EmployeeId } from "@easytree/domain";',
      "export interface DailyAllocation {",
      "  readonly employeeId: EmployeeId;",
      "}",
      "// Negativkontrolle fuer costs-single-money-implementation: eine",
      "// Regelversion beginnt mit `round`, ist aber kein Rundungsalgorithmus.",
      'export const roundingRuleVersion = "2026-07-30";',
    ].join("\n") + "\n",
  );
  write(
    "apps/api/src/modules/costs/application/cost-snapshot.port.ts",
    [
      'import type { PublishedPlanFacts } from "../../planning";',
      'import type { DailyAllocation } from "../domain/daily-allocation";',
      "export interface CostSnapshotPort {",
      "  readonly facts: PublishedPlanFacts;",
      "  readonly rows: readonly DailyAllocation[];",
      "}",
    ].join("\n") + "\n",
  );
  write(
    "apps/api/src/modules/costs/application/cost-export.port.ts",
    [
      "export interface CostExportPort {",
      "  render(snapshotId: string): Promise<Uint8Array>;",
      "}",
      'export const COST_EXPORT_PORT = "COST_EXPORT_PORT";',
    ].join("\n") + "\n",
  );
  write(
    "apps/api/src/modules/costs/infrastructure/cost-snapshot.repository.ts",
    [
      "export const insertSnapshot =",
      '  "insert into public.cost_snapshots (id, org_id) values ($1, $2)";',
      "export const markItems =",
      '  "update public.cost_snapshot_items set amount_minor = $1 where id = $2";',
      "// Negativkontrolle fuer costs-touches-only-own-tables: Lesen der EIGENEN",
      "// Tabellen — inklusive join — darf nicht feuern.",
      "export const readSnapshot =",
      '  "select s.id from public.cost_snapshots s join public.cost_snapshot_items i on i.snapshot_id = s.id where s.org_id = $1";',
    ].join("\n") + "\n",
  );
  write(RENDERER_PATH, CLEAN_RENDERER);
  write(
    "apps/api/src/modules/costs/interface/http/costs.controller.ts",
    [
      'import type { CostSnapshotPort } from "../../application/cost-snapshot.port";',
      "export class CostsController {",
      "  constructor(readonly port: CostSnapshotPort) {}",
      "}",
    ].join("\n") + "\n",
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Rot-Fall Kostenmodul", () => {
  it("faengt Framework-, Datenbank-, Supabase- und XLSX-Importe im Kosten-Domaincode", () => {
    write(
      "apps/api/src/modules/costs/domain/bad.ts",
      [
        'import { Injectable } from "@nestjs/common";',
        'import { Pool } from "pg";',
        'import { createClient } from "@supabase/supabase-js";',
        'import * as XLSX from "xlsx";',
        'import http from "node:http";',
        "export const bad = [Injectable, Pool, createClient, XLSX, http] as const;",
      ].join("\n") + "\n",
    );
    const messages = messagesOf("costs-domain-purity");
    for (const family of ["NestJS", "PostgreSQL", "Supabase", "XLSX", "HTTP"]) {
      expect(
        messages.some((message) => message.includes(`${family}-Bibliothek`)),
        `${family} nicht erkannt`,
      ).toBe(true);
    }
    drop("apps/api/src/modules/costs/domain/bad.ts");
  });

  it("faengt den Griff des Kosten-Domaincodes in eine aeussere Schicht", () => {
    write(
      "apps/api/src/modules/costs/domain/reach-out.ts",
      'import type { CostExportPort } from "../application/cost-export.port";\nexport type Reach = CostExportPort;\n',
    );
    expect(
      messagesOf("costs-domain-purity").some((message) => message.includes("hinausgreifen")),
    ).toBe(true);
    drop("apps/api/src/modules/costs/domain/reach-out.ts");
  });

  it("faengt einen tiefen Import des Kostenmoduls in ein fremdes Modul", () => {
    write(
      "apps/api/src/modules/costs/application/deep-import.ts",
      'import { validateDraft } from "../../planning/domain/draft-validation";\nexport const used = validateDraft;\n',
    );
    expect(
      messagesOf("costs-cross-module-public-api-only").some((message) =>
        message.includes("an der oeffentlichen API vorbei"),
      ),
    ).toBe(true);
    drop("apps/api/src/modules/costs/application/deep-import.ts");
  });

  it("faengt einen tiefen Import eines fremden Moduls in das Kostenmodul", () => {
    write(
      "apps/api/src/modules/planning/application/peek-costs.ts",
      'import type { DailyAllocation } from "../../costs/domain/daily-allocation";\nexport type Peek = DailyAllocation;\n',
    );
    expect(
      messagesOf("costs-cross-module-public-api-only").some((message) =>
        message.includes("greift tief"),
      ),
    ).toBe(true);
    drop("apps/api/src/modules/planning/application/peek-costs.ts");
  });

  it("faengt ein Planungssymbol aus domain/ trotz Weg ueber die oeffentliche index.ts", () => {
    // Der gefaehrliche Fall: die Modulgrenze ist formal eingehalten
    // (`module-public-api-only` bleibt gruen), aber es reisen Domainklassen
    // statt Planfakten aus der Application-Schicht.
    write(
      "apps/api/src/modules/costs/application/uses-planning-domain.ts",
      'import { validateDraft } from "../../planning";\nexport const used = validateDraft;\n',
    );
    expect(
      messagesOf("costs-planning-facts-via-application-port").some(
        (message) =>
          message.includes('"validateDraft"') && message.includes("./domain/draft-validation"),
      ),
    ).toBe(true);
    drop("apps/api/src/modules/costs/application/uses-planning-domain.ts");
  });

  it("faengt einen Sternimport aus dem Planungsmodul", () => {
    write(
      "apps/api/src/modules/costs/application/wildcard.ts",
      'import * as planning from "../../planning";\nexport const all = planning;\n',
    );
    expect(
      messagesOf("costs-planning-facts-via-application-port").some((message) =>
        message.includes("Sternimport"),
      ),
    ).toBe(true);
    drop("apps/api/src/modules/costs/application/wildcard.ts");
  });

  it("faengt Schreibzugriffe auf fremde und auf unregistrierte Tabellen", () => {
    write(
      "apps/api/src/modules/costs/infrastructure/foreign-write.repository.ts",
      [
        'export const a = "insert into public.assignments (id) values ($1)";',
        'export const b = "update public.plan_versions set published_at = now() where id = $1";',
        'export const c = "delete from public.items where id = $1";',
        'export const d = "insert into cost_secrets (id) values ($1)";',
      ].join("\n") + "\n",
    );
    const messages = messagesOf("costs-touches-only-own-tables");
    expect(
      messages.some(
        (m) =>
          m.includes("public.assignments") && m.includes("planning") && m.includes("schreibend"),
      ),
    ).toBe(true);
    expect(messages.some((m) => m.includes("public.plan_versions"))).toBe(true);
    expect(messages.some((m) => m.includes("public.items") && m.includes("global"))).toBe(true);
    expect(messages.some((m) => m.includes("public.cost_secrets") && m.includes("fehlt"))).toBe(
      true,
    );
    drop("apps/api/src/modules/costs/infrastructure/foreign-write.repository.ts");
  });

  it("faengt Lesezugriffe auf fremde und auf unregistrierte Tabellen", () => {
    // Der Fall, den ein reines Schreibverbot durchlaesst: EYT-105 AK sagt
    // woertlich, modulfremde Planfakten werden nur ueber die oeffentliche
    // Planning-Application-API „gelesen".
    write(
      "apps/api/src/modules/costs/infrastructure/foreign-read.repository.ts",
      [
        'export const a = "select id, starts_at from public.assignments where org_id = $1";',
        "export const b =",
        '  "select s.id from public.cost_snapshots s join public.plan_versions v on v.id = s.plan_version_id";',
        "export const c =",
        '  "select * from public.cost_snapshots c, public.plan_versions_comma v where v.id = c.id";',
        'export const d = "delete from public.cost_snapshots using public.items where items.id = $1";',
        'export const e = "select * from public.unregistered_ledger";',
      ].join("\n") + "\n",
    );
    const messages = messagesOf("costs-touches-only-own-tables");
    expect(
      messages.some(
        (m) =>
          m.includes('"from public.assignments"') && m.includes("lesend") && m.includes("planning"),
      ),
      "from-Ziel nicht erkannt",
    ).toBe(true);
    expect(
      messages.some((m) => m.includes('"join public.plan_versions"') && m.includes("lesend")),
      "join-Ziel nicht erkannt",
    ).toBe(true);
    // Diese Zusicherung nannte frueher `public.assignments` — dasselbe Ziel, das
    // schon Literal `a` liefert. Sie war damit byte-identisch zur Zusicherung
    // oben und blieb gruen, auch wenn man SQL_READ_CONTINUATION komplett
    // entfernte. Jetzt prueft sie ein Ziel, das AUSSCHLIESSLICH ueber die
    // kommagetrennte Fortsetzung erreichbar ist.
    expect(
      messages.some((m) => m.includes('"from public.plan_versions_comma"')),
      "kommagetrennte Lesequelle nicht erkannt",
    ).toBe(true);
    expect(
      messages.some((m) => m.includes('"using public.items"') && m.includes("lesend")),
      "using-Ziel nicht erkannt",
    ).toBe(true);
    expect(
      messages.some((m) => m.includes("public.unregistered_ledger") && m.includes("fehlt")),
      "unregistriertes Leseziel nicht erkannt",
    ).toBe(true);
    // Der Regeltext darf nicht als reines Schreibverbot lesbar sein.
    expect(
      messages.every(
        (m) => m.includes("liest UND schreibt") || m.includes("lesend UND schreibend"),
      ),
    ).toBe(true);
    drop("apps/api/src/modules/costs/infrastructure/foreign-read.repository.ts");
  });

  it("meldet keinen Lesezugriff, der sich auf CTE, Funktion oder SQL-Operator bezieht", () => {
    // Negativkontrolle gegen Ueberfeuern: `with … as (…)`, `from unnest(…)` und
    // `extract(day from ts)` sind keine Tabellenzugriffe. Ohne diesen Fall
    // wuerde die Regel bei erstem echtem SQL im Kostenmodul falsch anschlagen.
    write(
      "apps/api/src/modules/costs/infrastructure/legit-sql.repository.ts",
      [
        "export const a =",
        '  "with tage as (select d from public.cost_snapshot_items) select * from tage";',
        'export const b = "select extract(day from occurred_on) from public.cost_snapshots";',
        'export const c = "select * from unnest($1::uuid[]) as t(id)";',
      ].join("\n") + "\n",
    );
    expect(
      messagesOf("costs-touches-only-own-tables"),
      "Die Regel feuert auf CTE, SQL-Operator oder mengenliefernde Funktion.",
    ).toEqual([]);
    drop("apps/api/src/modules/costs/infrastructure/legit-sql.repository.ts");
  });

  it("meldet weder einen Importpfad noch deutsche Prosa als Tabelle", () => {
    // Zwei Ueberfeuer-Faelle in einem, beide mit eigener Fixture — die fruehere
    // Fassung lief gegen den SAUBEREN Baum und blieb deshalb auch dann gruen,
    // wenn man die Regel loeschte.
    //
    // (1) `import … from "…"` traegt das Schluesselwort `from` im ROHTEXT.
    //     Gemessen: ein Rohtextscan haette daraus die "Tabelle" `..` gemacht,
    //     nicht `public.../planning` — der Punkt bleibt derselbe, nur der
    //     Fehlermodus war frueher falsch beschrieben. Gescannt werden deshalb
    //     ausschliesslich Literalinhalte.
    // (2) Deutsche Prosa enthaelt `from` und `join` als gewoehnliche Woerter.
    //     Gemessen ohne Vorpruefung: "beim join mehrerer Zeilen" ergab
    //     `public.mehrerer`, "stammt from planung" ergab `public.planung`.
    //     Ein Waechter, der bei einer harmlosen Meldung feuert, wird
    //     abgeschaltet — und faengt dann auch das Echte nicht mehr.
    // (3) Vier weitere Prosaformen, die eine SPAETERE Fassung der Vorpruefung
    //     wieder durchliess, weil sie nur `raw.includes(".")` testete: der
    //     Satzpunkt hinter dem Ziel gehoert bei `SQL_READ_TARGETS` mit ins Ziel,
    //     also sahen `planung.`, `mehrerer.`, `.` (aus `./infrastructure`) und
    //     `2.5` alle "qualifiziert" aus. Diese vier standen in der Fixture
    //     bewusst OHNE Satzpunkt und konnten den Rueckfall deshalb nicht sehen.
    // (4) Ein englischer Satz mit `with`: solange `with` als Statement-Verb
    //     galt, machte "Compare with … taken from planung" daraus
    //     `public.planung`.
    write(
      "apps/api/src/modules/costs/infrastructure/ueberfeuer.repository.ts",
      [
        'import type { PublishedPlanFacts } from "../../planning";',
        'export const hinweis = "Konflikt entsteht beim join mehrerer Zeilen";',
        'export const grund = "Wert stammt from planung und ist unveraendert";',
        'export const satzende = "Der Wert stammt from planung.";',
        'export const satzendeJoin = "Konflikt entsteht beim join mehrerer.";',
        'export const pfad = "Adapter kommt from ./infrastructure";',
        'export const zahl = "Berechnet using 2.5 Stunden je Einsatz";',
        'export const datei = "Vorlage stammt from vorlage.xlsx";',
        'export const englisch = "Compare with the published plan, values taken from planung";',
        "export type X = PublishedPlanFacts;",
      ].join("\n") + "\n",
    );
    // Geprueft wird die GESAMTE Fixture, nicht nur Meldungen mit "planning".
    // Gemessen: ein Rohtextscan erzeugt aus `from "../../planning"` das Ziel
    // `..`, nie einen Text mit "planning" — ein Filter darauf traefe den
    // Fehlermodus nicht und koennte unter der benannten Regression gar nicht
    // fehlschlagen. Ein leerer Befundsatz fuer diese Datei faengt jede
    // Ueberfeuerform, auch `..`.
    const ueberfeuer = findingsOf("costs-touches-only-own-tables").filter((f) =>
      f.location.includes("ueberfeuer.repository.ts"),
    );
    expect(
      ueberfeuer.map((f) => `${f.location} ${f.message}`),
      "Importpfad oder deutsche Prosa wurde als Tabellenzugriff gelesen.",
    ).toEqual([]);
    drop("apps/api/src/modules/costs/infrastructure/ueberfeuer.repository.ts");
  });

  it("faengt einen Lesezugriff auch aus einem gestueckelten Templateliteral", () => {
    // Der Fall, an dem die SQL-Vorpruefung zu eng werden kann: `stringLiterals`
    // liefert ein Templateliteral STUECKWEISE. Das Stueck hinter der
    // Interpolation traegt kein einleitendes Statement-Verb — verlangt die
    // Vorpruefung eines, faellt der `join` auf `public.assignments` still unter
    // den Tisch. Ein Waechter, der zu weit war, meldet Falsches; einer, der zu
    // eng ist, SCHWEIGT beim Echten, und das ist die schlechtere Richtung.
    write(
      "apps/api/src/modules/costs/infrastructure/gestueckelt.repository.ts",
      [
        'const SNAPSHOTS = "public.cost_snapshots";',
        "export const query = `select s.id, a.employee_id",
        "  from ${SNAPSHOTS} s",
        "  join public.assignments a on a.id = s.assignment_id",
        "  where s.org_id = $1`;",
      ].join("\n") + "\n",
    );
    expect(
      messagesOf("costs-touches-only-own-tables").some((m) =>
        m.includes('"join public.assignments"'),
      ),
      "Der Lesezugriff im gestueckelten Templateliteral wurde nicht gemeldet.",
    ).toBe(true);
    drop("apps/api/src/modules/costs/infrastructure/gestueckelt.repository.ts");
  });

  it("faengt eine relativ importierte Datei NICHT als XLSX-Bibliothek", () => {
    // Gemessen: XLSX_LIBRARY_PATTERN traf `./infrastructure/xlsx-cost-renderer`
    // und `../infrastructure/xlsx-cost-renderer`, weil `([/-]|$)` den Bindestrich
    // zulaesst. Sobald EYT-110 den Adapter liefert und `costs/index.ts` ihn
    // re-exportiert, haette die Regel den eigenen, vertragskonformen Code als
    // Verstoss gemeldet. Genau diese Zukunft sichert der Test ab, bevor sie
    // eintritt.
    write(
      "apps/api/src/modules/costs/index.ts",
      'export { XlsxCostRenderer } from "./infrastructure/xlsx-cost-renderer";\n',
    );
    write(
      "apps/api/src/modules/costs/infrastructure/xlsx-cost-renderer.ts",
      [
        'import type { CostExportPort } from "../application/cost-export.port";',
        "export const XlsxCostRenderer: CostExportPort | null = null;",
      ].join("\n") + "\n",
    );
    // Erst messen, DANN aufraeumen, DANN zusichern. Waere die Zusicherung wie
    // frueher die erste Anweisung, liefe der Aufraeumteil bei einem Fehlschlag
    // gar nicht — und die Folgetests liefen gegen einen zerstoerten Baum. Das
    // ist dieselbe Bauart, die diesen Befund ueberhaupt erst erzeugt hat.
    const meldungen = messagesOf("costs-xlsx-behind-application-port");
    drop("apps/api/src/modules/costs/infrastructure/xlsx-cost-renderer.ts");
    // `index.ts` wird hier UEBERSCHRIEBEN, nicht angelegt — ohne diese Zeile
    // liefen die beiden Abschlusszusicherungen "am sauberen Baum" gegen einen
    // anderen Baum als den, den `beforeAll` beschreibt.
    write("apps/api/src/modules/costs/index.ts", SAUBERE_INDEX_TS);
    expect(meldungen, "Ein relativer Importpfad wurde als XLSX-Bibliothek gemeldet.").toEqual([]);
  });

  it("faengt einen generischen Sammelcontainer, auch verschachtelt und unter anderem Namen", () => {
    // Ohne Verzeichnispruefung waere das unsichtbar: eine Datei ganz ohne
    // Import passiert jede importbasierte Regel.
    write("apps/api/src/modules/costs/shared/money-helpers.ts", "export const helper = 1;\n");
    write("apps/api/src/modules/costs/domain/utils/pad.ts", "export const pad = 1;\n");
    const messages = messagesOf("costs-no-generic-container");
    expect(messages.some((m) => m.includes('"shared"'))).toBe(true);
    expect(messages.some((m) => m.includes('"utils"'))).toBe(true);
    drop("apps/api/src/modules/costs/shared");
    drop("apps/api/src/modules/costs/domain/utils");
  });

  it("faengt ein fuenftes Verzeichnis auf Modulebene", () => {
    write("apps/api/src/modules/costs/adapters/legacy.ts", "export const legacy = 1;\n");
    expect(
      messagesOf("costs-no-generic-container").some((m) => m.includes("keine der vier Schichten")),
    ).toBe(true);
    drop("apps/api/src/modules/costs/adapters");
  });

  it("faengt eine zweite Geld- und Rundungsimplementierung", () => {
    write(
      "apps/api/src/modules/costs/domain/money.ts",
      [
        "export class Money {",
        "  constructor(readonly minor: number) {}",
        "}",
        "export function roundHalfUp(value: number): number {",
        "  return Math.round(value);",
        "}",
        "export const toMinorUnits = (euro: number): number => euro * 100;",
      ].join("\n") + "\n",
    );
    const messages = messagesOf("costs-single-money-implementation");
    for (const name of ["Money", "roundHalfUp", "toMinorUnits"]) {
      expect(
        messages.some((m) => m.includes(`"${name}"`)),
        `${name} nicht erkannt`,
      ).toBe(true);
    }
    drop("apps/api/src/modules/costs/domain/money.ts");
  });

  it("faengt eine XLSX-Bibliothek ausserhalb von costs/infrastructure", () => {
    write(
      "apps/api/src/modules/costs/interface/http/export.controller.ts",
      'import ExcelJS from "exceljs";\nexport const wb = ExcelJS;\n',
    );
    expect(
      messagesOf("costs-xlsx-behind-application-port").some((m) => m.includes('"exceljs"')),
    ).toBe(true);
    drop("apps/api/src/modules/costs/interface/http/export.controller.ts");
  });

  it("faengt eine XLSX-Bibliothek im Browsercode", () => {
    write(
      "apps/web/lib/client-export.ts",
      'import { utils } from "xlsx";\nexport const u = utils;\n',
    );
    expect(
      messagesOf("costs-xlsx-behind-application-port").some(
        (m) => m.includes('"xlsx"') && m.includes("Browser"),
      ),
    ).toBe(true);
    drop("apps/web");
  });

  it("faengt einen XLSX-Renderer, der die Kosten-Domain neu rechnet", () => {
    write(
      RENDERER_PATH,
      [
        'import { utils } from "xlsx";',
        'import type { CostExportPort } from "../application/cost-export.port";',
        'import type { DailyAllocation } from "../domain/daily-allocation";',
        "export class XlsxCostRenderer {",
        "  readonly port: CostExportPort | null = null;",
        "  readonly rows: readonly DailyAllocation[] = [];",
        "  readonly tools = [utils] as const;",
        "}",
      ].join("\n") + "\n",
    );
    expect(
      messagesOf("costs-xlsx-behind-application-port").some((m) => m.includes("rechnet nicht neu")),
    ).toBe(true);
    write(RENDERER_PATH, CLEAN_RENDERER);
  });

  it("faengt einen XLSX-Renderer ohne Application-Port", () => {
    write(
      RENDERER_PATH,
      'import { utils, write } from "xlsx";\nexport const tools = [utils, write] as const;\n',
    );
    expect(
      messagesOf("costs-xlsx-behind-application-port").some((m) =>
        m.includes("haengt an keinem Port"),
      ),
    ).toBe(true);
    write(RENDERER_PATH, CLEAN_RENDERER);
  });

  it("ist am sauberen Baum gruen — der Rot-Fall kommt von den Verstoessen, nicht vom Aufbau", () => {
    // Zuerst pruefen, GEGEN WELCHEN Baum hier gemessen wird. Ohne diese Zeile
    // war der Baumzustand ungeprueft: gemessen blieb die Datei 21/21 gruen,
    // nachdem die Wiederherstellung von `index.ts` im XLSX-Fall entfernt wurde
    // — eine `index.ts`, die auf eine geloeschte Datei re-exportiert, erzeugt
    // schlicht null Befunde. Die beiden Abschlusszusicherungen bestaetigten
    // damit die Sauberkeit eines Baums, den sie nicht kannten.
    // Gegenmutation: die Wiederherstellung in "faengt eine relativ importierte
    // Datei NICHT als XLSX-Bibliothek" entfernen -> rot.
    expect(
      readFileSync(join(root, "apps/api/src/modules/costs/index.ts"), "utf8"),
      "Ein vorheriger Test hat den Referenzbaum veraendert und nicht wiederhergestellt.",
    ).toBe(SAUBERE_INDEX_TS);
    const result = run();
    expect(
      result.findings.map((f) => `${f.location} [${f.rule}] ${f.message}`),
      "Der synthetische Referenzbaum verletzt selbst eine Regel.",
    ).toEqual([]);
  });

  it("sieht am sauberen Baum jede Regel mindestens eine Datei", () => {
    // Ohne diese Zusicherung koennte eine Regel im Rot-Fall nur deshalb nie
    // ausloesen, weil sie den Referenzbaum gar nicht betrachtet — derselbe
    // Leerlauf, den `architecture.test.ts` fuer die generischen Regeln abfaengt.
    const { seen } = run();
    const idle = COSTS_RULES.filter((rule) => (seen.get(rule.id)?.size ?? 0) === 0).map(
      (rule) => rule.id,
    );
    expect(idle).toEqual([]);
  });
});
