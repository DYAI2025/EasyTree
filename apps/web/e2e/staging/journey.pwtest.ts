import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * EYT-142 — reale Admin-Kernreise gegen das VPS/Coolify-Staging.
 *
 * Acht Stationen plus Negativreisen, Screenshots bei 1440/1920 px und
 * axe bei 1440/1920/720 (200-%-Zoom). Jede massgebliche ID kommt aus der
 * SERVER-Antwort (waitForResponse), nie aus dem Bildschirm allein.
 */

const EVIDENZ = process.env["EYT_EVIDENCE_DIR"] ?? "/tmp/eyt-142-evidence";
const WOCHE = "2026-W35";
// Schreibreise in einer FRISCHEN Woche: veroeffentlichte Wochen sind per
// DB-Trigger unloeschbar, jede Ausfuehrung braucht eine eigene ISO-Woche.
const REISEWOCHE = process.env["EYT_JOURNEY_WOCHE"] ?? "2026-W37";
const SATZ_FEHLT_WOCHE = "2026-W38";
const EINSATZ_DATUM = process.env["EYT_JOURNEY_DATUM"] ?? "2026-09-09";

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

test.describe.serial("EYT-142 Staging-Kernreise", () => {
  let seite: Page;
  let kontext: BrowserContext;
  let publishedVersionId = "";
  let assignmentId = "";
  let snapshotId = "";
  let snapshotSumme = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(EVIDENZ, { recursive: true });
    kontext = await browser.newContext();
    seite = await kontext.newPage();
  });

  test.afterAll(async () => {
    writeFileSync(join(EVIDENZ, "ids.json"), JSON.stringify(protokoll, null, 2));
    await kontext.close();
  });

  test("Station 1 — Anmelden mit realer Supabase-Session", async () => {
    const { userId } = await anmelden(seite, EMAIL_A, PW_A);
    halte("station1_userId_A", userId);
    await schnappschuss(seite, "01-angemeldet-1440");
  });

  test("Station 2 — /planung ohne weekKey zeigt die aktuelle ISO-Woche", async () => {
    await seite.goto("/planung");
    expect(new URL(seite.url()).search).not.toContain("weekKey");
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(WOCHE);
    await schnappschussBeideBreiten(seite, "02-planung-aktuelle-woche");
    halte("station2_woche", WOCHE);
  });

  test("Station 3 — Wochennavigation vor/zurueck/heute", async () => {
    await seite.getByTestId("wochennavigation-vorherige").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText("2026-W34");
    await schnappschuss(seite, "03a-woche-vorherige-1440");
    await seite.getByTestId("wochennavigation-naechste").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText("2026-W35");
    await seite.getByTestId("wochennavigation-naechste").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText("2026-W36");
    await schnappschuss(seite, "03b-woche-naechste-1440");
    await seite.getByTestId("wochennavigation-heute").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(WOCHE);
    await schnappschuss(seite, "03c-woche-heute-1440");
    halte("station3_wochen", ["2026-W34", "2026-W36", WOCHE]);
  });

  test("Station 4 — Einsatz ueber das Formular anlegen (autorisierter Domain-Command)", async () => {
    // Zur Reisewoche per UI-Navigation, nicht per Hand-URL: von W35 aus
    // zweimal "Naechste Woche".
    await seite.getByTestId("wochennavigation-naechste").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText("2026-W36");
    await seite.getByTestId("wochennavigation-naechste").click();
    await expect(seite.getByTestId("werkbank-woche-iso")).toContainText(REISEWOCHE);
    await seite.getByTestId("feld-employee").selectOption({ label: "E2E-Mitarbeiter Reise" });
    await seite.getByTestId("feld-worksite").selectOption({ label: "E2E-Baustelle Reise" });
    await seite.getByTestId("feld-datum").fill(EINSATZ_DATUM);
    await seite.getByTestId("feld-beginn").fill("08:00");
    await seite.getByTestId("feld-ende").fill("12:00");
    const antwort = seite.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/planung/einsaetze" &&
        r.request().method() === "POST",
    );
    await seite.getByTestId("einsatz-speichern").click();
    const post = await antwort;
    expect(post.status(), "Einsatz anlegen").toBe(201);
    const einsatz = (await post.json()) as { id: string };
    assignmentId = einsatz.id;
    expect(assignmentId).not.toBe("");
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
    let fokusEmployee = false;
    for (let i = 0; i < budget && !(fokusPublish && fokusEmployee); i += 1) {
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
      if (testid === "feld-employee") fokusEmployee = true;
    }
    expect(fokusEmployee, `Formularfeld per Tastatur in <=${budget} Tabs`).toBe(true);
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
      // Servers muss ablehnen — unabhaengig von jeder Oberflaeche.
      const direkt = await seiteB.request.get(`/api/v1/kosten/snapshots/${snapshotId}`, {
        headers: { "X-EasyTree-Organization-Id": "00000000-0000-4000-8000-00000000e201" },
      });
      expect(direkt.status(), "Snapshot-Zugriff ohne Mitgliedschaft").toBeGreaterThanOrEqual(403);
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
      // der direkte Snapshot-Abruf muss trotzdem abgelehnt werden.
      const direkt = await seiteC.request.get(`/api/v1/kosten/snapshots/${snapshotId}`, {
        headers: { "X-EasyTree-Organization-Id": "00000000-0000-4000-8000-00000000e201" },
      });
      expect(direkt.status(), "Snapshot-Zugriff ohne costs.read").toBeGreaterThanOrEqual(403);
      expect(await direkt.text()).not.toContain("totalMinorUnits");
      halte("negativ_c_direktzugriff_status", direkt.status());
      await schnappschuss(seiteC, "11-negativ-member-ohne-kostenrecht-1440");
    } finally {
      await kontextC.close();
    }
  });

  test("Negativ Satz fehlt — Snapshot bricht fail-closed, nirgends 0,00", async () => {
    await seite.goto(`/planung?weekKey=${SATZ_FEHLT_WOCHE}`);
    const knopf = seite.getByTestId("planung-veroeffentlichen");
    await expect(knopf).toBeVisible();
    await knopf.click();
    const erfolg = seite.getByTestId("planung-publish-erfolg");
    await expect(erfolg).toBeVisible();
    const versionW38 = (await erfolg.getAttribute("data-published-version-id")) ?? "";
    expect(versionW38).not.toBe("");
    halte("satz_fehlt_versionId", versionW38);

    await seite.goto("/kosten");
    await seite.getByLabel("Von Woche").fill(SATZ_FEHLT_WOCHE);
    await seite.getByLabel("Bis Woche").fill(SATZ_FEHLT_WOCHE);
    await seite.getByRole("button", { name: "Planversionen laden" }).click();
    await seite.getByLabel("Veröffentlichte Planversion").selectOption({ value: versionW38 });
    const antwort = seite.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/snapshots" && r.request().method() === "POST",
    );
    await seite.getByRole("button", { name: "Snapshot erzeugen" }).click();
    const post = await antwort;
    expect(post.status(), "Snapshot MUSS abgelehnt werden").toBeGreaterThanOrEqual(400);
    const problem = (await post.json()) as { type?: string; title?: string };
    halte("satz_fehlt_problem", problem);
    await expect(seite.getByTestId("kosten-snapshot-fehler")).toBeVisible();
    const inhalt = await seite.content();
    expect(inhalt, "niemals 0,00 als erfundener Betrag").not.toContain("0,00");
    await schnappschussBeideBreiten(seite, "12-negativ-satz-fehlt");
  });
});
