/**
 * Die gemeinsame PostgreSQL-Verbindungsfactory (EYT-106, fix(deploy)).
 *
 * ## Der gemessene Anlass
 *
 * Railway-Service `EasyTree`, Crash-Schleife mit 502: `API bootstrap failed:
 * Die Datenbankrolle konnte nicht geprueft werden: self-signed certificate in
 * certificate chain. Start wird verweigert (fail-closed).` Gemessen am
 * 31.07.2026: Supabases Kette wurzelt in `CN=Supabase Intermediate 2021 CA`
 * (Aussteller von zwei unabhaengigen Netzstandorten identisch bestaetigt),
 * einer CA ausserhalb des Node-Truststores, und `pg` 8.22 behandelt
 * `sslmode=require` wie `verify-full`.
 *
 * ## Warum die GESAMTE Query verschwindet, nicht eine Parameterliste
 *
 * `pg` 8.22 merged `Object.assign({}, config, parse(connectionString))` —
 * die aus der URL geparsten Werte UEBERSCHREIBEN das explizite `ssl`-Objekt
 * (adversarial Review 31.07.2026, empirisch gegen die installierten Pakete
 * gemessen). Eine Denylist verliert diesen Kampf strukturell: `ssl=no-verify`,
 * `sslnegotiation=direct`, `uselibpqcompat`, percent-kodierte Namen wie
 * `%73slmode` und jeder kuenftige Parameter der Parserversion. Deshalb bleibt
 * mit Zertifikat KEIN Query-Parameter uebrig — laut und vollstaendig, statt
 * leise und unvollstaendig.
 *
 * ## Was diese Suite absichert
 *
 * Jede Zusicherung traegt ihre Gegenmutation im Kommentar; die kritischen
 * wurden am 31.07.2026 ausgefuehrt und haben die Suite rot gemacht.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { pgConnectionConfig, stripUrlQuery } from "../src/platform/database/pg-connection";

/** Syntaktisch gueltig, fachlich bedeutungslos — kein echtes Zertifikat. */
const PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBkTCB+wIJAKr4bJ1oXQ3fMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl",
  "-----END CERTIFICATE-----",
].join("\n");

const URL_MIT_SSLMODE =
  "postgresql://easytree_app:geheim@db.beispiel.supabase.co:5432/postgres?sslmode=require";

