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
const SEED_EMPLOYEE = "00000000-0000-4000-8000-0000004010a1";
const SEED_WORKSITE = "00000000-0000-4000-8000-0000005010a1";
const SEED_VERSION = "00000000-0000-4000-8000-0000006010a1";

/** Harness-Fixtures duerfen hier NICHT einspringen. */
const HARNESS_SPUREN = [
  "aaaa3333-3333-4333-8333-333333333333",
  "a5510003-0003-4003-8003-000000000003",
  "e11a0001-0001-4001-8001-000000000001",
  "5117a001-0001-4001-8001-000000000001",
];

/** Die reale API-Origin. Der Harness setzt sie; der Vorgabewert ist nur Bequemlichkeit. */
const API_ORIGIN = process.env["EASYTREE_API_ORIGIN"] ?? "http://127.0.0.1:3001";
const FENSTER_PFAD = `/api/v1/planung/fenster?weekKey=${SEED_WOCHE}`;

/** Beta-Spuren aus dem STANDARDSEED — nicht die aus dem W40-Harness. */
const SEED_BETA_SPUREN = [
  "00000000-0000-4000-8000-0000000000b2",
  "00000000-0000-4000-8000-0000007020b2",
  "00000000-0000-4000-8000-0000004020b2",
  "00000000-0000-4000-8000-0000005020b2",
];

test.describe("Standardseed-Kern (EYT-91)", () => {
  test("Woche 2026-W32 liefert 200 — direkt an der API UND ueber die Web-Origin", async ({
    page,
  }) => {
    // Zwei Wege, weil sie verschiedene Dinge belegen. Der direkte Aufruf zeigt,
    // dass CONTROLLER und Antwortvalidierung die geseedeten Ids durchlassen.
    // Der Weg ueber die Web-Origin zeigt zusaetzlich, dass das Next-Rewrite sie
    // unveraendert durchreicht. Faellt nur einer, weiss man sofort, welche
    // Schicht es war.
    const direkt = await page.request.get(`${API_ORIGIN}${FENSTER_PFAD}`);
    expect(
      direkt.status(),
      "direkt an der API: 500 bedeutet, dass eine geseedete Id den Vertrag bricht",
    ).toBe(200);

    const ueberWeb = await page.request.get(FENSTER_PFAD);
    expect(ueberWeb.status(), "ueber die Web-Origin: Rewrite oder API bricht").toBe(200);

    // Geprueft, nicht behauptet: `parse` wirft bei Vertragsabweichung.
    const koerper = PlanningWindowSchema.parse(await ueberWeb.json());
    expect(koerper.weekKey).toBe(SEED_WOCHE);

    // Leere Antwort waere kein Erfolg, sondern eine falsche Testidentitaet: ein
    // Subjekt ohne aktive Mitgliedschaft saehe durch RLS schlicht nichts.
    expect(
      koerper.assignments.length,
      "leere Woche deutet auf ein Subjekt ohne aktive Mitgliedschaft hin, nicht auf Erfolg",
    ).toBeGreaterThan(0);

    const zuweisung = koerper.assignments.find((a) => a.id === SEED_ZUWEISUNG);
    expect(zuweisung, "geseedete Zuweisung fehlt in der Antwort").toBeDefined();
    expect(zuweisung?.employeeId).toBe(SEED_EMPLOYEE);
    expect(zuweisung?.worksiteId).toBe(SEED_WORKSITE);
    // `sourceVersion` ist im Vertrag nullbar — eine Woche ohne Planversion hat
    // keine. Hier waere `null` ein Befund und keine Variante.
    expect(koerper.sourceVersion, "Standardseed-Planversion fehlt").not.toBeNull();
    expect(koerper.sourceVersion?.id).toBe(SEED_VERSION);

    // Beide Antworten muessen dasselbe sagen; ein Rewrite, das den Parameter
    // verliert, faellt sonst nicht auf.
    expect(await direkt.json()).toEqual(await ueberWeb.json());
  });

  test("keine fremde Organisation und kein Fehlerzustand in der W32-Antwort", async ({ page }) => {
    const antwort = await page.request.get(FENSTER_PFAD);
    expect(antwort.status()).toBe(200);
    const roh = await antwort.text();

    // Organisation Beta existiert im Standardseed mit eigener Planversion in
    // derselben Woche. Genau deshalb ist ihre Abwesenheit hier eine Aussage und
    // keine Selbstverstaendlichkeit.
    for (const spur of SEED_BETA_SPUREN) {
      expect(roh, `Beta-Spur aus dem Standardseed in der Antwort: ${spur}`).not.toContain(spur);
    }

    // Die modellierten Fehlerzustaende ausdruecklich ausschliessen. Ein 200 mit
    // einem Problem-Dokument im Rumpf waere sonst gruen.
    for (const zustand of ["CONTRACT_VIOLATION", "UNAVAILABLE", "FORBIDDEN"]) {
      expect(roh, `Fehlerzustand ${zustand} in der W32-Antwort`).not.toContain(zustand);
    }

    await page.goto(SEED_SEITE);
    await expect(page.locator(`[data-assignment-id="${SEED_ZUWEISUNG}"]`)).toBeVisible();
    const dom = await page.content();
    for (const spur of SEED_BETA_SPUREN) {
      expect(dom, `Beta-Spur aus dem Standardseed im DOM: ${spur}`).not.toContain(spur);
    }
  });
});

