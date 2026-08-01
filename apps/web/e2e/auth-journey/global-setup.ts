import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Testdatengrenze der realen Auth-Kostenreise (EYT-106 AK8, EYT-134).
 *
 * ## Zwei Schritte, zwei Zustaendigkeiten
 *
 *  1. GoTrue legt den Benutzer an — ueber den oeffentlichen Signup-Endpunkt
 *     mit dem Anon-Key, also genau den Weg, den auch ein echter Mensch
 *     nimmt. Kein Service-Role-Schluessel, keine Admin-API, kein direktes
 *     `insert into auth.users`.
 *  2. `fixtures.sql` haengt die Anwendungsseite daran: Projektion,
 *     Organisation, Owner-Mitgliedschaft, Mitarbeiter, Satzversion.
 *
 * Das ist die "isolierte Test-/Ops-Grenze" aus der PO-Vorgabe. Sie liegt
 * ausserhalb des Laufzeitpfads: der Waechter aus Arbeitspaket A rechnet
 * `apps/web/e2e/**` ausdruecklich nicht zum Anfrage- oder Browserpfad.
 *
 * ## Das Passwort
 *
 * Wird hier je Lauf zufaellig erzeugt und ueber `process.env` an die Reise
 * weitergereicht. Es steht nirgends im Repository und wird nirgends
 * ausgegeben — auch nicht bei einem Fehlschlag. Ein festes Testpasswort waere
 * ein committetes Geheimnis, auch wenn es nur lokal gilt.
 *
 * ## Warum `execFileSync` mit psql und nicht `pg`
 *
 * `apps/web` haengt bewusst an genau zwei Workspace-Paketen und keinem
 * Datenbanktreiber. Ein `pg`-Import hier waere eine neue Abhaengigkeit der
 * Web-App fuer Testzwecke — `psql` liegt in CI ohnehin vor und laesst die
 * Abhaengigkeitsgrenze unberuehrt.
 */

const HIER = dirname(fileURLToPath(import.meta.url));

/** Feste Adresse in einer reservierten Domain (RFC 2606) — nie eine reale Person. */
export const REISENDER_EMAIL = "auth-journey@easytree.test";

function pflicht(name: string): string {
  const wert = process.env[name];
  if (wert === undefined || wert === "") {
    throw new Error(`[auth-journey] ${name} fehlt.`);
  }
  return wert;
}

interface SignupAntwort {
  readonly user?: { readonly id?: string };
  readonly id?: string;
}

/**
 * Meldet den Reisenden an — oder stellt fest, dass es ihn schon gibt.
 *
 * Ein zweiter Lauf auf demselben Stack darf nicht daran scheitern, dass der
 * Benutzer bereits existiert. GoTrue antwortet dann mit 422
 * `user_already_exists`; in dem Fall wird das Passwort NICHT stillschweigend
 * uebernommen — der Lauf bricht ab und verlangt einen sauberen Stack, weil
 * ein unbekanntes Passwort spaeter als "Login fehlgeschlagen" erschiene und
 * niemand den wahren Grund saehe.
 */
async function legeBenutzerAn(supabaseUrl: string, anonKey: string, passwort: string) {
  const antwort = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email: REISENDER_EMAIL, password: passwort }),
  });

  if (!antwort.ok) {
    // Bewusst ohne Antwortkoerper in der Meldung: der kann den Anon-Key oder
    // Tokenfragmente enthalten.
    throw new Error(
      `[auth-journey] Signup fehlgeschlagen (HTTP ${antwort.status}). ` +
        `Erwartet wird ein frischer lokaler Supabase-Stack ohne bestehenden ` +
        `Reisenden. Bei 422 zuerst 'supabase db reset' ausfuehren.`,
    );
  }

  const koerper = (await antwort.json()) as SignupAntwort;
  const benutzerId = koerper.user?.id ?? koerper.id;
  if (typeof benutzerId !== "string" || benutzerId === "") {
    throw new Error("[auth-journey] Signup lieferte keine Benutzer-Id.");
  }
  return benutzerId;
}

function spieleFixturesEin(datenbankUrl: string, benutzerId: string): void {
  const ausgabe = execFileSync(
    "psql",
    [
      datenbankUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `benutzer=${benutzerId}`,
      "-f",
      join(HIER, "fixtures.sql"),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // Die greppbare Zeile aus fixtures.sql sichtbar machen — sie ist der
  // Nachweis, dass alle vier Zeilen wirklich stehen.
  const zeile = /\[auth-journey-fixture\][^\n]*/.exec(ausgabe);
  console.log(zeile?.[0] ?? "[auth-journey-fixture] (keine Bestaetigungszeile gefunden)");
}

export default async function globalSetup(): Promise<void> {
  const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
  const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");
  // Eigene, hoeher privilegierte Verbindung NUR fuer die Testdaten: die
  // Anwendung selbst laeuft mit easytree_app und RLS.
  const datenbankUrl = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

  // 24 Byte base64url — deutlich ueber minimum_password_length (6) und ohne
  // Sonderzeichen, die in einer Shell oder URL Aerger machen.
  const passwort = randomBytes(24).toString("base64url");

  const benutzerId = await legeBenutzerAn(supabaseUrl, anonKey, passwort);
  spieleFixturesEin(datenbankUrl, benutzerId);

  // Weiterreichen an die Reise. Nur der Prozess sieht das; nichts davon
  // erscheint in einem Report, einem Trace oder einem Screenshot.
  process.env["EASYTREE_JOURNEY_EMAIL"] = REISENDER_EMAIL;
  process.env["EASYTREE_JOURNEY_PASSWORT"] = passwort;
  process.env["EASYTREE_JOURNEY_USER_ID"] = benutzerId;

  console.log(`[auth-journey-setup] Reisender angelegt und verdrahtet (${REISENDER_EMAIL}).`);
}
