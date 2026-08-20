import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "320px (200%-Zoom-Aequivalent)", width: 320, height: 720 },
  { name: "375px (mobile Kernbreite)", width: 375, height: 812 },
];

/**
 * Im Smoke laeuft KEINE API: der Health-Check der Shell schlaegt fehl.
 * Die App BEHANDELT das (Fehlerzustand "API nicht erreichbar", kein
 * eigenes console.error) — Chromium meldet den fehlgeschlagenen
 * Netzwerk-Request aber trotzdem als browsergenerierten Console-Fehler.
 *
 * Seit dem Same-Origin-Rewrite (EYT-50) kommt dieser Fehler unter der Origin
 * der Web-App an, mit HTTP 500: Next versucht weiterzuleiten und findet keine
 * API. Gefiltert wird deshalb ueber den PFAD, nicht ueber die Origin.
 *
 * Ein Vergleich der Origin-Zeichenkette hatte hier schon einen roten Lauf
 * gekostet: der Test rechnete mit "http://localhost:3000", Playwright meldete
 * "http://127.0.0.1:3000". Beide sind dieselbe Adresse und verschiedene
 * Zeichenketten.
 *
 * Seit EYT-106 gehoert `/api/v1/auth/session` dazu: die Shell fragt beim
 * Laden die reale Sitzung ab. Ohne API scheitert auch dieser Aufruf — und
 * wird ebenso BEHANDELT (die Kopfleiste zeigt dann "Anmelden" statt eines
 * Benutzerbereichs). Der Test unten belegt das mit einer eigenen Zusicherung,
 * damit die Filterzeile hier keinen unbehandelten Fehler verdeckt.
 */
const PROXIED_OPERATIONAL_PATHS = new Set(["/health", "/ready", "/api/v1/auth/session"]);

/** Ist die Meldung der gehandelte Ausfall einer Betriebsschnittstelle? */
function istGehandelterBetriebsfehler(url: string): boolean {
  try {
    // Basis nur, damit relative Meldungen parsebar sind; nur der Pfad zaehlt.
    return PROXIED_OPERATIONAL_PATHS.has(new URL(url, "http://ignoriert.invalid").pathname);
  } catch {
    return false;
  }
}

test("laedt ohne ungefangene Console-Fehler", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (istGehandelterBetriebsfehler(msg.location().url)) return; // s. o.
    errors.push(`${msg.text()} (${msg.location().url})`);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  // Beweis, dass der fehlgeschlagene Health-Check gehandelt ist:
  await expect(page.getByRole("status")).toHaveText(/API nicht erreichbar/);
  // Beweis, dass auch die fehlgeschlagene Sitzungsabfrage gehandelt ist
  // (EYT-106): die Kopfleiste zeigt den Anmelden-Zugang, keinen leeren
  // Benutzerbereich — und "Kosten" erscheint ohne Recht gar nicht erst.
  await expect(page.getByRole("link", { name: "Anmelden" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kosten" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Tastatur: Skip-Link ist erstes Tab-Ziel und springt zu #hauptinhalt", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.locator("a[href='#hauptinhalt']");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#hauptinhalt")).toBeFocused();
});

test("sichtbarer Fokus auf interaktiven Elementen", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth };
  });
  expect(outline.outlineStyle).not.toBe("none");
  expect(parseFloat(outline.outlineWidth)).toBeGreaterThan(0);
});

