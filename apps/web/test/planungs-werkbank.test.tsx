/**
 * `AC-003` / `AC-004` — der Werkbankrahmen um die Planung
 * (EYT-140, Plan-Meilenstein `M6`, `docs/plans/2026-08-18-eyt-140-planungswerkbank.md:638`).
 *
 * ## Was diese Datei misst — und was die bestehenden Vertraege schon tragen
 *
 * Woche, Zeitraum und Navigation selbst sind bereits abgenommen:
 * `wochennavigation.test.tsx` (Abnahmevertrag, vor der Implementierung
 * geschrieben) misst die RECHNUNG, `wochen-navigation.test.tsx` die ANZEIGE der
 * fertigen Modellwerte. Beide rendern die Navigation fuer sich.
 *
 * Was dort NICHT gemessen werden kann, ist die KOMPOSITION: dass die Planerin
 * auf `/planung` einen zusammenhaengenden Arbeitsplatz vorfindet statt drei
 * lose untereinandergesetzte Bausteine. Genau das steht hier, und nur das:
 *
 * | Hier gemessen                                             | ohne diese Datei gruen bei …                                   |
 * | --------------------------------------------------------- | -------------------------------------------------------------- |
 * | Kopf, Navigation und Planungsfenster in EINER Flaeche      | Kopf in der Shell, Navigation daneben, Fenster darunter         |
 * | Reihenfolge Kopf → Navigation → Planungsfenster            | Navigation unter dem Wochenplan, Kopf am Seitenende             |
 * | Der Kopf nennt Woche UND vollstaendigen Zeitraum           | `<h1>Planung</h1>` ohne jeden Wochenbezug (Stand vor `M6`)      |
 * | Der Wochenbezug stammt aus der Adresse, nicht aus der Uhr  | im Kopf fest die laufende Woche berechnen                       |
 * | GENAU ein primaer ausgezeichneter CTA in der Flaeche       | zweitem `PrimaryAction`; keinem                                 |
 * | Der Rahmen traegt auch den Fehlerfall                      | Rahmen nur im Erfolgszweig, Fehlerhinweis nackt daneben         |
 *
 * ## Warum der CTA ueber `.eyt-primary-action` gezaehlt wird
 *
 * Der Plan schreibt `getAllByTestId("primaeraktion")`. Das ist so nicht
 * baubar, ohne eine bestehende Zusicherung zu beschaedigen: die einzige
 * primaere Aktion der Flaeche ist die Veroeffentlichung, und ihr Element
 * traegt bereits `data-testid="planung-veroeffentlichen"` — ein Element hat
 * genau EIN `data-testid`, und der bestehende darf nicht umbenannt werden
 * (Playwright-Reisen haengen daran, `B5`). Gezaehlt wird deshalb die
 * Auszeichnung, die der Produktivcode ohnehin vergibt: `PrimaryAction` aus
 * `@easytree/ui` setzt `.eyt-primary-action` und existiert laut eigenem
 * Dateikopf genau dafuer, dass „einer pro Ansicht" sichtbar bleibt. Gezaehlt
 * statt besichtigt bleibt es damit trotzdem.
 *
 * ## Was hier NICHT geprueft wird
 *
 * Aussehen. Ob der Rahmen gut aussieht, entscheidet kein jsdom-Test; er
 * entscheidet, ob die Teile ueberhaupt zueinander gehoeren. Und der
 * Serverpfad — der gehoert nach `read-through` und `auth-journey`.
 *
 * ## Gegenmutationen — ausgefuehrt, gemessen, zurueckgenommen (19.08.2026)
 *
 * 1. Im Kopf den Wochenbezug entfernen (fester Titel `Planung`, keine
 *    Beschreibung) → „nennt die Woche aus der Adresse …" rot.
 * 2. In `planning-publish-action.tsx` `PrimaryAction` durch `Button` ersetzt
 *    (`data-testid` unveraendert) → „traegt genau EINEN …" rot mit `0`.
 * 3. In `planungs-werkbank.tsx` eine zweite `PrimaryAction` ergaenzt →
 *    dieselbe Zusicherung rot mit `2`.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationZuruecksetzen } from "./helpers/navigation-attrappe";
import { netzLoesen, werkbankRendern, type Netzprotokoll } from "./helpers/werkbank";
import { fensterMitEntwurf, sitzungMit } from "./helpers/werkbank-daten";

vi.mock("next/navigation", async () => {
  const modul = await import("./helpers/navigation-attrappe");
  return modul.nextNavigationModul();
});

/** Mittwoch der ISO-Woche 2026-W34 — dieselbe Uhr wie in den uebrigen Werkbanktests. */
const MITTWOCH_KW34 = new Date("2026-08-19T12:00:00.000Z");
/** Die Woche der Uhr. Steht sie im Kopf, obwohl eine andere angefragt war, ist der Bezug erfunden. */
const UHRWOCHE_TEXT = "KW 34";
/** Bewusst NICHT die laufende Woche: nur so trennt der Test Adresse von Uhr. */
const ANDERE_WOCHE = "2026-W35";
const ANDERE_WOCHE_TEXT = "KW 35 · 2026";
const ANDERE_WOCHE_MONTAG = "24.08.2026";
const ANDERE_WOCHE_SONNTAG = "30.08.2026";

