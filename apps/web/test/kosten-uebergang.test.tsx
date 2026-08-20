/**
 * REQ-006 / AC-010, AC-011 — der Kostenuebergang als Teil der PLANUNGSFLAECHE
 * (EYT-140, Plan-Meilenstein `M8`, `docs/plans/2026-08-18-eyt-140-planungswerkbank.md:714`).
 *
 * ## Warum es diese Datei ueberhaupt gibt
 *
 * `werkbank-publish-und-kosten.test.tsx` nimmt REQ-006 ab, sucht dabei aber mit
 * `screen.findByTestId(...)` DOKUMENTWEIT — und `apps/web/test/helpers/werkbank.tsx`
 * rendert `<Providers><AppShell>…</AppShell></Providers>`, die Shell liegt also im
 * selben Suchraum. Der Review vom 19.08.2026 hat gemessen: verlegt man den
 * Uebergang komplett nach `app-shell.tsx` und entfernt ihn aus
 * `planung-ansicht.tsx`, blieben **21/21 Dateien und 245/245 Tests gruen** —
 * der Abnahmevertrag merkt die Verlegung nicht. Fuenf Zusicherungen fehlten
 * damit; diese Datei traegt sie nach, ohne den Vertrag anzufassen.
 *
 * | Hier gemessen                                       | ohne diese Datei gruen bei …                       |
 * | --------------------------------------------------- | -------------------------------------------------- |
 * | Uebergang liegt IN der Planungsflaeche               | Verlegung komplett nach `app-shell.tsx`            |
 * | Rechtefrage wird nur an einer Stelle gestellt        | zweitem `useSession` im Uebergang                  |
 * | Wochenbezug stammt aus der Adresse                   | fester Konstante `1999-W01` statt `weekKey`        |
 * | Ziel ist genau `/kosten`                             | `href="/kostenstelle-gibt-es-nicht"`               |
 * | kein Kostenaufruf AUCH MIT `costs.read`              | Snapshot-Abruf „gibt es ueberhaupt Kosten?"        |
 *
 * ## Warum `within(screen.getByRole("main"))` nicht genuegt
 *
 * `AppShell` rendert selbst ein `<main id="hauptinhalt">`, und `app/planung/page.tsx`
 * rendert ein zweites darin. `getByRole("main")` findet also zwei Elemente und
 * wuerde werfen; `getAllByRole` liesse offen, welches gemeint ist. Der Anker ist
 * deshalb `data-testid="werkbank-planungsflaeche"` — und er wird in jeder
 * Zusicherung erst an den Wochenschluessel gebunden, damit er nicht auf ein
 * beliebiges Element wandern kann. (Befund am Rande, hier NICHT behoben: zwei
 * ineinander geschachtelte `<main>` sind nach HTML5 unzulaessig — `main` darf
 * keinen `main`-Vorfahren haben. Das ist aelter als dieser Meilenstein und
 * gehoert in einen eigenen Vorgang.)
 *
 * ## Was hier NICHT geprueft wird
 *
 * Der Serverpfad. `costs.read` wird serverseitig in `cost-access.policy.ts`
 * durchgesetzt und von `db-gates` · `[cost-access]` belegt; dass HTML- und
 * RSC-Antwort ohne das Recht keine Kostenwerte tragen, ist eine Server-Aussage
 * und gehoert nach `auth-journey`. jsdom kann beides nicht.
 *
 * ## Gegenmutationen — ausgefuehrt, gemessen, zurueckgenommen (19.08.2026)
 *
 * 1. Uebergang komplett nach `app-shell.tsx` verlegt, aus `planung-ansicht.tsx`
 *    entfernt → „legt den Uebergang IN die Planungsflaeche" rot.
 * 2. In `kosten-uebergang.tsx` `weekKey` ignoriert, `1999-W01` fest gesetzt →
 *    „nennt die Woche aus der Adresse" rot.
 * 3. `href="/kostenstelle-gibt-es-nicht"` → „verweist auf genau `/kosten`" rot.
 * 4. Im Uebergang ein `useCostsGateway().snapshot(...)` beim Einhaengen →
 *    „ruft auch MIT `costs.read` keine Kostenroute" rot.
 * 5. `import { useSession } from "../lib/session-provider";` im Uebergang →
 *    „stellt die Rechtefrage nicht selbst" rot.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationZuruecksetzen } from "./helpers/navigation-attrappe";
import { netzLoesen, werkbankRendern, type Netzprotokoll } from "./helpers/werkbank";
import { fensterMitEntwurf, sitzungMit } from "./helpers/werkbank-daten";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

/** Mittwoch der ISO-Woche 2026-W34 — dieselbe Uhr wie im Abnahmevertrag. */
const MITTWOCH_KW34 = new Date("2026-08-19T12:00:00.000Z");
const LAUFENDE_WOCHE = "2026-W34";
/** Bewusst NICHT die laufende Woche: nur so trennt der Test Prop von Uhr. */
const ANDERE_WOCHE = "2026-W35";

const PLANUNGSRECHTE = ["planning.read", "planning.write", "planning.publish"];
const MIT_KOSTEN = [...PLANUNGSRECHTE, "costs.read"];

/** Testlauf-cwd ist das Paketverzeichnis `apps/web` (Muster: `no-supabase-import.test.ts`). */
const UEBERGANG_QUELLE = join(process.cwd(), "components", "kosten-uebergang.tsx");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MITTWOCH_KW34);
  navigationZuruecksetzen();
});

