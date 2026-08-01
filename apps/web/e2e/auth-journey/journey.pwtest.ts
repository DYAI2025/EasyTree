import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Cookie } from "@playwright/test";

/**
 * Die reale Auth-Kostenreise (EYT-106 AK8, EYT-134).
 *
 * Browser -> echte Loginseite -> GoTrue -> HttpOnly-Cookies -> Next-Rewrite ->
 * echte NestJS-API -> Policy -> RLS -> PostgreSQL. Kein Schritt ist ersetzt.
 *
 * ## Was diese Datei beweist, was `read-through.spec.ts` nicht kann
 *
 * Der Read-Through-Nachweis startet `dist-harness/test/harness/main.js` und
 * gibt das Subjekt als `process.argv[2]` mit; Subjektresolver und
 * Access-Policy sind dort ersetzt. Er beweist den DATENWEG, nicht die
 * Identitaet. Hier laeuft `dist/main.js` — die echte Kette mit
 * Tokenverifikation (ES256 gegen den GoTrue-JWKS), Liveness-Pruefung bei jeder
 * Anfrage und der realen Kostenpolicy.
 *
 * Der erste Schritt misst das nach, statt es zu behaupten: gegen den Harness
 * lieferte eine Anfrage OHNE Cookie eine 200 mit Daten. Liefert sie 401, kann
 * kein Subjekt eingeschleust sein.
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
 * - Die API als `dist-harness/...` starten (Schritt 1 wird gruen statt 401 —
 *   und genau deshalb ist Schritt 1 eine Zusicherung auf 401).
 * - `serializeAccessCookie` ohne `HttpOnly` (Schritt 4).
 * - `SameSite=Lax` statt `Strict` (Schritt 4).
 * - Die Kosten-Navigation unabhaengig von `costs.read` rendern (Schritt 6
 *   bliebe gruen, aber Schritt 11 nach dem Abmelden wuerde rot).
 * - Das Logout ohne loeschende Cookies (Schritt 12).
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
/** 4250 Minor Units, so wie `minorUnitsToEuro` sie deutsch formatiert. */
const ERWARTETER_BETRAG = "42,50 €";
/** Eine Organisation, in der der Reisende NICHT Mitglied ist. */
const FREMDE_ORG = "00000000-0000-4000-8000-0000000000b2";

function pflicht(name: string): string {
  const wert = process.env[name];
  if (wert === undefined || wert === "") {
    throw new Error(`[auth-journey] ${name} fehlt — global-setup.ts hat nicht gelaufen?`);
  }
  return wert;
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

test("Reale Auth-Kostenreise vom Login bis zur ungueltigen Sitzung", async ({ page, context }) => {
  const email = pflicht("EASYTREE_JOURNEY_EMAIL");
  const passwort = pflicht("EASYTREE_JOURNEY_PASSWORT");
  const benutzerId = pflicht("EASYTREE_JOURNEY_USER_ID");

  /** Jede API-Anfrage des Browsers — Beleg dafuer, WELCHEN Weg die Daten nahmen. */
  const apiAufrufe: string[] = [];
  page.on("request", (anfrage) => {
    const pfad = new URL(anfrage.url()).pathname;
    if (pfad.startsWith("/api/")) apiAufrufe.push(`${anfrage.method()} ${pfad}`);
  });

  const bericht: Record<string, unknown> = { ticket: "EYT-106", paket: "B", schritte: {} };
  const schritte = bericht["schritte"] as Record<string, unknown>;

  await test.step("1 — ohne Anmeldung lehnt die ECHTE API ab (kein injiziertes Subjekt)", async () => {
    // Der entscheidende Nachweis. Mit dem Testharness (dist-harness) waere
    // hier 200 und eine Mitarbeiterliste zu sehen: er ersetzt Subjektresolver
    // und Access-Policy. Eine 401 ist nur moeglich, wenn die echte
    // Identitaetskette laeuft.
    const ohneSitzung = await page.request.get("/api/v1/kosten/mitarbeiter");
    expect(ohneSitzung.status()).toBe(401);
    schritte["1_ohne_anmeldung"] = { status: ohneSitzung.status(), erwartet: 401 };
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
