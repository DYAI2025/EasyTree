/**
 * Integrierter Read-Through-Nachweis (EYT-50).
 *
 * Browser -> Same-Origin-Rewrite -> NestJS -> TenantQueryRunner -> RLS ->
 * PostgreSQL. Nichts davon ist ersetzt: die API laeuft als echter Prozess mit
 * echtem Repository, nur Subjekt und Berechtigung sind beim SERVERSTART
 * eingespritzt (apps/api/test/harness/server.ts).
 *
 * Erwartungen aus e2e/harness/seed.sql:
 *   - Woche 2026-W40, Organisation Alpha
 *   - zwei veroeffentlichte Versionen mit VOLLSTAENDIGEM Zeitstempelgleichstand;
 *     nur der Id-Tie-Breaker entscheidet -> aaaa2222 gewinnt
 *   - ein Entwurf aaaa3333 ist der ANGEZEIGTE Stand
 *   - Organisation Beta haelt b5510001 in derselben Woche
 */
import { PlanningWindowSchema } from "@easytree/contracts";
import { expect, test } from "@playwright/test";

const WOCHE = "2026-W40";
const SEITE = `/planung?weekKey=${WOCHE}`;

const A_ENTWURF = "aaaa3333-3333-4333-8333-333333333333";
const A_ZULETZT_VEROEFFENTLICHT = "aaaa2222-2222-4222-8222-222222222222";
const A_ZUWEISUNG_ENTWURF = "a5510003-0003-4003-8003-000000000003";
const B_ZUWEISUNG = "b5510001-0001-4001-8001-000000000001";
const B_VERSION = "bbbb1111-1111-4111-8111-111111111111";
const B_EMPLOYEE = "e11b0001-0001-4001-8001-000000000001";
const B_WORKSITE = "5117b001-0001-4001-8001-000000000001";
/** Alles, was aus Organisation B nirgends auftauchen darf. */
const B_SPUREN = [B_ZUWEISUNG, B_VERSION, B_EMPLOYEE, B_WORKSITE];

/** Die im DOM gerenderten Zuweisungs-Ids, in Reihenfolge. */
async function sichtbareZuweisungen(seite: import("@playwright/test").Page): Promise<string[]> {
  return seite
    .locator("[data-assignment-id]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-assignment-id") ?? ""));
}

/** Die vier Provenienzmerkmale, an denen sich der Serverstand ablesen laesst. */
async function provenienz(
  seite: import("@playwright/test").Page,
): Promise<Record<string, string | null>> {
  const version = seite.getByTestId("planungsfenster-version");
  const stand = seite.getByTestId("planungsfenster-stand");
  return {
    sourceVersionId: await version.getAttribute("data-source-version-id"),
    sourceState: await version.getAttribute("data-source-state"),
    publishedVersionId: await version.getAttribute("data-published-version-id"),
    stand: await stand.getAttribute("data-stand"),
  };
}

