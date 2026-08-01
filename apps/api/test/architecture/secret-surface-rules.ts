/**
 * Geheimnisgrenze zwischen privilegierten Zugaengen und dem Anfragepfad
 * (EYT-106 AK6, EYT-133).
 *
 * Kein `.test.ts`-Suffix: bewusst Helfer, keine eigene Suite — dieselbe
 * Konvention wie `architecture/scan.ts`, `architecture/rules.ts` und
 * `architecture/costs-rules.ts`.
 *
 * ## Was hier verhindert wird
 *
 * Ein Service-Role-Schluessel umgeht RLS vollstaendig. Erreicht er den
 * Anfrage- oder Browserpfad, ist die gesamte Mandantentrennung dieses
 * Produkts eine Behauptung. Heute passiert das nicht — aber nichts haelt den
 * Zustand fest, und genau das ist der Auftrag: `SUPABASE_SERVICE_ROLE_KEY`
 * hat null Treffer im Repository, und ohne Wächter faellt der erste Treffer
 * niemandem auf.
 *
 * Die Empfehlung stand schon in `docs/architecture/tenant-isolation-report.md`
 * Z. 224 ("Lint-/CI-Regel gegen SERVICE_ROLE im Runtime-Code"); hier wird sie
 * ausgefuehrt.
 *
 * ## Warum absichtsbasiert und nicht "ein Wort verbieten"
 *
 * Drei verschiedene Fragen, drei Regeln:
 *
 *  1. **Kein Supabase-SDK im Laufzeitpfad.** Das SDK ist der uebliche Traeger
 *     eines Admin-Clients (`createClient(url, serviceRoleKey)`,
 *     `auth.admin.*`). `apps/web/test/no-supabase-import.test.ts` prueft
 *     bereits EINEN Namen (`@supabase/supabase-js`) in `apps/web`;
 *     `api-dependency-allowlist` deckt `apps/api/src/**` ab, aber
 *     ausdruecklich NICHT `apps/api/src/platform/**` — dort liegt die gesamte
 *     Auth-Kette. Diese Regel schliesst beide Luecken und erfasst die ganze
 *     Familie `@supabase/*`, also auch `@supabase/ssr`.
 *
 *  2. **Der Laufzeitpfad liest die Umgebung nicht.** Das ist die eigentlich
 *     strukturelle Zusage. Konfiguration wird EINMAL beim Bootstrap gegen
 *     `ENV_VAR_META` validiert und dann injiziert; ein direktes
 *     `process.env.X` irgendwo im Anfragepfad umgeht diese Pruefung
 *     vollstaendig — und mit ihr die Zusicherung, dass nur sechs Variablen
 *     existieren. Wer keinen Zugriff auf die Umgebung hat, kann auch keinen
 *     Service-Role-Schluessel daraus ziehen, egal wie die Variable heisst.
 *     Erlaubt bleibt `NODE_ENV`: "in welcher Umgebung laufe ich" ist keine
 *     Zugangsberechtigung.
 *
 *  3. **Privilegierte Zugangsnamen nur an eng benannten Orten.** Namensbasiert
 *     und damit die schwaechste der drei — sie faengt den Fall, in dem jemand
 *     den Schluessel gar nicht ueber `process.env` holt, sondern etwa in eine
 *     Konfigurationsdatei oder ein Skript schreibt. Erlaubt sind einzeln
 *     benannte DATEIEN mit Begruendung, kein Verzeichnismuster (PO-Vorgabe
 *     01.08.2026: "Keine breite Allowlist nach Verzeichnisnamen").
 *
 * ## Warum die Muster aus Teilen zusammengesetzt sind
 *
 * Sonst enthielte ausgerechnet diese Datei die verbotenen Bezeichner und
 * muesste sich selbst ausnehmen — dieselbe Technik wie in
 * `apps/web/test/no-supabase-import.test.ts` Z. 12, und aus demselben Grund:
 * ein Wächter, der in seiner eigenen Ausnahmeliste steht, bewacht sich nicht.
 */
import { readFileSync } from "node:fs";

import ts from "typescript";

import type { ImportRef } from "./scan";

export interface SecretFinding {
  /** `pfad:zeile` */
  readonly location: string;
  readonly rule: string;
  readonly message: string;
}

