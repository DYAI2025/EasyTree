/**
 * Wochenraster der Dispositionswerkbank (EYT-147 Slice 1).
 *
 * ## Was diese Datei ist — und was sie bewusst nicht ist
 *
 * Eine reine Zuordnungsfunktion: sie legt die Einsätze einer Serverantwort auf
 * die sieben Kalendertage ihrer Woche. Sie erfindet keinen fachlichen Zustand,
 * rechnet keine Woche und trifft keine Planungsentscheidung — Wochengrenze,
 * Kalendertage und die Zuordnung eines Zeitpunkts zu einem Tag kommen
 * vollständig aus `@easytree/domain` (`planningWeekDateRange`, `dayAfter`,
 * `localBusinessDate`) und `@easytree/contracts` (`parseIsoWeekKey`). Eine
 * eigene Tagesrechnung hier wäre die zweite Kalenderregel neben der Domain —
 * und beide liefen genau an DST- und Jahresgrenzen auseinander.
 *
 * ## Ein Einsatz gehört zum Tag seines BEGINNS
 *
 * Dieselbe Regel, mit der `planningWeekOf` eine Nachtschicht in der Woche
 * ihres Beginns hält: der Kalendertag eines Einsatzes ist der Tag, an dem er
 * in der Zone der Organisation beginnt. Ein Einsatz von Montag 22:00 bis
 * Dienstag 06:00 steht auf der Montags-Spalte — genau dort fängt die Kolonne
 * an zu arbeiten.
 *
 * ## Nichts verschwindet
 *
 * Ein Einsatz, dessen Beginn NICHT in einem der sieben Tage liegt, wandert
 * sichtbar nach `ausserhalb` statt still wegzufallen — eine Antwort, die der
 * Server so eigentlich nicht liefern kann (der Create-Pfad vergleicht die
 * Woche), aber „kann eigentlich nicht sein" ist kein Renderpfad. Dasselbe
 * fail-sichtbare Prinzip gilt für die ganze Ableitung: eine unbekannte Zone
 * oder ein unlesbarer Wochenschlüssel ergeben `art: "unbestimmbar"` mit
 * Grund, und die Ansicht fällt auf die flache Liste zurück, statt ein leeres
 * Raster als „nichts geplant" auszugeben.
 *
 * ## Die Zeitbeschriftung ist Darstellung, keine Wahrheit
 *
 * `zeitText` formatiert einen UTC-Zeitpunkt als Wanduhrzeit der Organisation
 * über `Intl.DateTimeFormat` mit AUSDRÜCKLICHER Zone und festem `de-DE` —
 * nie über die Laufzeitumgebung. Die maßgeblichen Werte bleiben die
 * UTC-Intervalle des Vertrags; sie stehen unverändert als `data`-Attribute im
 * Markup.
 */
import { parseIsoWeekKey } from "@easytree/contracts";
import type { AssignmentDto } from "@easytree/contracts";
import {
  compareLocalBusinessDate,
  createTimeZone,
  dayAfter,
  localBusinessDate,
  planningWeekDateRange,
} from "@easytree/domain";
import type { LocalBusinessDate } from "@easytree/domain";

/** Montag steht per Konstruktion an Index 0 — `planningWeekDateRange.monday`. */
const WOCHENTAGSNAMEN = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

export interface Wochentag {
  /** Kanonischer Kalendertag als `YYYY-MM-DD` — für `data`-Anker und Schlüssel. */
  readonly tagKey: string;
  /** Ausgeschriebener Wochentag, etwa `Montag`. */
  readonly wochentagsText: string;
  /** Kalendertag als `TT.MM.`, ohne Jahr — das Jahr trägt die Wochenüberschrift. */
  readonly datumsText: string;
  /** Einsätze, deren Beginn in der Organisationszone auf diesen Tag fällt — nach Beginn sortiert. */
  readonly einsaetze: readonly AssignmentDto[];
}

export type Wochenraster =
  | {
      readonly art: "raster";
      readonly tage: readonly Wochentag[];
      /** Einsätze, deren Beginn ausserhalb der sieben Tage liegt — sichtbar, nie verschluckt. */
      readonly ausserhalb: readonly AssignmentDto[];
    }
  | {
      readonly art: "unbestimmbar";
      readonly grund: "zone-unbekannt" | "woche-unlesbar";
    };

