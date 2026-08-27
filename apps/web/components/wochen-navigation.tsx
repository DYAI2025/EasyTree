/**
 * Wochennavigation der Planungswerkbank (EYT-140 M4, `REQ-002` / `AC-004`).
 *
 * ## Diese Komponente rechnet nicht, sie zeigt
 *
 * Sie bekommt das fertige Modell aus `lib/wochennavigation.ts` als Prop: kein
 * `new Date()`, kein `shiftPlanningWeek`, kein `parseIsoWeekKey`. Der Grund ist
 * nicht Geschmack. Eine Wochenrechnung in der Darstellung waere die ZWEITE
 * Wochenregel neben der in `lib/wochennavigation.ts`, und die beiden wuerden
 * genau an den Jahresgrenzen auseinanderlaufen, an denen ein `isoWeek ± 1`
 * falsch ist (2026 hat 53 ISO-Wochen, 2025 und 2027 haben 52). Ein
 * Darstellungsfehler waere dann von einem Rechenfehler nicht mehr zu
 * unterscheiden.
 *
 * Getragen wird diese Zusicherung von den SENTINELS in
 * `test/wochen-navigation.test.tsx`, nicht von einem Namensvergleich auf dem
 * Quelltext. Bis zum 19.08.2026 stand hier ein statischer Waechter, der genau
 * die drei oben genannten Namen zaehlte — er ist ersatzlos entfallen, weil
 * gemessen wurde, dass er nichts haelt: `new Date (Date.now())` mit einem
 * einzigen zusaetzlichen Leerzeichen laesst ihn gruen, und eine selbst gebaute
 * `naechsteWoche()` ohne einen der drei Namen ebenfalls. Beide Male schlugen
 * stattdessen die Sentinels an. Die Kosten trug dieser Dateikopf: er durfte die
 * drei Namen nicht schreiben, weil der Waechter seine eigene Beschreibung
 * mitgezaehlt haette. Diese Einschraenkung ist damit aufgehoben.
 *
 * ## Was hier noch steht, ist die UEBERSETZUNG (EYT-80)
 *
 * Die Darstellung selbst liegt seit EYT-80 in `@easytree/ui` als
 * `DateRangeControl` — ein domaenenfreier Bedienbereich fuer einen Zeitraum,
 * der keinen Wochenbegriff kennt. Was in dieser Datei bleibt, ist genau die
 * Uebersetzung des Wochenmodells in dieses Primitive: die Beschriftungen
 * („Vorherige Woche", „Heute", „Nächste Woche", „Aktuelle Woche"), die sechs
 * `data-testid`-Werte und der Link-Adapter. Es kommt keine Rechnung dazu und
 * es faellt keine weg — die Adressen und Texte werden unveraendert
 * durchgereicht.
 *
 * Die Zusicherung „rechnet nicht" wird dadurch ZWEIFACH getragen. Erstens
 * weiterhin von den Sentinels in `test/wochen-navigation.test.tsx`: steht dort
 * `SENTINEL-NACH` im DOM, wurde durchgereicht. Zweitens jetzt auch
 * STRUKTURELL, denn die Regel `ui-dependency-allowlist` in
 * `apps/api/test/architecture.test.ts` laesst unter `packages/ui/src/` nur
 * `react` und paketinterne relative Pfade zu — das Primitive kann `@easytree/
 * domain`, `@easytree/contracts` und `next/navigation` gar nicht importieren
 * und hat damit keinen Zugang zu einer Kalenderrechnung. Die zweite Haelfte
 * kostet nichts und faellt bei jeder Umgehung sofort auf.
 *
 * ## Warum `Link` und nicht `router.push`
 *
 * Ein `<a href>` ist mit der Tastatur bedienbar, im Kontextmenue teilbar und
 * hat auch ohne JavaScript ein Ziel. `AC-019` (Tastaturbedienung) faellt damit
 * ohne Zusatzarbeit an; eine Schaltflaeche mit `onClick` muesste Fokus,
 * Enter/Space und „Link kopieren" nachbauen. Ausserdem traegt die Adresse den
 * Zustand (Entwurfsentscheidung `E1`): Neuladen und ein zweiter Browserkontext
 * zeigen dieselbe Woche.
 *
 * ## Der Wochenschluessel steht im Text, aber nicht auf der Flaeche
 *
 * Der Abnahmevertrag verlangt den kanonischen Schluessel im `textContent` von
 * `werkbank-woche-iso` — er ist das, was in der Adresse steht und was geteilt
 * wird. Sichtbar hingestellt widerspraeche er dem Inkrement selbst: „die
 * Planerin blaettert OHNE technischen Parameter". `VisuallyHidden` loest beides
 * zugleich — der Schluessel bleibt im Accessibility-Tree und im `textContent`,
 * die Flaeche zeigt „KW 34 · 2026". Das Verstecken macht das Primitive, sobald
 * `rangeKey` gesetzt ist.
 *
 * ## Der Fehlerfall ist keine Sackgasse
 *
 * Traegt das Modell `art: "fehlerhaft"`, bleibt genau ein Bedienelement uebrig:
 * der Rueckweg „Heute". Woche und Zeitraum fehlen dann bewusst — es gibt keine
 * darstellbare Woche, und eine ersatzweise angezeigte waere die schlimmere
 * Variante (`E2`): die Planerin saehe eine plausible Woche, aber nicht die, die
 * sie angefordert hat. Welchen Text die Seite zum Grund schreibt, entscheidet
 * `app/planung/page.tsx`; diese Komponente kennt den Grund nicht. Im Primitive
 * ist `reset` genau deshalb PFLICHT und alles andere optional.
 *
 * ## Die laufende Woche ist ueber TEXT kenntlich
 *
 * `AC-018` verlangt, dass ein Zustand nie nur ueber Farbe getragen wird.
 * „Aktuelle Woche" steht deshalb als Wort da; `aria-current="page"` auf dem
 * Rueckweg ist die maschinenlesbare Zugabe, nicht der Traeger. Im Primitive
 * sind das ZWEI getrennte Eingaenge — `currentMarker` und `reset.current` —,
 * hier speist beide dasselbe `modell.istAktuelleWoche`. Auseinanderlaufen
 * koennen sie trotzdem, deshalb sichert der Abnahmevertrag beide Haelften in
 * derselben Zusicherung.
 */
