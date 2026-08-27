/**
 * `DateRangeControl` — blaettert, rechnet aber nicht (EYT-80).
 *
 * ## Jede Erwartung ist ein SENTINEL
 *
 * Dasselbe Muster wie in `apps/web/test/wochen-navigation.test.tsx`: die
 * Modelle tragen Werte, die keine Rechnung erzeugen kann. Steht der Sentinel
 * im DOM, hat das Primitive DURCHGEREICHT; rechnet es selbst, steht dort etwas
 * anderes und die Zusicherung faellt. Ein Test, der die erwartete Adresse
 * selbst zusammensetzt, prueft nur seine eigene Reimplementierung der
 * Zeitrechnung und bliebe gruen, wenn Primitive und Test denselben Fehler
 * machen.
 *
 * ## Warum die Sentinels asymmetrisch sind
 *
 * `previous`, `next` und `reset` sind gleich getypte Zeichenketten und damit
 * vertauschbar, ohne dass ein Typ es meldet. Drei unterscheidbare Werte plus
 * eine Zusicherung je Bedienelement machen jede Vertauschung sichtbar.
 *
 * ## Warum das Link-Element injiziert wird
 *
 * `@easytree/ui` darf keinen Router importieren (Regel
 * `ui-dependency-allowlist`), und ein festverdrahtetes `<a>` wuerde in einer
 * Next-App aus jeder weichen Navigation einen vollen Seitenwechsel machen. Der
 * Fall „benutzt die uebergebene Komponente statt eines nackten a" belegt, dass
 * die Injektion wirklich gelesen wird — sonst waere `linkComponent` eine
 * Zusage ohne Leser, und jede `href`-Zusicherung hier bliebe trotzdem gruen.
 *
 * ## Gegenmutationen (ausgefuehrt, 27.08.2026)
 *
 * 1. `href={aktion.href}` fuer `next` durch eine im Primitive gebaute Adresse
 *    `` `/planung?weekKey=${rangeKey}` `` ersetzen — also das Primitive rechnen
 *    lassen. „verlinkt vorwaerts …" wird rot und meldet
 *    `/planung?weekKey=SENTINEL-SCHLUESSEL` gegen `/x?k=SENTINEL-NACH`.
 * 2. `linkComponent` ignorieren und immer ein nacktes `<a>` rendern.
 *    „benutzt die uebergebene Komponente statt eines nackten a" wird rot.
 * 3. Ein zweites `<span>(Planstand 2026-W01)</span>` in das Bereichsfeld
 *    setzen. „zeigt Beschriftung und kanonischen Schluessel …" wird rot — die
 *    Zusicherung steht auf GLEICHHEIT, nicht auf Enthaltensein.
 * 4. Eine ausgegebene Klasse umbenennen. „gibt alle sieben Klassennamen …"
 *    wird rot und nennt die fehlende.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DateRangeControl } from "../src/index.js";

afterEach(cleanup);

const VOLL = {
  label: "SENTINEL-BEREICHSNAME",
  previous: { label: "Zurueck", href: "/x?k=SENTINEL-VOR", testId: "sentinel-vor" },
  next: { label: "Vor", href: "/x?k=SENTINEL-NACH", testId: "sentinel-nach" },
  reset: { label: "Anker", href: "/x?k=SENTINEL-ANKER", testId: "sentinel-anker" },
  rangeLabel: "SENTINEL-BESCHRIFTUNG",
  rangeKey: "SENTINEL-SCHLUESSEL",
  rangeDetail: "SENTINEL-DETAIL",
  rangeLabelTestId: "sentinel-bereich",
  rangeDetailTestId: "sentinel-detailfeld",
} as const;

/** Genau ein Bedienelement mit diesem zugaenglichen Namen — oder ein lauter Fehler. */
function element(name: string): HTMLElement {
  return screen.getByRole("link", { name });
}

