/**
 * Versionierte Environment-Vorlagen tragen nur Platzhalter (EYT-133, F4).
 *
 * ## Anlass
 *
 * Konkrete Werte wurden in einer lokal veraenderten versionierten
 * Environment-Vorlage erkannt und vor Commit entfernt. Nichts gelangte in die
 * Historie. Dieser Test haelt den Zustand fest, statt sich auf Aufmerksamkeit
 * zu verlassen.
 *
 * ## Fail-closed
 *
 * Findet der Test keine einzige Vorlage, ist er rot — nicht gruen. Ein
 * kaputter Glob darf nicht wie ein sauberes Repository aussehen.
 *
 * ## Warum die Fixtures ihre JWTs zur Laufzeit bauen
 *
 * Ein ausgeschriebenes `eyJ…` im Quelltext ist fuer gitleaks ein JWT — die
 * Regel `jwt` feuert darauf zuverlaessig (gemessen). Ein Literal hier machte
 * also `secret-scan` rot und zwaenge zu einem Fingerprint-Eintrag fuer einen
 * Wert, der gar keiner ist. Die Fixtures kodieren deshalb selbst.
 *
 * Laeuft im Pflichtjob `unit-tests`.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { findRepoRoot } from "./architecture/scan";
import {
  ERLAUBTE_PLATZHALTER,
  istGeheimerName,
  istPlatzhalter,
  klassifiziereWert,
  pruefeEnvTemplate,
  renderTemplateBefunde,
} from "./architecture/env-template-rules";

const repoRoot = findRepoRoot(process.cwd());

/**
 * Versionierte Vorlagen kommen aus `git ls-files` — die einzige Autoritaet
 * dafuer, was Git kennt. Eine ignorierte `.env` taucht hier per Konstruktion
 * nicht auf; sie wird nirgends gelesen.
 */
function versionierteVorlagen(): string[] {
  const ausgabe = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return ausgabe
    .split("\0")
    .filter((p) => p !== "")
    .filter((p) => /(^|\/)\.env($|\.)/.test(p));
}

