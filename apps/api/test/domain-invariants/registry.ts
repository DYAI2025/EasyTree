/**
 * Register der benannten Domaininvarianten (EYT-61 AK1).
 *
 * Kein `.test.ts`-Suffix: bewusst Daten, keine eigene Suite — dieselbe
 * Konvention wie `apps/api/test/architecture/rules.ts`.
 *
 * ## Wofuer das hier gut ist
 *
 * AK1 lautet: "Jede benannte Domaininvariante besitzt mindestens einen Positiv-
 * und einen Negativtest." Das ist eine VOLLSTAENDIGKEITSAUSSAGE. Eine Liste
 * gruener Tests belegt sie nicht — sie belegt nur, dass die aufgeschriebenen
 * Faelle durchlaufen. Belegen laesst sich die Aussage nur, wenn zwei Dinge
 * gemessen werden:
 *
 *   1. Der Bestand ist vollstaendig: JEDER Wert-Export von `@easytree/domain`
 *      kommt in diesem Register vor. Ein neuer Export ohne Eintrag macht
 *      `invariant-coverage.test.ts` rot — nicht still gruen.
 *   2. Jeder Eintrag hat beide Richtungen, und die genannten Tests existieren
 *      wirklich (Titel wird im Quelltext der genannten Datei gesucht).
 *
 * ## Was ein "Negativtest" hier heisst
 *
 * Nicht "irgendein Test, der einen Fehler erwartet". Gemeint ist ein Fall, der
 * die Invariante WIDERLEGEN wuerde, wenn sie nicht gaelte:
 *
 *   - bei pruefenden Funktionen: die abgelehnte Eingabe;
 *   - bei rechnenden Funktionen: der unterscheidende Gegenfall, bei dem die
 *     naheliegende falsche Implementierung nachweislich etwas anderes liefert
 *     (z. B. UTC-Tag statt Ortstag).
 *
 * Ein Test, der nur die Existenz von etwas prueft, ist keines von beidem.
 *
 * ## Was das Register NICHT leistet
 *
 * Es deckt `packages/domain` ab. SQL-Invarianten leben in
 * `supabase/tests/*.sql` und sind dort einzeln mit Positiv- und Negativfall
 * geschrieben; ihre Vollstaendigkeit misst das katalogweite Metagate
 * (`0005_schema_meta_gate.sql`), nicht diese Datei. Wer AK1 fuer die
 * Datenbank behauptet, muss dorthin zeigen.
 */

/** Eine Fundstelle: Datei plus ein Testtitel, der darin woertlich vorkommt. */
export interface TestRef {
  readonly file: string;
  readonly title: string;
}

export interface Invariant {
  /** Der Wert-Export aus `@easytree/domain`, dessen Regel hier steht. */
  readonly exportName: string;
  /** Die Regel in einem Satz. */
  readonly statement: string;
  /**
   * `konstante` = eine eingefrorene Liste oder ein Markenwert. Dafuer gibt es
   * keine Ablehnungsrichtung; die Ausnahme ist hier einzeln begruendet, statt
   * pauschal zu gelten.
   */
  readonly kind: "regel" | "konstante";
  readonly positive: TestRef;
  /** `null` NUR bei `kind: "konstante"`. */
  readonly negative: TestRef | null;
}

const INTERVAL = "packages/domain/test/time-interval.test.ts";
const PROPERTY = "packages/domain/test/time-interval.property.test.ts";
const WEEK = "packages/domain/test/planning-week.test.ts";
const EDGES = "packages/domain/test/temporal-edges.test.ts";
const CAPACITY = "packages/domain/test/weekly-capacity.test.ts";
const IDS = "packages/domain/test/identifiers.test.ts";
const WALL = "packages/domain/test/wall-time.test.ts";