test.describe("Standardseed-Abgrenzung (EYT-91)", () => {
  // Laeuft bewusst NACH dem Einspielen der W40-Fixtures (Harness-Phase 13).
  // Vorher waere die Pruefung vakuum: sie sucht Harness-Spuren, und ohne
  // eingespielte Fixtures gibt es keine zu finden — gruen, ohne etwas gemessen
  // zu haben.
  test("der PLANSTAND der W32-Antwort stammt aus dem Standardseed, nicht aus Harness-Fixtures", async ({
    page,
  }) => {
    const antwort = await page.request.get(FENSTER_PFAD);
    expect(antwort.status()).toBe(200);
    const fenster = (await antwort.json()) as {
      assignments: { id: string; employeeId: string; worksiteId: string }[];
      sourceVersion: { id: string } | null;
      publishedVersionId: string | null;
      resources: { employees: { id: string }[]; worksites: { id: string }[] };
    };

    // Geprueft wird der PLANSTAND — Zuweisungen und Versionen. Nur er traegt
    // eine Wochenherkunft.
    //
    // NICHT geprueft wird `resources` (EYT-92). Das ist keine Abschwaechung,
    // sondern eine Korrektur der Frage: Stammdaten sind MANDANTENWEIT, nicht
    // wochengebunden. `e2e/harness/seed.sql` legt "Harness Planerin Alpha" in
    // dieselbe Organisation Alpha wie den Standardseed — sie steht damit
    // voellig zu Recht in der Auswahlliste jeder Woche dieses Mandanten,
    // W32 eingeschlossen. Ein `not.toContain` ueber die ganze Antwort wuerde
    // hier ein korrektes Verhalten als Leck melden.
    //
    // Die Aussage, um die es geht, bleibt scharf: keine Harness-ZUWEISUNG und
    // keine Harness-VERSION in Woche 32.
    const planstand = JSON.stringify({
      assignments: fenster.assignments,
      sourceVersion: fenster.sourceVersion,
      publishedVersionId: fenster.publishedVersionId,
    });
    for (const spur of HARNESS_SPUREN) {
      expect(planstand, `Harness-Fixture ${spur} im W32-Planstand`).not.toContain(spur);
    }

    // Gegenprobe gegen Vakuum: der Standardseed MUSS sichtbar sein. Ohne diese
    // Zeile wuerde eine leere oder fehlgeschlagene Antwort die Pruefung oben
    // gruen faerben, weil in nichts auch keine Harness-Spur steckt.
    expect(planstand).toContain(SEED_ZUWEISUNG);

    // Und die Auswahlliste ist nicht etwa leer: der Standardseed steht darin.
    expect(fenster.resources.employees.map((e) => e.id)).toContain(SEED_EMPLOYEE);
    expect(fenster.resources.worksites.map((w) => w.id)).toContain(SEED_WORKSITE);

    // Im DOM gilt die alte, strengere Regel weiter — dort werden nur die
    // Zuweisungen der Woche gerendert, und eine Harness-Id hat dort nichts zu
    // suchen. Die Auswahlfelder tragen Ids als `value`, nicht als Text, und
    // stehen deshalb nicht im gerenderten Text.
    await page.goto(SEED_SEITE);
    const zuweisungsIds = await sichtbareZuweisungen(page);
    for (const spur of HARNESS_SPUREN) {
      expect(zuweisungsIds, `Harness-Fixture ${spur} als Zuweisung im W32-DOM`).not.toContain(spur);
    }
    expect(zuweisungsIds).toContain(SEED_ZUWEISUNG);
  });
});

