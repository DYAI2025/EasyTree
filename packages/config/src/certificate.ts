/**
 * Normalisierung eines PEM-Wurzelzertifikats aus einer Umgebungsvariablen
 * (EYT-106 / fix(deploy) — Supabase-TLS-Kette).
 *
 * ## Warum diese Datei ueberhaupt existiert
 *
 * `DATABASE_SSL_ROOT_CERT` transportiert ein mehrzeiliges PEM durch eine
 * Umgebungsvariable. Je nach Weg kommt es unterschiedlich an:
 *
 * - direkt mehrzeilig (Railway-Variablenfeld, `.env` mit Anfuehrungszeichen);
 * - mit literalen `\n` statt echter Zeilenumbrueche (Shell, CI-Secrets);
 * - base64-kodiert (Transportwege, die Zeilenumbrueche nicht durchlassen).
 *
 * Alle drei muessen zu **demselben** PEM fuehren, und alles andere muss
 * abgelehnt werden. Die Normalisierung sitzt deshalb an EINER Stelle und
 * laeuft an der Konfigurationsgrenze — nicht in drei Datenbankmodulen.
 *
 * ## Was hier bewusst NICHT passiert
 *
 * Keine Pruefung von Gueltigkeitsdauer, Aussteller oder Signatur. Diese Datei
 * beantwortet ausschliesslich: „ist das syntaktisch ein PEM-Zertifikat?".
 * Ob die Kette traegt, entscheidet die TLS-Bibliothek beim Verbinden — und
 * genau dort soll sie es auch entscheiden.
 *
 * ## Kein Wert in Fehlern
 *
 * Diese Datei gibt niemals Zertifikatsinhalt zurueck oder in eine Meldung.
 * Der Rueckgabewert ist PEM oder `null`; wer `null` bekommt, meldet den
 * Variablennamen, nie den Wert (derselbe Vertrag wie in `load.ts`).
 */

const PEM_ANFANG = "-----BEGIN CERTIFICATE-----";
const PEM_ENDE = "-----END CERTIFICATE-----";

/**
 * Sieht der Text nach einem vollstaendigen PEM-Zertifikat aus?
 *
 * Verlangt BEIDE Rahmenzeilen. Nur den Anfang zu pruefen waere die haeufigste
 * Form eines beim Kopieren verstuemmelten Zertifikats — und die faellt dann
 * erst beim TLS-Handschlag auf, wo die Meldung nichts mehr erklaert.
 */
function hatPemRahmen(text: string): boolean {
  return text.includes(PEM_ANFANG) && text.includes(PEM_ENDE);
}

/** Vereinheitlicht Zeilenenden und entfernt umschliessenden Leerraum. */
function aufraeumen(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * Wandelt den Rohwert in ein PEM-Zertifikat um, oder liefert `null`.
 *
 * Akzeptiert: echtes PEM, PEM mit literalen `\n`, base64-kodiertes PEM.
 * Lehnt ab: alles andere, einschliesslich leerer Zeichenketten.
 */
export function normalizeCertificatePem(raw: string): string | null {
  const roh = aufraeumen(raw);
  if (roh === "") return null;

  // Escapes werden IMMER zuerst aufgeloest, nicht erst als zweiter Versuch.
  //
  // Gemessener Grund: `hatPemRahmen` findet `-----BEGIN CERTIFICATE-----` auch
  // in der escapten Form, weil die Rahmenzeile selbst kein `\n` enthaelt. Eine
  // Reihenfolge „erst Rahmen pruefen, dann entschluepfen" gibt deshalb den
  // escapten Text unveraendert zurueck — mit literalen `\n` mitten im Base64,
  // und der TLS-Handschlag scheitert spaeter ohne erkennbaren Zusammenhang.
  //
  // Das Aufloesen ist bei echtem PEM ein Leerlauf: der Base64-Zeichenvorrat
  // (A-Za-z0-9+/=) und die Rahmenzeilen enthalten keinen Backslash.
  const entschluepft = aufraeumen(roh.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n"));
  if (hatPemRahmen(entschluepft)) return entschluepft;

  // base64. `Buffer.from(..., "base64")` ist nachsichtig und liefert fuer
  // Nicht-base64 einfach Muell statt zu werfen; deshalb entscheidet nicht die
  // Dekodierung, sondern der Rahmen im Ergebnis.
  const dekodiert = aufraeumen(Buffer.from(roh, "base64").toString("utf8"));
  if (hatPemRahmen(dekodiert)) return dekodiert;

  return null;
}

/** Ob der Rohwert zu einem gueltigen PEM normalisiert werden kann. */
export function isCertificatePem(raw: string): boolean {
  return normalizeCertificatePem(raw) !== null;
}

export { PEM_ANFANG, PEM_ENDE };
