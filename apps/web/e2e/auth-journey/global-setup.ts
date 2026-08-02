import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/**
 * Testdatengrenze der realen Auth-Kostenreise (EYT-106 AK8, EYT-134).
 *
 * ## Zwei echte Benutzer
 *
 * A ist Owner der Reiseorganisation. B ist ein ebenso echter, angemeldeter
 * Benutzer OHNE jede Mitgliedschaft. Erst das Paar unterscheidet: eine
 * eingeschleuste feste Identitaet machte B zu A, und genau das faellt auf,
 * weil Bs Sitzungsendpunkt Bs eigene Id nennen und der Kostenpfad ihn
 * trotzdem ablehnen muss.
 *
 * ## Beide entstehen ueber den oeffentlichen GoTrue-Signup
 *
 * Mit dem Anon-Key, also genau dem Weg, den auch ein Mensch nimmt. Kein
 * Service-Role-Schluessel, keine Admin-API, kein direktes Insert in
 * `auth.users`. Ein `update auth.users set encrypted_password = crypt(...)`
 * schied ebenfalls aus: pgcrypto ist im Repository nicht eingerichtet
 * (gemessen — nur pgtap und btree_gist), und eine Extension anzulegen waere
 * eine Schemaaenderung ausserhalb einer Migration.
 *
 * ## Passwoerter
 *
 * Je Lauf und je Benutzer zufaellig, nur ueber `process.env` weitergereicht,
 * nie als Prozessargument — `argv` ist fuer jeden lokalen Nutzer in `ps`
 * sichtbar, und `execFileSync` wiederholt die vollstaendige Argumentliste in
 * seiner Fehlermeldung.
 */

// `__dirname`, nicht `import.meta.url`: Playwright laedt Konfiguration, Setup
// und Testdateien als CommonJS — `apps/web/package.json` traegt kein
// "type": "module".
const HIER = __dirname;

/** Feste Adressen in einer reservierten Domain (RFC 2606). */
export const REISENDER_A = "auth-journey-a@easytree.test";
export const REISENDER_B = "auth-journey-b@easytree.test";

function pflicht(name: string): string {
  const wert = process.env[name];
  if (wert === undefined || wert === "") throw new Error(`[auth-journey] ${name} fehlt.`);
  return wert;
}

interface SignupAntwort {
  readonly user?: { readonly id?: string };
  readonly id?: string;
}

async function legeBenutzerAn(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  passwort: string,
): Promise<string> {
  const antwort = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password: passwort }),
  });

  if (!antwort.ok) {
    // Bewusst ohne Antwortkoerper: der kann Tokenfragmente enthalten. Bei 422
    // (`user_already_exists`) wird NICHT stillschweigend weitergemacht — ein
    // unbekanntes Passwort erschiene spaeter als "Login fehlgeschlagen", und
    // niemand saehe den wahren Grund.
    throw new Error(
      `[auth-journey] Signup fuer ${email} fehlgeschlagen (HTTP ${antwort.status}). ` +
        `Erwartet wird ein frischer Stack. Bei 422 zuerst teardown.sql fahren ` +
        `oder 'supabase db reset'.`,
    );
  }

  const koerper = (await antwort.json()) as SignupAntwort;
  const id = koerper.user?.id ?? koerper.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(`[auth-journey] Signup fuer ${email} lieferte keine Benutzer-Id.`);
  }
  return id;
}

/**
 * Fuehrt psql aus und verlangt die greppbare Markerzeile.
 *
 * Zwei Fehler der vorigen Fassung, beide gemessen:
 *
 *  1. `RAISE NOTICE` schreibt auf **stderr**, `execFileSync` liefert
 *     **stdout**. Der Marker wurde nie gefunden.
 *  2. Fehlte er, druckte die Funktion "(keine Bestaetigungszeile gefunden)"
 *     und lief weiter. Im CI-Log stand damit das eigene Versagen — und der
 *     Job endete mit 0.
 *
 * Jetzt: beide Stroeme getrennt erfassen, in beiden suchen, bei Fehlen
 * WERFEN. Ausgegeben wird ausschliesslich die Markerzeile, nie der volle
 * Strom — der enthaelt die Verbindungszeichenkette.
 */
export function psqlMitMarker(
  datenbankUrl: string,
  skript: string,
  variablen: readonly string[],
  marker: string,
): string {
  // `spawnSync` statt `execFileSync`, und das ist der Kern der Korrektur:
  // `execFileSync` liefert bei Erfolg AUSSCHLIESSLICH stdout. PostgreSQL
  // schickt `RAISE NOTICE` aber als NoticeResponse, und psql schreibt sie auf
  // **stderr**. Der Marker war damit per Konstruktion unerreichbar — die alte
  // Fassung suchte ihn in einem Strom, in dem er nie stand, meldete sein
  // Fehlen und lief weiter.
  const ergebnis = spawnSync(
    "psql",
    [datenbankUrl, "-v", "ON_ERROR_STOP=1", ...variablen, "-f", skript],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (ergebnis.error !== undefined) {
    throw new Error(`[auth-journey] psql liess sich nicht starten: ${ergebnis.error.message}`);
  }
  const zusammen = `${ergebnis.stdout ?? ""}\n${ergebnis.stderr ?? ""}`;
  if (ergebnis.status !== 0) {
    // Exit-Code ungleich 0 ist rot. Die Meldung nennt den Code und ob der
    // Marker da war — nie die Argumentliste, dort steht die Verbindung.
    throw new Error(
      `[auth-journey] psql ${skript} endete mit Code ${ergebnis.status ?? "unbekannt"}. ` +
        `Marker "${marker}" ${zusammen.includes(marker) ? "war vorhanden" : "fehlte"}.`,
    );
  }
  const zeile = zusammen.split("\n").find((z) => z.includes(marker));
  if (zeile === undefined) {
    throw new Error(
      `[auth-journey] Marker "${marker}" fehlt in der Ausgabe von ${skript}. ` +
        `Ohne ihn ist nicht belegt, dass das Skript seine Nachbedingung geprueft hat.`,
    );
  }
  return zeile.trim();
}

export default async function globalSetup(): Promise<void> {
  const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
  const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");
  const datenbankUrl = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

  // 24 Byte base64url — deutlich ueber minimum_password_length (6).
  const passwortA = randomBytes(24).toString("base64url");
  const passwortB = randomBytes(24).toString("base64url");

  const idA = await legeBenutzerAn(supabaseUrl, anonKey, REISENDER_A, passwortA);
  const idB = await legeBenutzerAn(supabaseUrl, anonKey, REISENDER_B, passwortB);

  const marker = psqlMitMarker(
    datenbankUrl,
    join(HIER, "fixtures.sql"),
    ["-v", `benutzer_a=${idA}`, "-v", `benutzer_b=${idB}`],
    "[auth-journey-fixture]",
  );
  console.log(`  ${marker}`);

  process.env["EASYTREE_JOURNEY_EMAIL_A"] = REISENDER_A;
  process.env["EASYTREE_JOURNEY_PASSWORT_A"] = passwortA;
  process.env["EASYTREE_JOURNEY_USER_A"] = idA;
  process.env["EASYTREE_JOURNEY_EMAIL_B"] = REISENDER_B;
  process.env["EASYTREE_JOURNEY_PASSWORT_B"] = passwortB;
  process.env["EASYTREE_JOURNEY_USER_B"] = idB;

  console.log("[auth-journey-setup] zwei echte Benutzer angelegt: A mit Owner-Rolle, B ohne.");
}