/**
 * Schreibpfad im echten Browser (EYT-92) — Schritte 2 bis 5 der Nutzerreise.
 *
 * Derselbe Aufbau wie oben, nur in die andere Richtung: Browser -> Formular ->
 * Same-Origin-Rewrite -> NestJS -> TenantQueryRunner -> RLS -> PostgreSQL, und
 * danach ueber einen frischen Lesepfad wieder zurueck.
 *
 * ## Warum diese Tests in dieser Reihenfolge stehen
 *
 * Sie teilen sich EINE Datenbank und laufen seriell (`test.describe.serial`).
 * Der Konflikttest braucht die Zuweisung, die der Speichertest anlegt — nur so
 * ist der Konflikt echt und nicht vorbereitet. Waeren sie unabhaengig, muesste
 * der Konflikttest seine eigene Kollision einfuegen, und er wuerde am Ende
 * pruefen, dass sein eigenes Einfuegen funktioniert hat.
 *
 * ## Gegenmutationen
 *
 * 1. Entfernt man die Kollisionsabfrage in `PlanningWriteRepository`, wird
 *    „Schritt 4" gruen statt rot gemeldet und die Zaehlung im Reload-Test
 *    steigt auf zwei — beide Faelle schlagen fehl.
 * 2. Ersetzt man in `PlanningWindowView` das Neuladen durch ein optimistisches
 *    Einfuegen, bleibt „Schritt 3" gruen, aber „Schritt 5" faellt: nach dem
 *    Reload waere nichts da.
 */
const A_PERSON = "e11a0001-0001-4001-8001-000000000001";
const A_BAUSTELLE = "5117a001-0001-4001-8001-000000000001";

/** Ein Slot in W40, der die geseedete Zuweisung (30.09. 06:00–10:00 UTC) NICHT beruehrt. */
const NEU_DATUM = "2026-10-01";
const NEU_BEGINN = "07:00";
const NEU_ENDE = "15:00";

/**
 * Woche oeffnen und warten, bis der SERVERSTAND wirklich da ist.
 *
 * `page.goto` allein genuegt nicht: die Ansicht laedt das Fenster in einem
 * Effekt nach, und eine Momentaufnahme unmittelbar danach liefert die noch
 * leere Liste. Ein Vorher-Nachher-Vergleich auf dieser Basis vergleicht den
 * Ladezustand mit dem Endzustand und schlaegt sporadisch fehl — genau das ist
 * im Lauf 30409513318 passiert.
 *
 * Gewartet wird auf das Formular UND auf die Liste: das Formular erscheint erst
 * mit `resources`, die Liste erst mit den Zuweisungen. Beide zusammen heissen,
 * dass die Antwort vollstaendig verarbeitet ist.
 */
async function wocheOeffnen(seite: import("@playwright/test").Page): Promise<string[]> {
  await seite.goto(SEITE);
  await expect(seite.getByTestId("einsatzformular")).toBeVisible();
  await expect(seite.getByTestId("planungsfenster-liste")).toBeVisible();
  return sichtbareZuweisungen(seite);
}

async function formularAusfuellen(
  seite: import("@playwright/test").Page,
  beginn: string,
  ende: string,
): Promise<void> {
  await seite.getByTestId("feld-employee").selectOption(A_PERSON);
  await seite.getByTestId("feld-worksite").selectOption(A_BAUSTELLE);
  await seite.getByTestId("feld-datum").fill(NEU_DATUM);
  await seite.getByTestId("feld-beginn").fill(beginn);
  await seite.getByTestId("feld-ende").fill(ende);
}