export interface SecretRuleResult {
  readonly findings: readonly SecretFinding[];
  /** Welche Dateien die Regel tatsaechlich betrachtet hat (Nicht-Leerlauf). */
  readonly seen: ReadonlySet<string>;
}

export interface SecretSurfaceInput {
  readonly repoRoot: string;
  /** Repository-relative Pfade, "/"-normalisiert. */
  readonly files: readonly string[];
  readonly refs: readonly ImportRef[];
}

export interface SecretRule {
  readonly id: string;
  readonly summary: string;
  readonly evaluate: (input: SecretSurfaceInput) => SecretRuleResult;
}

/* ------------------------------------------------------------------ Pfade */

/**
 * Der Laufzeitpfad: alles, was eine echte Anfrage oder ein Browser ausfuehrt.
 *
 * Bewusst grosszuegig geschnitten — `apps/api/src/**` VOLLSTAENDIG, also
 * inklusive `platform/`, wo `api-dependency-allowlist` aufhoert. Ausgenommen
 * sind nur Dateien, die per Konstruktion nie in einer Anfrage laufen:
 * Werkzeugkonfigurationen und Testcode. Das ist die Definition der
 * Pruefoberflaeche, keine Ausnahme von einer Regel — Testcode ist die
 * "isolierte Test-/Ops-Grenze", von der die PO-Vorgabe spricht.
 */
export function istLaufzeitpfad(datei: string): boolean {
  if (datei.startsWith("apps/api/src/")) return true;
  if (!datei.startsWith("apps/web/")) return false;
  const ausgenommen = [
    "apps/web/test/",
    "apps/web/e2e/",
    "apps/web/playwright.config.ts",
    "apps/web/playwright.harness.config.ts",
    "apps/web/vitest.config.ts",
  ];
  return !ausgenommen.some((praefix) => datei.startsWith(praefix));
}

/** Dateiendungen, in denen ein Zugangsname ueberhaupt stehen kann. */
const GEPRUEFTE_ENDUNGEN = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
  ".sh",
  ".toml",
  ".yml",
  ".yaml",
];

export function istCodeDatei(datei: string): boolean {
  return GEPRUEFTE_ENDUNGEN.some((endung) => datei.endsWith(endung));
}

/* ------------------------------------------------------------- Kommentare */

type Kommentarstil = "c" | "raute" | "sql";

function stilFuer(datei: string): Kommentarstil {
  if (datei.endsWith(".sql")) return "sql";
  if (datei.endsWith(".sh") || datei.endsWith(".toml")) return "raute";
  if (datei.endsWith(".yml") || datei.endsWith(".yaml")) return "raute";
  return "c";
}

/**
 * Ersetzt Kommentarinhalte durch Leerzeichen — laengenerhaltend, damit
 * Zeilennummern stimmen.
 *
 * Notwendig, weil sonst ausgerechnet die Stellen feuern, die das Problem
 * ERKLAEREN: `token-verifier.ts` Z. 11 nennt `SERVICE_ROLE_KEY` in einem
 * Doc-Kommentar, Migration 0002 verbietet service_role-Policies in einem
 * SQL-Kommentar. Ein Wächter, der an der Dokumentation seiner selbst
 * scheitert, wird abgeschaltet statt befolgt (dieselbe Erfahrung wie in
 * `no-local-time-construction.test.ts` Z. 107-112).
 *
 * Anfuehrungszeichen werden mitverfolgt: ein `#` oder `--` INNERHALB eines
 * Strings leitet keinen Kommentar ein.
 */