const PLANUNGSRECHTE = ["planning.read", "planning.write", "planning.publish"];

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

function werkbank(anfangsSuche = "", rechte: readonly string[] = PLANUNGSRECHTE): Netzprotokoll {
  return werkbankRendern(
    {
      sitzung: sitzungMit(rechte),
      fenster: (weekKey) => fensterMitEntwurf(weekKey),
    },
    anfangsSuche,
  );
}

/**
 * Die Planungsflaeche — und der Beleg, dass der Anker wirklich sie ist.
 *
 * Dieselbe Bindung wie in `kosten-uebergang.test.tsx`: ohne sie koennte der
 * Anker auf der Shell sitzen und jede Containment-Zusicherung waere in
 * Wahrheit wieder dokumentweit.
 */
function planungsflaeche(): HTMLElement {
  const flaeche = screen.getByTestId("werkbank-planungsflaeche");
  expect(within(flaeche).getByTestId("wochennavigation")).toBeTruthy();
  return flaeche;
}

/** `true`, wenn `frueher` im Dokument VOR `spaeter` steht. */
function stehtVor(frueher: Node, spaeter: Node): boolean {
  return (frueher.compareDocumentPosition(spaeter) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("AC-003 / AC-004 — die Planung ist EIN Arbeitsplatz, nicht drei Bausteine", () => {
  it("fasst Kopf, Wochennavigation und Planungsfenster in derselben Flaeche zusammen", async () => {
    werkbank();
    await screen.findByTestId("werkbank-woche-iso");
    await waitFor(() => expect(screen.queryByTestId("planungsfenster-stand")).not.toBeNull());

    const flaeche = planungsflaeche();
    const kopf = within(flaeche).getByTestId("werkbank-kopf");
    const navigation = within(flaeche).getByTestId("wochennavigation");
    const fenster = within(flaeche).getByTestId("planungsfenster-stand");

    // Gegenprobe, dass die Einschraenkung ueberhaupt wirkt: die Hauptnavigation
    // der Shell gibt es, sie liegt aber NICHT in der Flaeche. Faende
    // `within(...)` in Wahrheit das ganze Dokument ab, waere diese Zeile rot.
    expect(flaeche.contains(screen.getByRole("link", { name: "Start" }))).toBe(false);

    // Der Rahmen ist eine REIHENFOLGE, keine Menge: ein Kopf unter dem
    // Wochenplan beantwortete „welche Woche plane ich" erst, nachdem die
    // Planerin sie schon gelesen hat.
    expect(stehtVor(kopf, navigation)).toBe(true);
    expect(stehtVor(navigation, fenster)).toBe(true);
  });

  it("nennt im Kopf die Woche aus der Adresse samt vollstaendigem Zeitraum — nicht die der Uhr", async () => {
    werkbank(`?weekKey=${ANDERE_WOCHE}`);
    await screen.findByTestId("werkbank-woche-iso");

    const kopf = within(planungsflaeche()).getByTestId("werkbank-kopf");
    const ueberschrift = within(kopf).getByRole("heading", { level: 1 });
    const kopftext = kopf.textContent ?? "";

    // Welche Woche geplant wird — in der Ueberschrift, nicht irgendwo.
    expect(ueberschrift.textContent ?? "").toContain(ANDERE_WOCHE_TEXT);
    // Der VOLLSTAENDIGE Datumsbereich, beide Grenztage benannt (`AC-003`).
    expect(kopftext).toContain(ANDERE_WOCHE_MONTAG);
    expect(kopftext).toContain(ANDERE_WOCHE_SONNTAG);
    // Die Uhr steht auf KW 34. Staende sie hier, waere der Wochenbezug nicht
    // aus der Adresse abgeleitet, sondern nebenher erfunden.
    expect(kopftext).not.toContain(UHRWOCHE_TEXT);
  });

  it("traegt in der Flaeche GENAU EINEN als primaer ausgezeichneten CTA", async () => {
    werkbank();
    await screen.findByTestId("werkbank-woche-iso");
    // Die Veroeffentlichung ist die primaere Aktion; ohne sie waere die Zahl
    // trivial null und die Zusicherung sagte nichts.
    await screen.findByTestId("planung-veroeffentlichen");

    const primaer = [...planungsflaeche().querySelectorAll(".eyt-primary-action")];

    expect(primaer).toHaveLength(1);
    // Und es ist die Aktion, die wir meinen — sonst waere „genau einer" auch
    // mit einem falschen Element erfuellt.
    expect(primaer[0]?.getAttribute("data-testid")).toBe("planung-veroeffentlichen");
  });

  it("haelt den Rahmen auch bei unbrauchbarem Parameter — der Fehler steht IN der Flaeche", async () => {
    werkbank("?weekKey=nicht-brauchbar");
    await screen.findByTestId("planungsfenster-parameterfehler");

    const flaeche = planungsflaeche();
    const kopf = within(flaeche).getByTestId("werkbank-kopf");

    expect(within(kopf).getByRole("heading", { level: 1 }).textContent ?? "").toContain("Planung");
    expect(within(flaeche).getByTestId("planungsfenster-parameterfehler")).toBeTruthy();
    // Ohne darstellbare Woche wird auch keine behauptet (`E2`).
    expect(kopf.textContent ?? "").not.toContain(UHRWOCHE_TEXT);
  });
});
