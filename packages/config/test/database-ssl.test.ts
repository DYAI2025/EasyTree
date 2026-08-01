/**
 * TLS-Wurzelzertifikat der Datenbankverbindung (EYT-106, fix(deploy)).
 *
 * ## Der gemessene Anlass
 *
 * Gegen Supabase scheiterte der API-Start mit
 * `self-signed certificate in certificate chain`. Ursache: `pg` 8.22 behandelt
 * `sslmode=require` wie `verify-full`, und Node kennt Supabases CA nicht. Die
 * Antwort ist das projektbezogene Wurzelzertifikat — nicht das Abschalten der
 * Pruefung.
 *
 * ## Warum die Normalisierung an der Konfigurationsgrenze sitzt
 *
 * Ein PEM reist durch eine Umgebungsvariable und kommt je nach Weg anders an:
 * mehrzeilig, mit literalen `\n`, oder base64. Alle drei muessen zu DEMSELBEN
 * PEM fuehren. Laege diese Entscheidung in den Datenbankmodulen, gaebe es drei
 * Orte, an denen sie unterschiedlich ausfallen kann.
 */
import { describe, expect, it } from "vitest";

import { normalizeCertificatePem } from "../src/certificate.js";
import { loadConfig } from "../src/load.js";
import { ConfigValidationError } from "../src/load.js";
import { redact } from "../src/redact.js";
import { ENV_VAR_META } from "../src/schema.js";

/**
 * Ein syntaktisch gueltiges, fachlich bedeutungsloses Zertifikat.
 *
 * Bewusst KEIN echtes Supabase-Zertifikat: diese Datei ist eingecheckt, und ein
 * echtes Zertifikat im Repository laedt dazu ein, es fuer den Produktionswert zu
 * halten. Geprueft wird hier ausschliesslich die Syntaxgrenze.
 */
const PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBkTCB+wIJAKr4bJ1oXQ3fMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl",
  "c3RjYTAeFw0yNjA3MzEwMDAwMDBaFw0zNjA3MjgwMDAwMDBaMBExDzANBgNVBAMM",
  "BnRlc3RjYTBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQDZ4Xk8mQ0Vb1sYbGz9pQqR",
  "-----END CERTIFICATE-----",
].join("\n");

const produktion = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://easytree_app:geheim@db.beispiel.supabase.co:5432/postgres",
  SUPABASE_URL: "https://beispiel.supabase.co",
  SUPABASE_ANON_KEY: "anon-platzhalter",
  API_PORT: "3001",
  DATABASE_SSL_ROOT_CERT: PEM,
};

function ohne(env: Record<string, string>, schluessel: string): Record<string, string> {
  const kopie: Record<string, string> = { ...env };
  delete kopie[schluessel];
  return kopie;
}

describe("DATABASE_SSL_ROOT_CERT — Normalisierung", () => {
  it("nimmt ein mehrzeiliges PEM unveraendert an", () => {
    expect(normalizeCertificatePem(PEM)).toBe(PEM);
  });

  it("nimmt ein PEM mit literalen \\n an und stellt echte Zeilenumbrueche her", () => {
    // Der Weg ueber Shell und CI-Secrets: die Zeilenumbrueche kommen als
    // Zeichenpaar an, nicht als Steuerzeichen.
    expect(normalizeCertificatePem(PEM.replace(/\n/g, "\\n"))).toBe(PEM);
  });

  it("nimmt ein base64-kodiertes PEM an", () => {
    // Der Weg ueber Transportkanaele, die Zeilenumbrueche nicht durchlassen.
    expect(normalizeCertificatePem(Buffer.from(PEM, "utf8").toString("base64"))).toBe(PEM);
  });

  it("lehnt eine leere Zeichenkette ab", () => {
    expect(normalizeCertificatePem("")).toBeNull();
  });

  it("lehnt Text ohne PEM-Rahmen ab", () => {
    expect(normalizeCertificatePem("das ist kein zertifikat")).toBeNull();
  });

  it("lehnt einen abgeschnittenen PEM-Rahmen ab", () => {
    // Nur der Anfang, kein Ende — die haeufigste Form eines beim Kopieren
    // verstuemmelten Zertifikats.
    expect(normalizeCertificatePem(PEM.split("-----END")[0] ?? "")).toBeNull();
  });

  it("lehnt base64 ab, das nicht zu einem PEM dekodiert", () => {
    expect(normalizeCertificatePem(Buffer.from("kein pem", "utf8").toString("base64"))).toBeNull();
  });
});

