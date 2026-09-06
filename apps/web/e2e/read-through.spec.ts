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
import AxeBuilder from "@axe-core/playwright";
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
  test("Nachweis 7: ohne API zeigt die UI den Ausfall, keine Fixture, keine leere Woche", async ({
    page,
  }) => {
    // Frischer Kontext durch den eigenen Lauf: was hier sichtbar ist, kann
    // kein Rest der vorherigen, erfolgreichen Anzeige sein.
    await page.goto(SEITE);

    // ## Was sich mit EYT-107 geaendert hat — und was ausdruecklich nicht
    //
    // Bis EYT-107 rief die Seite das Planungsgateway unmittelbar, und der
    // Ausfall erschien als `planungsfenster-fehler` mit
    // `data-failure="UNAVAILABLE"`. Seither steht `PlanungZugang` davor: die
    // Planung haengt an derselben Sitzungskette wie die Kosten. Ist die API
    // KOMPLETT gestoppt — und genau das stellt dieses Skript her —, scheitert
    // `GET /auth/session` ZUERST. Der ehrliche Zustand ist dann „der
    // Anmeldezustand ist unbekannt", nicht „der Wochenplan ist nicht
    // ladbar": wir wissen ja nicht einmal, wer fragt.
    //
    // Die Zusicherung wurde deshalb NICHT auf irgendeinen vorhandenen Banner
    // umgebogen. Der eigentliche Inhalt dieses Nachweises sind die NEGATIVEN
    // Zeilen darunter — kein Leerzustand, keine Fixture, keine Zuweisung aus
    // dem gesunden Lauf. Die stehen unveraendert und gelten weiterhin; sie
    // gelten sogar strenger, weil jetzt gar keine Planungsoberflaeche mehr
    // gerendert wird.
    //
    // Der planungsseitige `UNAVAILABLE`-Pfad ist dadurch nicht verwaist: er
    // greift, wenn die SITZUNG steht und nur die Planungsroute ausfaellt.
    // Geprueft in `apps/web/test/planning-window-view.test.tsx`
    // („zeigt einen Ausfall als Fehler, nicht als leere Woche").
    const sitzungUnbekannt = page.getByTestId("planung-sitzung-unbekannt");
    await expect(sitzungUnbekannt).toBeVisible();

    // Und ausdruecklich NICHT „abgemeldet": ein nicht erreichbarer Server ist
    // Nichtwissen. Wer beides gleich behandelt, schickt bei jedem Ausfall
    // alle zur Anmeldung.
    await expect(page.getByTestId("planung-unauthenticated")).toHaveCount(0);

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
    // Erst warten, dann zaehlen. Die vorige Fassung dieses Tests las den
    // Seitentext unmittelbar nach `goto` und war damit im Ladezustand
    // vakuumgruen — in leerem Markup steckt auch keine Harness-Spur. Die
    // Gegenprobe unten hat genau das aufgedeckt (Lauf 30409986990).
    await expect(page.locator(`[data-assignment-id="${SEED_ZUWEISUNG}"]`)).toBeVisible();
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
/**
 * EYT-158: drei aktive Alpha-Mitarbeitende aus `e2e/harness/seed.sql` als EIN
 * Einsatzteam. Weniger als drei bewiese das Akzeptanzkriterium „mindestens drei
 * Personen in einem Command" nicht; `verify-seed.sql` zaehlt sie fail-closed.
 */
const A_TEAM = [
  A_PERSON,
  "e11a0002-0002-4002-8002-000000000002",
  "e11a0003-0003-4003-8003-000000000003",
] as const;
const A_TEAM_NAMEN = [
  "Harness Planerin Alpha",
  "Harness Kletterer Alpha",
  "Harness Bodenkraft Alpha",
] as const;
const UUID = /^[0-9a-f-]{36}$/;

/** Antwort von `POST /planung/baustellentage` — nur die hier gepruefte Teilmenge. */
interface BaustellentagAntwort {
  readonly worksiteDayId: string;
  readonly configurationId: string;
  readonly team: ReadonlyArray<{ readonly assignmentId: string; readonly employeeId: string }>;
}

/** Ein Slot in W40, der die geseedete Zuweisung (30.09. 06:00–10:00 UTC) NICHT beruehrt. */
const NEU_DATUM = "2026-10-01";
const NEU_BEGINN = "07:00";
const NEU_ENDE = "15:00";
/** Der Tag der geseedeten Entwurfszuweisung von Person A — fuer den echten Personenkonflikt. */
const KONFLIKT_DATUM = "2026-09-30";

/** Die im DOM gerenderten Baustellentag-Ids, sortiert (EYT-158). */
async function sichtbareBaustellentage(seite: import("@playwright/test").Page): Promise<string[]> {
  const ids = await seite
    .locator("[data-worksite-day-id]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-worksite-day-id") ?? ""));
  return [...ids].sort();
}

