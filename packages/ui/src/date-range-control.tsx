import type { ComponentType, ReactNode } from "react";

import { VisuallyHidden } from "./visually-hidden.js";

/**
 * Die Eigenschaften, die dieses Primitive an ein Link-Element weitergibt —
 * und damit der Vertrag, den eine injizierte Komponente erfuellen muss.
 */
export interface DateRangeLinkProps {
  href: string;
  className?: string | undefined;
  "aria-current"?: "page" | undefined;
  "data-testid"?: string | undefined;
  children: ReactNode;
}

/** Ein Ziel des Bereichswechsels — fertig aufgeloest, nie berechnet. */
export interface DateRangeAction {
  /** Zugaenglicher Name des Bedienelements. */
  readonly label: string;
  /** Die fertige Zieladresse. Dieses Paket setzt keine Adressen zusammen. */
  readonly href: string;
  /** Markiert das Ziel als aktuelle Seite (`aria-current="page"`). */
  readonly current?: boolean;
  readonly testId?: string;
}

export interface DateRangeControlProps {
  /** Zugaenglicher Name des Navigationsbereichs. */
  label: string;
  previous?: DateRangeAction;
  next?: DateRangeAction;
  /**
   * Der Rueckweg zum Bezugszeitraum. Bewusst PFLICHT: bleibt im reduzierten
   * Fall kein anderes Bedienelement stehen, waere die Leiste ohne ihn eine
   * Sackgasse.
   */
  reset: DateRangeAction;
  /** Sichtbare Beschriftung des Zeitraums. */
  rangeLabel?: string;
  /**
   * Kanonischer Schluessel — bleibt im Accessibility-Tree und im
   * `textContent`, steht aber nicht auf der Flaeche.
   */
  rangeKey?: string;
  /** Zweite Zeile, etwa der ausgeschriebene Zeitraum. */
  rangeDetail?: string;
  /**
   * TEXT, der den laufenden Zeitraum benennt. Basisdesign v2.0: ein Zustand
   * wird nie NUR ueber Farbe getragen — deshalb ein Wort und kein Farbwert.
   * `aria-current` auf dem Rueckweg ist die maschinenlesbare Zugabe, nicht der
   * Traeger.
   */
  currentMarker?: string;
  /**
   * Die `data-testid`-Werte sind Prop und nicht Literal. Zwei Gruende, beide
   * gemessen: `apps/web` nagelt `werkbank-woche-iso` und
   * `werkbank-woche-bereich` in Playwright und vier jsdom-Suiten fest, und
   * deutsches Fachvokabular fest in dieses Paket zu schreiben widerspraeche
   * seiner Domaenenfreiheit.
   */
  rangeLabelTestId?: string;
  rangeDetailTestId?: string;
  currentMarkerTestId?: string;
  testId?: string;
  /**
   * Das Element, das ein Ziel darstellt. Vorgabe ist `"a"`. Eine Anwendung mit
   * eigenem Router reicht hier ihre Link-Komponente herein — dieses Paket darf
   * keinen Router importieren (Regel `ui-dependency-allowlist`) und wuerde mit
   * einem festverdrahteten `<a>` in einer Next-App jede weiche Navigation zu
   * einem vollen Seitenwechsel machen.
   */
  linkComponent?: ComponentType<DateRangeLinkProps> | "a";
}

