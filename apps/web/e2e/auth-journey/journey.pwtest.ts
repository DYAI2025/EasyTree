import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Page,
  type APIRequestContext,
  type APIResponse,
  type Cookie,
} from "@playwright/test";

import { psqlMitMarker } from "./global-setup";

/**
 * Barrierefreiheits-Abnahme einer ANGEMELDETEN Sprint-6-Flaeche (EYT-141).
 *
 * ## Warum das hier steht und nicht in `shell-smoke.spec.ts`
 *
 * `shell-smoke` laeuft ohne Sitzung und kommt deshalb nur bis `/`. Genau das
 * war die Luecke: bis EYT-141 hat kein Browser-axe-Lauf je `/planung` oder
 * `/kosten` betreten — die beiden Flaechen, auf denen die Kernreise
 * stattfindet. Hier liegt eine echte GoTrue-Sitzung an, also sind sie
 * erreichbar, und die Daten darauf sind die echten aus PostgreSQL.
 *
 * ## Was gegenueber dem jsdom-Lauf hinzukommt
 *
 * `color-contrast`. Der braucht echtes Rendering und ist in jsdom
 * abgeschaltet; im Browser wird er ausdruecklich NICHT abgeschaltet — sonst
 * bliebe der Kontrast in beiden Laeufen ungeprueft und die Zusicherung waere
 * an keiner Stelle eingeloest.
 *
 * `best-practice` ist dabei, weil die Landmark-Regeln dort leben und nicht
 * unter den WCAG-Tags: `landmark-no-duplicate-main` haette den verschachtelten
 * `<main>` sonst auch im Browser durchgelassen.
 *
 * ## Drei Breiten, nicht eine
 *
 * EYT-141 und EYT-137 nennen 1440 px, 1920 px und 200-%-Zoom ausdruecklich.
 * Ein Lauf in der Playwright-Standardbreite haette keine davon abgedeckt und
 * die Zusicherung waere eine Behauptung geblieben. Siehe `ABNAHME_BREITEN`
 * unten dazu, warum 200-%-Zoom als halbierte CSS-Breite nachgestellt wird.
 *
 * ## Gegenmutation
 *
 * In `apps/web/components/planungs-werkbank.tsx` das `<section aria-label=…>`
 * auf `<main>` zuruecksetzen → dieser Schritt meldet `landmark-no-duplicate-main`
 * und der Job wird rot. Im jsdom-Lauf ist genau diese Mutation ausgefuehrt und
 * zurueckgenommen worden (`apps/web/test/planung-a11y.test.tsx`).
 */
/**
 * Die Abnahmebreiten aus EYT-141/EYT-137 — und was „200-%-Zoom" hier heisst.
 *
 * Ein Browser mit 200-%-Zoom auf einem 1440-px-Schirm hat eine CSS-Breite von
 * 720 px: die Pixel werden doppelt so gross, also passen halb so viele hinein.
 * Genau so wird er hier nachgestellt. `deviceScaleFactor` waere das FALSCHE
 * Werkzeug — der beschreibt die Pixeldichte des Geraets und laesst die
 * CSS-Breite unveraendert, womit kein Umbruch entstuende und die Pruefung
 * nichts messen wuerde.
 *
 * WCAG 2.1 §1.4.10 (Reflow) verlangt an dieser Stelle, dass kein Inhalt
 * horizontales Scrollen erzwingt. Das wird unten eigens geprueft, weil axe es
 * nicht kann: ob eine Seite seitlich ueberlaeuft, ergibt sich erst aus dem
 * Layout, nicht aus dem Markup.
 */
const ABNAHME_BREITEN = [
  { name: "1440 px", width: 1440, height: 900 },
  { name: "1920 px", width: 1920, height: 1080 },
  { name: "1440 px bei 200-%-Zoom (720 px CSS)", width: 720, height: 450 },
] as const;

/**
 * EYT-113: Abnahmebreiten der FELD-Shell — mobile-first 320/375 px laut
 * Akzeptanzkriterium. Bewusst eine eigene Liste: die Werkbank wird auf
 * Desktopbreiten abgenommen, die Feld-Shell auf Telefonbreiten; eine
 * gemeinsame Liste wuerde beiden Flaechen Breiten zusichern, fuer die sie
 * nicht entworfen sind.
 */
const FELD_BREITEN = [
  { name: "320 px", width: 320, height: 640 },
  { name: "375 px", width: 375, height: 720 },
] as const;

/**
 * Tastaturbedienbarkeit und SICHTBARER Fokus auf einer angemeldeten Flaeche
 * (EYT-141/EYT-137: „Tastatur, sichtbarer Fokus").
 *
 * ## Warum das hier fehlte
 *
 * Gemessen 20.08.2026: `shell-smoke.spec.ts` prueft den Tab-Zyklus — aber
 * ausschliesslich auf `/`. In dieser Datei kam `keyboard` bis eben **null Mal**
 * vor. `/planung` und `/kosten`, die beiden Flaechen der Kernreise, hatten also
 * keinen einzigen Tastaturnachweis; nur die Startseite hatte einen.
 *
 * ## Warum dieselbe Technik wie in `shell-smoke`
 *
 * Die Sichtbarkeitspruefung (`outline` mit Breite > 0 ODER `box-shadow`) ist
 * woertlich uebernommen und nicht neu erfunden. Zwei Definitionen von
 * „sichtbarer Fokus" waeren zwei Wahrheiten, die auseinanderlaufen koennen —
 * und die schwaechere gaebe dann den Ausschlag.
 *
 * ## Was NICHT geprueft wird
 *
 * Die DOM-Reihenfolge. `shell-smoke` vergleicht die Tab-Reihenfolge gegen die
 * DOM-Reihenfolge; das ist auf einer statischen Seite sinnvoll. Hier stehen
 * Formulare mit Zustaenden, die waehrend des Durchtabbens nachladen koennen —
 * eine Reihenfolgezusicherung waere dort flaky und wuerde als „Fokusfehler"
 * gelesen, obwohl sie ein Timingartefakt ist. Zugesichert wird deshalb das,
 * was hier wirklich traegt: **jedes** erreichte Element zeigt einen sichtbaren
 * Fokus, und es gibt keine Tastaturfalle.
 */
async function pruefeTastaturUndFokus(seite: Page, flaeche: string): Promise<void> {
  const fokussierbare = await seite.evaluate(
    () =>
      document.querySelectorAll(
        "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ).length,
  );
  // Nicht-vakuoes: eine Flaeche ohne fokussierbare Elemente wuerde die
  // Schleife unten null Mal durchlaufen und truege gruen nichts bei.
  expect(fokussierbare, `fokussierbare Elemente auf ${flaeche}`).toBeGreaterThan(0);

  const ohneIndikator: string[] = [];
  let beurteilt = 0;
  for (let i = 0; i < fokussierbare; i++) {
    await seite.keyboard.press("Tab");
    const halt = await seite.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null || el === document.body) return null;
      // `document.activeElement` ist KEIN verlaesslicher Beleg dafuer, dass der
      // Browser das Element als fokussiert ansieht. Gemessen am 20.08.2026 im
      // echten Chromium: `input[type="date"]` auf `/planung` ist
      // `activeElement`, matcht aber `:focus` NICHT — vermutlich, weil der
      // Fokus in der UA-Shadow-Root auf einem Segment sitzt.
      //
      // Ueber ein solches Element laesst sich ueber den Fokusrahmen nichts
      // aussagen: keine `:focus`-Regel kann greifen, und ein Befund waere ein
      // erfundener Fehler. Es wird deshalb uebersprungen — nicht stillschweigend,
      // sondern gezaehlt (siehe `beurteilt` unten).
      if (!el.matches(":focus")) return { uebersprungen: true } as const;
      const s = getComputedStyle(el);
      // `outline-width: auto` ist der Browser-Fokusring und ein ECHTER
      // Indikator — aber `parseFloat("auto")` ist `NaN`, und `NaN > 0` ist
      // `false`. Eine Sonde, die nur auf eine Zahl prueft, meldet ihn als
      // fehlend und erfindet damit einen Barrierefreiheitsfehler, den es nicht
      // gibt. `auto` zaehlt deshalb ausdruecklich mit.
      const breite = parseFloat(s.outlineWidth);
      const hatOutline = s.outlineStyle !== "none" && (s.outlineWidth === "auto" || breite > 0);
      const sichtbarerFokus = hatOutline || s.boxShadow !== "none";
      return {
        uebersprungen: false as const,
        id: `${el.tagName}:${el.getAttribute("data-testid") ?? el.textContent?.trim()?.slice(0, 40)}`,
        sichtbarerFokus,
        // Die gemessenen Werte reisen mit. Ohne sie sagt ein Fehlschlag nur
        // "kein Indikator" und die Diagnose beginnt bei null — genau das ist
        // beim ersten roten Lauf dieser Sonde passiert.
        // `:focus` und `:focus-visible` reisen mit, weil sie die beiden
        // moeglichen Ursachen TRENNEN: matcht `:focus` nicht, ist das Element
        // gar nicht wirklich fokussiert (z. B. weil das Dokument den
        // Fensterfokus verloren hat) und die Messung sagt nichts ueber das
        // CSS. Matcht es, greift die Regel wirklich nicht.
        befund:
          `outline-style=${s.outlineStyle} outline-width=${s.outlineWidth} box-shadow=${s.boxShadow}` +
          ` :focus=${el.matches(":focus")} :focus-visible=${el.matches(":focus-visible")}`,
      };
    });
    if (halt === null || halt.uebersprungen) continue;
    beurteilt += 1;
    if (!halt.sichtbarerFokus) {
      ohneIndikator.push(`${halt.id} (${halt.befund})`);
    }
  }

  // Der Schutz gegen einen vakuoesen Nachweis: haette der `:focus`-Filter oben
  // ALLE Elemente aussortiert, waere die Liste unten leer und der Test gruen,
  // ohne ein einziges Bedienelement geprueft zu haben.
  expect(beurteilt, `tatsaechlich beurteilte Bedienelemente auf ${flaeche}`).toBeGreaterThan(0);

  // Die Elemente werden BENANNT, nicht gezaehlt: „2 Elemente ohne Indikator"
  // zwingt zur Suche, die Liste zeigt sofort, welches Bedienelement gemeint ist.
  expect(ohneIndikator, `Elemente ohne sichtbaren Fokusindikator auf ${flaeche}`).toEqual([]);

  // Keine Tastaturfalle: ein weiterer Tab verlaesst das zuletzt fokussierte
  // Element. Ein Bedienelement, das den Fokus festhaelt, sperrt die ganze
  // Flaeche fuer alle, die nicht mit der Maus arbeiten.
  //
  // Ein Tab genuegt dafuer NICHT, und das ist gemessen, nicht vermutet: bei
  // `input[type="time"]` und `input[type="date"]` wandert Tab zuerst zwischen
  // den INNEREN Segmenten (Stunde/Minute bzw. Tag/Monat/Jahr). Der Fokus
  // bleibt dabei auf demselben Element, und ein Vergleich ueber einen einzigen
  // Tab meldet eine Falle, wo nur ein zusammengesetztes Bedienelement steht.
  // Die Reise hat genau diesen Fehlalarm auf `feld-beginn` erzeugt.
  //
  // Eine echte Falle gibt den Fokus NIE frei. Ein Budget von sechs Tabs deckt
  // die laengste hier vorkommende Segmentkette (Datum: drei) mit Reserve ab.
  const vorher = await seite.evaluate(() => document.activeElement?.outerHTML?.slice(0, 80) ?? "");
  let entkommen = false;
  for (let versuch = 0; versuch < 6 && !entkommen; versuch++) {
    await seite.keyboard.press("Tab");
    const jetzt = await seite.evaluate(() => document.activeElement?.outerHTML?.slice(0, 80) ?? "");
    entkommen = jetzt !== vorher;
  }
  expect(entkommen, `Tastaturfalle auf ${flaeche}: Fokus bleibt auf ${vorher}`).toBe(true);
}

async function pruefeBarrierefreiheit(
  seite: Page,
  flaeche: string,
  breiten: ReadonlyArray<{ name: string; width: number; height: number }> = ABNAHME_BREITEN,
): Promise<void> {
  const urspruenglich = seite.viewportSize();

  for (const breite of breiten) {
    await seite.setViewportSize({ width: breite.width, height: breite.height });

    const proBreite = await new AxeBuilder({ page: seite })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(
      proBreite.violations.map((verstoss) => `${verstoss.id} (${verstoss.nodes.length})`),
      `axe-Verstoesse auf ${flaeche} bei ${breite.name}`,
    ).toEqual([]);

    // Reflow: kein horizontales Scrollen. Ein Pixel Toleranz gegen
    // Subpixel-Rundung — mehr nicht, sonst verschwindet ein echter Ueberlauf
    // in der Toleranz.
    const ueberlauf = await seite.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(
      ueberlauf,
      `horizontaler Ueberlauf auf ${flaeche} bei ${breite.name}`,
    ).toBeLessThanOrEqual(1);
  }

  // Zurueck auf die Ausgangsbreite: die nachfolgenden Reiseschritte sollen
  // nicht in einer Breite weiterlaufen, die dieser Nachweis gesetzt hat.
  if (urspruenglich !== null) {
    await seite.setViewportSize(urspruenglich);
  }

  await pruefeTastaturUndFokus(seite, flaeche);

  const ergebnis = await new AxeBuilder({ page: seite })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();

  // Die Verstoesse werden BENANNT, nicht gezaehlt: eine Laengenzusicherung
  // meldet im Fehlerfall "expected 3 to be 0" und verschweigt, welche Regel
  // gefallen ist — dann beginnt die Diagnose bei null.
  expect(
    ergebnis.violations.map((verstoss) => `${verstoss.id} (${verstoss.nodes.length})`),
    `axe-Verstoesse auf ${flaeche}`,
  ).toEqual([]);

  // Genau EINE main-Landmark. Steht neben axe, weil sie unabhaengig von
  // dessen Regelkatalog gilt.
  await expect(seite.locator("main"), `main-Landmarks auf ${flaeche}`).toHaveCount(1);

  // Basisdesign v2.0 §2.3: hoechstens EIN primaerer CTA je Bildschirm. Die
  // Regel ist im Code durch die eigene Komponente sichtbar; hier wird sie
  // gemessen.
  const primaere = await seite.locator(".eyt-primary-action").count();
  expect(primaere, `primaere CTAs auf ${flaeche}`).toBeLessThanOrEqual(1);
}

/**
 * Die reale Auth-Kostenreise (EYT-106 AK8, EYT-134).
 *
 * Browser -> echte Loginseite -> GoTrue -> HttpOnly-Cookies -> Next-Rewrite ->
 * echte NestJS-API -> Policy -> RLS -> PostgreSQL. Kein Schritt ist ersetzt.
 *
 * ## Was diese Datei beweist, was `read-through.spec.ts` nicht kann
 *
 * Der Read-Through-Nachweis startet `dist-harness/test/harness/main.js` und
 * gibt das Subjekt als `process.argv[2]` mit. Er beweist den DATENWEG, nicht
 * die Identitaet. Hier laeuft `dist/main.js` — die echte Kette mit
 * Tokenverifikation (ES256 gegen den GoTrue-JWKS), Liveness-Pruefung bei jeder
 * Anfrage und der realen Kostenpolicy.
 *
 * ## Warum A/B und nicht "ohne Anmeldung 401"
 *
 * Eine fruehere Fassung behauptete, ein Aufruf OHNE Cookie liefere gegen den
 * Harness 200 und beweise damit, dass kein Subjekt eingeschleust ist. Das ist
 * FALSCH und am 02.08.2026 widerlegt worden: der Harness ersetzte die
 * Identitaet und lieferte auf dem Kostenpfad ebenfalls 401. Die Zusicherung
 * unterschied also nichts, und ihre benannte Gegenmutation waere nie rot
 * geworden.
 *
 * NACHTRAG EYT-107: seit dem Auth-Umbau ersetzt `apps/api/test/harness/server.ts`
 * nur noch `REQUEST_IDENTITY` — `TENANT_SUBJECT_RESOLVER` und
 * `DenyAllPlanningAccess` gibt es nicht mehr, die Planung haengt an derselben
 * Kette wie die Kosten. An der Aussage aendert das nichts, im Gegenteil: der
 * Harness ersetzt jetzt GENAU die Identitaet und kann ueber sie erst recht
 * nichts beweisen. Dieser Lauf hier kann es.
 *
 * Zwei echte Benutzer unterscheiden sehr wohl. A ist Owner, B ist ein ebenso
 * echter angemeldeter Benutzer ohne jede Mitgliedschaft. Waere eine feste
 * Identitaet eingeschleust, wuerde Bs Sitzung As Id nennen und der Kostenpfad
 * ihn durchlassen. Beides wird gemessen.
 *
 * ## Herkunft der Testidentitaet
 *
 * `global-setup.ts` meldet den Reisenden ueber den oeffentlichen
 * GoTrue-Signup an (Anon-Key, wie ein echter Mensch) und haengt mit
 * `fixtures.sql` Organisation, Owner-Mitgliedschaft, Mitarbeiter und eine
 * Satzversion daran. Kein Service-Role-Schluessel, keine Admin-API, kein
 * direktes Insert in `auth.users`.
 *
 * ## Gegenmutationen, die diese Datei rot machen
 *
 * - `REQUEST_IDENTITY` fest auf Benutzer A verdrahten: Bs Sitzung nennt dann
 *   As Id und der Kostenpfad laesst B durch — beide B-Nachweise werden rot.
 * - Die Kostenansicht die Gesamtsumme aus den Positionen summieren lassen
 *   (EYT-144): Schritt 9e wird rot — bei EINER Position faellt das hier zwar
 *   nicht auf, wohl aber in `kosten-ansicht.test.tsx` (Fall A1), wo die Fixtur
 *   Kopf- und Positionssumme absichtlich auseinanderlegt. Hier greift dafuer
 *   der Vergleich gegen PostgreSQL.
 * - Die Kostenansicht beim Oeffnen von `?snapshot=<id>` erneut erzeugen lassen
 *   (EYT-144): Schritt 9f wird rot (`POST /api/v1/kosten/snapshots` steht dann
 *   im Netzwerkprotokoll nach dem Reload), und 9g ebenfalls, weil das Skript
 *   `eyt144-snapshot-pruefen.sql` dann `koepfe=2` zaehlt.
 * - `costs.read` aus der Route `GET /kosten/planversionen` entfernen: der
 *   B-Nachweis „B erreicht weder Planversionsliste noch fremden Snapshot" wird
 *   rot, weil die Liste mit dem Organisationsheader von A dann 200 liefert.
 * - `pruefeRecht` in `MembershipCostAccessPolicy` auf „immer ok" setzen oder
 *   den `costs.read`-Zweig aus `KostenZugang` entfernen: Schritt 9g2 wird rot —
 *   ein `member` DERSELBEN Organisation saehe dann Kosten. Das ist die Grenze,
 *   die der B-Nachweis unten NICHT misst: dort fehlt die Mitgliedschaft, und
 *   die Policy beantwortet `ORG_NOT_A_MEMBER` und `PERMISSION_MISSING`
 *   absichtlich gleich.
 * - `('member','costs.read')` in `role_permissions` eintragen: 9g2 wird rot —
 *   an der Praemissenzusicherung, noch vor der ersten Messung.
 * - `GET /kosten/snapshots/:id` neu rechnen statt lesen lassen: Schritt 9g3
 *   wird rot, weil die Antwort nach der Satzaenderung eine andere Snapshot-Id
 *   und andere Positions-Ids traegt. Der BETRAG faellt dabei ausdruecklich
 *   nicht — die Begruendung steht bei 9g3.
 * - `serializeAccessCookie` ohne `HttpOnly` (Schritt 4).
 * - `SameSite=Lax` statt `Strict` (Schritt 4).
 * - Die Kosten-Navigation unabhaengig von `costs.read` rendern (Schritt 6
 *   bliebe gruen, aber Schritt 11 nach dem Abmelden wuerde rot).
 * - Das Logout ohne loeschende Cookies (Schritt 12).
 *   NACHTRAG EYT-113 Inkrement 2: `eyt_org` ist der bewusst SICHTBARE
 *   Selector der Organisationsauswahl (nie Autorisierung, nie Geheimnis —
 *   der Server prueft ihn gegen die echte Session). Schritt 11 prueft
 *   seither die NAMENSMENGE der sichtbaren Cookies (Teilmenge von
 *   { eyt_org }) und den Wert (exakt die Org-UUID, kein Punkt) statt Leere —
 *   ein `eyt_access` ohne `HttpOnly` macht ihn also WEITERHIN rot, jeder
 *   neue sichtbare Cookie ebenfalls. Und Schritt 12 sichert zusaetzlich zu,
 *   dass das Abmelden den Selector loescht: Clear-Zweig
 *   (`schreibeOrgAuswahl(null)`) in `app/providers.tsx` entfernen -> rot.
 * - `app.is_runtime_channel()` aus der Update-Policy von `plan_versions`
 *   entfernen (Migration 0015): Schritt 9c2 wird rot, weil PostgREST die
 *   Planversion dann tatsaechlich veroeffentlicht. Das ist der P1-Nachweis
 *   vom 04.08.2026 und der einzige Ort, an dem der ECHTE Angriffskanal
 *   gefahren wird.
 * - Spalten-Grant und `published_at is null` aus der Insert-Policy entfernen
 *   (Migration **0016**): Schritt 9c3 wird rot — PostgREST legt dann eine von
 *   Geburt an veroeffentlichte Planversion an. Befund F1 aus dem Selbstreview.
 *   BEIDE Riegel muessen fallen: einzeln entfernt haelt der jeweils andere
 *   (gemessen in den Laeufen 30874279915 und 30874546740).
 * - `app.is_runtime_channel()` aus `assignments_insert_in_org` oder
 *   `plan_versions_insert_in_org` entfernen (Migration **0017**): Schritt 9c4
 *   wird rot. Das ist der Kern des Nachweises — Reisender A TRAEGT
 *   `planning.write` (in 9c4 ueber sein eigenes Token gemessen), ihn haelt
 *   allein der Kanal ab.
 *   AUSGEFUEHRT: Lauf 31238564685 (`assignments`, INSERT kam mit **201**
 *   durch) und Lauf 31238659805 (`plan_versions`, ebenfalls **201**).
 * - Das `update`- bzw. `delete`-Recht auf `assignments` fuer `authenticated`
 *   wiederherstellen UND die zugehoerige Policy neu anlegen (Rollback-Rezept
 *   im Kopf von 0017): Schritt 9c5 wird rot — PATCH bzw. DELETE greifen dann
 *   durch, und die Nachkontrolle sieht eine veraenderte bzw. fehlende Zeile.
 *   AUSGEFUEHRT: Lauf 31238598756 (PATCH → **200**) und Lauf 31238658106
 *   (DELETE → **200**).
 *
 * Die folgenden drei sind DURCHDACHT, aber NICHT gefahren — sie stehen hier
 * als Ausfallanalyse, nicht als Nachweis. Wer sie als Beleg zitiert, zitiert
 * eine Ueberlegung:
 * - NUR den Grant wiederherstellen, die Policy weggelassen: 9c5 wird ebenfalls
 *   rot, aber frueher und aus einem anderen Grund — ohne permissive Policy
 *   waehlt das UPDATE null Zeilen aus, PostgREST antwortet mit 200 und leerer
 *   Menge (dieselbe Mechanik wie 9c2), und `erwarteRiegel` faellt schon an der
 *   Statuszusicherung. Die WIRKUNGSkontrollen blieben dabei gruen. Genau fuer
 *   diesen Fall gibt es die Riegelzusicherung: sie haelt fest, WELCHER Riegel
 *   getragen hat, nicht nur dass abgewiesen wurde.
 * - `('member','planning.write')` in `role_permissions` eintragen: 9c5 wird
 *   rot — aber NICHT an einer Angriffszusicherung, sondern schon am
 *   Praemissenwaechter in `eyt136-member-an.sql` (`raise exception`, noch vor
 *   dem ersten Angriff). Genau so soll es sein: der Angriff waere damit vakuos
 *   geworden, und das faellt VOR dem Angriff auf statt danach.
 * - Die Rueckgabe der Leihmitgliedschaft in 9c5 auslassen: die Nachbedingung
 *   in `eyt136-member-aus.sql` wirft (`leihe`/`b_gesamt` ungleich 0), und
 *   `psqlMitMarker` macht daraus einen roten Schritt. DAS ist der primaere
 *   Waechter. Sekundaer — und nur, wenn der Hauptnachweis sonst gruen bleibt —
 *   wuerde auch „Benutzer B ist angemeldet, aber ohne Mitgliedschaft
 *   ausgesperrt" rot, weil Bs Sitzung dann eine Organisation naennte.
 */

// `__dirname`, nicht `import.meta.url`: Playwright laedt Konfiguration,
// Setup und Testdateien als CommonJS — `apps/web/package.json` traegt kein
// "type": "module". Mit import.meta bricht der Lauf mit
// "Cannot use 'import.meta' outside a module" ab, bevor irgendein
// Nachweis laeuft (gemessen in CI 01.08.2026). Die beiden bestehenden
// Playwright-Konfigurationen benutzen aus demselben Grund keine.
const HIER = __dirname;
const ARTEFAKTE = join(HIER, "..", "..", "test-results", "auth-journey");

/**
 * EYT-113 Inkrement 2 — die Kosten-Chunkmenge des LAUFENDEN Builds.
 *
 * Die serverseitige Ladegrenze verspricht: in einem Verweigerungszustand
 * referenziert die Kostenroute KEINE Kosten-Client-Komponente — also weder
 * eine Chunk-Anfrage noch eine Chunk-Referenz im Dokument. Welche Dateien
 * das sind, wechselt mit jedem Build (die Namen tragen Hashes); abgeleitet
 * wird die Menge deshalb zur LAUFZEIT aus `.next/static/chunks/*.js`, ueber
 * drei Marker, die je genau EINE Quelldatei besitzt:
 *
 *   - `eyt-kosten-ansicht`  (components/kosten-ansicht.tsx)
 *   - `kosten-laedt`        (components/kosten-zugang.tsx)
 *   - `saetze-laedt`        (components/rate-management.tsx)
 *
 * Leere Menge => Wurf, nicht leere Rueckgabe: ein Waechter, der nichts findet,
 * wachte sonst still ueber nichts (`guard-exists-but-never-visits-the-surface`).
 * Gegenmutation: einen der drei Marker verschreiben — bei nur einem faellt die
 * Menge auf eine Datei zusammen und die Positivkontrolle unten schrumpft, bei
 * allen dreien wirft diese Funktion.
 */
