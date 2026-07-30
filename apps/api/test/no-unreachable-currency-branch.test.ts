/**
 * Statischer Waechter: kein unerreichbarer Waehrungszweig im Domaincode
 * (EYT-95, PRD V5.4-korrigiert).
 *
 * ## Warum ein statischer Waechter und kein Verhaltenstest
 *
 * Ein toter Zweig laesst sich per Definition nicht durch Verhalten pruefen —
 * genau das ist seine Eigenschaft. Der Befund, der zu V5.4-korrigiert gefuehrt
 * hat, war deshalb auch keinem Verhaltenstest zugaenglich: eine Gegenmutation,
 * die BEIDE Waehrungswaechter abschaltete, liess das Testergebnis unveraendert
 * bei `2 failed | 203 passed`. Die Regeln waren von keinem Test gemessen und
 * haetten ersatzlos entfallen koennen.
 *
 * Was sich pruefen laesst, ist die Abwesenheit der Konstruktion. Dieser Test
 * misst also nicht, dass der Zweig richtig rechnet, sondern dass es ihn nicht
 * gibt.
 *
 * ## Warum hier und nicht in `packages/domain/test/`
 *
 * `packages/domain` setzt `"types": []` und hat bewusst keine Abhaengigkeiten
 * (ADR-001 Z. 74). Ein Test, der Dateien liest, braucht die Node-Typen — sie
 * dort verfuegbar zu machen hiesse, genau den Wall einzureissen, den das Paket
 * ausmacht. Dieselbe Begruendung wie bei `domain-invariant-coverage.test.ts`
 * und `no-local-time-construction.test.ts`.
 *
 * ## Was verboten ist
 *
 * `Currency` ist unter `CURRENCIES = ["EUR"] as const` das Einzelliteral
 * `"EUR"`. Zwei gueltig konstruierte `Money`-Werte koennen deshalb keine
 * unterschiedlichen Waehrungen tragen. Ein Vergleich zweier Waehrungen im
 * Domainkern ist damit ein toter Zweig, und `CURRENCY_MISMATCH` ein Code, den
 * niemand ausloesen kann.
 *
 * Erlaubt bleibt ausdruecklich die Pruefung an der untrusted Eingangsgrenze
 * (`costCurrencyFromUnknown`): dort kommt ein `unknown` an, dort ist der
 * Vergleich gegen ein Literal echt erreichbar. Die Regeln unten treffen ihn
 * nicht — sie verbieten den Vergleich zweier `.currency`-Felder, nicht den
 * Vergleich eines Werts gegen `"EUR"`.
 */
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { collectSourceFiles } from "./architecture/scan";

const repoRoot = resolve(__dirname, "..", "..", "..");

/**
 * Geltungsbereich: der Domainkern in seiner Produktionsfassung.
 *
 * `test/` ist ausgenommen — Tests duerfen und sollen ueber Waehrungen reden,
 * etwa um die Abwesenheit von `CURRENCY_MISMATCH` in den Fehlerlisten zu
 * pruefen.
 */
const DOMAIN_SOURCES: readonly string[] = collectSourceFiles(repoRoot, "packages/domain").filter(
  (file) => file.includes("/src/") && !file.endsWith(".test.ts"),
);

interface ForbiddenPattern {
  readonly id: string;
  readonly pattern: RegExp;
  readonly why: string;
}

const FORBIDDEN: readonly ForbiddenPattern[] = [
  {
    id: "CURRENCY_MISMATCH",
    // Der Code selbst — in einer Fehlerliste, einer Result-Union oder einem
    // Wurf. V5.4-korrigiert entfernt ihn ohne Ausnahme.
    pattern: /CURRENCY_MISMATCH/,
    why:
      "CURRENCY_MISMATCH entfaellt in Sprint 5 vollstaendig. Zwei gueltig konstruierte " +
      "Money-Werte koennen keine unterschiedlichen Waehrungen haben; der Code waere eine " +
      "Waise. Ohne Ausnahme fuer 'strukturell unerreichbare Codes' — die wuerde den " +
      "Waisenvalidator schwaechen, der den Befund gefunden hat.",
  },
  {
    id: "waehrungsvergleich",
    // Zwei `.currency`-Felder gegeneinander. Trifft `a.currency !== b.currency`
    // ebenso wie `left.currency === right.currency`, aber NICHT den Vergleich
    // gegen ein Literal an der untrusted Grenze.
    pattern: /\.currency\s*[!=]==\s*[A-Za-z_$][\w$]*\.currency/,
    why:
      "Ein Vergleich zweier Waehrungsfelder im Domainkern ist ein toter Zweig: `Currency` " +
      'ist das Einzelliteral "EUR". Die Pruefung gehoert an die untrusted Eingangsgrenze ' +
      "(costCurrencyFromUnknown), wo wirklich ein unknown ankommt.",
  },
];