import { DateRangeControl, type DateRangeLinkProps } from "@easytree/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Wochenmodell } from "../lib/wochennavigation";

/**
 * Der Adapter auf `next/link`. `@easytree/ui` darf keinen Router importieren
 * (Regel `ui-dependency-allowlist`), also reicht die Anwendung ihr Link-
 * Element herein.
 *
 * Bewusst ein Adapter und nicht `linkComponent={Link}` direkt: `next/link`
 * nimmt `href: Url` — also auch ein Objekt — und ist damit WEITER als der
 * Vertrag `DateRangeLinkProps` mit `href: string`. Ob TypeScript die direkte
 * Zuweisung akzeptiert, haengt an der Varianz der Prop-Typen und zeigte sich
 * erst im `typecheck`. Fuenf Zeilen sind billiger als diese Wette.
 */
function WochenLink({ children, ...rest }: DateRangeLinkProps): ReactNode {
  return <Link {...rest}>{children}</Link>;
}

export function WochenNavigation({ modell }: { modell: Wochenmodell }) {
  if (modell.art === "fehlerhaft") {
    return (
      <DateRangeControl
        label="Wochennavigation"
        testId="wochennavigation"
        linkComponent={WochenLink}
        reset={{ label: "Heute", href: modell.heuteUrl, testId: "wochennavigation-heute" }}
      />
    );
  }

  // `exactOptionalPropertyTypes` ist an: ein ausdrueckliches `undefined` ist
  // NICHT dasselbe wie eine fehlende Eigenschaft. `current` und `currentMarker`
  // entstehen deshalb per Spread und werden nie als `undefined` uebergeben.
  const laufend = modell.istAktuelleWoche;

  return (
    <DateRangeControl
      label="Wochennavigation"
      testId="wochennavigation"
      linkComponent={WochenLink}
      previous={{
        label: "Vorherige Woche",
        href: modell.vorherigeUrl,
        testId: "wochennavigation-vorherige",
      }}
      next={{
        label: "Nächste Woche",
        href: modell.naechsteUrl,
        testId: "wochennavigation-naechste",
      }}
      reset={{
        label: "Heute",
        href: modell.heuteUrl,
        testId: "wochennavigation-heute",
        ...(laufend ? { current: true } : {}),
      }}
      rangeLabel={modell.isoWochenText}
      rangeKey={modell.schluessel}
      rangeDetail={modell.zeitraumText}
      rangeLabelTestId="werkbank-woche-iso"
      rangeDetailTestId="werkbank-woche-bereich"
      currentMarkerTestId="wochennavigation-aktuell"
      {...(laufend ? { currentMarker: "Aktuelle Woche" } : {})}
    />
  );
}