function kostenChunkDateien(): string[] {
  const chunkVerzeichnis = join(HIER, "..", "..", ".next", "static", "chunks");
  const marker = ["eyt-kosten-ansicht", "kosten-laedt", "saetze-laedt"] as const;
  const dateien = readdirSync(chunkVerzeichnis)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => {
      const inhalt = readFileSync(join(chunkVerzeichnis, name), "utf8");
      return marker.some((m) => inhalt.includes(m));
    });
  if (dateien.length === 0) {
    throw new Error(
      "[auth-journey] EYT-113: kein Chunk unter .next/static/chunks traegt einen der drei " +
        "Kosten-Marker — die Ladegrenzen-Zusicherungen waeren vakuos.",
    );
  }
  return dateien;
}

const ORG_ID = "00000000-0000-4000-8000-00000000e201";
const ORG_NAME = "E2E Reiseorganisation";
const MITARBEITER_NAME = "E2E-Mitarbeiter Reise";
const MITARBEITER_ID = "00000000-0000-4000-8000-00000000e211";
/** Die Baustelle der Fixtur — Ziel der Data-API-Inserts in 9c4/9c5 (EYT-136). */
const BAUSTELLE_ID = "00000000-0000-4000-8000-00000000e241";
/** Die Zuweisung der Fixtur — Ziel von PATCH und DELETE in 9c5 (EYT-136). */
const ZUWEISUNG_ID = "00000000-0000-4000-8000-00000000e261";
/** 4250 Minor Units, so wie `minorUnitsToEuro` sie deutsch formatiert. */
const ERWARTETER_BETRAG = "42,50 €";
/** Eine Organisation, in der der Reisende NICHT Mitglied ist. */
const FREMDE_ORG = "00000000-0000-4000-8000-0000000000b2";

/**
 * Die Abloesung (EYT-108).
 *
 * Das Datum liegt bewusst NACH dem `valid_from` der Fixtur (2026-01-01) und
 * ist fest, nicht relativ zu heute: ein relatives Datum liesse den Test je
 * nach Laufzeitpunkt eine andere Aussage treffen.
 */
const ABLOESE_DATUM = "2026-09-01";
const ABLOESE_GRUND = "Tariferhoehung der E2E-Reise";

/**
 * Der letzte wirksame Tag des Vorgaengers (EYT-109 D1).
 *
 * Von Hand ausgeschrieben und NICHT aus {@link ABLOESE_DATUM} gerechnet:
 * teilte sich der Test die Umrechnung mit dem Produktivcode, hoebe ein Fehler
 * darin sich auf und der Nachweis waere gruen, ohne etwas zu messen
 * (`net-count-checks-cancel-out`). August hat 31 Tage.
 */
const LETZTER_TAG_VOR_ABLOESUNG = "2026-08-31";
/** Dasselbe fuer die zweite Abloesung: September hat 30 Tage. */
const LETZTER_TAG_VOR_ABLOESUNG_3 = "2026-09-30";

/**
 * Die ZWEITE Abloesung — sie entsteht NACH dem Snapshot (EYT-109 Task 17).
 *
 * Das Datum muss echt spaeter liegen als {@link ABLOESE_DATUM}: `pruefeAbloesung`
 * verlangt `nachfolger.validFrom > vorgaenger.validFrom` und liefert sonst
 * `NACHFOLGER_NICHT_SPAETER`. Und es liegt weit hinter dem Leistungstag des
 * Snapshots (03.08.2026) — nicht aus Bequemlichkeit, sondern weil die
 * Satzabloesung ueberhaupt keinen rueckwirkenden Nachfolger zulaesst. Was der
 * Nachweis darum zeigen kann und was nicht, steht bei Schritt 9g3.
 *
 * Fest und nicht relativ zu heute, aus demselben Grund wie {@link ABLOESE_DATUM}.
 * Der Lauf bleibt dadurch datumsunabhaengig: welche der drei Versionen am
 * Laufdatum „aktiv" heisst, spielt fuer keine Zusicherung eine Rolle — 9g3
 * waehlt seinen Vorgaenger ueber `validTo === null`, nicht ueber den Status.
 */
const ABLOESE_DATUM_3 = "2026-10-01";
const ABLOESE_GRUND_3 = "Zweite Tariferhoehung nach dem Snapshot";
const ABLOESE_BETRAG_3 = "5100";
/**
 * Idempotenzschluessel der zweiten Abloesung.
 *
 * Als Konstante und im Aufruf ueber eine kurze lokale Bindung — dieselbe
 * gitleaks-Falle wie bei {@link PUBLISH_VORGANG_146}: die Regel
 * `generic-api-key` schlaegt auf `Key": <bezeichner>` an, sobald der BEZEICHNER
 * genug Entropie hat.
 */
const SATZ_VORGANG_3 = `e2e-satz-nach-snapshot-${ABLOESE_DATUM_3}`;

/**
 * Der Kosten-Snapshot der Reise (EYT-144) — von Hand nachgerechnet.
 *
 * Die Zuweisung aus `fixtures.sql` laeuft am 03.08.2026 von 06:00Z bis 14:00Z,
 * in `Europe/Berlin` also 08:00–16:00: acht Stunden an EINEM lokalen Tag. Der
 * am 03.08. wirksame Satz ist der Startsatz mit 4250 Minor Units — die
 * Abloesung aus 9a beginnt erst am {@link ABLOESE_DATUM} (01.09.2026) und darf
 * hier gerade NICHT greifen. 8 × 4250 = 34000.
 *
 * Diese Zahl steht als Konstante und wird NICHT aus der Antwort uebernommen:
 * ein Server, der 0 lieferte, saehe sonst genauso gruen aus. Zusaetzlich
 * vergleicht die Reise die Anzeige mit dem Antwortkoerper UND mit der Zeile in
 * PostgreSQL — drei unabhaengige Quellen fuer denselben Betrag.
 */
const ERWARTETE_KOSTEN_MINOR = "34000";
const ERWARTETE_KOSTEN_ANZEIGE = "340,00 EUR";
/** 28.800.000 ms, wie die Ansicht sie formatiert. */
const ERWARTETE_DAUER = "8:00 h";

/**
 * Die Snapshot-Id der Reise, fuer den B-Nachweis (EYT-144).
 *
 * Modulweit, weil beide Faelle sie brauchen und in verschiedenen Testfunktionen
 * stehen; `mode: "serial"` plus `workers: 1` garantieren die Reihenfolge. Faellt
 * Reise A aus, bleibt sie leer — B faellt dann auf {@link ID_OHNE_SNAPSHOT}
 * zurueck, damit sein Nachweis eine gueltige Id anfragt statt an der
 * Eingabepruefung zu scheitern und damit gar nichts ueber Rechte zu sagen.
 */
let reiseSnapshotId = "";
const ID_OHNE_SNAPSHOT = "00000000-0000-4000-8000-00000000dead";

/**
 * Die Planwoche der Publish-Reise (EYT-107).
 *
 * Muss zu den Zeitstempeln in `fixtures.sql` passen: `2026-08-03T06:00:00Z`
 * ist in `Europe/Berlin` — der Zeitzone der Reiseorganisation — Montag der
 * ISO-Woche 32. Der Publish-Pfad prueft genau diese Zuordnung; das Schema tut
 * es nicht.
 */
const PLANWOCHE = "2026-W32";

/**
 * Die zweite Planwoche — der Baustellenfilter (EYT-146).
 *
 * EIGENE Woche und eigene Planversion, damit die von EYT-144 abgenommenen
 * Zahlen (`ERWARTETE_KOSTEN_MINOR`, eine Position) unangetastet bleiben. Eine
 * zweite Zuweisung in `PLANWOCHE` haette beide veraendert, und ein Nachweis,
 * der einen abgenommenen umschreibt, ist ein schlechter Nachweis.
 *
 * `2026-08-10T06:00:00Z` ist in `Europe/Berlin` Montag der ISO-Woche 33 — die
 * Zuordnung, die der Publish-Pfad prueft. W33 ist frei: W32 gehoert der Reise,
 * W35 dem Schritt 9c3, W36/W37 den Angriffswochen.
 */
const PLANWOCHE_146 = "2026-W33";
/** Der Entwurf aus `fixtures.sql`, den 9h ueber die echte API veroeffentlicht. */
const ENTWURF_146 = "00000000-0000-4000-8000-00000000e252";
/**
 * Die beiden Baustellen der W33-Version — benannt nach ihrer ROLLE im Nachweis,
 * nicht nach ihrer Reihenfolge.
 *
 * Gefiltert wird auf „E2E-Baustelle Reise" (…e241). „E2E-Baustelle Filter B"
 * (…e242) ist die, die danach nirgends mehr auftauchen darf — im Snapshot
 * nicht, in PostgreSQL nicht und im HTML nicht.
 */
const BAUSTELLE_GEFILTERT = "00000000-0000-4000-8000-00000000e241";
const BAUSTELLE_AUSGESCHLOSSEN = "00000000-0000-4000-8000-00000000e242";
/**
 * Der gefilterte Betrag — von Hand nachgerechnet, wie {@link ERWARTETE_KOSTEN_MINOR}.
 *
 * Die Zuweisung auf …e241 laeuft am 10.08.2026 von 06:00Z bis 10:00Z, in
 * `Europe/Berlin` also 08:00–12:00: vier Stunden an EINEM lokalen Tag. Der
 * Startsatz betraegt 4250 Minor Units; die Abloesung aus 9a beginnt erst am
 * {@link ABLOESE_DATUM}. 4 × 4250 = 17000.
 *
 * Die zweite Zuweisung (…e242, 11:00Z–15:00Z) traegt denselben Betrag. Genau
 * deshalb ist 17000 aussagekraeftig: waere der Filter wirkungslos, stuende hier
 * 34000 — die Zahl faellt also nicht nur bei einem leeren, sondern auch bei
 * einem ungefilterten Ergebnis auf.
 */
const ERWARTETE_FILTER_MINOR = "17000";
const ERWARTETE_FILTER_ANZEIGE = "170,00 EUR";
/**
 * Idempotenzschluessel des EYT-146-Publish.
 *
 * Als Konstante und nicht als Literal im Header — dieselbe gitleaks-Falle wie
 * bei {@link B_PUBLISH_VORGANG}: die Regel `generic-api-key` matcht das Muster
 * `Key": "<wert>"` und meldete den Inline-Wert als Fund.
 */
const PUBLISH_VORGANG_146 = `e2e-publish-${PLANWOCHE_146}`;

/**
 * Idempotenzschluessel des B-Nachweises.
 *
 * Als Konstante und nicht als Literal direkt im Header: gitleaks' Regel
 * `generic-api-key` matcht das Muster `Key": "<wert>"` und meldete den
 * Inline-Wert als Fund (gemessen 03.08.2026, `secret-scan` rot). Der Wert ist
 * kein Geheimnis — aber eine Ausnahme in `.gitleaksignore` waere der falsche
 * Weg: EYT-133 hat den Secret-Guard gerade gegen Dummy- und
 * Ausnahme-Bypaesse gehaertet. Das Muster zu vermeiden ist billiger als es zu
 * erlauben.
 */
const B_PUBLISH_VORGANG = `e2e-b-ohne-recht-${PLANWOCHE}`;

function pflicht(name: string): string {
  const wert = process.env[name];
  if (wert === undefined || wert === "") {
    throw new Error(`[auth-journey] ${name} fehlt — global-setup.ts hat nicht gelaufen?`);
  }
  return wert;
}

/**
 * Die beiden Angriffswochen der Entwurfsschreibflaeche (EYT-136).
 *
 * JE EINE EIGENE, ungenutzte Woche — und ausdruecklich nicht `PLANWOCHE`.
 * Gelaenge ein Angriff gegen die Reisewoche, antwortete der echte Publish in
 * 9d mit „bereits veroeffentlicht": der Lauf waere rot, aber an der falschen
 * Stelle und mit der falschen Begruendung. `2026-W35` gehoert bereits 9c3.
 */
const ANGRIFFSWOCHE_OWNER = "2026-W36";
const ANGRIFFSWOCHE_MEMBER = "2026-W37";

/**
 * Ein ECHTES Zugriffstoken ueber den oeffentlichen GoTrue-Weg (EYT-107, EYT-136).
 *
 * Nicht das HttpOnly-Cookie: das gehoert der API und ist fuer den Browser
 * unlesbar — genau deshalb holt sich ein Angreifer sein Token so. Dieselbe
 * Form, die Schritt 9c2 inline benutzt; hier als Funktion, weil 9c4 und 9c5
 * sie fuer zwei verschiedene Reisende brauchen.
 */
