import { EUROPE_BERLIN } from "@easytree/domain";

import { PlanungAnsicht } from "../../../components/planung-ansicht";
import { PlanungsWerkbank } from "../../../components/planungs-werkbank";
import { wochenmodell, type Fehlergrund } from "../../../lib/wochennavigation";

/**
 * Einstieg in die Planungswerkbank (EYT-50, erweitert um EYT-140 M5).
 *
 * ## Die einzige Uhrzeit-Lesestelle des Slices (`E3`)
 *
 * Die Uhr wird in diesem Slice an genau einer Stelle gelesen — unten in dieser
 * Datei, und sonst nirgends. Das Fertigkriterium zaehlt den Aufruf hier und
 * erwartet **genau einen**; deshalb steht er in diesem Kommentar nicht noch
 * einmal wortwoertlich. Alles darunter bekommt die
 * fertig berechnete Woche als Prop. Ohne diese Regel waere „welche Woche ist
 * heute" in einer Client-Komponente nicht deterministisch pruefbar, und
 * `no-local-time-construction` bekaeme eine zweite Baustelle. Die Zone wird
 * BENANNT uebergeben (`EUROPE_BERLIN`), nie implizit aus der Laufzeit gelesen:
 * welche sieben Kalendertage eine ISO-Woche ausmacht, ist zonenfrei — welche
 * Woche „heute" ist, ist es nicht (`E4`).
 *
 * ## Fehlender Parameter ist etwas anderes als ungueltiger (`E2`)
 *
 * Hier stand zuvor eine Konstante `REFERENZWOCHE = "2026-W32"` — der Wert aus
 * dem Seed. Ein Produktionscode, der eine Testwoche kennt, zeigt in jeder
 * anderen Umgebung stillschweigend die falsche. Danach galt: KEIN Parameter =
 * Fehler. Das war ehrlich, aber eine Sackgasse — die Planerin musste den
 * technischen Schluessel selbst in die Adresse schreiben.
 *
 * Seit M5 gilt die Trennung: **kein** `weekKey` ergibt die laufende Woche
 * (`AC-003`); ein **vorhandener, aber ungueltiger** bleibt sichtbar abgelehnt
 * und das Gateway wird gar nicht erst gerufen. Ein stiller Rueckfall auf die
 * laufende Woche waere die schlimmere Variante: die Planerin saehe eine
 * plausible Woche, aber nicht die aus ihrem Link. Ein mehrfach angegebener
 * Parameter bleibt ebenfalls eine Ablehnung — Next liefert dann ein Array, und
 * das stille Reduzieren auf den ersten Wert waere eine Antwort auf eine nicht
 * gestellte Frage.
 *
 * Hier stand bis M5 „Eine Wochennavigation bleibt EYT-72". Das war ueberholt:
 * die Navigation ist Gegenstand dieses Slices und steht unten im Baum.
 *
 * ## Warum die beiden Fehlergruende getrennte Texte bekommen
 *
 * `9999-W52` und `0001-W01` sind GUELTIGE Wochenschluessel; nur ihre
 * Nachbarwoche liegt ausserhalb der Vertragsgrenze 0001–9999. Fuer die Planerin
 * ist das etwas anderes als ein Tippfehler, und der Hinweis „erwartet wird
 * `?weekKey=2026-W32`" waere dort schlicht falsch — der Schluessel war ja
 * wohlgeformt. `grund` aus dem Modell trennt beides; ohne diesen Zweig haette
 * das Feld keinen Leser.
 *
 * ## Was ueber die Server-/Client-Grenze geht
 *
 * Genau ein Wert: `weekKey: string` an `PlanungAnsicht`, unveraendert seit
 * EYT-107. `PlanungsWerkbank` und die von ihr gerenderte `WochenNavigation`
 * tragen KEIN `"use client"` und werden nur aus Server-Komponenten importiert
 * — sie sind damit selbst welche, und `Wochenmodell` ueberquert gar keine
 * Grenze; seit M6 endet sein Weg in der Werkbank statt hier. Hier stand
 * bis zum 19.08.2026 das Gegenteil, und der Meilenstein M4 im Plan sagt
 * woertlich „Client-Komponente": eine Abweichung des Entwurfs vom Plan, die
 * niemand gemeldet hatte (`K12`). Der Entwurf ist die bessere Variante — eine
 * Server-Komponente schickt keinen Code in den Browser —, also wurde der Plan
 * nachgezogen, nicht der Code.
 *
 * Serialisierbar bleibt `Wochenmodell` trotzdem mit Absicht: braucht die
 * Navigation spaeter ein `"use client"` (Fokusverwaltung, Tastenkuerzel), soll
 * das Modell die Grenze ohne Umbau ueberqueren koennen. Eine FUNKTION koennte
 * das nicht — daran ist EYT-107 schon einmal gescheitert, und weder `typecheck`
 * noch `build-web` noch der jsdom-Test haben es bemerkt; rot wurde erst
 * `auth-journey`.
 */
export default async function PlanungPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const modell = wochenmodell({
    weekKeyAusUrl: params["weekKey"],
    jetzt: new Date(),
    zone: EUROPE_BERLIN,
  });

  return (
    // Rahmen, Kopf, Wochennavigation und der Anker `werkbank-planungsflaeche`
    // liegen seit M6 in `planungs-werkbank.tsx`. Diese Seite entscheidet nur
    // noch, WAS in der Flaeche steht — die Ansicht oder der Fehlerhinweis.
    <PlanungsWerkbank modell={modell}>
      {modell.art === "woche" ? (
        // Diese Seite ist eine SERVER-Komponente und reicht deshalb nur eine
        // Zeichenkette weiter. Waechter und Ansicht liegen zusammen in einer
        // Client-Komponente — warum, steht in `planung-ansicht.tsx`.
        <PlanungAnsicht weekKey={modell.schluessel} />
      ) : (
        fehlerhinweis(modell.grund)
      )}
    </PlanungsWerkbank>
  );
}

/**
 * Der sichtbare Text zu einem Fehlergrund.
 *
 * Bewusst ein `switch` mit `never`-Rest statt einer Kette aus Fragezeichen
 * (`NB-5`, 19.08.2026): mit `grund === "parameter-unbrauchbar" ? … : …` fiele
 * ein spaeter ergaenzter dritter Grund stillschweigend in den Randwochentext —
 * die Planerin bekaeme eine Erklaerung, die auf ihren Fall nicht zutrifft. So
 * geht stattdessen `typecheck` rot, bevor irgendetwas gerendert wird.
 */
function fehlerhinweis(grund: Fehlergrund) {
  switch (grund) {
    case "parameter-unbrauchbar":
      return (
        <p data-testid="planungsfenster-parameterfehler" role="alert">
          Kein gültiger Wochenschlüssel. Erwartet wird `?weekKey=2026-W32` mit einer Woche zwischen
          01 und 53.
        </p>
      );
    case "woche-ohne-nachbarwoche":
      return (
        <p data-testid="planungsfenster-randwoche" role="alert">
          Diese Woche liegt am Rand des darstellbaren Kalenders — sie hat keine Nachbarwoche, zu der
          geblättert werden könnte.
        </p>
      );
    default: {
      const unerreichbar: never = grund;
      throw new Error(`Unbekannter Fehlergrund: ${String(unerreichbar)}`);
    }
  }
}
