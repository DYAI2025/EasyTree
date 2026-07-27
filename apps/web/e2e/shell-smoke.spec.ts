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
 */
const PROXIED_OPERATIONAL_PATHS = new Set(["/health", "/ready"]);

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
      const visibleFocus =
        (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
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
