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
  /**
   * Angeschlagene Familie — nur die Familienregel setzt sie.
   *
   * Die Lebendpruefung braucht sie: sie entfernt EIN Paar (Datei, Familie)
   * und muss belegen, dass genau diese Familie daraufhin anschlaegt. Ueber
   * den Meldungstext ginge das nicht, der nennt nur den Klartextnamen.
   */
  readonly familie?: PrivilegierteFamilienId;
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
  /**
   * Ersetzt `PRIVILEGIERTE_ORTE` fuer genau einen Lauf.
   *
   * Existiert ausschliesslich fuer die Lebendpruefung: sie nimmt EIN Paar
   * (Datei, Familie) heraus und misst, ob dieses Paar heute wirklich etwas
   * abdeckt. Ohne den Haken liesse sich nur die Datei als Ganzes pruefen —
   * und genau diese Grobheit war F2.
   */
  readonly orte?: readonly PrivilegierterOrt[];
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
/**
 * Pakete, die AUSDRUECKLICH nicht laufzeitfaehig sind.
 *
 * Einzeln benannt, nie ein Muster — `packages/**` als Ausnahme waere genau die
 * Luecke, die das Review vom 02.08.2026 gefunden hat. Heute ist die Liste
 * LEER: alle vier Pakete sind produktive Abhaengigkeit von `apps/api` oder
 * `apps/web` (gemessen — contracts 18 Importe, domain 23, ui 10, config 10).
 *
 * Wer hier etwas einträgt, behauptet: dieses Paket wird von keinem Anfrage-
 * und keinem Browserpfad ausgefuehrt. Der Test verlangt dafuer eine
 * Begruendung und prueft, dass der Eintrag kein Muster ist.
 */
export const NICHT_LAUFZEITFAEHIGE_PAKETE: ReadonlyArray<{ paket: string; grund: string }> = [];

/** Innerhalb eines Pakets ist nur `src/` Laufzeit — nicht Test, Build, Werkzeug. */
const PAKET_LAUFZEIT_UNTERVERZEICHNIS = "/src/";

/**
 * Ist diese Datei Teil dessen, was eine echte Anfrage oder ein Browser
 * ausfuehrt?
 *
 * Bewusst grosszuegig: `apps/api/src/**` VOLLSTAENDIG (inklusive `platform/`,
 * wo `api-dependency-allowlist` aufhoert), produktiver Webcode, und
 * `packages/*<!---->/src/**` als DEFAULT.
 *
 * Der Default fuer Pakete ist der Kern des Reviewbefunds: `packages/contracts`
 * und `packages/ui` laufen im Browser UND im Nest-Anfragepfad. Wer morgen ein
 * Paket anlegt, muss diesen Waechter nicht kennen, um von ihm erfasst zu
 * werden — Schutz ist der Normalfall, Ausschluss die begruendete Ausnahme.
 */
