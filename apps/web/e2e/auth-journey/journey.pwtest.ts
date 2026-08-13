import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Cookie,
} from "@playwright/test";

import { psqlMitMarker } from "./global-setup";

/**
 * Die reale Auth-Kostenreise (EYT-106 AK8, EYT-134).
 *
 * Browser -> echte Loginseite -> GoTrue -> HttpOnly-Cookies -> Next-Rewrite ->
 * echte NestJS-API -> Policy -> RLS -> PostgreSQL. Kein Schritt ist ersetzt.
 *
 * ## Was diese Datei beweist, was `read-through.spec.ts` nicht kann
 *
 * Der Read-Through-Nachweis startet `dist-harness/test/harness/main.js` und
 * gibt das Subjekt als `process.argv[2]` mit. Er beweist den DATENWEG, nicht
 * die Identitaet. Hier laeuft `dist/main.js` — die echte Kette mit
 * Tokenverifikation (ES256 gegen den GoTrue-JWKS), Liveness-Pruefung bei jeder
 * Anfrage und der realen Kostenpolicy.
 *
 * ## Warum A/B und nicht "ohne Anmeldung 401"
 *
 * Eine fruehere Fassung behauptete, ein Aufruf OHNE Cookie liefere gegen den
 * Harness 200 und beweise damit, dass kein Subjekt eingeschleust ist. Das ist
 * FALSCH und am 02.08.2026 widerlegt worden: der Harness ersetzte die
 * Identitaet und lieferte auf dem Kostenpfad ebenfalls 401. Die Zusicherung
 * unterschied also nichts, und ihre benannte Gegenmutation waere nie rot
 * geworden.
 *
 * NACHTRAG EYT-107: seit dem Auth-Umbau ersetzt `apps/api/test/harness/server.ts`
 * nur noch `REQUEST_IDENTITY` — `TENANT_SUBJECT_RESOLVER` und
 * `DenyAllPlanningAccess` gibt es nicht mehr, die Planung haengt an derselben
 * Kette wie die Kosten. An der Aussage aendert das nichts, im Gegenteil: der
 * Harness ersetzt jetzt GENAU die Identitaet und kann ueber sie erst recht
 * nichts beweisen. Dieser Lauf hier kann es.
 *
 * Zwei echte Benutzer unterscheiden sehr wohl. A ist Owner, B ist ein ebenso
 * echter angemeldeter Benutzer ohne jede Mitgliedschaft. Waere eine feste
 * Identitaet eingeschleust, wuerde Bs Sitzung As Id nennen und der Kostenpfad
 * ihn durchlassen. Beides wird gemessen.
 *
 * ## Herkunft der Testidentitaet
 *
 * `global-setup.ts` meldet den Reisenden ueber den oeffentlichen
 * GoTrue-Signup an (Anon-Key, wie ein echter Mensch) und haengt mit
 * `fixtures.sql` Organisation, Owner-Mitgliedschaft, Mitarbeiter und eine
 * Satzversion daran. Kein Service-Role-Schluessel, keine Admin-API, kein
 * direktes Insert in `auth.users`.
 *
 * ## Gegenmutationen, die diese Datei rot machen
 *
 * - `REQUEST_IDENTITY` fest auf Benutzer A verdrahten: Bs Sitzung nennt dann
 *   As Id und der Kostenpfad laesst B durch — beide B-Nachweise werden rot.
 * - Die Kostenansicht die Gesamtsumme aus den Positionen summieren lassen
 *   (EYT-144): Schritt 9e wird rot — bei EINER Position faellt das hier zwar
 *   nicht auf, wohl aber in `kosten-ansicht.test.tsx` (Fall A1), wo die Fixtur
 *   Kopf- und Positionssumme absichtlich auseinanderlegt. Hier greift dafuer
 *   der Vergleich gegen PostgreSQL.
 * - Die Kostenansicht beim Oeffnen von `?snapshot=<id>` erneut erzeugen lassen
 *   (EYT-144): Schritt 9f wird rot (`POST /api/v1/kosten/snapshots` steht dann
 *   im Netzwerkprotokoll nach dem Reload), und 9g ebenfalls, weil das Skript
 *   `eyt144-snapshot-pruefen.sql` dann `koepfe=2` zaehlt.
 * - `costs.read` aus der Route `GET /kosten/planversionen` entfernen: der
 *   B-Nachweis „B erreicht weder Planversionsliste noch fremden Snapshot" wird
 *   rot, weil die Liste mit dem Organisationsheader von A dann 200 liefert.
 * - `serializeAccessCookie` ohne `HttpOnly` (Schritt 4).
 * - `SameSite=Lax` statt `Strict` (Schritt 4).
 * - Die Kosten-Navigation unabhaengig von `costs.read` rendern (Schritt 6
 *   bliebe gruen, aber Schritt 11 nach dem Abmelden wuerde rot).
 * - Das Logout ohne loeschende Cookies (Schritt 12).
 * - `app.is_runtime_channel()` aus der Update-Policy von `plan_versions`
 *   entfernen (Migration 0015): Schritt 9c2 wird rot, weil PostgREST die
 *   Planversion dann tatsaechlich veroeffentlicht. Das ist der P1-Nachweis
 *   vom 04.08.2026 und der einzige Ort, an dem der ECHTE Angriffskanal
 *   gefahren wird.
 * - Spalten-Grant und `published_at is null` aus der Insert-Policy entfernen
 *   (Migration **0016**): Schritt 9c3 wird rot — PostgREST legt dann eine von
 *   Geburt an veroeffentlichte Planversion an. Befund F1 aus dem Selbstreview.
 *   BEIDE Riegel muessen fallen: einzeln entfernt haelt der jeweils andere
 *   (gemessen in den Laeufen 30874279915 und 30874546740).
 * - `app.is_runtime_channel()` aus `assignments_insert_in_org` oder
 *   `plan_versions_insert_in_org` entfernen (Migration **0017**): Schritt 9c4
 *   wird rot. Das ist der Kern des Nachweises — Reisender A TRAEGT
 *   `planning.write` (in 9c4 ueber sein eigenes Token gemessen), ihn haelt
 *   allein der Kanal ab.
 *   AUSGEFUEHRT: Lauf 31238564685 (`assignments`, INSERT kam mit **201**
 *   durch) und Lauf 31238659805 (`plan_versions`, ebenfalls **201**).
 * - Das `update`- bzw. `delete`-Recht auf `assignments` fuer `authenticated`
 *   wiederherstellen UND die zugehoerige Policy neu anlegen (Rollback-Rezept
 *   im Kopf von 0017): Schritt 9c5 wird rot — PATCH bzw. DELETE greifen dann
 *   durch, und die Nachkontrolle sieht eine veraenderte bzw. fehlende Zeile.
 *   AUSGEFUEHRT: Lauf 31238598756 (PATCH → **200**) und Lauf 31238658106
 *   (DELETE → **200**).
 *
 * Die folgenden drei sind DURCHDACHT, aber NICHT gefahren — sie stehen hier
 * als Ausfallanalyse, nicht als Nachweis. Wer sie als Beleg zitiert, zitiert
 * eine Ueberlegung:
 * - NUR den Grant wiederherstellen, die Policy weggelassen: 9c5 wird ebenfalls
 *   rot, aber frueher und aus einem anderen Grund — ohne permissive Policy
 *   waehlt das UPDATE null Zeilen aus, PostgREST antwortet mit 200 und leerer
 *   Menge (dieselbe Mechanik wie 9c2), und `erwarteRiegel` faellt schon an der
 *   Statuszusicherung. Die WIRKUNGSkontrollen blieben dabei gruen. Genau fuer
 *   diesen Fall gibt es die Riegelzusicherung: sie haelt fest, WELCHER Riegel
 *   getragen hat, nicht nur dass abgewiesen wurde.
 * - `('member','planning.write')` in `role_permissions` eintragen: 9c5 wird
 *   rot — aber NICHT an einer Angriffszusicherung, sondern schon am
 *   Praemissenwaechter in `eyt136-member-an.sql` (`raise exception`, noch vor
 *   dem ersten Angriff). Genau so soll es sein: der Angriff waere damit vakuos
 *   geworden, und das faellt VOR dem Angriff auf statt danach.
 * - Die Rueckgabe der Leihmitgliedschaft in 9c5 auslassen: die Nachbedingung
 *   in `eyt136-member-aus.sql` wirft (`leihe`/`b_gesamt` ungleich 0), und
 *   `psqlMitMarker` macht daraus einen roten Schritt. DAS ist der primaere
 *   Waechter. Sekundaer — und nur, wenn der Hauptnachweis sonst gruen bleibt —
 *   wuerde auch „Benutzer B ist angemeldet, aber ohne Mitgliedschaft
 *   ausgesperrt" rot, weil Bs Sitzung dann eine Organisation naennte.
 */

// `__dirname`, nicht `import.meta.url`: Playwright laedt Konfiguration,
// Setup und Testdateien als CommonJS — `apps/web/package.json` traegt kein
// "type": "module". Mit import.meta bricht der Lauf mit
// "Cannot use 'import.meta' outside a module" ab, bevor irgendein
// Nachweis laeuft (gemessen in CI 01.08.2026). Die beiden bestehenden
// Playwright-Konfigurationen benutzen aus demselben Grund keine.
const HIER = __dirname;
const ARTEFAKTE = join(HIER, "..", "..", "test-results", "auth-journey");

const ORG_ID = "00000000-0000-4000-8000-00000000e201";
const ORG_NAME = "E2E Reiseorganisation";
const MITARBEITER_NAME = "E2E-Mitarbeiter Reise";
const MITARBEITER_ID = "00000000-0000-4000-8000-00000000e211";
/** Die Baustelle der Fixtur — Ziel der Data-API-Inserts in 9c4/9c5 (EYT-136). */
const BAUSTELLE_ID = "00000000-0000-4000-8000-00000000e241";
/** Die Zuweisung der Fixtur — Ziel von PATCH und DELETE in 9c5 (EYT-136). */
const ZUWEISUNG_ID = "00000000-0000-4000-8000-00000000e261";
/** 4250 Minor Units, so wie `minorUnitsToEuro` sie deutsch formatiert. */
const ERWARTETER_BETRAG = "42,50 €";
/** Eine Organisation, in der der Reisende NICHT Mitglied ist. */
const FREMDE_ORG = "00000000-0000-4000-8000-0000000000b2";

/**
 * Die Abloesung (EYT-108).
 *
 * Das Datum liegt bewusst NACH dem `valid_from` der Fixtur (2026-01-01) und
 * ist fest, nicht relativ zu heute: ein relatives Datum liesse den Test je
 * nach Laufzeitpunkt eine andere Aussage treffen.
 */
const ABLOESE_DATUM = "2026-09-01";
const ABLOESE_GRUND = "Tariferhoehung der E2E-Reise";

/**
 * Der Kosten-Snapshot der Reise (EYT-144) — von Hand nachgerechnet.
 *
 * Die Zuweisung aus `fixtures.sql` laeuft am 03.08.2026 von 06:00Z bis 14:00Z,
 * in `Europe/Berlin` also 08:00–16:00: acht Stunden an EINEM lokalen Tag. Der
 * am 03.08. wirksame Satz ist der Startsatz mit 4250 Minor Units — die
 * Abloesung aus 9a beginnt erst am {@link ABLOESE_DATUM} (01.09.2026) und darf
 * hier gerade NICHT greifen. 8 × 4250 = 34000.
 *
 * Diese Zahl steht als Konstante und wird NICHT aus der Antwort uebernommen:
 * ein Server, der 0 lieferte, saehe sonst genauso gruen aus. Zusaetzlich
 * vergleicht die Reise die Anzeige mit dem Antwortkoerper UND mit der Zeile in
 * PostgreSQL — drei unabhaengige Quellen fuer denselben Betrag.
 */
const ERWARTETE_KOSTEN_MINOR = "34000";
const ERWARTETE_KOSTEN_ANZEIGE = "340,00 EUR";
/** 28.800.000 ms, wie die Ansicht sie formatiert. */
const ERWARTETE_DAUER = "8:00 h";

/**
 * Die Snapshot-Id der Reise, fuer den B-Nachweis (EYT-144).
 *
 * Modulweit, weil beide Faelle sie brauchen und in verschiedenen Testfunktionen
 * stehen; `mode: "serial"` plus `workers: 1` garantieren die Reihenfolge. Faellt
 * Reise A aus, bleibt sie leer — B faellt dann auf {@link ID_OHNE_SNAPSHOT}
 * zurueck, damit sein Nachweis eine gueltige Id anfragt statt an der
 * Eingabepruefung zu scheitern und damit gar nichts ueber Rechte zu sagen.
 */
let reiseSnapshotId = "";
const ID_OHNE_SNAPSHOT = "00000000-0000-4000-8000-00000000dead";

/**
 * Die Planwoche der Publish-Reise (EYT-107).
 *
 * Muss zu den Zeitstempeln in `fixtures.sql` passen: `2026-08-03T06:00:00Z`
 * ist in `Europe/Berlin` — der Zeitzone der Reiseorganisation — Montag der
 * ISO-Woche 32. Der Publish-Pfad prueft genau diese Zuordnung; das Schema tut
 * es nicht.
 */
const PLANWOCHE = "2026-W32";

/**
 * Die zweite Planwoche — der Baustellenfilter (EYT-146).
 *
 * EIGENE Woche und eigene Planversion, damit die von EYT-144 abgenommenen
 * Zahlen (`ERWARTETE_KOSTEN_MINOR`, eine Position) unangetastet bleiben. Eine
 * zweite Zuweisung in `PLANWOCHE` haette beide veraendert, und ein Nachweis,
 * der einen abgenommenen umschreibt, ist ein schlechter Nachweis.
 *
 * `2026-08-10T06:00:00Z` ist in `Europe/Berlin` Montag der ISO-Woche 33 — die
 * Zuordnung, die der Publish-Pfad prueft. W33 ist frei: W32 gehoert der Reise,
 * W35 dem Schritt 9c3, W36/W37 den Angriffswochen.
 */
const PLANWOCHE_146 = "2026-W33";
/** Der Entwurf aus `fixtures.sql`, den 9h ueber die echte API veroeffentlicht. */
const ENTWURF_146 = "00000000-0000-4000-8000-00000000e252";
/**
 * Die beiden Baustellen der W33-Version — benannt nach ihrer ROLLE im Nachweis,
 * nicht nach ihrer Reihenfolge.
 *
 * Gefiltert wird auf „E2E-Baustelle Reise" (…e241). „E2E-Baustelle Filter B"
 * (…e242) ist die, die danach nirgends mehr auftauchen darf — im Snapshot
 * nicht, in PostgreSQL nicht und im HTML nicht.
 */
const BAUSTELLE_GEFILTERT = "00000000-0000-4000-8000-00000000e241";
const BAUSTELLE_AUSGESCHLOSSEN = "00000000-0000-4000-8000-00000000e242";
/**
 * Der gefilterte Betrag — von Hand nachgerechnet, wie {@link ERWARTETE_KOSTEN_MINOR}.
 *
 * Die Zuweisung auf …e241 laeuft am 10.08.2026 von 06:00Z bis 10:00Z, in
 * `Europe/Berlin` also 08:00–12:00: vier Stunden an EINEM lokalen Tag. Der
 * Startsatz betraegt 4250 Minor Units; die Abloesung aus 9a beginnt erst am
 * {@link ABLOESE_DATUM}. 4 × 4250 = 17000.
 *
 * Die zweite Zuweisung (…e242, 11:00Z–15:00Z) traegt denselben Betrag. Genau
 * deshalb ist 17000 aussagekraeftig: waere der Filter wirkungslos, stuende hier
 * 34000 — die Zahl faellt also nicht nur bei einem leeren, sondern auch bei
 * einem ungefilterten Ergebnis auf.
 */