test.describe.serial("Schreibpfad: Browser bis PostgreSQL", () => {
  test("Schritt 2: reale Stammdaten aus PostgreSQL sind im Browser auswaehlbar", async ({
    page,
  }) => {
    await page.goto(SEITE);
    await expect(page.getByTestId("einsatzformular")).toBeVisible();

    // Die Namen stammen aus e2e/harness/seed.sql und existieren nirgends im
    // Clientcode — waeren sie eine Fixture, stuende hier ein anderer Text.
    const personen = page.getByTestId("feld-employee");
    await expect(personen).toContainText("Harness Planerin Alpha");
    await expect(page.getByTestId("feld-worksite")).toContainText("Harness Baustelle Alpha");

    // Werte sind die SERVERSEITIGEN Ids, nicht die Namen.
    const werte = await personen
      .locator("option")
      .evaluateAll((els) => els.map((e) => e.getAttribute("value") ?? ""));
    expect(werte).toContain(A_PERSON);

    // Und kein Byte aus Organisation B — weder Id noch Name.
    const markup = (await page.content()).toLowerCase();
    for (const spur of [...B_SPUREN, "harness planer beta", "harness baustelle beta"]) {
      expect(markup).not.toContain(spur.toLowerCase());
    }
  });

  test("Schritt 2: unvollstaendige Eingabe loest keinen Schreibaufruf aus", async ({ page }) => {
    const schreibaufrufe: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/planung/einsaetze")) {
        schreibaufrufe.push(req.url());
      }
    });

    await page.goto(SEITE);
    await page.getByTestId("feld-employee").selectOption(A_PERSON);
    await page.getByTestId("feld-worksite").selectOption(A_BAUSTELLE);
    // Datum, Beginn und Ende fehlen absichtlich.
    await page.getByTestId("einsatz-speichern").click({ force: true });
    await page.waitForTimeout(500);

    expect(schreibaufrufe).toEqual([]);
  });

  test("Schritt 3: ein gueltiger Entwurf wird serverseitig gespeichert und sichtbar", async ({
    page,
  }) => {
    const vorher = await wocheOeffnen(page);

    await formularAusfuellen(page, NEU_BEGINN, NEU_ENDE);
    const [antwort] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/planung/einsaetze") && r.request().method() === "POST",
      ),
      page.getByTestId("einsatz-speichern").click(),
    ]);
    expect(antwort.status()).toBe(201);

    // Die Id kommt vom SERVER, nicht aus dem Browser.
    const angelegt = (await antwort.json()) as { id: string };
    expect(angelegt.id).toMatch(/^[0-9a-f-]{36}$/);

    // Und sie steht anschliessend im DOM — ueber einen NEUEN Lesevorgang,
    // nicht durch optimistisches Einfuegen.
    await expect(page.locator(`[data-assignment-id="${angelegt.id}"]`)).toBeVisible();
    const nachher = await sichtbareZuweisungen(page);
    expect(nachher).toHaveLength(vorher.length + 1);
    expect(nachher).toContain(angelegt.id);
  });

  test("Schritt 4: ein ueberlappender Entwurf wird mit verstaendlichem Grund abgelehnt", async ({
    page,
  }) => {
    const vorher = await wocheOeffnen(page);

    // Genau derselbe Slot wie im vorigen Test — die Ueberlappung ist echt.
    await formularAusfuellen(page, NEU_BEGINN, NEU_ENDE);
    const [antwort] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/planung/einsaetze") && r.request().method() === "POST",
      ),
      page.getByTestId("einsatz-speichern").click(),
    ]);
    expect(antwort.status()).toBe(409);

    // Verstaendlicher Grund, nicht nur ein Statuscode.
    const meldung = page.getByTestId("einsatzformular-meldung");
    await expect(meldung).toBeVisible();
    await expect(meldung).toContainText(/bereits eingeplant/i);

    // Keine Teilwirkung: nach dem Reload steht die Liste unveraendert.
    // `wocheOeffnen` statt `reload`, damit hier dieselbe Wartebedingung gilt
    // wie oben — sonst vergliche der Test den Ladezustand mit dem Endzustand.
    expect(await wocheOeffnen(page)).toEqual(vorher);
  });

  test("Schritt 4: ein ungueltiges Intervall erreicht den Server gar nicht erst", async ({
    page,
  }) => {
    const schreibaufrufe: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/planung/einsaetze")) {
        schreibaufrufe.push(req.url());
      }
    });

    await page.goto(SEITE);
    // Ende vor Beginn.
    await formularAusfuellen(page, NEU_ENDE, NEU_BEGINN);
    await page.getByTestId("einsatz-speichern").click();

    await expect(page.getByTestId("einsatzformular-meldung")).toContainText(
      /Ende muss nach dem Beginn/i,
    );
    expect(schreibaufrufe).toEqual([]);
  });

  test("Schritt 5: der gespeicherte Zustand ueberlebt Reload und zweiten Browserkontext", async ({
    page,
    browser,
  }) => {
    const nachSpeichern = await wocheOeffnen(page);
    const provenienzVorher = await provenienz(page);
    // Der Speichertest hat genau eine Zeile ergaenzt; steht sie nicht mehr da,
    // war sie nie in PostgreSQL.
    expect(nachSpeichern.length).toBeGreaterThan(1);

    expect(await wocheOeffnen(page)).toEqual(nachSpeichern);
    expect(await provenienz(page)).toEqual(provenienzVorher);

    const origin = new URL(page.url()).origin;
    const zweiter = await browser.newContext({ baseURL: origin });
    try {
      const zweiteSeite = await zweiter.newPage();
      expect(await wocheOeffnen(zweiteSeite)).toEqual(nachSpeichern);
      expect(await provenienz(zweiteSeite)).toEqual(provenienzVorher);
    } finally {
      await zweiter.close();
    }
  });
});