/** Baut einen syntaktisch echten, inhaltlich erfundenen JWT. */
function bauJwt(rolle: string): string {
  const teil = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${teil({ alg: "HS256", typ: "JWT" })}.${teil({ role: rolle, iat: 1, exp: 2 })}.erfundene-signatur`;
}

const GEHEIM_PRAEFIX = ["sb", "secret", ""].join("_");
const OEFFENTLICH_PRAEFIX = ["sb", "publishable", ""].join("_");

describe("Versionierte Environment-Vorlagen — der echte Baum (EYT-133 F4)", () => {
  const vorlagen = versionierteVorlagen();

  it("findet ueberhaupt eine versionierte Vorlage", () => {
    // Fail-closed: kein Fund heisst kaputter Glob, nicht sauberes Repository.
    expect(vorlagen.length).toBeGreaterThan(0);
    expect(vorlagen).toContain(".env.example");
  });

  it("liest die ignorierte .env NICHT ein", () => {
    // Die echte lokale .env darf diesen Wächter nie beruehren. `git ls-files`
    // kennt sie nicht — das ist die strukturelle Zusage, kein Filter, den
    // jemand versehentlich lockert.
    expect(vorlagen).not.toContain(".env");
    expect(vorlagen.every((p) => p !== ".env")).toBe(true);
  });

  it.each(vorlagen)("%s enthaelt ausschliesslich Platzhalter", (pfad) => {
    const inhalt = readFileSync(`${repoRoot}/${pfad}`, "utf8");
    const befunde = pruefeEnvTemplate(pfad, inhalt);
    expect(renderTemplateBefunde(befunde)).toEqual([]);
  });

  it("meldet, was geprueft wurde", () => {
    const zeilen = vorlagen.reduce(
      (summe, p) => summe + readFileSync(`${repoRoot}/${p}`, "utf8").split("\n").length,
      0,
    );
    console.log(
      `[env-template] vorlagen=${vorlagen.length} zeilen=${zeilen} ` +
        `platzhalterformen=${ERLAUBTE_PLATZHALTER.length} findings=0`,
    );
    expect(zeilen).toBeGreaterThan(10);
  });
});

describe("Rote Faelle — jede verbotene Form wird erkannt (EYT-133 F4)", () => {
  const pruefe = (zeile: string) => pruefeEnvTemplate(".env.example", zeile);

  it("1. service_role-JWT in der Vorlage", () => {
    const b = pruefe(`SUPABASE_SERVICE_KEY=${bauJwt("service_role")}`);
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain("role=service_role");
  });

  it("2. Supabase-Geheimschluessel in der Vorlage", () => {
    const b = pruefe(`SUPABASE_SECRET_KEY=${GEHEIM_PRAEFIX}AbCdEfGhIjKlMnOpQrStUvWxYz01`);
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain("Geheimschluessel");
  });

  it("3. konkreter Publishable-Key in der Vorlage", () => {
    const b = pruefe(`SUPABASE_PUBLISHABLE_API_KEY=${OEFFENTLICH_PRAEFIX}AbCdEfGhIjKlMnOp`);
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain("Publishable");
  });

  it("4. konkretes Datenbankpasswort", () => {
    expect(pruefe("POSTGRES_PASSWORD=Sommer2026Baum")).toHaveLength(1);
    expect(pruefe("DATABASE_PASSWORD=Sommer2026Baum")).toHaveLength(1);
    expect(pruefe("SUPABASE_PASSWORD=Sommer2026Baum")).toHaveLength(1);
    // Auch ohne Unterstrich — genau die Schreibweise aus dem Vorfallbericht.
    expect(pruefe("DATABASEPASSWORD=Sommer2026Baum")).toHaveLength(1);
  });

  it("5. DATABASE_URL mit konkretem Passwort", () => {
    const b = pruefe(
      "DATABASE_URL=postgresql://nutzer:Sommer2026Baum@db.beispiel.co:5432/postgres",
    );
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain("konkretem Passwort");
  });

  it("6. Platzhalterfassungen bleiben gruen", () => {
    // Genau die Zeilen der committeten Vorlage.
    expect(pruefe("NODE_ENV=development")).toEqual([]);
    expect(
      pruefe(
        "DATABASE_URL=postgresql://easytree_app:replace-with-your-local-password@localhost:54322/postgres",
      ),
    ).toEqual([]);
    expect(pruefe("SUPABASE_URL=http://localhost:54321")).toEqual([]);
    expect(pruefe("SUPABASE_ANON_KEY=replace-with-your-supabase-anon-key")).toEqual([]);
    expect(pruefe("API_PORT=3001")).toEqual([]);
    expect(pruefe("LOG_LEVEL=info")).toEqual([]);
    expect(pruefe("SUPABASE_SECRET_KEY=")).toEqual([]);
    expect(pruefe("SUPABASE_SERVICE_KEY=<dein-service-key>")).toEqual([]);
  });

  it("7. auch ein auskommentierter Geheimwert ist ein Befund", () => {
    // Ein `#` macht die Zeile unauffaellig, nicht ungefaehrlich.
    expect(pruefe(`# SUPABASE_SERVICE_KEY=${bauJwt("service_role")}`)).toHaveLength(1);
  });

  it("8. anon-JWT ist in der Vorlage ebenfalls ein Befund", () => {
    // Nicht privilegiert, aber ein REALER Wert statt eines Platzhalters.
    const b = pruefe(`SUPABASE_ANON_KEY=${bauJwt("anon")}`);
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain("role=anon");
  });

  it("9. die Klassifikation selbst stimmt", () => {
    expect(klassifiziereWert(bauJwt("service_role")).jwtRolle).toBe("service_role");
    expect(klassifiziereWert(bauJwt("anon")).jwtRolle).toBe("anon");
    expect(klassifiziereWert(`${GEHEIM_PRAEFIX}xyz`).istGeheimPraefix).toBe(true);
    expect(klassifiziereWert(`${OEFFENTLICH_PRAEFIX}xyz`).istOeffentlichPraefix).toBe(true);
    expect(klassifiziereWert("postgresql://u:geheim@h/db").dbPasswort).toBe("geheim");
    expect(klassifiziereWert("http://localhost:54321").dbPasswort).toBeNull();
    expect(istPlatzhalter("replace-with-your-key")).toBe(true);
    expect(istPlatzhalter("Sommer2026Baum")).toBe(false);
    expect(istGeheimerName("SUPABASE_SERVICE_KEY")).toBe(true);
    expect(istGeheimerName("API_PORT")).toBe(false);
  });
});