/** Auf die ANTWORT des Baustellentag-Commands warten, nicht auf das Absenden. */
function baustellentagAntwort(
  seite: import("@playwright/test").Page,
): Promise<import("@playwright/test").Response> {
  return seite.waitForResponse(
    (r) => r.url().includes("/planung/baustellentage") && r.request().method() === "POST",
  );
}

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
  // Seit EYT-147 steht das Formular im geschlossenen Inspector; das fruehere
  // Wartesignal `einsatzformular` existiert im Ruhezustand nicht mehr. Der
  // Ausloeser erscheint wie das Formular erst mit verarbeiteten `resources`,
  // die Liste erst mit den Zuweisungen — beide zusammen heissen weiterhin,
  // dass die Antwort vollstaendig verarbeitet ist.
  await expect(seite.getByTestId("werkbank-einsatz-anlegen")).toBeVisible();
  await expect(seite.getByTestId("planungsfenster-liste")).toBeVisible();
  return sichtbareZuweisungen(seite);
}

/**
 * Den Erstellungs-Inspector oeffnen, falls er zu ist (EYT-147). Idempotent,
 * damit Folgeschritte innerhalb eines Tests nicht doppelt klicken.
 */
async function inspectorOeffnen(seite: import("@playwright/test").Page): Promise<void> {
  if ((await seite.getByTestId("einsatzformular").count()) === 0) {
    await seite.getByTestId("werkbank-einsatz-anlegen").click();
  }
  await expect(seite.getByTestId("einsatzformular")).toBeVisible();
}

/**
 * Worksite-first (EYT-158): Baustelle, lokaler Tag, Arbeitszeit, DANN das
 * Einsatzteam. Beginn und Ende stehen mit 08:00–18:00 vorbelegt; `fill`
 * ersetzt den Wert eines time-Inputs vollstaendig.
 */
async function formularAusfuellen(
  seite: import("@playwright/test").Page,
  beginn: string,
  ende: string,
  datum = NEU_DATUM,
  team: readonly string[] = A_TEAM,
): Promise<void> {
  await inspectorOeffnen(seite);
  await seite.getByTestId("feld-worksite").selectOption(A_BAUSTELLE);
  await seite.getByTestId("feld-datum").fill(datum);
  await seite.getByTestId("feld-beginn").fill(beginn);
  await seite.getByTestId("feld-ende").fill(ende);
  await seite.getByTestId("feld-employee").selectOption([...team]);
}

/**
 * Die EINE Baustellentag-Karte zu einer Serverantwort pruefen: genau eine
 * Karte am Tag, das Team untergeordnet, Namen statt Ids sichtbar.
 */
