"use client";

import { PlanningWindowView } from "./planning-window-view";
import { PlanungZugang } from "./planung-zugang";

/**
 * Verbindet Zugangswaechter und Wochenplan (EYT-107).
 *
 * ## Warum es diese Datei gibt — ein gemessener Fehler
 *
 * Eine erste Fassung setzte den Waechter direkt in `app/planung/page.tsx` und
 * gab ihm die Rechte als Kindfunktion mit:
 *
 *     <PlanungZugang>{({ darfVeroeffentlichen }) => <PlanningWindowView … />}</PlanungZugang>
 *
 * `page.tsx` ist aber eine SERVER-Komponente, und `PlanungZugang` ist eine
 * Client-Komponente. Eine Funktion kann diese Grenze nicht ueberqueren; Next
 * bricht zur Laufzeit ab mit „Functions cannot be passed directly to Client
 * Components unless you explicitly expose it by marking it with 'use server'".
 *
 * Bemerkt hat das WEDER der Typcheck NOCH `build-web` noch der jsdom-Test der
 * Seite: jsdom rendert alles clientseitig, die Grenze existiert dort nicht.
 * Rot wurde erst `auth-journey` gegen den echten `next start` (gemessen
 * 03.08.2026, Lauf 30840726709). Genau dafuer gibt es diesen Job.
 *
 * Beide Komponenten hier sind Client-Komponenten, die Kindfunktion bleibt also
 * innerhalb der Clientgrenze. Die Seite reicht nur noch `weekKey` durch — eine
 * Zeichenkette, und die ist serialisierbar.
 */
export function PlanungAnsicht({ weekKey }: { weekKey: string }) {
  return (
    <PlanungZugang>
      {({ darfVeroeffentlichen }) => (
        <PlanningWindowView weekKey={weekKey} darfVeroeffentlichen={darfVeroeffentlichen} />
      )}
    </PlanungZugang>
  );
}
