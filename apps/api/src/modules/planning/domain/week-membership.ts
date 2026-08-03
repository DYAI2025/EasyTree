/**
 * Gehoert eine Zuweisung in die Woche ihrer Planversion? (EYT-107)
 *
 * ## Die Luecke, die diese Datei schliesst
 *
 * `plan_versions.week_key` ist im Schema mit KEINEM Zeitstempel seiner
 * Zuweisungen verknuepft. Migration 0007 prueft den Schluessel gegen ein
 * Muster, 0011 zusaetzlich gegen den Kalender — aber nichts verbindet ihn mit
 * `assignments.starts_at_utc`. Das ist die bekannte, bis heute offene Luecke
 * aus EYT-49.
 *
 * Solange nur `createAssignment` schreibt, faellt sie nicht auf: dieser Pfad
 * vergleicht die Woche selbst und lehnt mit `OUTSIDE_WEEK` ab. Beim
 * Veroeffentlichen zaehlt aber der GESAMTE Entwurf — auch Zeilen, die auf
 * anderen Wegen entstanden sind, etwa als Kopie der zuletzt veroeffentlichten
 * Version. Ohne diese Pruefung koennte eine Woche mit fachlich fremden Zeiten
 * verbindlich werden, und EYT-109 rechnete Kosten darauf.
 *
 * ## Warum die Pruefung hier steht und nicht in der Datenbank
 *
 * Ein `CHECK` kann es nicht: die Woche eines Instants haengt von der Zeitzone
 * der Organisation ab, die in einer ANDEREN Tabelle steht
 * (`organizations.time_zone`), und Zeitzonenumrechnung ist in PostgreSQL nicht
 * `IMMUTABLE`. Ein Trigger waere moeglich — aber er waere eine ZWEITE
 * Wochenrechnung neben `packages/domain`, und genau die verhindert
 * `iso-week-parity.test.ts`.
 *
 * Der Preis ist benannt, nicht verschwiegen: die Regel gilt nur fuer
 * Schreibpfade, die durch die Anwendung laufen. Steht in
 * `docs/runbooks/planning-publish.md`.
 *
 * ## Warum die Ableitung hereingereicht wird
 *
 * `AppModule` reicht die Wochenregel aus `@easytree/domain` bereits in das
 * Schreibrepository hinein. Sie hier erneut zu importieren waere ein zweiter
 * Ableitungspfad — dieselbe Begruendung, aus der das Repository sie auch nicht
 * selbst nachbaut.
 */

/** Das Minimum, das zur Wochenzuordnung noetig ist. Kein Personenbezug. */
export interface ZuweisungZeitpunkt {
  readonly id: string;
  readonly startsAtUtc: Date;
}

export interface FremdeWoche {
  readonly id: string;
  readonly tatsaechlicheWoche: string;
}

/**
 * Liefert jede Zuweisung, deren Beginn NICHT in `weekKey` faellt.
 *
 * Leere Liste heisst: alles gehoert in die Woche. Bewusst die vollstaendige
 * Liste und kein `boolean` — die Meldung soll sagen koennen, WELCHE Zeile
 * nicht passt und in welche Woche sie gehoert.
 *
 * Der BEGINN entscheidet, nicht das Ende: eine Schicht ueber die
 * Wochengrenze gehoert zu der Woche, in der sie anfaengt. Dieselbe Regel wie
 * `planningWeekOf` in `@easytree/domain`.
 */
export function zuweisungenAusserhalbDerWoche(
  zuweisungen: readonly ZuweisungZeitpunkt[],
  weekKey: string,
  wochenschluessel: (instant: Date, timeZone: string) => string,
  timeZone: string,
): FremdeWoche[] {
  const fremde: FremdeWoche[] = [];
  for (const zuweisung of zuweisungen) {
    const tatsaechlicheWoche = wochenschluessel(zuweisung.startsAtUtc, timeZone);
    if (tatsaechlicheWoche !== weekKey) {
      fremde.push({ id: zuweisung.id, tatsaechlicheWoche });
    }
  }
  return fremde;
}
