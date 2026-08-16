/**
 * Die Uebersetzung DB-Grenze <-> fachliches `validTo` hat genau EINE Stelle
 * (EYT-109 D1).
 *
 * ## Was dieser Waechter sichert — und nur das
 *
 * > Die Uebersetzung zwischen der Datenbankgrenze `valid_to` und dem fachlichen
 * > `validTo` findet ausschliesslich an der Repository-Grenze statt.
 *
 * Ohne ihn ist „es gibt genau eine Umrechnung" eine Behauptung im Kommentar und
 * keine Zusicherung — und genau diese Sorte Behauptung hat D1 ueberhaupt erst
 * entstehen lassen.
 *
 * ## Warum der Waechter den GANZEN Produktivbaum liest
 *
 * Bis zur PO-Pruefung dieses Slices las er nur `apps/api/src/modules/costs`.
 * Das war zu wenig, und zwar nachweislich: `dbEndeZuValidTo` und
 * `validToZuDbEnde` sind in `costs/index.ts` bewusst re-exportiert (der
 * Unit-Test der Umrechnung darf keinen tiefen Pfad nehmen, Waechter
 * `costs-cross-module-public-api-only`), und derselbe Waechter ERLAUBT jedem
 * anderen Modul den Import genau dieser oeffentlichen `index.ts`. Ein fremdes
 * Modul durfte die Umrechnung also voellig regelkonform importieren und
 * aufrufen — nur sah es niemand, weil der Scan an der Verzeichnisgrenze endete.
 *
 * Gemessen am Stand 8ac1863, mit einem echten Aufruf in
 * `workforce/infrastructure/employee-directory.repository.ts`:
 * `pnpm --filter @easytree/api run typecheck` -> Exit 0, `architecture.test.ts`
 * + `costs-module-boundaries.test.ts` -> 48 gruen, die gesamte API-Suite -> 70
 * Dateien / 703 Tests gruen. Kein einziger bestehender Waechter hat die zweite
 * Uebersetzungsstelle gesehen. Deshalb liest W1 jetzt jede Produktivquelle
 * unter `apps/` und `packages/`.
 *
 * ## Warum auf REFERENZ und nicht nur auf Aufruf geprueft wird
 *
 * `const umrechnen = dbEndeZuValidTo;` ist kein Aufruf, aber dieselbe zweite
 * Stelle — einen Aufruf daraus zu machen kostet eine Zeile in einer anderen
 * Datei. Der Waechter verbietet ausserhalb der Allowlist deshalb schon die
 * Nennung des Bezeichners. Innerhalb der Allowlist wird sehr wohl
 * unterschieden: Definition, Aufruf und Re-Export sind drei verschiedene Dinge
 * mit drei verschiedenen Zusicherungen (siehe W1a/W1b/W1c).
 *
 * ## Was er ausdruecklich NICHT verbietet
 *
 * Allgemeine Kalenderprimitive. `dayBefore`, `dayAfter`,
 * `compareLocalBusinessDate`, `parseLocalDate`, `formatLocalDate` sind
 * Fachrechnung und duerfen ueberall im Modul stehen; `rate-succession.ts`
 * braucht `dayBefore` fuer eine rein fachliche Regel. Ein Waechter, der sie
 * generell verboete, machte den Task rot, den er schuetzen soll — der
 * Unterschied ist nicht die Funktion, sondern was sie ueberquert.
 *
 * ## Was er nicht abdecken muss, weil es schon abgedeckt ist
 *
 * Ein Import von `domain/` nach `infrastructure/rate-interval-boundary.ts`
 * faellt bereits am bestehenden `domain-allowlist`
 * (`test/architecture/rules.ts`, red-case-belegt in
 * `architecture-red-case.test.ts`). Diese Haelfte hier zu wiederholen waere
 * eine zweite Regel fuer dieselbe Sache. Dieser Waechter deckt deshalb
 * `application/` und `interface/` ab, die `domain-allowlist` nicht erreicht —
 * und seit der PO-Pruefung zusaetzlich alles ausserhalb des Kostenmoduls.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { collectSourceFiles, extractImports, findRepoRoot } from "../architecture/scan";

const repoRoot = findRepoRoot(__dirname);

const COSTS_ROOT = "apps/api/src/modules/costs";
const GRENZDATEI = `${COSTS_ROOT}/infrastructure/rate-interval-boundary.ts`;
const REPOSITORY = `${COSTS_ROOT}/infrastructure/rate-repository.pg.ts`;
const BARREL = `${COSTS_ROOT}/index.ts`;

/** Die Wurzeln, unter denen Produktivcode liegt — beide Workspaces. */
const PRODUKTIVWURZELN = ["apps", "packages"] as const;