async function bearerKopf(
  request: APIRequestContext,
  supabaseUrl: string,
  anonKey: string,
  email: string,
  passwort: string,
): Promise<Record<string, string>> {
  const anmeldung = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey, "content-type": "application/json" },
    data: { email, password: passwort },
  });
  expect(anmeldung.status(), `GoTrue hat fuer ${email} kein Token ausgegeben`).toBe(200);
  const token = ((await anmeldung.json()) as { access_token?: string }).access_token ?? "";
  expect(token, `das Token fuer ${email} ist leer`).not.toBe("");
  return { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** Ein Lesezugriff ueber die Data-API, der 200 verlangt. */
async function dataApiLese<T>(
  request: APIRequestContext,
  url: string,
  kopf: Record<string, string>,
): Promise<T[]> {
  const antwort = await request.get(url, { headers: kopf });
  expect(antwort.status(), `Data-API-Lesen fehlgeschlagen: ${url}`).toBe(200);
  return (await antwort.json()) as T[];
}

/**
 * Der Fehlerkoerper von PostgREST — `code` ist der durchgereichte SQLSTATE.
 *
 * Er ist das einzige, was von aussen die beiden RIEGEL unterscheidet, die 0017
 * gesetzt hat. GEMESSEN im Lauf 31235882417 (Job 93048155065), alle sechs
 * Versuche mit `code = "42501"` und HTTP 403 — der Status allein unterscheidet
 * also NICHTS:
 *
 *   `with check`-Verletzung (0017 Z. 146-152, Z. 164-172)
 *     message  new row violates row-level security policy for table "assignments"
 *     hint     (leer)
 *
 *   entzogenes Tabellenrecht (0017 Z. 117-118)
 *     message  permission denied for table assignments
 *     hint     Grant the required privileges to the current role with:
 *              GRANT UPDATE ON public.assignments TO authenticated;
 *
 * Der `hint` ist der schaerfste der drei Befunde: PostgREST nennt darin das
 * FEHLENDE Recht beim Namen, also genau das, was 0017 entzogen hat. Deshalb
 * wird er mitgeprueft und nicht nur mitgeschrieben.
 *
 * Ohne diese Unterscheidung koennte ein 403 aus einem DRITTEN Grund kommen und
 * der Nachweis bliebe still gruen — und „welcher Riegel hat gehalten" ist die
 * ganze Aussage von EYT-136.
 */
interface DataApiFehler {
  readonly code: string;
  readonly message: string;
  readonly details: string;
  readonly hint: string;
}

interface Angriffsergebnis {
  readonly status: number;
  readonly koerperLaenge: number;
  readonly zeilen: number;
  /** Der geparste Fehlerkoerper, oder `null` bei einer Erfolgsantwort. */
  readonly fehler: DataApiFehler | null;
}

/** Nimmt nur Zeichenketten an; PostgREST setzt `details`/`hint` oft auf null. */
function alsText(wert: unknown): string {
  return typeof wert === "string" ? wert : "";
}

/**
 * Ein Data-API-SCHREIBversuch, festgehalten statt geraten.
 *
 * Der Koerper wird genau EINMAL gelesen (`text()`) — ein zweiter Zugriff auf
 * denselben `APIResponse` kann fehlschlagen —, und sowohl die Zeilenzahl als
 * auch der Fehlerkoerper entstehen daraus, nicht aus einem zweiten Aufruf.
 *
 * Jeder Versuch schreibt ausserdem eine greppbare Zeile ins CI-Log. Sie ist
 * der Rohbefund, gegen den die Zusicherungen im Aufrufer geschrieben sind: wer
 * sie spaeter aendert, sieht im Log, was gemessen wurde, statt raten zu
 * muessen.
 *
 * Bewusst OHNE Statuszusicherung: die trifft der Aufrufer. `9c2` ist der
 * stehende Gegenbeleg dafuer, dass ein abgewehrter Data-API-Schreibzugriff
 * nicht zwingend einen Fehlerstatus traegt (dort: 200 mit leerer Menge).
 */
async function dataApiSchreibversuch(
  name: string,
  aufruf: Promise<APIResponse>,
): Promise<Angriffsergebnis> {
  const antwort = await aufruf;
  const koerper = await antwort.text();
  let zeilen = 0;
  let fehler: DataApiFehler | null = null;

  if (antwort.ok()) {
    if (koerper !== "") {
      const geparst: unknown = JSON.parse(koerper);
      zeilen = Array.isArray(geparst) ? geparst.length : 1;
    }
  } else if (koerper !== "") {
    // Ein nicht-JSON-Koerper (etwa ein Proxy-Fehler) darf hier NICHT werfen:
    // sonst stuerbe der Fall an der Diagnose statt an der Sache. `fehler`
    // bleibt dann null, und die Zusicherung des Aufrufers auf `code` wird rot
    // — laut, mit dem Rohkoerper im Log.
    try {
      const roh = JSON.parse(koerper) as Record<string, unknown>;
      fehler = {
        code: alsText(roh["code"]),
        message: alsText(roh["message"]),
        details: alsText(roh["details"]),
        hint: alsText(roh["hint"]),
      };
    } catch {
      fehler = null;
    }
  }

  console.log(
    `  [eyt136-riegel] ${name} status=${antwort.status()} laenge=${koerper.length} ` +
      `code=${JSON.stringify(fehler?.code ?? null)} message=${JSON.stringify(fehler?.message ?? koerper.slice(0, 200))}`,
  );

  return { status: antwort.status(), koerperLaenge: koerper.length, zeilen, fehler };
}

/**
 * Welcher der beiden Riegel aus Migration 0017 einen Versuch abgewiesen hat.
 *
 *   `policy`         die `with check`-Klausel — Kanal bzw. Recht fehlt, das
 *                    Spalten- und Tabellenrecht besteht noch
 *   `tabellenrecht`  das Recht selbst ist entzogen; die Anweisung scheitert,
 *                    bevor ueberhaupt eine Zeile ausgewaehlt wird
 */
type Riegel =
  | { readonly art: "policy"; readonly tabelle: string }
  | {
      readonly art: "tabellenrecht";
      readonly tabelle: string;
      readonly recht: "UPDATE" | "DELETE";
    };

/**
 * Verlangt den gemessenen RIEGEL, nicht nur „irgendein 403".
 *
 * Warum das noetig ist: 403 ist die Abbildung von SQLSTATE 42501, und 42501
 * ist mehrdeutig — ein fehlendes Spalten- oder Tabellenrecht liefert ihn
 * ebenso wie eine RLS-Verletzung. Ohne diese Unterscheidung koennte ein 403
 * aus einem DRITTEN Grund kommen (ein Tippfehler im Spaltennamen, ein
 * unbeabsichtigt entzogenes Leserecht) und der Nachweis bliebe still gruen,
 * waehrend die Aussage „der Kanal hat gehalten" gar nicht mehr stimmt.
 *
 * Die erwarteten Zeichenketten sind GEMESSEN (Lauf 31235882417), nicht
 * hergeleitet. Aendert ein PostgreSQL- oder PostgREST-Update sie, wird dieser
 * Waechter rot und nennt den Unterschied — dann gilt die neue Messung, und
 * dieser Kommentar wird mit ihr fortgeschrieben.
 *
 * Die Wirkungskontrollen der Aufrufer (Bestand, `starts_at_utc`, leere Woche)
 * bleiben davon unberuehrt: sie sind kanal- und versionsunabhaengig und der
 * eigentliche Beweis.
 */
function erwarteRiegel(ergebnis: Angriffsergebnis, riegel: Riegel, was: string): void {
  expect(ergebnis.status, `${was}: nicht mit 403 abgewiesen`).toBe(403);
  expect(ergebnis.zeilen, `${was}: PostgREST hat Zeilen zurueckgegeben`).toBe(0);
  expect(ergebnis.fehler?.code, `${was}: nicht SQLSTATE 42501`).toBe("42501");

  if (riegel.art === "policy") {
    expect(
      ergebnis.fehler?.message,
      `${was}: keine RLS-Verletzung — das 403 kommt aus einem anderen Grund`,
    ).toBe(`new row violates row-level security policy for table "${riegel.tabelle}"`);
  } else {
    expect(
      ergebnis.fehler?.message,
      `${was}: kein entzogenes Tabellenrecht — das 403 kommt aus einem anderen Grund`,
    ).toBe(`permission denied for table ${riegel.tabelle}`);
    // PostgREST nennt im `hint` das fehlende Recht. Damit ist nicht nur
    // belegt, DASS ein Recht fehlt, sondern WELCHES — genau das, was 0017
    // Z. 117-118 entzogen hat.
    expect(ergebnis.fehler?.hint, `${was}: der Hinweis nennt nicht das entzogene Recht`).toContain(
      `GRANT ${riegel.recht} ON public.${riegel.tabelle} TO authenticated`,
    );
  }
}

function cookie(cookies: readonly Cookie[], name: string): Cookie {
  const treffer = cookies.find((k) => k.name === name);
  if (treffer === undefined) {
    throw new Error(
      `[auth-journey] Cookie ${name} fehlt. Vorhanden: ${cookies.map((k) => k.name).join(", ")}`,
    );
  }
  return treffer;
}

test.describe.configure({ mode: "serial" });

/**
 * Wo die maschinenlesbaren Zusammenfassungen entstehen — und warum NICHT im
 * Testkoerper.
 *
 * Bis EYT-136 schrieb der letzte Schritt jeder Reise ihre Zusammenfassung und
 * setzte darin `"ergebnis": "PASS"` — als KONSTANTE, im Quelltext. Gemessen im
 * Basislauf 31237004812: die Datei behauptete `"ergebnis": "PASS"`, waehrend 31
 * Zusicherungen gefallen waren. Ein Feld namens „Ergebnis", dessen Wert
 * danebensteht, ist kein Befund — es ist Dekoration in einem Artefakt, das ein
 * Reviewer oeffnet und fuer einen Befund haelt.
 *
 * Berechnen liess es sich im Koerper nicht: `test.info().status` ist dort noch
 * NICHT final (Playwright setzt ihn, wenn der Koerper durch ist), und
 * `test.info().errors` bliebe in dieser Datei immer leer, weil hier keine
 * einzige weiche Zusicherung steht — eine harte bricht ab, statt zu zaehlen.
 * Eine im Koerper berechnete Zahl waere also nur die naechste Konstante
 * gewesen.
 *
 * Also wandert das Schreiben dorthin, wo der Ausgang feststeht: `afterEach`.
 * `ergebnis` ist jetzt gemessen. Zwei Nebenwirkungen, beide erwuenscht:
 *
 *  - Die Zusammenfassung entsteht auch bei einem ROTEN Lauf. Vorher brach der
 *    Koerper vorher ab, die Datei fehlte ganz, und ausgerechnet der
 *    interessanteste Fall hinterliess das duennste Artefakt. Der CI-Schritt
 *    „Screenshots, Zusammenfassung und Traces sichern" laeuft mit
 *    `if: always()` und laedt sie mit hoch.
 *  - `bericht` wird als Referenz hinterlegt, nicht als Kopie: was die Schritte
 *    bis zum Abbruch eingetragen haben, steht drin. Wie weit der Lauf kam, ist
 *    damit ablesbar statt behauptet.
 *
 * Schluessel ist `testId` und nicht der Titel: er bleibt ueber Wiederholungen
 * stabil und geht bei einer Umbenennung nicht still ins Leere.
 */
const ZUSAMMENFASSUNGEN = new Map<
  string,
  { readonly datei: string; readonly bericht: Record<string, unknown> }
>();

test.afterEach(() => {
  const info = test.info();
  const eintrag = ZUSAMMENFASSUNGEN.get(info.testId);
  // Kein Eintrag heisst: dieser Fall ist gar nicht erst gelaufen (im
  // `serial`-Modus faellt jeder Nachfolger eines roten Falles aus). Dann gibt
  // es auch nichts zu protokollieren.
  if (eintrag === undefined) return;
  mkdirSync(ARTEFAKTE, { recursive: true });
  writeFileSync(
    join(ARTEFAKTE, eintrag.datei),
    `${JSON.stringify(
      {
        ...eintrag.bericht,
        ergebnis: info.status ?? "unbekannt",
        erwartetes_ergebnis: info.expectedStatus,
        zusicherungsfehler: info.errors.length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});

test("Reale Auth-Kostenreise vom Login bis zur ungueltigen Sitzung", async ({
  page,
  context,
  request,
}) => {
  const email = pflicht("EASYTREE_JOURNEY_EMAIL_A");
  const passwort = pflicht("EASYTREE_JOURNEY_PASSWORT_A");
  const benutzerId = pflicht("EASYTREE_JOURNEY_USER_A");

  /** Jede API-Anfrage des Browsers — Beleg dafuer, WELCHEN Weg die Daten nahmen. */
  const apiAufrufe: string[] = [];
  page.on("request", (anfrage) => {
    const pfad = new URL(anfrage.url()).pathname;
    if (pfad.startsWith("/api/")) apiAufrufe.push(`${anfrage.method()} ${pfad}`);
  });

  /**
   * EYT-113: jede angeforderte Chunk-Datei — die Positivkontrolle der
   * Ladegrenze. VOR der ersten Navigation registriert, sonst fehlte genau
   * die Anfrage, die beim Einstieg in `/kosten` faellt.
   */
  const chunkAnfragen: string[] = [];
  page.on("request", (anfrage) => {
    const pfad = new URL(anfrage.url()).pathname;
    if (pfad.startsWith("/_next/static/chunks/")) chunkAnfragen.push(pfad);
  });

  const bericht: Record<string, unknown> = {
    ticket: "EYT-106",
    paket: "B",
    zusatz: "EYT-107 Publish-Durchstich",
    // Lebende Referenz: `afterEach` serialisiert, was bis dahin aufgelaufen ist.
    api_aufrufe: apiAufrufe,
    schritte: {},
  };
  const schritte = bericht["schritte"] as Record<string, unknown>;
  ZUSAMMENFASSUNGEN.set(test.info().testId, { datei: "zusammenfassung.json", bericht });

  /** Serverseitige Ids der Planversion — in 9c gelesen, in 9d verglichen. */
  let entwurfsVersionId = "";
  let veroeffentlichteVersionId = "";

  await test.step("1 — ohne Anmeldung lehnt die API ab", async () => {
    // Notwendig, aber NICHT hinreichend: der Testharness antwortet hier
    // ebenfalls 401 (gemessen). Der unterscheidende Nachweis ist Benutzer B
    // weiter unten.
    const ohneSitzung = await page.request.get("/api/v1/kosten/mitarbeiter");
    expect(ohneSitzung.status()).toBe(401);
    schritte["1_ohne_anmeldung"] = {
      status: ohneSitzung.status(),
      erwartet: 401,
      hinweis: "notwendig, nicht hinreichend — unterscheidet nicht vom Harness",
    };
  });

  await test.step("2 — die echte Loginseite ausfuellen und absenden", async () => {
    await page.goto("/anmelden");
    await expect(page.getByRole("heading", { name: "Anmelden", level: 1 })).toBeVisible();
    await page.getByLabel("E-Mail").fill(email);
    await page.getByLabel("Passwort").fill(passwort);
    await page.getByRole("button", { name: "Anmelden" }).click();
  });

  await test.step("3 — die Anmeldung fuehrt in den Kostenbereich", async () => {
    // `router.push("/kosten")` plus ein NICHT zurueckgesetzter Sitzungszustand:
    // die Seite zeigt kurz den abgemeldeten Banner, bevor `GET /auth/session`
    // antwortet. Deshalb auf den ENDZUSTAND warten, nicht auf Abwesenheit
    // unmittelbar nach dem Klick.
    await page.waitForURL("**/kosten");
    await expect(page.getByRole("heading", { name: "Kosten", level: 1 })).toBeVisible();
    await expect(page.getByTestId("kosten-unauthenticated")).toHaveCount(0);
    // Bis EYT-144 stand hier `kosten-leer` — der Platzhalter der Ansicht, die
    // noch keine Berechnung hatte. Die Ansicht ist jetzt echt; ihr ehrlicher
    // Anfangszustand heisst „noch kein Snapshot gewaehlt". Die Aussage des
    // Schrittes bleibt dieselbe: angemeldet, berechtigt, und OHNE Zahlen.
    await expect(page.getByTestId("kosten-kein-snapshot")).toBeVisible();
    await expect(page.getByLabel("Von Woche")).toBeVisible();
  });

  await test.step("3b — EYT-113 Positivkontrolle: der Berechtigte laedt die Kosten-Chunks", async () => {
    // Die Gegenseite des member-Nachweises in der Feld-Reise unten: nur wenn
    // die abgeleitete Chunkmenge beim BERECHTIGTEN nachweislich angefordert
    // wird, sagt ihr Ausbleiben beim Unberechtigten etwas aus. Gegenmutation:
    // einen Marker in `kostenChunkDateien()` verschreiben — die Ableitung
    // wirft, oder diese Schnittmenge wird leer.
    const kostenChunks = kostenChunkDateien();
    const geladeneKostenChunks = chunkAnfragen.filter((pfad) =>
      kostenChunks.some((datei) => pfad.endsWith(`/${datei}`)),
    );
    expect(
      geladeneKostenChunks.length,
      `Kosten-Chunks [${kostenChunks.join(", ")}] — keiner wurde angefordert`,
    ).toBeGreaterThan(0);
    await page.screenshot({
      path: test.info().outputPath("eyt113-kosten-positiv.png"),
      fullPage: true,
    });
    schritte["3b_eyt113_positivkontrolle"] = {
      kosten_chunks: kostenChunks,
      angefordert: geladeneKostenChunks,
    };
  });

  await test.step("4 — Sicherheitsnachweis: beide Sitzungscookies sind HttpOnly und Strict", async () => {
    const cookies = await context.cookies();
    const access = cookie(cookies, "eyt_access");
    const refresh = cookie(cookies, "eyt_refresh");

    for (const [name, k] of [
      ["eyt_access", access],
      ["eyt_refresh", refresh],
    ] as const) {
      expect(k.httpOnly, `${name} muss HttpOnly sein`).toBe(true);
      expect(k.sameSite, `${name} muss SameSite=Strict tragen`).toBe("Strict");
      expect(k.path).toBe("/");
      // Der Lauf spricht http gegen 127.0.0.1; `Secure` setzt die API
      // ausschliesslich bei NODE_ENV=production (auth.controller.ts). Ein
      // `Secure`-Cookie waere hier NICHT uebertragbar und die Reise scheiterte
      // mit einer irrefuehrenden Meldung. Die production-Seite deckt der
      // Unit-Test von `session-cookies.ts` ab; hier wird die HTTP-Seite
      // ehrlich festgehalten statt eine HTTPS-Behauptung erfunden.
      expect(k.secure, `${name} traegt im HTTP-Modus kein Secure`).toBe(false);
    }
    // Das Access-Cookie laeuft mit dem Token ab, das Refresh-Cookie ist ein
    // Sitzungscookie (kein Max-Age -> expires === -1).
    expect(access.expires).toBeGreaterThan(0);
    expect(refresh.expires).toBe(-1);

    schritte["4_cookies"] = {
      eyt_access: { httpOnly: access.httpOnly, sameSite: access.sameSite, secure: access.secure },
      eyt_refresh: {
        httpOnly: refresh.httpOnly,
        sameSite: refresh.sameSite,
        secure: refresh.secure,
      },
      hinweis: "secure=false ist korrekt: der Lauf spricht http, Secure gilt nur in production.",
    };
  });

  await test.step("5 — der Sitzungsendpunkt kennt genau diesen Benutzer", async () => {
    const antwort = await page.request.get("/api/v1/auth/session");
    expect(antwort.status()).toBe(200);
    const sitzung = (await antwort.json()) as {
      userId: string;
      organisations: { id: string; name: string; role: string; permissions: string[] }[];
    };
    // Der Benutzer, den GoTrue beim Signup angelegt hat — nicht irgendeiner.
    expect(sitzung.userId).toBe(benutzerId);
    expect(sitzung.organisations).toHaveLength(1);
    const org = sitzung.organisations[0]!;
    expect(org.id).toBe(ORG_ID);
    expect(org.name).toBe(ORG_NAME);
    expect(org.role).toBe("owner");
    expect(org.permissions).toContain("costs.read");
    expect(org.permissions).toContain("costs.manage_rates");
    // Kein Token in der Antwort — die Sitzung reist ausschliesslich im Cookie.
    expect(JSON.stringify(sitzung)).not.toContain("eyJ");

    schritte["5_session"] = {
      userId_stimmt: sitzung.userId === benutzerId,
      rolle: org.role,
      rechte: org.permissions,
    };
  });

  await test.step("6 — die Kosten-Navigation ist sichtbar und fuehrt weiter", async () => {
    const kostenLink = page.getByRole("link", { name: "Kosten" });
    await expect(kostenLink).toBeVisible();
    await expect(kostenLink).toHaveAttribute("href", "/kosten");
    // Genau eine Organisation -> kein Auswahlfeld, sondern ihr Name.
    await expect(page.getByText(ORG_NAME)).toBeVisible();
  });

  await test.step("7 — Screenshot der angemeldeten AppShell", async () => {
    mkdirSync(ARTEFAKTE, { recursive: true });
    await page.screenshot({
      path: join(ARTEFAKTE, "01-angemeldete-appshell.png"),
      fullPage: true,
    });
  });

  await test.step("8 — die Mitarbeiterliste kommt ueber den echten API-Pfad", async () => {
    const antwort = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/kosten/mitarbeiter" && r.status() === 200,
    );
    await page.goto("/kosten/stundensaetze");
    await antwort;

    await expect(page.getByRole("heading", { name: "Stundensätze", level: 1 })).toBeVisible();
    const auswahl = page.getByLabel("Mitarbeiter auswählen");
    await expect(auswahl).toBeVisible();
    await expect(auswahl.getByRole("option", { name: MITARBEITER_NAME })).toHaveCount(1);

    // Nicht nur "es steht da", sondern "es kam von dort": der Aufruf ist im
    // Netzwerkprotokoll dieses Browsers belegt.
    expect(apiAufrufe).toContain("GET /api/v1/kosten/mitarbeiter");
  });

  await test.step("9 — die Stundensatzhistorie zeigt die echte Satzversion", async () => {
    const antwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/kosten/stundensaetze/${MITARBEITER_ID}` &&
        r.status() === 200,
    );
    await page.getByLabel("Mitarbeiter auswählen").selectOption({ label: MITARBEITER_NAME });
    await antwort;

    const tabelle = page.getByTestId("satzhistorie");
    await expect(tabelle).toBeVisible();
    await expect(tabelle.getByText(ERWARTETER_BETRAG)).toBeVisible();
    await expect(tabelle.getByText("Startsatz der E2E-Reise")).toBeVisible();
    // Genau eine Version, und sie ist aktiv.
    await expect(tabelle.locator("tbody tr")).toHaveCount(1);
    await expect(tabelle.getByText("aktiv")).toBeVisible();

    mkdirSync(ARTEFAKTE, { recursive: true });
    await page.screenshot({
      path: join(ARTEFAKTE, "02-stundensatzverwaltung.png"),
      fullPage: true,
    });
    schritte["9_historie"] = { betrag: ERWARTETER_BETRAG, zeilen: 1 };
  });

  await test.step("9a — eine neue Satzversion loest die offene ab (EYT-108)", async () => {
    // Der Kern von EYT-108, ueber die ECHTE Oberflaeche: kein direkter
    // Datenbankschreibzugriff, keine Fixtur, kein Repository-Stub. Was hier
    // passiert, passiert genau so auch fuer einen Menschen.
    const angelegt = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/stundensaetze" &&
        r.request().method() === "POST",
    );
    await page.getByLabel("Betrag (EUR pro Stunde)").fill("48,00");
    await page.getByLabel("Gültig ab").fill(ABLOESE_DATUM);
    await page.getByLabel("Änderungsgrund").fill(ABLOESE_GRUND);
    await page.getByRole("button", { name: "Neue Satzversion anlegen" }).click();
    const antwort = await angelegt;
    expect(antwort.status()).toBe(201);

    const tabelle = page.getByTestId("satzhistorie");
    // Jetzt ZWEI Versionen: der Vorgaenger ist geschlossen, der Nachfolger
    // verweist sichtbar auf ihn.
    await expect(tabelle.locator("tbody tr")).toHaveCount(2);
    await expect(tabelle.getByText(`ersetzt Version vom 2026-01-01`)).toBeVisible();
    await expect(tabelle.getByText("2026-01-01").first()).toBeVisible();
    await expect(tabelle.getByText(ABLOESE_GRUND)).toBeVisible();

    // EYT-109 D1 — die Naht, im echten Browser gelesen.
    //
    // Unter „Gültig bis" steht der LETZTE wirksame Tag, nicht der Beginn des
    // Nachfolgers: der Vorgaenger endet am 31.08., der Nachfolger beginnt am
    // 01.09. Kein Tag doppelt, keiner fehlt. Vor D1 stand hier zweimal
    // `2026-09-01` — einmal als Ende, einmal als Beginn.
    //
    // Gegenmutation: `dbEndeZuValidTo` aus `toRecord` entfernen -> die Spalte
    // zeigte wieder `2026-09-01`, und diese Zusicherung wird rot.
    // `gueltig-bis` wird NICHT umbenannt (`removing-a-testid-breaks-e2e-silently`).
    const enddaten = await tabelle.getByTestId("gueltig-bis").allTextContents();
    expect(enddaten).toHaveLength(2);
    expect(enddaten).toContain(LETZTER_TAG_VOR_ABLOESUNG);
    expect(enddaten).toContain("—");
    expect(enddaten).not.toContain(ABLOESE_DATUM);

    await page.screenshot({
      path: join(ARTEFAKTE, "03-satzabloesung.png"),
      fullPage: true,
    });
    schritte["9a_abloesung"] = { zeilen: 2, status: antwort.status() };
  });

  await test.step("9b — Reload und ein ZWEITER Browserkontext zeigen denselben Stand", async () => {
    // Reload beweist Persistenz gegen den lokalen Komponentenzustand.
    await page.reload();
    await page.getByLabel("Mitarbeiter auswählen").selectOption({ label: MITARBEITER_NAME });
    await expect(page.getByTestId("satzhistorie").locator("tbody tr")).toHaveCount(2);

    // Der zweite Kontext hat eigene Cookies und einen eigenen Speicher. Er
    // beweist, dass der Zustand im Server liegt und nicht im Browser des
    // Bearbeiters — ein Reload allein koennte aus einem Cache kommen.
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));
      await seite2.goto("/kosten/stundensaetze");
      await seite2.getByLabel("Mitarbeiter auswählen").selectOption({ label: MITARBEITER_NAME });
      const tabelle2 = seite2.getByTestId("satzhistorie");
      await expect(tabelle2.locator("tbody tr")).toHaveCount(2);
      await expect(tabelle2.getByText(ABLOESE_GRUND)).toBeVisible();
      schritte["9b_zweiter_kontext"] = { zeilen: 2 };
    } finally {
      await zweiter.close();
    }
  });

  // ---------------------------------------------------------------------
  // 9c/9d — Der Publish-Durchstich (EYT-107)
  // ---------------------------------------------------------------------
  // Warum HIER und nicht im read-through-Harness: dieser Lauf faehrt die echte
  // `dist/main.js` mit echter GoTrue-Anmeldung und echten HttpOnly-Cookies.
  // Der Harness ersetzt `REQUEST_IDENTITY` und koennte deshalb ueber die
  // Identitaet nichts aussagen — er bewiese nur den Pfad dahinter.
  await test.step("9c — die Planungswoche zeigt einen Entwurf", async () => {
    await page.goto(`/planung?weekKey=${PLANWOCHE}`);

    // Der Waechter gibt nur mit `planning.read` frei; A ist owner und traegt
    // es seit Migration 0015.
    const stand = page.getByTestId("planungsfenster-stand");
    await expect(stand).toBeVisible();
    await expect(stand).toHaveAttribute("data-stand", "entwurf");

    // Die serverseitige Entwurfs-Id — sie geht gleich als
    // `expectedVersionId` hinaus.
    const version = page.getByTestId("planungsfenster-version");
    entwurfsVersionId = (await version.getAttribute("data-source-version-id")) ?? "";
    expect(entwurfsVersionId).not.toBe("");
    await expect(version).toHaveAttribute("data-published-version-id", "");

    await page.screenshot({
      path: join(ARTEFAKTE, "04-planung-entwurf.png"),
      fullPage: true,
    });
    schritte["9c_entwurf"] = { versionId: entwurfsVersionId };
  });

  // ---------------------------------------------------------------------
  // 9c1 — Barrierefreiheit der PLANUNGSflaeche, angemeldet (EYT-141)
  // ---------------------------------------------------------------------
  await test.step("9c1 — /planung besteht axe inklusive Kontrast", async () => {
    await pruefeBarrierefreiheit(page, "/planung");
  });

  // ---------------------------------------------------------------------
  // 9c2 — Der P1-Nachweis: die Data-API veroeffentlicht NICHT (EYT-107)
  // ---------------------------------------------------------------------
  // Der Befund vom 04.08.2026: `authenticated` besass aus Migration 0007 ein
  // Tabellen-UPDATE auf `plan_versions` ohne Spaltenbegrenzung, und PostgREST
  // stellt `public` als Data-API bereit. Eine Owner-Rolle konnte damit
  // `published_at` unmittelbar setzen — am Command vorbei, also ohne
  // Wochenzuordnungspruefung, ohne benannte Konflikte, ohne Idempotenz, ohne
  // Audit und ohne Outbox.
  //
  // Dies ist die EINZIGE Stelle im Repository, die den echten Angriffskanal
  // faehrt: ein per GoTrue angemeldeter Mensch, sein echtes Bearer-Token, die
  // echte PostgREST-Instanz. pgTAP kann das nicht — dort ist `session_user`
  // `postgres` und laesst sich ohne Superuser nicht wechseln.
  await test.step("9c2 — ein direkter PostgREST-Schreibzugriff bewirkt nichts", async () => {
    const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
    const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");

    // Ein ECHTES Zugriffstoken, ueber denselben oeffentlichen Weg wie ein
    // Mensch. Nicht das HttpOnly-Cookie: das gehoert der API und ist fuer den
    // Browser unlesbar — genau deshalb holt sich ein Angreifer sein Token so.
    const anmeldung = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: { apikey: anonKey, "content-type": "application/json" },
      data: { email, password: passwort },
    });
    expect(anmeldung.status(), "GoTrue hat kein Token ausgegeben").toBe(200);
    const token = ((await anmeldung.json()) as { access_token?: string }).access_token ?? "";
    expect(token).not.toBe("");

    const restKopf = {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    // ZUERST die Nichtvakuositaet: dasselbe Token SIEHT die Zeile ueber
    // PostgREST. Ohne diesen Schritt bewiese ein fehlgeschlagenes PATCH nur,
    // dass irgendetwas an der Anfrage nicht stimmt — ein abgelaufenes Token,
    // ein falscher Pfad, eine nicht exponierte Tabelle. So ist belegt: der
    // Kanal traegt, nur das Schreiben nicht.
    const lesen = await request.get(
      `${supabaseUrl}/rest/v1/plan_versions?id=eq.${entwurfsVersionId}&select=id,published_at`,
      { headers: restKopf },
    );
    expect(lesen.status(), "das Token kann die Planversion nicht einmal lesen").toBe(200);
    const gelesen = (await lesen.json()) as { id: string; published_at: string | null }[];
    expect(gelesen).toHaveLength(1);
    expect(gelesen[0]?.published_at, "die Version ist vor dem Versuch kein Entwurf").toBeNull();

    // Der Angriff.
    const angriff = await request.patch(
      `${supabaseUrl}/rest/v1/plan_versions?id=eq.${entwurfsVersionId}`,
      {
        headers: { ...restKopf, prefer: "return=representation" },
        data: { published_at: "2026-08-03T09:00:00Z", published_by: benutzerId },
      },
    );
    const geaendert = angriff.ok() ? ((await angriff.json()) as unknown[]) : [];

    // HIER wird bewusst KEIN Fehlerstatus behauptet. Gemessen im gruenen Lauf
    // 30875136833 antwortet PostgREST mit **200** und einer leeren
    // Repraesentation: die `using`-Klausel der Update-Policy filtert die Zeile
    // aus dem Statement heraus, und ein UPDATE ueber null Zeilen ist fuer
    // PostgreSQL kein Fehler. Es gibt nichts zu melden — also meldet PostgREST
    // Erfolg ueber die leere Menge.
    //
    // Eine Assertion auf einen Nicht-2xx-Status waere hier deshalb falsch und
    // wuerde diesen Nachweis rot machen, obwohl der Angriff scheitert. Der
    // Wirkungsnachweis ist die leere Menge plus der Nachlauf ueber die
    // Anwendung. Beim INSERT in 9c3 liegt es anders — dort wirft PostgreSQL,
    // und dort steht der Status auch in der Zusicherung.
    expect(
      geaendert,
      "PostgREST hat eine Planversion veroeffentlicht — der Command ist umgehbar",
    ).toHaveLength(0);

    // Und die Wahrheit noch einmal aus der Anwendung, nicht aus der Antwort
    // des Angreifers: die Woche ist weiterhin Entwurf. Waere `published_at`
    // gesetzt worden, haette der Sync-Trigger aus 0010 in derselben
    // Transaktion auch die Zuweisungen gestempelt — und Schritt 9d wuerde
    // gleich „bereits veroeffentlicht" melden statt zu veroeffentlichen.
    await page.reload();
    const standDanach = page.getByTestId("planungsfenster-stand");
    await expect(standDanach).toHaveAttribute("data-stand", "entwurf");
    await expect(page.getByTestId("planungsfenster-version")).toHaveAttribute(
      "data-published-version-id",
      "",
    );

    schritte["9c2_postgrest_bypass"] = {
      lesen: lesen.status(),
      schreiben: angriff.status(),
      geaenderteZeilen: geaendert.length,
      erwartet: 0,
      hinweis: "P1 04.08.2026 — app.is_runtime_channel() in Migration 0015",
    };

    // -----------------------------------------------------------------------
    // 9c3 — dieselbe Tuer, nur andersherum: INSERT statt UPDATE (Befund F1)
    // -----------------------------------------------------------------------
    // Das Selbstreview der P1-Korrektur fand die zweite Tuer. Das UPDATE war
    // abgedichtet, das ANLEGEN nicht: `authenticated` durfte `published_at`
    // mitgeben, und keiner der beiden Trigger auf plan_versions feuert bei
    // INSERT. Eine so geborene Planversion waere sofort veroeffentlicht,
    // unveraenderlich und unloeschbar gewesen — ohne Wochenzuordnungspruefung,
    // ohne Konflikte, ohne Idempotenz, ohne Audit, ohne Outbox.
    //
    // EIGENE Woche, nicht die der Reise: der Entwurf aus 9c soll unberuehrt
    // bleiben, damit 9d weiterhin den echten Uebergang misst. Waere die
    // Angriffswoche dieselbe, wuerde ein erfolgreicher Angriff den Publish in
    // 9d mit „bereits veroeffentlicht" beantworten — der Fall waere rot, aber
    // an der falschen Stelle und mit der falschen Begruendung.
    const ANGRIFFSWOCHE = "2026-W35";
    const anlegen = await request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
      headers: { ...restKopf, prefer: "return=representation" },
      data: {
        org_id: ORG_ID,
        week_key: ANGRIFFSWOCHE,
        published_at: "2026-08-24T09:00:00Z",
        published_by: benutzerId,
      },
    });
    const angelegt = anlegen.ok() ? ((await anlegen.json()) as unknown[]) : [];

    // ANDERS als beim UPDATE in 9c2 wirft PostgreSQL hier: das Spaltenrecht auf
    // `published_at` fehlt (0016), das ist SQLSTATE 42501, und PostgREST bildet
    // 42501 auf HTTP 403 ab. Gemessen im gruenen Lauf 30875136833:
    // `schritte["9c3_postgrest_insert"].status = 403`.
    //
    // 403 und nicht 401: der Reisende IST angemeldet, sein Token ist gueltig,
    // und derselbe Kopf hat in 9c2 erfolgreich gelesen. Verboten ist die
    // Handlung, nicht die Identitaet.
    //
    // Der Status ist stabil, nicht zufaellig: faellt der Spalten-Grant weg,
    // greift die Insert-Policy — eine `with check`-Verletzung ist ebenfalls
    // 42501 und ebenfalls 403 (gemessen in GM-F1a, Lauf 30874279915: dieser
    // Nachweis blieb gruen, rot wurde allein die Katalogaussage in pgTAP).
    // Erst wenn BEIDE Riegel fallen, antwortet PostgREST mit einem
    // Erfolgsstatus und einer angelegten Zeile — gemessen in GM-F1a+F1b,
    // Lauf 30874546740: „Received length: 1".
    expect(anlegen.status(), "der blockierte INSERT wurde nicht mit 403 abgewiesen").toBe(403);

    expect(
      angelegt,
      "PostgREST hat eine bereits veroeffentlichte Planversion angelegt",
    ).toHaveLength(0);

    // Und nachgesehen, nicht geglaubt: fuer diese Woche existiert gar keine
    // Zeile. Ein `insert`, der nur `published_at` verliert und als Entwurf
    // durchginge, waere ebenfalls ein Befund — die Woche gehoert niemandem,
    // der sie nicht ueber die Anwendung angelegt hat.
    const nachsehen = await request.get(
      `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE}&select=id,published_at`,
      { headers: restKopf },
    );
    expect(nachsehen.status()).toBe(200);
    expect((await nachsehen.json()) as unknown[]).toHaveLength(0);

    schritte["9c3_postgrest_insert"] = {
      status: anlegen.status(),
      angelegteZeilen: angelegt.length,
      erwartet: 0,
      erwarteterStatus: 403,
      hinweis: "F1 04.08.2026 — Spalten-Grant und published_at is null in 0016",
    };
  });

  // ---------------------------------------------------------------------
  // 9c4/9c5 — Die ENTWURFSschreibflaeche der Data-API (EYT-136)
  // ---------------------------------------------------------------------
  // 9c2 und 9c3 messen das VEROEFFENTLICHEN. Der Entwurf blieb offen: bis
  // Migration 0017 konnte ein aktives Mitglied ueber PostgREST
  //
  //   POST   /rest/v1/assignments         Entwurfszuweisung anlegen
  //   PATCH  /rest/v1/assignments?id=eq.  Zuweisung verschieben
  //   DELETE /rest/v1/assignments?…       Entwurfsstand loeschen
  //   POST   /rest/v1/plan_versions       Entwurfs-Planversion anlegen
  //
  // senden. Der `published_at is null`-Riegel aus 0016 half dabei NICHT — ein
  // Entwurf erfuellt ihn ja gerade. Umgangen wurden damit das atomare Recht
  // `planning.write`, die Intervall- und Konfliktvalidierung, die
  // Wochenzugehoerigkeit (`OUTSIDE_WEEK`), die Advisory-Lock-Serialisierung,
  // der Idempotenzdatensatz, das Audit-Ereignis, die Outbox und die
  // Korrelations-Id.
  //
  // ZWEI Reisende, weil einer nichts unterscheidet:
  //
  //   9c4  Owner MIT `planning.write`  -> beweist den KANAL-Riegel
  //   9c5  member OHNE `planning.write` -> beweist den RECHTE-Riegel und den
  //                                        vollstaendigen Entzug von update/delete
  //
  // Ohne 9c4 bewiese der Nachweis nur „wer nichts darf, darf nichts". Ohne 9c5
  // bliebe offen, ob `planning.write` ueberhaupt gilt.
  //
  // VOR 9d, und das ist tragend: nach dem Veroeffentlichen wuerde zusaetzlich
  // `app.reject_published_row_change()` aus 0010 ablehnen, und es waere nicht
  // mehr entscheidbar, welcher Riegel gehalten hat.
  await test.step("9c4 — der Owner MIT planning.write schreibt ueber die Data-API nicht", async () => {
    const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
    const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");
    const kopf = await bearerKopf(request, supabaseUrl, anonKey, email, passwort);

    const zuweisungenUrl = `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id,starts_at_utc,ends_at_utc`;

    // Nichtvakuositaet 1 — der Kanal TRAEGT. Dasselbe Token liest die
    // Zuweisungen der Organisation ueber PostgREST. Ohne diese Messung bewiese
    // ein abgelehnter Schreibzugriff nur, dass irgendetwas an der Anfrage nicht
    // stimmt: ein abgelaufenes Token, ein falscher Pfad, eine nicht exponierte
    // Tabelle.
    const zuweisungenVorher = await dataApiLese<{ id: string; starts_at_utc: string }>(
      request,
      zuweisungenUrl,
      kopf,
    );
    expect(
      zuweisungenVorher.length,
      "der Owner sieht ueber die Data-API keine einzige Zuweisung — der Kanal traegt nicht",
    ).toBeGreaterThanOrEqual(1);

    // Nichtvakuositaet 2 — A traegt `planning.write` WIRKLICH, gemessen ueber
    // SEIN EIGENES Token. `app.has_permission` liegt im Schema `app` und ist
    // ueber PostgREST nicht als RPC erreichbar (supabase/config.toml exponiert
    // nur `public` und `graphql_public`). Was hier steht, ist stattdessen exakt
    // der Rumpf jener Funktion, aus zwei Lesezugriffen zusammengesetzt:
    // `memberships` (Policy `memberships_select_own` gibt nur die EIGENE Zeile
    // frei) join `role_permissions`.
    const mitgliedschaftA = await dataApiLese<{ org_id: string; role: string; active: boolean }>(
      request,
      `${supabaseUrl}/rest/v1/memberships?select=org_id,role,active`,
      kopf,
    );
    expect(mitgliedschaftA).toHaveLength(1);
    expect(mitgliedschaftA[0]?.org_id).toBe(ORG_ID);
    expect(mitgliedschaftA[0]?.role).toBe("owner");
    expect(mitgliedschaftA[0]?.active).toBe(true);

    const ownerRecht = await dataApiLese<{ role: string; permission: string }>(
      request,
      `${supabaseUrl}/rest/v1/role_permissions?role=eq.owner&permission=eq.planning.write&select=role,permission`,
      kopf,
    );
    expect(
      ownerRecht,
      "der Owner traegt planning.write nicht — der Kanalnachweis waere vakuos",
    ).toHaveLength(1);
    // Diese beiden Lesezugriffe SIND `app.has_permission` — dieselbe
    // Mitgliedschaft, dieselbe Rollenzuordnung, nur ueber As eigenes Token
    // statt ueber die Funktion. Die Funktion selbst wird ebenfalls befragt,
    // aber erst gleich in 9c5: `eyt136-member-an.sql` misst sie fuer BEIDE
    // Reisenden ueber die Verwaltungsverbindung und verlangt
    // `a_has_permission=t`. Hier fehlt sie also nicht, sie kommt spaeter.

    // Nichtvakuositaet 3 — die Angriffswoche ist VORHER leer. Die Kontrolle
    // danach (`toHaveLength(0)`) ist zwar strenger und kann nicht falsch gruen
    // werden; eine vorbestehende Zeile ergaebe aber ein Rot mit falscher
    // Begruendung.
    const wocheUrlOwner = `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE_OWNER}&select=id`;
    expect(
      await dataApiLese<{ id: string }>(request, wocheUrlOwner, kopf),
      `${ANGRIFFSWOCHE_OWNER} ist vor dem Angriff nicht leer`,
    ).toHaveLength(0);

    /**
     * Beide Wirkungen nach JEDEM Angriff, nicht einmal netto am Ende.
     *
     * Der Grund ist in 9c5 GEMESSEN worden (Basislauf 31237004812): dort stand
     * genau eine Netto-Bestandskontrolle am Ende, sie meldete
     * `bestand_vorher: 2, bestand_danach: 2` und blieb gruen — waehrend ein
     * INSERT eine Zeile anlegte (+1) und ein DELETE die Zielzeile entfernte
     * (-1). Wirkungen, die sich aufheben, besiegen jede Netto-Zahl.
     *
     * 9c4 pruefte schon vorher nach jedem Angriff, aber je nur die EINE
     * Wirkung, die dieser Angriff plausibel haben konnte. Diese Regel muss ein
     * Leser jedes Mal neu herleiten und veraltet still, sobald ein Angriff
     * hinzukommt. Hier gilt jetzt die einfache Regel: nach jedem Angriff steht
     * BEIDES fest. Wer diese Aufrufe an das Ende verschiebt, stellt genau den
     * Zustand wieder her, der im Basislauf gruen log.
     */
    const wirkungOwner = async (was: string): Promise<number> => {
      const bestand = (await dataApiLese<{ id: string }>(request, zuweisungenUrl, kopf)).length;
      expect(
        bestand,
        `${was}: der Zuweisungsbestand hat sich veraendert — ein Schreibzugriff ist durchgegangen`,
      ).toBe(zuweisungenVorher.length);
      expect(
        await dataApiLese<{ id: string }>(request, wocheUrlOwner, kopf),
        `${was}: ${ANGRIFFSWOCHE_OWNER} traegt jetzt eine Planversion — die Woche gehoert niemandem`,
      ).toHaveLength(0);
      return bestand;
    };

    // Angriff 1 — eine Entwurfszuweisung in die ECHTE Planversion der Reise.
    // Dienstag derselben Woche, bewusst OHNE Ueberlappung mit der Fixtur: ein
    // Konflikt mit `assignments_no_published_overlap` liesse den Versuch
    // scheitern, ohne dass die Kanalgrenze etwas dazu beitraege — der Nachweis
    // waere gruen und wuerde den falschen Riegel messen.
    //
    // Die Nutzlast traegt EXAKT die sechs Spalten, die 0017 noch grantet
    // (Z. 138-139) — `id` ist NICHT dabei. Das ist tragend: waere auch nur eine
    // ungegrantete Spalte im Koerper, koennte das 403 aus dem fehlenden
    // Spaltenrecht stammen, und 9c4 waere ein Grant-Nachweis statt eines
    // KANAL-Nachweises. Nichts hier hinzufuegen.
    const insertZuweisung = await dataApiSchreibversuch(
      "9c4/assignments-insert",
      request.post(`${supabaseUrl}/rest/v1/assignments`, {
        headers: { ...kopf, prefer: "return=representation" },
        data: {
          org_id: ORG_ID,
          plan_version_id: entwurfsVersionId,
          employee_id: MITARBEITER_ID,
          worksite_id: BAUSTELLE_ID,
          starts_at_utc: "2026-08-04T06:00:00Z",
          ends_at_utc: "2026-08-04T14:00:00Z",
        },
      }),
    );
    // GEMESSEN (Lauf 31235882417): 403, SQLSTATE 42501, „new row violates
    // row-level security policy for table \"assignments\"". Das ist der
    // `with check`-Riegel und NICHT das Spaltenrecht — die sechs gesendeten
    // Spalten sind alle gegrantet (0017 Z. 138-139). Genau deshalb ist dieser
    // Schritt ein KANAL-Nachweis: A traegt `planning.write`, die Organisation
    // stimmt, uebrig bleibt `app.is_runtime_channel()`.
    erwarteRiegel(
      insertZuweisung,
      { art: "policy", tabelle: "assignments" },
      "9c4 INSERT assignments",
    );

    const bestandNachZuweisung = await wirkungOwner("9c4 nach INSERT assignments");

    // Angriff 2 — eine ENTWURFS-Planversion, ganz ohne `published_at`. Genau
    // die Form, die 0016 noch durchliess. Auch hier exakt die gegranteten
    // Spalten `(org_id, week_key)` aus 0017 Z. 160, ohne `id`.
    const insertVersion = await dataApiSchreibversuch(
      "9c4/plan_versions-insert",
      request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
        headers: { ...kopf, prefer: "return=representation" },
        data: { org_id: ORG_ID, week_key: ANGRIFFSWOCHE_OWNER },
      }),
    );
    erwarteRiegel(
      insertVersion,
      { art: "policy", tabelle: "plan_versions" },
      "9c4 INSERT plan_versions",
    );

    const bestandNachVersion = await wirkungOwner("9c4 nach INSERT plan_versions");

    schritte["9c4_owner_entwurfsschreiben"] = {
      rolle: "owner",
      hat_planning_write: ownerRecht.length === 1,
      lesen_traegt: zuweisungenVorher.length,
      assignments_insert: {
        status: insertZuweisung.status,
        koerperLaenge: insertZuweisung.koerperLaenge,
        angelegteZeilen: insertZuweisung.zeilen,
        erwarteterStatus: 403,
        fehler: insertZuweisung.fehler,
      },
      plan_versions_insert_entwurf: {
        status: insertVersion.status,
        koerperLaenge: insertVersion.koerperLaenge,
        angelegteZeilen: insertVersion.zeilen,
        erwarteterStatus: 403,
        woche: ANGRIFFSWOCHE_OWNER,
        fehler: insertVersion.fehler,
      },
      // Je Angriff eine eigene Momentaufnahme, nicht eine Netto-Zahl am Ende:
      // siehe die Begruendung an `wirkungOwner` (Basislauf 31237004812).
      bestand_je_angriff: {
        nach_assignments_insert: bestandNachZuweisung,
        nach_plan_versions_insert: bestandNachVersion,
      },
      zuweisungen_unveraendert: bestandNachVersion === zuweisungenVorher.length,
      hinweis: "EYT-136 — app.is_runtime_channel() in den Insert-Policies von 0017",
    };
  });

  await test.step("9c5 — ein member OHNE planning.write erreicht die Zuweisungen nicht", async () => {
    const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
    const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");
    const emailB = pflicht("EASYTREE_JOURNEY_EMAIL_B");
    const passwortB = pflicht("EASYTREE_JOURNEY_PASSWORT_B");
    const idB = pflicht("EASYTREE_JOURNEY_USER_B");
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    // `catch` statt `finally`: ein `throw` im `finally` verwuerfe einen bereits
    // laufenden Fehler aus dem Fall — genau deshalb verbietet
    // `no-unsafe-finally` ihn. Eingefangen laeuft die Rueckgabe auf JEDEM Weg.
    // Der Fehler liegt im Tupel, damit „kein Fehler" von „hat null geworfen"
    // unterscheidbar bleibt.
    let fehlerAusFall: [unknown] | null = null;
    try {
      // Die Leihgabe: B bekommt fuer GENAU diesen Schritt eine aktive
      // `member`-Mitgliedschaft. Kein neuer Benutzer — `auth.users` bleibt
      // unberuehrt (PO-Vorgabe 08.08.2026), beide Reisenden stammen aus dem
      // echten GoTrue-Signup. `psqlMitMarker` wirft, wenn die Markerzeile fehlt
      // oder psql einen Fehler meldet; das ist der Lesenachweis nach dem
      // Schreiben.
      //
      // Dieser Aufruf steht INNERHALB des `try`, und das ist kein Stilentscheid:
      // `eyt136-member-an.sql` committet die Zeile und prueft ihre
      // Nachbedingung DANACH. Wirft die Nachbedingung, ist die Mitgliedschaft
      // bereits geschrieben — stuende der Aufruf davor, liefe die Rueckgabe
      // unten nie und die Leihgabe ueberlebte auf genau dem Weg, fuer den
      // `eyt136-member-aus.sql` geschrieben wurde.
      const an = psqlMitMarker(
        verwaltung,
        join(HIER, "eyt136-member-an.sql"),
        ["-v", `benutzer_a=${benutzerId}`, "-v", `benutzer_b=${idB}`],
        "[eyt136-member-an]",
      );
      console.log(`  ${an}`);

      const kopfB = await bearerKopf(request, supabaseUrl, anonKey, emailB, passwortB);

      // Vorbedingung 1 — das Token traegt, und die Leihgabe wirkt: B liest
      // seine EIGENE Mitgliedszeile (Policy `memberships_select_own`).
      const mitgliedschaftB = await dataApiLese<{
        org_id: string;
        role: string;
        active: boolean;
      }>(request, `${supabaseUrl}/rest/v1/memberships?select=org_id,role,active`, kopfB);
      expect(mitgliedschaftB, "B sieht seine geliehene Mitgliedschaft nicht").toHaveLength(1);
      expect(mitgliedschaftB[0]?.org_id).toBe(ORG_ID);
      expect(mitgliedschaftB[0]?.role).toBe("member");
      expect(mitgliedschaftB[0]?.active).toBe(true);

      // Vorbedingung 2 — `member` traegt `planning.write` NICHT. Zusammen mit
      // Vorbedingung 1 ist das exakt der Rumpf von `app.has_permission`, ueber
      // Bs eigenes Token gemessen. `role_permissions` ist fuer jeden
      // Angemeldeten lesbar (`using (true)`, Migration 0013).
      const memberRecht = await dataApiLese<{ role: string; permission: string }>(
        request,
        `${supabaseUrl}/rest/v1/role_permissions?role=eq.member&permission=eq.planning.write&select=role,permission`,
        kopfB,
      );
      expect(
        memberRecht,
        "member traegt planning.write — der Rechtenachweis waere vakuos",
      ).toHaveLength(0);

      // Vorbedingung 3 — die ZIELZEILE von PATCH und DELETE ist fuer B
      // sichtbar. Ohne sie bewiese eine abgelehnte Aenderung nur, dass die
      // Zeile fuer ihn gar nicht existiert; die `using`-Klausel haette dann
      // gefiltert und nicht das fehlende Recht.
      const zielUrl = `${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}&select=id,starts_at_utc,ends_at_utc`;
      const zielVorher = await dataApiLese<{
        id: string;
        starts_at_utc: string;
        ends_at_utc: string;
      }>(request, zielUrl, kopfB);
      expect(zielVorher, "die Zielzeile ist fuer den member nicht sichtbar").toHaveLength(1);
      const startVorher = zielVorher[0]?.starts_at_utc ?? "";
      expect(startVorher).not.toBe("");

      const bestandUrl = `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id`;
      const bestandVorher = (await dataApiLese<{ id: string }>(request, bestandUrl, kopfB)).length;
      expect(bestandVorher).toBeGreaterThanOrEqual(1);

      // Vorbedingung 4 — die Angriffswoche ist VORHER leer (dieselbe
      // Begruendung wie in 9c4: die Nachkontrolle koennte nicht falsch gruen
      // werden, wohl aber falsch rot).
      const wocheUrlMember = `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ANGRIFFSWOCHE_MEMBER}&select=id`;
      expect(
        await dataApiLese<{ id: string }>(request, wocheUrlMember, kopfB),
        `${ANGRIFFSWOCHE_MEMBER} ist vor dem Angriff nicht leer`,
      ).toHaveLength(0);

      /**
       * Die Wirkung nach JEDEM einzelnen Angriff — der Kern des Befunds vom
       * 08.08.2026.
       *
       * GEMESSEN, nicht befuerchtet. Der Basislauf 31237004812 fuhr genau diese
       * vier Angriffe gegen den Code OHNE Migration 0017; drei davon gingen
       * durch. Im Artefakt stand trotzdem
       *
       *     "bestand_vorher": 2,
       *     "bestand_danach": 2
       *
       * und die zugehoerige Zusicherung war GRUEN. Der Grund: das INSERT des
       * members legte eine Zeile an (+1), sein DELETE entfernte die Zielzeile
       * (-1), und die EINE Netto-Kontrolle am Ende sah eine unveraenderte Zahl.
       * Rot wurden damals nur `zielDanach` (Zielzeile verschwunden) und der
       * `starts_at_utc`-Vergleich — die stehen unten unveraendert weiter, sie
       * sind der Grund, dass der Basislauf ueberhaupt aufflog.
       *
       * Mit einer Momentaufnahme nach jedem einzelnen Angriff kann sich keine
       * Wirkung mehr gegen eine spaetere aufheben: das INSERT faellt auf, BEVOR
       * das DELETE es maskieren kann.
       *
       * Beide Wirkungen werden nach jedem Angriff geprueft, auch wo eine davon
       * nicht betroffen sein KANN (ein PATCH aendert keine Zeilenzahl). Die
       * Regel „nach jedem Angriff steht beides fest" ist pruefbar; die Regel
       * „nach jedem Angriff steht das fest, was er plausibel beruehrt" muesste
       * ein Leser jedes Mal neu herleiten und veraltet still.
       */
      const bestandNach = async (was: string): Promise<number> => {
        const jetzt = (await dataApiLese<{ id: string }>(request, bestandUrl, kopfB)).length;
        expect(
          jetzt,
          `${was}: der Zuweisungsbestand hat sich veraendert — INSERT oder DELETE ist durchgegangen`,
        ).toBe(bestandVorher);
        return jetzt;
      };
      const zielNach = async (was: string): Promise<string> => {
        const zeile = await dataApiLese<{ id: string; starts_at_utc: string }>(
          request,
          zielUrl,
          kopfB,
        );
        expect(
          zeile,
          `${was}: die Zielzeile ist verschwunden — DELETE ist durchgegangen`,
        ).toHaveLength(1);
        expect(
          zeile[0]?.starts_at_utc,
          `${was}: die Zielzeile wurde verschoben — PATCH ist durchgegangen`,
        ).toBe(startVorher);
        return zeile[0]?.starts_at_utc ?? "";
      };

      // Angriff 1 — anlegen. Spaltenrechte bestehen (dieselben sechs Spalten
      // wie in 9c4, ohne `id`), es scheitert die `with check`-Klausel: hier
      // fehlen Kanal UND Recht.
      const insertZuweisung = await dataApiSchreibversuch(
        "9c5/assignments-insert",
        request.post(`${supabaseUrl}/rest/v1/assignments`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: {
            org_id: ORG_ID,
            plan_version_id: entwurfsVersionId,
            employee_id: MITARBEITER_ID,
            worksite_id: BAUSTELLE_ID,
            starts_at_utc: "2026-08-05T06:00:00Z",
            ends_at_utc: "2026-08-05T14:00:00Z",
          },
        }),
      );
      erwarteRiegel(
        insertZuweisung,
        { art: "policy", tabelle: "assignments" },
        "9c5 INSERT assignments",
      );
      // HIER, unmittelbar nach dem INSERT, faellt der Basislauf-Fehlbefund auf:
      // die angelegte Zeile ist jetzt sichtbar, das spaetere DELETE kann sie
      // nicht mehr maskieren.
      const bestandNachInsert = await bestandNach("9c5 nach INSERT assignments");
      const startNachInsert = await zielNach("9c5 nach INSERT assignments");

      // Angriff 2 — verschieben. Der neue Beginn liegt VOR dem alten und
      // verletzt keinen Check (`starts_at_utc < ends_at_utc` bleibt wahr): der
      // Versuch wuerde ohne 0017 durchgehen, nicht an einer Nebenbedingung
      // scheitern.
      //
      // Hier ist die Erwartung eine ANDERE als in 9c2, und der Unterschied ist
      // der ganze Punkt von 0017: dort filterte nur die `using`-Klausel, das
      // Recht bestand — PostgREST antwortete 200 mit leerer Menge. Hier ist das
      // Tabellenrecht `update` fuer `authenticated` vollstaendig entzogen, und
      // ein fehlendes Tabellenrecht wirft, bevor ueberhaupt eine Zeile
      // ausgewaehlt wird.
      //
      // GEMESSEN (Lauf 31235882417) und damit belegt statt behauptet: 42501
      // mit „permission denied for table assignments" und dem Hinweis
      // „GRANT UPDATE ON public.assignments TO authenticated;" — PostgREST
      // nennt das entzogene Recht selbst. Ein ANDERER Riegel (etwa eine
      // RLS-Verletzung) macht `erwarteRiegel` rot.
      const patchZuweisung = await dataApiSchreibversuch(
        "9c5/assignments-update",
        request.patch(`${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: { starts_at_utc: "2026-08-03T04:00:00Z" },
        }),
      );
      erwarteRiegel(
        patchZuweisung,
        { art: "tabellenrecht", tabelle: "assignments", recht: "UPDATE" },
        "9c5 PATCH assignments",
      );
      const bestandNachPatch = await bestandNach("9c5 nach PATCH assignments");
      const startNachPatch = await zielNach("9c5 nach PATCH assignments");

      // Angriff 3 — loeschen. Dieselbe Zeile, dieselbe Begruendung.
      const deleteZuweisung = await dataApiSchreibversuch(
        "9c5/assignments-delete",
        request.delete(`${supabaseUrl}/rest/v1/assignments?id=eq.${ZUWEISUNG_ID}`, {
          headers: { ...kopfB, prefer: "return=representation" },
        }),
      );
      erwarteRiegel(
        deleteZuweisung,
        { art: "tabellenrecht", tabelle: "assignments", recht: "DELETE" },
        "9c5 DELETE assignments",
      );
      const bestandNachDelete = await bestandNach("9c5 nach DELETE assignments");
      const startNachDelete = await zielNach("9c5 nach DELETE assignments");

      // Angriff 4 — eine eigene Entwurfs-Planversion, wieder mit exakt den
      // gegranteten Spalten `(org_id, week_key)`.
      const insertVersion = await dataApiSchreibversuch(
        "9c5/plan_versions-insert",
        request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
          headers: { ...kopfB, prefer: "return=representation" },
          data: { org_id: ORG_ID, week_key: ANGRIFFSWOCHE_MEMBER },
        }),
      );
      erwarteRiegel(
        insertVersion,
        { art: "policy", tabelle: "plan_versions" },
        "9c5 INSERT plan_versions",
      );
      const bestandDanach = await bestandNach("9c5 nach INSERT plan_versions");
      const startNachVersion = await zielNach("9c5 nach INSERT plan_versions");

      // ------------------------------------------------------------------
      // Die Wirkung, nicht die Antwort: nachgesehen statt geglaubt.
      // ------------------------------------------------------------------
      // Diese Kontrollen sind kanalunabhaengig. Aendert sich ein Statuscode,
      // werden die Zusicherungen darueber angepasst — diese hier NIE.
      //
      // Sie bleiben ZUSAETZLICH zu den Momentaufnahmen oben stehen: genau sie
      // haben den Basislauf 31237004812 aufgedeckt, waehrend die Netto-Zahl
      // gruen log. Was oben dazukam, ist die fruehere Erkennung, nicht ein
      // Ersatz.
      const zielDanach = await dataApiLese<{
        id: string;
        starts_at_utc: string;
        ends_at_utc: string;
      }>(request, zielUrl, kopfB);
      expect(zielDanach, "die Zielzeile ist verschwunden — DELETE ist durchgegangen").toHaveLength(
        1,
      );
      expect(
        zielDanach[0]?.starts_at_utc,
        "die Zielzeile wurde verschoben — PATCH ist durchgegangen",
      ).toBe(startVorher);

      // ACHTUNG bei kuenftigen Umbauten: dieser Lesezugriff MUSS vor der
      // Rueckgabe der Leihgabe stehen. Ohne Mitgliedschaft saehe B die Woche
      // ohnehin nicht mehr, und „0 Zeilen" waere aus dem falschen Grund wahr.
      // Heute schuetzt ihn nur seine Nachbarschaft: `bestandDanach` und
      // `zielDanach` schluegen vorher fehl.
      const wocheDanach = await dataApiLese<{ id: string }>(request, wocheUrlMember, kopfB);
      expect(wocheDanach, "der member hat eine Entwurfs-Planversion angelegt").toHaveLength(0);

      schritte["9c5_member_entwurfsschreiben"] = {
        rolle: "member",
        hat_planning_write: memberRecht.length === 1,
        mitgliedschaft_geliehen: mitgliedschaftB[0]?.active === true,
        zielzeile_vorher_sichtbar: zielVorher.length === 1,
        assignments_insert: {
          status: insertZuweisung.status,
          koerperLaenge: insertZuweisung.koerperLaenge,
          angelegteZeilen: insertZuweisung.zeilen,
          erwarteterStatus: 403,
          fehler: insertZuweisung.fehler,
        },
        assignments_update: {
          status: patchZuweisung.status,
          koerperLaenge: patchZuweisung.koerperLaenge,
          geaenderteZeilen: patchZuweisung.zeilen,
          erwarteterStatus: 403,
          fehler: patchZuweisung.fehler,
        },
        assignments_delete: {
          status: deleteZuweisung.status,
          koerperLaenge: deleteZuweisung.koerperLaenge,
          geloeschteZeilen: deleteZuweisung.zeilen,
          erwarteterStatus: 403,
          fehler: deleteZuweisung.fehler,
        },
        plan_versions_insert_entwurf: {
          status: insertVersion.status,
          koerperLaenge: insertVersion.koerperLaenge,
          angelegteZeilen: insertVersion.zeilen,
          erwarteterStatus: 403,
          woche: ANGRIFFSWOCHE_MEMBER,
          fehler: insertVersion.fehler,
        },
        bestand_vorher: bestandVorher,
        // Eine Momentaufnahme JE ANGRIFF statt einer Netto-Zahl am Ende. Der
        // Basislauf 31237004812 protokollierte hier `bestand_vorher: 2,
        // bestand_danach: 2`, waehrend drei Schreibzugriffe durchgingen — die
        // Wirkungen hoben sich auf. Wer diese Aufstellung wieder auf zwei
        // Zahlen eindampft, stellt den Fehlbefund wieder her.
        bestand_je_angriff: {
          nach_assignments_insert: bestandNachInsert,
          nach_assignments_update: bestandNachPatch,
          nach_assignments_delete: bestandNachDelete,
          nach_plan_versions_insert: bestandDanach,
        },
        zielzeile_start_je_angriff: {
          vorher: startVorher,
          nach_assignments_insert: startNachInsert,
          nach_assignments_update: startNachPatch,
          nach_assignments_delete: startNachDelete,
          nach_plan_versions_insert: startNachVersion,
        },
        bestand_danach: bestandDanach,
        starts_at_utc_unveraendert: zielDanach[0]?.starts_at_utc === startVorher,
        hinweis: "EYT-136 — update/delete entzogen, INSERT an Kanal und planning.write gebunden",
      };
    } catch (e) {
      fehlerAusFall = [e];
    }

    // Die Rueckgabe laeuft UNBEDINGT und ist idempotent: hat `an` gar nicht
    // erst eingefuegt, loescht sie null Zeilen und ihre Nachbedingung trifft
    // trotzdem zu. Sie steht ausserdem NACH den Wirkungskontrollen oben — ohne
    // Mitgliedschaft saehe B die Zeilen nicht mehr, die dort geprueft werden.
    let fehlerAusRueckgabe: [unknown] | null = null;
    try {
      const aus = psqlMitMarker(
        verwaltung,
        join(HIER, "eyt136-member-aus.sql"),
        ["-v", `benutzer_b=${idB}`],
        "[eyt136-member-aus]",
      );
      console.log(`  ${aus}`);
    } catch (e) {
      fehlerAusRueckgabe = [e];
    }

    // Scheitern BEIDE, wird keiner der beiden zum Anhaengsel des anderen: ein
    // `AggregateError` traegt sie gleichrangig, und der Reporter zeigt beide.
    // Eine fruehere Fassung machte den Angriffsbefund zum `cause` der
    // Aufraeummeldung — lesbar blieb dann nur die harmlosere Ueberschrift.
    // (ES2022 ist das `target` in tsconfig.base.json, `AggregateError` steht
    // also in `lib`.)
    if (fehlerAusRueckgabe !== null && fehlerAusFall !== null) {
      throw new AggregateError(
        [fehlerAusRueckgabe[0], fehlerAusFall[0]],
        "[auth-journey] EYT-136: die Rueckgabe der geliehenen member-Mitgliedschaft UND der " +
          "Angriffsnachweis sind gescheitert. Beide Fehler stehen in `errors`; die ueberlebende " +
          "Mitgliedschaft ist der dringendere Befund.",
      );
    }
    // Einzeln gilt weiterhin der Vorrang des gefaehrlicheren Befunds: ein
    // gescheiterter Angriffsnachweis kostet diesen Lauf, eine ueberlebende
    // Mitgliedschaft macht den nachfolgenden Nachweis „B ist ausgesperrt"
    // gruen-falsch.
    if (fehlerAusRueckgabe !== null) throw fehlerAusRueckgabe[0];
    if (fehlerAusFall !== null) throw fehlerAusFall[0];
  });

  await test.step("9d — veroeffentlichen, neu laden, zweiter Kontext", async () => {
    const knopf = page.getByTestId("planung-veroeffentlichen");
    await expect(knopf).toBeVisible();
    await knopf.click();

    const erfolg = page.getByTestId("planung-publish-erfolg");
    await expect(erfolg).toBeVisible();
    veroeffentlichteVersionId = (await erfolg.getAttribute("data-published-version-id")) ?? "";
    // Der Server hat DIESELBE Version veroeffentlicht, die die Ansicht als
    // Entwurf gezeigt hat — nicht irgendeine.
    expect(veroeffentlichteVersionId).toBe(entwurfsVersionId);

    await page.screenshot({
      path: join(ARTEFAKTE, "05-planung-veroeffentlicht.png"),
      fullPage: true,
    });

    // Reload: der Zustand liegt im Server, nicht im Komponentenzustand.
    await page.reload();
    const nachReload = page.getByTestId("planungsfenster-version");
    await expect(nachReload).toHaveAttribute(
      "data-published-version-id",
      veroeffentlichteVersionId,
    );
    await expect(page.getByTestId("planungsfenster-stand")).toHaveAttribute(
      "data-stand",
      "veroeffentlicht",
    );
    // Und die Aktion ist fort — es gibt keinen Entwurf mehr.
    await expect(page.getByTestId("planung-veroeffentlichen")).toHaveCount(0);

    // Zweiter Browserkontext: eigene Cookies, eigener Speicher.
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));
      await seite2.goto(`/planung?weekKey=${PLANWOCHE}`);
      await expect(seite2.getByTestId("planungsfenster-version")).toHaveAttribute(
        "data-published-version-id",
        veroeffentlichteVersionId,
      );
      await seite2.screenshot({
        path: join(ARTEFAKTE, "06-planung-zweiter-kontext.png"),
        fullPage: true,
      });
    } finally {
      await zweiter.close();
    }

    // Wiederholung ueber die API: derselbe Schluessel, dieselbe Nutzlast.
    // Es darf keine zweite Veroeffentlichung entstehen.
    const schluessel = `e2e-publish-${veroeffentlichteVersionId}`;
    const ersteWiederholung = await page.request.post("/api/v1/planung/versionen", {
      headers: { "Idempotency-Key": schluessel },
      data: { weekKey: PLANWOCHE, expectedVersionId: entwurfsVersionId },
    });
    // Der Entwurf ist fort, also ist das kein Replay, sondern eine ehrliche
    // Ablehnung mit STABILEM Code.
    expect(ersteWiederholung.status()).toBe(409);
    const problem = (await ersteWiederholung.json()) as { type?: string };
    expect(problem.type).toBe("urn:easytree:planning:already-published");

    schritte["9d_publish"] = {
      versionId: veroeffentlichteVersionId,
      zweiterKontext: true,
      wiederholung: ersteWiederholung.status(),
    };
  });

  // ---------------------------------------------------------------------
  // 9e–9g3 — Der Kostendurchstich (EYT-144) und seine beiden Grenzen (EYT-109)
  // ---------------------------------------------------------------------
  // Erst hier moeglich: 9d hat die Planversion GERADE veroeffentlicht, und ein
  // Snapshot entsteht ausschliesslich aus einer veroeffentlichten Version.
  // Genau deshalb steht dieser Block nach 9d und nicht bei den anderen
  // Kostenschritten (8/9/9a/9b) weiter oben.
  let kostenSnapshotId = "";

  await test.step("9e — /kosten erzeugt aus der echten Planversion einen gespeicherten Snapshot", async () => {
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    const listenAntwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/planversionen" &&
        r.request().method() === "GET",
    );
    await page.goto("/kosten");
    await page.getByLabel("Von Woche").fill(PLANWOCHE);
    await page.getByLabel("Bis Woche").fill(PLANWOCHE);
    await page.getByRole("button", { name: "Planversionen laden" }).click();

    const antwort = await listenAntwort;
    expect(antwort.status()).toBe(200);
    const liste = (await antwort.json()) as {
      versions: { id: string; weekKey: string; publishedAt: string }[];
    };
    // GENAU die Version, die 9d veroeffentlicht hat — kein Entwurf, keine
    // fremde. Ohne diesen Vergleich bewiese die Liste nur, dass sie nicht leer
    // ist.
    expect(liste.versions.map((v) => v.id)).toEqual([veroeffentlichteVersionId]);
    expect(liste.versions[0]?.weekKey).toBe(PLANWOCHE);
    expect(apiAufrufe).toContain("GET /api/v1/kosten/planversionen");

    const erzeugt = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/snapshots" && r.request().method() === "POST",
    );
    await page
      .getByLabel("Veröffentlichte Planversion")
      .selectOption({ value: veroeffentlichteVersionId });
    await page.getByRole("button", { name: "Snapshot erzeugen" }).click();

    const post = await erzeugt;
    expect(post.status()).toBe(201);
    const gespeichert = (await post.json()) as {
      id: string;
      planVersionId: string;
      totalMinorUnits: string;
      weekKey: string;
      days: { localDate: string; amountMinorUnits: string }[];
      positions: { id: string; amountMinorUnits: string; rateVersionId: string }[];
    };
    kostenSnapshotId = gespeichert.id;
    reiseSnapshotId = gespeichert.id;
    expect(kostenSnapshotId).not.toBe("");
    expect(gespeichert.planVersionId).toBe(veroeffentlichteVersionId);
    expect(gespeichert.weekKey).toBe(PLANWOCHE);
    // Der nachgerechnete Betrag, nicht der zurueckgelesene: siehe
    // {@link ERWARTETE_KOSTEN_MINOR}.
    expect(gespeichert.totalMinorUnits).toBe(ERWARTETE_KOSTEN_MINOR);
    expect(gespeichert.positions).toHaveLength(1);

    // Die Oberflaeche zeigt den GESPEICHERTEN Stand.
    const ansicht = page.getByTestId("kosten-snapshot");
    await expect(ansicht).toBeVisible();
    await expect(ansicht).toHaveAttribute("data-snapshot-id", kostenSnapshotId);
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_KOSTEN_ANZEIGE);
    await expect(page.getByTestId("kosten-planversion-id")).toHaveText(veroeffentlichteVersionId);
    await expect(page.getByTestId("kosten-regelversion")).toHaveText("personnel-plan-cost-v1");
    await expect(page.getByTestId("kosten-baustellenfilter")).toHaveText("alle Baustellen");

    // Bis zur Einzelposition — mit Person, Baustelle, Dauer und Betrag.
    const positionen = page.getByTestId("kosten-position");
    await expect(positionen).toHaveCount(1);
    await expect(positionen.first()).toHaveAttribute(
      "data-amount-minor-units",
      ERWARTETE_KOSTEN_MINOR,
    );
    await expect(positionen.first()).toContainText(MITARBEITER_NAME);
    await expect(positionen.first()).toContainText("E2E-Baustelle Reise");
    await expect(positionen.first()).toContainText(ERWARTETE_DAUER);
    // Und die Tagessumme des einen lokalen Tages.
    await expect(page.getByTestId("kosten-tag")).toHaveCount(1);
    await expect(page.getByTestId("kosten-tag")).toContainText("2026-08-03");

    // Die Adresse traegt den Snapshot — Voraussetzung fuer 9f und 9g.
    expect(new URL(page.url()).search).toBe(`?snapshot=${kostenSnapshotId}`);

    // UND er liegt wirklich in PostgreSQL. Das ist die Aussage, die der
    // Browser nicht treffen kann.
    const gepruefte = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt144-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${kostenSnapshotId}`,
        "-v",
        `summe=${ERWARTETE_KOSTEN_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE}`,
      ],
      "[eyt144-snapshot]",
    );
    console.log(`  ${gepruefte}`);

    await page.screenshot({ path: join(ARTEFAKTE, "07-kosten-snapshot.png"), fullPage: true });

    // Barrierefreiheit der KOSTENflaeche, angemeldet und mit einem echten
    // gespeicherten Snapshot auf dem Schirm (EYT-141). Der Zeitpunkt ist
    // bewusst gewaehlt: eine leere Kostenseite haette weder Tabelle noch
    // Betraege, und genau die sind der interessante Teil.
    await pruefeBarrierefreiheit(page, "/kosten mit gespeichertem Snapshot");

    schritte["9e_kosten_snapshot"] = {
      snapshotId: kostenSnapshotId,
      planVersionId: veroeffentlichteVersionId,
      summe: gespeichert.totalMinorUnits,
      positionen: gespeichert.positions.length,
      datenbank: gepruefte,
    };
  });

  await test.step("9f — Reload zeigt DENSELBEN Snapshot, ohne ihn neu zu erzeugen", async () => {
    const vorher = apiAufrufe.length;
    await page.reload();

    const ansicht = page.getByTestId("kosten-snapshot");
    await expect(ansicht).toBeVisible();
    await expect(ansicht).toHaveAttribute("data-snapshot-id", kostenSnapshotId);
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_KOSTEN_ANZEIGE);
    await expect(page.getByTestId("kosten-position")).toHaveAttribute(
      "data-amount-minor-units",
      ERWARTETE_KOSTEN_MINOR,
    );

    // Der eigentliche Nachweis ist eine ABWESENHEIT: nach dem Reload steht im
    // Netzwerkprotokoll ein Lesen des gespeicherten Standes und KEIN Schreiben.
    // Ohne diese Zaehlung koennte die Ansicht denselben Betrag anzeigen und
    // dabei stillschweigend einen zweiten Snapshot angelegt haben.
    const seitReload = apiAufrufe.slice(vorher);
    expect(seitReload).toContain(`GET /api/v1/kosten/snapshots/${kostenSnapshotId}`);
    expect(seitReload).not.toContain("POST /api/v1/kosten/snapshots");
    // Und keine Satzabfrage: ein Snapshot wird gelesen, nicht neu bewertet.
    expect(seitReload.filter((a) => a.includes("/kosten/stundensaetze"))).toEqual([]);

    schritte["9f_reload"] = {
      snapshotId: kostenSnapshotId,
      aufrufe_seit_reload: seitReload,
    };
  });

  await test.step("9g — ein ZWEITER Browserkontext sieht denselben gespeicherten Snapshot", async () => {
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      const aufrufe2: string[] = [];
      seite2.on("request", (anfrage) => {
        const pfad = new URL(anfrage.url()).pathname;
        if (pfad.startsWith("/api/")) aufrufe2.push(`${anfrage.method()} ${pfad}`);
      });

      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));

      await seite2.goto(`/kosten?snapshot=${kostenSnapshotId}`);
      const ansicht2 = seite2.getByTestId("kosten-snapshot");
      await expect(ansicht2).toBeVisible();
      await expect(ansicht2).toHaveAttribute("data-snapshot-id", kostenSnapshotId);
      await expect(seite2.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_KOSTEN_ANZEIGE);
      await expect(seite2.getByTestId("kosten-position")).toHaveAttribute(
        "data-amount-minor-units",
        ERWARTETE_KOSTEN_MINOR,
      );
      // Eigene Cookies, eigener Speicher — und trotzdem kein Schreibzugriff.
      expect(aufrufe2).toContain(`GET /api/v1/kosten/snapshots/${kostenSnapshotId}`);
      expect(aufrufe2).not.toContain("POST /api/v1/kosten/snapshots");

      await seite2.screenshot({ path: join(ARTEFAKTE, "08-kosten-zweiter-kontext.png") });
    } finally {
      await zweiter.close();
    }

    // Nach Reload UND zweitem Kontext: immer noch GENAU EIN Snapshot. Das ist
    // der Beweis, dass Ansehen nichts erzeugt — die Zaehlung im Skript
    // (`koepfe`) umfasst alle Snapshots dieser Organisation, nicht nur den
    // erwarteten.
    const nachher = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt144-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${kostenSnapshotId}`,
        "-v",
        `summe=${ERWARTETE_KOSTEN_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE}`,
      ],
      "[eyt144-snapshot]",
    );
    console.log(`  ${nachher}`);
    expect(nachher).toContain("koepfe=1");
    schritte["9g_zweiter_kontext"] = { snapshotId: kostenSnapshotId, datenbank: nachher };
  });

  // ---------------------------------------------------------------------
  // 9g2 — Die Kostengrenze innerhalb DERSELBEN Organisation (EYT-109 Task 17)
  // ---------------------------------------------------------------------
  // Was der bestehende B-Nachweis am Ende dieser Datei NICHT sagt: dort hat B
  // ueberhaupt keine Mitgliedschaft, und die Ablehnung kann genauso gut daran
  // haengen, dass es fuer ihn keine Organisation gibt. `MembershipCostAccessPolicy`
  // beantwortet `ORG_NOT_A_MEMBER` und `PERMISSION_MISSING` ABSICHTLICH gleich
  // (403, derselbe Text, kein Existenzleck) — von aussen ist am Status also
  // nicht ablesbar, welcher der beiden Riegel getragen hat.
  //
  // Dieser Schritt trennt sie, und zwar an einer MESSBAREN Stelle: mit aktiver
  // Mitgliedschaft loest die Policy die Organisation auch OHNE Header eindeutig
  // auf (`memberships.length === 1`) und faellt erst am Recht. Ohne
  // Mitgliedschaft kommt sie gar nicht so weit und antwortet 400
  // (`ORG_CONTEXT_REQUIRED`) — genau das misst der bestehende Nachweis unten in
  // „der Kostenpfad lehnt B stabil ab". Die beiden Faelle sind damit an ihrem
  // Statuspaar unterscheidbar (403/403 hier gegen 400/403 dort), und keiner
  // ersetzt den anderen.
  //
  // Gegenmutationen, die diesen Schritt rot machen:
  // - `('member','costs.read')` in `role_permissions` eintragen: der Schritt
  //   wird rot, und zwar VOR dem ersten Angriff — an der Praemissenzusicherung
  //   ueber Bs eigenes Token. Genau so soll es sein: der Nachweis waere damit
  //   vakuos geworden, und das faellt vor der Messung auf statt danach.
  // - Den `costs.read`-Zweig aus `KostenZugang` entfernen (oder die
  //   Navigationsbedingung in `app-shell.tsx`): der Forbidden-Zustand bzw. der
  //   fehlende Navigationspunkt wird rot.
  // - `pruefeRecht` in `MembershipCostAccessPolicy` auf „immer ok" setzen:
  //   beide direkten GETs liefern dann 200 und tragen Betraege.
  await test.step("9g2 — ein member DERSELBEN Organisation ohne costs.read sieht keine Kosten", async () => {
    const supabaseUrl = pflicht("EASYTREE_JOURNEY_SUPABASE_URL");
    const anonKey = pflicht("EASYTREE_JOURNEY_ANON_KEY");
    const emailB = pflicht("EASYTREE_JOURNEY_EMAIL_B");
    const passwortB = pflicht("EASYTREE_JOURNEY_PASSWORT_B");
    const idB = pflicht("EASYTREE_JOURNEY_USER_B");
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    // `catch` statt `finally` — dieselbe Begruendung wie in 9c5: ein `throw` im
    // `finally` verwuerfe einen bereits laufenden Fehler (`no-unsafe-finally`).
    let fehlerAusFall: [unknown] | null = null;
    try {
      // Die Leihgabe, unveraendert wiederverwendet: dasselbe Skript, dieselbe
      // feste Zeilen-Id, dieselbe Nachbedingung. 9c5 hat sie vorher schon
      // zurueckgegeben, das INSERT ohne `on conflict` traegt hier also erneut —
      // und wuerde laut scheitern, wenn die Rueckgabe dort ausgefallen waere.
      // Der Aufruf steht INNERHALB des `try`, weil das Skript die Zeile
      // committet BEVOR es seine Nachbedingung prueft.
      const an = psqlMitMarker(
        verwaltung,
        join(HIER, "eyt136-member-an.sql"),
        ["-v", `benutzer_a=${benutzerId}`, "-v", `benutzer_b=${idB}`],
        "[eyt136-member-an]",
      );
      console.log(`  ${an}`);

      // ------------------------------------------------------------------
      // Die PRAEMISSE, ueber Bs EIGENES Token gemessen
      // ------------------------------------------------------------------
      // Nicht angenommen und nicht aus der Migration abgeschrieben: gefragt
      // wird die laufende Datenbank, ueber dieselbe Zuordnungstabelle, die
      // `app.has_permission` und `MembershipCostAccessPolicy` lesen
      // (`role_permissions`, fuer jeden Angemeldeten lesbar seit 0013).
      const kopfB = await bearerKopf(request, supabaseUrl, anonKey, emailB, passwortB);
      const memberDarfLesen = await dataApiLese<{ role: string; permission: string }>(
        request,
        `${supabaseUrl}/rest/v1/role_permissions?role=eq.member&permission=eq.costs.read&select=role,permission`,
        kopfB,
      );
      expect(
        memberDarfLesen,
        "member traegt costs.read — der Kostennachweis waere vakuos",
      ).toHaveLength(0);
      // Die Gegenprobe: die Abfrage findet sehr wohl etwas, wenn es etwas zu
      // finden gibt. Ohne sie bewiese eine leere Antwort auch dann „member darf
      // nicht", wenn der Filter schlicht nie etwas trifft.
      const ownerDarfLesen = await dataApiLese<{ role: string; permission: string }>(
        request,
        `${supabaseUrl}/rest/v1/role_permissions?role=eq.owner&permission=eq.costs.read&select=role,permission`,
        kopfB,
      );
      expect(
        ownerDarfLesen,
        "die Rechteabfrage findet auch fuer owner nichts — sie misst gar nichts",
      ).toHaveLength(1);

      const kontextB = await page.context().browser()?.newContext();
      if (kontextB === undefined) throw new Error("[auth-journey] kein Browserkontext fuer B.");
      try {
        const seiteB = await kontextB.newPage();
        const aufrufeB: string[] = [];
        seiteB.on("request", (anfrage) => {
          const pfad = new URL(anfrage.url()).pathname;
          if (pfad.startsWith("/api/")) aufrufeB.push(`${anfrage.method()} ${pfad}`);
        });

        // 1 — echte Anmeldung ueber dieselbe Loginseite und denselben GoTrue.
        await seiteB.goto("/anmelden");
        await seiteB.getByLabel("E-Mail").fill(emailB);
        await seiteB.getByLabel("Passwort").fill(passwortB);
        await seiteB.getByRole("button", { name: "Anmelden" }).click();
        await seiteB.waitForURL((u) => !u.pathname.startsWith("/anmelden"));
        expect((await kontextB.cookies()).find((k) => k.name === "eyt_access")?.httpOnly).toBe(
          true,
        );

        // 2 — und der Server bestaetigt: SELBE Organisation, Rolle `member`,
        // kein Kostenrecht. Das ist der Unterschied zum Nachweis unten, wo die
        // Liste leer ist.
        const sitzungAntwort = await seiteB.request.get("/api/v1/auth/session");
        expect(sitzungAntwort.status()).toBe(200);
        const sitzungB = (await sitzungAntwort.json()) as {
          userId: string;
          organisations: { id: string; name: string; role: string; permissions: string[] }[];
        };
        expect(sitzungB.userId).toBe(idB);
        expect(sitzungB.userId).not.toBe(benutzerId);
        expect(sitzungB.organisations).toHaveLength(1);
        const orgB = sitzungB.organisations[0]!;
        expect(orgB.id).toBe(ORG_ID);
        expect(orgB.role).toBe("member");
        expect(orgB.permissions).not.toContain("costs.read");
        expect(orgB.permissions).not.toContain("costs.calculate");

        // 3 — die Kosten-Navigation erscheint nicht. `app-shell.tsx` bindet sie
        // an `costs.read`; sichtbar ist sie fuer A (Schritt 6) und fuer B nicht.
        await seiteB.goto(`/kosten?snapshot=${kostenSnapshotId}`);
        await expect(seiteB.getByRole("link", { name: "Kosten" })).toHaveCount(0);

        // 4 — und die Seite zeigt den VORGESEHENEN Zustand: Forbidden, nicht
        // „nicht angemeldet" und nicht „Organisation waehlen". B ist angemeldet
        // und seine Organisation ist eindeutig — nur das Recht fehlt.
        await expect(seiteB.getByTestId("kosten-forbidden")).toBeVisible();
        await expect(seiteB.getByTestId("kosten-unauthenticated")).toHaveCount(0);
        await expect(seiteB.getByTestId("kosten-snapshot")).toHaveCount(0);
        await expect(seiteB.getByTestId("kosten-gesamtsumme")).toHaveCount(0);
        await expect(seiteB.getByTestId("kosten-position")).toHaveCount(0);
        await expect(seiteB.getByLabel("Von Woche")).toHaveCount(0);

        // 5 — kein Betrag, kein Satz, keine Position im DOM. Geprueft wird der
        // gerenderte Inhalt, nicht das Sichtbare: ein `display:none`-Element
        // truege den Wert trotzdem aus.
        //
        // Was hier BEWUSST NICHT geprueft wird, mit derselben Begruendung wie
        // beim Nachweis unten: die Snapshot-Id (Bs eigener URL-Parameter, den
        // Next als Prop der Client-Komponente serialisiert) und der
        // Organisationsname (den der Forbidden-Banner absichtlich nennt — er
        // erklaert dem Menschen, WO ihm das Recht fehlt). Die Aussage, um die es
        // geht, sind Betraege und Personendaten.
        const inhaltB = await seiteB.content();
        expect(inhaltB).not.toContain(ERWARTETE_KOSTEN_ANZEIGE);
        expect(inhaltB).not.toContain(ERWARTETE_KOSTEN_MINOR);
        expect(inhaltB).not.toContain(ERWARTETER_BETRAG);
        expect(inhaltB).not.toContain(ERWARTETE_DAUER);
        expect(inhaltB).not.toContain(MITARBEITER_NAME);
        expect(inhaltB).not.toContain(MITARBEITER_ID);

        // 6 — der Server lehnt unabhaengig von der Oberflaeche ab, und zwar am
        // RECHT. Das Statuspaar ist die Aussage:
        //
        //   ohne Header  403  -> die Organisation war eindeutig aufloesbar
        //                       (`memberships.length === 1`), es fehlte das Recht
        //   mit Header   403  -> dieselbe, legitime Organisation, dasselbe Ergebnis
        //
        // Der bestehende Nachweis unten misst an derselben Route 400/403: ohne
        // Mitgliedschaft kommt die Policy ueber die Organisationsaufloesung nicht
        // hinaus. Ohne die kopflose Anfrage hier waere nicht belegt, dass DIESE
        // Ablehnung eine andere ist.
        const ohneKopf = await seiteB.request.get(`/api/v1/kosten/snapshots/${kostenSnapshotId}`);
        expect(ohneKopf.status()).toBe(403);
        const mitKopf = await seiteB.request.get(`/api/v1/kosten/snapshots/${kostenSnapshotId}`, {
          headers: { "X-EasyTree-Organization-Id": ORG_ID },
        });
        expect(mitKopf.status()).toBe(403);

        // 7 — und die Antwort traegt nichts aus dem Snapshot: keine Betraege,
        // keine Personendaten, keine Herkunftsangaben.
        const koerperB = await mitKopf.text();
        expect(koerperB).not.toContain(ERWARTETE_KOSTEN_MINOR);
        expect(koerperB).not.toContain(ERWARTETE_KOSTEN_ANZEIGE);
        expect(koerperB).not.toContain(MITARBEITER_NAME);
        expect(koerperB).not.toContain(MITARBEITER_ID);
        expect(koerperB).not.toContain(veroeffentlichteVersionId);
        expect(koerperB).not.toContain("personnel-plan-cost-v1");
        // Aus DEMSELBEN Text geparst, nicht ueber einen zweiten Zugriff auf die
        // Antwort: `dataApiSchreibversuch` haelt weiter oben fest, warum diese
        // Datei jeden Koerper genau einmal liest.
        const problemB = JSON.parse(koerperB) as { detail?: string };
        expect(problemB.detail).toBe("Kein Zugriff auf die Kostendaten dieser Organisation.");

        // Und im Netzwerkprotokoll dieses Browsers steht kein erfolgreicher
        // Kostenaufruf, den die Oberflaeche selbst ausgeloest haette: der
        // Waechter blockt VOR dem Gateway.
        expect(aufrufeB.filter((a) => a.includes("/kosten/planversionen"))).toEqual([]);

        await seiteB.screenshot({
          path: join(ARTEFAKTE, "08b-member-ohne-kostenrecht.png"),
          fullPage: true,
        });

        schritte["9g2_member_ohne_costs_read"] = {
          userId_ist_B: sitzungB.userId === idB,
          organisation: orgB.id,
          rolle: orgB.role,
          rechte: orgB.permissions,
          member_hat_costs_read: memberDarfLesen.length === 1,
          owner_hat_costs_read: ownerDarfLesen.length === 1,
          kosten_navigation: 0,
          oberflaeche: "kosten-forbidden",
          snapshot_ohne_header: ohneKopf.status(),
          snapshot_mit_header: mitKopf.status(),
          betrag_im_dom: false,
          betrag_in_antwort: false,
        };
      } finally {
        await kontextB.close();
      }
    } catch (e) {
      fehlerAusFall = [e];
    }

    // Die Rueckgabe laeuft UNBEDINGT und ist idempotent — Wortlaut und
    // Rangfolge wie in 9c5. Eine ueberlebende Leihgabe machte den Nachweis
    // „B ist ohne Mitgliedschaft ausgesperrt" gruen-falsch, und sie ist damit
    // der gefaehrlichere Befund.
    let fehlerAusRueckgabe: [unknown] | null = null;
    try {
      const aus = psqlMitMarker(
        verwaltung,
        join(HIER, "eyt136-member-aus.sql"),
        ["-v", `benutzer_b=${idB}`],
        "[eyt136-member-aus]",
      );
      console.log(`  ${aus}`);
    } catch (e) {
      fehlerAusRueckgabe = [e];
    }

    if (fehlerAusRueckgabe !== null && fehlerAusFall !== null) {
      throw new AggregateError(
        [fehlerAusRueckgabe[0], fehlerAusFall[0]],
        "[auth-journey] EYT-109 Task 17: die Rueckgabe der geliehenen member-Mitgliedschaft UND " +
          "der Kostennachweis sind gescheitert. Beide Fehler stehen in `errors`; die " +
          "ueberlebende Mitgliedschaft ist der dringendere Befund.",
      );
    }
    if (fehlerAusRueckgabe !== null) throw fehlerAusRueckgabe[0];
    if (fehlerAusFall !== null) throw fehlerAusFall[0];
  });

  // ---------------------------------------------------------------------
  // 9g3 — Eine NACH dem Snapshot angelegte Satzversion aendert ihn nicht
  //        (EYT-109 Task 17)
  // ---------------------------------------------------------------------
  // Die neue Version entsteht ueber die ECHTE Route `POST /kosten/stundensaetze`
  // — Browserkontext des angemeldeten Owners, Next-Rewrite, NestJS, Policy,
  // RLS, PostgreSQL. Kein SQL-Insert: eine per Hand eingefuegte Zeile bewiese
  // nichts ueber den Anwendungspfad.
  //
  // ## Warum ueber `page.request` und nicht ueber das Formular
  //
  // GEMESSEN am Code, nicht vermutet: `rate-management.tsx` sendet
  // `expectedActiveVersionId: historie.activeVersionId`, und `activeVersionId`
  // ist die am HEUTIGEN Geschaeftsdatum wirksame Version — das ist der
  // Startsatz, denn die Abloesung aus 9a beginnt erst am 01.09.2026.
  // `pruefeAbloesung` verlangt aber eine OFFENE Vorgaengerversion und lehnt den
  // geschlossenen Startsatz mit `VORGAENGER_BEREITS_GESCHLOSSEN` ab. Solange
  // ein Nachfolger noch in der Zukunft liegt, kann das Formular deshalb keine
  // dritte Version anlegen. Das ist eine Produkteigenschaft und wird hier
  // NICHT geaendert — der Nachweis nimmt stattdessen die Route, die der
  // kanonische Task-17-Vertrag zuerst nennt, und waehlt den Vorgaenger ueber
  // `validTo === null` aus der ECHTEN Antwort der Historienroute.
  //
  // ## Was dieser Schritt beweist — und was ausdruecklich NICHT
  //
  // Die Satzabloesung laesst keinen rueckwirkenden Nachfolger zu
  // (`validFrom > vorgaenger.validFrom`). Eine nach dem Snapshot angelegte
  // Version kann den Leistungstag 03.08.2026 also gar nicht mehr bewerten —
  // ein Lesepfad, der HEIMLICH NEU RECHNETE, kaeme auf denselben BETRAG. Der
  // Betragsvergleich allein wuerde einen solchen Fehler folglich nicht fangen.
  // Die tragende Zusicherung ist deshalb die Tiefengleichheit des ganzen
  // Snapshots samt seiner Ids: eine Neuberechnung truege eine neue Snapshot-Id
  // und neue Positions-Ids.
  //
  // Gegenmutationen, die diesen Schritt rot machen:
  // - `GET /kosten/snapshots/:id` neu rechnen statt lesen lassen (im Controller
  //   `createCostSnapshot` statt `snapshots`): die Antwort traegt eine andere
  //   Snapshot-Id und andere Positions-Ids, `toEqual` wird rot. AUSFALLANALYSE,
  //   nicht gefahren.
  // - Die Positionen ihre `rateVersionId` beim Lesen aus dem aktuellen Satz
  //   aufloesen lassen: die benannte Zusicherung auf `satzImSnapshot` wird rot.
  //   AUSFALLANALYSE, nicht gefahren.
  // - `pruefeAbloesung` die Reihenfolgepruefung nehmen: der Vorgaengervergleich
  //   unten (`neue.predecessorId`) bleibt gruen, aber `9a` und die
  //   Domaenensuite fangen es — hier steht es nur der Vollstaendigkeit halber.
  await test.step("9g3 — eine neue Satzversion nach dem Snapshot laesst ihn unveraendert", async () => {
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    /** Die Form, in der `GET /kosten/snapshots/:id` antwortet (Auszug). */
    interface SnapshotAntwort {
      readonly id: string;
      readonly planVersionId: string;
      readonly worksiteId: string | null;
      readonly weekKey: string;
      readonly ruleVersion: string;
      readonly totalMinorUnits: string;
      readonly days: readonly { localDate: string; amountMinorUnits: string }[];
      readonly positions: readonly {
        id: string;
        employeeId: string;
        localDate: string;
        durationMilliseconds: string;
        rateVersionId: string;
        amountMinorUnits: string;
      }[];
    }

    // 1 — der gespeicherte Stand VOR der Satzaenderung, ueber den realen
    // Lesepfad geholt. Nicht aus 9e uebernommen: dort stand die Antwort des
    // SCHREIBENS, hier soll der Vergleich zweier LESEVORGAENGE stehen.
    const vorherAntwort = await page.request.get(`/api/v1/kosten/snapshots/${kostenSnapshotId}`);
    expect(vorherAntwort.status()).toBe(200);
    const snapshotVorher = (await vorherAntwort.json()) as SnapshotAntwort;
    expect(snapshotVorher.id).toBe(kostenSnapshotId);
    expect(snapshotVorher.positions).toHaveLength(1);
    const positionVorher = snapshotVorher.positions[0]!;
    const satzImSnapshot = positionVorher.rateVersionId;
    expect(satzImSnapshot).not.toBe("");

    // 2 — die offene Satzversion. `validTo === null` und nicht `activeVersionId`:
    // die beiden fallen hier auseinander (siehe Kopfkommentar), und nur die
    // offene ist ein zulaessiger Vorgaenger.
    const historieAntwort = await page.request.get(
      `/api/v1/kosten/stundensaetze/${MITARBEITER_ID}`,
    );
    expect(historieAntwort.status()).toBe(200);
    const historie = (await historieAntwort.json()) as {
      activeVersionId: string | null;
      versions: {
        id: string;
        validFrom: string;
        validTo: string | null;
        amountMinorUnits: string;
      }[];
    };
    expect(historie.versions).toHaveLength(2);
    const offene = historie.versions.filter((v) => v.validTo === null);
    expect(offene, "es gibt nicht genau eine offene Satzversion").toHaveLength(1);
    const vorgaenger = offene[0]!;
    expect(vorgaenger.validFrom).toBe(ABLOESE_DATUM);

    // Die Praemisse, die den Nachweis ueberhaupt aussagekraeftig macht: der
    // Snapshot haengt am STARTSATZ, nicht an der Version, die gleich abgeloest
    // wird. Haenge er an der offenen, waere „unveraendert" trivial — dann
    // beruehrte die Abloesung seine Herkunft ohnehin nicht.
    expect(
      satzImSnapshot,
      "der Snapshot haengt an der offenen Version — der Nachweis waere trivial",
    ).not.toBe(vorgaenger.id);
    const startsatz = historie.versions.find((v) => v.id === satzImSnapshot);
    expect(startsatz, "die Satzversion des Snapshots steht nicht in der Historie").toBeDefined();
    // EYT-109 D1: die API fuehrt den LETZTEN wirksamen Tag, nicht die
    // halboffene Datenbankgrenze. Der Startsatz endet am 31.08., der
    // Nachfolger beginnt am 01.09. — lueckenlos und ueberlappungsfrei.
    expect(startsatz?.validTo).toBe(LETZTER_TAG_VOR_ABLOESUNG);
    expect(vorgaenger.validFrom).toBe(ABLOESE_DATUM);

    // 3 — die neue Version, ueber die echte Route. Lokale Bindung statt
    // Konstante direkt im Header (gitleaks, siehe {@link SATZ_VORGANG_3}).
    const schluessel3 = SATZ_VORGANG_3;
    const angelegt = await page.request.post("/api/v1/kosten/stundensaetze", {
      headers: { "Idempotency-Key": schluessel3 },
      data: {
        employeeId: MITARBEITER_ID,
        amountMinorUnits: ABLOESE_BETRAG_3,
        currency: "EUR",
        validFrom: ABLOESE_DATUM_3,
        validTo: null,
        reason: ABLOESE_GRUND_3,
        expectedActiveVersionId: vorgaenger.id,
      },
    });
    expect(angelegt.status()).toBe(201);
    const neue = (await angelegt.json()) as {
      id: string;
      validFrom: string;
      amountMinorUnits: string;
      predecessorId: string | null;
    };
    expect(neue.id).not.toBe(vorgaenger.id);
    expect(neue.id).not.toBe(satzImSnapshot);
    expect(neue.predecessorId).toBe(vorgaenger.id);
    expect(neue.validFrom).toBe(ABLOESE_DATUM_3);
    expect(neue.amountMinorUnits).toBe(ABLOESE_BETRAG_3);
    // Und die Abloesung hat wirklich stattgefunden: drei Versionen, der
    // Vorgaenger geschlossen. Ohne das bewiese der 201 nur, dass die Route
    // antwortet.
    const historieDanach = (await (
      await page.request.get(`/api/v1/kosten/stundensaetze/${MITARBEITER_ID}`)
    ).json()) as { versions: { id: string; validTo: string | null }[] };
    expect(historieDanach.versions).toHaveLength(3);
    // Wieder fachlich: der Vorgaenger endet am Tag VOR dem Beginn des
    // Nachfolgers (EYT-109 D1). In der Datenbank steht unveraendert
    // `2026-10-01` — das misst `rate-succession.integration.test.ts` roh.
    expect(historieDanach.versions.find((v) => v.id === vorgaenger.id)?.validTo).toBe(
      LETZTER_TAG_VOR_ABLOESUNG_3,
    );

    // 4 — DERSELBE Snapshot, noch einmal ueber den realen Lesepfad. Die
    // Tiefengleichheit ist die tragende Zusicherung; die benannten Felder
    // darunter stehen zusaetzlich, damit ein spaeteres Aufweichen von `toEqual`
    // nicht unbemerkt den ganzen Nachweis entwertet.
    const nachherAntwort = await page.request.get(`/api/v1/kosten/snapshots/${kostenSnapshotId}`);
    expect(nachherAntwort.status()).toBe(200);
    const snapshotNachher = (await nachherAntwort.json()) as SnapshotAntwort;
    expect(snapshotNachher).toEqual(snapshotVorher);

    expect(snapshotNachher.id).toBe(kostenSnapshotId);
    expect(snapshotNachher.planVersionId).toBe(veroeffentlichteVersionId);
    expect(snapshotNachher.worksiteId).toBeNull();
    expect(snapshotNachher.weekKey).toBe(PLANWOCHE);
    expect(snapshotNachher.ruleVersion).toBe("personnel-plan-cost-v1");
    expect(snapshotNachher.totalMinorUnits).toBe(ERWARTETE_KOSTEN_MINOR);
    expect(snapshotNachher.days).toEqual(snapshotVorher.days);
    expect(snapshotNachher.positions).toHaveLength(1);
    const positionNachher = snapshotNachher.positions[0]!;
    expect(positionNachher.id).toBe(positionVorher.id);
    expect(positionNachher.employeeId).toBe(MITARBEITER_ID);
    expect(positionNachher.localDate).toBe(positionVorher.localDate);
    expect(positionNachher.durationMilliseconds).toBe(positionVorher.durationMilliseconds);
    expect(positionNachher.amountMinorUnits).toBe(ERWARTETE_KOSTEN_MINOR);
    // Die HERKUNFT: weiterhin der Startsatz, ausdruecklich NICHT der neue.
    expect(positionNachher.rateVersionId).toBe(satzImSnapshot);
    expect(positionNachher.rateVersionId).not.toBe(neue.id);
    expect(positionNachher.rateVersionId).not.toBe(vorgaenger.id);

    // 5 — und die Oberflaeche zeigt nach der Satzaenderung dieselben Zahlen.
    // Ohne diesen Teil bewiese der Schritt die Aussage nur fuer die API.
    await page.goto(`/kosten?snapshot=${kostenSnapshotId}`);
    const ansicht = page.getByTestId("kosten-snapshot");
    await expect(ansicht).toBeVisible();
    await expect(ansicht).toHaveAttribute("data-snapshot-id", kostenSnapshotId);
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_KOSTEN_ANZEIGE);
    await expect(page.getByTestId("kosten-position")).toHaveAttribute(
      "data-amount-minor-units",
      ERWARTETE_KOSTEN_MINOR,
    );

    // 6 — und in PostgreSQL steht weiterhin GENAU EIN Snapshot mit denselben
    // gespeicherten Werten. Dasselbe Skript wie in 9e und 9g, unveraendert:
    // `koepfe=1` faellt, sobald der Lesepfad einen zweiten angelegt haette.
    const gepruefte = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt144-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${kostenSnapshotId}`,
        "-v",
        `summe=${ERWARTETE_KOSTEN_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE}`,
      ],
      "[eyt144-snapshot]",
    );
    console.log(`  ${gepruefte}`);
    expect(gepruefte).toContain("koepfe=1");

    schritte["9g3_satz_nach_snapshot"] = {
      route: "POST /api/v1/kosten/stundensaetze",
      status: angelegt.status(),
      vorgaengerVersionId: vorgaenger.id,
      neueVersionId: neue.id,
      neuesValidFrom: neue.validFrom,
      versionenDanach: historieDanach.versions.length,
      snapshotId: snapshotNachher.id,
      positionsId: positionNachher.id,
      rateVersionIdImSnapshot: positionNachher.rateVersionId,
      summe: snapshotNachher.totalMinorUnits,
      tiefengleich: true,
      datenbank: gepruefte,
    };
  });

  // ---------------------------------------------------------------------
  // 9h — Der Baustellenfilter (EYT-146)
  // ---------------------------------------------------------------------
  // NACH 9g und 9g3 und nicht davor: `eyt144-snapshot-pruefen.sql` verlangt
  // `koepfe=1` fuer die ganze Organisation, und BEIDE Schritte rufen es auf.
  // Ein zweiter Snapshot vor einem dieser Aufrufe machte den abgenommenen
  // EYT-144-Nachweis rot — an der falschen Stelle und mit der falschen
  // Begruendung.
  //
  // Umgekehrt beruehren 9g2 und 9g3 diesen Schritt nicht: die Leihgabe ist vor
  // ihm zurueckgegeben, und die in 9g3 angelegte Satzversion beginnt am
  // 01.10.2026 — der Leistungstag dieser Woche ist der 10.08.2026, bewertet
  // wird er weiterhin mit dem Startsatz. Die Zahlen unten bleiben deshalb die
  // abgenommenen.
  //
  // Eigene Woche, eigene Planversion, zwei Baustellen (siehe `fixtures.sql`).
  // Damit bleiben die Zahlen von EYT-144 unangetastet.
  await test.step("9h — /kosten filtert den Snapshot auf EINE reale Baustelle", async () => {
    const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

    // Die W33-Version ist ein Entwurf. Erst der ECHTE Publish-Endpunkt macht
    // sie zu einer Kostenquelle — dieselbe Naht wie in 9d, nur ueber die API,
    // weil die Planungsoberflaeche dafuer nichts Neues beweisen wuerde.
    // Ueber eine lokale Bindung, wie in 9d — und nicht direkt die Konstante im
    // Header. Gemessen (gitleaks 8.24.3, Lauf 31737022667): die Regel
    // `generic-api-key` schlaegt auf das Muster `Key": <bezeichner>` an, sobald
    // der BEZEICHNER genug Entropie hat; `PUBLISH_VORGANG_146` kam auf 4.04 und
    // wurde als Fund gemeldet. Der Wert ist kein Geheimnis, aber eine Ausnahme
    // in `.gitleaksignore` waere der falsche Weg (EYT-133 hat den Secret-Guard
    // gerade gegen genau solche Bypaesse gehaertet).
    const schluessel146 = PUBLISH_VORGANG_146;
    const veroeffentlicht = await page.request.post("/api/v1/planung/versionen", {
      headers: { "Idempotency-Key": schluessel146 },
      data: { weekKey: PLANWOCHE_146, expectedVersionId: ENTWURF_146 },
    });
    expect(veroeffentlicht.status()).toBe(201);
    const version146 = (await veroeffentlicht.json()) as { versionId: string };
    expect(version146.versionId).toBe(ENTWURF_146);

    const listenAntwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/planversionen" &&
        r.request().method() === "GET",
    );
    await page.goto("/kosten");
    await page.getByLabel("Von Woche").fill(PLANWOCHE_146);
    await page.getByLabel("Bis Woche").fill(PLANWOCHE_146);
    await page.getByRole("button", { name: "Planversionen laden" }).click();
    expect((await listenAntwort).status()).toBe(200);

    // Die Baustellenauswahl wird ERST nach der Versionswahl geholt — und sie
    // kommt aus dem Kostenmodul, nicht aus einer Planungsroute.
    const baustellenAntwort = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/kosten/planversionen/${ENTWURF_146}/baustellen` &&
        r.request().method() === "GET",
    );
    await page.getByLabel("Veröffentlichte Planversion").selectOption({ value: ENTWURF_146 });

    const baustellen = await baustellenAntwort;
    expect(baustellen.status()).toBe(200);
    const auswahl = (await baustellen.json()) as { worksites: { id: string; label: string }[] };
    // GENAU die beiden Baustellen dieser Version, mit ihren ECHTEN Namen aus
    // `public.worksites` — in der zugesicherten Reihenfolge (Bezeichnung
    // aufsteigend). Kein Name ist hier erfunden oder aus der Id abgeleitet.
    expect(auswahl.worksites).toEqual([
      { id: BAUSTELLE_AUSGESCHLOSSEN, label: "E2E-Baustelle Filter B" },
      { id: BAUSTELLE_GEFILTERT, label: "E2E-Baustelle Reise" },
    ]);

    const sichtbar = page.getByLabel("Baustelle");
    await expect(sichtbar).toBeVisible();
    await expect(sichtbar.locator("option")).toHaveText([
      "Alle Baustellen",
      "E2E-Baustelle Filter B",
      "E2E-Baustelle Reise",
    ]);

    // Gefiltert wird auf „E2E-Baustelle Reise" (…e241) — die Baustelle, die es
    // schon vorher gab. Die andere (…e242) darf danach nirgends auftauchen.
    const erzeugt = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/kosten/snapshots" && r.request().method() === "POST",
    );
    await sichtbar.selectOption({ value: BAUSTELLE_GEFILTERT });
    await page.getByRole("button", { name: "Snapshot erzeugen" }).click();

    const post = await erzeugt;
    expect(post.status()).toBe(201);
    // Der Rumpf, den der Browser WIRKLICH gesendet hat — nicht der, den die
    // Ansicht anzeigt. Ohne diese Zeile bewiese der Rest nur, dass der Server
    // richtig filtert, nicht dass die Oberflaeche die gewaehlte Id sendet.
    expect(post.request().postDataJSON()).toEqual({
      publishedPlanVersionId: ENTWURF_146,
      worksiteId: BAUSTELLE_GEFILTERT,
    });

    const gefiltert = (await post.json()) as {
      id: string;
      worksiteId: string | null;
      totalMinorUnits: string;
      positions: { worksiteId: string; worksiteLabel: string }[];
    };
    expect(gefiltert.worksiteId).toBe(BAUSTELLE_GEFILTERT);
    expect(gefiltert.totalMinorUnits).toBe(ERWARTETE_FILTER_MINOR);
    expect(gefiltert.positions).toHaveLength(1);
    expect(gefiltert.positions[0]?.worksiteId).toBe(BAUSTELLE_GEFILTERT);
    const gefilterteId = gefiltert.id;
    expect(gefilterteId).not.toBe(kostenSnapshotId);

    // Die Oberflaeche zeigt den gefilterten GESPEICHERTEN Stand.
    await expect(page.getByTestId("kosten-baustellenfilter")).toHaveText(BAUSTELLE_GEFILTERT);
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_FILTER_ANZEIGE);
    const positionen = page.getByTestId("kosten-position");
    await expect(positionen).toHaveCount(1);
    await expect(positionen.first()).toContainText("E2E-Baustelle Reise");
    // Und die andere Baustelle steht nirgends IM SNAPSHOT.
    //
    // Bewusst auf den Snapshot-Bereich eingegrenzt und NICHT auf `page.content()`:
    // die ausgeschlossene Baustelle MUSS als `<option>` in der Auswahl stehen
    // bleiben, sonst koennte niemand den Filter wieder aendern. Eine seitenweite
    // Zusicherung verbot genau das und war damit eine Behauptung ueber die
    // Oberflaeche, die dem Zweck der Auswahl widersprach (gemessen: Lauf
    // 31739153815, auth-journey rot an dieser Zeile — bei korrektem Snapshot).
    // Die Aussage, um die es geht, ist der gespeicherte Stand.
    await expect(page.getByTestId("kosten-snapshot")).not.toContainText("E2E-Baustelle Filter B");

    // UND er liegt so in PostgreSQL: Filter im Kopf, keine fremde Position.
    // `koepfe_gesamt=2` — der ungefilterte aus 9e und dieser.
    const gepruefte = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt146-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${gefilterteId}`,
        "-v",
        `baustelle=${BAUSTELLE_GEFILTERT}`,
        "-v",
        `fremde_baustelle=${BAUSTELLE_AUSGESCHLOSSEN}`,
        "-v",
        `summe=${ERWARTETE_FILTER_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE_146}`,
        "-v",
        "koepfe_gesamt=2",
      ],
      "[eyt146-snapshot]",
    );
    console.log(`  ${gepruefte}`);

    await page.screenshot({ path: join(ARTEFAKTE, "09-kosten-gefiltert.png"), fullPage: true });

    // Reload: derselbe gefilterte Snapshot, ohne zweite Erzeugung und ohne
    // Baustellenabfrage — der Reload-Vertrag gilt auch mit Filter.
    const vorher = apiAufrufe.length;
    await page.reload();
    await expect(page.getByTestId("kosten-snapshot")).toHaveAttribute(
      "data-snapshot-id",
      gefilterteId,
    );
    await expect(page.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_FILTER_ANZEIGE);
    const seitReload = apiAufrufe.slice(vorher);
    expect(seitReload).toContain(`GET /api/v1/kosten/snapshots/${gefilterteId}`);
    expect(seitReload).not.toContain("POST /api/v1/kosten/snapshots");
    expect(seitReload.filter((a) => a.includes("/baustellen"))).toEqual([]);
    expect(seitReload.filter((a) => a.includes("/kosten/planversionen"))).toEqual([]);

    // Zweiter Browserkontext: eigene Cookies, eigener Speicher, derselbe Stand.
    const zweiter = await page.context().browser()?.newContext();
    if (zweiter === undefined) throw new Error("[auth-journey] kein zweiter Browserkontext.");
    try {
      const seite2 = await zweiter.newPage();
      const aufrufe2: string[] = [];
      seite2.on("request", (anfrage) => {
        const pfad = new URL(anfrage.url()).pathname;
        if (pfad.startsWith("/api/")) aufrufe2.push(`${anfrage.method()} ${pfad}`);
      });

      await seite2.goto("/anmelden");
      await seite2.getByLabel("E-Mail").fill(email);
      await seite2.getByLabel("Passwort").fill(passwort);
      await seite2.getByRole("button", { name: "Anmelden" }).click();
      await seite2.waitForURL((u) => !u.pathname.startsWith("/anmelden"));

      await seite2.goto(`/kosten?snapshot=${gefilterteId}`);
      await expect(seite2.getByTestId("kosten-snapshot")).toHaveAttribute(
        "data-snapshot-id",
        gefilterteId,
      );
      await expect(seite2.getByTestId("kosten-baustellenfilter")).toHaveText(BAUSTELLE_GEFILTERT);
      await expect(seite2.getByTestId("kosten-gesamtsumme")).toHaveText(ERWARTETE_FILTER_ANZEIGE);
      expect(aufrufe2).toContain(`GET /api/v1/kosten/snapshots/${gefilterteId}`);
      expect(aufrufe2).not.toContain("POST /api/v1/kosten/snapshots");

      await seite2.screenshot({ path: join(ARTEFAKTE, "10-kosten-gefiltert-zweiter.png") });
    } finally {
      await zweiter.close();
    }

    // Nach Reload UND zweitem Kontext: immer noch GENAU ZWEI Snapshots.
    const danach = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt146-snapshot-pruefen.sql"),
      [
        "-v",
        `snapshot_id=${gefilterteId}`,
        "-v",
        `baustelle=${BAUSTELLE_GEFILTERT}`,
        "-v",
        `fremde_baustelle=${BAUSTELLE_AUSGESCHLOSSEN}`,
        "-v",
        `summe=${ERWARTETE_FILTER_MINOR}`,
        "-v",
        "positionen=1",
        "-v",
        `woche=${PLANWOCHE_146}`,
        "-v",
        "koepfe_gesamt=2",
      ],
      "[eyt146-snapshot]",
    );
    console.log(`  ${danach}`);
    expect(danach).toContain("koepfe_gesamt=2");
    expect(danach).toContain("fremde_positionen=0");

    schritte["9h_baustellenfilter"] = {
      planVersionId: ENTWURF_146,
      baustellen: auswahl.worksites.map((b) => b.label),
      gewaehlt: BAUSTELLE_GEFILTERT,
      snapshotId: gefilterteId,
      summe: gefiltert.totalMinorUnits,
      datenbank: danach,
    };
  });

  await test.step("10 — ein fremder Organisationskontext wird abgelehnt", async () => {
    // Dieselbe gueltige Sitzung, aber eine Organisation, in der der Reisende
    // nicht Mitglied ist. Der Header waehlt aus, er autorisiert nicht.
    const fremd = await page.request.get("/api/v1/kosten/mitarbeiter", {
      headers: { "X-EasyTree-Organization-Id": FREMDE_ORG },
    });
    expect(fremd.status()).toBe(403);
    const problem = (await fremd.json()) as { detail?: string };
    // Kein Existenzleck: die Antwort unterscheidet nicht zwischen "gibt es
    // nicht" und "du gehoerst nicht dazu".
    expect(problem.detail).toBe("Kein Zugriff auf die Kostendaten dieser Organisation.");
    schritte["10_fremde_organisation"] = { status: fremd.status(), erwartet: 403 };
  });

  await test.step("11 — kein Token in Browserspeicher oder DOM", async () => {
    const speicher = await page.evaluate(() => ({
      local: Object.entries(localStorage).map(([k, v]) => `${k}=${String(v)}`),
      session: Object.entries(sessionStorage).map(([k, v]) => `${k}=${String(v)}`),
      // Cookies, die JavaScript SEHEN kann — die Token-Cookies (HttpOnly)
      // gehoeren NIE dazu.
      sichtbareCookies: document.cookie,
    }));
    expect(speicher.local).toEqual([]);
    expect(speicher.session).toEqual([]);

    // Seit EYT-113 Inkrement 2 ist GENAU EIN sichtbares Cookie vorgesehen:
    // `eyt_org`, der Selector der Organisationsauswahl (nie Autorisierung,
    // nie Geheimnis — der Server prueft ihn gegen die real verifizierte
    // Session, lib/kosten-freigabe.ts). Die Zusicherung prueft seither die
    // NAMENSMENGE und den Wert statt Leere — jeder neue sichtbare Cookie
    // macht sie rot: ein `eyt_access`/`eyt_refresh` ohne HttpOnly genauso
    // wie jeder fremde Name, und ein Tokenwert im Selector faellt am
    // Wertevergleich plus Punkt-Waechter.
    const sichtbare = speicher.sichtbareCookies
      .split(";")
      .map((teil) => teil.trim())
      .filter((teil) => teil !== "")
      .map((teil) => {
        const gleich = teil.indexOf("=");
        return gleich === -1
          ? { name: teil, wert: "" }
          : { name: teil.slice(0, gleich), wert: teil.slice(gleich + 1) };
      });
    // Namensmenge: Teilmenge von { eyt_org } — strenger als die alte
    // Leere-Zusicherung fuer alles, was nicht der Selector ist.
    const fremdeNamen = sichtbare.map((c) => c.name).filter((name) => name !== "eyt_org");
    expect(fremdeNamen).toEqual([]);
    // Wert: exakt die Fixtur-Organisation — eine UUID, strukturell kein JWT.
    const orgCookie = sichtbare.find((c) => c.name === "eyt_org");
    expect(orgCookie?.wert).toBe(ORG_ID);
    // Ein JWT traegt immer zwei Punkte, eine Org-UUID keinen einzigen.
    expect(orgCookie?.wert).not.toContain(".");

    // `eyJ` ist der Anfang jedes base64url-kodierten JWT-Headers. Erscheint er
    // im gerenderten HTML, ist ein Token in den DOM geraten.
    const inhalt = await page.content();
    expect(inhalt).not.toContain("eyJ");

    schritte["11_browserspeicher"] = {
      localStorage: 0,
      sessionStorage: 0,
      sichtbare_cookies: speicher.sichtbareCookies,
      token_im_dom: false,
    };
  });

  await test.step("12 — Abmelden macht die Sitzung ungueltig", async () => {
    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.waitForURL("**/anmelden");

    const danach = await context.cookies();
    expect(danach.find((k) => k.name === "eyt_access")).toBeUndefined();
    expect(danach.find((k) => k.name === "eyt_refresh")).toBeUndefined();

    // EYT-113: das Abmelden loescht auch den Selector `eyt_org`. Das ist der
    // Clear-Zweig der Kompositionswurzel — onOrganisationChange(null) ->
    // schreibeOrgAuswahl(null) in app/providers.tsx —, den sonst kein
    // Nachweis ausuebt. Er feuert in einem React-Effekt NACH dem
    // Abmelde-Commit, deshalb poll statt Einmal-Blick. Gegenmutation:
    // Clear-Zweig in providers.tsx entfernen -> diese Zusicherung wird rot.
    await expect
      .poll(async () => (await context.cookies()).map((k) => k.name))
      .not.toContain("eyt_org");

    // Nicht nur "das Cookie ist weg", sondern "der Server laesst nicht mehr
    // durch": ohne diese Zusicherung bewiese der Test nur, dass der Browser
    // vergessen hat.
    const sitzung = await page.request.get("/api/v1/auth/session");
    expect(sitzung.status()).toBe(401);
    const kosten = await page.request.get("/api/v1/kosten/mitarbeiter");
    expect(kosten.status()).toBe(401);

    // Und die Oberflaeche zeigt den ehrlichen Zustand.
    await page.goto("/kosten");
    await expect(page.getByTestId("kosten-unauthenticated")).toBeVisible();
    await expect(page.getByRole("link", { name: "Kosten" })).toHaveCount(0);

    schritte["12_abmeldung"] = {
      cookies_geloescht: true,
      selector_geloescht: true,
      session_status: sitzung.status(),
      kosten_status: kosten.status(),
    };
  });

  // Es gibt hier bewusst KEINEN Schritt „Zusammenfassung ablegen" mehr. Das
  // Schreiben steht im `afterEach` weiter oben, weil der Ausgang des Laufs
  // erst dort feststeht — die Begruendung samt Messung ist dort notiert.
});