const ERWARTETE_FILTER_MINOR = "17000";
const ERWARTETE_FILTER_ANZEIGE = "170,00 EUR";
/**
 * Idempotenzschluessel des EYT-146-Publish.
 *
 * Als Konstante und nicht als Literal im Header — dieselbe gitleaks-Falle wie
 * bei {@link B_PUBLISH_VORGANG}: die Regel `generic-api-key` matcht das Muster
 * `Key": "<wert>"` und meldete den Inline-Wert als Fund.
 */
const PUBLISH_VORGANG_146 = `e2e-publish-${PLANWOCHE_146}`;

/**
 * Idempotenzschluessel des B-Nachweises.
 *
 * Als Konstante und nicht als Literal direkt im Header: gitleaks' Regel
 * `generic-api-key` matcht das Muster `Key": "<wert>"` und meldete den
 * Inline-Wert als Fund (gemessen 03.08.2026, `secret-scan` rot). Der Wert ist
 * kein Geheimnis — aber eine Ausnahme in `.gitleaksignore` waere der falsche
 * Weg: EYT-133 hat den Secret-Guard gerade gegen Dummy- und
 * Ausnahme-Bypaesse gehaertet. Das Muster zu vermeiden ist billiger als es zu
 * erlauben.
 */
const B_PUBLISH_VORGANG = `e2e-b-ohne-recht-${PLANWOCHE}`;

function pflicht(name: string): string {
  const wert = process.env[name];
  if (wert === undefined || wert === "") {
    throw new Error(`[auth-journey] ${name} fehlt — global-setup.ts hat nicht gelaufen?`);
  }
  return wert;
}

/**
 * Die beiden Angriffswochen der Entwurfsschreibflaeche (EYT-136).
 *
 * JE EINE EIGENE, ungenutzte Woche — und ausdruecklich nicht `PLANWOCHE`.
 * Gelaenge ein Angriff gegen die Reisewoche, antwortete der echte Publish in
 * 9d mit „bereits veroeffentlicht": der Lauf waere rot, aber an der falschen
 * Stelle und mit der falschen Begruendung. `2026-W35` gehoert bereits 9c3.
 */
const ANGRIFFSWOCHE_OWNER = "2026-W36";
const ANGRIFFSWOCHE_MEMBER = "2026-W37";

/**
 * Ein ECHTES Zugriffstoken ueber den oeffentlichen GoTrue-Weg (EYT-107, EYT-136).
 *
 * Nicht das HttpOnly-Cookie: das gehoert der API und ist fuer den Browser
 * unlesbar — genau deshalb holt sich ein Angreifer sein Token so. Dieselbe
 * Form, die Schritt 9c2 inline benutzt; hier als Funktion, weil 9c4 und 9c5
 * sie fuer zwei verschiedene Reisende brauchen.
 */