async function karteGeprueft(
  seite: import("@playwright/test").Page,
  angelegt: BaustellentagAntwort,
  datum: string,
  zeit: string,
): Promise<void> {
  const karte = seite.locator(`.einsatzkarte[data-worksite-day-id="${angelegt.worksiteDayId}"]`);
  await expect(karte).toBeVisible();
  await expect(seite.locator(`[data-tag="${datum}"] .einsatzkarte`)).toHaveCount(1);
  await expect(karte).toHaveAttribute("data-configuration-id", angelegt.configurationId);
  await expect(karte.locator("[data-assignment-id]")).toHaveCount(angelegt.team.length);
  for (const mitglied of angelegt.team) {
    await expect(karte.locator(`[data-assignment-id="${mitglied.assignmentId}"]`)).toBeVisible();
  }
  await expect(karte).toContainText("Harness Baustelle Alpha");
  await expect(karte).toContainText(zeit);
  for (const name of A_TEAM_NAMEN) await expect(karte).toContainText(name);
  // Technische Ids sind keine sichtbare Identitaet (EYT-158).
  const text = await karte.innerText();
  expect(text).not.toContain(angelegt.worksiteDayId);
  expect(text).not.toContain(angelegt.configurationId);
  for (const mitglied of angelegt.team) expect(text).not.toContain(mitglied.assignmentId);
}

