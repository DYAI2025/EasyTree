/**
 * Verteilung eines Einsatzes auf lokale Kalendertage (EYT-109, S5-REQ-05).
 *
 * ## Warum das nicht `planning-week.ts` macht
 *
 * Dort steht Regel 2: „Ein Einsatz gehoert in die Woche seines Beginns. Eine
 * Schicht ueber Mitternacht wird nicht aufgeteilt." Das ist fuer die
 * WOCHENZUORDNUNG richtig und fuer TAGESKOSTEN falsch: eine Nachtschicht
 * faellt wirtschaftlich auf zwei Arbeitstage, und wer sie ungeteilt auf den
 * Beginntag bucht, erfindet dort Stunden und verliert sie am Folgetag.
 *
 * Beide Regeln stehen nebeneinander, weil sie VERSCHIEDENE FRAGEN beantworten
 * — nicht weil eine die andere ersetzt oder eine von beiden veraltet ist. Wer
 * sie „vereinheitlicht", macht zwangslaeufig eine der beiden Antworten falsch.
 *
 * ## Warum die Funktion blockieren kann
 *
 * Die Tagesgrenze ist eine lokale Mitternacht, und in manchen Zonen springt die
 * Uhr genau dort. Gemessen am 08.08.2026 gegen die Zonendatenbank dieser
 * Laufzeit: in `America/Santiago` (2026-09-06), `America/Havana` (2026-03-08)
 * und `Asia/Beirut` (2026-03-29) gibt es die lokale Mitternacht NICHT; in
 * `America/Havana` (2026-11-01) und `Atlantic/Azores` (2026-10-25) gibt es sie
 * ZWEIMAL. `utcInstantOfLocalWallTime` meldet beides, statt zu raten; hier wird
 * es durchgereicht. Ein still gewaehlter Zweig verschoebe eine ganze
 * Nachtschicht um eine Stunde, ohne dass es jemand saehe.
 *
 * Die Pilotzone `Europe/Berlin` stellt um 02:00/03:00 um und erreicht diese
 * Zweige nie. Sie sind trotzdem keine Vermutung — die Beispielsuite loest sie
 * mit echten Zonen und echten Daten aus.
 *
 * ## Summenerhaltung
 *
 * Die Anteile entstehen aus AUFEINANDERFOLGENDEN Instants: der erste beginnt am
 * Intervallstart, jeder weitere an der Mitternacht, an der der vorige endete,
 * der letzte endet am Intervallende. Ihre Differenzen summieren sich per
 * Konstruktion exakt auf `durationMs(interval)` — auch an den Umstellungstagen
 * mit 23 bzw. 25 Stunden, denn gerechnet wird auf UTC-Instants und nicht auf
 * Wanduhrdifferenzen. Es wird nirgends gerundet und nirgends verworfen.
 *
 * ## Warum die Tagesgrenze erst berechnet wird, wenn sie gebraucht wird
 *
 * Der Kalendertag des Endes steht vorab fest; solange er gleich dem laufenden
 * Tag ist, gibt es keine Grenze zu bestimmen. Andernfalls blockierte eine ganz
 * normale Tagschicht in Santiago am 5. September, nur weil die Mitternacht des
 * 6. kaputt ist — eine Grenze, die die Rechnung nie ueberquert.
 *
 * ## Warum es keine Obergrenze fuer die Zahl der Tage gibt
 *
 * Ein erster Entwurf brach nach 400 Schleifendurchlaeufen ab. Die Zahl war
 * erfunden, und der Abbruch traefe ein wohlgeformtes Intervall: `time-interval.ts`
 * lehnt eine Dauerobergrenze ausdruecklich ab, weil weder PRD noch ADR eine
 * nennt. Gebraucht wird sie hier auch nicht — die Schleife laeuft, solange der
 * laufende Kalendertag VOR dem Kalendertag des Endes liegt, und
 * {@link dayAfter} erhoeht ihn nachweislich (unten zugesichert). Damit ist die
 * Terminierung eine Folgerung aus Kalenderarithmetik und nicht eine Hoffnung
 * ueber Zonenrechnung. Der Aufwand ist linear in der Zahl der beruehrten
 * Ortstage; das ist dem Problem eigen und keine Eigenschaft dieser Umsetzung.
 *
 * ## Werfen oder blockieren
 *
 * Dieselbe Trennung wie im uebrigen Paket: ein blockierendes Ergebnis fuer das,
 * was die Domaene an einer gueltigen Eingabe zu Recht verweigert (die kaputte
 * Mitternacht); ein `RangeError` fuer das, was mit einem geprueften
 * `TimeInterval` und einer geprueften Zone gar nicht eintreten KANN — so wie
 * `costOfDuration`, `daysInMonth` und der Konstruktor von `TimeInterval` es
 * halten. Ein verschluckter Programmierfehler waere hier eine stillschweigend
 * falsche Kostenzeile.
 *
 * Eine gemessene Ausnahme zur Formel „mit geprueftem Intervall kann nichts
 * werfen": ein VORCHRISTLICHER Instant. `localBusinessDate` liest die Jahreszahl
 * ohne Aera, `472 v. Chr.` kommt also als `year: 472` an. Gemessen am 08.08.2026:
 * ein solches Intervall INNERHALB eines Ortstages liefert klaglos einen Anteil
 * mit falsch beschriftetem Jahr, eines UEBER Mitternacht bricht am
 * Monotoniewaechter mit `RangeError` ab. Ueber keinen realistischen Pfad
 * erreichbar — ein veroeffentlichter Einsatz liegt nicht im Jahr 472 v. Chr. —,
 * und die laute Variante ist die bessere der beiden. Die Formel gilt also fuer
 * jeden erreichbaren Eingabebereich, nicht buchstaeblich fuer jedes
 * konstruierbare `TimeInterval`.
 */
