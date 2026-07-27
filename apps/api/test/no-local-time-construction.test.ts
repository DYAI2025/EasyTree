/**
 * Statischer Waechter: kein Produktionscode baut eine Zeit aus Wanduhrteilen
 * (EYT-61 AK6a).
 *
 * ## Der Befund, den dieser Test festhaelt
 *
 * AK6 verlangt die Abdeckung der "Sommerzeitluecke" — der Stunde, die es an
 * einem Tag im Jahr nicht gibt (Europe/Berlin 2026: 02:00–03:00 am 29. Maerz).
 *
 * Diese Luecke kann heute NICHT entstehen. Sie entsteht ausschliesslich, wenn
 * jemand aus Ortszeit-Bestandteilen — Jahr, Monat, Tag, Stunde, Minute — einen
 * Zeitpunkt konstruiert: dann gibt es fuer "29.03.2026 02:30" keinen Instant,
 * und jede Bibliothek erfindet einen. Im Repository gibt es diese Richtung
 * nirgends: Zeit kommt als UTC-Instant herein und wird nur zur ANZEIGE in eine
 * Zone gerechnet (`Intl` mit explizitem `timeZone`).
 *
 * Ein Test, der die Luecke "abdeckt", waere deshalb heute nicht moeglich —
 * es gibt keinen Aufrufpfad, an dem sie auftreten koennte. Was moeglich und
 * ehrlich ist: sicherstellen, dass diese Eigenschaft nicht unbemerkt verloren
 * geht. Sobald ein Eingabefeld eine Ortszeit annimmt, faellt dieser Test —
 * und wer ihn dann anpasst, muss zugleich entscheiden, was "02:30 am 29. Maerz"
 * bedeuten soll. Genau diese Entscheidung will AK6a erzwingen.
 *
 * ## Allowlist, nicht Blockliste
 *
 * Erlaubt ist ausdruecklich, was UTC-eindeutig ist: `Date.UTC(...)`,
 * `new Date(<zahl>)`, `new Date(<ISO-String mit Z oder Offset>)`, `getUTC*`,
 * `setUTC*`, `toISOString`. Alles andere, was aus Teilen baut oder auf der
 * Maschinenzone arbeitet, ist ein Treffer. Dieselbe Begruendung wie bei
 * `domain-allowlist` (EYT-46): eine endliche Liste verbotener Formen kann ein
 * universelles Verbot nicht ausdruecken.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { collectSourceFiles } from "./architecture/scan";

const repoRoot = resolve(__dirname, "..", "..", "..");

/**
 * Produktionsquellen. `test/`, `e2e/` und `dist/` sind ausgenommen: Tests
 * duerfen und sollen Ortszeiten konstruieren, um Verhalten zu pruefen.
 */
const PRODUCTION_FILES: readonly string[] = [
  ...collectSourceFiles(repoRoot, "apps"),
  ...collectSourceFiles(repoRoot, "packages"),
].filter(
  (file) =>
    !file.includes("/test/") &&
    !file.includes("/e2e/") &&
    !file.endsWith(".test.ts") &&
    !file.endsWith(".test.tsx"),
);