describe("DateRangeControl — reicht durch, rechnet nicht", () => {
  it("verlinkt rueckwaerts auf genau die uebergebene Adresse", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(element("Zurueck").getAttribute("href")).toBe("/x?k=SENTINEL-VOR");
  });

  it("verlinkt vorwaerts auf genau die uebergebene Adresse", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(element("Vor").getAttribute("href")).toBe("/x?k=SENTINEL-NACH");
  });

  it("verlinkt den Rueckweg auf genau die uebergebene Adresse", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(element("Anker").getAttribute("href")).toBe("/x?k=SENTINEL-ANKER");
  });

  it("zeigt Beschriftung und kanonischen Schluessel unveraendert — als GANZEN Text", () => {
    render(<DateRangeControl {...VOLL} />);
    // Gleichheit, nicht Enthaltensein: mit `toContain` bliebe diese Zusicherung
    // gruen, wenn das Primitive eine ZWEITE, widersprechende Bereichsaussage in
    // dieselbe Flaeche setzte — genau die Regressionsform, die
    // `apps/web/test/wochen-navigation.test.tsx` am 19.08.2026 von `toContain`
    // auf `toBe` gezwungen hat (ein „Entwurf/veroeffentlicht"-Abzeichen im
    // selben Element).
    expect(screen.getByTestId("sentinel-bereich").textContent).toBe(
      "SENTINEL-BESCHRIFTUNG SENTINEL-SCHLUESSEL",
    );
  });

  it("haelt den kanonischen Schluessel im Accessibility-Tree, aber nicht auf der Flaeche", () => {
    render(<DateRangeControl {...VOLL} />);
    // Dieselben drei Eigenschaften, die `primitives.test.tsx` fuer
    // `VisuallyHidden` festnagelt: das Clip-Muster, NICHT `display: none` —
    // letzteres naehme den Schluessel auch assistiver Technik weg. Wird das
    // Geschwister-Primitive hier durch ein eigenes Versteck ersetzt, faellt
    // diese Zusicherung.
    const versteckt = screen.getByText("SENTINEL-SCHLUESSEL");
    expect(versteckt.style.position).toBe("absolute");
    expect(versteckt.style.width).toBe("1px");
    expect(versteckt.style.overflow).toBe("hidden");
  });

  it("zeigt den Detailtext unveraendert an", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(screen.getByTestId("sentinel-detailfeld").textContent).toBe("SENTINEL-DETAIL");
  });

  it("gibt dem Bereich einen eigenen zugaenglichen Namen", () => {
    render(<DateRangeControl {...VOLL} />);
    expect(screen.getByRole("navigation", { name: "SENTINEL-BEREICHSNAME" })).toBeTruthy();
  });

  it("traegt genau ein Bedienelement je Richtung", () => {
    render(<DateRangeControl {...VOLL} />);
    for (const name of ["Zurueck", "Vor", "Anker"]) {
      expect(screen.getAllByRole("link", { name })).toHaveLength(1);
    }
  });

  it("gibt alle sieben Klassennamen des Bedienbereichs aus", () => {
    /*
     * Die EMITTER-Seite der Kopplung, und nur sie: dieses Paket VERGIBT die
     * Namen, das Stylesheet der aufrufenden Anwendung haengt seine Regeln
     * daran. Keine der beiden Haelften sieht die andere — eine Umbenennung
     * HIER laesst jede Regel dort unberuehrt stehen.
     *
     * Gemessen am Geschwister-Rahmen (27.08.2026): `.eyt-app-shell__footer`
     * war von gar nichts gehalten; sie umzubenennen liess beide Suiten
     * byte-gleich, waehrend die Anwendung ihre Polsterung verlor. Die Luecke
     * ist keine Eigenschaft der Fusszeile, sondern des Musters — deshalb hier
     * alle sieben und nicht die eine, die zufaellig anderswo vorkommt.
     */
    const { container } = render(
      <DateRangeControl
        {...VOLL}
        currentMarker="SENTINEL-MARKE"
        currentMarkerTestId="sentinel-marke"
        testId="sentinel-bereichsleiste"
      />,
    );
    for (const klasse of [
      "eyt-date-range",
      "eyt-date-range__action",
      "eyt-date-range__range",
      "eyt-date-range__range-text",
      "eyt-date-range__range-key",
      "eyt-date-range__detail",
      "eyt-date-range__marker",
    ]) {
      expect(
        container.querySelector(`.${klasse}`),
        `.${klasse} wird nicht mehr ausgegeben`,
      ).not.toBeNull();
    }
  });
});

describe("DateRangeControl — der Zustand steht im TEXT, nicht in der Farbe", () => {
  it("nennt den laufenden Bereich im Klartext und setzt aria-current", () => {
    render(
      <DateRangeControl
        {...VOLL}
        currentMarker="SENTINEL-MARKE"
        currentMarkerTestId="sentinel-marke"
        reset={{ ...VOLL.reset, current: true }}
      />,
    );
    // Basisdesign v2.0 / `AC-018`: ein Zustand darf nie NUR ueber Farbe
    // getragen werden. Der TEXT ist der Traeger, `aria-current` die
    // maschinenlesbare Zugabe — nicht umgekehrt.
    expect(screen.getByTestId("sentinel-marke").textContent).toBe("SENTINEL-MARKE");
    expect(element("Anker").getAttribute("aria-current")).toBe("page");
  });

  it("nennt ihn nicht, wenn kein Marker uebergeben wurde", () => {
    render(<DateRangeControl {...VOLL} currentMarkerTestId="sentinel-marke" />);
    expect(screen.queryByTestId("sentinel-marke")).toBeNull();
    expect(element("Anker").getAttribute("aria-current")).toBeNull();
  });
});

describe("DateRangeControl — der reduzierte Fall ist keine Sackgasse", () => {
  it("laesst genau den Rueckweg stehen, wenn es keine Nachbarn und keinen Bereich gibt", () => {
    render(
      <DateRangeControl
        label={VOLL.label}
        reset={VOLL.reset}
        rangeLabelTestId="sentinel-bereich"
      />,
    );
    expect(element("Anker").getAttribute("href")).toBe("/x?k=SENTINEL-ANKER");
    expect(screen.queryByRole("link", { name: "Zurueck" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Vor" })).toBeNull();
    // Ohne Beschriftung entsteht das Feld gar nicht erst — ein vorhandenes,
    // leeres Feld mit testid waere fuer jede Abwesenheitszusicherung ein
    // falsches Gruen: `queryByTestId` faende es, und die aufrufende Anwendung
    // zeigte eine leere Bereichsangabe.
    expect(screen.queryByTestId("sentinel-bereich")).toBeNull();
  });
});

describe("DateRangeControl — das Link-Element ist injizierbar", () => {
  it("benutzt die uebergebene Komponente statt eines nackten a", () => {
    // Ohne diese Zusicherung koennte `linkComponent` stillschweigend ignoriert
    // werden: die href-Zusicherungen oben blieben gruen, und in der echten App
    // wuerde aus jeder weichen Navigation ein voller Seitenwechsel.
    function Marker(eigenschaften: { href: string; children: ReactNode }): ReactNode {
      return (
        <a data-injiziert="ja" href={eigenschaften.href}>
          {eigenschaften.children}
        </a>
      );
    }
    render(<DateRangeControl {...VOLL} linkComponent={Marker} />);
    expect(element("Vor").getAttribute("data-injiziert")).toBe("ja");
  });
});
