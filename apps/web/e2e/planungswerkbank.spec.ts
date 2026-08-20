import { expect, test, type Page } from "@playwright/test";

import { fensterMitEntwurf, sitzungMit } from "../test/helpers/werkbank-daten";

/**
 * REQ-002 — die Wochennavigation im ECHTEN Browser (EYT-140, `AC-003`, `AC-004`).
 *
 * ## Was dieser Nachweis ist — und was er ausdruecklich nicht ist
 *
 * Echt sind hier: Chromium, der Produktionsbuild (`next start`), das
 * ausgelieferte Clientbuendel, Hydration, Fokus und Tastatur. Genau diese
 * Schicht kann jsdom nicht: ein Wochenwechsel ueber `<Link>` oder
 * `router.push` laeuft dort durch eine Nachbildung, hier durch den echten App
 * Router.
 *
 * Ersetzt ist die API: der Job `web-smoke` startet nur `next start`, ohne API,
 * ohne Datenbank, ohne Auth-Server (`apps/web/playwright.config.ts:17-27`). Die
 * beiden benoetigten Antworten kommen deshalb aus `page.route`. **Das ist kein
 * Reisebeweis.** Die Reise ueber Web → Gateway → API → PostgreSQL/RLS beweisen
 * `read-through` und `auth-journey` gegen echte Server; sie kennen die
 * Wochennavigation noch nicht und muessen sie in Slice 1 mitnehmen (siehe
 * Befundliste im Abschlussbericht). Was hier bewiesen wird, ist enger und
 * trotzdem noetig: dass die Navigation im Browser BEDIENBAR ist und dass die
 * angezeigte Woche und die angefragte Woche dieselbe sind.
 *
 * ## Warum keine absoluten Wochenschluessel
 *
 * Die Maschinenuhr ist hier nicht festgesetzt. Statt eine Woche zu erwarten,
 * prueft dieser Nachweis die KOPPLUNG: was auf dem Schirm steht, ist das, wonach
 * der Client gefragt hat, und ein Klick verschiebt beides gemeinsam. Die
 * absolute Wochenrechnung samt Jahreswechsel prueft
 * `apps/web/test/wochennavigation.test.tsx` mit fester Uhr.
 *
 * ## Gegenmutation (Phase 1)
 *
 * In der Wochennavigation den Anfrageschluessel und den Anzeigetext aus zwei
 * verschiedenen Quellen speisen (z. B. Anzeige aus dem Clientzustand, Anfrage
 * aus der Adresse) → „was angezeigt wird, ist die Woche, nach der gefragt
 * wurde" geht rot. Heute nicht ausfuehrbar: es gibt keine Navigation.
 */

const SITZUNG = sitzungMit(["planning.read", "planning.write", "planning.publish"]);

const ISO_MUSTER = /\d{4}-W\d{2}/;

/** Antworten der beiden Routen, die die Werkbank braucht, plus Protokoll. */
async function apiStellen(page: Page): Promise<string[]> {
  const gefragteWochen: string[] = [];

  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SITZUNG),
    });
  });

  await page.route("**/api/v1/planung/fenster*", async (route) => {
    const weekKey = new URL(route.request().url()).searchParams.get("weekKey") ?? "";
    gefragteWochen.push(weekKey);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fensterMitEntwurf(weekKey, [])),
    });
  });

  return gefragteWochen;
}

/**
 * Ein Bedienelement der Navigation — Schaltflaeche oder Link.
 *
 * Beides ist zulaessig: eine Umsetzung ueber die Adresse ist ein Link, eine
 * ueber Clientzustand eine Schaltflaeche. Der Nachweis misst das Ergebnis.
 */
function bedienelement(page: Page, name: string) {
  return page.getByRole("button", { name }).or(page.getByRole("link", { name }));
}

function isoWoche(text: string | null): string {
  const treffer = ISO_MUSTER.exec(text ?? "");
  if (treffer === null) {
    throw new Error(`Kein ISO-Wochenschluessel gefunden. Gelesen wurde: ${text ?? "(nichts)"}`);
  }
  return treffer[0];
}

test.describe("REQ-002 — Wochenwerkbank im Browser", () => {
  test("AC-003: der Einstieg ohne technischen Parameter zeigt Woche und Zeitraum", async ({
    page,
  }) => {
    const gefragteWochen = await apiStellen(page);

    // Ohne Query — genau so, wie die Planerin den Punkt in der Navigation
    // anklickt.
    await page.goto("/planung");

    const woche = page.getByTestId("werkbank-woche-iso");
    await expect(woche).toBeVisible();
    await expect(page.getByTestId("werkbank-woche-bereich")).toBeVisible();
    // Der Zeitraum nennt zwei Datumsangaben — Anfang und Ende der Woche.
    const bereich = (await page.getByTestId("werkbank-woche-bereich").textContent()) ?? "";
    expect(bereich.match(/\d{2}\.\d{2}\.\d{4}/g) ?? []).toHaveLength(2);

    expect(gefragteWochen).toHaveLength(1);
    expect(isoWoche(await woche.textContent())).toBe(gefragteWochen[0]);
  });

  test("AC-004: Wochenwechsel vorwaerts verschiebt Anzeige und Serverabfrage gemeinsam", async ({
    page,
  }) => {
    const gefragteWochen = await apiStellen(page);
    await page.goto("/planung");
    const woche = page.getByTestId("werkbank-woche-iso");
    await expect(woche).toBeVisible();
    const einstiegswoche = isoWoche(await woche.textContent());

    await bedienelement(page, "Nächste Woche").click();

    await expect(woche).not.toHaveText(new RegExp(einstiegswoche));
    const neueWoche = isoWoche(await woche.textContent());
    expect(neueWoche).not.toBe(einstiegswoche);
    // Die Kopplung: angezeigt wird die Woche, nach der auch gefragt wurde.
    expect(gefragteWochen.at(-1)).toBe(neueWoche);
  });

  test("AC-004: Heute fuehrt zurueck zur Einstiegswoche", async ({ page }) => {
    await apiStellen(page);
    await page.goto("/planung");
    const woche = page.getByTestId("werkbank-woche-iso");
    await expect(woche).toBeVisible();
    const einstiegswoche = isoWoche(await woche.textContent());

    await bedienelement(page, "Nächste Woche").click();
    await expect(woche).not.toHaveText(new RegExp(einstiegswoche));
    await bedienelement(page, "Heute").click();

    await expect(woche).toHaveText(new RegExp(einstiegswoche));
  });

  test("AC-004: die Navigation ist mit der Tastatur bedienbar", async ({ page }) => {
    await apiStellen(page);
    await page.goto("/planung");
    const woche = page.getByTestId("werkbank-woche-iso");
    await expect(woche).toBeVisible();
    const einstiegswoche = isoWoche(await woche.textContent());

    // Fokus setzen wie eine Tastaturnutzerin: erst hin, dann ausloesen.
    const weiter = bedienelement(page, "Nächste Woche");
    await weiter.focus();
    await expect(weiter).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(woche).not.toHaveText(new RegExp(einstiegswoche));
  });
});