describe("F1 — Dummywerte gelten nur fuer ihren eigenen Namen (EYT-133)", () => {
  // Gemessen auf master 36384d0: ALLE sechs Faelle rutschten durch. Ursache
  // war ein globaler Fallback, der den Variablennamen gar nicht kannte —
  // `production` ist als NODE_ENV-Wert freigegeben und deckte damit jeden
  // Namen im Repository, auch einen Service-Schluessel.
  const pruefe = (zeile: string) => pruefeEnvTemplate(".env.example", zeile);

  it.each([
    ["SUPABASE_SECRET_KEY", "production"],
    ["SUPABASE_SERVICE_KEY", "http://localhost:54321"],
    ["POSTGRES_PASSWORD", "3001"],
    ["SUPABASE_ANON_KEY", "info"],
    ["SUPABASE_PUBLISHABLE_API_KEY", "test"],
    ["DATABASEPASSWORD", "development"],
  ])("%s darf den Dummywert eines anderen Namens nicht erben: %s", (name, wert) => {
    expect(pruefe(`${name}=${wert}`)).toHaveLength(1);
  });

  it.each([
    "NODE_ENV=development",
    "NODE_ENV=test",
    "NODE_ENV=production",
    "LOG_LEVEL=info",
    "LOG_LEVEL=trace",
    "API_PORT=3001",
    "SUPABASE_URL=http://localhost:54321",
    "SUPABASE_URL=http://127.0.0.1:54321",
    "DATABASE_URL=postgresql://easytree_app:replace-with-your-local-password@localhost:54322/postgres",
  ])("%s bleibt zulaessig", (zeile) => {
    // Gegenprobe gegen eine zu scharfe Regel: waeren diese rot, waere die
    // Vorlage als Anleitung wertlos und der Waechter wuerde abgeschaltet.
    expect(pruefe(zeile)).toEqual([]);
  });

  it.each([
    ["API_PORT", "0"],
    ["API_PORT", "65536"],
    ["API_PORT", "dreitausend"],
    ["SUPABASE_URL", "https://xyzproject.supabase.co"],
    ["SUPABASE_URL", "http://benutzer:geheim@localhost:54321"],
    ["NODE_ENV", "staging"],
    ["LOG_LEVEL", "verbose"],
    ["DATABASE_URL", "postgresql://easytree_app:Sommer2026@localhost:54322/postgres"],
  ])("%s=%s ist kein zulaessiger Konkretwert", (name, wert) => {
    expect(pruefe(`${name}=${wert}`)).toHaveLength(1);
  });
});

describe("Finding A — ein Konkretwert ohne Freigabe ist ein Befund (EYT-133)", () => {
  // Gemessen auf Head 5f67e9b: traf ein Variablenname KEINE Freigabe, fiel der
  // konkrete Wert durch und wurde still akzeptiert. Geprueft wurde nur, wer
  // ohnehin schon in ERLAUBTE_KONKRETWERTE stand — die Unbekannten, um die es
  // geht, waren damit gerade nicht abgedeckt.
  const pruefe = (zeile: string) => pruefeEnvTemplate(".env.example", zeile);

  it.each([
    ["PRIVATE_KEY", "konkreter-wert"],
    ["AWS_ACCESS_KEY_ID", "konkreter-wert"],
    ["UNBEKANNTE_CREDENTIAL", "konkreter-wert"],
    ["FOO", "bar"],
  ])("%s=%s besitzt keine variablenspezifische Freigabe", (name, wert) => {
    const b = pruefe(`${name}=${wert}`);
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain("keine variablenspezifische Freigabe");
  });

  it.each([
    "NODE_ENV=development",
    "LOG_LEVEL=info",
    "API_PORT=3001",
    "SUPABASE_URL=http://localhost:54321",
    "DATABASE_URL=postgresql://easytree_app:replace-with-your-local-password@localhost:54322/postgres",
    "SUPABASE_ANON_KEY=replace-with-your-supabase-anon-key",
  ])("%s bleibt gruen", (zeile) => {
    // Die Gegenprobe zur Verschaerfung: waere eine dieser Zeilen rot, waere die
    // Vorlage als Anleitung unbrauchbar und der Waechter wuerde abgeschaltet.
    expect(pruefe(zeile)).toEqual([]);
  });
});