/**
 * Der unterscheidende Nachweis (EYT-106 AK8, EYT-134).
 *
 * B ist ein ECHTER, ueber GoTrue angemeldeter Benutzer ohne jede
 * Mitgliedschaft. Waere im Server eine feste Identitaet verdrahtet — die
 * Sorge, gegen die AK8 antritt —, dann naennte Bs Sitzung die Id von A und der
 * Kostenpfad liesse B durch. Beides wird hier gemessen.
 *
 * Eigener Browserkontext: B darf nichts von As Sitzung erben.
 *
 * ## Abgrenzung zu Schritt 9g2 (EYT-109 Task 17)
 *
 * Die beiden messen VERSCHIEDENE Grenzen und ersetzen einander nicht. Hier hat
 * B keine Mitgliedschaft: die Kostenpolicy kommt ueber die
 * Organisationsaufloesung nicht hinaus und antwortet ohne Header 400
 * (`ORG_CONTEXT_REQUIRED`). In 9g2 hat B eine aktive `member`-Mitgliedschaft
 * IN DERSELBEN Organisation und antwortet dieselbe Route ohne Header 403 — die
 * Organisation war eindeutig, es fehlte das Recht. Das Statuspaar 400/403 hier
 * gegen 403/403 dort ist der einzige von aussen sichtbare Unterschied, weil die
 * Policy `ORG_NOT_A_MEMBER` und `PERMISSION_MISSING` absichtlich gleich
 * beantwortet.
 *
 * ## Zweite Aufgabe seit EYT-136: SEKUNDAERE Gegenprobe auf die Leihgabe in 9c5
 *
 * Schritt 9c5 leiht B fuer seine Dauer eine aktive `member`-Mitgliedschaft und
 * gibt sie unmittelbar danach zurueck. Ueberlebte sie, naennte Bs Sitzung hier
 * eine Organisation und dieser Nachweis wuerde rot.
 *
 * Die Rangfolge der Waechter, ehrlich benannt:
 *
 *  1. PRIMAER ist die Nachbedingung in `eyt136-member-aus.sql`
 *     (`leihe`/`b_gesamt` muessen 0 sein): sie liest nach dem Loeschen nach,
 *     und `psqlMitMarker` wirft, wenn ihr Marker fehlt oder psql einen Fehler
 *     meldet. Sie greift im SELBEN Schritt, in dem die Leihgabe entstand.
 *  2. SEKUNDAER ist dieser Nachweis — und er greift NUR, wenn der Hauptnachweis
 *     sonst gruen bleibt. `test.describe.configure({ mode: "serial" })` weiter
 *     oben laesst nachfolgende Faelle bei einem roten Vorgaenger naemlich
 *     AUSFALLEN statt sie zu fahren. Ein roter Hauptnachweis SKIPPT diesen
 *     hier, er faerbt ihn nicht rot. Er deckt also genau den Fall „Leihgabe
 *     ueberlebt, waehrend alles andere gruen ist" — und den deckt er sicher.
 *
 * Dass er ueberhaupt DANACH laeuft, folgt aus der Deklarationsreihenfolge in
 * dieser Datei plus `workers: 1` und `fullyParallel: false` in `config.ts`;
 * das SKIP-Verhalten kommt dagegen allein aus dem `serial`-Modus.
 *
 * Der Teardown taugt als Waechter NICHT: er loescht alle Mitgliedschaften der
 * Organisation und zaehlt erst danach — eine ueberlebende Leihgabe wuerde dort
 * aufgeraeumt, nicht bemerkt.
 */