/**
 * Buildartefakte, die `collectSourceFiles` nicht selbst ausblendet.
 *
 * Beide sind gitignoriert und entstehen erst durch einen lokalen Build; ohne
 * diese Ausnahmen laese der Waechter auf einem Entwicklerrechner andere Dateien
 * als in CI und waere damit nicht mehr reproduzierbar. `SKIP_DIRS` in
 * `scan.ts` kennt `dist`, aber nicht `dist-harness` (64 Dateien, erzeugt von
 * `build:harness`), und `next-env.d.ts` schreibt Next bei jedem Build neu.
 * Gemessen: beide sind `git ls-files`-leer bzw. ignoriert.
 */
const BUILDARTEFAKTE: readonly string[] = [`apps/api/dist-harness/`, `apps/web/next-env.d.ts`];

/**
 * Testdateien. `/test/` und `/e2e/` als Pfadsegment, plus die drei Suffixe, die
 * im Repo vorkommen (`.test.ts(x)` fuer Vitest, `.spec.ts` und `.pwtest.ts` fuer
 * Playwright). NICHT `/testing/`: `packages/contracts/src/testing/` ist
 * ausgelieferter Produktivcode und gehoert in den Scan.
 */
function istTestdatei(datei: string): boolean {
  return (
    datei.includes("/test/") ||
    datei.includes("/e2e/") ||
    /\.(test|spec|pwtest)\.[cm]?[jt]sx?$/.test(datei)
  );
}

function istBuildartefakt(datei: string): boolean {
  return BUILDARTEFAKTE.some((pfad) => datei === pfad || datei.startsWith(pfad));
}

/**
 * Jede Produktivquelle beider Workspaces — Tests und Buildartefakte ausgenommen.
 *
 * Das ist der Scanbereich von W1, W2 und W3. Er ist bewusst NICHT auf das
 * Kostenmodul beschraenkt: die Umrechnung ist ueber `costs/index.ts`
 * modulweit importierbar, also muss die Zusicherung dort gelten, wo sie
 * gebrochen werden kann.
 */
const PRODUKTIVDATEIEN: readonly string[] = PRODUKTIVWURZELN.flatMap((wurzel) =>
  collectSourceFiles(repoRoot, wurzel),
)
  .filter((datei) => !istTestdatei(datei) && !istBuildartefakt(datei))
  .sort();

/** Produktivdateien des Kostenmoduls — dieselbe Liste, auf das Modul verengt. */
const MODULDATEIEN: readonly string[] = PRODUKTIVDATEIEN.filter((datei) =>
  datei.startsWith(`${COSTS_ROOT}/`),
);

/**
 * Quelltext ohne Kommentare — sonst schlaegt der Waechter auf der eigenen Doku
 * und auf den Begruendungen im Modul an. Zeilenzahl und Spaltenlage bleiben
 * erhalten, damit Fundstellen benennbar sind.
 */
function ohneKommentare(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (treffer) => treffer.replace(/[^\n]/g, " "))
    .split("\n")
    .map((zeile) => zeile.replace(/\/\/.*$/, ""))
    .join("\n");
}

function fundstellen(source: string, muster: RegExp): { zeile: number; text: string }[] {
  const gefunden: { zeile: number; text: string }[] = [];
  ohneKommentare(source)
    .split("\n")
    .forEach((zeile, index) => {
      if (muster.test(zeile)) gefunden.push({ zeile: index + 1, text: zeile.trim() });
    });
  return gefunden;
}

function quelleVon(datei: string): string {
  return readFileSync(resolve(repoRoot, datei), "utf8");
}

/**
 * JEDE Nennung der beiden Umrechnungen — auch ohne Klammer. Ein
 * `const f = dbEndeZuValidTo;` ist kein Aufruf, aber genau die zweite Stelle,
 * die D1 ausschliesst.
 */