test.describe.serial("Schreibpfad: Browser bis PostgreSQL", () => {
  test("Schritt 2: reale Stammdaten aus PostgreSQL sind im Browser auswaehlbar", async ({
    page,
  }) => {
    await page.goto(SEITE);
    await expect(page.getByTestId("werkbank-einsatz-anlegen")).toBeVisible();
    await inspectorOeffnen(page);

    // Worksite-first: der Fokus landet auf der Baustelle, nicht auf einer
    // Person, und die Arbeitszeit ist mit 08:00–18:00 vorbelegt (EYT-158).
    await expect(page.getByTestId("feld-worksite")).toBeFocused();
    await expect(page.getByTestId("feld-beginn")).toHaveValue("08:00");
    await expect(page.getByTestId("feld-ende")).toHaveValue("18:00");

    // Die Namen stammen aus e2e/harness/seed.sql und existieren nirgends im
    // Clientcode — waeren sie eine Fixture, stuende hier ein anderer Text.
    const personen = page.getByTestId("feld-employee");
    await expect(personen).toHaveAttribute("multiple", "");
    for (const name of A_TEAM_NAMEN) await expect(personen).toContainText(name);
    await expect(page.getByTestId("feld-worksite")).toContainText("Harness Baustelle Alpha");

    // Werte sind die SERVERSEITIGEN Ids, nicht die Namen.
    const werte = await personen
      .locator("option")
      .evaluateAll((els) => els.map((e) => e.getAttribute("value") ?? ""));
    for (const id of A_TEAM) expect(werte).toContain(id);

    // Und kein Byte aus Organisation B — weder Id noch Name.
    const markup = (await page.content()).toLowerCase();
    for (const spur of [...B_SPUREN, "harness planer beta", "harness baustelle beta"]) {
      expect(markup).not.toContain(spur.toLowerCase());
    }
  });

  test("Schritt 2: unvollstaendige Eingabe loest keinen Schreibaufruf aus", async ({ page }) => {
    const schreibaufrufe: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/planung/")) {
        schreibaufrufe.push(req.url());
      }
    });

    await page.goto(SEITE);
    await inspectorOeffnen(page);
    await page.getByTestId("feld-worksite").selectOption(A_BAUSTELLE);
    await page.getByTestId("feld-employee").selectOption([...A_TEAM]);
    // Das Datum fehlt absichtlich; Beginn und Ende sind vorbelegt.
    await page.getByTestId("einsatz-speichern").click({ force: true });
    await page.waitForTimeout(500);

    expect(schreibaufrufe).toEqual([]);
  });

  test("Schritt 3: ein Baustellentag mit drei Personen wird serverseitig gespeichert und als EINE Karte sichtbar", async ({
    page,
  }) => {
    const vorher = await wocheOeffnen(page);
    const tageVorher = await sichtbareBaustellentage(page);

    await formularAusfuellen(page, NEU_BEGINN, NEU_ENDE);
    const [antwort] = await Promise.all([
      baustellentagAntwort(page),
      page.getByTestId("einsatz-speichern").click(),
    ]);
    expect(antwort.status()).toBe(201);

    // Die Ids kommen vom SERVER, nicht aus dem Browser — und es ist EIN Command
    // fuer drei Personen, nicht drei Commands.
    const angelegt = (await antwort.json()) as BaustellentagAntwort;
    expect(angelegt.worksiteDayId).toMatch(UUID);
    expect(angelegt.configurationId).toMatch(UUID);
    expect(angelegt.team.map((m) => m.employeeId).sort()).toEqual([...A_TEAM].sort());
    for (const mitglied of angelegt.team) expect(mitglied.assignmentId).toMatch(UUID);

    // Sichtbar wird der NEU GELESENE Serverstand, nicht die Schreibantwort:
    // genau eine Karte am Tag, das Team untergeordnet.
    await karteGeprueft(page, angelegt, NEU_DATUM, `${NEU_BEGINN}–${NEU_ENDE}`);

    // Erfolg heisst Write UND passender Readback (EYT-158).
    const meldung = page.getByTestId("einsatzformular-meldung");
    await expect(meldung).toHaveAttribute("data-state", "erfolg");
    await expect(meldung).toContainText(/Serverstand/i);

    const nachher = await sichtbareZuweisungen(page);
    expect(nachher).toHaveLength(vorher.length + 3);
    for (const mitglied of angelegt.team) expect(nachher).toContain(mitglied.assignmentId);
    expect(await sichtbareBaustellentage(page)).toEqual(
      [...tageVorher, angelegt.worksiteDayId].sort(),
    );
  });

  test("Schritt 4: ein zweiter Baustellentag fuer dieselbe Baustelle und denselben Tag wird mit verstaendlichem Grund abgelehnt", async ({
    page,
  }) => {
    const vorher = await wocheOeffnen(page);
    const tageVorher = await sichtbareBaustellentage(page);

    // Genau dieselbe Baustelle und derselbe Tag wie im vorigen Test — der
    // Konflikt (DUPLICATE_WORKSITE_DAY) ist echt, nicht vorbereitet.
    await formularAusfuellen(page, NEU_BEGINN, NEU_ENDE);
    const [antwort] = await Promise.all([
      baustellentagAntwort(page),
      page.getByTestId("einsatz-speichern").click(),
    ]);
    expect(antwort.status()).toBe(409);

    // Verstaendlicher Grund, nicht nur ein Statuscode — und keine erfundene
    // Karte aus einer Ablehnung.
    const meldung = page.getByTestId("einsatzformular-meldung");
    await expect(meldung).toBeVisible();
    await expect(meldung).toHaveAttribute("data-state", "fehler");
    await expect(meldung).toContainText(/bereits ein Baustellentag/i);
    expect(await sichtbareBaustellentage(page)).toEqual(tageVorher);

    // Keine Teilwirkung: nach dem Reload steht die Liste unveraendert.
    // `wocheOeffnen` statt `reload`, damit hier dieselbe Wartebedingung gilt
    // wie oben — sonst vergliche der Test den Ladezustand mit dem Endzustand.
    expect(await wocheOeffnen(page)).toEqual(vorher);
    expect(await sichtbareBaustellentage(page)).toEqual(tageVorher);
  });

  test("Schritt 4: eine bereits eingeplante Person macht den ganzen Baustellentag atomar ungueltig", async ({
    page,
  }) => {
    const vorher = await wocheOeffnen(page);
    const tageVorher = await sichtbareBaustellentage(page);

    // Person A traegt am 30.09. die geseedete Entwurfszuweisung 06:00–10:00Z.
    // 07:00–15:00 Europe/Berlin ueberlappt sie; die beiden anderen Personen
    // sind frei. Ein Team ist EIN Command: keine zwei duerfen stehen bleiben.
    await formularAusfuellen(page, NEU_BEGINN, NEU_ENDE, KONFLIKT_DATUM);
    const [antwort] = await Promise.all([
      baustellentagAntwort(page),
      page.getByTestId("einsatz-speichern").click(),
    ]);
    expect(antwort.status()).toBe(409);

    const meldung = page.getByTestId("einsatzformular-meldung");
    await expect(meldung).toHaveAttribute("data-state", "fehler");
    await expect(meldung).toContainText(/bereits eingeplant/i);

    // Weder Karte noch Teilteam: derselbe Serverstand wie vorher.
    expect(await wocheOeffnen(page)).toEqual(vorher);
    expect(await sichtbareBaustellentage(page)).toEqual(tageVorher);
  });

  test("Schritt 4: ein ungueltiges Intervall erreicht den Server gar nicht erst", async ({
    page,
  }) => {
    const schreibaufrufe: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/planung/")) {
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
    const tage = await sichtbareBaustellentage(page);
    const provenienzVorher = await provenienz(page);
    // Der Speichertest hat drei Zeilen und genau einen Baustellentag ergaenzt;
    // stehen sie nicht mehr da, waren sie nie in PostgreSQL.
    expect(nachSpeichern.length).toBeGreaterThan(3);
    expect(tage.length).toBeGreaterThan(0);

    expect(await wocheOeffnen(page)).toEqual(nachSpeichern);
    expect(await sichtbareBaustellentage(page)).toEqual(tage);
    expect(await provenienz(page)).toEqual(provenienzVorher);

    const origin = new URL(page.url()).origin;
    const zweiter = await browser.newContext({ baseURL: origin });
    try {
      const zweiteSeite = await zweiter.newPage();
      expect(await wocheOeffnen(zweiteSeite)).toEqual(nachSpeichern);
      expect(await sichtbareBaustellentage(zweiteSeite)).toEqual(tage);
      expect(await provenienz(zweiteSeite)).toEqual(provenienzVorher);
    } finally {
      await zweiter.close();
    }
  });
});

