/**
 * Der Werkbankrahmen der Planung (EYT-140 M6, `AC-003` / `AC-004`).
 *
 * ## Was diese Datei ist — und was sie ausdruecklich nicht ist
 *
 * Sie ist KOMPOSITION, keine neue Fachbreite. Sie ruft kein Gateway, rechnet
 * keine Woche und trifft keine Rechteentscheidung. Sie ordnet an, was es schon
 * gibt: Kopf, Wochennavigation, Planungsflaeche. Bis M6 tat das
 * `app/planung/page.tsx` nebenbei — eine `<h1>Planung</h1>` ohne jeden
 * Wochenbezug, darunter zwei lose Bausteine. Die Planerin konnte daraus nicht
 * ablesen, WELCHE Woche sie plant, ohne die Navigation zu lesen.
 *
 * ## Warum das eine SERVER-Komponente ist
 *
 * Sie traegt kein `"use client"`, wird nur von der Server-Komponente
 * `app/planung/page.tsx` importiert und ist damit selbst eine — genau wie
 * `WochenNavigation`, die sie rendert. Das ist die tragende Entscheidung
 * dieses Meilensteins, und sie geht gegen eine aeltere Zeile im Plan, die die
 * Navigation unter die Clientgrenze zoege: dort brauchte sie Code im Browser,
 * ohne dass irgendetwas an ihr interaktiv waere.
 *
 * ## Warum `<section>` und nicht `<main>` (EYT-141)
 *
 * Bis EYT-141 stand hier ein `<main>` — INNERHALB des `<main id="hauptinhalt">`
 * der `AppShell`. Zwei verschachtelte `main`-Landmarks sind ein
 * Barrierefreiheitsfehler (nur eine je Dokument), und der Skip-Link zielt auf
 * die aeussere: wer ihm folgte, landete in einem Bereich, der eine zweite
 * gleichrangige Landmark enthielt. Kein Waechter hat das gesehen, weil axe im
 * Browser bis EYT-141 ausschliesslich `/` geprueft hat, nie `/planung`.
 *
 * `<section aria-label=…>` ist die richtige Ebene: ein benannter Bereich
 * INNERHALB des Hauptinhalts. Der Name ist derselbe Titel, den der Kopf zeigt
 * — keine zweite Formulierung, die auseinanderlaufen koennte. Ein `<section>`
 * ohne Namen waere gar keine Landmark und im Screenreader unauffindbar.
 *
 * Der Client bleibt deshalb genau dort, wo er gemessen hingehoert: in
 * `PlanungAnsicht`. `PlanungZugang` reicht die Rechte als KINDFUNKTION weiter,
 * und eine Funktion kann die Server-/Client-Grenze nicht ueberqueren — der
 * Fehler ist real gemessen worden und wurde erst in `auth-journey` rot (siehe
 * Dateikopf von `planung-ansicht.tsx`). Diese Werkbank nimmt die fertige
 * Ansicht deshalb als `children` ENTGEGEN und stellt sie nur hin; sie
 * konstruiert sie nicht. Ein Server-Elternteil, das ein Client-Kind als
 * `children` durchreicht, ist der eine Weg, der ueber diese Grenze traegt.
 *
 * ## Warum der Anker `werkbank-planungsflaeche` hierher wandert
 *
 * Er markiert seit M8 die Planungsflaeche als BEREICH und bindet den
 * Kostenuebergang daran (`apps/web/test/kosten-uebergang.test.tsx`). Er sitzt
 * weiterhin auf genau dem Element, das Navigation UND Planungsansicht
 * umschliesst — verschoebe man ihn auf einen inneren Kasten, faenden die
 * Containment-Zusicherungen des Uebergangs ihn nicht mehr mit der Navigation
 * zusammen und waeren still schwaecher.
 *
 * ## Der Kopf wiederholt die Woche — mit Absicht
 *
 * Woche und Zeitraum stehen auch in der Navigation; dort sind sie Beschriftung
 * des Bedienelements. Im Kopf sind sie die ANTWORT auf „was plane ich hier
 * gerade", und die muss ohne Blick in die Bedienleiste lesbar sein. Beide
 * Texte stammen aus DEMSELBEN Modell — es gibt keine zweite Wochenrechnung,
 * und genau das misst der Test ueber eine Woche, die nicht die der Uhr ist.
 */
import { PageHeader } from "@easytree/ui";
import type { ReactNode } from "react";

import type { Wochenmodell } from "../lib/wochennavigation";
import { WochenNavigation } from "./wochen-navigation";

export function PlanungsWerkbank({
  modell,
  children,
}: {
  modell: Wochenmodell;
  /**
   * Die Planungsflaeche selbst — im Erfolgsfall `PlanungAnsicht`, sonst der
   * Fehlerhinweis der Seite. Der Rahmen entscheidet nicht, WAS darin steht;
   * sonst muesste er den Fehlergrund kennen und haette einen zweiten Leser
   * neben `app/planung/page.tsx`.
   */
  children: ReactNode;
}) {
  return (
    <main data-testid="werkbank-planungsflaeche" className="werkbank">
      <PageHeader
        data-testid="werkbank-kopf"
        className="werkbank__kopf"
        title={titel(modell)}
        // `exactOptionalPropertyTypes`: ein ausdrueckliches `undefined` ist
        // etwas anderes als eine fehlende Eigenschaft. Ohne Woche gibt es
        // keinen Zeitraum — dann bleibt die Zeile weg, statt leer dazustehen.
        {...(modell.art === "woche" ? { description: zeitraum(modell) } : {})}
      />
      <WochenNavigation modell={modell} />
      <div className="werkbank__flaeche">{children}</div>
    </main>
  );
}

/**
 * Die Ueberschrift der Werkbank.
 *
 * Ohne darstellbare Woche bleibt es beim blossen „Planung": eine ersatzweise
 * genannte Woche waere die schlimmere Variante (`E2`) — die Planerin saehe
 * eine plausible Woche, aber nicht die, die sie angefordert hat.
 */
function titel(modell: Wochenmodell): string {
  return modell.art === "woche" ? `Planung — ${modell.isoWochenText}` : "Planung";
}

/**
 * Der vollstaendige Datumsbereich der Woche (`AC-003`).
 *
 * `zeitraumText` kommt fertig aus dem Modell — Montag und Sonntag, beide
 * Grenztage benannt. Hier wird nichts nachgerechnet und nichts gekuerzt.
 */
function zeitraum(modell: Extract<Wochenmodell, { art: "woche" }>): string {
  return `Zeitraum ${modell.zeitraumText}`;
}