for (const vp of VIEWPORTS) {
  test(`kein horizontales Scrollen bei ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("Statusanzeige traegt Information nicht nur ueber Farbe", async ({ page }) => {
  await page.goto("/");
  const status = page.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).not.toHaveText(/^\s*$/); // Textinhalt, nicht nur Farbe
});

test("Tab-Zyklus: alle interaktiven Elemente erreichbar, sichtbarer Fokus, keine Falle", async ({
  page,
}) => {
  await page.goto("/");
  // Alle fokussierbaren Elemente in DOM-Reihenfolge (Checkliste #1/#2).
  const expected = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    ).map((el) => `${el.tagName}:${el.getAttribute("href") ?? el.textContent?.trim()}`),
  );
  expect(expected.length).toBeGreaterThan(0);

  const visited: string[] = [];
  for (let i = 0; i < expected.length; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      // `outline-width: auto` ist der Browser-Fokusring und ein ECHTER
      // Indikator; `parseFloat("auto")` ist aber `NaN`, und `NaN > 0` ist
      // `false`. Ohne den `auto`-Zweig meldet diese Sonde ihn als fehlend.
      // Hier faellt das nicht auf, weil `/` kein Bedienelement mit
      // `outline-width: auto` enthaelt — auf `/planung` schon (EYT-141).
      const visibleFocus =
        (s.outlineStyle !== "none" &&
          (s.outlineWidth === "auto" || parseFloat(s.outlineWidth) > 0)) ||
        s.boxShadow !== "none";
      return {
        id: `${el.tagName}:${el.getAttribute("href") ?? el.textContent?.trim()}`,
        visibleFocus,
      };
    });
    visited.push(stop.id);
    expect(stop.visibleFocus, `Fokusindikator fehlt auf ${stop.id}`).toBe(true);
  }
  // Jedes interaktive Element wurde genau in DOM-Reihenfolge erreicht;
  // Reihenfolge: Skip-Link zuerst, dann Navigation (Checkliste #2).
  expect(visited).toEqual(expected);
  expect(visited[0]).toContain("#hauptinhalt");
  // Keine Tastaturfalle: der naechste Tab verlaesst das letzte Element.
  await page.keyboard.press("Tab");
  const after = await page.evaluate(
    () => `${document.activeElement?.tagName}:${document.activeElement?.textContent?.trim()}`,
  );
  expect(after).not.toBe(visited[visited.length - 1]);
});

test("axe im echten Browser: 0 Violations inkl. color-contrast", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

/**
 * Jede Route rendert serverseitig ueberhaupt (EYT-107).
 *
 * ## Der Fehler, der diesen Nachweis erzwungen hat
 *
 * `app/planung/page.tsx` ist eine SERVER-Komponente. Eine Fassung gab dem
 * Client-Waechter die Rechte als Kindfunktion mit — und Funktionen koennen die
 * Server/Client-Grenze nicht ueberqueren. Next brach zur Laufzeit ab mit
 * „Functions cannot be passed directly to Client Components".
 *
 * Bemerkt hat es WEDER `pnpm typecheck` NOCH `build-web` noch der
 * jsdom-Test der Seite: jsdom rendert alles clientseitig, die Grenze existiert
 * dort gar nicht. Rot wurde erst `auth-journey` — der teuerste Job, der
 * Supabase, GoTrue und zwei Browserkontexte hochfaehrt (gemessen 03.08.2026,
 * Lauf 30840726709).
 *
 * Diese Faelle holen die Fehlerklasse in den billigsten Job. Sie pruefen
 * ausdruecklich NICHT den Inhalt: hier laeuft keine API, jede Seite landet in
 * ihrem Lade- oder Fehlerzustand. Geprueft wird nur, dass sie ueberhaupt
 * gerendert wird und der Server dabei nicht abbricht.
 */
const ROUTEN = [
  { pfad: "/", name: "Start" },
  { pfad: "/anmelden", name: "Anmelden" },
  { pfad: "/planung?weekKey=2026-W32", name: "Planung" },
  { pfad: "/kosten", name: "Kosten" },
] as const;

for (const route of ROUTEN) {
  test(`${route.name} rendert serverseitig ohne Abbruch`, async ({ page }) => {
    const antwort = await page.goto(route.pfad);
    expect(antwort?.status(), `${route.pfad} antwortet nicht mit 2xx`).toBeLessThan(400);

    // Der Statuscode ist bei diesem Fehler die schaerfste Aussage: die
    // Gegenmutation (Kindfunktion ueber die Server/Client-Grenze, danach neu
    // gebaut) liefert gemessen 500, nicht 200 mit Fehlertext. Die
    // Rumpfpruefung darunter bleibt trotzdem stehen — sie deckt die
    // Fehlerklasse ab, die Next als gerenderte Seite ausliefert statt als
    // Statuscode.
    const rumpf = (await page.locator("body").innerText()).toLowerCase();
    for (const muster of [
      "functions cannot be passed",
      "application error",
      "unhandled runtime error",
      "internal server error",
    ]) {
      expect(rumpf, `${route.pfad} zeigt "${muster}"`).not.toContain(muster);
    }

    // Und die Shell steht: ohne diese Zeile waere eine leere Seite gruen.
    await expect(page.getByRole("banner")).toBeVisible();
  });
}