describe("pgConnectionConfig — mit Wurzelzertifikat", () => {
  it("setzt ssl.ca auf das PEM und rejectUnauthorized auf true", () => {
    // Der Kern des Fixes: Kette wird gegen die projektbezogene CA geprueft,
    // nicht abgeschaltet. Gegenmutation (ausgefuehrt 31.07.2026):
    // `rejectUnauthorized: false` in der Factory -> rot.
    const konfiguration = pgConnectionConfig({
      databaseUrl: URL_MIT_SSLMODE,
      sslRootCert: PEM,
    });
    expect(konfiguration.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("entfernt die GESAMTE Query aus dem connectionString", () => {
    // Absichtlich hartkodierte Erwartung statt einer geteilten Konstante:
    // ein Test, der ueber dieselbe Liste iteriert wie die Implementierung,
    // prueft die Implementierung gegen sich selbst und bleibt gruen, wenn
    // die Liste schrumpft (Review-Befund 31.07.2026).
    // Gegenmutation: das Strippen in der Factory weglassen -> rot.
    const konfiguration = pgConnectionConfig({
      databaseUrl:
        "postgresql://u:p@host:5432/db?sslmode=require&application_name=easytree&sslrootcert=/x",
      sslRootCert: PEM,
    });
    // Auch application_name faellt weg — laut dokumentierter Entscheidung:
    // besser ein sichtbar fehlender Anzeigename als ein unsichtbar
    // wirksamer SSL-Parameter.
    expect(konfiguration.connectionString).toBe("postgresql://u:p@host:5432/db");
  });

  it.each([
    // Die drei am 31.07.2026 gemessenen Bypaesse der frueheren Denylist.
    // pg merged die geparste URL UEBER das ssl-Objekt; jeder dieser Werte
    // haette die Kettenpruefung ausgehebelt oder die CA verworfen.
    ["?ssl=no-verify", "schaltet die Verifikation ab"],
    ["?%73slmode=no-verify", "percent-kodiert, Parser dekodiert vor dem Vergleich"],
    ["?sslnegotiation=direct", "setzt ssl:true und verwirft die CA"],
    ["?uselibpqcompat=true&sslmode=require", "libpq-Semantik ohne Wurzelzertifikat"],
  ])("laesst %s nicht im connectionString stehen (%s)", (query) => {
    const konfiguration = pgConnectionConfig({
      databaseUrl: `postgresql://u:p@host:5432/db${query}`,
      sslRootCert: PEM,
    });
    expect(konfiguration.connectionString).toBe("postgresql://u:p@host:5432/db");
  });

  it("die EFFEKTIVE pg-Konfiguration behaelt ca + rejectUnauthorized — an pg selbst gemessen", () => {
    // Review-Befund 31.07.2026: pg merged `Object.assign({}, config,
    // parse(connectionString))` — ein Test, der nur den Rueckgabewert der
    // Factory prueft, misst deshalb nicht, was die Verbindung wirklich tut.
    // Hier wird pg selbst gefragt: `new Client(...)` OHNE connect() rechnet
    // die effektiven connectionParameters bereits aus. Die URL traegt
    // absichtlich den schlimmsten gemessenen Bypass (`ssl=no-verify`).
    // Gegenmutation: das Query-Strippen in der Factory weglassen -> rot,
    // weil pg dann rejectUnauthorized:false errechnet (ausgefuehrt 31.07.2026).
    const client = new Client(
      pgConnectionConfig({
        databaseUrl: "postgresql://u:p@host:5432/db?ssl=no-verify&sslmode=require",
        sslRootCert: PEM,
      }),
    );
    const effektiv = (client as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters.ssl;
    expect(effektiv).toMatchObject({ ca: PEM, rejectUnauthorized: true });
  });

  it("ueberschreibt die Hostnamenpruefung nicht", () => {
    // `checkServerIdentity: () => undefined` waere die stille Form von
    // "Pruefung aus" — das ssl-Objekt saehe weiter korrekt aus.
    // Gegenmutation: einen checkServerIdentity-Override ergaenzen -> rot.
    const konfiguration = pgConnectionConfig({
      databaseUrl: URL_MIT_SSLMODE,
      sslRootCert: PEM,
    });
    expect(konfiguration.ssl).not.toHaveProperty("checkServerIdentity");
  });
});

describe("pgConnectionConfig — ohne Wurzelzertifikat", () => {
  it("laesst die URL unveraendert und setzt kein ssl-Objekt", () => {
    // Lokale Staende sprechen ohne TLS mit dem Supabase-Container; in
    // production erzwingt bereits das Konfigurationsschema das Zertifikat
    // (packages/config, DATABASE_SSL_ROOT_CERT ist dort Pflicht).
    // Gegenmutation: auch ohne Zertifikat ein ssl-Objekt setzen -> rot.
    const konfiguration = pgConnectionConfig({
      databaseUrl: URL_MIT_SSLMODE,
      sslRootCert: undefined,
    });
    expect(konfiguration.connectionString).toBe(URL_MIT_SSLMODE);
    expect(konfiguration.ssl).toBeUndefined();
  });
});

describe("pgConnectionConfig — kein Pfad schwaecht die Pruefung", () => {
  it("liefert niemals rejectUnauthorized false, in keinem Zweig", () => {
    // Beide Zweige der Factory, eine Aussage: entweder gibt es kein
    // ssl-Objekt, oder es prueft. Ein dritter Zustand existiert nicht.
    // Gegenmutation: irgendeinen Zweig auf `rejectUnauthorized: false`
    // stellen -> rot.
    for (const sslRootCert of [PEM, undefined]) {
      const konfiguration = pgConnectionConfig({ databaseUrl: URL_MIT_SSLMODE, sslRootCert });
      if (konfiguration.ssl !== undefined) {
        expect(konfiguration.ssl).toMatchObject({ rejectUnauthorized: true });
      }
    }
  });
});

describe("stripUrlQuery", () => {
  it("laesst eine URL ohne Query unveraendert", () => {
    expect(stripUrlQuery("postgresql://u:p@host:5432/db")).toBe("postgresql://u:p@host:5432/db");
  });

  it("fasst Nutzerinfo und Host nicht an", () => {
    // Bewusst KEINE URL-Klasse mit toString(): die kodiert Nutzerinfo neu,
    // und ein Passwort mit Sonderzeichen kaeme anders heraus, als es ankam.
    const url = "postgresql://user:p%40ss@host:5432/db?sslmode=require";
    expect(stripUrlQuery(url)).toBe("postgresql://user:p%40ss@host:5432/db");
  });
});

describe("alle drei Aufrufstellen nutzen die Factory", () => {
  // Der eigentliche Zweck der Uebung: EINE TLS-Implementierung, nicht drei.
  // Diese Zusicherung ist statisch, weil sie eine Struktureigenschaft der
  // Quelltexte ist — dieselbe Bauart wie architecture.test.ts, und ehrlich
  // als solche beschriftet: sie liest Quelltext, nicht Verhalten.
  const wurzel = join(__dirname, "..", "src", "platform", "database");
  const aufrufstellen = ["role-privileges.ts", "pg-database-ping.ts", "tenant-query-runner.ts"];

  it.each(aufrufstellen)("%s reicht die Factory direkt an den Konstruktor", (datei) => {
    // Zwei Muster, weil jedes allein umgehbar ist (Review-Befund 31.07.2026,
    // beide Mutationen ausgefuehrt):
    //   (a) `const { connectionString } = pgConnectionConfig(...)` — enthaelt
    //       den Funktionsnamen, verliert aber das ssl-Objekt. Faengt das
    //       connectionString-Verbot.
    //   (b) ein connectionString-Literal neben der Factory — die zweite
    //       TLS-Quelle. Faengt ebenfalls das Verbot.
    // Gegenmutation: eine der beiden Formen einbauen -> rot.
    const quelltext = readFileSync(join(wurzel, datei), "utf8");
    expect(quelltext).toMatch(/new (Client|Pool)\((\{\s*\.\.\.)?pgConnectionConfig\(/);
    expect(quelltext).not.toMatch(/connectionString/);
  });
});

describe("das Zertifikat fliesst aus AppConfig in jede Konstruktionsstelle", () => {
  // Review-Befund 31.07.2026: die Mutation `sslRootCert: undefined` an einer
  // einzelnen Verdrahtungsstelle liess die komplette Suite gruen — die
  // Factory war geprueft, ihr Zulieferweg nicht. Statischer Waechter,
  // ehrlich beschriftet; er prueft die Nennung, nicht den Laufzeitwert.
  // Gegenmutation: an einer der vier Stellen `sslRootCert: undefined`
  // einsetzen -> rot.
  const api = join(__dirname, "..", "src");
  const verdrahtung = [
    "main.ts",
    "worker.ts",
    "app.module.ts",
    join("platform", "database", "tenant-query-runner.provider.ts"),
  ];

  it.each(verdrahtung)("%s uebergibt config.databaseSslRootCert", (datei) => {
    const quelltext = readFileSync(join(api, datei), "utf8");
    expect(quelltext).toMatch(/sslRootCert:\s*config\.databaseSslRootCert/);
  });
});
