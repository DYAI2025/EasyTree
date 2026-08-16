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
 * `application/` und `interface/` ab, die `domain-allowlist` nicht erreicht.
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

/** Produktivdateien des Kostenmoduls — Tests und Buildartefakte ausgenommen. */
const MODULDATEIEN: readonly string[] = collectSourceFiles(repoRoot, COSTS_ROOT).filter(
  (file) => !file.includes("/test/") && !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
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

/** Aufruf ODER Definition der beiden Umrechnungen. */
const UEBERSETZUNG = /\b(dbEndeZuValidTo|validToZuDbEnde)\s*\(/;
/** Der Spaltenname der Datenbank — als ganzes Wort. */
const DB_SPALTE = /\bvalid_to\b/;

describe("die Umrechnung valid_to <-> validTo hat genau eine Stelle (EYT-109 D1)", () => {
  it("findet ueberhaupt Moduldateien — sonst prueft dieser Test nichts", () => {
    // Nicht-Leerlauf-Bremse: ein Tippfehler im Pfad machte den Waechter sonst
    // still gruen (dieselbe Regel wie im Architekturtest, EYT-46).
    expect(MODULDATEIEN.length).toBeGreaterThan(10);
    expect(MODULDATEIEN).toContain(GRENZDATEI);
    expect(MODULDATEIEN).toContain(REPOSITORY);
    // Und es gibt Dateien in genau den Schichten, die dieser Waechter meint.
    expect(MODULDATEIEN.some((f) => f.startsWith(`${COSTS_ROOT}/application/`))).toBe(true);
    expect(MODULDATEIEN.some((f) => f.startsWith(`${COSTS_ROOT}/interface/`))).toBe(true);
  });

  it("W1 — die Umrechnung wird nur an der Repository-Grenze benutzt", () => {
    // Gegenmutation: in `interface/http/costs.controller.ts` eine Zeile
    // `const x = dbEndeZuValidTo(version.validTo);` einfuegen -> rot. Diese
    // Mutation KOMPILIERT und passiert alle bestehenden Waechter:
    // `layer-direction` erlaubt `interface(3) -> infrastructure(2)`,
    // `module-public-api-only` greift nicht bei modulinternen Pfaden, und
    // `domain-allowlist` erreicht `interface/` nicht. W1 ist der einzige
    // Waechter, der sie faengt — die Gegenmutation ist damit nachweislich
    // nicht vakuum.
    const erlaubt = new Set([GRENZDATEI, REPOSITORY]);
    const verstoesse: string[] = [];
    let treffer = 0;

    for (const datei of MODULDATEIEN) {
      const gefunden = fundstellen(readFileSync(resolve(repoRoot, datei), "utf8"), UEBERSETZUNG);
      treffer += gefunden.length;
      if (erlaubt.has(datei)) continue;
      for (const stelle of gefunden) {
        verstoesse.push(`${datei}:${stelle.zeile} — ${stelle.text}`);
      }
    }

    expect(
      verstoesse,
      "Eine zweite Uebersetzungsstelle. Die Umrechnung zwischen der halboffenen " +
        "Datenbankgrenze und dem fachlichen `validTo` gehoert ausschliesslich an " +
        "die Repository-Grenze (EYT-109 D1) — sonst rechnet irgendwann jemand " +
        "zweimal um, und die Naht verschiebt sich still um einen Tag.",
    ).toEqual([]);

    // Und der Waechter hat ueberhaupt etwas gesehen: Definition (2) plus die
    // vier Aufrufstellen im Repository.
    expect(treffer).toBeGreaterThanOrEqual(6);
  });

  it("W1b — beide Richtungen stehen im Repository, keine fehlt", () => {
    // Ohne diese Zusicherung waere W1 auch dann gruen, wenn eine der beiden
    // Richtungen gar nicht mehr benutzt wuerde — der rohe Durchgriff waere
    // zurueck und niemand saehe es.
    const quelle = ohneKommentare(readFileSync(resolve(repoRoot, REPOSITORY), "utf8"));
    expect(quelle.match(/\bdbEndeZuValidTo\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(quelle.match(/\bvalidToZuDbEnde\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("W2 — der Spaltenname `valid_to` erscheint nur unter `infrastructure/`", () => {
    // Gegenmutation: in `domain/rate-effectivity.ts` ein Feld `valid_to`
    // einfuehren oder eine SQL-artige Zeichenkette mit `valid_to` in
    // `application/` ablegen -> rot. Gemessen ist der Ist-Stand sauber: alle
    // Vorkommen ausserhalb `infrastructure/` sind Kommentare.
    const verstoesse: string[] = [];

    for (const datei of MODULDATEIEN) {
      if (datei.startsWith(`${COSTS_ROOT}/infrastructure/`)) continue;
      for (const stelle of fundstellen(readFileSync(resolve(repoRoot, datei), "utf8"), DB_SPALTE)) {
        verstoesse.push(`${datei}:${stelle.zeile} — ${stelle.text}`);
      }
    }

    expect(
      verstoesse,
      "Ein Datenbankbegriff ausserhalb der Infrastrukturschicht. `valid_to` ist " +
        "die halboffene Speichergrenze; oberhalb heisst dasselbe Ding `validTo` " +
        "und bedeutet den letzten wirksamen Tag (EYT-109 D1).",
    ).toEqual([]);
  });

  it("W3 — die Grenzdatei wird von genau einer Produktivdatei benutzt", () => {
    // Gegenmutation: einen Import in `application/rate-repository.port.ts`
    // einfuegen -> rot.
    //
    // Der Barrel `index.ts` zaehlt NICHT als Benutzer: er re-exportiert nur,
    // damit der Unit-Test der Umrechnung ohne tiefen Pfad auskommt
    // (`costs-cross-module-public-api-only`). Ein Re-Export rechnet nichts um.
    const importeure = extractImports(repoRoot, MODULDATEIEN)
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
        UEBERSETZUNG.test(zeile) || DB_SPALTE.test(zeile),
        `sollte ein Treffer sein: ${zeile}`,
      ).toBe(true);
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
      expect(UEBERSETZUNG.test(zeile), `Kalenderprimitiv faelschlich verboten: ${zeile}`).toBe(
        false,
      );
      expect(DB_SPALTE.test(zeile), `fachliches validTo faelschlich verboten: ${zeile}`).toBe(
        false,
      );
    }

    // Kommentare sind ausgenommen — sonst schluege der Waechter auf den
    // Begruendungen an, die im Modul ausdruecklich erwuenscht sind.
    expect(fundstellen("// die Datenbank fuehrt valid_to halboffen", DB_SPALTE)).toEqual([]);
    expect(fundstellen("/* dbEndeZuValidTo(x) waere hier falsch */", UEBERSETZUNG)).toEqual([]);
  });
});