afterEach(() => {
  cleanup();
  netzLoesen();
  vi.useRealTimers();
});

function werkbankMitRechten(rechte: readonly string[], anfangsSuche = ""): Netzprotokoll {
  return werkbankRendern(
    {
      sitzung: sitzungMit(rechte),
      fenster: (weekKey) => fensterMitEntwurf(weekKey),
    },
    anfangsSuche,
  );
}

/** Die Planungsflaeche — und der Beleg, dass der Anker wirklich sie ist. */
function planungsflaeche(): HTMLElement {
  const flaeche = screen.getByTestId("werkbank-planungsflaeche");
  // Ohne diese Bindung koennte der Anker auf der Shell sitzen und die
  // Containment-Zusicherung waere wieder dokumentweit.
  expect(within(flaeche).getByTestId("werkbank-woche-iso")).toBeTruthy();
  return flaeche;
}

describe("REQ-006 / AC-010 — der Uebergang ist Teil der Planungsflaeche", () => {
  it("legt den Uebergang IN die Planungsflaeche, die Hauptnavigation bleibt ausserhalb", async () => {
    werkbankMitRechten(MIT_KOSTEN);
    await screen.findByTestId("werkbank-woche-iso");

    await waitFor(() =>
      expect(within(planungsflaeche()).queryByTestId("werkbank-kostenuebergang")).not.toBeNull(),
    );

    // Gegenprobe, dass die Einschraenkung ueberhaupt wirkt: den Navigationspunkt
    // „Kosten" gibt es, er liegt aber NICHT in der Flaeche. Faende `within(...)`
    // in Wahrheit das ganze Dokument ab, waere diese Zeile rot.
    const navPunkt = screen.getByRole("link", { name: "Kosten" });
    expect(planungsflaeche().contains(navPunkt)).toBe(false);
  });

  it("stellt die Rechtefrage nicht selbst — der Uebergang haengt an nichts als Link und Karte", () => {
    const quelle = readFileSync(UEBERGANG_QUELLE, "utf8");

    // Nicht vakuum: die gelesene Datei muss der gemessene Uebergang sein.
    expect(quelle).toContain('data-testid="werkbank-kostenuebergang"');

    // Gelesen werden die IMPORTE, nicht der Rohtext: ein Kommentar, der
    // `useSession` erwaehnt, darf diese Zusicherung nicht faerben — und eine
    // zweite Autorisierungslogik kann sich nicht in einem Kommentar verstecken.
    const importe = [...quelle.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map(
      (treffer) => treffer[1],
    );
    expect(importe).toEqual(["next/link", "@easytree/ui"]);
  });
});

describe("REQ-006 / AC-010 — Ziel und Wochenbezug sind benannt, nicht ungefaehr", () => {
  it("verweist auf genau `/kosten` — ein Praefixvergleich liesse eine getippte Route durch", async () => {
    werkbankMitRechten(MIT_KOSTEN);
    const uebergang = await screen.findByTestId("werkbank-kostenuebergang");

    expect(uebergang.getAttribute("href")).toBe("/kosten");
  });

  it("nennt die Woche aus der Adresse, nicht eine feste und nicht die der Uhr", async () => {
    werkbankMitRechten(MIT_KOSTEN, `?weekKey=${ANDERE_WOCHE}`);
    await screen.findByTestId("werkbank-woche-iso");

    const karte = await screen.findByTestId("werkbank-kostenuebergang-karte");
    const text = karte.textContent ?? "";

    expect(text).toContain(ANDERE_WOCHE);
    // Die Uhr steht auf 2026-W34. Staende die hier, waere der Wochenbezug nicht
    // aus der Adresse abgeleitet, sondern nebenher erfunden.
    expect(text).not.toContain(LAUFENDE_WOCHE);
  });
});

describe("REQ-006 / AC-011 — der Uebergang fragt keine Kosten ab", () => {
  it("ruft AUCH MIT costs.read keine Kostenroute — er ist ein Verweis, keine Abfrage", async () => {
    const netz = werkbankMitRechten(MIT_KOSTEN);
    await screen.findByTestId("werkbank-kostenuebergang");
    // Ein Effekt, der beim Einhaengen laedt, waere zu diesem Zeitpunkt bereits
    // abgesetzt; die Runde Ereignisschleife deckt zusaetzlich den Fall ab, dass
    // er erst nach dem ersten Anstrich faellt. `toFake: ["Date"]` laesst
    // `setTimeout` echt.
    await new Promise((aufloesen) => setTimeout(aufloesen, 0));

    expect(
      netz.aufrufe.filter((a) => a.pfad.startsWith("/api/v1/kosten")).map((a) => a.pfad),
    ).toEqual([]);
    // Nicht vakuum: ueber dieselbe Grenze gingen sehr wohl Aufrufe.
    expect(netz.aufrufe.length).toBeGreaterThan(0);
  });

  it("liefert ohne costs.read weder die Testid noch die Adresse im MARKUP", async () => {
    // Das Fertigkriterium aus `M8`: geprueft wird das ausgelieferte Markup, nicht
    // die Sichtbarkeit — ein `display:none`-Waechter truege den Verweis mit aus.
    werkbankMitRechten(PLANUNGSRECHTE);
    await screen.findByTestId("werkbank-woche-iso");
    await waitFor(() => expect(screen.queryByTestId("planungsfenster-stand")).not.toBeNull());

    const markup = document.body.innerHTML;
    expect(markup).not.toContain("werkbank-kostenuebergang");
    expect(markup).not.toContain("/kosten");
  });
});