/** Sucht die verbotenen Muster in einer Menge von Dateien. */
function findViolations(root: string, files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf8");
    for (const rule of FORBIDDEN) {
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        // Kommentarzeilen sind ausgenommen: der Vertrag darf und soll
        // begruenden, WARUM es den Zweig nicht gibt.
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
        if (rule.pattern.test(line)) hits.push(`${file}:${index + 1} [${rule.id}] ${trimmed}`);
      });
    }
  }
  return hits.sort();
}

describe("Kein unerreichbarer Waehrungszweig im Domaincode (V5.4-korrigiert)", () => {
  it("liest ueberhaupt Domainquellen — sonst prueft dieser Test nichts", () => {
    // Nicht-Leerlauf-Bremse. Ein falscher Pfad oder ein kaputter Filter wuerde
    // die Zusicherung darunter still gruen machen: keine Datei, kein Treffer.
    // Genau diese Vakuositaet ist der haeufigste Defekt eines statischen
    // Waechters.
    expect(DOMAIN_SOURCES.length).toBeGreaterThan(5);
    expect(DOMAIN_SOURCES.some((file) => file.endsWith("money.ts"))).toBe(true);
  });

  it("fuehrt weder CURRENCY_MISMATCH noch einen Vergleich zweier Waehrungen", () => {
    // Gegenmutation: `CURRENCY_MISMATCH` in `MONEY_ERRORS` zurueckschreiben
    // oder `assertSameCurrency` mit `left.currency !== right.currency`
    // wiederherstellen -> rot, mit Datei und Zeilennummer.
    const violations = findViolations(repoRoot, DOMAIN_SOURCES);
    expect(violations, FORBIDDEN.map((rule) => `${rule.id}: ${rule.why}`).join("\n\n")).toEqual([]);
  });

  it("erkennt einen eingebauten Verstoss tatsaechlich", () => {
    // Gegenprobe gegen einen SYNTHETISCHEN Baum in `os.tmpdir()`, nie gegen
    // den echten. Ohne sie waere die Zusicherung darueber auch dann gruen,
    // wenn die Muster nie greifen koennten — ein Waechter, der nichts findet,
    // weil er nichts finden KANN, ist der Normalfall des Scheinnachweises.
    const root = mkdtempSync(join(tmpdir(), "eyt95-waehrung-"));
    mkdirSync(join(root, "packages", "domain", "src"), { recursive: true });

    writeFileSync(
      join(root, "packages", "domain", "src", "verstoss-code.ts"),
      'export const MONEY_ERRORS = ["CURRENCY_MISMATCH"] as const;\n',
      "utf8",
    );
    writeFileSync(
      join(root, "packages", "domain", "src", "verstoss-vergleich.ts"),
      "export function add(left: M, right: M) {\n" +
        "  if (left.currency !== right.currency) throw new Error('nein');\n" +
        "  return left;\n" +
        "}\n",
      "utf8",
    );
    // Eine Datei, die den Vertrag EINHAELT: der Vergleich gegen ein Literal an
    // der untrusted Grenze muss erlaubt bleiben, sonst waere der Waechter zu
    // scharf und verboete die richtige Loesung.
    writeFileSync(
      join(root, "packages", "domain", "src", "erlaubt-grenze.ts"),
      "export function costCurrencyFromUnknown(value: unknown) {\n" +
        '  return value === "EUR" ? { ok: true, value } : { ok: false };\n' +
        "}\n",
      "utf8",
    );

    const files = collectSourceFiles(root, "packages/domain").filter((file) =>
      file.includes("/src/"),
    );
    const violations = findViolations(root, files);

    expect(violations).toHaveLength(2);
    expect(violations.some((hit) => hit.includes("[CURRENCY_MISMATCH]"))).toBe(true);
    expect(violations.some((hit) => hit.includes("[waehrungsvergleich]"))).toBe(true);
    // Und die vertragstreue Datei wird NICHT gemeldet.
    expect(violations.some((hit) => hit.includes("erlaubt-grenze"))).toBe(false);
  });
});