export function istLaufzeitpfad(
  datei: string,
  ausgeschlossenePakete: readonly string[] = NICHT_LAUFZEITFAEHIGE_PAKETE.map((e) => e.paket),
): boolean {
  if (datei.startsWith("apps/api/src/")) return true;

  if (datei.startsWith("packages/")) {
    const teile = datei.split("/");
    const paket = teile[1];
    if (paket === undefined || paket === "") return false;
    if (ausgeschlossenePakete.includes(paket)) return false;
    // Nur `src/`: `test/`, `dist/`, `openapi/` und Werkzeugkonfiguration am
    // Paketwurzelverzeichnis laufen in keiner Anfrage.
    return datei.startsWith(`packages/${paket}${PAKET_LAUFZEIT_UNTERVERZEICHNIS}`);
  }

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
 *
 * `erlaubtIn` ist eine familienspezifische Ausnahme fuer die Faelle, in denen
 * ein Name an genau einer Stelle legitim ist. Das ist enger als
 * `PRIVILEGIERTE_ORTE`, das eine Datei von ALLEN Familien freistellt —
 * `DATABASE_URL` darf in der Konfigurationsgrenze stehen, ein
 * Service-Role-Schluessel dort trotzdem nicht.
 *
 * Die Namen stammen nicht aus der Fantasie: `SERVICE_KEY`, die
 * PASSWORD-Familie und der `sb`-Geheimpraefix sind genau die, die am
 * 02.08.2026 in einer lokal veraenderten Environment-Vorlage auftauchten und
 * durch die damalige Liste fielen.
 */
/**
 * Stabile Familien-Ids. Eine Ausnahme benennt kuenftig GENAU die Familien,
 * die sie braucht — nie mehr eine ganze Datei.
 */
export const PRIVILEGIERTE_FAMILIEN_IDS = [
  "service-role-name",
  "service-key-name",
  "secret-key-name",
  "jwt-secret-name",
  "postgres-service-role",
  "database-password-name",
  "supabase-access-token-name",
  "supabase-admin-api",
  "hardcoded-jwt",
  "supabase-secret-prefix",
  "database-url-name",
] as const;
export type PrivilegierteFamilienId = (typeof PRIVILEGIERTE_FAMILIEN_IDS)[number];

interface PrivilegierteFamilie {
  readonly id: PrivilegierteFamilienId;
  readonly muster: RegExp;
  readonly wofuer: string;
  /** Dateien, in denen GENAU DIESE Familie zulaessig ist. */
  readonly erlaubtIn?: readonly string[];
  /**
   * Nur im Laufzeitpfad pruefen.
   *
   * Fuer Namen, die ausserhalb voellig legitim sind: eine Testdatei DARF
   * `DATABASE_URL` setzen, ein Controller nicht. Ohne diese Einschraenkung
   * meldete die Familie 8 Testdateien und waere binnen einer Woche
   * abgeschaltet.
   */
  readonly nurLaufzeitpfad?: boolean;
}

/** Die eine Stelle, an der Konfigurationsnamen aufgeschrieben werden duerfen. */
const KONFIGURATIONSGRENZE = [
  "packages/config/src/schema.ts",
  "packages/config/src/load.ts",
] as const;

const PRIVILEGIERTE_FAMILIEN: readonly PrivilegierteFamilie[] = [
  {
    muster: new RegExp(["SERVICE", "ROLE"].join("_"), "i"),
    id: "service-role-name",
    wofuer: "Service-Role-Zugang (umgeht RLS vollstaendig)",
  },
  {
    // Faengt auch SUPABASE_SERVICE_KEY — die Schreibweise ohne "ROLE".
    muster: new RegExp(["SERVICE", "KEY"].join("_"), "i"),
    id: "service-key-name",
    wofuer: "Service-Schluessel (umgeht RLS vollstaendig)",
  },
  {
    muster: new RegExp(["SECRET", "KEY"].join("_"), "i"),
    id: "secret-key-name",
    wofuer: "Supabase-Secret-Key (privilegierter API-Zugang)",
  },
  {
    muster: new RegExp(["JWT", "SECRET"].join("_"), "i"),
    id: "jwt-secret-name",
    wofuer: "JWT-Signaturgeheimnis (erlaubt Tokenfaelschung)",
  },
  {
    muster: new RegExp(["service", "role"].join("_")),
    id: "postgres-service-role",
    wofuer: "PostgreSQL-Rolle mit RLS-Umgehung",
  },
  {
    // GROSSGESCHRIEBEN und nur als ganzes Wort: faengt PGPASSWORD,
    // POSTGRES_PASSWORD, DATABASE_PASSWORD, SUPABASE_PASSWORD und die
    // Schreibweise ohne Unterstrich. Kleingeschriebenes `password` bleibt
    // ausdruecklich unberuehrt — es steht voellig legitim im Loginformular,
    // im Auth-Controller und im Anmeldevertrag (gemessen: neun Dateien).
    muster: new RegExp(`\\b[A-Z0-9]*_?${["PASS", "WORD"].join("")}\\b`),
    id: "database-password-name",
    wofuer: "Passwort einer Datenbank- oder Plattformrolle",
  },
  {
    muster: new RegExp(["SUPABASE", "ACCESS", "TOKEN"].join("_"), "i"),
    id: "supabase-access-token-name",
    wofuer: "Supabase-Plattformtoken (Projektverwaltung)",
  },
  { muster: /\bauth\s*\.\s*admin\b/, id: "supabase-admin-api", wofuer: "Supabase-Admin-API" },
  {
    // Ein festverdrahteter JWT hat im Laufzeitpfad nichts zu suchen, egal
    // welche Rolle er traegt.
    muster: new RegExp(["ey", "J[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\."].join("")),
    id: "hardcoded-jwt",
    wofuer: "festverdrahteter JWT",
  },
  {
    muster: new RegExp(["sb", "secret", ""].join("_")),
    id: "supabase-secret-prefix",
    wofuer: "Supabase-Geheimschluessel im neuen Schluesselformat",
  },
  {
    muster: new RegExp(["DATABASE", "URL"].join("_")),
    id: "database-url-name",
    wofuer: "Verbindungszeichenkette ausserhalb der Konfigurationsgrenze",
    erlaubtIn: KONFIGURATIONSGRENZE,
    nurLaufzeitpfad: true,
  },
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
export interface PrivilegierterOrt {
  readonly datei: string;
  /** NUR diese Familien sind hier zulaessig. Nie die ganze Datei. */
  readonly erlaubteFamilien: readonly PrivilegierteFamilienId[];
  readonly grund: string;
}

export const PRIVILEGIERTE_ORTE: readonly PrivilegierterOrt[] = [
  {
    datei: "supabase/tests/0002_rls_isolation.sql",
    erlaubteFamilien: ["service-role-name", "postgres-service-role"],
    grund:
      "pgTAP-Zusicherung, dass es in public/storage KEINE Policies fuer die " +
      "RLS-umgehende Rolle gibt — der Name steht hier, um sein Fehlen zu beweisen.",
  },
  {
    datei: "supabase/config.toml",
    erlaubteFamilien: ["secret-key-name"],
    grund:
      "Vorlage der Supabase-CLI; die S3-Schluesselfelder sind leer bzw. env-substituiert " +
      "und werden von dieser Anwendung nicht gelesen.",
  },
  {
    datei: "scripts/read-through-harness.sh",
    erlaubteFamilien: ["database-password-name"],
    grund:
      "Ops-/Testharness ausserhalb des Laufzeitpfads: setzt das Passwort der lokalen " +
      "Rolle easytree_app im Wegwerf-Stack. Erreicht keinen Anfragepfad.",
  },
  {
    datei: ".github/workflows/ci.yml",
    erlaubteFamilien: ["database-password-name"],
    grund:
      "CI provisioniert denselben lokalen Wegwerf-Stack. Werte sind CI-lokal und " +
      "synthetisch; kein produktiver Zugang liegt hier.",
  },
  {
    datei: "apps/api/test/auth/token-verifier.test.ts",
    erlaubteFamilien: ["service-role-name", "postgres-service-role"],
    grund:
      "Negativtest: ein Token, dessen audience die privilegierte Rolle nennt, MUSS " +
      "abgelehnt werden (AUDIENCE_MISMATCH). Ohne den Namen gaebe es den Nachweis nicht.",
  },
  {
    datei: "apps/api/test/secret-surface.red-case.test.ts",
    erlaubteFamilien: [
      "service-role-name",
      "service-key-name",
      "secret-key-name",
      "jwt-secret-name",
      "database-password-name",
      "supabase-admin-api",
      "postgres-service-role",
    ],
    grund:
      "Gegenmutation DIESES Wächters: die Verstossfixtures muessen die verbotenen " +
      "Namen enthalten, sonst pruefte der rote Fall nichts.",
  },
  {
    datei: "apps/api/test/env-template.test.ts",
    erlaubteFamilien: [
      "service-role-name",
      "service-key-name",
      "secret-key-name",
      "database-password-name",
      "postgres-service-role",
    ],
    grund:
      "Rote Faelle des Vorlagenwächters: die Fixtures muessen die verbotenen " +
      "Namen ausschreiben, sonst pruefte kein einziger Fall etwas. Die Werte " +
      "darin sind erfunden und werden zur Laufzeit erzeugt.",
  },
];

/**
 * Strukturpruefung der Ausnahmeliste — gibt die Maengel zurueck, statt zu werfen.
 *
 * Als Funktion und nicht als Testkoerper, damit die roten Faelle sie mit
 * synthetischen Listen fuettern koennen: eine Ausnahme auf eine nicht
 * existierende Datei, eine ohne Begruendung, eine mit leerer Familienliste.
 * Im Testkoerper eingebettet liesse sich keiner dieser Faelle ausloesen, ohne
 * die echte Liste kaputtzumachen.
 *
 * `existiert` wird hereingereicht, damit die Funktion selbst kein Dateisystem
 * braucht — `apps/api/test/architecture/` bleibt so frei von I/O.
 */
export function pruefeAusnahmeliste(
  orte: readonly PrivilegierterOrt[],
  existiert: (datei: string) => boolean,
): string[] {
  const maengel: string[] = [];
  const gesehen = new Set<string>();
  for (const { datei, erlaubteFamilien, grund } of orte) {
    if (!existiert(datei)) maengel.push(`${datei}: Ausnahme zeigt ins Leere`);
    if (gesehen.has(datei)) maengel.push(`${datei}: steht doppelt in der Liste`);
    gesehen.add(datei);
    // Leere Familienliste = dateiweite Freistellung durch die Hintertuer.
    if (erlaubteFamilien.length === 0) maengel.push(`${datei}: stellt keine Familie frei`);
    if (new Set(erlaubteFamilien).size !== erlaubteFamilien.length) {
      maengel.push(`${datei}: nennt eine Familie doppelt`);
    }
    for (const familie of erlaubteFamilien) {
      if (!PRIVILEGIERTE_FAMILIEN_IDS.includes(familie)) {
        maengel.push(`${datei}: unbekannte Familie ${familie}`);
      }
    }
    if (grund.trim().length <= 40) maengel.push(`${datei}: nicht belastbar begruendet`);
  }
  return maengel;
}

/**
 * Ist GENAU DIESE Familie in GENAU DIESER Datei freigestellt?
 *
 * Der Vorgaenger war ein Set von Dateipfaden und stellte die Datei vor ALLEN
 * Familien frei. Gemessen auf master 36384d0: ein Service-Role-Schluessel in
 * der CI-Datei — dort nur wegen eines lokalen Wegwerf-Passworts ausgenommen —
 * ergab 0 Findings. Das war F2.
 */
function istFamilieHierErlaubt(
  orte: readonly PrivilegierterOrt[],
  datei: string,
  familie: PrivilegierteFamilienId,
): boolean {
  return orte.some((ort) => ort.datei === datei && ort.erlaubteFamilien.includes(familie));
}

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
const PROZESS_MODULE = new Set(["node:process", "process"]);

export function umgebungszugriffe(quelle: string, datei: string): Umgebungszugriff[] {
  const sourceFile = ts.createSourceFile(datei, quelle, ts.ScriptTarget.ES2022, true);
  const treffer: Umgebungszugriff[] = [];

  /**
   * Namen, die auf `process` bzw. auf `process.env` zeigen.
   *
   * Ohne diese Aufloesung erkannte der Waechter genau EINE Schreibweise. Der
   * Review vom 02.08.2026 hat vier weitere gemessen, die durchfielen — darunter
   * `import proc from "node:process"`, also ausgerechnet die Form, zu der
   * ESLint aktiv draengt (`unicorn/prefer-node-protocol`).
   */
  const processAliase = new Set<string>(["process"]);
  const envAliase = new Set<string>();

  const stringWert = (node: ts.Node): string | null =>
    ts.isStringLiteralLike(node) ? node.text : null;

  /** `process`, ein Alias davon, `globalThis.process`, `globalThis["process"]`. */
  const istProcessAusdruck = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return processAliase.has(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      return node.name.text === "process" && ts.isIdentifier(node.expression);
    }
    if (ts.isElementAccessExpression(node)) {
      return stringWert(node.argumentExpression) === "process" && ts.isIdentifier(node.expression);
    }
    return false;
  };

  /** `<process>.env`, `<process>["env"]` oder ein Alias auf genau das. */
  const istEnvAusdruck = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return envAliase.has(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      return node.name.text === "env" && istProcessAusdruck(node.expression);
    }
    if (ts.isElementAccessExpression(node)) {
      return stringWert(node.argumentExpression) === "env" && istProcessAusdruck(node.expression);
    }
    return false;
  };

  // --- Durchgang 1: Aliase sammeln -----------------------------------------
  // Mehrfach, bis nichts Neues mehr dazukommt: `const p = process;` und
  // `const e = p.env;` sind eine Kette, und die zweite Zeile laesst sich erst
  // aufloesen, wenn die erste bekannt ist.
  const sammleAliase = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const modul = stringWert(node.moduleSpecifier);
      const klausel = node.importClause;
      if (modul !== null && PROZESS_MODULE.has(modul) && klausel !== undefined) {
        // `import proc from "node:process"` und `import * as proc from …`
        if (klausel.name !== undefined) processAliase.add(klausel.name.text);
        const bindungen = klausel.namedBindings;
        if (bindungen !== undefined) {
          if (ts.isNamespaceImport(bindungen)) processAliase.add(bindungen.name.text);
          else {
            // `import { env } from "node:process"`
            for (const element of bindungen.elements) {
              const quellname = element.propertyName?.text ?? element.name.text;
              if (quellname === "env") envAliase.add(element.name.text);
            }
          }
        }
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const wert = node.initializer;
      // `const p = require("node:process")`
      const ausRequire =
        ts.isCallExpression(wert) &&
        ts.isIdentifier(wert.expression) &&
        wert.expression.text === "require" &&
        wert.arguments.length === 1 &&
        PROZESS_MODULE.has(stringWert(wert.arguments[0] as ts.Node) ?? "");

      if (ts.isIdentifier(node.name)) {
        if (istProcessAusdruck(wert) || ausRequire) processAliase.add(node.name.text);
        else if (istEnvAusdruck(wert)) envAliase.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name)) {
        // `const { env } = process` — der gebundene Name zeigt auf env.
        if (istProcessAusdruck(wert) || ausRequire) {
          for (const element of node.name.elements) {
            const quellname =
              element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : ts.isIdentifier(element.name)
                  ? element.name.text
                  : null;
            if (quellname === "env" && ts.isIdentifier(element.name)) {
              envAliase.add(element.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, sammleAliase);
  };

  for (let runde = 0; runde < 5; runde += 1) {
    const vorher = processAliase.size + envAliase.size;
    sammleAliase(sourceFile);
    if (processAliase.size + envAliase.size === vorher) break;
  }

  // --- Durchgang 2: Zugriffe finden ----------------------------------------
  const zeileVon = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    if (istEnvAusdruck(node)) {
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
        treffer.push({
          schluessel: stringWert(eltern.argumentExpression),
          line: zeileVon(eltern),
        });
      } else if (
        eltern !== undefined &&
        ts.isVariableDeclaration(eltern) &&
        eltern.initializer === node
      ) {
        // `const e = process.env;` ist die ALIASDEFINITION, kein Lesezugriff.
        // Der eigentliche Zugriff wird ueber den Alias gefunden.
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
      const orte = input.orte ?? PRIVILEGIERTE_ORTE;
      for (const datei of input.files) {
        if (!istCodeDatei(datei)) continue;
        seen.add(datei);
        const zeilen = entferneKommentare(lies(input, datei), datei).split("\n");
        zeilen.forEach((zeile, index) => {
          for (const { id, muster, wofuer, erlaubtIn, nurLaufzeitpfad } of PRIVILEGIERTE_FAMILIEN) {
            if (erlaubtIn?.includes(datei) === true) continue;
            if (istFamilieHierErlaubt(orte, datei, id)) continue;
            if (nurLaufzeitpfad === true && !istLaufzeitpfad(datei)) continue;
            if (!muster.test(zeile)) continue;
            findings.push({
              location: `${datei}:${index + 1}`,
              rule: "privileged-credential-only-in-named-places",
              familie: id,
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