export function entferneKommentare(quelle: string, datei: string): string {
  const stil = stilFuer(datei);
  const zeichen = [...quelle];
  const aus: string[] = [];
  let i = 0;
  let anfuehrung: string | null = null;

  const istZeilenkommentar = (): boolean => {
    if (stil === "c") return quelle.startsWith("//", i);
    if (stil === "sql") return quelle.startsWith("--", i);
    // In Shell und YAML ist `#` nur dann ein Kommentar, wenn es nicht Teil
    // einer Parametererweiterung ist: `$#` (Argumentzahl) und `${#var}`
    // (Laenge) wuerden sonst den Rest der Zeile unsichtbar machen — und damit
    // ausgerechnet still weniger pruefen.
    if (quelle[i] !== "#") return false;
    const davor = i > 0 ? quelle[i - 1] : "";
    return davor !== "$" && davor !== "{";
  };
  const istBlockstart = (): boolean =>
    (stil === "c" || stil === "sql") && quelle.startsWith("/*", i);

  while (i < zeichen.length) {
    const c = zeichen[i] as string;

    if (anfuehrung !== null) {
      aus.push(c);
      if (c === "\\" && stil === "c") {
        // Escape: naechstes Zeichen unveraendert uebernehmen.
        i += 1;
        if (i < zeichen.length) aus.push(zeichen[i] as string);
      } else if (c === anfuehrung) {
        anfuehrung = null;
      }
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || (stil === "c" && c === "`")) {
      anfuehrung = c;
      aus.push(c);
      i += 1;
      continue;
    }

    if (istZeilenkommentar()) {
      while (i < zeichen.length && zeichen[i] !== "\n") {
        aus.push(" ");
        i += 1;
      }
      continue;
    }

    if (istBlockstart()) {
      const ende = quelle.indexOf("*/", i + 2);
      const bis = ende === -1 ? zeichen.length : ende + 2;
      while (i < bis) {
        aus.push(zeichen[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }

    aus.push(c);
    i += 1;
  }
  return aus.join("");
}

/* --------------------------------------------------- privilegierte Namen */

/**
 * Familien privilegierter Zugaenge, zusammengesetzt statt ausgeschrieben
 * (siehe Kopfkommentar). Jede Familie nennt, WOFUER sie steht — die Meldung
 * soll erklaeren, nicht nur anklagen.
 */
const PRIVILEGIERTE_FAMILIEN: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(["SERVICE", "ROLE"].join("_"), "i"), "Service-Role-Zugang (umgeht RLS vollstaendig)"],
  [new RegExp(["SECRET", "KEY"].join("_"), "i"), "Supabase-Secret-Key (privilegierter API-Zugang)"],
  [new RegExp(["JWT", "SECRET"].join("_"), "i"), "JWT-Signaturgeheimnis (erlaubt Tokenfaelschung)"],
  [new RegExp(["service", "role"].join("_")), "PostgreSQL-Rolle mit RLS-Umgehung"],
  [new RegExp(`\\b${["PG", "PASSWORD"].join("")}\\b`), "Datenbankpasswort fuer Migrationen"],
  [new RegExp(["DB", "PASSWORD"].join("_"), "i"), "Datenbankpasswort"],
  [
    new RegExp(["SUPABASE", "ACCESS", "TOKEN"].join("_"), "i"),
    "Supabase-Plattformtoken (Projektverwaltung)",
  ],
  [/\bauth\s*\.\s*admin\b/, "Supabase-Admin-API"],
];

/**
 * Die eng benannten Orte, an denen ein privilegierter Zugangsname stehen darf.
 *
 * Jeder Eintrag ist eine EINZELNE Datei mit Begruendung — kein
 * Verzeichnismuster. Wer eine Zeile hinzufuegt, trifft eine
 * Sicherheitsentscheidung und muss sie hier aufschreiben. Der Test verlangt
 * zusaetzlich, dass jeder Eintrag noch existiert UND noch trifft; eine
 * Ausnahme, die nichts mehr ausnimmt, ist ein toter Freibrief und faellt auf.
 */
export const PRIVILEGIERTE_ORTE: ReadonlyArray<{ datei: string; grund: string }> = [
  {
    datei: "supabase/tests/0002_rls_isolation.sql",
    grund:
      "pgTAP-Zusicherung, dass es in public/storage KEINE Policies fuer die " +
      "RLS-umgehende Rolle gibt — der Name steht hier, um sein Fehlen zu beweisen.",
  },
  {
    datei: "supabase/config.toml",
    grund:
      "Vorlage der Supabase-CLI; die S3-Schluesselfelder sind leer bzw. env-substituiert " +
      "und werden von dieser Anwendung nicht gelesen.",
  },
  {
    datei: "scripts/read-through-harness.sh",
    grund:
      "Ops-/Testharness ausserhalb des Laufzeitpfads: setzt das Passwort der lokalen " +
      "Rolle easytree_app im Wegwerf-Stack. Erreicht keinen Anfragepfad.",
  },
  {
    datei: ".github/workflows/ci.yml",
    grund:
      "CI provisioniert denselben lokalen Wegwerf-Stack. Werte sind CI-lokal und " +
      "synthetisch; kein produktiver Zugang liegt hier.",
  },
  {
    datei: "apps/api/test/auth/token-verifier.test.ts",
    grund:
      "Negativtest: ein Token, dessen audience die privilegierte Rolle nennt, MUSS " +
      "abgelehnt werden (AUDIENCE_MISMATCH). Ohne den Namen gaebe es den Nachweis nicht.",
  },
  {
    datei: "apps/api/test/secret-surface.red-case.test.ts",
    grund:
      "Gegenmutation DIESES Wächters: die Verstossfixtures muessen die verbotenen " +
      "Namen enthalten, sonst pruefte der rote Fall nichts.",
  },
];

const ERLAUBTE_DATEIEN = new Set(PRIVILEGIERTE_ORTE.map((ort) => ort.datei));

/* ----------------------------------------------- Umgebungszugriffe (AST) */

export interface Umgebungszugriff {
  readonly schluessel: string | null;
  readonly line: number;
}

/**
 * Alle `process.env`-Zugriffe einer TypeScript-Datei.
 *
 * `null` als Schluessel heisst: der Zugriff ist nicht statisch aufloesbar
 * (`process.env[variable]`, Destrukturierung, Weiterreichen von
 * `process.env`). Das ist kein Grund zur Nachsicht, sondern der schlimmste
 * Fall — er wird deshalb wie ein unbekannter Schluessel behandelt.
 */
export function umgebungszugriffe(quelle: string, datei: string): Umgebungszugriff[] {
  const sourceFile = ts.createSourceFile(datei, quelle, ts.ScriptTarget.ES2022, true);
  const treffer: Umgebungszugriff[] = [];

  const istProcessEnv = (node: ts.Node): boolean =>
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "env" &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process";

  const zeileVon = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    if (istProcessEnv(node)) {
      const eltern = node.parent as ts.Node | undefined;
      if (
        eltern !== undefined &&
        ts.isPropertyAccessExpression(eltern) &&
        eltern.expression === node
      ) {
        treffer.push({ schluessel: eltern.name.text, line: zeileVon(eltern) });
      } else if (
        eltern !== undefined &&
        ts.isElementAccessExpression(eltern) &&
        eltern.expression === node
      ) {
        const argument = eltern.argumentExpression;
        treffer.push({
          schluessel: ts.isStringLiteral(argument) ? argument.text : null,
          line: zeileVon(eltern),
        });
      } else {
        // `process.env` als Ganzes: weitergereicht, destrukturiert, gespreizt.
        treffer.push({ schluessel: null, line: zeileVon(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return treffer;
}

/**
 * Dateien, die die Umgebung lesen DUERFEN — einzeln benannt, mit Begruendung
 * und mit der Angabe, welche Schluessel dort erwartet werden.
 */
export const ERLAUBTE_UMGEBUNGSLESER: ReadonlyArray<{ datei: string; grund: string }> = [
  {
    datei: "apps/api/src/config/config.module.ts",
    grund:
      "Die EINE Verengung: reicht ausschliesslich die in ENV_VAR_META deklarierten " +
      "Schluessel an loadConfig weiter, das strikt validiert. Genau diese Stelle " +
      "existiert, damit es keine zweite gibt.",
  },
  {
    datei: "apps/web/next.config.ts",
    grund:
      "Buildzeit- und Serverkonfiguration des Same-Origin-Rewrites " +
      "(EASYTREE_API_PROXY_TARGET). Laeuft nie im Browser; der Wert wird von " +
      "lib/api-proxy-target.ts streng geprueft.",
  },
];

const ERLAUBTE_LESER_DATEIEN = new Set(ERLAUBTE_UMGEBUNGSLESER.map((e) => e.datei));

/**
 * Schluessel, die ueberall gelesen werden duerfen: sie tragen keine
 * Berechtigung. `NODE_ENV` beantwortet "in welcher Umgebung laufe ich" —
 * das ist eine Verzweigung, kein Zugang.
 */
const HARMLOSE_SCHLUESSEL = new Set(["NODE_ENV"]);

/* ------------------------------------------------------------------ Regeln */

function istTypeScript(datei: string): boolean {
  return [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].some((e) =>
    datei.endsWith(e),
  );
}

function lies(input: SecretSurfaceInput, datei: string): string {
  return readFileSync(`${input.repoRoot}/${datei}`, "utf8");
}

export const SECRET_RULES: readonly SecretRule[] = [
  {
    id: "runtime-imports-no-supabase-sdk",
    summary:
      "Kein @supabase/*-Paket im Laufzeitpfad — dort entstehen Admin-Clients. " +
      "Supabase Auth wird ueber fetch gegen GoTrue erreicht.",
    evaluate: (input) => {
      const findings: SecretFinding[] = [];
      const seen = new Set<string>();
      for (const ref of input.refs) {
        if (!istLaufzeitpfad(ref.from)) continue;
        seen.add(ref.from);
        if (/^@supabase\//.test(ref.specifier)) {
          findings.push({
            location: `${ref.from}:${ref.line}`,
            rule: "runtime-imports-no-supabase-sdk",
            message:
              `Import von "${ref.specifier}" im Laufzeitpfad. Das SDK ist der uebliche ` +
              "Traeger eines Admin-Clients; die Auth-Grenze laeuft hier ueber fetch " +
              "gegen GoTrue mit dem Anon-Key.",
          });
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "runtime-reads-no-environment",
    summary:
      "Der Laufzeitpfad liest die Umgebung nicht — Konfiguration wird einmal " +
      "validiert und injiziert. Ausnahmen sind einzeln benannt.",
    evaluate: (input) => {
      const findings: SecretFinding[] = [];
      const seen = new Set<string>();
      for (const datei of input.files) {
        if (!istLaufzeitpfad(datei) || !istTypeScript(datei)) continue;
        seen.add(datei);
        if (ERLAUBTE_LESER_DATEIEN.has(datei)) continue;
        for (const zugriff of umgebungszugriffe(lies(input, datei), datei)) {
          if (zugriff.schluessel !== null && HARMLOSE_SCHLUESSEL.has(zugriff.schluessel)) continue;
          const benannt = zugriff.schluessel ?? "<nicht statisch aufloesbar>";
          findings.push({
            location: `${datei}:${zugriff.line}`,
            rule: "runtime-reads-no-environment",
            message:
              `process.env-Zugriff (${benannt}) im Laufzeitpfad. Konfiguration kommt ` +
              "aus AppConfig; ein direkter Zugriff umgeht die strikte Validierung in " +
              "packages/config und damit die Zusage, welche Variablen es gibt.",
          });
        }
      }
      return { findings, seen };
    },
  },
  {
    id: "privileged-credential-only-in-named-places",
    summary:
      "Privilegierte Zugangsnamen (Service-Role, Secret-Key, JWT-Secret, " +
      "Migrationspasswoerter) nur in einzeln benannten Dateien.",
    evaluate: (input) => {
      const findings: SecretFinding[] = [];
      const seen = new Set<string>();
      for (const datei of input.files) {
        if (!istCodeDatei(datei)) continue;
        seen.add(datei);
        if (ERLAUBTE_DATEIEN.has(datei)) continue;
        const zeilen = entferneKommentare(lies(input, datei), datei).split("\n");
        zeilen.forEach((zeile, index) => {
          for (const [muster, wofuer] of PRIVILEGIERTE_FAMILIEN) {
            if (!muster.test(zeile)) continue;
            findings.push({
              location: `${datei}:${index + 1}`,
              rule: "privileged-credential-only-in-named-places",
              message:
                `${wofuer} an einer nicht benannten Stelle. Zulaessige Orte werden ` +
                "einzeln in PRIVILEGIERTE_ORTE eingetragen — mit Begruendung, warum " +
                "die Stelle keinen Anfrage- oder Browserpfad erreicht.",
            });
            return;
          }
        });
      }
      return { findings, seen };
    },
  },
];

export interface SecretSurfaceReport {
  readonly findings: readonly SecretFinding[];
  readonly seen: ReadonlyMap<string, ReadonlySet<string>>;
}

export function evaluateSecretRules(input: SecretSurfaceInput): SecretSurfaceReport {
  const findings: SecretFinding[] = [];
  const seen = new Map<string, ReadonlySet<string>>();
  for (const regel of SECRET_RULES) {
    const ergebnis = regel.evaluate(input);
    findings.push(...ergebnis.findings);
    seen.set(regel.id, ergebnis.seen);
  }
  return { findings, seen };
}

export function render(findings: readonly SecretFinding[]): string[] {
  return findings.map((f) => `${f.location} [${f.rule}] ${f.message}`);
}