describe("Finding B — die Assignment-Grammatik laesst sich nicht umgehen (EYT-133)", () => {
  // Gemessen auf Head 5f67e9b: der Parser erkannte ausschliesslich
  // `UPPERCASE=wert`. Eine andere Schreibweise oder ein vorangestelltes
  // `export` liess die Zeile wortlos verschwinden — kein Befund, keine Spur.
  const pruefe = (zeile: string) => pruefeEnvTemplate(".env.example", zeile);

  it.each([
    "supabase_secret_key=konkreter-wert",
    "export SUPABASE_SECRET_KEY=konkreter-wert",
    "export PRIVATE_KEY=konkreter-wert",
    "1INVALID=value",
    "SUPABASE_SECRET_KEY value",
  ])("%s wird nicht still uebersprungen", (zeile) => {
    expect(pruefe(zeile).length).toBeGreaterThan(0);
  });

  it.each([
    "export NODE_ENV=development",
    "NODE_ENV=development",
    "# SUPABASE_SECRET_KEY=replace-with-key",
    "# Lokale Entwicklung",
    '#   psql "…user=postgres…" -c "alter role easytree_app password \'<local>\';"',
    "",
    "   ",
  ])("%s bleibt gruen", (zeile) => {
    expect(pruefe(zeile)).toEqual([]);
  });

  it.each([
    ["export SUPABASE_SECRET_KEY=konkreter-wert", "geheimer Variablenname"],
    ["export PRIVATE_KEY=konkreter-wert", "keine variablenspezifische Freigabe"],
  ])("%s wird wirklich geparst, nicht nur als unparsbar abgetan", (zeile, grund) => {
    // Ohne diese Zusicherung bewiesen die export-Faelle nichts: faellt die
    // export-Erkennung weg, landen sie im Parsing-Befund und "length > 0"
    // bleibt gruen. Gemessen — die Gegenmutation erzeugte so nur EINEN roten
    // Test. Der Befund muss aus der INHALTLICHEN Regel kommen.
    const b = pruefe(zeile);
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain(grund);
  });

  it.each([
    ["node_env", "development"],
    ["Api_Port", "3001"],
  ])("%s=%s wird als nichtkanonische Schreibweise gemeldet", (name, wert) => {
    // Diskriminierend, und das ist der Punkt: `supabase_secret_key` allein
    // beweist die Schreibweisenregel NICHT — den faengt schon die Regel fuer
    // geheime Namen. Diese beiden Namen sind weder geheim noch
    // DATABASE_URL; ohne die Kanonik-Pruefung waeren sie zwar auch ein
    // Befund, aber mit der falschen Begruendung. Gemessen: die Gegenmutation
    // "Kanonik entfernen" blieb ohne diese Zusicherung gruen.
    const b = pruefe(`${name}=${wert}`);
    expect(b).toHaveLength(1);
    expect(b[0]?.grund).toContain("nicht kanonisch");
  });

  it("ein konkreter Secret-Wert bleibt auch auskommentiert ein Befund", () => {
    expect(pruefe("# SUPABASE_SECRET_KEY=konkreter-wert")).toHaveLength(1);
  });

  it("die Regex-Blindheit von entferneKommentare unterdrueckt keine Fundstelle", () => {
    // Kein Reparaturschnitt — nur der Beleg fuer die Richtung. Unentfernter
    // Kommentartext erzeugt ZUSAETZLICHE Treffer, nie fehlende: derselbe
    // Verstoss wird auch dann gemeldet, wenn davor ein Regex-Literal mit
    // Anfuehrungszeichen steht. Fail-loud, kein Secret-Bypass.
    const mitRegexDavor = [
      "const r = /^[\"']|[\"']$/g;",
      "SUPABASE_SECRET_KEY=konkreter-wert",
    ].join("\n");
    expect(pruefeEnvTemplate(".env.example", mitRegexDavor).length).toBeGreaterThan(0);
  });
});