test.describe("Read-Through: Browser bis PostgreSQL", () => {
  test("Nachweis 5+6: der Aufruf erreicht ueber die Web-Origin die API, mit Parameter", async ({
    page,
  }) => {
    // Auf die ANTWORT warten, nicht auf das Absenden: ein gesammelter Request
    // belegt nur, dass der Browser losgelaufen ist. Ob NestJS geantwortet hat
    // — und was — steht erst in der Response.
    const antwortVersprechen = page.waitForResponse(
      (r) => r.url().includes("/api/v1/planung/fenster") && r.request().method() === "GET",
    );
    await page.goto(SEITE);
    const fensterAntwort = await antwortVersprechen;

    expect(fensterAntwort.status()).toBe(200);
    const url = new URL(fensterAntwort.url());
    // Same-Origin: der Browser spricht ausschliesslich mit der Web-Origin.
    expect(url.origin).toBe(new URL(page.url()).origin);
    // Nachweis 6: der Parameter ueberlebt das Rewrite.
    expect(url.searchParams.get("weekKey")).toBe(WOCHE);

    // Die Antwort wird GEPRUEFT, nicht behauptet. Hier stand ein
    // TypeScript-`as` — das wird beim Uebersetzen geloescht und prueft nichts,
    // waehrend der Kommentar daneben "entspricht dem Vertrag" behauptete.
    // `parse` wirft, wenn der Server etwas anderes liefert.
    const koerper = PlanningWindowSchema.parse(await fensterAntwort.json());

    expect(koerper.weekKey).toBe(WOCHE);
    expect(koerper.timeZone.length).toBeGreaterThan(0);
    expect(koerper.sourceVersion).toEqual({ id: A_ENTWURF, state: "draft" });
    expect(koerper.publishedVersionId).toBe(A_ZULETZT_VEROEFFENTLICHT);

    // Und der Stand ist danach auch sichtbar.
    await expect(page.locator(`[data-assignment-id="${A_ZUWEISUNG_ENTWURF}"]`)).toBeVisible();

    // /health ueber dieselbe Origin, und es antwortet wirklich NestJS.
    const health = await page.request.get("/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });
  });

  test("Nachweis 2+3: nur Organisation A ist sichtbar, B weder in Antwort noch DOM", async ({
    page,
  }) => {
    const antwort = await page.request.get(`/api/v1/planung/fenster?weekKey=${WOCHE}`);
    expect(antwort.status()).toBe(200);
    const rohtext = await antwort.text();

    // Die Beta-Daten existieren in PostgreSQL (der Seed legt sie an, und
    // e2e/harness/verify-seed.sql belegt es unabhaengig) — hier duerfen sie
    // nicht vorkommen.
    for (const spur of B_SPUREN) {
      expect(rohtext, `Beta-Spur in der Antwort: ${spur}`).not.toContain(spur);
    }
    expect(rohtext).toContain(A_ZUWEISUNG_ENTWURF);

    await page.goto(SEITE);
    // ERST auf die gerenderte Alpha-Zuweisung warten. Ohne das waere die
    // Abwesenheit von Beta auch im Lade-, Fehler- oder Leerzustand gruen —
    // und genau dann prueft der Test gar nichts.
    await expect(page.locator(`[data-assignment-id="${A_ZUWEISUNG_ENTWURF}"]`)).toBeVisible();

    // Exakt, nicht "enthaelt": eine zusaetzliche fremde Zeile faellt sonst
    // durch.
    expect(await sichtbareZuweisungen(page)).toEqual([A_ZUWEISUNG_ENTWURF]);

    const dom = await page.content();
    for (const spur of B_SPUREN) {
      expect(dom, `Beta-Spur im DOM: ${spur}`).not.toContain(spur);
    }
  });

  test("Nachweis 8+9: Zeitstempelgleichstand, Id entscheidet; Entwurf getrennt gemeldet", async ({
    page,
  }) => {
    await page.goto(SEITE);
    const stand = page.getByTestId("planungsfenster-stand");
    await expect(stand).toBeVisible();

    // Angezeigt wird der ENTWURF ...
    await expect(stand).toHaveAttribute("data-stand", "entwurf-ueber-veroeffentlicht");
    const version = page.getByTestId("planungsfenster-version");
    await expect(version).toHaveAttribute("data-source-version-id", A_ENTWURF);
    await expect(version).toHaveAttribute("data-source-state", "draft");
    // ... und getrennt davon die zuletzt veroeffentlichte Version. Beide
    // Zeitstempel sind gleich; ohne den Id-Tie-Breaker waere das Ergebnis
    // von der Speicherreihenfolge abhaengig.
    await expect(version).toHaveAttribute("data-published-version-id", A_ZULETZT_VEROEFFENTLICHT);
  });

  test("Nachweis 4: Reload und zweiter Browserkontext liefern denselben Serverstand", async ({
    page,
    browser,
  }) => {
    await page.goto(SEITE);
    await expect(page.locator(`[data-assignment-id="${A_ZUWEISUNG_ENTWURF}"]`)).toBeVisible();

    const ersteIds = await sichtbareZuweisungen(page);
    expect(ersteIds).toEqual([A_ZUWEISUNG_ENTWURF]);
    const ersteProvenienz = await provenienz(page);

    await page.reload();
    await expect(page.locator(`[data-assignment-id="${A_ZUWEISUNG_ENTWURF}"]`)).toBeVisible();
    expect(await sichtbareZuweisungen(page)).toEqual(ersteIds);
    expect(await provenienz(page)).toEqual(ersteProvenienz);

    // Zweiter Kontext: eigener Cookie-Jar, eigener Cache, eigener
    // Speicherzustand. Was hier gleich ist, kann kein Clientzustand sein.
    //
    // `baseURL` ausdruecklich mitgeben: ein neuer Kontext erbt sie NICHT aus
    // der Testkonfiguration, und ein relatives goto() liefe ins Leere.
    const origin = new URL(page.url()).origin;
    const zweiter = await browser.newContext({ baseURL: origin });
    try {
      const zweiteSeite = await zweiter.newPage();
      await zweiteSeite.goto(SEITE);
      await expect(
        zweiteSeite.locator(`[data-assignment-id="${A_ZUWEISUNG_ENTWURF}"]`),
      ).toBeVisible();
      // Verglichen werden alle vier Provenienzmerkmale, nicht nur die Ids:
      // gleiche Zuweisungen bei abweichender Version waeren derselbe Fehler,
      // nur unauffaelliger.
      expect(await sichtbareZuweisungen(zweiteSeite)).toEqual(ersteIds);
      expect(await provenienz(zweiteSeite)).toEqual(ersteProvenienz);
    } finally {
      await zweiter.close();
    }
  });
});

/**
 * Nachweis 7 — laeuft in einem EIGENEN Playwright-Aufruf (EYT-50).
 *
 * Das Harness-Skript beendet die API zwischen den beiden Laeufen. Der Test
 * steuert den Prozess ausdruecklich NICHT selbst: ein Test, der seine eigene
 * Voraussetzung herstellt, prueft am Ende sein Herstellen und nicht das
 * Verhalten. Ausserdem liefe er in einem parallelen Lauf allen anderen davon.
 *
 * Aufruf: `--grep "Nachweis 7"` nach dem SIGTERM, waehrend der gesunde Lauf
 * mit `--grep-invert "Nachweis 7"` davor gelaufen ist.
 */
test.describe("Read-Through: API gestoppt", () => {
  test("Nachweis 7: ohne API zeigt die UI UNAVAILABLE, keine Fixture, keine leere Woche", async ({
    page,
  }) => {
    // Frischer Kontext durch den eigenen Lauf: was hier sichtbar ist, kann
    // kein Rest der vorherigen, erfolgreichen Anzeige sein.
    await page.goto(SEITE);

    const fehler = page.getByTestId("planungsfenster-fehler");
    await expect(fehler).toBeVisible();
    await expect(fehler).toHaveAttribute("data-failure", "UNAVAILABLE");

    // Kein Leerzustand: "nichts geplant" waere die Verwechslung, gegen die
    // dieser ganze Slice gebaut ist.
    await expect(page.getByTestId("planungsfenster-leer")).toHaveCount(0);
    await expect(page.getByTestId("planungsfenster-liste")).toHaveCount(0);
    await expect(page.getByTestId("planungsfenster-stand")).toHaveCount(0);
    await expect(page.getByTestId("planungsfenster-version")).toHaveCount(0);

    // Und keine einzige Zuweisung — insbesondere nicht die aus dem gesunden
    // Lauf, die ein Cache oder ein Fallback zeigen koennte.
    await expect(page.locator("[data-assignment-id]")).toHaveCount(0);
    expect(await page.content()).not.toContain(A_ZUWEISUNG_ENTWURF);
  });
});

/**
 * Laufzeitnachweis fuer den Standardseed (EYT-91).
 *
 * ## Warum dieser Block zusaetzlich existiert
 *
 * Der Block darueber fragt Woche 2026-W40 ab — die Woche der HARNESS-Fixtures
 * aus `e2e/harness/seed.sql`. Die geben ihre eigenen, schon immer gueltigen
 * v4-Ids zurueck. Genau die Ids, deren Rueckgabe frueher HTTP 500 ausloeste,
 * laufen dort nie durch den Vertrag.
 *
 * Der urspruengliche EYT-91-Defekt war: `supabase/seed.sql` fuehrte Ids mit
 * Versions-Nibble `0`, der Controller validierte seine eigene Ausgabe gegen
 * `PlanningWindowSchema` und lehnte sie ab — sauberer Serverfehler, HTTP 500,
 * Ursache zwei Schichten entfernt. Belegt war der Fix bisher nur statisch
 * (`apps/api/test/seed-contract-ids.test.ts`). Statisch heisst: die Datei ist
 * in Ordnung. Es hiess nicht, dass eine echte Route mit diesen Daten heute 200
 * liefert.
 *
 * Dieser Fall schliesst genau diese Luecke, ueber dieselbe reale Grenze:
 * Browser -> Same-Origin-Rewrite -> NestJS -> TenantQueryRunner -> RLS ->
 * PostgreSQL.
 *
 * ## Warum kein neues Testsubjekt noetig ist
 *
 * Das serverseitig eingespritzte Subjekt `…aaa1` ist Mitglied der
 * Standardseed-Organisation Alpha (`…0000a1`), und deren Planversion
 * `…6010a1` traegt Woche 2026-W32. Dieselbe Identitaet, andere Woche — eine
 * zweite Identitaet einzufuehren wuerde nur eine weitere Fehlerquelle schaffen.
 *
 * ## Gegenmutation
 *
 * Eine der unten erwarteten Ids in `supabase/seed.sql` zurueck auf
 * Versions-Nibble `0` setzen. Dann lehnt der Controller seine eigene Antwort
 * ab, die Route liefert 500, und dieser Fall wird rot — mit genau dem Fehler,
 * den EYT-91 beschreibt.
 */
const SEED_WOCHE = "2026-W32";
const SEED_SEITE = `/planung?weekKey=${SEED_WOCHE}`;

const SEED_ZUWEISUNG = "00000000-0000-4000-8000-0000007010a1";
const SEED_EMPLOYEE = "00000000-0000-0000-0000-0000004010a1";
const SEED_WORKSITE = "00000000-0000-4000-8000-0000005010a1";
const SEED_VERSION = "00000000-0000-4000-8000-0000006010a1";

/** Harness-Fixtures duerfen hier NICHT einspringen. */
const HARNESS_SPUREN = [
  "aaaa3333-3333-4333-8333-333333333333",
  "a5510003-0003-4003-8003-000000000003",
  "e11a0001-0001-4001-8001-000000000001",
  "5117a001-0001-4001-8001-000000000001",
];

test.describe("Standardseed-Laufzeitnachweis (EYT-91)", () => {
  test("eine geseedete employeeId und worksiteId passieren den Vertrag mit HTTP 200", async ({
    page,
  }) => {
    const antwortVersprechen = page.waitForResponse(
      (r) => r.url().includes("/api/v1/planung/fenster") && r.request().method() === "GET",
    );
    await page.goto(SEED_SEITE);
    const antwort = await antwortVersprechen;

    // Der Kern: frueher stand hier 500, weil der Controller seine eigene
    // Ausgabe gegen den Vertrag prueft und die geseedeten Ids durchfielen.
    expect(
      antwort.status(),
      "Standardseed-Woche muss 200 liefern; 500 bedeutet, dass eine geseedete Id den Vertrag bricht",
    ).toBe(200);

    // Geprueft, nicht behauptet: `parse` wirft bei Vertragsabweichung. Damit
    // ist die Validierung an der Transportgrenze Teil des Nachweises und nicht
    // nur eine Zusicherung ueber ein Feld.
    const koerper = PlanningWindowSchema.parse(await antwort.json());
    expect(koerper.weekKey).toBe(SEED_WOCHE);

    // Leere Antwort waere kein Erfolg, sondern eine falsche Testidentitaet:
    // ein Subjekt ohne aktive Mitgliedschaft sieht durch RLS schlicht nichts.
    expect(
      koerper.assignments.length,
      "leere Woche deutet auf ein Subjekt ohne aktive Mitgliedschaft hin, nicht auf Erfolg",
    ).toBeGreaterThan(0);

    const zuweisung = koerper.assignments.find((a) => a.id === SEED_ZUWEISUNG);
    expect(zuweisung, "geseedete Zuweisung fehlt in der Antwort").toBeDefined();
    expect(zuweisung?.employeeId).toBe(SEED_EMPLOYEE);
    expect(zuweisung?.worksiteId).toBe(SEED_WORKSITE);
    // `sourceVersion` ist im Vertrag nullbar — eine Woche ohne Planversion hat
    // keine. Hier waere `null` aber ein Befund und keine Variante: der Seed legt
    // die Version an, also muss sie da sein.
    expect(koerper.sourceVersion, "Standardseed-Planversion fehlt").not.toBeNull();
    expect(koerper.sourceVersion?.id).toBe(SEED_VERSION);

    // Und der Stand ist auch sichtbar — der Weg endet im DOM, nicht im JSON.
    await expect(page.locator(`[data-assignment-id="${SEED_ZUWEISUNG}"]`)).toBeVisible();
  });

  test("die Antwort stammt aus dem Standardseed, nicht aus Harness-Fixtures", async ({ page }) => {
    // Ohne diesen Fall koennte der Nachweis oben auch dann gruen sein, wenn
    // versehentlich Harness-Daten in W32 lieferten — dann waere wieder nichts
    // ueber die geseedeten Ids belegt.
    const antwortVersprechen = page.waitForResponse(
      (r) => r.url().includes("/api/v1/planung/fenster") && r.request().method() === "GET",
    );
    await page.goto(SEED_SEITE);
    const roh = await (await antwortVersprechen).text();
    const dom = (await page.content()).toLowerCase();

    for (const spur of HARNESS_SPUREN) {
      expect(roh, `Harness-Fixture ${spur} in der W32-Antwort`).not.toContain(spur);
      expect(dom, `Harness-Fixture ${spur} im W32-DOM`).not.toContain(spur.toLowerCase());
    }
  });
});