import { toDurationMilliseconds } from "./duration-milliseconds.js";
import type { DurationMilliseconds } from "./duration-milliseconds.js";
import { compareLocalBusinessDate, dayAfter } from "./local-business-date.js";
import { localBusinessDate, utcInstantOfLocalWallTime } from "./planning-week.js";
import type { IanaTimeZone, LocalBusinessDate } from "./planning-week.js";
import { durationMs } from "./time-interval.js";
import type { TimeInterval } from "./time-interval.js";

/** Ein Tagesanteil: der Ortstag und die auf ihn entfallende verstrichene Zeit. */
export interface LocalDayPart {
  readonly date: LocalBusinessDate;
  readonly quantity: DurationMilliseconds;
}

/** Ablehnungsgruende. Stabile Codes — sie werden Teil der Snapshotantwort. */
export const LOCAL_DAY_ALLOCATION_ERRORS = [
  /** Die lokale Mitternacht existiert an diesem Tag nicht (Umstellung um 00:00). */
  "DAY_BOUNDARY_NONEXISTENT",
  /** Die lokale Mitternacht existiert zweimal. Keine stille Wahl. */
  "DAY_BOUNDARY_AMBIGUOUS",
] as const;

export type LocalDayAllocationError = (typeof LOCAL_DAY_ALLOCATION_ERRORS)[number];

export type LocalDayAllocationResult =
  | { readonly ok: true; readonly parts: readonly LocalDayPart[] }
  | { readonly ok: false; readonly error: LocalDayAllocationError };

/**
 * Baut einen Anteil und bricht laut ab, wenn die Menge nicht darstellbar waere.
 *
 * Unerreichbar mit einem geprueften Intervall: jeder Aufrufer unten hat vorher
 * zugesichert, dass das Ende des Anteils echt nach seinem Beginn liegt. Der
 * Aufruf steht trotzdem hier, weil dies die einzige Stelle ist, an der eine
 * gepruefte Menge entsteht — ein Cast waere die Marke ohne die Pruefung.
 *
 * `toDurationMilliseconds` und nicht `durationMilliseconds(BigInt(...))`: die
 * `bigint`-Tuer ueberspringt `Number.isSafeInteger`, und genau diese Pruefung
 * fordert V2b ausdruecklich fuer „die Differenz zweier Epoch-Millisekunden"
 * (`duration-milliseconds.ts`). Dass ein Tagesanteil hier durch einen Ortstag
 * begrenzt ist, macht die Pruefung ueberfluessig — aber nicht falsch, und die
 * Tuer mit der Pruefung ist die richtige.
 *
 * Das Datum wird mit eingefroren: `localBusinessDate` und `dayAfter` liefern
 * offene Objektliterale, und Task 5 gruppiert nach genau diesem Objekt. Ein
 * gemeinsam genutzter, veraenderbarer Gruppierungsschluessel waere eine leichte
 * Falle; das Paket friert seine geprueften Werte ohnehin ein.
 */
function anteil(date: LocalBusinessDate, vonMs: number, bisMs: number): LocalDayPart {
  const menge = toDurationMilliseconds(bisMs - vonMs);
  if (!menge.ok) {
    throw new RangeError(
      `Invariante verletzt: Tagesanteil ${String(bisMs - vonMs)} ms ist nicht darstellbar (${menge.error}).`,
    );
  }
  return Object.freeze({ date: Object.freeze(date), quantity: menge.quantity });
}