describe("DATABASE_SSL_ROOT_CERT — Konfigurationsgrenze", () => {
  it("ist in ENV_VAR_META gefuehrt und als Geheimnis markiert", () => {
    // Ohne Eintrag in ENV_VAR_META filtert `load.ts` die Variable weg, bevor
    // das Schema sie sieht — sie waere dann still wirkungslos.
    // Gegenmutation: den Eintrag entfernen -> rot.
    expect(ENV_VAR_META).toHaveProperty("DATABASE_SSL_ROOT_CERT");
    expect(ENV_VAR_META.DATABASE_SSL_ROOT_CERT.secret).toBe(true);
  });

  it("scheitert in production fail-closed, wenn das Zertifikat fehlt", () => {
    // Der Kern der Entscheidung: ohne Wurzelzertifikat kann die Kette nicht
    // geprueft werden, und eine unverifizierte TLS-Verbindung ist bei
    // Mandantendaten keine Alternative. Also Startfehler, kein Fallback.
    // Gegenmutation: `DATABASE_SSL_ROOT_CERT` im production-Preset optional
    // machen -> rot.
    expect(() => loadConfig(ohne(produktion, "DATABASE_SSL_ROOT_CERT"))).toThrow(
      ConfigValidationError,
    );
  });

  it("nennt beim Fehlen genau diese Variable", () => {
    try {
      loadConfig(ohne(produktion, "DATABASE_SSL_ROOT_CERT"));
      expect.unreachable("loadConfig haette scheitern muessen");
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ConfigValidationError);
      const namen = (fehler as ConfigValidationError).problems.map((p) => p.variable);
      expect(namen).toContain("DATABASE_SSL_ROOT_CERT");
    }
  });

  it("lehnt ein ungueltiges PEM in production ab, und zwar ALS ungueltig", () => {
    // Die Zusicherung nennt den Grund, nicht nur „es wirft". Ohne die
    // Schemaerweiterung wirft `loadConfig` naemlich AUCH — dann aber, weil
    // `z.strictObject` den Schluessel gar nicht kennt. Ein Test, der beides
    // nicht unterscheidet, waere im roten Lauf gruen und damit wertlos.
    //
    // Gegenmutation: die PEM-Pruefung aus dem Schema entfernen (nur
    // `z.string().min(1)`) -> rot, weil dann gar nichts mehr geworfen wird.
    try {
      loadConfig({ ...produktion, DATABASE_SSL_ROOT_CERT: "offensichtlich kaputt" });
      expect.unreachable("loadConfig haette scheitern muessen");
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ConfigValidationError);
      const probleme = (fehler as ConfigValidationError).problems;
      expect(probleme.map((p) => p.variable)).toEqual(["DATABASE_SSL_ROOT_CERT"]);
      expect(probleme[0]?.reason).toBe("invalid");
    }
  });

  it("liefert das normalisierte PEM in der Konfiguration", () => {
    const konfiguration = loadConfig({
      ...produktion,
      DATABASE_SSL_ROOT_CERT: PEM.replace(/\n/g, "\\n"),
    });
    // Nachgelagerte Nutzer bekommen PEM, egal wie der Rohwert ankam.
    expect(konfiguration.databaseSslRootCert).toBe(PEM);
  });

  it("ist in test optional, wird dort aber angenommen und normalisiert", () => {
    // Zwei Aussagen in einem Fall, weil die erste allein auf dem Basisstand
    // trivial gruen waere: ein Feld, das es nicht gibt, ist immer `undefined`.
    // Die zweite Haelfte kann nur gruen sein, wenn der Schluessel dem Schema
    // bekannt ist — `z.strictObject` wuerde ihn sonst zurueckweisen.
    const lokal = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://localhost:54322/postgres",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_ANON_KEY: "anon-platzhalter",
      API_PORT: "3001",
    };
    // Lokale Staende sprechen ohne TLS mit dem Supabase-Container; ein dort
    // erzwungenes Zertifikat waere eine Huerde ohne Sicherheitsgewinn.
    expect(loadConfig(lokal).databaseSslRootCert).toBeUndefined();
    expect(loadConfig({ ...lokal, DATABASE_SSL_ROOT_CERT: PEM }).databaseSslRootCert).toBe(PEM);
  });
});

describe("DATABASE_SSL_ROOT_CERT — kein Wert in Fehlern oder Logs", () => {
  it("erscheint nicht in der Fehlermeldung bei ungueltigem Wert", () => {
    // Der Redaktionsvertrag aus `load.ts`: Meldungen nennen Variablennamen,
    // niemals Werte. Ein mehrzeiliges PEM in einer Fehlermeldung waere zudem
    // unlesbar. Gegenmutation: den Rohwert in die Meldung aufnehmen -> rot.
    const kaputt = "-----BEGIN CERTIFICATE-----\nGEHEIMER_INHALT_XYZ\n";
    try {
      loadConfig({ ...produktion, DATABASE_SSL_ROOT_CERT: kaputt });
      expect.unreachable("loadConfig haette scheitern muessen");
    } catch (fehler) {
      expect(String((fehler as Error).message)).not.toContain("GEHEIMER_INHALT_XYZ");
      expect(JSON.stringify(fehler)).not.toContain("GEHEIMER_INHALT_XYZ");
    }
  });

  it("wird von redact() geschwaerzt", () => {
    // Gegenmutation: `databaseSslRootCert` aus SECRET_CONFIG_KEYS entfernen -> rot.
    const konfiguration = loadConfig(produktion);
    const geschwaerzt = redact(konfiguration);
    expect(JSON.stringify(geschwaerzt)).not.toContain("BEGIN CERTIFICATE");
  });
});
