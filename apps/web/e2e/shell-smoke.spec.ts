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
 * Groesse; `grep -rnE 'boundingBox|getComputedStyle|toHaveCSS' apps/web/test
 * apps/web/e2e` fand VIER Fokussonden und null Layoutaussagen
 * (`shell-smoke.spec.ts:76` und `:121`, `read-through.spec.ts:745`,
 * `auth-journey/journey.pwtest.ts:130`).
 *
 * Das `-E` gehoert zwingend dazu: ohne den Schalter ist `|` auf macOS ein
 * gewoehnliches Zeichen und das Muster sucht die Zeichenkette
 * „boundingBox|getComputedStyle|toHaveCSS" am Stueck. Am Stand vor diesem
 * Umbau fand die BRE-Fassung 0 Zeilen; heute findet sie genau eine — diesen
 * Kommentar hier.
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
  const markeBox = await rechteck(page.locator(".eyt-app-shell__brand"));
  const anmeldenBox = await rechteck(anmelden);
  const abstandRechts = kopfBox.right - anmeldenBox.right;
  const abstandLinks = anmeldenBox.left - kopfBox.left;

  // ERSTE Haelfte des Titels: EINE Zeile.
  //
  // Ohne diese Zusicherung versprach der Titel mehr, als der Fall pruefte. Das
  // Verhaeltnis darunter ist ein LINKS/RECHTS-Vergleich und ueberlebt einen
  // Umbruch: mit `.app-nav-list { min-width: 1200px }` bei 1280 px Breite wurde
  // die Kopfleiste dreizeilig (Hoehe 159 px, Marke `top=16`, Anmelden
  // `top=102`) und der Fall blieb GRUEN (gemessen 27.08.2026). `flex-wrap:
  // wrap` steht absichtlich auf `.eyt-app-shell__header` — ein Umbruch ist hier
  // konfiguriertes Verhalten, kein exotischer Zufall.
  //
  // Mit dieser Zusicherung wird dieselbe Mutation rot: gemessen `Marke=31,
  // Anmelden=122, Kopfhoehe=159`, Abstand der Mitten 91 gegen erlaubte 2.
  // Ungestoert liegen beide Mitten aufeinander.
  //
  // Verglichen werden die vertikalen MITTEN und nicht die Oberkanten: die
  // Kopfleiste richtet ueber `align-items: center` aus, und Marke (Schriftgrad
  // 1.25rem) und Anmelden-Zugang (`min-height: 40px`) sind verschieden hoch.
  // In einer Zeile fallen ihre Mitten zusammen, in getrennten Flex-Zeilen
  // nicht.
  const markeMitte = markeBox.top + markeBox.height / 2;
  const anmeldenMitte = anmeldenBox.top + anmeldenBox.height / 2;
  expect(
    Math.abs(markeMitte - anmeldenMitte),
    `Kopfleiste umbricht: Marke=${markeMitte}, Anmelden=${anmeldenMitte}, Kopfhoehe=${kopfBox.height}`,
  ).toBeLessThanOrEqual(2);

  // ZWEITE Haelfte: der Sitzungsbereich steht rechts.
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

test("Anmelden-Zugang erreicht das 40-px-Beruehrziel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const anmelden = page.getByRole("banner").getByRole("link", { name: "Anmelden" });
  await expect(anmelden).toBeVisible();
  const box = await rechteck(anmelden);

  // Basisdesign v2.0 §2.3, und ausdruecklich nur fuer DIESES eine Bedienelement:
  // den `Anmelden`-Link, also `.app-login-link`. Getragen wird seine Hoehe
  // allein von `min-height: 40px`; Polsterung, Zeilenhoehe und Rahmen ergeben
  // von sich aus weniger. Gegenmutation (ausgefuehrt 27.08.2026): die Zeile
  // entfernen und neu bauen — gemessen bleiben dann 38 px.
  //
  // NICHT gemessen ist `.app-logout`. Die Deklaration steht heute im
  // gemeinsamen Block `.app-logout, .app-login-link`, aber daraus folgt nichts:
  // den Block so aufzuteilen, dass nur `.app-login-link` die `min-height`
  // behaelt, liess diesen Fall gruen (gemessen 27.08.2026). Der Grund ist
  // aelter als der Block — `web-smoke` laeuft ABGEMELDET, der Abmelden-Knopf
  // wird in diesem Job ueberhaupt nicht gerendert. Der einzige Job, der ihn
  // ueberhaupt zu sehen bekommt, ist `auth-journey`; auch dort wird er nur
  // GEKLICKT, nie vermessen. Wer das schliessen will, braucht eine
  // Groessenmessung im angemeldeten Zustand — und damit eine laufende API.
  expect(box.height, `Anmelden ist ${box.height} px hoch`).toBeGreaterThanOrEqual(40);
});