test("Benutzer B ist angemeldet, aber ohne Mitgliedschaft ausgesperrt", async ({ browser }) => {
  const emailB = pflicht("EASYTREE_JOURNEY_EMAIL_B");
  const passwortB = pflicht("EASYTREE_JOURNEY_PASSWORT_B");
  const idB = pflicht("EASYTREE_JOURNEY_USER_B");
  const idA = pflicht("EASYTREE_JOURNEY_USER_A");

  const kontext = await browser.newContext();
  const seite = await kontext.newPage();
  const bericht: Record<string, unknown> = { ticket: "EYT-106", benutzer: "B" };
  ZUSAMMENFASSUNGEN.set(test.info().testId, { datei: "zusammenfassung-b.json", bericht });

  try {
    await test.step("B meldet sich ueber dieselbe echte Loginseite an", async () => {
      await seite.goto("/anmelden");
      await seite.getByLabel("E-Mail").fill(emailB);
      await seite.getByLabel("Passwort").fill(passwortB);
      await seite.getByRole("button", { name: "Anmelden" }).click();

      // Auf den ABSCHLUSS warten, nicht auf den Klick. Der Klick kehrt sofort
      // zurueck; Cookie und Weiterleitung entstehen erst mit der Antwort.
      // Ohne dieses Warten las der Test die Cookies nach 369 ms und fand
      // keine — gemessen im ersten CI-Lauf. Fuer Reise A stand dieses Warten
      // von Anfang an da; hier fehlte es.
      //
      // Schlaegt der Login wirklich fehl, zeigt das Formular einen Banner mit
      // role="alert". Auf beides zu warten macht aus einem stillen Timeout
      // eine benannte Ursache.
      // Seit EYT-113 landet ein Konto ohne Leitungsrolle in der Feld-Shell —
      // B hat gar keine Mitgliedschaft und gehoert damit erst recht dorthin.
      const angemeldet = seite.waitForURL("**/feld");
      const abgelehnt = seite
        .getByRole("alert")
        .filter({ hasText: "Anmeldung fehlgeschlagen" })
        .waitFor({ state: "visible" });
      await Promise.race([angemeldet, abgelehnt]);
      await expect(
        seite.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" }),
      ).toHaveCount(0);
      await angemeldet;

      // B ist ein gueltiger Benutzer und bekommt eine echte Sitzung. Nur
      // berechtigt ist er nicht — das ist der Unterschied, um den es geht.
      const kekse = await kontext.cookies();
      expect(kekse.find((k) => k.name === "eyt_access")?.httpOnly).toBe(true);

      // Und die Feld-Shell bleibt ehrlich: ohne Mitgliedschaft gibt es keine
      // fachliche Flaeche, sondern den benannten Leerzustand (EYT-113).
      await expect(seite.getByTestId("feld-ohne-organisation")).toBeVisible();
    });

    await test.step("die Sitzung nennt Bs eigene Id, nicht die von A", async () => {
      const antwort = await seite.request.get("/api/v1/auth/session");
      expect(antwort.status()).toBe(200);
      const sitzung = (await antwort.json()) as {
        userId: string;
        organisations: unknown[];
      };
      // DER Nachweis gegen eine eingeschleuste Identitaet.
      expect(sitzung.userId).toBe(idB);
      expect(sitzung.userId).not.toBe(idA);
      // Ohne Mitgliedschaft ist die Liste leer — nicht etwa As Organisation.
      expect(sitzung.organisations).toEqual([]);
      bericht["session"] = { userId_ist_B: true, organisationen: 0 };
    });

    await test.step("keine Kosten-Navigation", async () => {
      await seite.goto("/kosten");
      await expect(seite.getByRole("link", { name: "Kosten" })).toHaveCount(0);
      // Angemeldet, aber ohne Organisation: der ehrliche Zustand, nicht der
      // abgemeldete Banner.
      await expect(seite.getByTestId("kosten-unauthenticated")).toHaveCount(0);
    });

    await test.step("der Kostenpfad lehnt B stabil ab", async () => {
      const mitarbeiter = await seite.request.get("/api/v1/kosten/mitarbeiter");
      expect(mitarbeiter.status()).toBe(400);
      const historie = await seite.request.get(`/api/v1/kosten/stundensaetze/${MITARBEITER_ID}`);
      expect(historie.status()).toBe(400);
      // Mit dem Organisationsheader von A wird daraus eine Ablehnung ohne
      // Existenzleck — nie ein Durchlass.
      const mitFremdemHeader = await seite.request.get("/api/v1/kosten/mitarbeiter", {
        headers: { "X-EasyTree-Organization-Id": ORG_ID },
      });
      expect(mitFremdemHeader.status()).toBe(403);
      bericht["kostenpfad"] = {
        mitarbeiter: mitarbeiter.status(),
        historie: historie.status(),
        mit_fremdem_header: mitFremdemHeader.status(),
      };
    });

    await test.step("nichts von A ist fuer B sichtbar", async () => {
      const inhalt = await seite.content();
      expect(inhalt).not.toContain(MITARBEITER_NAME);
      expect(inhalt).not.toContain(ERWARTETER_BETRAG);
      expect(inhalt).not.toContain(ORG_NAME);
      const koerper = await (await seite.request.get("/api/v1/kosten/mitarbeiter")).text();
      expect(koerper).not.toContain(MITARBEITER_NAME);
      expect(koerper).not.toContain(MITARBEITER_ID);
      bericht["kein_datenabfluss"] = true;
    });

    // EYT-144: B sieht auch keine KOSTEN — weder die Auswahlliste noch den
    // gespeicherten Snapshot, den A gerade erzeugt hat. Ohne diesen Schritt
    // bewiese die Reise nur, dass ein Berechtigter Kosten sehen kann.
    await test.step("B erreicht weder Planversionsliste noch fremden Snapshot", async () => {
      const snapshotId = reiseSnapshotId === "" ? ID_OHNE_SNAPSHOT : reiseSnapshotId;

      await seite.goto(`/kosten?snapshot=${snapshotId}`);
      // Der Waechter blockt VOR jedem Gateway-Aufruf: B hat keine bestaetigte
      // Organisation, also gibt es keine Kostenansicht.
      await expect(seite.getByTestId("kosten-snapshot")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-gesamtsumme")).toHaveCount(0);
      await expect(seite.getByLabel("Von Woche")).toHaveCount(0);

      // Und im DOM steht kein Betrag — auch nicht versteckt. Geprueft wird der
      // gerenderte Inhalt, nicht das Sichtbare: ein `display:none`-Element
      // truege den Wert trotzdem aus.
      //
      // Was hier BEWUSST NICHT geprueft wird: die Abwesenheit der Snapshot-Id.
      // Sie steht im Auslieferungspayload der Seite — gemessen am 13.08.2026
      // gegen den echten Build, genau einmal. Das ist kein Leck, sondern Bs
      // EIGENER URL-Parameter: `/kosten` reicht ihn als Prop an die
      // Client-Komponente weiter, und Next serialisiert die Props der Kinder
      // unabhaengig davon, ob der Zugangswaechter sie rendert. Eine Zusicherung
      // darauf waere rot geworden und haette dabei nichts ueber Zugriffsrechte
      // gesagt. Die Aussage, um die es geht, sind die BETRAEGE — und derselbe
      // Build enthielt davon null.
      const inhalt = await seite.content();
      expect(inhalt).not.toContain(ERWARTETE_KOSTEN_ANZEIGE);
      expect(inhalt).not.toContain(ERWARTETE_KOSTEN_MINOR);

      // Der Server lehnt unabhaengig von der Oberflaeche ab — zweimal je Route:
      // ohne Organisationskontext (400) und mit dem Kontext von A (403). Der
      // zweite Fall ist der eigentliche: er fragt genau die Organisation an, in
      // der die Daten liegen.
      const listeOhne = await seite.request.get(
        `/api/v1/kosten/planversionen?fromWeekKey=${PLANWOCHE}&toWeekKey=${PLANWOCHE}`,
      );
      expect(listeOhne.status()).toBe(400);
      const listeMit = await seite.request.get(
        `/api/v1/kosten/planversionen?fromWeekKey=${PLANWOCHE}&toWeekKey=${PLANWOCHE}`,
        { headers: { "X-EasyTree-Organization-Id": ORG_ID } },
      );
      expect(listeMit.status()).toBe(403);
      expect(await listeMit.text()).not.toContain(snapshotId);

      const snapshotMit = await seite.request.get(`/api/v1/kosten/snapshots/${snapshotId}`, {
        headers: { "X-EasyTree-Organization-Id": ORG_ID },
      });
      expect(snapshotMit.status()).toBe(403);
      const koerper = await snapshotMit.text();
      expect(koerper).not.toContain(ERWARTETE_KOSTEN_MINOR);
      expect(koerper).not.toContain(MITARBEITER_NAME);

      bericht["kostenansicht_verweigert"] = {
        planversionen_ohne_kontext: listeOhne.status(),
        planversionen_mit_kontext_von_a: listeMit.status(),
        snapshot_mit_kontext_von_a: snapshotMit.status(),
        snapshot_id_im_dom: false,
      };
    });

    // EYT-107: B darf auch nicht veroeffentlichen — weder sichtbar noch ueber
    // die API. Ohne diesen Schritt bewiese die Reise nur, dass ein
    // BERECHTIGTER es kann.
    await test.step("B sieht keine Planung und darf nicht veroeffentlichen", async () => {
      await seite.goto(`/planung?weekKey=${PLANWOCHE}`);
      // Der Waechter blockt VOR jedem Gateway-Aufruf.
      //
      // Welcher Zustand? B ist angemeldet, hat aber KEINE aktive
      // Mitgliedschaft. Damit gibt es keine bestaetigte Organisation, in der
      // ein Recht ueberhaupt gelten koennte — der Zustand ist „keine
      // eindeutige Organisation", nicht „Forbidden". `Forbidden` gilt fuer
      // eine bestaetigte Organisation OHNE `planning.read`; dieser Fall wird
      // in `planung-zugang.test.tsx` geprueft.
      //
      // Eine erste Fassung erwartete hier `planung-forbidden` und war rot.
      // Nicht die Zusicherung wurde angepasst, sondern der Produktzustand:
      // der Banner behauptete „Du gehörst mehreren Organisationen an" — fuer
      // B falsch. Serverseitig entspricht dem `ORG_CONTEXT_REQUIRED`.
      await expect(seite.getByTestId("planung-org-erforderlich")).toBeVisible();
      await expect(seite.getByTestId("planung-forbidden")).toHaveCount(0);
      await expect(seite.getByTestId("planung-veroeffentlichen")).toHaveCount(0);
      await expect(seite.getByTestId("planungsfenster-stand")).toHaveCount(0);

      // Und der Server lehnt unabhaengig von der Oberflaeche ab. Ein
      // Idempotenzschluessel wird mitgeschickt, damit die Ablehnung
      // NICHT aus einer fehlenden Kopfzeile stammt — sonst bewiese der Fall
      // nur, dass ein Pflichtheader fehlt.
      const direkt = await seite.request.post("/api/v1/planung/versionen", {
        headers: { "Idempotency-Key": B_PUBLISH_VORGANG },
        data: { weekKey: PLANWOCHE, expectedVersionId: null },
      });
      expect(direkt.status()).toBe(403);
      bericht["publish_verweigert"] = { status: direkt.status(), erwartet: 403 };
    });

    // Nur noch das Bildschirmfoto: es braucht `seite`, die im `finally` unten
    // geschlossen wird. Die Zusammenfassung schreibt der `afterEach` — dort
    // steht der Ausgang fest, hier stuende wieder nur eine Konstante.
    await test.step("Bildschirmfoto von B ablegen", async () => {
      mkdirSync(ARTEFAKTE, { recursive: true });
      await seite.screenshot({ path: join(ARTEFAKTE, "03-benutzer-b-ohne-zugang.png") });
    });
  } finally {
    await kontext.close();
  }
});

/**
 * EYT-113 — die Feld-Reise: ein realer member erreicht aufgrund seiner
 * serverseitig verifizierten Session die Mitarbeiter-Feld-Shell; die Werkbank
 * bleibt ihm verschlossen, und zwar am RECHT, nicht an der Route.
 *
 * Die member-Mitgliedschaft ist dieselbe Leihgabe wie in 9c5/9g2
 * (`eyt136-member-an.sql`/`-aus.sql`): kein neuer Benutzer, `auth.users`
 * bleibt unberuehrt, und die Nachbedingung der Rueckgabe ist der primaere
 * Waechter gegen eine ueberlebende Leihgabe. Der Aufruf steht im `try`,
 * die Rueckgabe laeuft auf jedem Weg (Begruendung woertlich bei 9c5).
 */
test("EYT-113: ein member erreicht die Feld-Shell, die Werkbank bleibt zu", async ({ browser }) => {
  const emailB = pflicht("EASYTREE_JOURNEY_EMAIL_B");
  const passwortB = pflicht("EASYTREE_JOURNEY_PASSWORT_B");
  const idA = pflicht("EASYTREE_JOURNEY_USER_A");
  const idB = pflicht("EASYTREE_JOURNEY_USER_B");
  const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

  const kontext = await browser.newContext();
  const seite = await kontext.newPage();
  const bericht: Record<string, unknown> = { ticket: "EYT-113", benutzer: "B als member" };
  ZUSAMMENFASSUNGEN.set(test.info().testId, { datei: "zusammenfassung-feld.json", bericht });

  let fehlerAusFall: [unknown] | null = null;
  try {
    const an = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt136-member-an.sql"),
      ["-v", `benutzer_a=${idA}`, "-v", `benutzer_b=${idB}`],
      "[eyt136-member-an]",
    );
    console.log(`  ${an}`);

    await test.step("Login fuehrt einen member in die Feld-Shell", async () => {
      await seite.goto("/anmelden");
      await seite.getByLabel("E-Mail").fill(emailB);
      await seite.getByLabel("Passwort").fill(passwortB);
      await seite.getByRole("button", { name: "Anmelden" }).click();

      const angekommen = seite.waitForURL("**/feld");
      const abgelehnt = seite
        .getByRole("alert")
        .filter({ hasText: "Anmeldung fehlgeschlagen" })
        .waitFor({ state: "visible" });
      await Promise.race([angekommen, abgelehnt]);
      await expect(
        seite.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" }),
      ).toHaveCount(0);
      await angekommen;

      // Die Shell nennt die REALEN Sessiondaten — Organisation und Rolle aus
      // der serverseitig aufgeloesten Sitzung, keine Attrappe.
      await expect(seite.getByTestId("feld-shell")).toBeVisible();
      await expect(seite.getByTestId("feld-org")).toHaveText(ORG_NAME);
      await expect(seite.getByTestId("feld-rolle")).toHaveText("Mitarbeiter");
      bericht["landung"] = { url: seite.url() };
    });

    await test.step("die Feld-Shell zeigt keine Werkbank-Navigation", async () => {
      await expect(seite.getByRole("link", { name: "Planung" })).toHaveCount(0);
      await expect(seite.getByRole("link", { name: "Kosten" })).toHaveCount(0);
      const werkbankLinks = await seite.evaluate(
        () => document.querySelectorAll('a[href="/planung"], a[href="/kosten"]').length,
      );
      expect(werkbankLinks).toBe(0);
      bericht["keine_werkbank_navigation"] = true;
    });

    await test.step("auch die Startseite leitet den member serverseitig ins Feld", async () => {
      await seite.goto("/");
      await seite.waitForURL("**/feld");
      await expect(seite.getByTestId("feld-shell")).toBeVisible();
      bericht["start_dispatch"] = true;
    });

    await test.step("Feld-Shell bei 320/375 px: axe, Reflow, Tastatur, Fokus", async () => {
      await pruefeBarrierefreiheit(seite, "/feld", FELD_BREITEN);

      // Touch-Ziel nach Basisdesign v2.0 §2.3 (mindestens 40 px): das eine
      // reale Bedienelement der Shell, gemessen auf der kleinsten Breite.
      await seite.setViewportSize({ width: 320, height: 640 });
      const abmelden = await seite.getByTestId("feld-abmelden").boundingBox();
      expect(abmelden).not.toBeNull();
      expect(abmelden!.height).toBeGreaterThanOrEqual(40);

      mkdirSync(ARTEFAKTE, { recursive: true });
      await seite.screenshot({ path: join(ARTEFAKTE, "04-feld-shell-320.png") });
      await seite.setViewportSize({ width: 375, height: 720 });
      await seite.screenshot({ path: join(ARTEFAKTE, "05-feld-shell-375.png") });
      bericht["responsive"] = { breiten: [320, 375], touchziel_abmelden_px: abmelden!.height };
    });

    await test.step("Cross-Shell: die Werkbank gibt dem member nichts preis", async () => {
      // B ist jetzt member GENAU EINER Organisation: der Zustand auf /planung
      // ist Forbidden — nicht "Organisation erforderlich" wie bei B ohne
      // Mitgliedschaft (dort geprueft) und nicht der Kosteninhalt (9g2 prueft
      // die Kostenflaeche desselben members).
      await seite.goto(`/planung?weekKey=${PLANWOCHE}`);
      await expect(seite.getByTestId("planung-forbidden")).toBeVisible();
      await expect(seite.getByTestId("planungsfenster-stand")).toHaveCount(0);
      await expect(seite.getByTestId("planung-veroeffentlichen")).toHaveCount(0);

      // Der Server lehnt unabhaengig von der Oberflaeche ab — 403, nicht 400:
      // mit genau einer aktiven Mitgliedschaft ist die Organisation eindeutig,
      // es fehlt das RECHT.
      const fenster = await seite.request.get(`/api/v1/planung/fenster?weekKey=${PLANWOCHE}`);
      expect(fenster.status()).toBe(403);
      expect(await fenster.text()).not.toContain(MITARBEITER_NAME);
      const mitarbeiter = await seite.request.get("/api/v1/kosten/mitarbeiter");
      expect(mitarbeiter.status()).toBe(403);
      expect(await mitarbeiter.text()).not.toContain(MITARBEITER_NAME);
      bericht["cross_shell"] = {
        planung_fenster: fenster.status(),
        kosten_mitarbeiter: mitarbeiter.status(),
        erwartet: 403,
      };
    });

    await test.step("EYT-113 Inkrement 2: die Kostenrouten liefern dem member keine Kosten-Chunks", async () => {
      // Serverseitige LADEGRENZE, nicht nur Anzeige-Grenze: fuer einen member
      // ohne `costs.read` darf die Kostenroute die Kosten-Client-Komponenten
      // gar nicht erst referenzieren — kein Chunk-Abruf, keine Chunk-Referenz
      // im Dokument, keine Wirtschaftsdaten. Die Positivkontrolle dazu steht
      // in Schritt 3b der Hauptreise: dort fordert der BERECHTIGTE dieselbe
      // abgeleitete Chunkmenge nachweislich an.
      const kostenChunks = kostenChunkDateien();

      // Sammler VOR der Navigation — sonst fehlte genau die erste Anfrage.
      const chunkAnfragenB: string[] = [];
      seite.on("request", (anfrage) => {
        const pfad = new URL(anfrage.url()).pathname;
        if (pfad.startsWith("/_next/static/chunks/")) chunkAnfragenB.push(pfad);
      });

      for (const route of ["/kosten", "/kosten/stundensaetze"] as const) {
        await seite.goto(route);
        // Der vorgesehene Endzustand als Anker: erst wenn die Forbidden-
        // Flaeche steht, misst die Inhaltspruefung den fertigen Zustand und
        // nicht einen Ladezwischenstand.
        await expect(seite.getByTestId("kosten-forbidden"), `${route}: Forbidden`).toBeVisible();

        // Netzseite der Ladegrenze. Gegenmutation: das Gate aus
        // `kosten/page.tsx` bzw. `stundensaetze/page.tsx` entfernen — die
        // Route fordert die Kosten-Chunks dann wieder an.
        const geladeneKostenChunks = chunkAnfragenB.filter((pfad) =>
          kostenChunks.some((datei) => pfad.includes(datei)),
        );
        expect(geladeneKostenChunks, `${route}: angeforderte Kosten-Chunks`).toEqual([]);

        // Dokumentseite der Ladegrenze: schon die REFERENZ im HTML ist das
        // Leck, nicht erst der erfolgreiche Abruf (ein Browser mit Cache
        // fordert nichts an und truege die Referenz trotzdem). Gegenmutation:
        // dieselbe wie oben.
        const inhalt = await seite.content();
        for (const datei of kostenChunks) {
          expect(inhalt, `${route}: ${datei} steht im Dokument`).not.toContain(datei);
        }

        // Keine Wirtschaftsdaten im Dokument — Satzbetrag, Kostenanzeige,
        // Minor Units, Mitarbeitername (dieselben Fixturkonstanten wie in
        // 9g2). Gegenmutation: den Kosteninhalt serverseitig auch im
        // Verweigerungszweig rendern und nur per CSS verbergen.
        expect(inhalt, `${route}: Satzbetrag im Dokument`).not.toContain(ERWARTETER_BETRAG);
        expect(inhalt, `${route}: Kostenanzeige im Dokument`).not.toContain(
          ERWARTETE_KOSTEN_ANZEIGE,
        );
        expect(inhalt, `${route}: Minor Units im Dokument`).not.toContain(ERWARTETE_KOSTEN_MINOR);
        expect(inhalt, `${route}: Mitarbeitername im Dokument`).not.toContain(MITARBEITER_NAME);
      }

      await seite.screenshot({
        path: test.info().outputPath("eyt113-kosten-forbidden.png"),
        fullPage: true,
      });
      bericht["eyt113_ladegrenze"] = {
        kosten_chunks: kostenChunks,
        chunk_anfragen_gesamt: chunkAnfragenB.length,
      };
    });
  } catch (fehler) {
    fehlerAusFall = [fehler];
  }

  // Rueckgabe der Leihgabe auf JEDEM Weg — die Nachbedingung in
  // `eyt136-member-aus.sql` (leihe/b_gesamt = 0) ist der primaere Waechter.
  const aus = psqlMitMarker(
    verwaltung,
    join(HIER, "eyt136-member-aus.sql"),
    ["-v", `benutzer_a=${idA}`, "-v", `benutzer_b=${idB}`],
    "[eyt136-member-aus]",
  );
  console.log(`  ${aus}`);
  await kontext.close();
  if (fehlerAusFall !== null) throw fehlerAusFall[0];
});

