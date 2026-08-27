import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

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

/**
 * ## Das AUSSEHEN des Rahmens, nicht sein Text (EYT-80)
 *
 * Die vier Faelle unten messen Lage und Groesse im echten Browser. Gemessen
 * 27.08.2026 gab es dafuer im ganzen Repository keine Zusicherung:
 * `apps/web/test/app-shell-styles.test.ts` vergleicht Zeichenketten IM
 * Stylesheet, und ein Klassenname im Stylesheet beweist weder Lage noch
 * Groesse; `grep -rn 'boundingBox|getComputedStyle|toHaveCSS' apps/web/test
 * apps/web/e2e` fand drei Fokussonden und null Layoutaussagen.
 *
 * Ohne diese Faelle waeren gruen durchgegangen: ein dauerhaft sichtbarer
 * Sprunganker, eine untereinander gestapelte Kopfleiste, ein nicht mehr rechts
 * stehender Sitzungsbereich, eine randlos volle Hauptspalte und ein
 * Bedienelement unter dem 40-px-Ziel.
 *
 * Warum hier und nicht in jsdom: jsdom hat kein Layout und liefert fuer jedes
 * Rechteck Nullen. Nur `web-smoke` laeuft gegen den Produktions-Build.
 */

/** Rechteck eines Elements — explizit als Zahlen, eine DOMRect ist nicht serialisierbar. */
function rechteck(ziel: Locator) {
  return ziel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
      width: r.width,
      height: r.height,
    };
  });
}

test("Sprunganker liegt ausserhalb des Bildes, bis er den Fokus hat", async ({ page }) => {
  await page.goto("/");
  const anker = page.locator("a[href='#hauptinhalt']");

  // Versteckt ist er ALLEIN durch `position: absolute` plus `top: -100%` in
  // `.eyt-app-shell__skip-link`; ein `display: none` gibt es nicht, und alle
  // bisherigen Zusicherungen zum Sprunganker pruefen Existenz, Reihenfolge und
  // Fokus — nie Sichtbarkeit. Gegenmutation (ausgefuehrt 27.08.2026): beide
  // Deklarationen loeschen und neu bauen; er steht dann im Fluss und diese
  // Zeile wird rot mit `bottom=40`.
  const versteckt = await rechteck(anker);
  expect(
    versteckt.bottom,
    `Sprunganker steht ohne Fokus im Bild (bottom=${versteckt.bottom})`,
  ).toBeLessThanOrEqual(0);

  await page.keyboard.press("Tab");
  await expect(anker).toBeFocused();
  // Zweite Haelfte, eigene Gegenmutation: `top: 0` aus der :focus-Regel
  // entfernen — dann bleibt er auch mit Fokus oberhalb des Bildes.
  const sichtbar = await rechteck(anker);
  expect(
    sichtbar.top,
    `Sprunganker kommt mit Fokus nicht ins Bild (top=${sichtbar.top})`,
  ).toBeGreaterThanOrEqual(0);
});

test("Kopfleiste ist EINE Zeile mit dem Sitzungsbereich rechts", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const kopf = page.getByRole("banner");
  const anmelden = kopf.getByRole("link", { name: "Anmelden" });
  await expect(anmelden).toBeVisible();

  const kopfBox = await rechteck(kopf);
  const anmeldenBox = await rechteck(anmelden);
  const abstandRechts = kopfBox.right - anmeldenBox.right;
  const abstandLinks = anmeldenBox.left - kopfBox.left;

  // EINE Zusicherung, ZWEI Regeln — beide Gegenmutationen sind ausgefuehrt und
  // wurden rot (27.08.2026): ohne `margin-left: auto` auf
  // `.eyt-app-shell__session` steht der Zugang direkt hinter der Navigation
  // (rechts=1008.9, links=172.0); ohne `display: flex` auf
  // `.eyt-app-shell__header` stapeln sich Marke, Navigation und
  // Sitzungsbereich untereinander und er rutscht an den linken Rand
  // (rechts=1165.0, links=16). In beiden Faellen kippt dasselbe Verhaeltnis.
  expect(
    abstandRechts,
    `Anmelden steht nicht rechts: rechts=${abstandRechts}, links=${abstandLinks}`,
  ).toBeLessThan(abstandLinks);
});

test("Hauptspalte ist begrenzt und mittig", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const haupt = await rechteck(page.getByRole("main"));
  const buehne = await page.evaluate(() => document.documentElement.clientWidth);

  // `max-width: 60rem` auf `.eyt-app-shell__main`; ohne die Regel gemessen
  // `width=1440` (Gegenmutation ausgefuehrt 27.08.2026). Zusaetzlich gegen die
  // tatsaechliche Buehnenbreite verglichen: ein Rollbalken unterschreitet die
  // 1440 von selbst, die reine Zahlengrenze bliebe dann still gruen.
  expect(haupt.width, `Hauptspalte fuellt die Breite (width=${haupt.width})`).toBeLessThan(1440);
  expect(haupt.width, `Hauptspalte fuellt die Buehne (${haupt.width} von ${buehne})`).toBeLessThan(
    buehne,
  );

  // `margin: 0 auto`. Ohne die Regel steht die Spalte am linken Rand —
  // gemessen `links=0, rechts=480` (Gegenmutation ausgefuehrt 27.08.2026).
  const randLinks = haupt.left;
  const randRechts = buehne - haupt.right;
  expect(
    Math.abs(randLinks - randRechts),
    `Hauptspalte nicht mittig: links=${randLinks}, rechts=${randRechts}`,
  ).toBeLessThanOrEqual(2);
});

test("Sitzungs-Bedienelement erreicht das 40-px-Beruehrziel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const anmelden = page.getByRole("banner").getByRole("link", { name: "Anmelden" });
  await expect(anmelden).toBeVisible();
  const box = await rechteck(anmelden);

  // Basisdesign v2.0 §2.3. Getragen wird das ALLEIN von `min-height: 40px` im
  // Block `.app-logout, .app-login-link`: Polsterung, Zeilenhoehe und Rahmen
  // ergeben von sich aus weniger. Gegenmutation (ausgefuehrt 27.08.2026): die
  // Zeile entfernen und neu bauen — gemessen bleiben dann 38 px.
  expect(box.height, `Anmelden ist ${box.height} px hoch`).toBeGreaterThanOrEqual(40);
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

for (const route of ROUTEN) {
  test(`axe im echten Browser: 0 Violations auf ${route.pfad}`, async ({ page }) => {
    await page.goto(route.pfad);
    // Hier laeuft KEINE API. Geprueft wird deshalb der unangemeldete Lade-,
    // Leer- oder Fehlerzustand dieser Flaeche — genau die Zustaende, die
    // EYT-141 als wiederverwendbar verlangt. Die ANGEMELDETEN Zustaende
    // derselben Flaechen prueft `auth-journey` bei 1440/1920/200 %.
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, `${route.pfad}: ${JSON.stringify(results.violations)}`).toEqual([]);
  });
}
