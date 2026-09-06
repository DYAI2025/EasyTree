import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  autorisierungsVerdikt,
  leseReiseEingaben,
  satzFehltFixtureVerdikt,
  satzFehltMitarbeiterBefund,
  satzFehltVerdikt,
  schreibeEvidenz,
  type MitarbeiterEintrag,
} from "./harness-wachen";

/**
 * EYT-142 — reale Admin-Kernreise gegen das VPS/Coolify-Staging.
 *
 * Acht Stationen plus Negativreisen, Screenshots bei 1440/1920 px und
 * axe bei 1440/1920/720 (200-%-Zoom). Jede massgebliche ID kommt aus der
 * SERVER-Antwort (waitForResponse), nie aus dem Bildschirm allein.
 *
 * ## Wiederholbarkeit (Reparatur 26.08.2026)
 *
 * Veroeffentlichte Wochen sind per DB-Trigger unloeschbar — jede Ausfuehrung
 * verbraucht ihre Schreibwochen. Deshalb gibt es hier KEINE fest verdrahteten
 * Wochen mehr: die laufende Woche kommt aus der Uhr (mit der Zeitzonen- und
 * Wochensemantik der Anwendung), die beiden Schreibwochen kommen als
 * Pflicht-Eingaben herein und werden beim LADEN dieser Datei — vor jedem
 * Login und jedem Schreibversuch — auf Frische und Widerspruchsfreiheit
 * geprueft:
 *
 *   EYT_JOURNEY_WOCHE          frische ISO-Woche der Schreibreise (Pflicht)
 *   EYT_JOURNEY_DATUM          optional; Tag IN dieser Woche (sonst ihr Montag)
 *   EYT_SATZ_FEHLT_WOCHE       frische ISO-Woche der Satz-fehlt-Reise (Pflicht)
 *   EYT_SATZ_FEHLT_MITARBEITER optional; Vorgabe ist der KANONISCHE
 *                              Satz-fehlt-Mitarbeiter aus fixtures.sql
 *                              (Employee "…e212"). Uebersteuerung nur fuer
 *                              einen Stack mit abweichendem Altbestand.
 *
 * Ob der Satz-fehlt-Mitarbeiter existiert, aktiv ist und wirklich NULL
 * Satzversionen hat, misst der Pre-flight direkt nach Station 1 ueber die
 * echte API — und bricht ab, BEVOR irgendeine frische Woche veroeffentlicht
 * und damit verbraucht ist.
 *
 * Die Satz-fehlt-Reise erzeugt ihren Zustand selbst ueber die Oberflaeche
 * (Einsatz anlegen -> veroeffentlichen -> Snapshot-Versuch) statt auf
 * einmalig eingespielten Staging-Zustand zu bauen. `ids.json` — der letzte
 * als gut bekannte Stand — wird nur nach einem vollstaendigen gruenen Lauf
 * geschrieben; alles andere landet in `ids.partial-…`.
 */

const EINGABEN = leseReiseEingaben(process.env, new Date());
const EVIDENZ = EINGABEN.evidenzVerzeichnis;
const REISEWOCHE = EINGABEN.reisewocheKey;

/**
 * Feste Organisation der Reise — die UUID aus `fixtures.sql`. Der Pre-flight
 * und die Negativ-Direktzugriffe adressieren sie im Organisations-Header.
 */
const REISE_ORG_ID = "00000000-0000-4000-8000-00000000e201";

const EMAIL_A = process.env["EYT_EMAIL_A"] ?? "auth-journey-a@easytree.test";
const PW_A = process.env["EYT_PW_A"] ?? "";
const EMAIL_B = process.env["EYT_EMAIL_B"] ?? "auth-journey-b@easytree.test";
const PW_B = process.env["EYT_PW_B"] ?? "";
const EMAIL_C = process.env["EYT_EMAIL_C"] ?? "staging-c-member@easytree.test";
const PW_C = process.env["EYT_PW_C"] ?? "";

const BREITEN = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
  { name: "zoom200", width: 720, height: 450 },
] as const;

const protokoll: Record<string, unknown> = {};

function halte(name: string, wert: unknown): void {
  protokoll[name] = wert;
}

