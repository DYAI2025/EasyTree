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
 * die Flaeche zeigt „KW 34 · 2026".
 *
 * ## Der Fehlerfall ist keine Sackgasse
 *
 * Traegt das Modell `art: "fehlerhaft"`, bleibt genau ein Bedienelement uebrig:
 * der Rueckweg „Heute". Woche und Zeitraum fehlen dann bewusst — es gibt keine
 * darstellbare Woche, und eine ersatzweise angezeigte waere die schlimmere
 * Variante (`E2`): die Planerin saehe eine plausible Woche, aber nicht die, die
 * sie angefordert hat. Welchen Text die Seite zum Grund schreibt, entscheidet
 * `app/planung/page.tsx`; diese Komponente kennt den Grund nicht.
 *
 * ## Die laufende Woche ist ueber TEXT kenntlich
 *
 * `AC-018` verlangt, dass ein Zustand nie nur ueber Farbe getragen wird.
 * „Aktuelle Woche" steht deshalb als Wort da; `aria-current="page"` auf dem
 * Rueckweg ist die maschinenlesbare Zugabe, nicht der Traeger.
 */
import { VisuallyHidden } from "@easytree/ui";
import Link from "next/link";

import type { Wochenmodell } from "../lib/wochennavigation";

export function WochenNavigation({ modell }: { modell: Wochenmodell }) {
  if (modell.art === "fehlerhaft") {
    return (
      <nav
        aria-label="Wochennavigation"
        className="wochennavigation"
        data-testid="wochennavigation"
      >
        <Link
          href={modell.heuteUrl}
          className="wochennavigation__ziel"
          data-testid="wochennavigation-heute"
        >
          Heute
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Wochennavigation" className="wochennavigation" data-testid="wochennavigation">
      <Link
        href={modell.vorherigeUrl}
        className="wochennavigation__ziel"
        data-testid="wochennavigation-vorherige"
      >
        Vorherige Woche
      </Link>

      <p className="wochennavigation__woche" data-testid="werkbank-woche-iso">
        <span className="wochennavigation__woche-text">{modell.isoWochenText}</span>{" "}
        <VisuallyHidden className="wochennavigation__woche-schluessel">
          {modell.schluessel}
        </VisuallyHidden>
      </p>
      <p className="wochennavigation__zeitraum" data-testid="werkbank-woche-bereich">
        {modell.zeitraumText}
      </p>
      {modell.istAktuelleWoche ? (
        <p className="wochennavigation__marke" data-testid="wochennavigation-aktuell">
          Aktuelle Woche
        </p>
      ) : null}

      <Link
        href={modell.heuteUrl}
        className="wochennavigation__ziel"
        aria-current={modell.istAktuelleWoche ? "page" : undefined}
        data-testid="wochennavigation-heute"
      >
        Heute
      </Link>
      <Link
        href={modell.naechsteUrl}
        className="wochennavigation__ziel"
        data-testid="wochennavigation-naechste"
      >
        Nächste Woche
      </Link>
    </nav>
  );
}