/**
 * Bedienleiste fuer einen Zeitraum: zurueck, Bezugszeitraum, vor — dazu
 * Beschriftung, Detailzeile und die Marke des laufenden Zeitraums.
 *
 * ## Dieses Primitive rechnet nicht, es zeigt
 *
 * Kein `new Date()`, keine Kalenderarithmetik, kein Wochenbegriff. Jede
 * Adresse und jeder Text kommt fertig herein. Der Grund ist nicht Geschmack:
 * eine Rechnung hier waere eine ZWEITE Zeitregel neben der der Anwendung, und
 * beide liefen genau an den Jahresgrenzen auseinander, an denen ein `± 1`
 * falsch ist (2026 hat 53 ISO-Wochen, 2025 und 2027 haben 52). Ein
 * Darstellungsfehler waere dann von einem Rechenfehler nicht mehr zu
 * unterscheiden. Getragen wird die Zusicherung von den Sentinels in
 * `test/date-range-control.test.tsx` und strukturell von
 * `ui-dependency-allowlist` — nicht von diesem Absatz.
 *
 * ## Abwesenheit heisst hier `undefined`, nicht `fehlt()`
 *
 * Der Geschwister-Rahmen `AppShell` prueft seine Slots mit `fehlt()` auf
 * `undefined | null | false`, weil `bedingung && <X/>` und
 * `bedingung ? <X/> : null` die Schreibweisen sind, mit denen eine Anwendung
 * einen ReactNode-SLOT weglaesst. Die optionalen Eigenschaften hier sind
 * dagegen DATEN — Zeichenketten und Objekte —, und dafuer ist `undefined` die
 * einzige natuerliche Abwesenheit. Ein `=== undefined` sagt deshalb genau, was
 * gemeint ist; eine Wahrheitspruefung verschluckte zusaetzlich `""` und machte
 * aus einem uebergebenen Wert stillschweigend eine Abwesenheit.
 *
 * ## Styling gehoert der Anwendung
 *
 * Das Paket vergibt nur `eyt-date-range*`-Klassen und liefert selbst kein
 * Stylesheet. Dass jede ausgegebene Klasse auch wirklich ausgegeben wird,
 * haelt der Fall „gibt alle sieben Klassennamen des Bedienbereichs aus" —
 * die Regeln im Stylesheet der Anwendung sehen diese Datei nicht, und eine
 * Umbenennung hier bliebe sonst lautlos.
 */
export function DateRangeControl({
  label,
  previous,
  next,
  reset,
  rangeLabel,
  rangeKey,
  rangeDetail,
  currentMarker,
  rangeLabelTestId,
  rangeDetailTestId,
  currentMarkerTestId,
  testId,
  linkComponent: Link = "a",
}: DateRangeControlProps): ReactNode {
  // `exactOptionalPropertyTypes` ist an: ein ausdrueckliches `undefined` ist
  // NICHT dasselbe wie eine fehlende Eigenschaft. Die bedingten Attribute
  // entstehen deshalb per Spread und werden nie als `undefined` uebergeben.
  const ziel = (aktion: DateRangeAction): ReactNode => (
    <Link
      href={aktion.href}
      className="eyt-date-range__action"
      {...(aktion.current === true ? { "aria-current": "page" as const } : {})}
      {...(aktion.testId === undefined ? {} : { "data-testid": aktion.testId })}
    >
      {aktion.label}
    </Link>
  );

  return (
    <nav
      aria-label={label}
      className="eyt-date-range"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {previous === undefined ? null : ziel(previous)}

      {rangeLabel === undefined ? null : (
        <p
          className="eyt-date-range__range"
          {...(rangeLabelTestId === undefined ? {} : { "data-testid": rangeLabelTestId })}
        >
          <span className="eyt-date-range__range-text">{rangeLabel}</span>{" "}
          {rangeKey === undefined ? null : (
            <VisuallyHidden className="eyt-date-range__range-key">{rangeKey}</VisuallyHidden>
          )}
        </p>
      )}
      {rangeDetail === undefined ? null : (
        <p
          className="eyt-date-range__detail"
          {...(rangeDetailTestId === undefined ? {} : { "data-testid": rangeDetailTestId })}
        >
          {rangeDetail}
        </p>
      )}
      {currentMarker === undefined ? null : (
        <p
          className="eyt-date-range__marker"
          {...(currentMarkerTestId === undefined ? {} : { "data-testid": currentMarkerTestId })}
        >
          {currentMarker}
        </p>
      )}

      {ziel(reset)}
      {next === undefined ? null : ziel(next)}
    </nav>
  );
}
