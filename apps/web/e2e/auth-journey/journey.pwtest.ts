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
 * - Das `update`- bzw. `delete`-Recht auf `assignments` fuer `authenticated`
 *   wiederherstellen UND die zugehoerige Policy neu anlegen (Rollback-Rezept
 *   im Kopf von 0017): Schritt 9c5 wird rot — PATCH bzw. DELETE greifen dann
 *   durch, und die Nachkontrolle sieht eine veraenderte bzw. fehlende Zeile.
 *   Beides zusammen, denn 0017 hat beides entzogen: allein der Grant liefe in
 *   „no policy", allein die Policy in 42501.
 * - `('member','planning.write')` in `role_permissions` eintragen: 9c5 wird
 *   NICHT rot — aber `eyt136-member-an.sql` wirft, weil die Praemisse des
 *   Nachweises fiele. Der Angriff wuerde vakuos, und das faellt VOR dem
 *   Angriff auf statt danach.
 * - Die Rueckgabe der Leihmitgliedschaft in 9c5 auslassen: der nachfolgende
 *   Nachweis „Benutzer B ist angemeldet, aber ohne Mitgliedschaft ausgesperrt"
 *   wird rot, weil Bs Sitzung dann eine Organisation nennt. Er ist damit die
 *   von aussen kommende Gegenprobe auf die Fixtur des Angriffsschritts.
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
 * Die Planwoche der Publish-Reise (EYT-107).
 *
 * Muss zu den Zeitstempeln in `fixtures.sql` passen: `2026-08-03T06:00:00Z`
 * ist in `Europe/Berlin` — der Zeitzone der Reiseorganisation — Montag der
 * ISO-Woche 32. Der Publish-Pfad prueft genau diese Zuordnung; das Schema tut
 * es nicht.
 */
const PLANWOCHE = "2026-W32";

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

interface Angriffsergebnis {
  readonly status: number;
  readonly koerperLaenge: number;
  readonly zeilen: number;
}

/**
 * Ein Data-API-SCHREIBversuch, festgehalten statt geraten.
 *
 * Der Koerper wird genau EINMAL gelesen (`text()`) — ein zweiter Zugriff auf
 * denselben `APIResponse` kann fehlschlagen —, und die Zeilenzahl entsteht
 * daraus, nicht aus einem zweiten Aufruf. Die Laenge wandert in den Bericht,
 * damit im Artefakt nachlesbar ist, WAS PostgREST geantwortet hat und nicht
 * nur, dass es abgelehnt hat.
 *
 * Bewusst OHNE Statuszusicherung: die trifft der Aufrufer. `9c2` ist der
 * stehende Gegenbeleg dafuer, dass ein abgewehrter Data-API-Schreibzugriff
 * nicht zwingend einen Fehlerstatus traegt (dort: 200 mit leerer Menge).
 */