/**
 * Verteilt ein Einsatzintervall auf die lokalen Kalendertage der Organisation.
 *
 * Die Anteile kommen in aufsteigender Tagesreihenfolge, lueckenlos (jeder Tag
 * ist der {@link dayAfter} seines Vorgaengers), keiner ist leer, und ihre Summe
 * ist exakt `durationMs(interval)`.
 *
 * @throws {RangeError} wenn die Zonenrechnung eine Invariante verletzt, die mit
 *   einem geprueften Intervall nicht verletzbar sein sollte.
 */
export function allocateAcrossLocalDays(
  interval: TimeInterval,
  timeZone: IanaTimeZone,
): LocalDayAllocationResult {
  // Zuerst `durationMs`: die Funktion prueft mit `assertInterval`, dass hier
  // wirklich ein gebautes TimeInterval liegt und kein per `Object.assign`
  // zusammengesetztes Objekt, dessen private Felder fehlen.
  const dauerMs = durationMs(interval);
  const startMs = interval.startMs;
  const endeMs = startMs + dauerMs;

  let tag = localBusinessDate(interval.startUtc, timeZone);
  // Das Intervall ist halboffen: `endeMs` selbst gehoert nicht mehr dazu.
  // Massgeblich ist deshalb der Ortstag der letzten EINGESCHLOSSENEN
  // Millisekunde — sonst erzeugte ein Einsatz, der punktgenau auf einer
  // Mitternacht endet, einen leeren Anteil am Folgetag.
  const letzterTag = localBusinessDate(new Date(endeMs - 1), timeZone);

  if (compareLocalBusinessDate(letzterTag, tag) < 0) {
    throw new RangeError(
      `Invariante verletzt: Zone ${timeZone} ordnet dem spaeteren Instant den frueheren Ortstag zu.`,
    );
  }

  const parts: LocalDayPart[] = [];
  let cursorMs = startMs;

  while (compareLocalBusinessDate(tag, letzterTag) < 0) {
    const naechsterTag = dayAfter(tag);
    // Der lebende Nachfolger der Abbruchbedingung: verglichen wird der neue Tag
    // mit dem NOCH NICHT ueberschriebenen alten. (Ein frueherer Entwurf verglich
    // `tag` mit `naechsterTag` NACH der Zuweisung `tag = naechsterTag` — also
    // einen Wert mit sich selbst, was nie feuern kann.) Ohne diese Zusicherung
    // haengt die Terminierung der Schleife an einer Annahme ueber `dayAfter`
    // statt an einer Messung.
    if (compareLocalBusinessDate(naechsterTag, tag) <= 0) {
      throw new RangeError(
        `Invariante verletzt: dayAfter erhoeht den Kalendertag nicht (${String(tag.year)}-${String(tag.month)}-${String(tag.day)}).`,
      );
    }

    const grenze = utcInstantOfLocalWallTime({ date: naechsterTag, hour: 0, minute: 0 }, timeZone);
    if (!grenze.ok) {
      // Kein Raten: `utcInstantOfLocalWallTime` hat die Rueckleseprobe bereits
      // gemacht und meldet fehlend bzw. doppelt. Beides wird uebersetzt und
      // nach oben gereicht.
      return {
        ok: false,
        error:
          grenze.error === "AMBIGUOUS_LOCAL_TIME"
            ? "DAY_BOUNDARY_AMBIGUOUS"
            : "DAY_BOUNDARY_NONEXISTENT",
      };
    }

    const grenzeMs = grenze.instant.getTime();
    // Zonenmonotonie. Der Kalendervergleich oben sieht sie nicht: er rechnet auf
    // Tagesnummern, waehrend hier Instants entstehen. Liegt die naechste
    // Mitternacht nicht echt zwischen Cursor und Ende, ist die Zonenrechnung
    // kaputt — und ein Anteil der Laenge null oder negativ waere die Folge.
    if (grenzeMs <= cursorMs || grenzeMs >= endeMs) {
      throw new RangeError(
        `Invariante verletzt: Mitternacht ${grenze.instant.toISOString()} in Zone ${timeZone} liegt nicht echt zwischen ${String(cursorMs)} und ${String(endeMs)}.`,
      );
    }

    parts.push(anteil(tag, cursorMs, grenzeMs));
    cursorMs = grenzeMs;
    tag = naechsterTag;
  }

  // Der letzte Anteil laeuft bis zum Intervallende. `cursorMs < endeMs` gilt
  // hier immer: ohne Schleifendurchlauf ist er `startMs`, sonst die zuletzt
  // geprueft kleinere Grenze.
  parts.push(anteil(tag, cursorMs, endeMs));
  return { ok: true, parts: Object.freeze(parts) };
}