interface Forbidden {
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Ein Datums-Zeit-String OHNE Zonenangabe.
 *
 * ECMA-262 unterscheidet zwei Faelle, und der Unterschied ist genau die Falle:
 *   "2026-03-29"            -> nur Datum, wird als UTC gelesen. Harmlos.
 *   "2026-03-29T02:30"      -> Datum UND Zeit ohne Offset, wird als ORTSZEIT
 *                              der Maschine gelesen. Genau die Mehrdeutigkeit,
 *                              die dieser Waechter verhindern soll — und an
 *                              diesem Beispiel gibt es den Zeitpunkt in
 *                              Europe/Berlin gar nicht.
 *   "2026-03-29T02:30:00Z"  -> eindeutig. Erlaubt.
 *   "...T02:30:00+02:00"    -> eindeutig. Erlaubt.
 *
 * Das erste Muster unten fand diesen Fall NICHT: es verlangt ein Komma, und
 * ein Einzelstring hat keins.
 */
const ZONELESS_DATE_TIME =
  /new\s+Date\s*\(\s*(["'`])(?![^"'`]*(?:Z|[+-]\d{2}:?\d{2})["'`])[^"'`]*\d{1,2}:\d{2}[^"'`]*\1/;

const FORBIDDEN: readonly Forbidden[] = [
  {
    // new Date(2026, 2, 29, 2, 30) — Ortszeit der MASCHINE, nicht der Organisation.
    pattern: /new\s+Date\s*\([^)]*,[^)]*\)/,
    why: "new Date(<jahr>, <monat>, ...) baut eine Zeit in der Zone der Maschine. An der Sommerzeitluecke gibt es den gemeinten Zeitpunkt nicht, und die Laufzeit erfindet einen.",
  },
  {
    pattern: ZONELESS_DATE_TIME,
    why: 'new Date("<datum>T<zeit>") ohne Z oder Offset wird laut ECMA-262 als ORTSZEIT der Maschine gelesen. Entweder Z anhaengen oder den Offset ausschreiben.',
  },
  {
    pattern: /\.set(?!UTC)(FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)\s*\(/,
    why: "Ein nicht-UTC-Setter rechnet in der Zone der Maschine. Ueber eine Zeitumstellung springt das Ergebnis um eine Stunde.",
  },
  {
    pattern: /\.get(?!UTC)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(/,
    why: "Ein nicht-UTC-Getter liest in der Zone der Maschine. Der Kalendertag der Organisation kommt aus localBusinessDate mit expliziter IANA-Zone.",
  },
  {
    pattern: /getTimezoneOffset\s*\(/,
    why: "getTimezoneOffset liefert den Offset der MASCHINE. Die Zone der Organisation steht in organizations.time_zone.",
  },
];

/**
 * `Date.UTC(...)` wird vor dem Vergleich zu `0` eingedampft.
 *
 * Ohne diesen Schritt schlaegt das Muster fuer `new Date(<jahr>, <monat>, ...)`
 * ausgerechnet auf `new Date(Date.UTC(2026, 2, 29))` an — der KORREKTEN Form.
 * Ein Waechter, der die richtige Schreibweise anmeckert, wird beim ersten
 * echten Einsatz entschaerft statt befolgt.
 */
function normalize(line: string): string {
  return line.replace(/Date\.UTC\s*\([^)]*\)/g, "0");
}

/** Quelltext ohne Kommentare — sonst schlaegt der Waechter auf seiner eigenen Doku an. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function codeLines(source: string): { readonly line: string; readonly number: number }[] {
  return stripComments(source)
    .split("\n")
    .map((line, index) => ({ line: normalize(line), number: index + 1 }));
}

/**
 * Derselbe Quelltext, aber ohne Zeilenumbrueche.
 *
 * Der zeilenweise Scan uebersieht eine ueber mehrere Zeilen umbrochene
 * Konstruktion — und Prettier bricht lange Aufrufe automatisch um, der Fall
 * entsteht also von selbst:
 *
 *     const start = new Date(
 *       2026, 2, 29,
 *       2, 30,
 *     );
 *
 * Diese Fassung findet ihn. Sie kann keine Zeilennummer nennen; das ist der
 * Preis und immer noch besser als ein Waechter, den ein Zeilenumbruch aushebelt.
 */
function collapsed(source: string): string {
  return normalize(stripComments(source).replace(/\s+/g, " "));
}

describe("kein Produktionscode konstruiert Zeit aus Wanduhrteilen (EYT-61 AK6a)", () => {
  it("findet ueberhaupt Produktionsdateien — sonst prueft dieser Test nichts", () => {
    // Nicht-Leerlauf-Bremse: ein Tippfehler im Glob wuerde den Waechter sonst
    // still gruen machen (dieselbe Regel wie im Architekturtest, EYT-46).
    expect(PRODUCTION_FILES.length).toBeGreaterThan(20);
  });

  it("enthaelt keine Konstruktion aus Ortszeit-Bestandteilen", () => {
    const violations: string[] = [];

    for (const file of PRODUCTION_FILES) {
      const source = readFileSync(resolve(repoRoot, file), "utf8");
      const found = new Set<RegExp>();

      for (const { line, number } of codeLines(source)) {
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(line)) {
            found.add(pattern);
            violations.push(`${file}:${number} — ${line.trim()}\n    ${why}`);
          }
        }
      }

      // Zweiter Durchgang ohne Zeilenumbrueche. Nur melden, was der erste
      // nicht schon hat — sonst stuende jede umbrochene Fundstelle doppelt da.
      const oneLine = collapsed(source);
      for (const { pattern, why } of FORBIDDEN) {
        if (!found.has(pattern) && pattern.test(oneLine)) {
          violations.push(`${file} (ueber mehrere Zeilen umbrochen)\n    ${why}`);
        }
      }
    }

    expect(
      violations,
      "Neue Wanduhr-Konstruktion gefunden. Wer sie einfuehrt, muss entscheiden, " +
        "was '02:30 am 29. Maerz' in Europe/Berlin bedeuten soll — diesen Test " +
        "erst anpassen, wenn diese Entscheidung im Code steht (EYT-61 AK6a).",
    ).toEqual([]);
  });

  it("erkennt eine Wanduhr-Konstruktion tatsaechlich", () => {
    // Gegenprobe gegen den Leerlauf: ohne sie waere der Test oben auch dann
    // gruen, wenn die Muster nie zutreffen koennten.
    const synthetic = [
      "const start = new Date(2026, 2, 29, 2, 30);",
      "start.setHours(3);",
      "const day = start.getDate();",
      "const off = start.getTimezoneOffset();",
      // Der zonenlose Datums-Zeit-String: laut ECMA-262 Ortszeit der Maschine —
      // und diesen Zeitpunkt gibt es in Europe/Berlin ueberhaupt nicht.
      'const start = new Date("2026-03-29T02:30");',
      'const start = new Date("2026-03-29T02:30:00");',
      'const start = new Date("2026-03-29 02:30:00");',
    ];
    for (const line of synthetic) {
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(normalize(line))),
        line,
      ).toBe(true);
    }

    // Ueber mehrere Zeilen umbrochen. Prettier erzeugt diese Form von selbst,
    // sobald der Aufruf lang genug wird.
    const wrapped = "const start = new Date(\n  2026, 2, 29,\n  2, 30,\n);";
    expect(
      FORBIDDEN.some(({ pattern }) => pattern.test(collapsed(wrapped))),
      "umbrochene Konstruktion wird im zweiten Durchgang gefunden",
    ).toBe(true);
    expect(
      codeLines(wrapped).some(({ line }) => FORBIDDEN.some(({ pattern }) => pattern.test(line))),
      "der zeilenweise Scan allein findet sie NICHT — genau dafuer gibt es den zweiten Durchgang",
    ).toBe(false);

    // Und die erlaubten Formen duerfen NICHT anschlagen, sonst waere der
    // Waechter unbrauchbar und wuerde beim ersten echten Einsatz entschaerft.
    const allowed = [
      "const ms = Date.UTC(2026, 2, 29);",
      // Die haeufigste korrekte Form. Ohne normalize() waere sie ein Treffer.
      "const d = new Date(Date.UTC(2026, 2, 29));",
      "const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);",
      "const d = new Date(startMs);",
      'const d = new Date("2026-03-29T00:00:00Z");',
      // Ausgeschriebener Offset ist ebenso eindeutig wie Z.
      'const d = new Date("2026-03-29T02:30:00+02:00");',
      'const d = new Date("2026-03-29T02:30:00-05:00");',
      // Nur Datum, keine Zeit: liest ECMA-262 als UTC. Harmlos.
      'const d = new Date("2026-03-29");',
      "return d.getUTCFullYear();",
      "return new Date(utcMidnight).getUTCDay();",
      "d.setUTCHours(0, 0, 0, 0);",
      "return d.toISOString();",
    ];
    for (const line of allowed) {
      expect(
        FORBIDDEN.filter(({ pattern }) => pattern.test(normalize(line))).map(
          (f) => f.pattern.source,
        ),
        line,
      ).toEqual([]);
    }
  });
});