function zweistellig(wert: number): string {
  return String(wert).padStart(2, "0");
}

function tagKey(tag: LocalBusinessDate): string {
  return `${String(tag.year).padStart(4, "0")}-${zweistellig(tag.month)}-${zweistellig(tag.day)}`;
}

/**
 * Sortierung innerhalb eines Tages: Beginn, dann Ende, dann Id.
 *
 * Der Vergleich läuft über `Date.parse`, nicht über die Zeichenkette: der
 * Vertrag normalisiert die Schreibweise des Instants nicht, und `+02:00`
 * gegen `Z` sortiert lexikalisch falsch. Die Id als letzter Schlüssel ist ein
 * schlichter Ordinalvergleich — `localeCompare` hinge an der Umgebung.
 */
function nachBeginn(a: AssignmentDto, b: AssignmentDto): number {
  const beginn = Date.parse(a.interval.startUtc) - Date.parse(b.interval.startUtc);
  if (beginn !== 0) return beginn;
  const ende = Date.parse(a.interval.endUtc) - Date.parse(b.interval.endUtc);
  if (ende !== 0) return ende;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Legt die Einsätze einer Woche auf ihre sieben Kalendertage.
 *
 * @param fenster Ausschnitt der Serverantwort: Woche, Zone, Einsätze.
 * @returns Das vollständige Raster, oder `unbestimmbar` mit Grund — nie ein
 *   halbes Raster, in dem Einsätze fehlen.
 */
export function wochenraster(fenster: {
  readonly weekKey: string;
  readonly timeZone: string;
  readonly assignments: readonly AssignmentDto[];
}): Wochenraster {
  const woche = parseIsoWeekKey(fenster.weekKey);
  if (!woche.ok) return { art: "unbestimmbar", grund: "woche-unlesbar" };

  const zone = createTimeZone(fenster.timeZone);
  if (!zone.ok) return { art: "unbestimmbar", grund: "zone-unbekannt" };

  const bereich = planningWeekDateRange(woche.week);
  const tage: LocalBusinessDate[] = [bereich.monday];
  for (let i = 1; i < 7; i += 1) {
    const vortag = tage[i - 1];
    if (vortag === undefined) break; // unerreichbar; hält noUncheckedIndexedAccess
    tage.push(dayAfter(vortag));
  }

  const jeTag: AssignmentDto[][] = tage.map(() => []);
  const ausserhalb: AssignmentDto[] = [];
  for (const einsatz of fenster.assignments) {
    const beginnTag = localBusinessDate(new Date(einsatz.interval.startUtc), zone.timeZone);
    const index = tage.findIndex((tag) => compareLocalBusinessDate(tag, beginnTag) === 0);
    if (index === -1) {
      ausserhalb.push(einsatz);
    } else {
      jeTag[index]?.push(einsatz);
    }
  }

  return {
    art: "raster",
    tage: tage.map((tag, index) => ({
      tagKey: tagKey(tag),
      wochentagsText: WOCHENTAGSNAMEN[index] ?? "",
      datumsText: `${zweistellig(tag.day)}.${zweistellig(tag.month)}.`,
      einsaetze: [...(jeTag[index] ?? [])].sort(nachBeginn),
    })),
    ausserhalb: [...ausserhalb].sort(nachBeginn),
  };
}

/**
 * Wanduhrzeit eines UTC-Zeitpunkts in einer benannten Zone, als `HH:MM`.
 *
 * Ausdrücklich `de-DE`, `hour12: false` und die ÜBERGEBENE Zone — nichts an
 * dieser Formatierung liest die Laufzeitumgebung. Eine unbrauchbare Eingabe
 * ergibt sichtbar den Rohwert statt einer geratenen Zeit.
 */
export function zeitText(instantUtc: string, timeZone: string): string {
  const zeitpunkt = new Date(instantUtc);
  if (Number.isNaN(zeitpunkt.getTime())) return instantUtc;
  try {
    return new Intl.DateTimeFormat("de-DE", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(zeitpunkt);
  } catch {
    return instantUtc;
  }
}
