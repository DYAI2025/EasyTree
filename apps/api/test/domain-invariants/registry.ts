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
// EYT-95 — Money-, Rate- und Rundungsvertrag.
const MONEY = "packages/domain/test/money-rate.test.ts";
const RATE_PROP = "packages/domain/test/rate-version.property.test.ts";
// EYT-109 — Tagesallokation ueber lokale Kalendertage.
const DAY_ALLOC = "packages/domain/test/local-day-allocation.test.ts";
const DAY_ALLOC_PROP = "packages/domain/test/local-day-allocation.property.test.ts";

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
    statement: "Europe/Berlin: Pilotzone, bis organizations.time_zone gelesen wird.",
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

  // ---------------------------------------------------------------------------
  // EYT-95 — Geld (V1, V4)
  // ---------------------------------------------------------------------------
  {
    exportName: "moneyOfMinorUnits",
    statement:
      "Ein Betrag wird als ganzzahlige EUR-Minor-Unit in bigint gefuehrt und verlaesst den Vertrag unveraendert — vorzeichenoffen.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "fuehrt Minor Units als bigint und gibt sie unveraendert zurueck",
    },
    // Erzeugt beide Vorzeichen: eine Implementierung, die auf nichtnegativ
    // klemmt oder ueber Euro-Gleitkomma fuehrt, faellt hier auf.
    negative: {
      file: RATE_PROP,
      title: "gibt jeden Minor-Unit-Betrag unveraendert zurueck, mit beiden Vorzeichen",
    },
  },
  {
    exportName: "moneyFromNumber",
    statement:
      "An der Zahlengrenze passiert nur, was endlich, ganzzahlig und als number eindeutig ist — geprueft in dieser Reihenfolge.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "nimmt an der Zahlengrenze einen sicheren ganzzahligen Betrag an",
    },
    // Der schaerfste Gegenfall: endlich UND ganzzahlig, trotzdem abgelehnt,
    // weil jenseits von 2^53 nicht mehr eindeutig.
    negative: {
      file: MONEY,
      title: "lehnt an der Zahlengrenze einen Betrag jenseits der sicheren Ganzzahl ab",
    },
  },
  {
    exportName: "addMoney",
    statement: "Die Summe zweier Betraege ist exakt; es entsteht kein Gleitkommarest.",
    kind: "regel",
    positive: { file: MONEY, title: "addiert zwei Betraege exakt in Minor Units" },
    // Assoziativitaet ist der unterscheidende Gegenfall: eine Addition ueber
    // Euro-Gleitkommawerte ist nicht assoziativ und driftet hier auseinander.
    negative: { file: RATE_PROP, title: "addiert assoziativ und exakt" },
  },
  {
    exportName: "subtractMoney",
    statement:
      "Die Differenz ist exakt und darf negativ werden — Money traegt ein Vorzeichen, damit Abweichungen modellierbar bleiben (V4).",
    kind: "regel",
    positive: { file: MONEY, title: "zieht einen kleineren Betrag exakt ab" },
    // Der Gegenfall zur naheliegenden Klemmung auf null: hier MUSS das
    // Ergebnis negativ werden.
    negative: { file: MONEY, title: "laesst bei der Subtraktion ein negatives Delta zu" },
  },
  {
    exportName: "planCostAmount",
    statement:
      "Nur ein nichtnegativer Betrag wird persistierfaehiger Plan-Kostenbetrag; das ist die Domaenengrenze aus V4.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "nimmt einen nichtnegativen Betrag als Plan-Kostenbetrag an, einschliesslich null",
    },
    negative: { file: MONEY, title: "nimmt ein negatives Delta nicht als Plan-Kostenbetrag an" },
  },
  {
    exportName: "sumPlanCostAmounts",
    statement:
      "Eine Summe entsteht ausschliesslich durch Addition bereits gerundeter Positionsbetraege, nie durch Neuberechnung (V1 Punkt 7 und 8).",
    kind: "regel",
    positive: { file: RATE_PROP, title: "summiert Positionen ohne erneutes Runden" },
    // Der Gegenfall enthaelt die ausdrueckliche Abgrenzung gegen den verbotenen
    // Weg: drei Positionen ergeben 3501, die Neuberechnung aus der
    // ungerundeten Gesamtmenge 3500.
    negative: {
      file: MONEY,
      title: "bildet Summen ausschliesslich aus den bereits gerundeten Positionsbetraegen",
    },
  },

  // ---------------------------------------------------------------------------
  // EYT-95 — Menge und Sicherheitsgrenze vor BigInt (V2, V2b, V4)
  // ---------------------------------------------------------------------------
  {
    exportName: "durationMilliseconds",
    statement:
      "Eine Menge ist eine nichtnegative ganzzahlige Millisekundenzahl; null ist zulaessig.",
    kind: "regel",
    positive: { file: MONEY, title: "nimmt null Millisekunden als zulaessige Menge an" },
    negative: { file: MONEY, title: "lehnt eine negative Dauer ab" },
  },
  {
    exportName: "toDurationMilliseconds",
    statement:
      "Vor der Konvertierung nach bigint wird endlich, ganzzahlig, nichtnegativ und sicher geprueft — fail-closed (V2b).",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "nimmt einen sicheren ganzzahligen Wert an und konvertiert ihn exakt",
    },
    // Der einzige der vier verbotenen Faelle, bei dem BigInt() NICHT wirft,
    // sondern still einen nicht mehr herleitbaren Wert liefert.
    negative: {
      file: MONEY,
      title: "weist einen unsicheren Number-Wert ab, obwohl BigInt ihn klaglos annaehme",
    },
  },

  // ---------------------------------------------------------------------------
  // EYT-95 — Kalendertage (V3)
  // ---------------------------------------------------------------------------
  {
    exportName: "compareLocalBusinessDate",
    statement:
      "Kalendertage werden nach Jahr, dann Monat, dann Tag geordnet; Gleichheit ist unterscheidbar.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "ordnet zwei Kalendertage desselben Monats und erkennt Gleichheit",
    },
    // Unterscheidender Gegenfall: in beiden Paaren ist die Tageszahl des
    // FRUEHEREN Datums groesser — ein Vergleich ueber day allein bekommt das
    // Vorzeichen falsch.
    negative: { file: MONEY, title: "widerlegt die Tagesnummer als Ordnungskriterium" },
  },
  {
    exportName: "dayAfter",
    statement:
      "Der Nachfolger eines Kalendertages ist die einzige zulaessige Normalisierung nach halboffen (V3) — echte Kalenderarithmetik, kein Zeitpunkt.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "bildet den Folgetag innerhalb des Monats und ueber die Monatsgrenze",
    },
    // Unterscheidender Gegenfall: `day + 1` ergaebe den 32.12., ein fest mit
    // 28 Tagen kodierter Februar verfehlte den 29.02.2028.
    negative: {
      file: MONEY,
      title: "widerlegt die blosse Tagesinkrementierung an Jahres- und Schaltjahresgrenze",
    },
  },
  {
    exportName: "dayBefore",
    statement:
      "Der Vorgaenger eines Kalendertages ist die einzige Umrechnung von der halboffenen Lesart der Datenbank (Migration 0013, rate-effectivity) in die einschliessende der Domaene (EYT-109) — echte Kalenderarithmetik, kein Zeitpunkt.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "bildet den Vortag innerhalb des Monats und ueber die Monatsgrenze",
    },
    // Unterscheidender Gegenfall: `{ ...date, day: date.day - 1 }` ergaebe den
    // "0. Januar", keinen Kalendertag; eine Regel "durch vier teilbar" statt der
    // gregorianischen verfehlte den 28.02.2100 und den 29.02.2000.
    negative: {
      file: MONEY,
      title: "widerlegt die blosse Tagesdekrementierung an Jahres- und Schaltjahresgrenze",
    },
  },

  // ---------------------------------------------------------------------------
  // EYT-109 — Tagesallokation ueber lokale Kalendertage (S5-REQ-05)
  // ---------------------------------------------------------------------------
  {
    exportName: "allocateAcrossLocalDays",
    statement:
      "Ein Einsatz wird auf die lokalen Kalendertage der Organisationszone verteilt; die Anteile sind aufsteigend, lueckenlos, nie leer und summieren sich EXAKT auf die verstrichene Dauer — auch an den Ortstagen mit 23 oder 25 Stunden. An einer fehlenden oder doppelten lokalen Mitternacht wird blockiert, nie geraten. Das ist ausdruecklich die GEGENTEILIGE Regel zu planningWeekOf, das eine Schicht ueber Mitternacht ungeteilt laesst.",
    kind: "regel",
    // Die tragende Aussage ist eine Eigenschaft ueber alle Einsaetze und acht
    // Zonen, nicht ein Punkt: deshalb steht der Eigenschaftstest als Positivfall.
    positive: {
      file: DAY_ALLOC_PROP,
      title: "summiert die Anteile exakt auf die verstrichene Dauer",
    },
    // Unterscheidender Gegenfall: 2026-08-02T22:30Z bis 2026-08-03T06:30Z ist in
    // Europe/Berlin EIN Ortstag (der 3.), in UTC dagegen zwei. Eine Umsetzung
    // ueber UTC-Mitternacht liefert hier zwei Anteile und bucht die halbe
    // Nachtschicht auf einen Tag, an dem vor Ort niemand gearbeitet hat.
    //
    // Bewusst NICHT der Blockierfall, obwohl die Aussage oben auch das
    // Blockieren nennt. Der Kopf dieser Datei definiert den Negativfall fuer
    // eine RECHNENDE Funktion als „den unterscheidenden Gegenfall, bei dem die
    // naheliegende falsche Implementierung nachweislich etwas anderes liefert
    // (z. B. UTC-Tag statt Ortstag)" — woertlich dieser Fall. Die
    // Ablehnungsrichtung haengt trotzdem nicht in der Luft: der Nachbareintrag
    // LOCAL_DAY_ALLOCATION_ERRORS fuehrt sie und loest beide Codes mit echten
    // Zonen aus.
    negative: {
      file: DAY_ALLOC,
      title: "ordnet einer UTC-Zuordnung widersprechend dem ORTSTAG zu",
    },
  },
  {
    exportName: "LOCAL_DAY_ALLOCATION_ERRORS",
    statement:
      "Die Tagesgrenze kennt genau zwei blockierende Ausgaenge — fehlende und doppelte lokale Mitternacht — und beide sind mit echten Zonen und echten Daten ausloesbar; einen dritten, stillen Ausgang gibt es nicht.",
    kind: "konstante",
    positive: {
      file: DAY_ALLOC,
      title: "fuehrt jeden Tagesgrenzen-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },

  // ---------------------------------------------------------------------------
  // EYT-95 — Satzversionen (AK3, V3, V4)
  // ---------------------------------------------------------------------------
  {
    exportName: "costCurrencyFromUnknown",
    statement:
      'Die untrusted Eingangsgrenze akzeptiert ausschliesslich den exakten String "EUR" — keine Grossschreibung, keine stillschweigende Normalisierung (V5.4-korrigiert).',
    kind: "regel",
    positive: { file: MONEY, title: "nimmt genau den String EUR an" },
    // Der unterscheidende Gegenfall ist bewusst `"eur"` und nicht `"USD"`:
    // eine Implementierung mit `toUpperCase()` faellt nur hier auf und wuerde
    // an einer Systemgrenze stillschweigend Daten korrigieren.
    negative: { file: MONEY, title: "lehnt Kleinschreibung ab, statt still zu normalisieren" },
  },
  {
    exportName: "hourlyRateAmount",
    statement:
      "Ein Stundensatz ist nichtnegativ; seit V5.6 sitzt diese Pruefung am gebrandeten Satzkonstruktor, nicht mehr in der Versionsfactory.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "nimmt einen nichtnegativen Stundensatz an, einschliesslich null",
    },
    negative: { file: MONEY, title: "lehnt einen negativen Stundensatz ab" },
  },
  {
    exportName: "HOURLY_RATE_AMOUNT_ERRORS",
    statement:
      "Der Satzkonstruktor kennt genau einen Ablehnungsgrund, RATE_NEGATIVE, und der ist erreichbar. UNSUPPORTED_COST_CURRENCY sitzt seit V5.4-korrigiert an der untrusted Eingangsgrenze, wo er echt ausloesbar ist.",
    kind: "konstante",
    positive: {
      file: MONEY,
      title: "fuehrt jeden Stundensatz-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },
  {
    exportName: "hourlyRateVersion",
    statement:
      "Eine Satzversion entsteht nur aus bereits validierten Werten und prueft danach nur noch relationale Invarianten (V5.6) — validTo nicht vor validFrom.",
    kind: "regel",
    positive: { file: MONEY, title: "nimmt eine Satzversion mit gueltigem Intervall an" },
    negative: {
      file: MONEY,
      title: "lehnt eine Version ab, deren gueltig-bis vor gueltig-ab liegt",
    },
  },
  {
    exportName: "selectRateVersion",
    statement:
      "Zu einem Stichtag gilt genau eine Version, sonst ein blockierendes Ergebnis — niemals stillschweigend null Euro.",
    kind: "regel",
    positive: { file: MONEY, title: "waehlt am ersten Gueltigkeitstag bereits die Version" },
    // Der Gegenfall gegen `versions.find(...)`: bei doppelter Deckung darf
    // nicht die erste gewinnen, sondern es muss blockieren.
    negative: {
      file: MONEY,
      title: "meldet zwei ueberlappende Versionen als blockierend statt die erste zu nehmen",
    },
  },
  {
    exportName: "findRateVersionOverlaps",
    statement:
      "Ueberlappende Gueltigkeitsintervalle werden vollstaendig gefunden, unabhaengig von der Eingabereihenfolge.",
    kind: "regel",
    positive: {
      file: RATE_PROP,
      title: "stimmt in findRateVersionOverlaps mit dem paarweisen Orakel ueberein",
    },
    negative: {
      file: MONEY,
      title: "findet die Ueberlappung auch dann, wenn die Versionen unsortiert kommen",
    },
  },

  // ---------------------------------------------------------------------------
  // EYT-95 — Berechnung und Rundung (V1, V2)
  // ---------------------------------------------------------------------------
  {
    exportName: "costOfDuration",
    statement:
      "Betrag = roundHalfUp(satz * millisekunden / 3_600_000), genau einmal gerundet und erst am Ende.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "rundet einen exakten halben Cent auf den naechsthoeheren Cent",
    },
    // Unterscheidender Gegenfall gegen jede Zwischenrundung: wer den
    // Minutensatz vorab rundet, rechnet 14 statt 12.
    negative: { file: MONEY, title: "rundet nicht auf einem Minuten- oder Sekundensatz" },
  },
  {
    exportName: "computeCostPosition",
    statement:
      "Eine Position traegt Quelle, Satzversion, Regelversion und Erzeugungszeitpunkt — oder sie entsteht gar nicht.",
    kind: "regel",
    positive: {
      file: MONEY,
      title: "traegt Quelle, Regelversion, Satzversion und Erzeugungszeitpunkt im Ergebnis",
    },
    negative: { file: MONEY, title: "blockiert die Position, wenn am Stichtag kein Satz gilt" },
  },

  // ---------------------------------------------------------------------------
  // EYT-95 — eingefrorene Konstanten und Fehlercodelisten
  // ---------------------------------------------------------------------------
  {
    exportName: "CURRENCIES",
    statement:
      "Sprint 5 kennt genau eine Waehrung: netto EUR. Damit ist ein Waehrungskonflikt im Kern nicht konstruierbar — CURRENCY_MISMATCH entfaellt vollstaendig (V5.4-korrigiert).",
    kind: "konstante",
    positive: { file: MONEY, title: "fuehrt genau eine Waehrung und traegt sie am Betrag mit" },
    negative: null,
  },
  {
    exportName: "COST_RULE_VERSION",
    statement:
      "personnel-plan-cost-v1: die Regelversion ist fest verdrahtet und nicht konfigurierbar; ein Wechsel laeuft nur ueber Forward-Fix (V1).",
    kind: "konstante",
    positive: { file: MONEY, title: "benennt Regelversion, Rundungsmodus und Rundungsstufe fest" },
    negative: null,
  },
  {
    exportName: "ROUNDING_MODE",
    statement:
      "HALF_UP_NON_NEGATIVE: bei exakt 0,5 Cent wird auf den naechsthoeheren Cent gerundet; fuer negative Werte ist nichts nachgewiesen — die bigint-Division schneidet zur Null hin ab, ein negativer Halbwert faellt also nach OBEN und nicht von null weg (V5.3). Nicht mandanten- oder nutzerkonfigurierbar (V1, V5.3).",
    kind: "konstante",
    positive: { file: MONEY, title: "benennt Regelversion, Rundungsmodus und Rundungsstufe fest" },
    negative: null,
  },
  {
    exportName: "ROUNDING_STAGE",
    statement:
      "COST_POSITION_FINAL_AMOUNT: gerundet wird genau einmal, beim Erzeugen der persistenten Kostenposition (V1).",
    kind: "konstante",
    positive: { file: MONEY, title: "benennt Regelversion, Rundungsmodus und Rundungsstufe fest" },
    negative: null,
  },
  {
    exportName: "COST_RATE_DENOMINATOR",
    statement: "Der Nenner der Stundenrate ist 3_600_000 Millisekunden (V2).",
    kind: "konstante",
    // Driftwaechter: das Eigenschaftstestfile fuehrt ein unabhaengiges Literal,
    // weil es damit die Halbwertfamilie konstruiert. Diese Zeile haelt beide
    // in Deckung.
    positive: {
      file: RATE_PROP,
      title: "haelt den lokalen Massstab mit dem Nenner des Vertrags in Deckung",
    },
    negative: null,
  },
  {
    exportName: "MONEY_ERRORS",
    statement:
      "Die Ablehnungsgruende der Zahlengrenze sind doppelfrei und jeder von ihnen ist durch eine konkrete Eingabe erreichbar.",
    kind: "konstante",
    positive: {
      file: MONEY,
      title: "fuehrt jeden Money-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },
  {
    exportName: "QUANTITY_ERRORS",
    statement:
      "Die vier Ablehnungsgruende der Sicherheitsgrenze aus V2b sind doppelfrei und je einzeln erreichbar.",
    kind: "konstante",
    positive: {
      file: MONEY,
      title: "fuehrt jeden Mengen-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },
  {
    exportName: "PLAN_COST_AMOUNT_ERRORS",
    statement:
      "Die Domaenengrenze aus V4 kennt genau einen Ablehnungsgrund, und der ist erreichbar.",
    kind: "konstante",
    positive: {
      file: MONEY,
      title: "fuehrt jeden Plan-Kostenbetrag-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },
  {
    exportName: "RATE_VERSION_ERRORS",
    statement:
      "Die Ablehnungsgruende der Satzversionsfabrik sind doppelfrei und je einzeln erreichbar.",
    kind: "konstante",
    positive: {
      file: MONEY,
      title: "fuehrt jeden Satzversions-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },
  {
    exportName: "COST_POSITION_INPUT_ERRORS",
    statement:
      "COMPUTED_AT_INVALID: ein gueltig getyptes Date mit getTime() === NaN blockiert die Position, weil AK4 den Erzeugungszeitpunkt verlangt (V5.2, gleiche Grenze wie TimeInterval.START_INVALID).",
    kind: "konstante",
    positive: {
      file: MONEY,
      title: "fuehrt jeden Positionseingabe-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },
  {
    exportName: "RATE_SELECTION_ERRORS",
    statement:
      "Die Satzauswahl kennt genau zwei blockierende Ausgaenge und keinen dritten, stillen Null-Euro-Ausgang.",
    kind: "konstante",
    positive: {
      file: MONEY,
      title: "fuehrt jeden Satzauswahl-Fehlercode genau einmal und erreicht jeden",
    },
    negative: null,
  },
];