async function schnappschuss(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(EVIDENZ, `${name}.png`), fullPage: true });
}

/** Screenshot bei 1440 UND 1920, Zustand bleibt erhalten. */
async function schnappschussBeideBreiten(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await schnappschuss(page, `${name}-1440`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await schnappschuss(page, `${name}-1920`);
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function anmelden(page: Page, email: string, passwort: string): Promise<{ userId: string }> {
  await page.goto("/anmelden");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(passwort);
  const antwort = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/auth/login" && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Anmelden" }).click();
  const login = await antwort;
  expect(login.status(), `Login ${email}`).toBe(200);
  const json = (await login.json()) as { userId?: string; user?: { id?: string } };
  const userId = json.userId ?? json.user?.id ?? "";
  expect(userId).not.toBe("");
  await page.waitForURL((u) => !u.pathname.startsWith("/anmelden"));
  return { userId };
}

async function axeUndReflow(page: Page, flaeche: string): Promise<void> {
  for (const breite of BREITEN) {
    await page.setViewportSize({ width: breite.width, height: breite.height });
    const ergebnis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(
      ergebnis.violations,
      `${flaeche} @${breite.name}: ${JSON.stringify(ergebnis.violations.map((v) => v.id))}`,
    ).toEqual([]);
    // WCAG 1.4.10 Reflow: kein erzwungenes horizontales Scrollen der Seite.
    const uebersteht = await page.evaluate(() => {
      const wurzel = document.scrollingElement;
      return wurzel === null ? true : wurzel.scrollWidth <= wurzel.clientWidth + 1;
    });
    expect(uebersteht, `${flaeche} @${breite.name}: horizontaler Ueberlauf`).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/**
 * Legt einen Baustellentag mit EINER Person ueber das Formular an und liefert
 * die Server-Id der entstandenen Einplanung.
 *
 * Seit EYT-158 ist der Create-Flow worksite-first: Baustelle, Tag, Arbeitszeit,
 * dann das Einsatzteam; der Command geht an `POST /planung/baustellentage` und
 * antwortet mit dem Baustellentag, nicht mit einer Einzelzuweisung. Die
 * Kernreise braucht weiterhin genau eine Person je Tag (Satz-fehlt-Reise,
 * Snapshot-Summen), deshalb bleibt das Team hier einelementig.
 */
async function einsatzAnlegen(
  page: Page,
  eingabe: { mitarbeiter: string; baustelle: string; datum: string },
): Promise<string> {
  // EYT-147: das Formular steht im Inspector und ist erst nach „Baustellentag
  // anlegen" im Baum. Idempotent gegen einen bereits offenen Inspector.
  if ((await page.getByTestId("einsatzformular").count()) === 0) {
    await page.getByTestId("werkbank-einsatz-anlegen").click();
  }
  await page.getByTestId("feld-worksite").selectOption({ label: eingabe.baustelle });
  await page.getByTestId("feld-datum").fill(eingabe.datum);
  await page.getByTestId("feld-beginn").fill("08:00");
  await page.getByTestId("feld-ende").fill("12:00");
  await page.getByTestId("feld-employee").selectOption({ label: eingabe.mitarbeiter });
  const antwort = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/planung/baustellentage" &&
      r.request().method() === "POST",
  );
  await page.getByTestId("einsatz-speichern").click();
  const post = await antwort;
  expect(post.status(), "Baustellentag anlegen").toBe(201);
  const tag = (await post.json()) as {
    worksiteDayId: string;
    team: { assignmentId: string }[];
  };
  expect(tag.worksiteDayId).not.toBe("");
  expect(tag.team, "genau eine Person im Team dieser Kernreise").toHaveLength(1);
  const einplanung = tag.team[0]?.assignmentId ?? "";
  expect(einplanung).not.toBe("");
  // Sichtbar wird der bestaetigte Serverstand: genau EINE Karte fuer den Tag.
  await expect(
    page.locator(`.einsatzkarte[data-worksite-day-id="${tag.worksiteDayId}"]`),
  ).toBeVisible();
  return einplanung;
}

test.describe.serial("EYT-142 Staging-Kernreise", () => {
  let seite: Page;
  let kontext: BrowserContext;
  let publishedVersionId = "";
  let assignmentId = "";
  let snapshotId = "";
  let snapshotSumme = "";
  // Evidenz-Integritaet: `ids.json` (letzter als gut bekannter Stand) wird nur
  // ueberschrieben, wenn ALLE Tests liefen und keiner scheiterte. Ein halber
  // Lauf schreibt stattdessen eine eindeutig benannte Partial-Datei.
  let einTestScheiterte = false;
  let letzteStationErreicht = false;

  test.beforeAll(async ({ browser }) => {
    mkdirSync(EVIDENZ, { recursive: true });
    kontext = await browser.newContext();
    seite = await kontext.newPage();
  });

  // Playwright verlangt fuer den Fixture-Parameter das Objektmuster, auch
  // wenn keine Fixture gebraucht wird — daher das leere Muster.
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) einTestScheiterte = true;
  });

  test.afterAll(async () => {
    const ergebnis = schreibeEvidenz(
      EVIDENZ,
      protokoll,
      letzteStationErreicht && !einTestScheiterte,
    );
    console.log(
      `[staging-evidenz] ${ergebnis.kanonisch ? "vollstaendiger gruener Lauf" : "PARTIAL — ids.json bleibt unangetastet"}: ${ergebnis.datei}`,
    );
    await kontext.close();
  });

  test("Station 1 — Anmelden mit realer Supabase-Session", async () => {
    const { userId } = await anmelden(seite, EMAIL_A, PW_A);
    halte("station1_userId_A", userId);
    await schnappschuss(seite, "01-angemeldet-1440");
  });

  test("Pre-flight — Satz-fehlt-Fixture existiert, ist aktiv und hat NULL Satzversionen", async () => {
    // VOR jedem Schreibversuch und jedem Publish: fehlt die Fixture oder hat
    // der Mitarbeiter inzwischen einen Satz, bricht die Reise HIER ab —
    // keine frische Woche wird verbraucht, kein halber Zustand entsteht.
    // Gemessen wird ueber die echte API (dieselben autorisierten Lesepfade,
    // die auch die Satzverwaltung benutzt), nicht ueber einen DB-Zugriff.
    const orgHeader = { "X-EasyTree-Organization-Id": REISE_ORG_ID };
    const listenAntwort = await seite.request.get("/api/v1/kosten/mitarbeiter", {
      headers: orgHeader,
    });
    expect(listenAntwort.status(), "Mitarbeiterliste fuer den Pre-flight").toBe(200);
    const liste = (await listenAntwort.json()) as { employees: MitarbeiterEintrag[] };
    const befund = satzFehltMitarbeiterBefund(liste.employees, EINGABEN.satzFehltMitarbeiter);
    expect(befund.ok ? null : befund.grund, "Satz-fehlt-Mitarbeiter vorhanden").toBeNull();
    if (!befund.ok) return; // fuer den Typ-Narrowing-Pfad; der expect oben hat schon abgebrochen

    const historienAntwort = await seite.request.get(`/api/v1/kosten/stundensaetze/${befund.id}`, {
      headers: orgHeader,
    });
    expect(historienAntwort.status(), "Satzhistorie fuer den Pre-flight").toBe(200);
    const historie = (await historienAntwort.json()) as { versions: unknown[] };
    expect(
      satzFehltFixtureVerdikt(historie.versions.length),
      "definierende Eigenschaft: NULL Satzversionen",
    ).toBeNull();
    halte("preflight_satz_fehlt_mitarbeiterId", befund.id);
    halte("preflight_satz_fehlt_versionen", historie.versions.length);
  });

  test("Station 2 — /planung ohne weekKey zeigt die aktuelle ISO-Woche", async () => {
    await seite.goto("/planung");
    expect(new URL(seite.url()).search).not.toContain("weekKey");
    // Die Erwartung kommt aus derselben Wochensemantik wie die Anwendung
    // (Europe/Berlin, @easytree/domain) — nicht aus einer festen Woche.
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(EINGABEN.laufendeWocheKey);
    await schnappschussBeideBreiten(seite, "02-planung-aktuelle-woche");
    halte("station2_woche", EINGABEN.laufendeWocheKey);
  });

  test("Station 3 — Wochennavigation vor/zurueck/heute", async () => {
    await seite.getByTestId("wochennavigation-vorherige").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(EINGABEN.vorherigeWocheKey);
    await schnappschuss(seite, "03a-woche-vorherige-1440");
    await seite.getByTestId("wochennavigation-naechste").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(EINGABEN.laufendeWocheKey);
    await seite.getByTestId("wochennavigation-naechste").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(EINGABEN.naechsteWocheKey);
    await schnappschuss(seite, "03b-woche-naechste-1440");
    await seite.getByTestId("wochennavigation-heute").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(EINGABEN.laufendeWocheKey);
    await schnappschuss(seite, "03c-woche-heute-1440");
    halte("station3_wochen", [
      EINGABEN.vorherigeWocheKey,
      EINGABEN.naechsteWocheKey,
      EINGABEN.laufendeWocheKey,
    ]);
  });

  test("Station 4 — Einsatz ueber das Formular anlegen (autorisierter Domain-Command)", async () => {
    // Zur Reisewoche per UI-Navigation, nicht per Hand-URL: von der laufenden
    // Woche aus so oft "Naechste Woche", wie die Eingabepruefung errechnet
    // hat — jede Zwischenwoche wird gegen die Domain-Ableitung gemessen.
    for (const zwischenwoche of EINGABEN.reiseKlickWochen) {
      await seite.getByTestId("wochennavigation-naechste").click();
      await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(zwischenwoche);
    }
    assignmentId = await einsatzAnlegen(seite, {
      mitarbeiter: "E2E-Mitarbeiter Reise",
      baustelle: "E2E-Baustelle Reise",
      datum: EINGABEN.einsatzDatum,
    });
    halte("station4_reisewoche", REISEWOCHE);
    halte("station4_assignmentId", assignmentId);
    await schnappschussBeideBreiten(seite, "04-einsatz-angelegt");
  });

  test("Station 5 — Reload zeigt den Serverstand, denselben Einsatz", async () => {
    const fenster = seite.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/planung/fenster" && r.request().method() === "GET",
    );
    await seite.reload();
    const antwort = await fenster;
    expect(antwort.status()).toBe(200);
    const json = JSON.stringify(await antwort.json());
    expect(json, "Assignment-Id nach Reload in der Serverantwort").toContain(assignmentId);
    await schnappschuss(seite, "05-reload-serverstand-1440");
    halte("station5_reload_enthaelt_assignment", true);
  });

  test("Zwischenstation — Tastatur und Fokus erreichen die tragenden Aktionen", async () => {
    await seite.keyboard.press("Escape");
    const budget = 120;
    const erreicht: string[] = [];
    let fokusPublish = false;
    let fokusFormular = false;
    for (let i = 0; i < budget && !(fokusPublish && fokusFormular); i += 1) {
      await seite.keyboard.press("Tab");
      const testid = await seite.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (testid !== "") erreicht.push(testid);
      if (testid === "planung-veroeffentlichen" && !fokusPublish) {
        fokusPublish = true;
        // Screenshot MIT sichtbarem Fokusring auf der tragenden Aktion.
        await schnappschuss(seite, "06-fokus-publish-1440");
      }
      if (testid === "feld-worksite") fokusFormular = true;
      // EYT-147: das Formular liegt im Inspector. Erreicht die Tastatur den
      // Ausloeser, oeffnet Enter ihn, und der Fokus landet programmatisch im
      // ersten Formularfeld — seit EYT-158 die Baustelle (worksite-first),
      // nicht mehr eine Person. Genau das wird hier mitgemessen.
      if (testid === "werkbank-einsatz-anlegen" && !fokusFormular) {
        await seite.keyboard.press("Enter");
        const nachOeffnen = await seite.evaluate(
          () => document.activeElement?.getAttribute("data-testid") ?? "",
        );
        if (nachOeffnen !== "") erreicht.push(nachOeffnen);
        if (nachOeffnen === "feld-worksite") fokusFormular = true;
      }
    }
    expect(fokusFormular, `Baustellenfeld per Tastatur in <=${budget} Tabs`).toBe(true);
    expect(fokusPublish, `Publish-Knopf per Tastatur in <=${budget} Tabs`).toBe(true);
    halte("tastatur_erreichte_testids", erreicht);
  });

  test("Barrierefreiheit — axe auf /planung (Entwurf) bei 1440/1920/200 %", async () => {
    await axeUndReflow(seite, "/planung Entwurf");
  });

  test("Station 6 — Veroeffentlichen ueber den realen Publish-Command", async () => {
    const knopf = seite.getByTestId("planung-veroeffentlichen");
    await expect(knopf).toBeVisible();
    await knopf.click();
    const erfolg = seite.getByTestId("planung-publish-erfolg");
    await expect(erfolg).toBeVisible();
    publishedVersionId = (await erfolg.getAttribute("data-published-version-id")) ?? "";
    expect(publishedVersionId).not.toBe("");
    halte("station6_publishedVersionId", publishedVersionId);
    await schnappschussBeideBreiten(seite, "07-veroeffentlicht");

    await seite.reload();
    await expect(seite.getByTestId("planungsfenster-version")).toHaveAttribute(
      "data-published-version-id",
      publishedVersionId,
    );
    await expect(seite.getByTestId("planungsfenster-stand")).toHaveAttribute(
      "data-stand",
      "veroeffentlicht",
    );
    await expect(seite.getByTestId("planung-veroeffentlichen")).toHaveCount(0);
  });

  test("Station 7 — /kosten: Snapshot aus der veroeffentlichten Version, keine zweite Wahrheit", async () => {
    await expect(seite.getByTestId("werkbank-kostenuebergang")).toBeVisible();
    await seite.goto("/kosten");
    await seite.getByLabel("Von Woche").fill(REISEWOCHE);
    await seite.getByLabel("Bis Woche").fill(REISEWOCHE);
    const liste = seite.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/planversionen" &&
        r.request().method() === "GET",
    );
    await seite.getByRole("button", { name: "Planversionen laden" }).click();
    const listenAntwort = await liste;
    expect(listenAntwort.status()).toBe(200);
    const versionen = (await listenAntwort.json()) as { versions: { id: string }[] };
    expect(versionen.versions.map((v) => v.id)).toContain(publishedVersionId);

    await seite
      .getByLabel("Veröffentlichte Planversion")
      .selectOption({ value: publishedVersionId });
    const erzeugt = seite.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/snapshots" && r.request().method() === "POST",
    );
    await seite.getByRole("button", { name: "Snapshot erzeugen" }).click();
    const post = await erzeugt;
    expect(post.status(), "Snapshot erzeugen").toBe(201);
    const snap = (await post.json()) as {
      id: string;
      planVersionId: string;
      totalMinorUnits: string;
      positions: unknown[];
    };
    snapshotId = snap.id;
    snapshotSumme = snap.totalMinorUnits;
    expect(snap.planVersionId).toBe(publishedVersionId);
    // 4 h x 4250 Minor Units = 17000 — nachgerechnet, nicht zurueckgelesen.
    expect(snap.totalMinorUnits).toBe("17000");
    expect(snap.positions.length).toBeGreaterThanOrEqual(1);

    const ansicht = seite.getByTestId("kosten-snapshot");
    await expect(ansicht).toBeVisible();
    await expect(ansicht).toHaveAttribute("data-snapshot-id", snapshotId);
    await expect(seite.getByTestId("kosten-gesamtsumme")).toContainText("170,00");
    await expect(seite.getByTestId("kosten-planversion-id")).toHaveText(publishedVersionId);
    // EYT-141: Zahlen VOR der Herkunft — Dokumentreihenfolge im realen DOM.
    const reihenfolge = await seite.evaluate(() => {
      const summe = document.querySelector('[data-testid="kosten-gesamtsumme"]');
      const herkunft = document.querySelector('[data-testid="kosten-herkunft"]');
      if (summe === null || herkunft === null) return false;
      return (summe.compareDocumentPosition(herkunft) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(reihenfolge, "Gesamtsumme steht im DOM vor der Herkunft").toBe(true);
    halte("station7_snapshotId", snapshotId);
    halte("station7_totalMinorUnits", snapshotSumme);
    await schnappschussBeideBreiten(seite, "08-kosten-snapshot");
  });

  test("Barrierefreiheit — axe auf /kosten mit Snapshot bei 1440/1920/200 %", async () => {
    await axeUndReflow(seite, "/kosten mit Snapshot");
  });

  test("Station 8 — zweiter Browserkontext sieht dieselben IDs", async ({ browser }) => {
    const zweiter = await browser.newContext();
    try {
      const seite2 = await zweiter.newPage();
      await anmelden(seite2, EMAIL_A, PW_A);
      await seite2.goto(`/planung?weekKey=${REISEWOCHE}`);
      await expect(seite2.getByTestId("planungsfenster-version")).toHaveAttribute(
        "data-published-version-id",
        publishedVersionId,
      );
      await seite2.goto(`/kosten?snapshot=${snapshotId}`);
      const ansicht = seite2.getByTestId("kosten-snapshot");
      await expect(ansicht).toBeVisible();
      await expect(ansicht).toHaveAttribute("data-snapshot-id", snapshotId);
      await expect(seite2.getByTestId("kosten-gesamtsumme")).toContainText("170,00");
      await schnappschuss(seite2, "09-zweiter-kontext-kosten-1440");
      halte("station8_zweiter_kontext", { publishedVersionId, snapshotId });
    } finally {
      await zweiter.close();
    }
  });

  test("Negativ B — echter Benutzer OHNE Mitgliedschaft sieht keine Mandantendaten", async ({
    browser,
  }) => {
    const kontextB = await browser.newContext();
    try {
      const seiteB = await kontextB.newPage();
      const { userId } = await anmelden(seiteB, EMAIL_B, PW_B);
      halte("negativ_b_userId", userId);
      await seiteB.goto(`/planung?weekKey=${REISEWOCHE}`);
      await expect(seiteB.getByTestId("planung-org-erforderlich")).toBeVisible();
      await expect(seiteB.getByTestId("planungsfenster-liste")).toHaveCount(0);
      await seiteB.goto("/kosten");
      // Ohne Mitgliedschaft gibt es keine waehlbare Organisation: die Flaeche
      // stoppt VOR jedem Datenabruf im Organisationszustand — fail-closed.
      await expect(seiteB.getByRole("status")).toContainText("Organisation wählen");
      const inhalt = await seiteB.content();
      expect(inhalt).not.toContain("E2E Reiseorganisation");
      expect(inhalt).not.toContain(snapshotId);
      expect(inhalt).not.toContain("170,00");
      // Serverseitiger Beweis: B fordert den Snapshot DIREKT an, mit
      // gefaelschtem Organisations-Header. Die Mitgliedschaftspruefung des
      // Servers muss mit GENAU 403 ablehnen — ein 5xx waere ein Serverfehler
      // und kein Autorisierungsnachweis.
      const direkt = await seiteB.request.get(`/api/v1/kosten/snapshots/${snapshotId}`, {
        headers: { "X-EasyTree-Organization-Id": REISE_ORG_ID },
      });
      expect(
        autorisierungsVerdikt(direkt.status()),
        "Snapshot-Zugriff ohne Mitgliedschaft",
      ).toBeNull();
      const direktText = await direkt.text();
      expect(direktText).not.toContain("totalMinorUnits");
      halte("negativ_b_direktzugriff_status", direkt.status());
      await schnappschuss(seiteB, "10-negativ-ohne-mitgliedschaft-1440");
    } finally {
      await kontextB.close();
    }
  });

  test("Negativ C — member ohne costs.read: kein Kostenuebergang, keine Betraege", async ({
    browser,
  }) => {
    const kontextC = await browser.newContext();
    try {
      const seiteC = await kontextC.newPage();
      const { userId } = await anmelden(seiteC, EMAIL_C, PW_C);
      halte("negativ_c_userId", userId);
      await seiteC.goto(`/planung?weekKey=${REISEWOCHE}`);
      await expect(seiteC.getByTestId("planung-forbidden")).toBeVisible();
      await expect(seiteC.getByTestId("werkbank-kostenuebergang")).toHaveCount(0);
      await seiteC.goto("/kosten");
      await expect(seiteC.getByTestId("kosten-forbidden")).toBeVisible();
      const inhalt = await seiteC.content();
      expect(inhalt).not.toContain("170,00");
      expect(inhalt).not.toContain(snapshotId);
      // Serverseitiger Beweis: member ist Mitglied, hat aber kein costs.read —
      // der direkte Snapshot-Abruf muss trotzdem mit GENAU 403 abgelehnt
      // werden; ein 5xx zaehlt nicht als Ablehnung.
      const direkt = await seiteC.request.get(`/api/v1/kosten/snapshots/${snapshotId}`, {
        headers: { "X-EasyTree-Organization-Id": REISE_ORG_ID },
      });
      expect(autorisierungsVerdikt(direkt.status()), "Snapshot-Zugriff ohne costs.read").toBeNull();
      expect(await direkt.text()).not.toContain("totalMinorUnits");
      halte("negativ_c_direktzugriff_status", direkt.status());
      await schnappschuss(seiteC, "11-negativ-member-ohne-kostenrecht-1440");
    } finally {
      await kontextC.close();
    }
  });

  test("Negativ Satz fehlt — Snapshot bricht fail-closed, nirgends 0,00", async () => {
    // Der Zustand entsteht IN der Reise selbst, ueber dieselben autorisierten
    // Domain-Commands wie Station 4/6: ein Einsatz fuer den satzlosen
    // Mitarbeiter in einer eigenen frischen Woche, dann veroeffentlichen.
    // Kein einmalig eingespielter Staging-Zustand, kein direkter DB-Schreib.
    await seite.goto(`/planung?weekKey=${EINGABEN.satzFehltWocheKey}`);
    const einsatzOhneSatz = await einsatzAnlegen(seite, {
      mitarbeiter: EINGABEN.satzFehltMitarbeiter,
      baustelle: "E2E-Baustelle Reise",
      datum: EINGABEN.satzFehltDatum,
    });
    halte("satz_fehlt_woche", EINGABEN.satzFehltWocheKey);
    halte("satz_fehlt_assignmentId", einsatzOhneSatz);

    // Wie in Station 5 -> 6: erst der Reload zeigt verlaesslich den
    // Serverstand samt Entwurf, an dem der Publish-Knopf haengt.
    await seite.reload();
    const knopf = seite.getByTestId("planung-veroeffentlichen");
    await expect(knopf).toBeVisible();
    await knopf.click();
    const erfolg = seite.getByTestId("planung-publish-erfolg");
    await expect(erfolg).toBeVisible();
    const versionOhneSatz = (await erfolg.getAttribute("data-published-version-id")) ?? "";
    expect(versionOhneSatz).not.toBe("");
    halte("satz_fehlt_versionId", versionOhneSatz);

    await seite.goto("/kosten");
    await seite.getByLabel("Von Woche").fill(EINGABEN.satzFehltWocheKey);
    await seite.getByLabel("Bis Woche").fill(EINGABEN.satzFehltWocheKey);
    await seite.getByRole("button", { name: "Planversionen laden" }).click();
    await seite.getByLabel("Veröffentlichte Planversion").selectOption({ value: versionOhneSatz });
    const antwort = seite.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/snapshots" && r.request().method() === "POST",
    );
    await seite.getByRole("button", { name: "Snapshot erzeugen" }).click();
    const post = await antwort;
    const problem = (await post.json()) as { type?: string; title?: string };
    // Gemessener Vertrag der Abnahme: GENAU 409 mit dem rate-not-found-URN.
    // Ein 5xx oder ein anderes Problem-Dokument ist KEIN fail-closed-Nachweis.
    expect(
      satzFehltVerdikt(post.status(), problem.type),
      "Snapshot MUSS typisiert abgelehnt werden",
    ).toBeNull();
    halte("satz_fehlt_status", post.status());
    halte("satz_fehlt_problem", problem);
    await expect(seite.getByTestId("kosten-snapshot-fehler")).toBeVisible();
    const inhalt = await seite.content();
    expect(inhalt, "niemals 0,00 als erfundener Betrag").not.toContain("0,00");
    await schnappschussBeideBreiten(seite, "12-negativ-satz-fehlt");
    // Erst hier gilt der Lauf als vollstaendig — `ids.json` schreibt das
    // afterAll nur, wenn zusaetzlich kein Test scheiterte.
    letzteStationErreicht = true;
  });
});