const UEBERSETZUNG_REFERENZ = /\b(dbEndeZuValidTo|validToZuDbEnde)\b/;
/** Aufruf ODER Definition — die Klammerform. */
const UEBERSETZUNG_AUFRUF = /\b(dbEndeZuValidTo|validToZuDbEnde)\s*\(/;
/** Der Spaltenname der Datenbank — als ganzes Wort. */
const DB_SPALTE = /\bvalid_to\b/;

/**
 * Die drei erlaubten Stellen, nach ihrer Rolle getrennt. Eine lose Gesamtzahl
 * waere hier zu wenig: sie bliebe gruen, wenn der Re-Export zum Aufruf wuerde
 * oder eine Definition ins Repository wanderte.
 */
const ERLAUBTE_STELLEN: readonly string[] = [GRENZDATEI, REPOSITORY, BARREL];

describe("die Umrechnung valid_to <-> validTo hat genau eine Stelle (EYT-109 D1)", () => {
  it("liest den ganzen Produktivbaum — sonst prueft dieser Test zu wenig", () => {
    // Nicht-Leerlauf-Bremse: ein Tippfehler im Pfad machte den Waechter sonst
    // still gruen (dieselbe Regel wie im Architekturtest, EYT-46). Gemessen am
    // Stand 8ac1863: 161 Produktivdateien.
    expect(PRODUKTIVDATEIEN.length).toBeGreaterThan(100);

    // Der Scan erreicht JEDES Workspace-Paket. Ohne diese Zusicherung koennte
    // ein kaputtes Glob auf das Kostenmodul zurueckfallen, und genau die
    // Luecke, wegen der dieser Waechter erweitert wurde, waere zurueck.
    for (const wurzel of [
      "apps/api/",
      "apps/web/",
      "packages/config/",
      "packages/contracts/",
      "packages/domain/",
      "packages/ui/",
    ]) {
      expect(
        PRODUKTIVDATEIEN.some((datei) => datei.startsWith(wurzel)),
        `keine Produktivdatei unter ${wurzel} gefunden — der Scan greift zu kurz`,
      ).toBe(true);
    }

    // Er erreicht insbesondere FREMDE Module. `costs-cross-module-public-api-only`
    // erlaubt ihnen den Import von `costs/index.ts`; dort kann die Umrechnung
    // also legal landen, und dort muss der Waechter hinsehen.
    for (const fremd of [
      "apps/api/src/app.module.ts",
      "apps/api/src/modules/workforce/infrastructure/employee-directory.repository.ts",
      "apps/api/src/modules/planning/index.ts",
    ]) {
      expect(PRODUKTIVDATEIEN, `${fremd} fehlt im Scanbereich`).toContain(fremd);
    }

    // Tests und Buildartefakte sind draussen — sonst faerbte die eigene Doku
    // dieser Datei den Waechter rot.
    expect(PRODUKTIVDATEIEN.some((datei) => datei.includes("/test/"))).toBe(false);
    expect(PRODUKTIVDATEIEN.some((datei) => datei.startsWith("apps/api/dist-harness/"))).toBe(
      false,
    );
    expect(PRODUKTIVDATEIEN).not.toContain("apps/web/next-env.d.ts");
    // Aber `src/testing/` ist ausgelieferter Code und bleibt drin.
    expect(PRODUKTIVDATEIEN).toContain(
      "packages/contracts/src/testing/planning-gateway-contract.ts",
    );

    // Und die drei erlaubten Stellen liegen wirklich im Scanbereich.
    for (const datei of ERLAUBTE_STELLEN) {
      expect(PRODUKTIVDATEIEN, `${datei} fehlt im Scanbereich`).toContain(datei);
    }
    // Die Schichten, die `domain-allowlist` nicht erreicht, sind vertreten.
    expect(MODULDATEIEN.some((f) => f.startsWith(`${COSTS_ROOT}/application/`))).toBe(true);
    expect(MODULDATEIEN.some((f) => f.startsWith(`${COSTS_ROOT}/interface/`))).toBe(true);
  });

  it("W1 — keine Produktivdatei ausserhalb der drei erlaubten Stellen nennt die Umrechnung", () => {
    // Gegenmutation (ausgefuehrt und gemessen, EYT-109 D1 Guard-Reparatur): in
    // `apps/api/src/modules/workforce/infrastructure/employee-directory.repository.ts`
    // `import { dbEndeZuValidTo } from "../../costs";` plus einen echten Aufruf
    // ergaenzen -> rot, mit genau dieser Datei im Fehlertext. Die Mutation
    // KOMPILIERT (typecheck Exit 0) und passiert alle bestehenden Waechter:
    // `costs-cross-module-public-api-only` erlaubt fremden Modulen genau diesen
    // oeffentlichen Import, `layer-direction` greift nur modulintern, und
    // `domain-allowlist` erreicht `infrastructure/` nicht. Vor dieser Fassung
    // blieb der Waechter dabei gruen — deshalb gibt es sie.
    const erlaubt = new Set(ERLAUBTE_STELLEN);
    const verstoesse: string[] = [];

    for (const datei of PRODUKTIVDATEIEN) {
      if (erlaubt.has(datei)) continue;
      for (const stelle of fundstellen(quelleVon(datei), UEBERSETZUNG_REFERENZ)) {
        verstoesse.push(`${datei}:${stelle.zeile} — ${stelle.text}`);
      }
    }

    expect(
      verstoesse,
      "Eine zweite Uebersetzungsstelle. Die Umrechnung zwischen der halboffenen " +
        "Datenbankgrenze und dem fachlichen `validTo` gehoert ausschliesslich an " +
        "die Repository-Grenze (EYT-109 D1) — sonst rechnet irgendwann jemand " +
        "zweimal um, und die Naht verschiebt sich still um einen Tag. Erlaubt " +
        `sind nur: Definition in ${GRENZDATEI}, Aufruf in ${REPOSITORY}, ` +
        `Re-Export in ${BARREL}.`,
    ).toEqual([]);
  });

  it("W1a — die Grenzdatei enthaelt die beiden Definitionen und rechnet selbst nichts weiter um", () => {
    // Ohne diese Zusicherung waere W1 auch dann gruen, wenn die Umrechnung
    // ueberhaupt nicht mehr hier stuende — die Allowlist ist dann eine Ausnahme
    // fuer etwas, das es nicht gibt.
    const quelle = ohneKommentare(quelleVon(GRENZDATEI));
    expect(quelle).toMatch(/export function dbEndeZuValidTo\s*\(/);
    expect(quelle).toMatch(/export function validToZuDbEnde\s*\(/);
    // Genau zwei Klammerformen: die beiden Definitionen, kein dritter Aufruf.
    expect(quelle.match(new RegExp(UEBERSETZUNG_AUFRUF, "g"))?.length ?? 0).toBe(2);
  });

  it("W1b — beide Richtungen stehen im Repository, keine fehlt", () => {
    // Ohne diese Zusicherung waere W1 auch dann gruen, wenn eine der beiden
    // Richtungen gar nicht mehr benutzt wuerde — der rohe Durchgriff waere
    // zurueck und niemand saehe es.
    const quelle = ohneKommentare(quelleVon(REPOSITORY));
    expect(quelle.match(/\bdbEndeZuValidTo\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(quelle.match(/\bvalidToZuDbEnde\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("W1c — der Barrel re-exportiert nur, er rechnet nicht", () => {
    // Der Barrel `index.ts` steht in der Allowlist, WEIL er re-exportiert:
    // der Unit-Test der Umrechnung kaeme sonst nicht ohne tiefen Pfad an sie
    // heran (`costs-cross-module-public-api-only`). Ein Re-Export rechnet
    // nichts um — ein Aufruf dort waere eine zweite Stelle und muss rot sein,
    // obwohl die Datei erlaubt ist.
    const quelle = ohneKommentare(quelleVon(BARREL));
    expect(quelle).toMatch(
      /export \{ dbEndeZuValidTo, validToZuDbEnde \} from "\.\/infrastructure\/rate-interval-boundary";/,
    );
    expect(
      fundstellen(quelleVon(BARREL), UEBERSETZUNG_AUFRUF),
      "Der Barrel darf die Umrechnung re-exportieren, aber nicht aufrufen (EYT-109 D1).",
    ).toEqual([]);
  });

  it("W2 — der Spaltenname `valid_to` erscheint in keiner Produktivdatei ausserhalb `costs/infrastructure/`", () => {
    // Gegenmutation: in `domain/rate-effectivity.ts` ein Feld `valid_to`
    // einfuehren oder eine SQL-artige Zeichenkette mit `valid_to` in
    // `application/` oder in `apps/web/` ablegen -> rot. Gemessen ist der
    // Ist-Stand sauber: im gesamten Produktivbaum steht `valid_to` in genau
    // EINER Datei, `rate-repository.pg.ts`. Der Scan ist deshalb aus demselben
    // Grund wie bei W1 auf `apps/` + `packages/` erweitert und kostet nichts.
    const verstoesse: string[] = [];

    for (const datei of PRODUKTIVDATEIEN) {
      if (datei.startsWith(`${COSTS_ROOT}/infrastructure/`)) continue;
      for (const stelle of fundstellen(quelleVon(datei), DB_SPALTE)) {
        verstoesse.push(`${datei}:${stelle.zeile} — ${stelle.text}`);
      }
    }

    expect(
      verstoesse,
      "Ein Datenbankbegriff ausserhalb der Infrastrukturschicht. `valid_to` ist " +
        "die halboffene Speichergrenze; oberhalb heisst dasselbe Ding `validTo` " +
        "und bedeutet den letzten wirksamen Tag (EYT-109 D1).",
    ).toEqual([]);

    // Nicht-Leerlauf: die eine erlaubte Datei nennt die Spalte wirklich.
    expect(fundstellen(quelleVon(REPOSITORY), DB_SPALTE).length).toBeGreaterThan(0);
  });

  it("W3 — die Grenzdatei wird von genau einer Produktivdatei benutzt", () => {
    // Gegenmutation: einen Import in `application/rate-repository.port.ts`
    // einfuegen -> rot.
    //
    // Der Barrel `index.ts` zaehlt NICHT als Benutzer: er re-exportiert nur,
    // damit der Unit-Test der Umrechnung ohne tiefen Pfad auskommt
    // (`costs-cross-module-public-api-only`). Ein Re-Export rechnet nichts um.
    //
    // Der Scan laeuft ueber den ganzen Produktivbaum, nicht nur ueber das
    // Kostenmodul: ein tiefer Import von aussen faellt zwar schon an
    // `costs-cross-module-public-api-only`, aber ein Waechter, der sich auf
    // einen anderen Waechter verlaesst, misst dessen Fortbestand nicht mit.
    const importeure = extractImports(repoRoot, PRODUKTIVDATEIEN)
      .filter((ref) => ref.resolved === GRENZDATEI)
      .map((ref) => ref.from);

    expect(importeure.filter((datei) => datei !== BARREL)).toEqual([REPOSITORY]);
    // Und der Re-Export existiert wirklich — sonst waere die Zeile oben eine
    // Ausnahme fuer etwas, das es gar nicht gibt.
    expect(importeure).toContain(BARREL);
  });

  it("erkennt eine zweite Uebersetzungsstelle tatsaechlich", () => {
    // Gegenprobe gegen den Leerlauf: ohne sie waeren W1 und W2 auch dann
    // gruen, wenn die Muster nie zutreffen koennten.
    const treffer = [
      "  const x = dbEndeZuValidTo(version.validTo);",
      "const ende = validToZuDbEnde(kommando.validTo);",
      "  readonly valid_to: string | null;",
      "const sql = `select valid_to from public.employee_rate_versions`;",
    ];
    for (const zeile of treffer) {
      expect(
        UEBERSETZUNG_REFERENZ.test(zeile) || DB_SPALTE.test(zeile),
        `sollte ein Treffer sein: ${zeile}`,
      ).toBe(true);
    }

    // Die Umgehung, die eine reine Aufrufpruefung nicht saehe: den Bezeichner
    // erst binden, dann anderswo rufen. W1 prueft deshalb auf Referenz.
    const ohneKlammer = [
      "  const umrechnen = dbEndeZuValidTo;",
      'import { validToZuDbEnde } from "../../costs";',
      'export { dbEndeZuValidTo } from "./infrastructure/rate-interval-boundary";',
    ];
    for (const zeile of ohneKlammer) {
      expect(UEBERSETZUNG_REFERENZ.test(zeile), `Referenz nicht erkannt: ${zeile}`).toBe(true);
      expect(UEBERSETZUNG_AUFRUF.test(zeile), `faelschlich als Aufruf gewertet: ${zeile}`).toBe(
        false,
      );
    }

    // Und die erlaubten Formen duerfen NICHT anschlagen, sonst waere der
    // Waechter unbrauchbar und wuerde beim ersten echten Einsatz entschaerft.
    const erlaubt = [
      "  return { ok: true, validToDesVorgaengers: formatLocalDate(dayBefore(tag)) };",
      "  if (version.validTo !== null && version.validTo < businessDate) return 'abgelaufen';",
      "  validTo: record.validTo === null ? null : parseLocalDate(record.validTo),",
      "  const morgen = dayAfter(heute);",
      "  const gestern = dayBefore(heute);",
      "  readonly validTo: string | null;",
    ];
    for (const zeile of erlaubt) {
      expect(
        UEBERSETZUNG_REFERENZ.test(zeile),
        `Kalenderprimitiv faelschlich verboten: ${zeile}`,
      ).toBe(false);
      expect(DB_SPALTE.test(zeile), `fachliches validTo faelschlich verboten: ${zeile}`).toBe(
        false,
      );
    }

    // Kommentare sind ausgenommen — sonst schluege der Waechter auf den
    // Begruendungen an, die im Modul ausdruecklich erwuenscht sind. Gemessen:
    // genau so stehen sie in `costs/domain/rate-succession.ts` und in
    // `apps/web/e2e/auth-journey/journey.pwtest.ts`.
    expect(fundstellen("// die Datenbank fuehrt valid_to halboffen", DB_SPALTE)).toEqual([]);
    expect(
      fundstellen("/* dbEndeZuValidTo(x) waere hier falsch */", UEBERSETZUNG_REFERENZ),
    ).toEqual([]);
  });
});
