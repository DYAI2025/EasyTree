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
import { expect, test } from "@playwright/test";

const WOCHE = "2026-W40";
const SEITE = `/planung?weekKey=${WOCHE}`;

const A_ENTWURF = "aaaa3333-3333-4333-8333-333333333333";
const A_ZULETZT_VEROEFFENTLICHT = "aaaa2222-2222-4222-8222-222222222222";
const A_ZUWEISUNG_ENTWURF = "a5510003-0003-4003-8003-000000000003";
const B_ZUWEISUNG = "b5510001-0001-4001-8001-000000000001";
const B_VERSION = "bbbb1111-1111-4111-8111-111111111111";

test.describe("Read-Through: Browser bis PostgreSQL", () => {
  test("Nachweis 5+6: der Aufruf erreicht ueber die Web-Origin die API, mit Parameter", async ({
    page,
  }) => {
    const gesehen: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/") || r.url().endsWith("/health")) gesehen.push(r.url());
    });

    const antwort = await page.goto(SEITE);
    expect(antwort?.ok()).toBe(true);

    // Der Fensteraufruf laeuft relativ ueber die Web-Origin — keine fremde
    // Origin, also kein CORS noetig.
    const fenster = gesehen.find((u) => u.includes("/planung/fenster"));
    expect(fenster, "kein Aufruf an /api/v1/planung/fenster beobachtet").toBeTruthy();
    const url = new URL(fenster!);
    expect(url.origin).toBe(new URL(page.url()).origin);
    // Nachweis 6: der Parameter ueberlebt das Rewrite.
    expect(url.searchParams.get("weekKey")).toBe(WOCHE);

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
    expect(rohtext).not.toContain(B_ZUWEISUNG);
    expect(rohtext).not.toContain(B_VERSION);
    expect(rohtext).toContain(A_ZUWEISUNG_ENTWURF);

    await page.goto(SEITE);
    const dom = await page.content();
    expect(dom).not.toContain(B_ZUWEISUNG);
    expect(dom).not.toContain(B_VERSION);
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

  test("Nachweis 4: Reload und zweiter Browserkontext liefern dieselben Ids", async ({
    page,
    browser,
  }) => {
    await page.goto(SEITE);
    const idsVon = async (p: typeof page): Promise<string[]> =>
      p
        .locator("[data-assignment-id]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-assignment-id") ?? ""));

    const ersteIds = await idsVon(page);
    expect(ersteIds.length).toBeGreaterThan(0);
    const ersteVersion = await page
      .getByTestId("planungsfenster-version")
      .getAttribute("data-published-version-id");

    await page.reload();
    expect(await idsVon(page)).toEqual(ersteIds);

    // Zweiter Kontext: eigener Cookie-Jar, eigener Cache. Was hier gleich
    // ist, kann kein Clientzustand sein.
    const zweiter = await browser.newContext();
    const zweiteSeite = await zweiter.newPage();
    await zweiteSeite.goto(SEITE);
    expect(await idsVon(zweiteSeite)).toEqual(ersteIds);
    expect(
      await zweiteSeite
        .getByTestId("planungsfenster-version")
        .getAttribute("data-published-version-id"),
    ).toBe(ersteVersion);
    await zweiter.close();
  });
});