/**
 * EYT-113 — fail-closed ohne Sitzung: /feld ist keine oeffentliche Flaeche.
 * Das Server-Gate (app/feld/layout.tsx) fragt die API und leitet Abgemeldete
 * zur Anmeldung, BEVOR irgendein Shell-Inhalt ausgeliefert wird.
 */
test("EYT-113: ohne Sitzung fuehrt /feld zur Anmeldung", async ({ browser }) => {
  const kontext = await browser.newContext();
  const seite = await kontext.newPage();
  try {
    await seite.goto("/feld");
    await seite.waitForURL("**/anmelden");
    await expect(seite.getByRole("heading", { name: "Anmelden", level: 1 })).toBeVisible();
    await expect(seite.getByTestId("feld-shell")).toHaveCount(0);
    await expect(seite.getByTestId("feld-org")).toHaveCount(0);
  } finally {
    await kontext.close();
  }
});

/**
 * EYT-113 Inkrement 2 — der PO-Entscheidungskern (29.08.2026): die
 * Kosten-Ladegrenze folgt der AUSGEWAEHLTEN Organisation, nicht irgendeiner.
 *
 * Reisender A traegt `costs.read` in der Reiseorganisation — und bekommt fuer
 * die Dauer dieses Nachweises eine ZWEITE Organisation geliehen, in der er
 * blosser `member` ohne Kostenrecht ist (`eyt113-zweitorg-an.sql`, Rueckgabe
 * `eyt113-zweitorg-aus.sql`; Praemissen- und Nachbedingungswaechter dort).
 * Erst dieses Paar unterscheidet die richtige Grenze von einer Any-Org-
 * Pruefung: derselbe Benutzer, dasselbe Recht, und trotzdem entscheidet
 * allein die Auswahl.
 *
 * Jede Phase nennt ihr Requirement und die Gegenmutation, die sie rot macht:
 *
 * - (a) REQ-L1c — Any-Org-Rueckfall in `kostenFreigabe` (bei fehlender
 *   Auswahl die erste Organisation nehmen): statt "Organisation waehlen"
 *   stuende der Kosteninhalt, und die Chunkmenge waere nicht leer.
 * - (b) REQ-L1b — `kostenFreigabe` prueft `costs.read` ueber ALLE
 *   Organisationen statt ueber die ausgewaehlte: die Zweitorganisation wuerde
 *   gewaehrt, weil A das Recht ANDERSWO traegt.
 * - (c) REQ-L6 — das Server-Gate aus `stundensaetze/page.tsx` entfernen: die
 *   Route referenziert und laedt die Kosten-Chunks wieder.
 * - (d) REQ-L5 — `pruefeRecht` in `MembershipCostAccessPolicy` auf "immer ok":
 *   der direkte API-Aufruf mit dem Zweitorg-Header antwortete 200.
 * - (e) REQ-L4 — den `router.refresh()` aus `setOrganisation`
 *   (`app/providers.tsx`) entfernen: die Server-Flaeche folgte der Auswahl
 *   nicht, `kosten-kein-snapshot` erschiene nie.
 * - (f) — den Cookie-Startwert (`initialeOrganisationId`) nicht mehr lesen:
 *   nach dem Reload stuende wieder "Organisation waehlen".
 * - (g) — den Selector-Cookie als AUTORITAET lesen (Freigabe ohne Abgleich
 *   gegen die Session): eine fremde Id im Cookie oeffnete den Kostenbereich,
 *   statt fail-closed in "Organisation waehlen" zu fallen.
 */