async function dataApiSchreibversuch(aufruf: Promise<APIResponse>): Promise<Angriffsergebnis> {
  const antwort = await aufruf;
  const koerper = await antwort.text();
  let zeilen = 0;
  if (antwort.ok() && koerper !== "") {
    const geparst: unknown = JSON.parse(koerper);
    zeilen = Array.isArray(geparst) ? geparst.length : 1;
  }
  return { status: antwort.status(), koerperLaenge: koerper.length, zeilen };
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
    schritte: {},
  };
  const schritte = bericht["schritte"] as Record<string, unknown>;

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
    await expect(page.getByTestId("kosten-leer")).toBeVisible();
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

    // Angriff 1 — eine Entwurfszuweisung in die ECHTE Planversion der Reise.
    // Dienstag derselben Woche, bewusst OHNE Ueberlappung mit der Fixtur: ein
    // Konflikt mit `assignments_no_published_overlap` liesse den Versuch
    // scheitern, ohne dass die Kanalgrenze etwas dazu beitraege — der Nachweis
    // waere gruen und wuerde den falschen Riegel messen.
    const insertZuweisung = await dataApiSchreibversuch(
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
    // 403 ist die BEGRUENDETE Erwartung, nicht die gemessene Wahrheit: die
    // Spaltenrechte fuer diese sechs Spalten bestehen weiterhin (0017), es
    // scheitert also die `with check`-Klausel — eine RLS-Verletzung ist
    // SQLSTATE 42501, und PostgREST bildet 42501 auf HTTP 403 ab (dieselbe
    // Kette wie in 9c3). Weicht die Messung ab, gilt die Messung; der
    // Wirkungsnachweis darunter bleibt davon unberuehrt.
    expect(insertZuweisung.status, "der blockierte INSERT wurde nicht mit 403 abgewiesen").toBe(
      403,
    );
    expect(insertZuweisung.zeilen).toBe(0);

    const zuweisungenDanach = await dataApiLese<{ id: string }>(request, zuweisungenUrl, kopf);
    expect(
      zuweisungenDanach.length,
      "PostgREST hat eine Zuweisung angelegt — der Planungscommand ist umgehbar",
    ).toBe(zuweisungenVorher.length);

    // Angriff 2 — eine ENTWURFS-Planversion, ganz ohne `published_at`. Genau
    // die Form, die 0016 noch durchliess.
    const insertVersion = await dataApiSchreibversuch(
      request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
        headers: { ...kopf, prefer: "return=representation" },
        data: { org_id: ORG_ID, week_key: ANGRIFFSWOCHE_OWNER },
      }),
    );
    expect(
      insertVersion.status,
      "der blockierte Entwurfs-INSERT wurde nicht mit 403 abgewiesen",
    ).toBe(403);
    expect(insertVersion.zeilen).toBe(0);

    const wocheDanach = await dataApiLese<{ id: string }>(
      request,
      `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE_OWNER}&select=id`,
      kopf,
    );
    expect(
      wocheDanach,
      "PostgREST hat eine Entwurfs-Planversion angelegt — die Woche gehoert jetzt niemandem",
    ).toHaveLength(0);

    schritte["9c4_owner_entwurfsschreiben"] = {
      rolle: "owner",
      hat_planning_write: true,
      lesen_traegt: zuweisungenVorher.length,
      assignments_insert: {
        status: insertZuweisung.status,
        koerperLaenge: insertZuweisung.koerperLaenge,
        angelegteZeilen: insertZuweisung.zeilen,
        erwarteterStatus: 403,
      },
      plan_versions_insert_entwurf: {
        status: insertVersion.status,
        koerperLaenge: insertVersion.koerperLaenge,
        angelegteZeilen: insertVersion.zeilen,
        erwarteterStatus: 403,
        woche: ANGRIFFSWOCHE_OWNER,
      },
      zuweisungen_unveraendert: zuweisungenDanach.length === zuweisungenVorher.length,
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

    // Die Leihgabe: B bekommt fuer GENAU diesen Schritt eine aktive
    // `member`-Mitgliedschaft. Kein neuer Benutzer — `auth.users` bleibt
    // unberuehrt (PO-Vorgabe 08.08.2026), beide Reisenden stammen aus dem
    // echten GoTrue-Signup. `psqlMitMarker` wirft, wenn die Markerzeile fehlt
    // oder psql einen Fehler meldet; das ist der Lesenachweis nach dem
    // Schreiben.
    const an = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt136-member-an.sql"),
      ["-v", `benutzer_a=${benutzerId}`, "-v", `benutzer_b=${idB}`],
      "[eyt136-member-an]",
    );
    console.log(`  ${an}`);

    // `catch` statt `finally`: ein `throw` im `finally` verwuerfe einen bereits
    // laufenden Fehler aus dem Fall — genau deshalb verbietet
    // `no-unsafe-finally` ihn. Eingefangen laeuft die Rueckgabe auf JEDEM Weg.
    // Der Fehler liegt im Tupel, damit „kein Fehler" von „hat null geworfen"
    // unterscheidbar bleibt.
    let fehlerAusFall: [unknown] | null = null;
    try {
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

      // Angriff 1 — anlegen. Spaltenrechte bestehen, es scheitert die
      // `with check`-Klausel (Kanal UND Recht fehlen beide).
      const insertZuweisung = await dataApiSchreibversuch(
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
      expect(insertZuweisung.status, "der INSERT des member wurde nicht mit 403 abgewiesen").toBe(
        403,
      );
      expect(insertZuweisung.zeilen).toBe(0);

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
      const patchZuweisung = await dataApiSchreibversuch(
        request.patch(`${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: { starts_at_utc: "2026-08-03T04:00:00Z" },
        }),
      );
      expect(patchZuweisung.status, "das PATCH des member wurde nicht mit 403 abgewiesen").toBe(
        403,
      );
      expect(patchZuweisung.zeilen).toBe(0);

      // Angriff 3 — loeschen. Dieselbe Zeile, dieselbe Begruendung.
      const deleteZuweisung = await dataApiSchreibversuch(
        request.delete(`${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}`, {
          headers: { ...kopfB, prefer: "return=representation" },
        }),
      );
      expect(deleteZuweisung.status, "das DELETE des member wurde nicht mit 403 abgewiesen").toBe(
        403,
      );
      expect(deleteZuweisung.zeilen).toBe(0);

      // Angriff 4 — eine eigene Entwurfs-Planversion.
      const insertVersion = await dataApiSchreibversuch(
        request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: { org_id: ORG_ID, week_key: ANGRIFFSWOCHE_MEMBER },
        }),
      );
      expect(
        insertVersion.status,
        "der Entwurfs-INSERT des member wurde nicht mit 403 abgewiesen",
      ).toBe(403);
      expect(insertVersion.zeilen).toBe(0);

      // ------------------------------------------------------------------
      // Die Wirkung, nicht die Antwort: nachgesehen statt geglaubt.
      // ------------------------------------------------------------------
      // Diese Kontrollen sind kanalunabhaengig. Aendert sich ein Statuscode,
      // werden die Zusicherungen darueber angepasst — diese hier NIE.
      const bestandDanach = (await dataApiLese<{ id: string }>(request, bestandUrl, kopfB)).length;
      expect(
        bestandDanach,
        "der Zuweisungsbestand hat sich veraendert — INSERT oder DELETE ist durchgegangen",
      ).toBe(bestandVorher);

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

      const wocheDanach = await dataApiLese<{ id: string }>(
        request,
        `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE_MEMBER}&select=id`,
        kopfB,
      );
      expect(wocheDanach, "der member hat eine Entwurfs-Planversion angelegt").toHaveLength(0);

      schritte["9c5_member_entwurfsschreiben"] = {
        rolle: "member",
        hat_planning_write: false,
        mitgliedschaft_geliehen: true,
        zielzeile_vorher_sichtbar: true,
        assignments_insert: {
          status: insertZuweisung.status,
          koerperLaenge: insertZuweisung.koerperLaenge,
          angelegteZeilen: insertZuweisung.zeilen,
          erwarteterStatus: 403,
        },
        assignments_update: {
          status: patchZuweisung.status,
          koerperLaenge: patchZuweisung.koerperLaenge,
          geaenderteZeilen: patchZuweisung.zeilen,
          erwarteterStatus: 403,
        },
        assignments_delete: {
          status: deleteZuweisung.status,
          koerperLaenge: deleteZuweisung.koerperLaenge,
          geloeschteZeilen: deleteZuweisung.zeilen,
          erwarteterStatus: 403,
        },
        plan_versions_insert_entwurf: {
          status: insertVersion.status,
          koerperLaenge: insertVersion.koerperLaenge,
          angelegteZeilen: insertVersion.zeilen,
          erwarteterStatus: 403,
          woche: ANGRIFFSWOCHE_MEMBER,
        },
        bestand_vorher: bestandVorher,
        bestand_danach: bestandDanach,
        starts_at_utc_unveraendert: zielDanach[0]?.starts_at_utc === startVorher,
        hinweis: "EYT-136 — update/delete entzogen, INSERT an Kanal und planning.write gebunden",
      };
    } catch (e) {
      fehlerAusFall = [e];
    }

    let fehlerAusRueckgabe: unknown = null;
    try {
      const aus = psqlMitMarker(
        verwaltung,
        join(HIER, "eyt136-member-aus.sql"),
        ["-v", `benutzer_b=${idB}`],
        "[eyt136-member-aus]",
      );
      console.log(`  ${aus}`);
    } catch (e) {
      fehlerAusRueckgabe = e;
    }

    // Vorrang fuer den gefaehrlicheren Befund: ein gescheiterter Angriffs-
    // nachweis kostet diesen Lauf, eine ueberlebende Mitgliedschaft macht den
    // nachfolgenden Nachweis „B ist ausgesperrt" gruen-falsch. `cause` haengt
    // den urspruenglichen Fehler an, statt ihn zu verschlucken.
    if (fehlerAusRueckgabe !== null) {
      const grund =
        fehlerAusRueckgabe instanceof Error
          ? fehlerAusRueckgabe.message
          : String(fehlerAusRueckgabe);
      throw new Error(
        `[auth-journey] die geliehene member-Mitgliedschaft ist NICHT zurueckgegeben worden (EYT-136): ${grund}`,
        fehlerAusFall === null ? undefined : { cause: fehlerAusFall[0] },
      );
    }
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

  await test.step("13 — maschinenlesbare Zusammenfassung ablegen", async () => {
    bericht["api_aufrufe"] = apiAufrufe;
    bericht["ergebnis"] = "PASS";
    mkdirSync(ARTEFAKTE, { recursive: true });
    writeFileSync(
      join(ARTEFAKTE, "zusammenfassung.json"),
      `${JSON.stringify(bericht, null, 2)}\n`,
      "utf8",
    );
  });
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
 * ## Zweite Aufgabe seit EYT-136: Gegenprobe auf die Leihgabe in 9c5
 *
 * Schritt 9c5 leiht B fuer seine Dauer eine aktive `member`-Mitgliedschaft und
 * gibt sie unmittelbar danach zurueck. Ueberlebte sie, naennte Bs Sitzung hier
 * eine Organisation und dieser Nachweis wuerde rot — er ist damit die von
 * aussen kommende Kontrolle darauf, dass die Fixtur des Angriffsschritts
 * wirklich abgeraeumt wurde. Dass er DANACH laeuft, folgt aus der
 * Deklarationsreihenfolge in dieser Datei plus `workers: 1` und
 * `fullyParallel: false` in `config.ts`.
 *
 * Der Teardown taugt dafuer NICHT: er loescht alle Mitgliedschaften der
 * Organisation und zaehlt erst danach — eine ueberlebende Leihgabe wuerde dort
 * aufgeraeumt, nicht bemerkt. Die zweite Kontrolle ist deshalb die
 * Nachbedingung in `eyt136-member-aus.sql`.
 */
test("Benutzer B ist angemeldet, aber ohne Mitgliedschaft ausgesperrt", async ({ browser }) => {
  const emailB = pflicht("EASYTREE_JOURNEY_EMAIL_B");
  const passwortB = pflicht("EASYTREE_JOURNEY_PASSWORT_B");
  const idB = pflicht("EASYTREE_JOURNEY_USER_B");
  const idA = pflicht("EASYTREE_JOURNEY_USER_A");

  const kontext = await browser.newContext();
  const seite = await kontext.newPage();
  const bericht: Record<string, unknown> = {};

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

    await test.step("Zusammenfassung von B ablegen", async () => {
      mkdirSync(ARTEFAKTE, { recursive: true });
      writeFileSync(
        join(ARTEFAKTE, "zusammenfassung-b.json"),
        `${JSON.stringify({ ticket: "EYT-106", benutzer: "B", ...bericht, ergebnis: "PASS" }, null, 2)}\n`,
        "utf8",
      );
      await seite.screenshot({ path: join(ARTEFAKTE, "03-benutzer-b-ohne-zugang.png") });
    });
  } finally {
    await kontext.close();
  }
});