/**
 * Zwei Faelle, zwei TAGE: dieselbe Baustelle am selben Tag waere seit EYT-158
 * kein zweiter Einsatz mehr, sondern ein Duplikat des Baustellentags — der
 * zweite Viewport saehe nur den Konflikt des ersten.
 */
const RESPONSIVE_CASES = [
  {
    name: "1440px",
    viewport: { width: 1440, height: 900 },
    datum: "2026-10-02",
    beginn: "07:00",
    ende: "09:00",
  },
  {
    name: "375px",
    viewport: { width: 375, height: 812 },
    datum: "2026-10-03",
    beginn: "10:00",
    ende: "12:00",
  },
] as const;

/**
 * Per Tastatur zum naechsten fachlichen Form-Control wechseln.
 *
 * Native date/time-Inputs besitzen in Chromium mehrere interne Segmente. Beim
 * Wechsel zwischen Tag, Monat, Jahr beziehungsweise Stunde und Minute bleibt
 * `document.activeElement` deshalb derselbe Input-Host. Die fachliche
 * Reihenfolge ist erst verletzt, wenn ein ANDERES, unerwartetes Control
 * dazwischenliegt oder das erwartete Ziel nach einer begrenzten Zahl von
 * Tab-Schritten nicht erreicht wird.
 */
async function tabZumNaechstenFormfeld(
  seite: import("@playwright/test").Page,
  aktuell: import("@playwright/test").Locator,
  ziel: import("@playwright/test").Locator,
): Promise<void> {
  const aktuellId = await aktuell.getAttribute("data-testid");
  const zielId = await ziel.getAttribute("data-testid");
  expect(aktuellId).not.toBeNull();
  expect(zielId).not.toBeNull();

  for (let schritt = 1; schritt <= 12; schritt += 1) {
    await seite.keyboard.press("Tab");
    const aktivId = await seite.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? null,
    );
    if (aktivId === zielId) return;
    if (aktivId !== aktuellId) {
      throw new Error(
        `Unerwartetes Fokusziel zwischen ${aktuellId} und ${zielId}: ${aktivId ?? "<ohne data-testid>"}.`,
      );
    }
  }

  throw new Error(`${zielId} wurde von ${aktuellId} aus nicht per Tab erreicht.`);
}

/**
 * EYT-104: dieselbe reale Kernreise in Desktop- und mobiler Kernbreite.
 *
 * Kein zweites Mock-E2E: beide Fälle schreiben über Web-Origin, NestJS, RLS
 * und PostgreSQL. Unterschiedliche Tage verhindern, dass der zweite Viewport
 * nur den Konflikt des ersten sieht.
 */