test("Wochenwechsel erreicht das 40-px-Beruehrziel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Dieselbe Route, die unten schon serverseitig gerendert wird: die
  // Wochennavigation steht dort OHNE laufende API, weil ihr Modell in
  // `lib/wochennavigation.ts` allein aus dem Adressparameter entsteht.
  await page.goto("/planung?weekKey=2026-W32");
  const naechste = page.getByTestId("wochennavigation-naechste");
  await expect(naechste).toBeVisible();
  const box = await rechteck(naechste);

  // Basisdesign v2.0 §2.3, und bis EYT-80 von NICHTS gemessen: die vier
  // Geometriefaelle oben besuchen alle `/`, wo es keine Wochenleiste gibt.
  // Getragen wird die Hoehe allein von `min-height: 2.5rem` in
  // `.eyt-date-range__action`; Schriftgrad und Zeilenhoehe ergeben von sich aus
  // weniger. Gegenmutation (ausgefuehrt 27.08.2026): die Zeile aus
  // `globals.css` entfernen und neu bauen — gemessen bleiben dann 24 px, und
  // diese Zusicherung wird rot.
  //
  // Warum „Nächste Woche" und nicht „Heute": alle drei Wege tragen dieselbe
  // Klasse, aber „Heute" ist im Fehlerfall das einzige verbleibende Element und
  // damit der Weg, der ohnehin am haeufigsten angefasst wird. Ein Blaetterweg
  // faellt weg, sobald jemand die Klasse nur noch auf den Rueckweg legt.
  expect(box.height, `Nächste Woche ist ${box.height} px hoch`).toBeGreaterThanOrEqual(40);
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

/**
 * Die Tokens erreichen die GEBAUTE Anwendung (EYT-80 Inkrement 2).
 *
 * Die Datei-Waechter in `apps/web/test/basisdesign-tokens.test.ts` und
 * `packages/ui/test/basisdesign-tokens.test.ts` lesen Quelltext. Sie koennen
 * nicht sehen, ob Next den `@import` aufloest, ob das Paket seine CSS-Datei
 * ueberhaupt ausliefert oder ob ein Bundler sie als nebenwirkungsfrei
 * wegwirft. Dieser Fall liest den BERECHNETEN Wert im Chromium.
 *
 * Verglichen wird die FARBE, nicht die Schreibweise. Gemessen 27.08.2026
 * verkuerzt der Minifier des Produktionsbaus `#ffffff` zu `#fff` — und
 * `getComputedStyle` normalisiert den Wert einer Custom Property NICHT, weil
 * sie bis zur Verwendung ein beliebiges Token ist. Ein Zeichenkettenvergleich
 * haette hier also den Minifier geprueft und nicht die Farbe. Darum wird der
 * rohe Wert einer Sonde als `color` zugewiesen und von Chromium selbst als
 * `rgb(…)` zurueckgelesen: das ist unabhaengig von Schreibweise, Minifier und
 * kuenftigen Formatwechseln.
 *
 * Drei Routen, weil die Zusage „auf den realen Produktflaechen" lautet und
 * nicht „auf der Startseite". Im `web-smoke` laeuft keine API; alle drei
 * antworten trotzdem mit 200 und tragen dieselbe CSS-Datei. Geprueft werden
 * hier die TOKENWERTE, nicht der angemeldete Zustand — der gehoert dem
 * auth-journey.
 *
 * Hellmodus: Playwright startet ohne `colorScheme`-Angabe, und der Standard
 * ist `light`. Die Dunkelwerte sind hier bewusst NICHT gemessen; sie haengen
 * an `packages/ui/test/basisdesign-tokens.test.ts`.
 */
const KANONISCHE_ROLLEN: ReadonlyArray<readonly [string, string]> = [
  ["--eyt-bg-canvas", "rgb(246, 244, 239)"],
  ["--eyt-bg-surface", "rgb(255, 255, 255)"],
  ["--eyt-text-primary", "rgb(29, 27, 24)"],
  ["--eyt-text-secondary", "rgb(91, 86, 78)"],
  ["--eyt-border-default", "rgb(216, 212, 203)"],
  ["--eyt-action-primary", "rgb(30, 82, 49)"],
  // Auch die repo-eigene und die abgeleitete Rolle werden AUSGELIEFERT —
  // dass ihre Werte richtig SIND, bewacht packages/ui; dass sie im gebauten
  // Browser ankommen, kann nur dieser Fall sehen (PO-Review PR #96).
  ["--eyt-action-primary-contrast", "rgb(255, 255, 255)"],
  ["--eyt-state-published-bg", "rgb(225, 235, 226)"],
  ["--eyt-state-published-text", "rgb(30, 82, 49)"],
  ["--eyt-state-draft-text", "rgb(122, 83, 0)"],
  ["--eyt-state-draft-bg", "rgb(244, 232, 206)"],
  ["--eyt-state-danger-text", "rgb(155, 44, 31)"],
  ["--eyt-state-danger-bg", "rgb(247, 227, 223)"],
  ["--eyt-state-info-text", "rgb(21, 94, 117)"],
  ["--eyt-state-info-bg", "rgb(222, 237, 242)"],
];

for (const pfad of ["/", "/planung", "/kosten"]) {
  test(`${pfad} liefert die kanonischen Basisdesign-Tokens aus`, async ({ page }) => {
    await page.goto(pfad);
    await expect(page.getByRole("main")).toBeVisible();

    const gemessen = await page.evaluate(
      (namen) => {
        const wurzel = getComputedStyle(document.documentElement);
        const sonde = document.createElement("span");
        document.body.append(sonde);
        try {
          return Object.fromEntries(
            namen.map((name) => {
              const roh = wurzel.getPropertyValue(name).trim();
              // Erst leeren, dann setzen: lehnt der CSS-Parser den Wert ab,
              // bleibt `style.color` leer — und `angenommen` deckt genau den
              // Fall auf, in dem eine fehlende Rolle sonst die geerbte Farbe
              // der Sonde gemessen haette und zufaellig gruen waere.
              sonde.style.color = "";
              sonde.style.color = roh;
              const angenommen = sonde.style.color !== "";
              return [name, { roh, angenommen, farbe: getComputedStyle(sonde).color }];
            }),
          );
        } finally {
          sonde.remove();
        }
      },
      KANONISCHE_ROLLEN.map(([name]) => name),
    );

    for (const [name, farbe] of KANONISCHE_ROLLEN) {
      const wert = gemessen[name];
      expect(wert?.roh, `${pfad}: ${name} ist nicht deklariert`).toBeTruthy();
      expect(wert?.angenommen, `${pfad}: ${name} = "${wert?.roh}" ist keine gueltige Farbe`).toBe(
        true,
      );
      expect(wert?.farbe, `${pfad}: ${name} (roh: "${wert?.roh}")`).toBe(farbe);
    }
  });
}

/**
 * EYT-113: /feld ohne API — das Server-Gate weiss NICHTS und handelt das
 * fail-closed: ehrliche Fehlerflaeche statt Shell, und KEINE Umleitung zur
 * Anmeldung. Nichtwissen ist nicht "abgemeldet" — eine Umleitung wuerde bei
 * einem API-Ausfall angemeldete Nutzer aussperren. Der Prozess haelt die
 * Route; genau dieses Verhalten unterscheidet den Ausfall vom 401.
 */
test("EYT-113: /feld ohne API zeigt die ehrliche Fehlerflaeche, keine Shell", async ({ page }) => {
  await page.goto("/feld");
  await expect(page.getByTestId("feld-sitzung-unbekannt")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/feld");
  await expect(page.getByTestId("feld-shell")).toHaveCount(0);
  await expect(page.getByTestId("feld-abmelden")).toHaveCount(0);
  // Die Fehlerflaeche ist selbst zugaenglich: eine main-Landmark, und die
  // Meldung ist assertiv. Bewusst NICHT getByRole("alert") ohne Filter:
  // Nexts Route-Announcer traegt ebenfalls role=alert (strict-mode-Treffer,
  // gemessen 28.08.2026) — geprueft wird das Element der Fehlerflaeche.
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByTestId("feld-sitzung-unbekannt")).toHaveAttribute("role", "alert");
});