export const INVARIANTS: readonly Invariant[] = [
  // -------------------------------------------------------------------------
  // identifiers
  // -------------------------------------------------------------------------
  {
    exportName: "unsafeIdentifier",
    statement: "Markiert einen String als Bezeichnerart, ohne ihn zur Laufzeit zu veraendern.",
    kind: "regel",
    positive: { file: IDS, title: "bleibt zur Laufzeit der rohe String" },
    negative: { file: IDS, title: "trennt Bezeichnerarten auf Typebene" },
  },
  {
    exportName: "IDENTIFIER_BRANDS",
    statement: "Jede Bezeichnerart kommt genau einmal vor.",
    kind: "konstante",
    positive: { file: IDS, title: "führt jede Bezeichnerart genau einmal" },
    negative: null,
  },

  // -------------------------------------------------------------------------
  // time-interval
  // -------------------------------------------------------------------------
  {
    exportName: "TimeInterval",
    statement:
      "Ein Intervall existiert nur mit start < end (halboffen). Gleiche Zeiten sind ungueltig — der 24-Stunden-Fehler des Prototyps.",
    kind: "regel",
    positive: { file: INTERVAL, title: "akzeptiert eine gueltige Reihenfolge" },
    negative: {
      file: INTERVAL,
      title: "lehnt gleiche Zeiten ab — der 24-Stunden-Bug aus dem Prototyp",
    },
  },
  {
    exportName: "TIME_INTERVAL_ERRORS",
    statement: "Jeder Ablehnungscode kommt genau einmal vor.",
    kind: "konstante",
    positive: { file: INTERVAL, title: "fuehrt jeden Fehlercode genau einmal" },
    negative: null,
  },
  {
    exportName: "durationMs",
    statement: "Die Dauer ist immer echt positiv und exakt in Millisekunden.",
    kind: "regel",
    positive: { file: PROPERTY, title: "liefert immer eine echt positive Dauer" },
    negative: {
      file: INTERVAL,
      title: "faellt bei Object.assign laut aus, statt still kein Konflikt zu melden",
    },
  },
  {
    exportName: "durationMinutes",
    statement: "Minuten sind Millisekunden geteilt durch 60000 — ohne Rundung.",
    kind: "regel",
    positive: { file: INTERVAL, title: "rechnet exakt, ohne zu runden" },
    negative: {
      file: PROPERTY,
      title: "rechnet Minuten ohne Rundung aus Millisekunden",
    },
  },
  {
    exportName: "overlaps",
    statement:
      "Zwei Intervalle ueberschneiden sich genau dann, wenn sie einen inneren Punkt teilen. Beruehrung ist keine Ueberschneidung.",
    kind: "regel",
    positive: { file: INTERVAL, title: "erkennt echte Ueberschneidung" },
    negative: {
      file: INTERVAL,
      title: "laesst angrenzende Intervalle durch — sonst blockiert jeder Baustellenwechsel",
    },
  },
  {
    exportName: "isAdjacent",
    statement: "Angrenzen und Ueberschneiden schliessen einander aus.",
    kind: "regel",
    positive: { file: INTERVAL, title: "trennt aufeinanderfolgende Naechte korrekt" },
    negative: { file: PROPERTY, title: "schliesst Ueberschneidung und Angrenzen gegenseitig aus" },
  },
  {
    exportName: "hasAnyOverlap",
    statement:
      "Der Nachbarvergleich nach Sortierung findet dieselben Ueberschneidungen wie der paarweise Vergleich.",
    kind: "regel",
    positive: {
      file: INTERVAL,
      title: "findet eine Ueberschneidung unabhaengig von der Eingabereihenfolge",
    },
    negative: {
      file: INTERVAL,
      title: "meldet eine lueckenlose Kette angrenzender Intervalle nicht",
    },
  },

  // -------------------------------------------------------------------------
  // planning-week
  // -------------------------------------------------------------------------
  {
    exportName: "createTimeZone",
    statement: "Nur eine der Laufzeit bekannte IANA-Zone wird angenommen; kein stilles UTC.",
    kind: "regel",
    positive: { file: WEEK, title: "nimmt eine bekannte Zone an" },
    negative: { file: WEEK, title: "lehnt eine unbekannte Zone ab, statt still auf UTC zu fallen" },
  },
  {
    exportName: "EUROPE_BERLIN",
    statement: "Pilotzone, bis organizations.time_zone gelesen wird.",
    kind: "konstante",
    positive: { file: WEEK, title: "nimmt eine bekannte Zone an" },
    negative: null,
  },
  {
    exportName: "localBusinessDate",
    statement: "Der Kalendertag entsteht in der angegebenen Zone, nicht in UTC und nicht lokal.",
    kind: "regel",
    positive: { file: WEEK, title: "liefert den Kalendertag vor Ort, nicht den UTC-Tag" },
    negative: {
      file: WEEK,
      title: "liefert fuer denselben Instant in einer anderen Zone einen anderen Tag",
    },
  },
  {
    exportName: "isoWeekOfLocalDate",
    statement: "Die ISO-Woche folgt dem Donnerstag derselben Woche; Sonntag ist ihr letzter Tag.",
    kind: "regel",
    positive: { file: WEEK, title: "ordnet die Wochengrenze Sonntag/Montag korrekt zu" },
    negative: {
      file: EDGES,
      title: "wechselt die Woche genau am Sonntagmitternacht, nicht am UTC-Mitternacht",
    },
  },
  {
    exportName: "planningWeekOf",
    statement: "Massgeblich ist der Beginn; eine Schicht ueber Mitternacht wird nicht geteilt.",
    kind: "regel",
    positive: {
      file: WEEK,
      title: "legt eine Montags-Fruehschicht in die Montagswoche, nicht in die Vorwoche",
    },
    negative: {
      file: WEEK,
      title: "laesst eine Schicht ueber Mitternacht in der Woche ihres Beginns",
    },
  },
  {
    exportName: "utcInstantOfLocalWallTime",
    statement:
      "Wanduhrzeit -> Instant ist weder total noch eindeutig: die Sommerzeitluecke wird als NONEXISTENT_LOCAL_TIME gemeldet, die Wiederholungsstunde als AMBIGUOUS_LOCAL_TIME — nie geraten.",
    kind: "regel",
    positive: {
      file: WALL,
      title: "rechnet 03:30 danach schon mit +02:00",
    },
    negative: {
      file: WALL,
      title: "meldet 02:30 als nicht existierend statt einen Zeitpunkt zu erfinden",
    },
  },
  {
    exportName: "planningWeekKey",
    statement: "Der Schluessel `2026-W32` ist stabil, sortierbar und monoton in der Zeit.",
    kind: "regel",
    positive: { file: PROPERTY, title: "liefert immer einen wohlgeformten Wochenschluessel" },
    negative: { file: PROPERTY, title: "bleibt in der Wochenzuordnung monoton" },
  },
  {
    exportName: "isSameWeek",
    statement: "Gleichheit gilt ueber ISO-Jahr UND ISO-Woche, nicht ueber das Kalenderjahr.",
    kind: "regel",
    positive: { file: WEEK, title: "erkennt gleiche Wochen ueber die Jahresgrenze hinweg" },
    negative: { file: WEEK, title: "ordnet ueber den Jahreswechsel korrekt zu" },
  },

  // -------------------------------------------------------------------------
  // weekly-capacity
  // -------------------------------------------------------------------------
  {
    exportName: "aggregateWeeklyLoad",
    statement:
      "Der Schluessel ist (Mitarbeiter, Woche), nicht (Mitarbeiter). Zwei zulaessige Wochen ergeben keine erfundene Ueberplanung (FIND-003).",
    kind: "regel",
    positive: { file: CAPACITY, title: "gruppiert je Mitarbeiter UND Woche" },
    negative: { file: CAPACITY, title: "bildet zwei getrennte Wochen" },
  },
  {
    exportName: "evaluateCapacity",
    statement: "Ohne aktivierte Grenze gibt es kein Urteil; Blockgrenze schlaegt Warngrenze.",
    kind: "regel",
    positive: {
      file: CAPACITY,
      title: "warnt, ohne zu blockieren, wenn nur die Warngrenze aktiv ist",
    },
    negative: { file: CAPACITY, title: "meldet OK, solange keine Grenze aktiviert ist" },
  },
  {
    exportName: "blocksPublication",
    statement: "Eine einzelne reissende Woche blockiert; die Gesamtsumme ist irrelevant.",
    kind: "regel",
    positive: { file: CAPACITY, title: "blockiert sehr wohl, wenn EINE Woche die Grenze reisst" },
    negative: { file: CAPACITY, title: "blockiert nicht — die Gesamtsumme ist irrelevant" },
  },
  {
    exportName: "findCapacityIssues",
    statement: "Gemeldet werden genau die Wochen mit Urteil ungleich OK.",
    kind: "regel",
    positive: { file: CAPACITY, title: "blockiert ab der Blockgrenze, auch ohne Warngrenze" },
    negative: { file: CAPACITY, title: "laesst die Blockgrenze die Warngrenze schlagen" },
  },
  {
    exportName: "projectWeeks",
    statement:
      "Die Vier-Wochen-Sicht filtert dasselbe Aggregat, statt zweitens zu rechnen — auseinanderlaufen koennen sie deshalb nicht.",
    kind: "regel",
    positive: { file: CAPACITY, title: "filtert das bestehende Aggregat, statt neu zu rechnen" },
    negative: { file: CAPACITY, title: "liefert bei leerem Fenster nichts" },
  },
  {
    exportName: "CAPACITY_VERDICTS",
    statement: "Die Urteilsstufen sind eine eingefrorene Liste.",
    kind: "konstante",
    positive: { file: CAPACITY, title: "meldet OK, solange keine Grenze aktiviert ist" },
    negative: null,
  },
  {
    exportName: "NO_CAPACITY_LIMIT",
    statement: "Kein erfundener Standardwert: weder PRD noch ADR nennen eine Wochenstundengrenze.",
    kind: "konstante",
    positive: { file: CAPACITY, title: "meldet OK, solange keine Grenze aktiviert ist" },
    negative: null,
  },
];