test.describe.serial("Planungsroute: Responsive- und Accessibility-Abnahme", () => {
  for (const fall of RESPONSIVE_CASES) {
    test(`${fall.name}: Speichern, Konflikt und Reload bleiben barrierearm bedienbar`, async ({
      page,
    }) => {
      await page.setViewportSize(fall.viewport);
      await wocheOeffnen(page);
      await inspectorOeffnen(page);

      const worksite = page.getByTestId("feld-worksite");
      const datum = page.getByTestId("feld-datum");
      const beginn = page.getByTestId("feld-beginn");
      const ende = page.getByTestId("feld-ende");
      const employee = page.getByTestId("feld-employee");
      const speichern = page.getByTestId("einsatz-speichern");

      await expect(worksite).toHaveAccessibleName("Baustelle");
      await expect(datum).toHaveAccessibleName("Datum");
      await expect(beginn).toHaveAccessibleName(/Beginn/);
      await expect(ende).toHaveAccessibleName(/Ende/);
      await expect(employee).toHaveAccessibleName(/Einsatzteam.*Mitarbeitende/);
      await expect(speichern).toHaveAccessibleName("Baustellentag speichern");

      await formularAusfuellen(page, fall.beginn, fall.ende, fall.datum);

      // Fokusreihenfolge innerhalb des Formulars — worksite-first (EYT-158) —,
      // jeweils mit sichtbarem Indikator. Ein programmatischer Start am ersten
      // Feld vermeidet, dass Headernavigation mit der fachlichen Reihenfolge
      // verwechselt wird.
      await worksite.focus();
      const fokusziele = [worksite, datum, beginn, ende, employee, speichern];
      for (const [index, ziel] of fokusziele.entries()) {
        await expect(ziel).toBeFocused();
        const focus = await ziel.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            outlineStyle: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
          };
        });
        expect(focus.outlineStyle).not.toBe("none");
        expect(focus.outlineWidth).toBeGreaterThan(0);
        const naechstesZiel = fokusziele[index + 1];
        if (naechstesZiel !== undefined) {
          await tabZumNaechstenFormfeld(page, ziel, naechstesZiel);
        }
      }

      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations).toEqual([]);

      const overflowBefore = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflowBefore).toBeLessThanOrEqual(0);

      const [createdResponse] = await Promise.all([baustellentagAntwort(page), speichern.click()]);
      expect(createdResponse.status()).toBe(201);
      const created = (await createdResponse.json()) as BaustellentagAntwort;
      expect(created.team).toHaveLength(3);
      await karteGeprueft(page, created, fall.datum, `${fall.beginn}–${fall.ende}`);

      const success = page.getByTestId("einsatzformular-meldung");
      await expect(success).toHaveAttribute("role", "status");
      await expect(success).toHaveAttribute("data-state", "erfolg");
      await expect(success).toContainText(/gespeichert/i);

      await wocheOeffnen(page);
      await karteGeprueft(page, created, fall.datum, `${fall.beginn}–${fall.ende}`);

      await formularAusfuellen(page, fall.beginn, fall.ende, fall.datum);
      const [conflictResponse] = await Promise.all([
        baustellentagAntwort(page),
        page.getByTestId("einsatz-speichern").click(),
      ]);
      expect(conflictResponse.status()).toBe(409);

      const alert = page.getByTestId("einsatzformular-meldung");
      await expect(alert).toHaveAttribute("role", "alert");
      await expect(alert).toHaveAttribute("data-state", "fehler");
      await expect(alert).toContainText(/bereits ein Baustellentag/i);
      const describedBy = await page
        .getByTestId("einsatzformular")
        .getAttribute("aria-describedby");
      expect(describedBy).toBe(await alert.getAttribute("id"));
      // Die Ablehnung erfindet keine zweite Karte.
      await expect(page.locator(`[data-tag="${fall.datum}"] .einsatzkarte`)).toHaveCount(1);

      const overflowAfter = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(overflowAfter).toBeLessThanOrEqual(0);
    });
  }
});