async function bearerKopf(
  request: APIRequestContext,
  supabaseUrl: string,
  anonKey: string,
  email: string,
  passwort: string,
): Promise<Record<string, string>> {
  const anmeldung = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey, "content-type": "application/json" },
    data: { email, password: passwort },
  });
  expect(anmeldung.status(), `GoTrue hat fuer ${email} kein Token ausgegeben`).toBe(200);
  const token = ((await anmeldung.json()) as { access_token?: string }).access_token ?? "";
  expect(token, `das Token fuer ${email} ist leer`).not.toBe("");
  return { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** Ein Lesezugriff ueber die Data-API, der 200 verlangt. */
async function dataApiLese<T>(
  request: APIRequestContext,
  url: string,
  kopf: Record<string, string>,
): Promise<T[]> {
  const antwort = await request.get(url, { headers: kopf });
  expect(antwort.status(), `Data-API-Lesen fehlgeschlagen: ${url}`).toBe(200);
  return (await antwort.json()) as T[];
}

/**
 * Der Fehlerkoerper von PostgREST — `code` ist der durchgereichte SQLSTATE.
 *
 * Er ist das einzige, was von aussen die beiden RIEGEL unterscheidet, die 0017
 * gesetzt hat. GEMESSEN im Lauf 31235882417 (Job 93048155065), alle sechs
 * Versuche mit `code = "42501"` und HTTP 403 — der Status allein unterscheidet
 * also NICHTS:
 *
 *   `with check`-Verletzung (0017 Z. 146-152, Z. 164-172)
 *     message  new row violates row-level security policy for table "assignments"
 *     hint     (leer)
 *
 *   entzogenes Tabellenrecht (0017 Z. 117-118)
 *     message  permission denied for table assignments
 *     hint     Grant the required privileges to the current role with:
 *              GRANT UPDATE ON public.assignments TO authenticated;
 *
 * Der `hint` ist der schaerfste der drei Befunde: PostgREST nennt darin das
 * FEHLENDE Recht beim Namen, also genau das, was 0017 entzogen hat. Deshalb
 * wird er mitgeprueft und nicht nur mitgeschrieben.
 *
 * Ohne diese Unterscheidung koennte ein 403 aus einem DRITTEN Grund kommen und
 * der Nachweis bliebe still gruen — und „welcher Riegel hat gehalten" ist die
 * ganze Aussage von EYT-136.
 */
interface DataApiFehler {
  readonly code: string;
  readonly message: string;
  readonly details: string;
  readonly hint: string;
}

interface Angriffsergebnis {
  readonly status: number;
  readonly koerperLaenge: number;
  readonly zeilen: number;
  /** Der geparste Fehlerkoerper, oder `null` bei einer Erfolgsantwort. */
  readonly fehler: DataApiFehler | null;
}

/** Nimmt nur Zeichenketten an; PostgREST setzt `details`/`hint` oft auf null. */
function alsText(wert: unknown): string {
  return typeof wert === "string" ? wert : "";
}

/**
 * Ein Data-API-SCHREIBversuch, festgehalten statt geraten.
 *
 * Der Koerper wird genau EINMAL gelesen (`text()`) — ein zweiter Zugriff auf
 * denselben `APIResponse` kann fehlschlagen —, und sowohl die Zeilenzahl als
 * auch der Fehlerkoerper entstehen daraus, nicht aus einem zweiten Aufruf.
 *
 * Jeder Versuch schreibt ausserdem eine greppbare Zeile ins CI-Log. Sie ist
 * der Rohbefund, gegen den die Zusicherungen im Aufrufer geschrieben sind: wer
 * sie spaeter aendert, sieht im Log, was gemessen wurde, statt raten zu
 * muessen.
 *
 * Bewusst OHNE Statuszusicherung: die trifft der Aufrufer. `9c2` ist der
 * stehende Gegenbeleg dafuer, dass ein abgewehrter Data-API-Schreibzugriff
 * nicht zwingend einen Fehlerstatus traegt (dort: 200 mit leerer Menge).
 */
async function dataApiSchreibversuch(
  name: string,
  aufruf: Promise<APIResponse>,
): Promise<Angriffsergebnis> {
  const antwort = await aufruf;
  const koerper = await antwort.text();
  let zeilen = 0;
  let fehler: DataApiFehler | null = null;

  if (antwort.ok()) {
    if (koerper !== "") {
      const geparst: unknown = JSON.parse(koerper);
      zeilen = Array.isArray(geparst) ? geparst.length : 1;
    }
  } else if (koerper !== "") {
    // Ein nicht-JSON-Koerper (etwa ein Proxy-Fehler) darf hier NICHT werfen:
    // sonst stuerbe der Fall an der Diagnose statt an der Sache. `fehler`
    // bleibt dann null, und die Zusicherung des Aufrufers auf `code` wird rot
    // — laut, mit dem Rohkoerper im Log.
    try {
      const roh = JSON.parse(koerper) as Record<string, unknown>;
      fehler = {
        code: alsText(roh["code"]),
        message: alsText(roh["message"]),
        details: alsText(roh["details"]),
        hint: alsText(roh["hint"]),
      };
    } catch {
      fehler = null;
    }
  }

  console.log(
    `  [eyt136-riegel] ${name} status=${antwort.status()} laenge=${koerper.length} ` +
      `code=${JSON.stringify(fehler?.code ?? null)} message=${JSON.stringify(fehler?.message ?? koerper.slice(0, 200))}`,
  );

  return { status: antwort.status(), koerperLaenge: koerper.length, zeilen, fehler };
}

/**
 * Welcher der beiden Riegel aus Migration 0017 einen Versuch abgewiesen hat.
 *
 *   `policy`         die `with check`-Klausel — Kanal bzw. Recht fehlt, das
 *                    Spalten- und Tabellenrecht besteht noch
 *   `tabellenrecht`  das Recht selbst ist entzogen; die Anweisung scheitert,
 *                    bevor ueberhaupt eine Zeile ausgewaehlt wird
 */
type Riegel =
  | { readonly art: "policy"; readonly tabelle: string }
  | {
      readonly art: "tabellenrecht";
      readonly tabelle: string;
      readonly recht: "UPDATE" | "DELETE";
    };

/**
 * Verlangt den gemessenen RIEGEL, nicht nur „irgendein 403".
 *
 * Warum das noetig ist: 403 ist die Abbildung von SQLSTATE 42501, und 42501
 * ist mehrdeutig — ein fehlendes Spalten- oder Tabellenrecht liefert ihn
 * ebenso wie eine RLS-Verletzung. Ohne diese Unterscheidung koennte ein 403
 * aus einem DRITTEN Grund kommen (ein Tippfehler im Spaltennamen, ein
 * unbeabsichtigt entzogenes Leserecht) und der Nachweis bliebe still gruen,
 * waehrend die Aussage „der Kanal hat gehalten" gar nicht mehr stimmt.
 *
 * Die erwarteten Zeichenketten sind GEMESSEN (Lauf 31235882417), nicht
 * hergeleitet. Aendert ein PostgreSQL- oder PostgREST-Update sie, wird dieser
 * Waechter rot und nennt den Unterschied — dann gilt die neue Messung, und
 * dieser Kommentar wird mit ihr fortgeschrieben.
 *
 * Die Wirkungskontrollen der Aufrufer (Bestand, `starts_at_utc`, leere Woche)
 * bleiben davon unberuehrt: sie sind kanal- und versionsunabhaengig und der
 * eigentliche Beweis.
 */
function erwarteRiegel(ergebnis: Angriffsergebnis, riegel: Riegel, was: string): void {
  expect(ergebnis.status, `${was}: nicht mit 403 abgewiesen`).toBe(403);
  expect(ergebnis.zeilen, `${was}: PostgREST hat Zeilen zurueckgegeben`).toBe(0);
  expect(ergebnis.fehler?.code, `${was}: nicht SQLSTATE 42501`).toBe("42501");

  if (riegel.art === "policy") {
    expect(
      ergebnis.fehler?.message,
      `${was}: keine RLS-Verletzung — das 403 kommt aus einem anderen Grund`,
    ).toBe(`new row violates row-level security policy for table "${riegel.tabelle}"`);
  } else {
    expect(
      ergebnis.fehler?.message,
      `${was}: kein entzogenes Tabellenrecht — das 403 kommt aus einem anderen Grund`,
    ).toBe(`permission denied for table ${riegel.tabelle}`);
    // PostgREST nennt im `hint` das fehlende Recht. Damit ist nicht nur
    // belegt, DASS ein Recht fehlt, sondern WELCHES — genau das, was 0017
    // Z. 117-118 entzogen hat.
    expect(ergebnis.fehler?.hint, `${was}: der Hinweis nennt nicht das entzogene Recht`).toContain(
      `GRANT ${riegel.recht} ON public.${riegel.tabelle} TO authenticated`,
    );
  }
}

function cookie(cookies: readonly Cookie[], name: string): Cookie {
  const treffer = cookies.find((k) => k.name === name);
  if (treffer === undefined) {
    throw new Error(
      `[auth-journey] Cookie ${name} fehlt. Vorhanden: ${cookies.map((k) => k.name).join(", ")}`,
    );
  }
  return treffer;
}

test.describe.configure({ mode: "serial" });

/**
 * Wo die maschinenlesbaren Zusammenfassungen entstehen — und warum NICHT im
 * Testkoerper.
 *
 * Bis EYT-136 schrieb der letzte Schritt jeder Reise ihre Zusammenfassung und
 * setzte darin `"ergebnis": "PASS"` — als KONSTANTE, im Quelltext. Gemessen im
 * Basislauf 31237004812: die Datei behauptete `"ergebnis": "PASS"`, waehrend 31
 * Zusicherungen gefallen waren. Ein Feld namens „Ergebnis", dessen Wert
 * danebensteht, ist kein Befund — es ist Dekoration in einem Artefakt, das ein
 * Reviewer oeffnet und fuer einen Befund haelt.
 *
 * Berechnen liess es sich im Koerper nicht: `test.info().status` ist dort noch
 * NICHT final (Playwright setzt ihn, wenn der Koerper durch ist), und
 * `test.info().errors` bliebe in dieser Datei immer leer, weil hier keine
 * einzige weiche Zusicherung steht — eine harte bricht ab, statt zu zaehlen.
 * Eine im Koerper berechnete Zahl waere also nur die naechste Konstante
 * gewesen.
 *
 * Also wandert das Schreiben dorthin, wo der Ausgang feststeht: `afterEach`.
 * `ergebnis` ist jetzt gemessen. Zwei Nebenwirkungen, beide erwuenscht:
 *
 *  - Die Zusammenfassung entsteht auch bei einem ROTEN Lauf. Vorher brach der
 *    Koerper vorher ab, die Datei fehlte ganz, und ausgerechnet der
 *    interessanteste Fall hinterliess das duennste Artefakt. Der CI-Schritt
 *    „Screenshots, Zusammenfassung und Traces sichern" laeuft mit
 *    `if: always()` und laedt sie mit hoch.
 *  - `bericht` wird als Referenz hinterlegt, nicht als Kopie: was die Schritte
 *    bis zum Abbruch eingetragen haben, steht drin. Wie weit der Lauf kam, ist
 *    damit ablesbar statt behauptet.
 *
 * Schluessel ist `testId` und nicht der Titel: er bleibt ueber Wiederholungen
 * stabil und geht bei einer Umbenennung nicht still ins Leere.
 */
const ZUSAMMENFASSUNGEN = new Map<
  string,
  { readonly datei: string; readonly bericht: Record<string, unknown> }
>();

test.afterEach(() => {
  const info = test.info();
  const eintrag = ZUSAMMENFASSUNGEN.get(info.testId);
  // Kein Eintrag heisst: dieser Fall ist gar nicht erst gelaufen (im
  // `serial`-Modus faellt jeder Nachfolger eines roten Falles aus). Dann gibt
  // es auch nichts zu protokollieren.
  if (eintrag === undefined) return;
  mkdirSync(ARTEFAKTE, { recursive: true });
  writeFileSync(
    join(ARTEFAKTE, eintrag.datei),
    `${JSON.stringify(
      {
        ...eintrag.bericht,
        ergebnis: info.status ?? "unbekannt",
        erwartetes_ergebnis: info.expectedStatus,
        zusicherungsfehler: info.errors.length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});

test("Reale Auth-Kostenreise vom Login bis zur ungueltigen Sitzung", async ({
  page,
  context,
  request,
}) => {
  const email = pflicht("EASYTREE_JOURNEY_EMAIL_A");
  const passwort = pflicht("EASYTREE_JOURNEY_PASSWORT_A");
  const benutzerId = pflicht("EASYTREE_JOURNEY_USER_A");

  /** Jede API-Anfrage des Browsers — Beleg dafuer, WELCHEN Weg die Daten nahmen. */
  const apiAufrufe: string[] = [];
  page.on("request", (anfrage) => {
    const pfad = new URL(anfrage.url()).pathname;
    if (pfad.startsWith("/api/")) apiAufrufe.push(`${anfrage.method()} ${pfad}`);
  });

  const bericht: Record<string, unknown> = {
    ticket: "EYT-106",
    paket: "B",
    zusatz: "EYT-107 Publish-Durchstich",
    // Lebende Referenz: `afterEach` serialisiert, was bis dahin aufgelaufen ist.
    api_aufrufe: apiAufrufe,
    schritte: {},
  };
  const schritte = bericht["schritte"] as Record<string, unknown>;
  ZUSAMMENFASSUNGEN.set(test.info().testId, { datei: "zusammenfassung.json", bericht });

  /** Serverseitige Ids der Planversion — in 9c gelesen, in 9d verglichen. */
  let entwurfsVersionId = "";
  let veroeffentlichteVersionId = "";

  await test.step("1 — ohne Anmeldung lehnt die API ab", async () => {
    // Notwendig, aber NICHT hinreichend: der Testharness antwortet hier
    // ebenfalls 401 (gemessen). Der unterscheidende Nachweis ist Benutzer B
    // weiter unten.
    const ohneSitzung = await page.request.get("/api/v1/kosten/mitarbeiter");
    expect(ohneSitzung.status()).toBe(401);
    schritte["1_ohne_anmeldung"] = {
      status: ohneSitzung.status(),
      erwartet: 401,
      hinweis: "notwendig, nicht hinreichend — unterscheidet nicht vom Harness",
    };
  });

  await test.step("2 — die echte Loginseite ausfuellen und absenden", async () => {
    await page.goto("/anmelden");
    await expect(page.getByRole("heading", { name: "Anmelden", level: 1 })).toBeVisible();
    await page.getByLabel("E-Mail").fill(email);
    await page.getByLabel("Passwort").fill(passwort);
    await page.getByRole("button", { name: "Anmelden" }).click();
  });

  await test.step("3 — die Anmeldung fuehrt in den Kostenbereich", async () => {
    // `router.push("/kosten")` plus ein NICHT zurueckgesetzter Sitzungszustand:
    // die Seite zeigt kurz den abgemeldeten Banner, bevor `GET /auth/session`
    // antwortet. Deshalb auf den ENDZUSTAND warten, nicht auf Abwesenheit
    // unmittelbar nach dem Klick.
    await page.waitForURL("**/kosten");
    await expect(page.getByRole("heading", { name: "Kosten", level: 1 })).toBeVisible();
    await expect(page.getByTestId("kosten-unauthenticated")).toHaveCount(0);
    // Bis EYT-144 stand hier `kosten-leer` — der Platzhalter der Ansicht, die
    // noch keine Berechnung hatte. Die Ansicht ist jetzt echt; ihr ehrlicher
    // Anfangszustand heisst „noch kein Snapshot gewaehlt". Die Aussage des
    // Schrittes bleibt dieselbe: angemeldet, berechtigt, und OHNE Zahlen.
    await expect(page.getByTestId("kosten-kein-snapshot")).toBeVisible();
    await expect(page.getByLabel("Von Woche")).toBeVisible();
  });

  await test.step("4 — Sicherheitsnachweis: beide Sitzungscookies sind HttpOnly und Strict", async () => {
    const cookies = await context.cookies();
    const access = cookie(cookies, "eyt_access");
    const refresh = cookie(cookies, "eyt_refresh");

    for (const [name, k] of [
      ["eyt_access", access],
      ["eyt_refresh", refresh],
    ] as const) {
      expect(k.httpOnly, `${name} muss HttpOnly sein`).toBe(true);
      expect(k.sameSite, `${name} muss SameSite=Strict tragen`).toBe("Strict");
      expect(k.path).toBe("/");
      // Der Lauf spricht http gegen 127.0.0.1; `Secure` setzt die API
      // ausschliesslich bei NODE_ENV=production (auth.controller.ts). Ein
      // `Secure`-Cookie waere hier NICHT uebertragbar und die Reise scheiterte
      // mit einer irrefuehrenden Meldung. Die production-Seite deckt der
      // Unit-Test von `session-cookies.ts` ab; hier wird die HTTP-Seite
      // ehrlich festgehalten statt eine HTTPS-Behauptung erfunden.
      expect(k.secure, `${name} traegt im HTTP-Modus kein Secure`).toBe(false);
    }
    // Das Access-Cookie laeuft mit dem Token ab, das Refresh-Cookie ist ein
    // Sitzungscookie (kein Max-Age -> expires === -1).
    expect(access.expires).toBeGreaterThan(0);
    expect(refresh.expires).toBe(-1);

    schritte["4_cookies"] = {
      eyt_access: { httpOnly: access.httpOnly, sameSite: access.sameSite, secure: access.secure },
      eyt_refresh: {
        httpOnly: refresh.httpOnly,
        sameSite: refresh.sameSite,
        secure: refresh.secure,
      },
      hinweis: "secure=false ist korrekt: der Lauf spricht http, Secure gilt nur in production.",
    };
  });

  await test.step("5 — der Sitzungsendpunkt kennt genau diesen Benutzer", async () => {
    const antwort = await page.request.get("/api/v1/auth/session");
    expect(antwort.status()).toBe(200);
    const sitzung = (await antwort.json()) as {
      userId: string;
      organisations: { id: string; name: string; role: string; permissions: string[] }[];
    };
    // Der Benutzer, den GoTrue beim Signup angelegt hat — nicht irgendeiner.
    expect(sitzung.userId).toBe(benutzerId);
    expect(sitzung.organisations).toHaveLength(1);
    const org = sitzung.organisations[0]!;
    expect(org.id).toBe(ORG_ID);
    expect(org.name).toBe(ORG_NAME);
    expect(org.role).toBe("owner");
    expect(org.permissions).toContain("costs.read");
    expect(org.permissions).toContain("costs.manage_rates");
    // Kein Token in der Antwort — die Sitzung reist ausschliesslich im Cookie.
    expect(JSON.stringify(sitzung)).not.toContain("eyJ");

    schritte["5_session"] = {
      userId_stimmt: sitzung.userId === benutzerId,
      rolle: org.role,
      rechte: org.permissions,
    };
  });

  await test.step("6 — die Kosten-Navigation ist sichtbar und fuehrt weiter", async () => {
    const kostenLink = page.getByRole("link", { name: "Kosten" });
    await expect(kostenLink).toBeVisible();
    await expect(kostenLink).toHaveAttribute("href", "/kosten");
    // Genau eine Organisation -> kein Auswahlfeld, sondern ihr Name.
    await expect(page.getByText(ORG_NAME)).toBeVisible();
  });

  await test.step("7 — Screenshot der angemeldeten AppShell", async () => {
    mkdirSync(ARTEFAKTE, { recursive: true });
    await page.screenshot({
      path: join(ARTEFAKTE, "01-angemeldete-appshell.png"),
      fullPage: true,
    });
  });

  await test.step("8 — die Mitarbeiterliste kommt ueber den echten API-Pfad", async () => {
    const antwort = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/kosten/mitarbeiter" && r.status() === 200,
    );
    await page.goto("/kosten/stundensaetze");
    await antwort;

    await expect(page.getByRole("heading", { name: "Stundensätze", level: 1 })).toBeVisible();
    const auswahl = page.getByLabel("Mitarbeiter auswählen");
    await expect(auswahl).toBeVisible();
    await expect(auswahl.getByRole("option", { name: MITARBEITER_NAME })).toHaveCount(1);

    // Nicht nur "es steht da", sondern "es kam von dort": der Aufruf ist im
    // Netzwerkprotokoll dieses Browsers belegt.
    expect(apiAufrufe).toContain("GET /api/v1/kosten/mitarbeiter");
  });

  await test.step("9 — die Stundensatzhistorie zeigt die echte Satzversion", async () => {
    const antwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/kosten/stundensaetze/${MITARBEITER_ID}` &&
        r.status() === 200,
    );
    await page.getByLabel("Mitarbeiter auswählen").selectOption({ label: MITARBEITER_NAME });
    await antwort;

    const tabelle = page.getByTestId("satzhistorie");
    await expect(tabelle).toBeVisible();
    await expect(tabelle.getByText(ERWARTETER_BETRAG)).toBeVisible();
    await expect(tabelle.getByText("Startsatz der E2E-Reise")).toBeVisible();
    // Genau eine Version, und sie ist aktiv.
    await expect(tabelle.locator("tbody tr")).toHaveCount(1);
    await expect(tabelle.getByText("aktiv")).toBeVisible();

    mkdirSync(ARTEFAKTE, { recursive: true });
    await page.screenshot({
      path: join(ARTEFAKTE, "02-stundensatzverwaltung.png"),
      fullPage: true,
    });
    schritte["9_historie"] = { betrag: ERWARTETER_BETRAG, zeilen: 1 };
  });

  await test.step("9a — eine neue Satzversion loest die offene ab (EYT-108)", async () => {
    // Der Kern von EYT-108, ueber die ECHTE Oberflaeche: kein direkter
    // Datenbankschreibzugriff, keine Fixtur, kein Repository-Stub. Was hier
    // passiert, passiert genau so auch fuer einen Menschen.
    const angelegt = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/stundensaetze" &&
        r.request().method() === "POST",
    );
    await page.getByLabel("Betrag (EUR pro Stunde)").fill("48,00");
    await page.getByLabel("Gültig ab").fill(ABLOESE_DATUM);
    await page.getByLabel("Änderungsgrund").fill(ABLOESE_GRUND);
    await page.getByRole("button", { name: "Neue Satzversion anlegen" }).click();
    const antwort = await angelegt;
    expect(antwort.status()).toBe(201);

    const tabelle = page.getByTestId("satzhistorie");
    // Jetzt ZWEI Versionen: der Vorgaenger ist geschlossen, der Nachfolger
    // verweist sichtbar auf ihn.
    await expect(tabelle.locator("tbody tr")).toHaveCount(2);
    await expect(tabelle.getByText(`ersetzt Version vom 2026-01-01`)).toBeVisible();
    await expect(tabelle.getByText("2026-01-01").first()).toBeVisible();
    await expect(tabelle.getByText(ABLOESE_GRUND)).toBeVisible();

    await page.screenshot({
      path: join(ARTEFAKTE, "03-satzabloesung.png"),
      fullPage: true,
    });
    schritte["9a_abloesung"] = { zeilen: 2, status: antwort.status() };
  });

  await test.step("9b — Reload und ein ZWEITER Browserkontext zeigen denselben Stand", async () => {
    // Reload beweist Persistenz gegen den lokalen Komponentenzustand.
    await page.reload();
    await page.getByLabel("Mitarbeiter auswählen").selectOption({ label: MITARBEITER_NAME });
    await expect(page.getByTestId("satzhistorie").locator("tbody tr")).toHaveCount(2);

    // Der zweite Kontext hat eigene Cookies und einen eigenen Speicher. Er
    // beweist, dass der Zustand im Server liegt und nicht im Browser des
    // Bearbeiters — ein Reload allein koennte aus einem Cache kommen.
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));
      await seite2.goto("/kosten/stundensaetze");
      await seite2.getByLabel("Mitarbeiter auswählen").selectOption({ label: MITARBEITER_NAME });
      const tabelle2 = seite2.getByTestId("satzhistorie");
      await expect(tabelle2.locator("tbody tr")).toHaveCount(2);
      await expect(tabelle2.getByText(ABLOESE_GRUND)).toBeVisible();
      schritte["9b_zweiter_kontext"] = { zeilen: 2 };
    } finally {
      await zweiter.close();
    }
  });

  // ---------------------------------------------------------------------
  // 9c/9d — Der Publish-Durchstich (EYT-107)
  // ---------------------------------------------------------------------
  // Warum HIER und nicht im read-through-Harness: dieser Lauf faehrt die echte
  // `dist/main.js` mit echter GoTrue-Anmeldung und echten HttpOnly-Cookies.
  // Der Harness ersetzt `REQUEST_IDENTITY` und koennte deshalb ueber die
  // Identitaet nichts aussagen — er bewiese nur den Pfad dahinter.
  await test.step("9c — die Planungswoche zeigt einen Entwurf", async () => {
    await page.goto(`/planung?weekKey=${PLANWOCHE}`);

    // Der Waechter gibt nur mit `planning.read` frei; A ist owner und traegt
    // es seit Migration 0015.
    const stand = page.getByTestId("planungsfenster-stand");
    await expect(stand).toBeVisible();
    await expect(stand).toHaveAttribute("data-stand", "entwurf");

    // Die serverseitige Entwurfs-Id — sie geht gleich als
    // `expectedVersionId` hinaus.
    const version = page.getByTestId("planungsfenster-version");
    entwurfsVersionId = (await version.getAttribute("data-source-version-id")) ?? "";
    expect(entwurfsVersionId).not.toBe("");
    await expect(version).toHaveAttribute("data-published-version-id", "");

    await page.screenshot({
      path: join(ARTEFAKTE, "04-planung-entwurf.png"),
      fullPage: true,
    });
    schritte["9c_entwurf"] = { versionId: entwurfsVersionId };
  });

  // ---------------------------------------------------------------------
  // 9c2 — Der P1-Nachweis: die Data-API veroeffentlicht NICHT (EYT-107)
  // ---------------------------------------------------------------------
  // Der Befund vom 04.08.2026: `authenticated` besass aus Migration 0007 ein
  // Tabellen-UPDATE auf `plan_versions` ohne Spaltenbegrenzung, und PostgREST
  // stellt `public` als Data-API bereit. Eine Owner-Rolle konnte damit
  // `published_at` unmittelbar setzen — am Command vorbei, also ohne
  // Wochenzuordnungspruefung, ohne benannte Konflikte, ohne Idempotenz, ohne
  // Audit und ohne Outbox.
  //
  // Dies ist die EINZIGE Stelle im Repository, die den echten Angriffskanal
  // faehrt: ein per GoTrue angemeldeter Mensch, sein echtes Bearer-Token, die
  // echte PostgREST-Instanz. pgTAP kann das nicht — dort ist `session_user`
  // `postgres` und laesst sich ohne Superuser nicht wechseln.
  await test.step("9c2 — ein direkter PostgREST-Schreibzugriff bewirkt nichts", async () => {
    const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
    const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");

    // Ein ECHTES Zugriffstoken, ueber denselben oeffentlichen Weg wie ein
    // Mensch. Nicht das HttpOnly-Cookie: das gehoert der API und ist fuer den
    // Browser unlesbar — genau deshalb holt sich ein Angreifer sein Token so.
    const anmeldung = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: { apikey: anonKey, "content-type": "application/json" },
      data: { email, password: passwort },
    });
    expect(anmeldung.status(), "GoTrue hat kein Token ausgegeben").toBe(200);
    const token = ((await anmeldung.json()) as { access_token?: string }).access_token ?? "";
    expect(token).not.toBe("");

    const restKopf = {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    // ZUERST die Nichtvakuositaet: dasselbe Token SIEHT die Zeile ueber
    // PostgREST. Ohne diesen Schritt bewiese ein fehlgeschlagenes PATCH nur,
    // dass irgendetwas an der Anfrage nicht stimmt — ein abgelaufenes Token,
    // ein falscher Pfad, eine nicht exponierte Tabelle. So ist belegt: der
    // Kanal traegt, nur das Schreiben nicht.
    const lesen = await request.get(
      `${supabaseUrl}/rest/v1/plan_versions?id=eq.${entwurfsVersionId}&select=id,published_at`,
      { headers: restKopf },
    );
    expect(lesen.status(), "das Token kann die Planversion nicht einmal lesen").toBe(200);
    const gelesen = (await lesen.json()) as { id: string; published_at: string | null }[];
    expect(gelesen).toHaveLength(1);
    expect(gelesen[0]?.published_at, "die Version ist vor dem Versuch kein Entwurf").toBeNull();

    // Der Angriff.
    const angriff = await request.patch(
      `${supabaseUrl}/rest/v1/plan_versions?id=eq.${entwurfsVersionId}`,
      {
        headers: { ...restKopf, prefer: "return=representation" },
        data: { published_at: "2026-08-03T09:00:00Z", published_by: benutzerId },
      },
    );
    const geaendert = angriff.ok() ? ((await angriff.json()) as unknown[]) : [];

    // HIER wird bewusst KEIN Fehlerstatus behauptet. Gemessen im gruenen Lauf
    // 30875136833 antwortet PostgREST mit **200** und einer leeren
    // Repraesentation: die `using`-Klausel der Update-Policy filtert die Zeile
    // aus dem Statement heraus, und ein UPDATE ueber null Zeilen ist fuer
    // PostgreSQL kein Fehler. Es gibt nichts zu melden — also meldet PostgREST
    // Erfolg ueber die leere Menge.
    //
    // Eine Assertion auf einen Nicht-2xx-Status waere hier deshalb falsch und
    // wuerde diesen Nachweis rot machen, obwohl der Angriff scheitert. Der
    // Wirkungsnachweis ist die leere Menge plus der Nachlauf ueber die
    // Anwendung. Beim INSERT in 9c3 liegt es anders — dort wirft PostgreSQL,
    // und dort steht der Status auch in der Zusicherung.
    expect(
      geaendert,
      "PostgREST hat eine Planversion veroeffentlicht — der Command ist umgehbar",
    ).toHaveLength(0);

    // Und die Wahrheit noch einmal aus der Anwendung, nicht aus der Antwort
    // des Angreifers: die Woche ist weiterhin Entwurf. Waere `published_at`
    // gesetzt worden, haette der Sync-Trigger aus 0010 in derselben
    // Transaktion auch die Zuweisungen gestempelt — und Schritt 9d wuerde
    // gleich „bereits veroeffentlicht" melden statt zu veroeffentlichen.
    await page.reload();
    const standDanach = page.getByTestId("planungsfenster-stand");
    await expect(standDanach).toHaveAttribute("data-stand", "entwurf");
    await expect(page.getByTestId("planungsfenster-version")).toHaveAttribute(
      "data-published-version-id",
      "",
    );

    schritte["9c2_postgrest_bypass"] = {
      lesen: lesen.status(),
      schreiben: angriff.status(),
      geaenderteZeilen: geaendert.length,
      erwartet: 0,
      hinweis: "P1 04.08.2026 — app.is_runtime_channel() in Migration 0015",
    };

    // -----------------------------------------------------------------------
    // 9c3 — dieselbe Tuer, nur andersherum: INSERT statt UPDATE (Befund F1)
    // -----------------------------------------------------------------------
    // Das Selbstreview der P1-Korrektur fand die zweite Tuer. Das UPDATE war
    // abgedichtet, das ANLEGEN nicht: `authenticated` durfte `published_at`
    // mitgeben, und keiner der beiden Trigger auf plan_versions feuert bei
    // INSERT. Eine so geborene Planversion waere sofort veroeffentlicht,
    // unveraenderlich und unloeschbar gewesen — ohne Wochenzuordnungspruefung,
    // ohne Konflikte, ohne Idempotenz, ohne Audit, ohne Outbox.
    //
    // EIGENE Woche, nicht die der Reise: der Entwurf aus 9c soll unberuehrt
    // bleiben, damit 9d weiterhin den echten Uebergang misst. Waere die
    // Angriffswoche dieselbe, wuerde ein erfolgreicher Angriff den Publish in
    // 9d mit „bereits veroeffentlicht" beantworten — der Fall waere rot, aber
    // an der falschen Stelle und mit der falschen Begruendung.
    const ANGRIFFSWOCHE = "2026-W35";
    const anlegen = await request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
      headers: { ...restKopf, prefer: "return=representation" },
      data: {
        org_id: ORG_ID,
        week_key: ANGRIFFSWOCHE,
        published_at: "2026-08-24T09:00:00Z",
        published_by: benutzerId,
      },
    });
    const angelegt = anlegen.ok() ? ((await anlegen.json()) as unknown[]) : [];

    // ANDERS als beim UPDATE in 9c2 wirft PostgreSQL hier: das Spaltenrecht auf
    // `published_at` fehlt (0016), das ist SQLSTATE 42501, und PostgREST bildet
    // 42501 auf HTTP 403 ab. Gemessen im gruenen Lauf 30875136833:
    // `schritte["9c3_postgrest_insert"].status = 403`.
    //
    // 403 und nicht 401: der Reisende IST angemeldet, sein Token ist gueltig,
    // und derselbe Kopf hat in 9c2 erfolgreich gelesen. Verboten ist die
    // Handlung, nicht die Identitaet.
    //
    // Der Status ist stabil, nicht zufaellig: faellt der Spalten-Grant weg,
    // greift die Insert-Policy — eine `with check`-Verletzung ist ebenfalls
    // 42501 und ebenfalls 403 (gemessen in GM-F1a, Lauf 30874279915: dieser
    // Nachweis blieb gruen, rot wurde allein die Katalogaussage in pgTAP).
    // Erst wenn BEIDE Riegel fallen, antwortet PostgREST mit einem
    // Erfolgsstatus und einer angelegten Zeile — gemessen in GM-F1a+F1b,
    // Lauf 30874546740: „Received length: 1".
    expect(anlegen.status(), "der blockierte INSERT wurde nicht mit 403 abgewiesen").toBe(403);

    expect(
      angelegt,
      "PostgREST hat eine bereits veroeffentlichte Planversion angelegt",
    ).toHaveLength(0);

    // Und nachgesehen, nicht geglaubt: fuer diese Woche existiert gar keine
    // Zeile. Ein `insert`, der nur `published_at` verliert und als Entwurf
    // durchginge, waere ebenfalls ein Befund — die Woche gehoert niemandem,
    // der sie nicht ueber die Anwendung angelegt hat.
    const nachsehen = await request.get(
      `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE}&select=id,published_at`,
      { headers: restKopf },
    );
    expect(nachsehen.status()).toBe(200);
    expect((await nachsehen.json()) as unknown[]).toHaveLength(0);

    schritte["9c3_postgrest_insert"] = {
      status: anlegen.status(),
      angelegteZeilen: angelegt.length,
      erwartet: 0,
      erwarteterStatus: 403,
      hinweis: "F1 04.08.2026 — Spalten-Grant und published_at is null in 0016",
    };
  });

  // ---------------------------------------------------------------------
  // 9c4/9c5 — Die ENTWURFSschreibflaeche der Data-API (EYT-136)
  // ---------------------------------------------------------------------
  // 9c2 und 9c3 messen das VEROEFFENTLICHEN. Der Entwurf blieb offen: bis
  // Migration 0017 konnte ein aktives Mitglied ueber PostgREST
  //
  //   POST   /rest/v1/assignments         Entwurfszuweisung anlegen
  //   PATCH  /rest/v1/assignments?id=eq.  Zuweisung verschieben
  //   DELETE /rest/v1/assignments?…       Entwurfsstand loeschen
  //   POST   /rest/v1/plan_versions       Entwurfs-Planversion anlegen
  //
  // senden. Der `published_at is null`-Riegel aus 0016 half dabei NICHT — ein
  // Entwurf erfuellt ihn ja gerade. Umgangen wurden damit das atomare Recht
  // `planning.write`, die Intervall- und Konfliktvalidierung, die
  // Wochenzugehoerigkeit (`OUTSIDE_WEEK`), die Advisory-Lock-Serialisierung,
  // der Idempotenzdatensatz, das Audit-Ereignis, die Outbox und die
  // Korrelations-Id.
  //
  // ZWEI Reisende, weil einer nichts unterscheidet:
  //
  //   9c4  Owner MIT `planning.write`  -> beweist den KANAL-Riegel
  //   9c5  member OHNE `planning.write` -> beweist den RECHTE-Riegel und den
  //                                        vollstaendigen Entzug von update/delete
  //
  // Ohne 9c4 bewiese der Nachweis nur „wer nichts darf, darf nichts". Ohne 9c5
  // bliebe offen, ob `planning.write` ueberhaupt gilt.
  //
  // VOR 9d, und das ist tragend: nach dem Veroeffentlichen wuerde zusaetzlich
  // `app.reject_published_row_change()` aus 0010 ablehnen, und es waere nicht
  // mehr entscheidbar, welcher Riegel gehalten hat.
  await test.step("9c4 — der Owner MIT planning.write schreibt ueber die Data-API nicht", async () => {
    const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
    const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");
    const kopf = await bearerKopf(request, supabaseUrl, anonKey, email, passwort);

    const zuweisungenUrl = `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id,starts_at_utc,ends_at_utc`;

    // Nichtvakuositaet 1 — der Kanal TRAEGT. Dasselbe Token liest die
    // Zuweisungen der Organisation ueber PostgREST. Ohne diese Messung bewiese
    // ein abgelehnter Schreibzugriff nur, dass irgendetwas an der Anfrage nicht
    // stimmt: ein abgelaufenes Token, ein falscher Pfad, eine nicht exponierte
    // Tabelle.
    const zuweisungenVorher = await dataApiLese<{ id: string; starts_at_utc: string }>(
      request,
      zuweisungenUrl,
      kopf,
    );
    expect(
      zuweisungenVorher.length,
      "der Owner sieht ueber die Data-API keine einzige Zuweisung — der Kanal traegt nicht",
    ).toBeGreaterThanOrEqual(1);

    // Nichtvakuositaet 2 — A traegt `planning.write` WIRKLICH, gemessen ueber
    // SEIN EIGENES Token. `app.has_permission` liegt im Schema `app` und ist
    // ueber PostgREST nicht als RPC erreichbar (supabase/config.toml exponiert
    // nur `public` und `graphql_public`). Was hier steht, ist stattdessen exakt
    // der Rumpf jener Funktion, aus zwei Lesezugriffen zusammengesetzt:
    // `memberships` (Policy `memberships_select_own` gibt nur die EIGENE Zeile
    // frei) join `role_permissions`.
    const mitgliedschaftA = await dataApiLese<{ org_id: string; role: string; active: boolean }>(
      request,
      `${supabaseUrl}/rest/v1/memberships?select=org_id,role,active`,
      kopf,
    );
    expect(mitgliedschaftA).toHaveLength(1);
    expect(mitgliedschaftA[0]?.org_id).toBe(ORG_ID);
    expect(mitgliedschaftA[0]?.role).toBe("owner");
    expect(mitgliedschaftA[0]?.active).toBe(true);

    const ownerRecht = await dataApiLese<{ role: string; permission: string }>(
      request,
      `${supabaseUrl}/rest/v1/role_permissions?role=eq.owner&permission=eq.planning.write&select=role,permission`,
      kopf,
    );
    expect(
      ownerRecht,
      "der Owner traegt planning.write nicht — der Kanalnachweis waere vakuos",
    ).toHaveLength(1);
    // Diese beiden Lesezugriffe SIND `app.has_permission` — dieselbe
    // Mitgliedschaft, dieselbe Rollenzuordnung, nur ueber As eigenes Token
    // statt ueber die Funktion. Die Funktion selbst wird ebenfalls befragt,
    // aber erst gleich in 9c5: `eyt136-member-an.sql` misst sie fuer BEIDE
    // Reisenden ueber die Verwaltungsverbindung und verlangt
    // `a_has_permission=t`. Hier fehlt sie also nicht, sie kommt spaeter.

    // Nichtvakuositaet 3 — die Angriffswoche ist VORHER leer. Die Kontrolle
    // danach (`toHaveLength(0)`) ist zwar strenger und kann nicht falsch gruen
    // werden; eine vorbestehende Zeile ergaebe aber ein Rot mit falscher
    // Begruendung.
    const wocheUrlOwner = `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE_OWNER}&select=id`;
    expect(
      await dataApiLese<{ id: string }>(request, wocheUrlOwner, kopf),
      `${ANGRIFFSWOCHE_OWNER} ist vor dem Angriff nicht leer`,
    ).toHaveLength(0);

    /**
     * Beide Wirkungen nach JEDEM Angriff, nicht einmal netto am Ende.
     *
     * Der Grund ist in 9c5 GEMESSEN worden (Basislauf 31237004812): dort stand
     * genau eine Netto-Bestandskontrolle am Ende, sie meldete
     * `bestand_vorher: 2, bestand_danach: 2` und blieb gruen — waehrend ein
     * INSERT eine Zeile anlegte (+1) und ein DELETE die Zielzeile entfernte
     * (-1). Wirkungen, die sich aufheben, besiegen jede Netto-Zahl.
     *
     * 9c4 pruefte schon vorher nach jedem Angriff, aber je nur die EINE
     * Wirkung, die dieser Angriff plausibel haben konnte. Diese Regel muss ein
     * Leser jedes Mal neu herleiten und veraltet still, sobald ein Angriff
     * hinzukommt. Hier gilt jetzt die einfache Regel: nach jedem Angriff steht
     * BEIDES fest. Wer diese Aufrufe an das Ende verschiebt, stellt genau den
     * Zustand wieder her, der im Basislauf gruen log.
     */
    const wirkungOwner = async (was: string): Promise<number> => {
      const bestand = (await dataApiLese<{ id: string }>(request, zuweisungenUrl, kopf)).length;
      expect(
        bestand,
        `${was}: der Zuweisungsbestand hat sich veraendert — ein Schreibzugriff ist durchgegangen`,
      ).toBe(zuweisungenVorher.length);
      expect(
        await dataApiLese<{ id: string }>(request, wocheUrlOwner, kopf),
        `${was}: ${ANGRIFFSWOCHE_OWNER} traegt jetzt eine Planversion — die Woche gehoert niemandem`,
      ).toHaveLength(0);
      return bestand;
    };

    // Angriff 1 — eine Entwurfszuweisung in die ECHTE Planversion der Reise.
    // Dienstag derselben Woche, bewusst OHNE Ueberlappung mit der Fixtur: ein
    // Konflikt mit `assignments_no_published_overlap` liesse den Versuch
    // scheitern, ohne dass die Kanalgrenze etwas dazu beitraege — der Nachweis
    // waere gruen und wuerde den falschen Riegel messen.
    //
    // Die Nutzlast traegt EXAKT die sechs Spalten, die 0017 noch grantet
    // (Z. 138-139) — `id` ist NICHT dabei. Das ist tragend: waere auch nur eine
    // ungegrantete Spalte im Koerper, koennte das 403 aus dem fehlenden
    // Spaltenrecht stammen, und 9c4 waere ein Grant-Nachweis statt eines
    // KANAL-Nachweises. Nichts hier hinzufuegen.
    const insertZuweisung = await dataApiSchreibversuch(
      "9c4/assignments-insert",
      request.post(`${supabaseUrl}/rest/v1/assignments`, {
        headers: { ...kopf, prefer: "return=representation" },
        data: {
          org_id: ORG_ID,
          plan_version_id: entwurfsVersionId,
          employee_id: MITARBEITER_ID,
          worksite_id: BAUSTELLE_ID,
          starts_at_utc: "2026-08-04T06:00:00Z",
          ends_at_utc: "2026-08-04T14:00:00Z",
        },
      }),
    );
    // GEMESSEN (Lauf 31235882417): 403, SQLSTATE 42501, „new row violates
    // row-level security policy for table \"assignments\"". Das ist der
    // `with check`-Riegel und NICHT das Spaltenrecht — die sechs gesendeten
    // Spalten sind alle gegrantet (0017 Z. 138-139). Genau deshalb ist dieser
    // Schritt ein KANAL-Nachweis: A traegt `planning.write`, die Organisation
    // stimmt, uebrig bleibt `app.is_runtime_channel()`.
    erwarteRiegel(
      insertZuweisung,
      { art: "policy", tabelle: "assignments" },
      "9c4 INSERT assignments",
    );

    const bestandNachZuweisung = await wirkungOwner("9c4 nach INSERT assignments");

    // Angriff 2 — eine ENTWURFS-Planversion, ganz ohne `published_at`. Genau
    // die Form, die 0016 noch durchliess. Auch hier exakt die gegranteten
    // Spalten `(org_id, week_key)` aus 0017 Z. 160, ohne `id`.
    const insertVersion = await dataApiSchreibversuch(
      "9c4/plan_versions-insert",
      request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
        headers: { ...kopf, prefer: "return=representation" },
        data: { org_id: ORG_ID, week_key: ANGRIFFSWOCHE_OWNER },
      }),
    );
    erwarteRiegel(
      insertVersion,
      { art: "policy", tabelle: "plan_versions" },
      "9c4 INSERT plan_versions",
    );

    const bestandNachVersion = await wirkungOwner("9c4 nach INSERT plan_versions");

    schritte["9c4_owner_entwurfsschreiben"] = {
      rolle: "owner",
      hat_planning_write: ownerRecht.length === 1,
      lesen_traegt: zuweisungenVorher.length,
      assignments_insert: {
        status: insertZuweisung.status,
        koerperLaenge: insertZuweisung.koerperLaenge,
        angelegteZeilen: insertZuweisung.zeilen,
        erwarteterStatus: 403,
        fehler: insertZuweisung.fehler,
      },
      plan_versions_insert_entwurf: {
        status: insertVersion.status,
        koerperLaenge: insertVersion.koerperLaenge,
        angelegteZeilen: insertVersion.zeilen,
        erwarteterStatus: 403,
        woche: ANGRIFFSWOCHE_OWNER,
        fehler: insertVersion.fehler,
      },
      // Je Angriff eine eigene Momentaufnahme, nicht eine Netto-Zahl am Ende:
      // siehe die Begruendung an `wirkungOwner` (Basislauf 31237004812).
      bestand_je_angriff: {
        nach_assignments_insert: bestandNachZuweisung,
        nach_plan_versions_insert: bestandNachVersion,
      },
      zuweisungen_unveraendert: bestandNachVersion === zuweisungenVorher.length,
      hinweis: "EYT-136 — app.is_runtime_channel() in den Insert-Policies von 0017",
    };
  });

  await test.step("9c5 — ein member OHNE planning.write erreicht die Zuweisungen nicht", async () => {
    const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
    const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");
    const emailB = pflicht("EASYTREE_JOURNEY_EMAIL_B");
    const passwortB = pflicht("EASYTREE_JOURNEY_PASSWORT_B");
    const idB = pflicht("EASYTREE_JOURNEY_USER_B");
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    // `catch` statt `finally`: ein `throw` im `finally` verwuerfe einen bereits
    // laufenden Fehler aus dem Fall — genau deshalb verbietet
    // `no-unsafe-finally` ihn. Eingefangen laeuft die Rueckgabe auf JEDEM Weg.
    // Der Fehler liegt im Tupel, damit „kein Fehler" von „hat null geworfen"
    // unterscheidbar bleibt.
    let fehlerAusFall: [unknown] | null = null;
    try {
      // Die Leihgabe: B bekommt fuer GENAU diesen Schritt eine aktive
      // `member`-Mitgliedschaft. Kein neuer Benutzer — `auth.users` bleibt
      // unberuehrt (PO-Vorgabe 08.08.2026), beide Reisenden stammen aus dem
      // echten GoTrue-Signup. `psqlMitMarker` wirft, wenn die Markerzeile fehlt
      // oder psql einen Fehler meldet; das ist der Lesenachweis nach dem
      // Schreiben.
      //
      // Dieser Aufruf steht INNERHALB des `try`, und das ist kein Stilentscheid:
      // `eyt136-member-an.sql` committet die Zeile und prueft ihre
      // Nachbedingung DANACH. Wirft die Nachbedingung, ist die Mitgliedschaft
      // bereits geschrieben — stuende der Aufruf davor, liefe die Rueckgabe
      // unten nie und die Leihgabe ueberlebte auf genau dem Weg, fuer den
      // `eyt136-member-aus.sql` geschrieben wurde.
      const an = psqlMitMarker(
        verwaltung,
        join(HIER, "eyt136-member-an.sql"),
        ["-v", `benutzer_a=${benutzerId}`, "-v", `benutzer_b=${idB}`],
        "[eyt136-member-an]",
      );
      console.log(`  ${an}`);

      const kopfB = await bearerKopf(request, supabaseUrl, anonKey, emailB, passwortB);

      // Vorbedingung 1 — das Token traegt, und die Leihgabe wirkt: B liest
      // seine EIGENE Mitgliedszeile (Policy `memberships_select_own`).
      const mitgliedschaftB = await dataApiLese<{
        org_id: string;
        role: string;
        active: boolean;
      }>(request, `${supabaseUrl}/rest/v1/memberships?select=org_id,role,active`, kopfB);
      expect(mitgliedschaftB, "B sieht seine geliehene Mitgliedschaft nicht").toHaveLength(1);
      expect(mitgliedschaftB[0]?.org_id).toBe(ORG_ID);
      expect(mitgliedschaftB[0]?.role).toBe("member");
      expect(mitgliedschaftB[0]?.active).toBe(true);

      // Vorbedingung 2 — `member` traegt `planning.write` NICHT. Zusammen mit
      // Vorbedingung 1 ist das exakt der Rumpf von `app.has_permission`, ueber
      // Bs eigenes Token gemessen. `role_permissions` ist fuer jeden
      // Angemeldeten lesbar (`using (true)`, Migration 0013).
      const memberRecht = await dataApiLese<{ role: string; permission: string }>(
        request,
        `${supabaseUrl}/rest/v1/role_permissions?role=eq.member&permission=eq.planning.write&select=role,permission`,
        kopfB,
      );
      expect(
        memberRecht,
        "member traegt planning.write — der Rechtenachweis waere vakuos",
      ).toHaveLength(0);

      // Vorbedingung 3 — die ZIELZEILE von PATCH und DELETE ist fuer B
      // sichtbar. Ohne sie bewiese eine abgelehnte Aenderung nur, dass die
      // Zeile fuer ihn gar nicht existiert; die `using`-Klausel haette dann
      // gefiltert und nicht das fehlende Recht.
      const zielUrl = `${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}&select=id,starts_at_utc,ends_at_utc`;
      const zielVorher = await dataApiLese<{
        id: string;
        starts_at_utc: string;
        ends_at_utc: string;
      }>(request, zielUrl, kopfB);
      expect(zielVorher, "die Zielzeile ist fuer den member nicht sichtbar").toHaveLength(1);
      const startVorher = zielVorher[0]?.starts_at_utc ?? "";
      expect(startVorher).not.toBe("");

      const bestandUrl = `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id`;
      const bestandVorher = (await dataApiLese<{ id: string }>(request, bestandUrl, kopfB)).length;
      expect(bestandVorher).toBeGreaterThanOrEqual(1);

      // Vorbedingung 4 — die Angriffswoche ist VORHER leer (dieselbe
      // Begruendung wie in 9c4: die Nachkontrolle koennte nicht falsch gruen
      // werden, wohl aber falsch rot).
      const wocheUrlMember = `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE_MEMBER}&select=id`;
      expect(
        await dataApiLese<{ id: string }>(request, wocheUrlMember, kopfB),
        `${ANGRIFFSWOCHE_MEMBER} ist vor dem Angriff nicht leer`,
      ).toHaveLength(0);

      /**
       * Die Wirkung nach JEDEM einzelnen Angriff — der Kern des Befunds vom
       * 08.08.2026.
       *
       * GEMESSEN, nicht befuerchtet. Der Basislauf 31237004812 fuhr genau diese
       * vier Angriffe gegen den Code OHNE Migration 0017; drei davon gingen
       * durch. Im Artefakt stand trotzdem
       *
       *     "bestand_vorher": 2,
       *     "bestand_danach": 2
       *
       * und die zugehoerige Zusicherung war GRUEN. Der Grund: das INSERT des
       * members legte eine Zeile an (+1), sein DELETE entfernte die Zielzeile
       * (-1), und die EINE Netto-Kontrolle am Ende sah eine unveraenderte Zahl.
       * Rot wurden damals nur `zielDanach` (Zielzeile verschwunden) und der
       * `starts_at_utc`-Vergleich — die stehen unten unveraendert weiter, sie
       * sind der Grund, dass der Basislauf ueberhaupt aufflog.
       *
       * Mit einer Momentaufnahme nach jedem einzelnen Angriff kann sich keine
       * Wirkung mehr gegen eine spaetere aufheben: das INSERT faellt auf, BEVOR
       * das DELETE es maskieren kann.
       *
       * Beide Wirkungen werden nach jedem Angriff geprueft, auch wo eine davon
       * nicht betroffen sein KANN (ein PATCH aendert keine Zeilenzahl). Die
       * Regel „nach jedem Angriff steht beides fest" ist pruefbar; die Regel
       * „nach jedem Angriff steht das fest, was er plausibel beruehrt" muesste
       * ein Leser jedes Mal neu herleiten und veraltet still.
       */
      const bestandNach = async (was: string): Promise<number> => {
        const jetzt = (await dataApiLese<{ id: string }>(request, bestandUrl, kopfB)).length;
        expect(
          jetzt,
          `${was}: der Zuweisungsbestand hat sich veraendert — INSERT oder DELETE ist durchgegangen`,
        ).toBe(bestandVorher);
        return jetzt;
      };
      const zielNach = async (was: string): Promise<string> => {
        const zeile = await dataApiLese<{ id: string; starts_at_utc: string }>(
          request,
          zielUrl,
          kopfB,
        );
        expect(
          zeile,
          `${was}: die Zielzeile ist verschwunden — DELETE ist durchgegangen`,
        ).toHaveLength(1);
        expect(
          zeile[0]?.starts_at_utc,
          `${was}: die Zielzeile wurde verschoben — PATCH ist durchgegangen`,
        ).toBe(startVorher);
        return zeile[0]?.starts_at_utc ?? "";
      };

      // Angriff 1 — anlegen. Spaltenrechte bestehen (dieselben sechs Spalten
      // wie in 9c4, ohne `id`), es scheitert die `with check`-Klausel: hier
      // fehlen Kanal UND Recht.
      const insertZuweisung = await dataApiSchreibversuch(
        "9c5/assignments-insert",
        request.post(`${supabaseUrl}/rest/v1/assignments`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: {
            org_id: ORG_ID,
            plan_version_id: entwurfsVersionId,
            employee_id: MITARBEITER_ID,
            worksite_id: BAUSTELLE_ID,
            starts_at_utc: "2026-08-05T06:00:00Z",
            ends_at_utc: "2026-08-05T14:00:00Z",
          },
        }),
      );
      erwarteRiegel(
        insertZuweisung,
        { art: "policy", tabelle: "assignments" },
        "9c5 INSERT assignments",
      );
      // HIER, unmittelbar nach dem INSERT, faellt der Basislauf-Fehlbefund auf:
      // die angelegte Zeile ist jetzt sichtbar, das spaetere DELETE kann sie
      // nicht mehr maskieren.
      const bestandNachInsert = await bestandNach("9c5 nach INSERT assignments");
      const startNachInsert = await zielNach("9c5 nach INSERT assignments");

      // Angriff 2 — verschieben. Der neue Beginn liegt VOR dem alten und
      // verletzt keinen Check (`starts_at_utc < ends_at_utc` bleibt wahr): der
      // Versuch wuerde ohne 0017 durchgehen, nicht an einer Nebenbedingung
      // scheitern.
      //
      // Hier ist die Erwartung eine ANDERE als in 9c2, und der Unterschied ist
      // der ganze Punkt von 0017: dort filterte nur die `using`-Klausel, das
      // Recht bestand — PostgREST antwortete 200 mit leerer Menge. Hier ist das
      // Tabellenrecht `update` fuer `authenticated` vollstaendig entzogen, und
      // ein fehlendes Tabellenrecht wirft, bevor ueberhaupt eine Zeile
      // ausgewaehlt wird.
      //
      // GEMESSEN (Lauf 31235882417) und damit belegt statt behauptet: 42501
      // mit „permission denied for table assignments" und dem Hinweis
      // „GRANT UPDATE ON public.assignments TO authenticated;" — PostgREST
      // nennt das entzogene Recht selbst. Ein ANDERER Riegel (etwa eine
      // RLS-Verletzung) macht `erwarteRiegel` rot.
      const patchZuweisung = await dataApiSchreibversuch(
        "9c5/assignments-update",
        request.patch(`${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: { starts_at_utc: "2026-08-03T04:00:00Z" },
        }),
      );
      erwarteRiegel(
        patchZuweisung,
        { art: "tabellenrecht", tabelle: "assignments", recht: "UPDATE" },
        "9c5 PATCH assignments",
      );
      const bestandNachPatch = await bestandNach("9c5 nach PATCH assignments");
      const startNachPatch = await zielNach("9c5 nach PATCH assignments");

      // Angriff 3 — loeschen. Dieselbe Zeile, dieselbe Begruendung.
      const deleteZuweisung = await dataApiSchreibversuch(
        "9c5/assignments-delete",
        request.delete(`${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}`, {
          headers: { ...kopfB, prefer: "return=representation" },
        }),
      );
      erwarteRiegel(
        deleteZuweisung,
        { art: "tabellenrecht", tabelle: "assignments", recht: "DELETE" },
        "9c5 DELETE assignments",
      );
      const bestandNachDelete = await bestandNach("9c5 nach DELETE assignments");
      const startNachDelete = await zielNach("9c5 nach DELETE assignments");

      // Angriff 4 — eine eigene Entwurfs-Planversion, wieder mit exakt den
      // gegranteten Spalten `(org_id, week_key)`.
      const insertVersion = await dataApiSchreibversuch(
        "9c5/plan_versions-insert",
        request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: { org_id: ORG_ID, week_key: ANGRIFFSWOCHE_MEMBER },
        }),
      );
      erwarteRiegel(
        insertVersion,
        { art: "policy", tabelle: "plan_versions" },
        "9c5 INSERT plan_versions",
      );
      const bestandDanach = await bestandNach("9c5 nach INSERT plan_versions");
      const startNachVersion = await zielNach("9c5 nach INSERT plan_versions");

      // ------------------------------------------------------------------
      // Die Wirkung, nicht die Antwort: nachgesehen statt geglaubt.
      // ------------------------------------------------------------------
      // Diese Kontrollen sind kanalunabhaengig. Aendert sich ein Statuscode,
      // werden die Zusicherungen darueber angepasst — diese hier NIE.
      //
      // Sie bleiben ZUSAETZLICH zu den Momentaufnahmen oben stehen: genau sie
      // haben den Basislauf 31237004812 aufgedeckt, waehrend die Netto-Zahl
      // gruen log. Was oben dazukam, ist die fruehere Erkennung, nicht ein
      // Ersatz.
      const zielDanach = await dataApiLese<{
        id: string;
        starts_at_utc: string;
        ends_at_utc: string;
      }>(request, zielUrl, kopfB);
      expect(zielDanach, "die Zielzeile ist verschwunden — DELETE ist durchgegangen").toHaveLength(
        1,
      );
      expect(
        zielDanach[0]?.starts_at_utc,
        "die Zielzeile wurde verschoben — PATCH ist durchgegangen",
      ).toBe(startVorher);

      // ACHTUNG bei kuenftigen Umbauten: dieser Lesezugriff MUSS vor der
      // Rueckgabe der Leihgabe stehen. Ohne Mitgliedschaft saehe B die Woche
      // ohnehin nicht mehr, und „0 Zeilen" waere aus dem falschen Grund wahr.
      // Heute schuetzt ihn nur seine Nachbarschaft: `bestandDanach` und
      // `zielDanach` schluegen vorher fehl.
      const wocheDanach = await dataApiLese<{ id: string }>(request, wocheUrlMember, kopfB);
      expect(wocheDanach, "der member hat eine Entwurfs-Planversion angelegt").toHaveLength(0);

      schritte["9c5_member_entwurfsschreiben"] = {
        rolle: "member",
        hat_planning_write: memberRecht.length === 1,
        mitgliedschaft_geliehen: mitgliedschaftB[0]?.active === true,
        zielzeile_vorher_sichtbar: zielVorher.length === 1,
        assignments_insert: {
          status: insertZuweisung.status,
          koerperLaenge: insertZuweisung.koerperLaenge,
          angelegteZeilen: insertZuweisung.zeilen,
          erwarteterStatus: 403,
          fehler: insertZuweisung.fehler,
        },
        assignments_update: {
          status: patchZuweisung.status,
          koerperLaenge: patchZuweisung.koerperLaenge,
          geaenderteZeilen: patchZuweisung.zeilen,
          erwarteterStatus: 403,
          fehler: patchZuweisung.fehler,
        },
        assignments_delete: {
          status: deleteZuweisung.status,
          koerperLaenge: deleteZuweisung.koerperLaenge,
          geloeschteZeilen: deleteZuweisung.zeilen,
          erwarteterStatus: 403,
          fehler: deleteZuweisung.fehler,
        },
        plan_versions_insert_entwurf: {
          status: insertVersion.status,
          koerperLaenge: insertVersion.koerperLaenge,
          angelegteZeilen: insertVersion.zeilen,
          erwarteterStatus: 403,
          woche: ANGRIFFSWOCHE_MEMBER,
          fehler: insertVersion.fehler,
        },
        bestand_vorher: bestandVorher,
        // Eine Momentaufnahme JE ANGRIFF statt einer Netto-Zahl am Ende. Der
        // Basislauf 31237004812 protokollierte hier `bestand_vorher: 2,
        // bestand_danach: 2`, waehrend drei Schreibzugriffe durchgingen — die
        // Wirkungen hoben sich auf. Wer diese Aufstellung wieder auf zwei
        // Zahlen eindampft, stellt den Fehlbefund wieder her.
        bestand_je_angriff: {
          nach_assignments_insert: bestandNachInsert,
          nach_assignments_update: bestandNachPatch,
          nach_assignments_delete: bestandNachDelete,
          nach_plan_versions_insert: bestandDanach,
        },
        zielzeile_start_je_angriff: {
          vorher: startVorher,
          nach_assignments_insert: startNachInsert,
          nach_assignments_update: startNachPatch,
          nach_assignments_delete: startNachDelete,
          nach_plan_versions_insert: startNachVersion,
        },
        bestand_danach: bestandDanach,
        starts_at_utc_unveraendert: zielDanach[0]?.starts_at_utc === startVorher,
        hinweis: "EYT-136 — update/delete entzogen, INSERT an Kanal und planning.write gebunden",
      };
    } catch (e) {
      fehlerAusFall = [e];
    }

    // Die Rueckgabe laeuft UNBEDINGT und ist idempotent: hat `an` gar nicht
    // erst eingefuegt, loescht sie null Zeilen und ihre Nachbedingung trifft
    // trotzdem zu. Sie steht ausserdem NACH den Wirkungskontrollen oben — ohne
    // Mitgliedschaft saehe B die Zeilen nicht mehr, die dort geprueft werden.
    let fehlerAusRueckgabe: [unknown] | null = null;
    try {
      const aus = psqlMitMarker(
        verwaltung,
        join(HIER, "eyt136-member-aus.sql"),
        ["-v", `benutzer_b=${idB}`],
        "[eyt136-member-aus]",
      );
      console.log(`  ${aus}`);
    } catch (e) {
      fehlerAusRueckgabe = [e];
    }

    // Scheitern BEIDE, wird keiner der beiden zum Anhaengsel des anderen: ein
    // `AggregateError` traegt sie gleichrangig, und der Reporter zeigt beide.
    // Eine fruehere Fassung machte den Angriffsbefund zum `cause` der
    // Aufraeummeldung — lesbar blieb dann nur die harmlosere Ueberschrift.
    // (ES2022 ist das `target` in tsconfig.base.json, `AggregateError` steht
    // also in `lib`.)
    if (fehlerAusRueckgabe !== null && fehlerAusFall !== null) {
      throw new AggregateError(
        [fehlerAusRueckgabe[0], fehlerAusFall[0]],
        "[auth-journey] EYT-136: die Rueckgabe der geliehenen member-Mitgliedschaft UND der " +
          "Angriffsnachweis sind gescheitert. Beide Fehler stehen in `errors`; die ueberlebende " +
          "Mitgliedschaft ist der dringendere Befund.",
      );
    }
    // Einzeln gilt weiterhin der Vorrang des gefaehrlicheren Befunds: ein
    // gescheiterter Angriffsnachweis kostet diesen Lauf, eine ueberlebende
    // Mitgliedschaft macht den nachfolgenden Nachweis „B ist ausgesperrt"
    // gruen-falsch.
    if (fehlerAusRueckgabe !== null) throw fehlerAusRueckgabe[0];
    if (fehlerAusFall !== null) throw fehlerAusFall[0];
  });

  await test.step("9d — veroeffentlichen, neu laden, zweiter Kontext", async () => {
    const knopf = page.getByTestId("planung-veroeffentlichen");
    await expect(knopf).toBeVisible();
    await knopf.click();

    const erfolg = page.getByTestId("planung-publish-erfolg");
    await expect(erfolg).toBeVisible();
    veroeffentlichteVersionId = (await erfolg.getAttribute("data-published-version-id")) ?? "";
    // Der Server hat DIESELBE Version veroeffentlicht, die die Ansicht als
    // Entwurf gezeigt hat — nicht irgendeine.
    expect(veroeffentlichteVersionId).toBe(entwurfsVersionId);

    await page.screenshot({
      path: join(ARTEFAKTE, "05-planung-veroeffentlicht.png"),
      fullPage: true,
    });

    // Reload: der Zustand liegt im Server, nicht im Komponentenzustand.
    await page.reload();
    const nachReload = page.getByTestId("planungsfenster-version");
    await expect(nachReload).toHaveAttribute(
      "data-published-version-id",
      veroeffentlichteVersionId,
    );
    await expect(page.getByTestId("planungsfenster-stand")).toHaveAttribute(
      "data-stand",
      "veroeffentlicht",
    );
    // Und die Aktion ist fort — es gibt keinen Entwurf mehr.
    await expect(page.getByTestId("planung-veroeffentlichen")).toHaveCount(0);

    // Zweiter Browserkontext: eigene Cookies, eigener Speicher.
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));
      await seite2.goto(`/planung?weekKey=${PLANWOCHE}`);
      await expect(seite2.getByTestId("planungsfenster-version")).toHaveAttribute(
        "data-published-version-id",
        veroeffentlichteVersionId,
      );
      await seite2.screenshot({
        path: join(ARTEFAKTE, "06-planung-zweiter-kontext.png"),
        fullPage: true,
      });
    } finally {
      await zweiter.close();
    }

    // Wiederholung ueber die API: derselbe Schluessel, dieselbe Nutzlast.
    // Es darf keine zweite Veroeffentlichung entstehen.
    const schluessel = `e2e-publish-${veroeffentlichteVersionId}`;
    const ersteWiederholung = await page.request.post("/api/v1/planung/versionen", {
      headers: { "Idempotency-Key": schluessel },
      data: { weekKey: PLANWOCHE, expectedVersionId: entwurfsVersionId },
    });
    // Der Entwurf ist fort, also ist das kein Replay, sondern eine ehrliche
    // Ablehnung mit STABILEM Code.
    expect(ersteWiederholung.status()).toBe(409);
    const problem = (await ersteWiederholung.json()) as { type?: string };
    expect(problem.type).toBe("urn:easytree:planning:already-published");

    schritte["9d_publish"] = {
      versionId: veroeffentlichteVersionId,
      zweiterKontext: true,
      wiederholung: ersteWiederholung.status(),
    };
  });

  // ---------------------------------------------------------------------
  // 9e–9g — Der Kostendurchstich (EYT-144)
  // ---------------------------------------------------------------------
  // Erst hier moeglich: 9d hat die Planversion GERADE veroeffentlicht, und ein
  // Snapshot entsteht ausschliesslich aus einer veroeffentlichten Version.
  // Genau deshalb steht dieser Block nach 9d und nicht bei den anderen
  // Kostenschritten (8/9/9a/9b) weiter oben.
  let kostenSnapshotId = "";

  await test.step("9e — /kosten erzeugt aus der echten Planversion einen gespeicherten Snapshot", async () => {
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    const listenAntwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/planversionen" &&
        r.request().method() === "GET",
    );
    await page.goto("/kosten");
    await page.getByLabel("Von Woche").fill(PLANWOCHE);
    await page.getByLabel("Bis Woche").fill(PLANWOCHE);
    await page.getByRole("button", { name: "Planversionen laden" }).click();

    const antwort = await listenAntwort;
    expect(antwort.status()).toBe(200);
    const liste = (await antwort.json()) as {
      versions: { id: string; weekKey: string; publishedAt: string }[];
    };
    // GENAU die Version, die 9d veroeffentlicht hat — kein Entwurf, keine
    // fremde. Ohne diesen Vergleich bewiese die Liste nur, dass sie nicht leer
    // ist.
    expect(liste.versions.map((v) => v.id)).toEqual([veroeffentlichteVersionId]);
    expect(liste.versions[0]?.weekKey).toBe(PLANWOCHE);
    expect(apiAufrufe).toContain("GET /api/v1/kosten/planversionen");

    const erzeugt = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/snapshots" && r.request().method() === "POST",
    );
    await page
      .getByLabel("Veröffentlichte Planversion")
      .selectOption({ value: veroeffentlichteVersionId });
    await page.getByRole("button", { name: "Snapshot erzeugen" }).click();

    const post = await erzeugt;
    expect(post.status()).toBe(201);
    const gespeichert = (await post.json()) as {
      id: string;
      planVersionId: string;
      totalMinorUnits: string;
      weekKey: string;
      days: { localDate: string; amountMinorUnits: string }[];
      positions: { id: string; amountMinorUnits: string; rateVersionId: string }[];
    };
    kostenSnapshotId = gespeichert.id;
    reiseSnapshotId = gespeichert.id;
    expect(kostenSnapshotId).not.toBe("");
    expect(gespeichert.planVersionId).toBe(veroeffentlichteVersionId);
    expect(gespeichert.weekKey).toBe(PLANWOCHE);
    // Der nachgerechnete Betrag, nicht der zurueckgelesene: siehe
    // {@link ERWARTETE_KOSTEN_MINOR}.
    expect(gespeichert.totalMinorUnits).toBe(ERWARTETE_KOSTEN_MINOR);
    expect(gespeichert.positions).toHaveLength(1);

    // Die Oberflaeche zeigt den GESPEICHERTEN Stand.
    const ansicht = page.getByTestId("kosten-snapshot");
    await expect(ansicht).toBeVisible();
    await expect(ansicht).toHaveAttribute("data-snapshot-id", kostenSnapshotId);
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_KOSTEN_ANZEIGE);
    await expect(page.getByTestId("kosten-planversion-id")).toHaveText(veroeffentlichteVersionId);
    await expect(page.getByTestId("kosten-regelversion")).toHaveText("personnel-plan-cost-v1");
    await expect(page.getByTestId("kosten-baustellenfilter")).toHaveText("alle Baustellen");

    // Bis zur Einzelposition — mit Person, Baustelle, Dauer und Betrag.
    const positionen = page.getByTestId("kosten-position");
    await expect(positionen).toHaveCount(1);
    await expect(positionen.first()).toHaveAttribute(
      "data-amount-minor-units",
      ERWARTETE_KOSTEN_MINOR,
    );
    await expect(positionen.first()).toContainText(MITARBEITER_NAME);
    await expect(positionen.first()).toContainText("E2E-Baustelle Reise");
    await expect(positionen.first()).toContainText(ERWARTETE_DAUER);
    // Und die Tagessumme des einen lokalen Tages.
    await expect(page.getByTestId("kosten-tag")).toHaveCount(1);
    await expect(page.getByTestId("kosten-tag")).toContainText("2026-08-03");

    // Die Adresse traegt den Snapshot — Voraussetzung fuer 9f und 9g.
    expect(new URL(page.url()).search).toBe(`?snapshot=${kostenSnapshotId}`);

    // UND er liegt wirklich in PostgreSQL. Das ist die Aussage, die der
    // Browser nicht treffen kann.
    const gepruefte = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt144-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${kostenSnapshotId}`,
        "-v",
        `summe=${ERWARTETE_KOSTEN_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE}`,
      ],
      "[eyt144-snapshot]",
    );
    console.log(`  ${gepruefte}`);

    await page.screenshot({ path: join(ARTEFAKTE, "07-kosten-snapshot.png"), fullPage: true });
    schritte["9e_kosten_snapshot"] = {
      snapshotId: kostenSnapshotId,
      planVersionId: veroeffentlichteVersionId,
      summe: gespeichert.totalMinorUnits,
      positionen: gespeichert.positions.length,
      datenbank: gepruefte,
    };
  });

  await test.step("9f — Reload zeigt DENSELBEN Snapshot, ohne ihn neu zu erzeugen", async () => {
    const vorher = apiAufrufe.length;
    await page.reload();

    const ansicht = page.getByTestId("kosten-snapshot");
    await expect(ansicht).toBeVisible();
    await expect(ansicht).toHaveAttribute("data-snapshot-id", kostenSnapshotId);
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_KOSTEN_ANZEIGE);
    await expect(page.getByTestId("kosten-position")).toHaveAttribute(
      "data-amount-minor-units",
      ERWARTETE_KOSTEN_MINOR,
    );

    // Der eigentliche Nachweis ist eine ABWESENHEIT: nach dem Reload steht im
    // Netzwerkprotokoll ein Lesen des gespeicherten Standes und KEIN Schreiben.
    // Ohne diese Zaehlung koennte die Ansicht denselben Betrag anzeigen und
    // dabei stillschweigend einen zweiten Snapshot angelegt haben.
    const seitReload = apiAufrufe.slice(vorher);
    expect(seitReload).toContain(`GET /api/v1/kosten/snapshots/${kostenSnapshotId}`);
    expect(seitReload).not.toContain("POST /api/v1/kosten/snapshots");
    // Und keine Satzabfrage: ein Snapshot wird gelesen, nicht neu bewertet.
    expect(seitReload.filter((a) => a.includes("/kosten/stundensaetze"))).toEqual([]);

    schritte["9f_reload"] = {
      snapshotId: kostenSnapshotId,
      aufrufe_seit_reload: seitReload,
    };
  });

  await test.step("9g — ein ZWEITER Browserkontext sieht denselben gespeicherten Snapshot", async () => {
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      const aufrufe2: string[] = [];
      seite2.on("request", (anfrage) => {
        const pfad = new URL(anfrage.url()).pathname;
        if (pfad.startsWith("/api/")) aufrufe2.push(`${anfrage.method()} ${pfad}`);
      });

      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));

      await seite2.goto(`/kosten?snapshot=${kostenSnapshotId}`);
      const ansicht2 = seite2.getByTestId("kosten-snapshot");
      await expect(ansicht2).toBeVisible();
      await expect(ansicht2).toHaveAttribute("data-snapshot-id", kostenSnapshotId);
      await expect(seite2.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_KOSTEN_ANZEIGE);
      await expect(seite2.getByTestId("kosten-position")).toHaveAttribute(
        "data-amount-minor-units",
        ERWARTETE_KOSTEN_MINOR,
      );
      // Eigene Cookies, eigener Speicher — und trotzdem kein Schreibzugriff.
      expect(aufrufe2).toContain(`GET /api/v1/kosten/snapshots/${kostenSnapshotId}`);
      expect(aufrufe2).not.toContain("POST /api/v1/kosten/snapshots");

      await seite2.screenshot({ path: join(ARTEFAKTE, "08-kosten-zweiter-kontext.png") });
    } finally {
      await zweiter.close();
    }

    // Nach Reload UND zweitem Kontext: immer noch GENAU EIN Snapshot. Das ist
    // der Beweis, dass Ansehen nichts erzeugt — die Zaehlung im Skript
    // (`koepfe`) umfasst alle Snapshots dieser Organisation, nicht nur den
    // erwarteten.
    const nachher = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt144-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${kostenSnapshotId}`,
        "-v",
        `summe=${ERWARTETE_KOSTEN_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE}`,
      ],
      "[eyt144-snapshot]",
    );
    console.log(`  ${nachher}`);
    expect(nachher).toContain("koepfe=1");
    schritte["9g_zweiter_kontext"] = { snapshotId: kostenSnapshotId, datenbank: nachher };
  });

  // ---------------------------------------------------------------------
  // 9h — Der Baustellenfilter (EYT-146)
  // ---------------------------------------------------------------------
  // NACH 9g und nicht davor: `eyt144-snapshot-pruefen.sql` verlangt
  // `koepfe=1` fuer die ganze Organisation. Ein zweiter Snapshot vor jenem
  // Aufruf machte den abgenommenen EYT-144-Nachweis rot — an der falschen
  // Stelle und mit der falschen Begruendung.
  //
  // Eigene Woche, eigene Planversion, zwei Baustellen (siehe `fixtures.sql`).
  // Damit bleiben die Zahlen von EYT-144 unangetastet.
  await test.step("9h — /kosten filtert den Snapshot auf EINE reale Baustelle", async () => {
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    // Die W33-Version ist ein Entwurf. Erst der ECHTE Publish-Endpunkt macht
    // sie zu einer Kostenquelle — dieselbe Naht wie in 9d, nur ueber die API,
    // weil die Planungsoberflaeche dafuer nichts Neues beweisen wuerde.
    // Ueber eine lokale Bindung, wie in 9d — und nicht direkt die Konstante im
    // Header. Gemessen (gitleaks 8.24.3, Lauf 31737022667): die Regel
    // `generic-api-key` schlaegt auf das Muster `Key": <bezeichner>` an, sobald
    // der BEZEICHNER genug Entropie hat; `PUBLISH_VORGANG_146` kam auf 4.04 und
    // wurde als Fund gemeldet. Der Wert ist kein Geheimnis, aber eine Ausnahme
    // in `.gitleaksignore` waere der falsche Weg (EYT-133 hat den Secret-Guard
    // gerade gegen genau solche Bypaesse gehaertet).
    const schluessel146 = PUBLISH_VORGANG_146;
    const veroeffentlicht = await page.request.post("/api/v1/planung/versionen", {
      headers: { "Idempotency-Key": schluessel146 },
      data: { weekKey: PLANWOCHE_146, expectedVersionId: ENTWURF_146 },
    });
    expect(veroeffentlicht.status()).toBe(201);
    const version146 = (await veroeffentlicht.json()) as { versionId: string };
    expect(version146.versionId).toBe(ENTWURF_146);

    const listenAntwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/planversionen" &&
        r.request().method() === "GET",
    );
    await page.goto("/kosten");
    await page.getByLabel("Von Woche").fill(PLANWOCHE_146);
    await page.getByLabel("Bis Woche").fill(PLANWOCHE_146);
    await page.getByRole("button", { name: "Planversionen laden" }).click();
    expect((await listenAntwort).status()).toBe(200);

    // Die Baustellenauswahl wird ERST nach der Versionswahl geholt — und sie
    // kommt aus dem Kostenmodul, nicht aus einer Planungsroute.
    const baustellenAntwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/kosten/planversionen/${ENTWURF_146}/baustellen` &&
        r.request().method() === "GET",
    );
    await page.getByLabel("Veröffentlichte Planversion").selectOption({ value: ENTWURF_146 });

    const baustellen = await baustellenAntwort;
    expect(baustellen.status()).toBe(200);
    const auswahl = (await baustellen.json()) as { worksites: { id: string; label: string }[] };
    // GENAU die beiden Baustellen dieser Version, mit ihren ECHTEN Namen aus
    // `public.worksites` — in der zugesicherten Reihenfolge (Bezeichnung
    // aufsteigend). Kein Name ist hier erfunden oder aus der Id abgeleitet.
    expect(auswahl.worksites).toEqual([
      { id: BAUSTELLE_AUSGESCHLOSSEN, label: "E2E-Baustelle Filter B" },
      { id: BAUSTELLE_GEFILTERT, label: "E2E-Baustelle Reise" },
    ]);

    const sichtbar = page.getByLabel("Baustelle");
    await expect(sichtbar).toBeVisible();
    await expect(sichtbar.locator("option")).toHaveText([
      "Alle Baustellen",
      "E2E-Baustelle Filter B",
      "E2E-Baustelle Reise",
    ]);

    // Gefiltert wird auf „E2E-Baustelle Reise" (…e241) — die Baustelle, die es
    // schon vorher gab. Die andere (…e242) darf danach nirgends auftauchen.
    const erzeugt = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/snapshots" && r.request().method() === "POST",
    );
    await sichtbar.selectOption({ value: BAUSTELLE_GEFILTERT });
    await page.getByRole("button", { name: "Snapshot erzeugen" }).click();

    const post = await erzeugt;
    expect(post.status()).toBe(201);
    // Der Rumpf, den der Browser WIRKLICH gesendet hat — nicht der, den die
    // Ansicht anzeigt. Ohne diese Zeile bewiese der Rest nur, dass der Server
    // richtig filtert, nicht dass die Oberflaeche die gewaehlte Id sendet.
    expect(post.request().postDataJSON()).toEqual({
      publishedPlanVersionId: ENTWURF_146,
      worksiteId: BAUSTELLE_GEFILTERT,
    });

    const gefiltert = (await post.json()) as {
      id: string;
      worksiteId: string | null;
      totalMinorUnits: string;
      positions: { worksiteId: string; worksiteLabel: string }[];
    };
    expect(gefiltert.worksiteId).toBe(BAUSTELLE_GEFILTERT);
    expect(gefiltert.totalMinorUnits).toBe(ERWARTETE_FILTER_MINOR);
    expect(gefiltert.positions).toHaveLength(1);
    expect(gefiltert.positions[0]?.worksiteId).toBe(BAUSTELLE_GEFILTERT);
    const gefilterteId = gefiltert.id;
    expect(gefilterteId).not.toBe(kostenSnapshotId);

    // Die Oberflaeche zeigt den gefilterten GESPEICHERTEN Stand.
    await expect(page.getByTestId("kosten-baustellenfilter")).toHaveText(BAUSTELLE_GEFILTERT);
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_FILTER_ANZEIGE);
    const positionen = page.getByTestId("kosten-position");
    await expect(positionen).toHaveCount(1);
    await expect(positionen.first()).toContainText("E2E-Baustelle Reise");
    // Und die andere Baustelle steht NIRGENDS auf der Seite.
    expect(await page.content()).not.toContain("E2E-Baustelle Filter B");

    // UND er liegt so in PostgreSQL: Filter im Kopf, keine fremde Position.
    // `koepfe_gesamt=2` — der ungefilterte aus 9e und dieser.
    const gepruefte = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt146-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${gefilterteId}`,
        "-v",
        `baustelle=${BAUSTELLE_GEFILTERT}`,
        "-v",
        `fremde_baustelle=${BAUSTELLE_AUSGESCHLOSSEN}`,
        "-v",
        `summe=${ERWARTETE_FILTER_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE_146}`,
        "-v",
        "koepfe_gesamt=2",
      ],
      "[eyt146-snapshot]",
    );
    console.log(`  ${gepruefte}`);

    await page.screenshot({ path: join(ARTEFAKTE, "09-kosten-gefiltert.png"), fullPage: true });

    // Reload: derselbe gefilterte Snapshot, ohne zweite Erzeugung und ohne
    // Baustellenabfrage — der Reload-Vertrag gilt auch mit Filter.
    const vorher = apiAufrufe.length;
    await page.reload();
    await expect(page.getByTestId("kosten-snapshot")).toHaveAttribute(
      "data-snapshot-id",
      gefilterteId,
    );
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_FILTER_ANZEIGE);
    const seitReload = apiAufrufe.slice(vorher);
    expect(seitReload).toContain(`GET /api/v1/kosten/snapshots/${gefilterteId}`);
    expect(seitReload).not.toContain("POST /api/v1/kosten/snapshots");
    expect(seitReload.filter((a) => a.includes("/baustellen"))).toEqual([]);
    expect(seitReload.filter((a) => a.includes("/kosten/planversionen"))).toEqual([]);

    // Zweiter Browserkontext: eigene Cookies, eigener Speicher, derselbe Stand.
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      const aufrufe2: string[] = [];
      seite2.on("request", (anfrage) => {
        const pfad = new URL(anfrage.url()).pathname;
        if (pfad.startsWith("/api/")) aufrufe2.push(`${anfrage.method()} ${pfad}`);
      });

      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));

      await seite2.goto(`/kosten?snapshot=${gefilterteId}`);
      await expect(seite2.getByTestId("kosten-snapshot")).toHaveAttribute(
        "data-snapshot-id",
        gefilterteId,
      );
      await expect(seite2.getByTestId("kosten-baustellenfilter")).toHaveText(BAUSTELLE_GEFILTERT);
      await expect(seite2.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_FILTER_ANZEIGE);
      expect(aufrufe2).toContain(`GET /api/v1/kosten/snapshots/${gefilterteId}`);
      expect(aufrufe2).not.toContain("POST /api/v1/kosten/snapshots");

      await seite2.screenshot({ path: join(ARTEFAKTE, "10-kosten-gefiltert-zweiter.png") });
    } finally {
      await zweiter.close();
    }

    // Nach Reload UND zweitem Kontext: immer noch GENAU ZWEI Snapshots.
    const danach = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt146-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${gefilterteId}`,
        "-v",
        `baustelle=${BAUSTELLE_GEFILTERT}`,
        "-v",
        `fremde_baustelle=${BAUSTELLE_AUSGESCHLOSSEN}`,
        "-v",
        `summe=${ERWARTETE_FILTER_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE_146}`,
        "-v",
        "koepfe_gesamt=2",
      ],
      "[eyt146-snapshot]",
    );
    console.log(`  ${danach}`);
    expect(danach).toContain("koepfe_gesamt=2");
    expect(danach).toContain("fremde_positionen=0");

    schritte["9h_baustellenfilter"] = {
      planVersionId: ENTWURF_146,
      baustellen: auswahl.worksites.map((b) => b.label),
      gewaehlt: BAUSTELLE_GEFILTERT,
      snapshotId: gefilterteId,
      summe: gefiltert.totalMinorUnits,
      datenbank: danach,
    };
  });

  await test.step("10 — ein fremder Organisationskontext wird abgelehnt", async () => {
    // Dieselbe gueltige Sitzung, aber eine Organisation, in der der Reisende
    // nicht Mitglied ist. Der Header waehlt aus, er autorisiert nicht.
    const fremd = await page.request.get("/api/v1/kosten/mitarbeiter", {
      headers: { "X-EasyTree-Organization-Id": FREMDE_ORG },
    });
    expect(fremd.status()).toBe(403);
    const problem = (await fremd.json()) as { detail?: string };
    // Kein Existenzleck: die Antwort unterscheidet nicht zwischen "gibt es
    // nicht" und "du gehoerst nicht dazu".
    expect(problem.detail).toBe("Kein Zugriff auf die Kostendaten dieser Organisation.");
    schritte["10_fremde_organisation"] = { status: fremd.status(), erwartet: 403 };
  });

  await test.step("11 — kein Token in Browserspeicher oder DOM", async () => {
    const speicher = await page.evaluate(() => ({
      local: Object.entries(localStorage).map(([k, v]) => `${k}=${String(v)}`),
      session: Object.entries(sessionStorage).map(([k, v]) => `${k}=${String(v)}`),
      // Cookies, die JavaScript SEHEN kann — bei HttpOnly ist das keiner.
      sichtbareCookies: document.cookie,
    }));
    expect(speicher.local).toEqual([]);
    expect(speicher.session).toEqual([]);
    expect(speicher.sichtbareCookies).toBe("");

    // `eyJ` ist der Anfang jedes base64url-kodierten JWT-Headers. Erscheint er
    // im gerenderten HTML, ist ein Token in den DOM geraten.
    const inhalt = await page.content();
    expect(inhalt).not.toContain("eyJ");

    schritte["11_browserspeicher"] = {
      localStorage: 0,
      sessionStorage: 0,
      sichtbare_cookies: "",
      token_im_dom: false,
    };
  });

  await test.step("12 — Abmelden macht die Sitzung ungueltig", async () => {
    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.waitForURL("**/anmelden");

    const danach = await context.cookies();
    expect(danach.find((k) => k.name === "eyt_access")).toBeUndefined();
    expect(danach.find((k) => k.name === "eyt_refresh")).toBeUndefined();

    // Nicht nur "das Cookie ist weg", sondern "der Server laesst nicht mehr
    // durch": ohne diese Zusicherung bewiese der Test nur, dass der Browser
    // vergessen hat.
    const sitzung = await page.request.get("/api/v1/auth/session");
    expect(sitzung.status()).toBe(401);
    const kosten = await page.request.get("/api/v1/kosten/mitarbeiter");
    expect(kosten.status()).toBe(401);

    // Und die Oberflaeche zeigt den ehrlichen Zustand.
    await page.goto("/kosten");
    await expect(page.getByTestId("kosten-unauthenticated")).toBeVisible();
    await expect(page.getByRole("link", { name: "Kosten" })).toHaveCount(0);

    schritte["12_abmeldung"] = {
      cookies_geloescht: true,
      session_status: sitzung.status(),
      kosten_status: kosten.status(),
    };
  });

  // Es gibt hier bewusst KEINEN Schritt „Zusammenfassung ablegen" mehr. Das
  // Schreiben steht im `afterEach` weiter oben, weil der Ausgang des Laufs
  // erst dort feststeht — die Begruendung samt Messung ist dort notiert.
});

/**
 * Der unterscheidende Nachweis (EYT-106 AK8, EYT-134).
 *
 * B ist ein ECHTER, ueber GoTrue angemeldeter Benutzer ohne jede
 * Mitgliedschaft. Waere im Server eine feste Identitaet verdrahtet — die
 * Sorge, gegen die AK8 antritt —, dann naennte Bs Sitzung die Id von A und der
 * Kostenpfad liesse B durch. Beides wird hier gemessen.
 *
 * Eigener Browserkontext: B darf nichts von As Sitzung erben.
 *
 * ## Zweite Aufgabe seit EYT-136: SEKUNDAERE Gegenprobe auf die Leihgabe in 9c5
 *
 * Schritt 9c5 leiht B fuer seine Dauer eine aktive `member`-Mitgliedschaft und
 * gibt sie unmittelbar danach zurueck. Ueberlebte sie, naennte Bs Sitzung hier
 * eine Organisation und dieser Nachweis wuerde rot.
 *
 * Die Rangfolge der Waechter, ehrlich benannt:
 *
 *  1. PRIMAER ist die Nachbedingung in `eyt136-member-aus.sql`
 *     (`leihe`/`b_gesamt` muessen 0 sein): sie liest nach dem Loeschen nach,
 *     und `psqlMitMarker` wirft, wenn ihr Marker fehlt oder psql einen Fehler
 *     meldet. Sie greift im SELBEN Schritt, in dem die Leihgabe entstand.
 *  2. SEKUNDAER ist dieser Nachweis — und er greift NUR, wenn der Hauptnachweis
 *     sonst gruen bleibt. `test.describe.configure({ mode: "serial" })` weiter
 *     oben laesst nachfolgende Faelle bei einem roten Vorgaenger naemlich
 *     AUSFALLEN statt sie zu fahren. Ein roter Hauptnachweis SKIPPT diesen
 *     hier, er faerbt ihn nicht rot. Er deckt also genau den Fall „Leihgabe
 *     ueberlebt, waehrend alles andere gruen ist" — und den deckt er sicher.
 *
 * Dass er ueberhaupt DANACH laeuft, folgt aus der Deklarationsreihenfolge in
 * dieser Datei plus `workers: 1` und `fullyParallel: false` in `config.ts`;
 * das SKIP-Verhalten kommt dagegen allein aus dem `serial`-Modus.
 *
 * Der Teardown taugt als Waechter NICHT: er loescht alle Mitgliedschaften der
 * Organisation und zaehlt erst danach — eine ueberlebende Leihgabe wuerde dort
 * aufgeraeumt, nicht bemerkt.
 */
test("Benutzer B ist angemeldet, aber ohne Mitgliedschaft ausgesperrt", async ({ browser }) => {
  const emailB = pflicht("EASYTREE_JOURNEY_EMAIL_B");
  const passwortB = pflicht("EASYTREE_JOURNEY_PASSWORT_B");
  const idB = pflicht("EASYTREE_JOURNEY_USER_B");
  const idA = pflicht("EASYTREE_JOURNEY_USER_A");

  const kontext = await browser.newContext();
  const seite = await kontext.newPage();
  const bericht: Record<string, unknown> = { ticket: "EYT-106", benutzer: "B" };
  ZUSAMMENFASSUNGEN.set(test.info().testId, { datei: "zusammenfassung-b.json", bericht });

  try {
    await test.step("B meldet sich ueber dieselbe echte Loginseite an", async () => {
      await seite.goto("/anmelden");
      await seite.getByLabel("E-Mail").fill(emailB);
      await seite.getByLabel("Passwort").fill(passwortB);
      await seite.getByRole("button", { name: "Anmelden" }).click();

      // Auf den ABSCHLUSS warten, nicht auf den Klick. Der Klick kehrt sofort
      // zurueck; Cookie und Weiterleitung entstehen erst mit der Antwort.
      // Ohne dieses Warten las der Test die Cookies nach 369 ms und fand
      // keine — gemessen im ersten CI-Lauf. Fuer Reise A stand dieses Warten
      // von Anfang an da; hier fehlte es.
      //
      // Schlaegt der Login wirklich fehl, zeigt das Formular einen Banner mit
      // role="alert". Auf beides zu warten macht aus einem stillen Timeout
      // eine benannte Ursache.
      const angemeldet = seite.waitForURL("**/kosten");
      const abgelehnt = seite
        .getByRole("alert")
        .filter({ hasText: "Anmeldung fehlgeschlagen" })
        .waitFor({ state: "visible" });
      await Promise.race([angemeldet, abgelehnt]);
      await expect(
        seite.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" }),
      ).toHaveCount(0);
      await angemeldet;

      // B ist ein gueltiger Benutzer und bekommt eine echte Sitzung. Nur
      // berechtigt ist er nicht — das ist der Unterschied, um den es geht.
      const kekse = await kontext.cookies();
      expect(kekse.find((k) => k.name === "eyt_access")?.httpOnly).toBe(true);
    });

    await test.step("die Sitzung nennt Bs eigene Id, nicht die von A", async () => {
      const antwort = await seite.request.get("/api/v1/auth/session");
      expect(antwort.status()).toBe(200);
      const sitzung = (await antwort.json()) as {
        userId: string;
        organisations: unknown[];
      };
      // DER Nachweis gegen eine eingeschleuste Identitaet.
      expect(sitzung.userId).toBe(idB);
      expect(sitzung.userId).not.toBe(idA);
      // Ohne Mitgliedschaft ist die Liste leer — nicht etwa As Organisation.
      expect(sitzung.organisations).toEqual([]);
      bericht["session"] = { userId_ist_B: true, organisationen: 0 };
    });

    await test.step("keine Kosten-Navigation", async () => {
      await seite.goto("/kosten");
      await expect(seite.getByRole("link", { name: "Kosten" })).toHaveCount(0);
      // Angemeldet, aber ohne Organisation: der ehrliche Zustand, nicht der
      // abgemeldete Banner.
      await expect(seite.getByTestId("kosten-unauthenticated")).toHaveCount(0);
    });

    await test.step("der Kostenpfad lehnt B stabil ab", async () => {
      const mitarbeiter = await seite.request.get("/api/v1/kosten/mitarbeiter");
      expect(mitarbeiter.status()).toBe(400);
      const historie = await seite.request.get(`/api/v1/kosten/stundensaetze/${MITARBEITER_ID}`);
      expect(historie.status()).toBe(400);
      // Mit dem Organisationsheader von A wird daraus eine Ablehnung ohne
      // Existenzleck — nie ein Durchlass.
      const mitFremdemHeader = await seite.request.get("/api/v1/kosten/mitarbeiter", {
        headers: { "X-EasyTree-Organization-Id": ORG_ID },
      });
      expect(mitFremdemHeader.status()).toBe(403);
      bericht["kostenpfad"] = {
        mitarbeiter: mitarbeiter.status(),
        historie: historie.status(),
        mit_fremdem_header: mitFremdemHeader.status(),
      };
    });

    await test.step("nichts von A ist fuer B sichtbar", async () => {
      const inhalt = await seite.content();
      expect(inhalt).not.toContain(MITARBEITER_NAME);
      expect(inhalt).not.toContain(ERWARTETER_BETRAG);
      expect(inhalt).not.toContain(ORG_NAME);
      const koerper = await (await seite.request.get("/api/v1/kosten/mitarbeiter")).text();
      expect(koerper).not.toContain(MITARBEITER_NAME);
      expect(koerper).not.toContain(MITARBEITER_ID);
      bericht["kein_datenabfluss"] = true;
    });

    // EYT-144: B sieht auch keine KOSTEN — weder die Auswahlliste noch den
    // gespeicherten Snapshot, den A gerade erzeugt hat. Ohne diesen Schritt
    // bewiese die Reise nur, dass ein Berechtigter Kosten sehen kann.
    await test.step("B erreicht weder Planversionsliste noch fremden Snapshot", async () => {
      const snapshotId = reiseSnapshotId === "" ? ID_OHNE_SNAPSHOT : reiseSnapshotId;

      await seite.goto(`/kosten?snapshot=${snapshotId}`);
      // Der Waechter blockt VOR jedem Gateway-Aufruf: B hat keine bestaetigte
      // Organisation, also gibt es keine Kostenansicht.
      await expect(seite.getByTestId("kosten-snapshot")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-gesamtsumme")).toHaveCount(0);
      await expect(seite.getByLabel("Von Woche")).toHaveCount(0);

      // Und im DOM steht kein Betrag — auch nicht versteckt. Geprueft wird der
      // gerenderte Inhalt, nicht das Sichtbare: ein `display:none`-Element
      // truege den Wert trotzdem aus.
      //
      // Was hier BEWUSST NICHT geprueft wird: die Abwesenheit der Snapshot-Id.
      // Sie steht im Auslieferungspayload der Seite — gemessen am 13.08.2026
      // gegen den echten Build, genau einmal. Das ist kein Leck, sondern Bs
      // EIGENER URL-Parameter: `/kosten` reicht ihn als Prop an die
      // Client-Komponente weiter, und Next serialisiert die Props der Kinder
      // unabhaengig davon, ob der Zugangswaechter sie rendert. Eine Zusicherung
      // darauf waere rot geworden und haette dabei nichts ueber Zugriffsrechte
      // gesagt. Die Aussage, um die es geht, sind die BETRAEGE — und derselbe
      // Build enthielt davon null.
      const inhalt = await seite.content();
      expect(inhalt).not.toContain(ERWARTETE_KOSTEN_ANZEIGE);
      expect(inhalt).not.toContain(ERWARTETE_KOSTEN_MINOR);

      // Der Server lehnt unabhaengig von der Oberflaeche ab — zweimal je Route:
      // ohne Organisationskontext (400) und mit dem Kontext von A (403). Der
      // zweite Fall ist der eigentliche: er fragt genau die Organisation an, in
      // der die Daten liegen.
      const listeOhne = await seite.request.get(
        `/api/v1/kosten/planversionen?fromWeekKey=${PLANWOCHE}&toWeekKey=${PLANWOCHE}`,
      );
      expect(listeOhne.status()).toBe(400);
      const listeMit = await seite.request.get(
        `/api/v1/kosten/planversionen?fromWeekKey=${PLANWOCHE}&toWeekKey=${PLANWOCHE}`,
        { headers: { "X-EasyTree-Organization-Id": ORG_ID } },
      );
      expect(listeMit.status()).toBe(403);
      expect(await listeMit.text()).not.toContain(snapshotId);

      const snapshotMit = await seite.request.get(`/api/v1/kosten/snapshots/${snapshotId}`, {
        headers: { "X-EasyTree-Organization-Id": ORG_ID },
      });
      expect(snapshotMit.status()).toBe(403);
      const koerper = await snapshotMit.text();
      expect(koerper).not.toContain(ERWARTETE_KOSTEN_MINOR);
      expect(koerper).not.toContain(MITARBEITER_NAME);

      bericht["kostenansicht_verweigert"] = {
        planversionen_ohne_kontext: listeOhne.status(),
        planversionen_mit_kontext_von_a: listeMit.status(),
        snapshot_mit_kontext_von_a: snapshotMit.status(),
        snapshot_id_im_dom: false,
      };
    });

    // EYT-107: B darf auch nicht veroeffentlichen — weder sichtbar noch ueber
    // die API. Ohne diesen Schritt bewiese die Reise nur, dass ein
    // BERECHTIGTER es kann.
    await test.step("B sieht keine Planung und darf nicht veroeffentlichen", async () => {
      await seite.goto(`/planung?weekKey=${PLANWOCHE}`);
      // Der Waechter blockt VOR jedem Gateway-Aufruf.
      //
      // Welcher Zustand? B ist angemeldet, hat aber KEINE aktive
      // Mitgliedschaft. Damit gibt es keine bestaetigte Organisation, in der
      // ein Recht ueberhaupt gelten koennte — der Zustand ist „keine
      // eindeutige Organisation", nicht „Forbidden". `Forbidden` gilt fuer
      // eine bestaetigte Organisation OHNE `planning.read`; dieser Fall wird
      // in `planung-zugang.test.tsx` geprueft.
      //
      // Eine erste Fassung erwartete hier `planung-forbidden` und war rot.
      // Nicht die Zusicherung wurde angepasst, sondern der Produktzustand:
      // der Banner behauptete „Du gehörst mehreren Organisationen an" — fuer
      // B falsch. Serverseitig entspricht dem `ORG_CONTEXT_REQUIRED`.
      await expect(seite.getByTestId("planung-org-erforderlich")).toBeVisible();
      await expect(seite.getByTestId("planung-forbidden")).toHaveCount(0);
      await expect(seite.getByTestId("planung-veroeffentlichen")).toHaveCount(0);
      await expect(seite.getByTestId("planungsfenster-stand")).toHaveCount(0);

      // Und der Server lehnt unabhaengig von der Oberflaeche ab. Ein
      // Idempotenzschluessel wird mitgeschickt, damit die Ablehnung
      // NICHT aus einer fehlenden Kopfzeile stammt — sonst bewiese der Fall
      // nur, dass ein Pflichtheader fehlt.
      const direkt = await seite.request.post("/api/v1/planung/versionen", {
        headers: { "Idempotency-Key": B_PUBLISH_VORGANG },
        data: { weekKey: PLANWOCHE, expectedVersionId: null },
      });
      expect(direkt.status()).toBe(403);
      bericht["publish_verweigert"] = { status: direkt.status(), erwartet: 403 };
    });

    // Nur noch das Bildschirmfoto: es braucht `seite`, die im `finally` unten
    // geschlossen wird. Die Zusammenfassung schreibt der `afterEach` — dort
    // steht der Ausgang fest, hier stuende wieder nur eine Konstante.
    await test.step("Bildschirmfoto von B ablegen", async () => {
      mkdirSync(ARTEFAKTE, { recursive: true });
      await seite.screenshot({ path: join(ARTEFAKTE, "03-benutzer-b-ohne-zugang.png") });
    });
  } finally {
    await kontext.close();
  }
});
