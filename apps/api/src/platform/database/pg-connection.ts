/**
 * Die EINE Stelle, an der die PostgreSQL-Verbindungskonfiguration entsteht
 * (EYT-106 / fix(deploy) — Supabase-TLS-Kette).
 *
 * ## Warum eine gemeinsame Factory
 *
 * Vorher bauten drei Dateien ihre Verbindung selbst, jede mit nichts als
 * `{ connectionString }`: `role-privileges.ts` (Startgate), `pg-database-ping.ts`
 * (Readiness) und `tenant-query-runner.ts` (jeder fachliche Zugriff). Drei
 * getrennte TLS-Implementierungen sind drei Gelegenheiten, an genau einer davon
 * die Kettenpruefung zu verlieren — und die verlorene faellt nicht auf, weil
 * die anderen beiden weiter funktionieren.
 *
 * ## Der gemessene Anlass
 *
 * Gegen Supabase scheiterte der Start mit
 * `self-signed certificate in certificate chain`. Ursache: `pg` 8.22 behandelt
 * `sslmode=require` inzwischen wie `verify-full`, und Supabases Kette ist von
 * einer eigenen CA signiert (`CN=Supabase Intermediate 2021 CA`, gemessen
 * 31.07.2026), die Node nicht kennt. Die Antwort darauf ist das projektbezogene
 * Wurzelzertifikat — nicht das Abschalten der Pruefung.
 *
 * ## Warum die GESAMTE Query verschwindet, nicht eine Parameterliste
 *
 * `pg` 8.22 merged `Object.assign({}, config, parse(config.connectionString))`
 * — die aus der URL geparsten Werte UEBERSCHREIBEN das explizite `ssl`-Objekt,
 * nicht umgekehrt (adversarial Review 31.07.2026, empirisch gegen die
 * installierten Pakete gemessen). Eine Denylist einzelner Parameter verliert
 * diesen Kampf strukturell: `ssl=no-verify` schaltete die Verifikation still
 * ab, `sslnegotiation=direct` verwarf die CA, `uselibpqcompat` wechselte die
 * Semantik, und percent-kodierte Namen (`%73slmode`) umgingen jeden rohen
 * Stringvergleich, weil der Parser vor dem Lesen dekodiert. Deshalb bleibt mit
 * Wurzelzertifikat KEIN Query-Parameter uebrig — auch harmlose wie
 * `application_name`. Ein sichtbar fehlender Anzeigename ist der billigere
 * Fehler als ein unsichtbar wirksamer SSL-Parameter.
 *
 * ## Was hier NICHT passiert
 *
 * Kein `rejectUnauthorized: false`, kein `sslmode=no-verify`, kein
 * `NODE_TLS_REJECT_UNAUTHORIZED`. Die Hostnamenpruefung bleibt aktiv; sie
 * wird nicht ueberschrieben und nicht abgeschaltet.
 */
import type { ClientConfig } from "pg";

/** Eingabe der Factory — bewusst nur die zwei Felder, die sie braucht. */
export interface PgConnectionInput {
  readonly databaseUrl: string;
  readonly sslRootCert: string | undefined;
}

/**
 * Baut die Verbindungskonfiguration fuer `pg`.
 *
 * Mit Wurzelzertifikat: URL ohne Query plus `ssl: { ca, rejectUnauthorized: true }`.
 * Ohne: die URL unveraendert — lokale Staende ohne TLS bleiben lauffaehig, und
 * in production erzwingt bereits das Konfigurationsschema das Zertifikat.
 */
export function pgConnectionConfig(input: PgConnectionInput): ClientConfig {
  if (input.sslRootCert === undefined) {
    return { connectionString: input.databaseUrl };
  }
  return {
    connectionString: stripUrlQuery(input.databaseUrl),
    ssl: { ca: input.sslRootCert, rejectUnauthorized: true },
  };
}

/**
 * Entfernt die gesamte Query aus einer Verbindungs-URL.
 *
 * Bewusst reine Zeichenkettenarbeit statt `new URL(...)`: `URL.toString()`
 * kodiert die Nutzerinfo neu, und ein Passwort mit Sonderzeichen kaeme anders
 * heraus, als es ankam. Angefasst wird nur, was ab dem ersten `?` steht.
 */
export function stripUrlQuery(databaseUrl: string): string {
  const fragezeichen = databaseUrl.indexOf("?");
  return fragezeichen === -1 ? databaseUrl : databaseUrl.slice(0, fragezeichen);
}