const ZWEITORG_ID = "00000000-0000-4000-8000-00000000e213";
const ZWEITORG_NAME = "EYT-113 Zweitorganisation";
/** Eine Id, die in KEINER Session steht — die Manipulationssonde in (g). */
const FREMDE_AUSWAHL = "00000000-0000-4000-8000-00000000dead";

test("EYT-113 I2: die Kosten-Ladegrenze folgt der ausgewaehlten Organisation", async ({
  browser,
}) => {
  const email = pflicht("EASYTREE_JOURNEY_EMAIL_A");
  const passwort = pflicht("EASYTREE_JOURNEY_PASSWORT_A");
  const idA = pflicht("EASYTREE_JOURNEY_USER_A");
  const verwaltung = pflicht("EASYTREE_JOURNEY_ADMIN_DB_URL");

  const kontext = await browser.newContext();
  const seite = await kontext.newPage();
  const bericht: Record<string, unknown> = {
    ticket: "EYT-113",
    inkrement: 2,
    benutzer: "A mit zwei Organisationen",
  };
  ZUSAMMENFASSUNGEN.set(test.info().testId, { datei: "zusammenfassung-mehrorg.json", bericht });

  let fehlerAusFall: [unknown] | null = null;
  try {
    // Die Leihgabe steht im `try`, weil das Skript die Zeilen committet,
    // BEVOR es seine Nachbedingung prueft — dieselbe Begruendung wie in 9g2.
    const an = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt113-zweitorg-an.sql"),
      ["-v", `benutzer_a=${idA}`],
      "[eyt113-zweitorg-an]",
    );
    console.log(`  ${an}`);
    bericht["leihgabe"] = an;

    // Chunkmenge und Sammler VOR der ersten Navigation — sonst fehlte genau
    // die Anfrage, die beim Einstieg faellt (dasselbe Muster wie 3b/Feld).
    const kostenChunks = kostenChunkDateien();
    const chunkAnfragen: string[] = [];
    seite.on("request", (anfrage) => {
      const pfad = new URL(anfrage.url()).pathname;
      if (pfad.startsWith("/_next/static/chunks/")) chunkAnfragen.push(pfad);
    });
    const kostenChunkAnfragen = (): string[] =>
      chunkAnfragen.filter((pfad) => kostenChunks.some((datei) => pfad.includes(datei)));

    await test.step("a — ohne Auswahl faellt /kosten fail-closed auf 'Organisation waehlen' (REQ-L1c)", async () => {
      // A ist owner der Reiseorganisation -> Leitungsrolle -> die Anmeldung
      // fuehrt in die Werkbank (/kosten). Mit ZWEI Organisationen und ohne
      // Selector-Cookie waehlt NIEMAND still aus (PO-Entscheidung): der
      // Server rendert die Auswahlaufforderung, keine Kostenflaeche.
      await seite.goto("/anmelden");
      await seite.getByLabel("E-Mail").fill(email);
      await seite.getByLabel("Passwort").fill(passwort);
      await seite.getByRole("button", { name: "Anmelden" }).click();

      const angekommen = seite.waitForURL("**/kosten");
      const abgelehnt = seite
        .getByRole("alert")
        .filter({ hasText: "Anmeldung fehlgeschlagen" })
        .waitFor({ state: "visible" });
      await Promise.race([angekommen, abgelehnt]);
      await expect(
        seite.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" }),
      ).toHaveCount(0);
      await angekommen;

      await expect(seite.getByTestId("kosten-org-auswahl")).toBeVisible();
      await expect(seite.getByTestId("kosten-forbidden")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-unauthenticated")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-kein-snapshot")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-laedt")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-flaeche-laedt")).toHaveCount(0);
      expect(kostenChunkAnfragen(), "a: angeforderte Kosten-Chunks").toEqual([]);
      bericht["a_keine_auswahl"] = {
        oberflaeche: "kosten-org-auswahl",
        kosten_chunk_anfragen: [...kostenChunkAnfragen()],
      };
    });

    await test.step("b — die Zweitorganisation auswaehlen: Forbidden, keine Chunks (REQ-L1b)", async () => {
      // Die ECHTE Bedienung: der Picker der Kopfleiste (er erscheint erst ab
      // zwei Organisationen) schreibt den Selector-Cookie und laesst die
      // Server-Flaeche per `router.refresh()` folgen. As Recht in der
      // REISEorganisation darf hier nichts gewaehren — das ist der Kern der
      // PO-Entscheidung.
      await seite.getByLabel("Organisation").selectOption({ label: ZWEITORG_NAME });

      const forbidden = seite.getByTestId("kosten-forbidden");
      await expect(forbidden).toBeVisible();
      // Der Banner nennt die AUSGEWAEHLTE Organisation: die Ablehnung kommt
      // aus der Zweitorganisation, nicht aus einer Any-Org-Aussage.
      await expect(forbidden).toContainText(ZWEITORG_NAME);
      await expect(seite.getByTestId("kosten-org-auswahl")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-kein-snapshot")).toHaveCount(0);
      expect(kostenChunkAnfragen(), "b: angeforderte Kosten-Chunks").toEqual([]);

      await seite.screenshot({
        path: test.info().outputPath("eyt113-mehrorg-forbidden.png"),
        fullPage: true,
      });
      bericht["b_zweitorg_forbidden"] = {
        oberflaeche: "kosten-forbidden",
        kosten_chunk_anfragen: [...kostenChunkAnfragen()],
      };
    });

    await test.step("c — auch die direkte URL /kosten/stundensaetze bleibt zu (REQ-L6)", async () => {
      await seite.goto("/kosten/stundensaetze");
      await expect(seite.getByTestId("kosten-forbidden")).toBeVisible();
      await expect(seite.getByTestId("saetze-flaeche-laedt")).toHaveCount(0);
      expect(kostenChunkAnfragen(), "c: angeforderte Kosten-Chunks").toEqual([]);

      // Dokumentseite der Ladegrenze: schon die REFERENZ im HTML ist das
      // Leck, nicht erst der erfolgreiche Abruf (Begruendung woertlich im
      // Feld-Nachweis oben).
      const inhalt = await seite.content();
      for (const datei of kostenChunks) {
        expect(inhalt, `c: ${datei} steht im Dokument`).not.toContain(datei);
      }
      bericht["c_direkte_url"] = {
        oberflaeche: "kosten-forbidden",
        kosten_chunk_anfragen: [...kostenChunkAnfragen()],
      };
    });

    await test.step("d — die API lehnt den Zweitorg-Header unabhaengig von der Oberflaeche ab (REQ-L5)", async () => {
      // Der Auswahlheader waehlt nur aus, er autorisiert nichts: in der
      // Zweitorganisation ist A member ohne `costs.read`, also 403 — am
      // RECHT, nicht an der Mitgliedschaft.
      const antwort = await seite.request.get("/api/v1/kosten/mitarbeiter", {
        headers: { "X-EasyTree-Organization-Id": ZWEITORG_ID },
      });
      expect(antwort.status(), "d: Kosten-API mit Zweitorg-Header").toBe(403);
      expect(await antwort.text()).not.toContain(MITARBEITER_NAME);
      bericht["d_api_zweitorg"] = { status: antwort.status(), erwartet: 403 };
    });

    await test.step("e — die Reiseorganisation auswaehlen: Inhalt UND Chunks kommen (REQ-L4)", async () => {
      // Die Positivkontrolle im SELBEN Kontext: erst der Wechsel auf die
      // berechtigte Organisation oeffnet die Flaeche — und erst jetzt fordert
      // der Browser die Kosten-Chunks an. Ohne sie sagte die leere Menge in
      // (a)-(c) nichts (guard-exists-but-never-visits-the-surface).
      await seite.goto("/kosten");
      await expect(seite.getByTestId("kosten-forbidden")).toBeVisible();
      await seite.getByLabel("Organisation").selectOption({ label: ORG_NAME });

      await expect(seite.getByTestId("kosten-kein-snapshot")).toBeVisible();
      await expect(seite.getByLabel("Von Woche")).toBeVisible();
      await expect(seite.getByTestId("kosten-forbidden")).toHaveCount(0);
      expect(
        kostenChunkAnfragen().length,
        `e: Kosten-Chunks [${kostenChunks.join(", ")}] — keiner wurde angefordert`,
      ).toBeGreaterThan(0);

      // Der Selector-Cookie traegt jetzt genau die Reiseorganisation.
      const orgCookie = cookie(await kontext.cookies(), "eyt_org");
      expect(orgCookie.value).toBe(ORG_ID);
      bericht["e_reiseorg_gewaehrt"] = {
        oberflaeche: "kosten-kein-snapshot",
        kosten_chunk_anfragen: [...kostenChunkAnfragen()],
        eyt_org: orgCookie.value,
      };
    });

    await test.step("f — die Auswahl ueberlebt den Reload (Cookie-Startwert)", async () => {
      await seite.reload();
      await expect(seite.getByTestId("kosten-kein-snapshot")).toBeVisible();
      await expect(seite.getByTestId("kosten-org-auswahl")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-forbidden")).toHaveCount(0);
      bericht["f_reload"] = { oberflaeche: "kosten-kein-snapshot" };
    });

    await test.step("g — ein manipulierter Selector-Cookie oeffnet NICHTS (fail-closed)", async () => {
      // Der Selector ist Auswahl, nie Autoritaet: eine Id, die NICHT in der
      // verifizierten Session steht, faellt serverseitig ersatzlos — zurueck
      // in "Organisation waehlen", nicht in irgendeinen Kosteninhalt.
      const anfragenVorManipulation = kostenChunkAnfragen().length;
      await kontext.addCookies([
        { name: "eyt_org", value: FREMDE_AUSWAHL, url: new URL(seite.url()).origin },
      ]);
      await seite.reload();

      await expect(seite.getByTestId("kosten-org-auswahl")).toBeVisible();
      await expect(seite.getByTestId("kosten-kein-snapshot")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-forbidden")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-laedt")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-flaeche-laedt")).toHaveCount(0);

      // Netz UND Dokument, aus einem gemessenen Grund BEIDE: (e) hat die
      // Chunks in DIESEM Kontext bereits geladen — ein Browser mit Cache
      // fordert eine referenzierte Datei unter Umstaenden gar nicht neu an,
      // die Anfragenzaehlung allein koennte ein Leck also uebersehen. Die
      // Dokumentpruefung traegt deshalb den Beweis (keine Referenz), die
      // Zaehlung bleibt als zusaetzlicher Riegel stehen.
      expect(kostenChunkAnfragen().length, "g: neue Kosten-Chunk-Anfragen").toBe(
        anfragenVorManipulation,
      );
      const inhalt = await seite.content();
      for (const datei of kostenChunks) {
        expect(inhalt, `g: ${datei} steht im Dokument`).not.toContain(datei);
      }
      bericht["g_manipulation"] = {
        cookie_wert: FREMDE_AUSWAHL,
        oberflaeche: "kosten-org-auswahl",
        chunk_anfragen_vorher: anfragenVorManipulation,
        chunk_anfragen_nachher: kostenChunkAnfragen().length,
      };
    });

    await test.step("h — ein KAPUTTER Selector-Cookie crasht nichts und oeffnet nichts", async () => {
      // PR-#99-Reviewbefund: `eyt_org=%` liess decodeURIComponent mit
      // URIError werfen — und die Kompositionswurzel liest den Selector beim
      // Client-Start, der Crash traefe also jede Seite. Fail-closed heisst
      // hier dreifach: keine unbehandelte Client-Ausnahme, die Flaeche bleibt
      // renderbar, und die Auswahl faellt in "Organisation waehlen" statt in
      // irgendeinen Kosteninhalt.
      // Gegenmutation: das try/catch um decodeURIComponent in
      // `lib/organisations-auswahl-cookie.ts` entfernen -> pageerror-Liste
      // nicht leer, dieser Schritt rot.
      const seitenfehler: string[] = [];
      seite.on("pageerror", (fehler) => seitenfehler.push(String(fehler)));
      const anfragenVorKaputt = kostenChunkAnfragen().length;
      await kontext.addCookies([{ name: "eyt_org", value: "%", url: new URL(seite.url()).origin }]);
      await seite.reload();

      await expect(seite.getByTestId("kosten-org-auswahl")).toBeVisible();
      await expect(seite.getByTestId("kosten-kein-snapshot")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-forbidden")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-laedt")).toHaveCount(0);
      await expect(seite.getByTestId("kosten-flaeche-laedt")).toHaveCount(0);
      expect(seitenfehler, "h: unbehandelte Client-Ausnahmen").toEqual([]);

      // Netz UND Dokument, aus demselben gemessenen Grund wie in (g).
      expect(kostenChunkAnfragen().length, "h: neue Kosten-Chunk-Anfragen").toBe(anfragenVorKaputt);
      const inhalt = await seite.content();
      for (const datei of kostenChunks) {
        expect(inhalt, `h: ${datei} steht im Dokument`).not.toContain(datei);
      }
      expect(inhalt, "h: Betrag im Dokument").not.toContain(ERWARTETER_BETRAG);
      expect(inhalt, "h: Kostenanzeige im Dokument").not.toContain(ERWARTETE_KOSTEN_ANZEIGE);
      bericht["h_kaputter_selector"] = {
        cookie_wert: "%",
        oberflaeche: "kosten-org-auswahl",
        seitenfehler: seitenfehler.length,
        chunk_anfragen_vorher: anfragenVorKaputt,
        chunk_anfragen_nachher: kostenChunkAnfragen().length,
      };
    });
  } catch (e) {
    fehlerAusFall = [e];
  }

  // Die Rueckgabe laeuft UNBEDINGT und ist idempotent — Wortlaut und
  // Rangfolge wie in 9c5/9g2. Eine ueberlebende Leihgabe machte Schritt 5
  // der Hauptreise ("genau eine Organisation") im naechsten Lauf rot-falsch
  // und ist damit der dringendere Befund.
  let fehlerAusRueckgabe: [unknown] | null = null;
  try {
    const aus = psqlMitMarker(
      verwaltung,
      join(HIER, "eyt113-zweitorg-aus.sql"),
      ["-v", `benutzer_a=${idA}`],
      "[eyt113-zweitorg-aus]",
    );
    console.log(`  ${aus}`);
    bericht["rueckgabe"] = aus;
  } catch (e) {
    fehlerAusRueckgabe = [e];
  }

  await kontext.close();

  if (fehlerAusRueckgabe !== null && fehlerAusFall !== null) {
    throw new AggregateError(
      [fehlerAusRueckgabe[0], fehlerAusFall[0]],
      "[auth-journey] EYT-113 I2: die Rueckgabe der geliehenen Zweitorganisation UND der " +
        "Mehr-Org-Nachweis sind gescheitert. Beide Fehler stehen in `errors`; die " +
        "ueberlebende Leihgabe ist der dringendere Befund.",
    );
  }
  if (fehlerAusRueckgabe !== null) throw fehlerAusRueckgabe[0];
  if (fehlerAusFall !== null) throw fehlerAusFall[0];
});
