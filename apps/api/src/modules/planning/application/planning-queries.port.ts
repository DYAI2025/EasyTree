/**
 * Leseport der Planung (EYT-50).
 *
 * Bewusst KEINE Transporttypen: was hier herauskommt, ist der Stand der
 * Datenbank, nicht die Antwortform. Die Abbildung auf `PlanningWindow` aus
 * `@easytree/contracts` gehoert in die interface-Schicht — sonst waere der
 * Vertrag ueber die Anwendungsschicht bis ins Repository durchgereicht, und
 * eine Vertragsaenderung zoege eine Repositoryaenderung nach sich.
 *
 * Die Organisation steht in keiner Signatur DIESER DREI METHODEN, und das
 * bleibt so: ein Parameter `orgId` an `planningWindow` waere die Einladung, ihn
 * aus der URL zu befuellen.
 *
 * Seit EYT-109 kann der Leseport beim BAU an eine bereits serverseitig
 * aufgeloeste Organisation gebunden werden — siehe
 * `planning-queries.factory.ts`. Das ist der Unterschied zwischen einer
 * Anfrage, die sich ihren Mandanten aussucht, und einer Konstruktion, der ein
 * bereits gefallenes Urteil mitgegeben wird.
 */

/** Eine Zuweisung, so wie sie in der Datenbank steht. */
export interface AssignmentRow {
  readonly id: string;
  readonly employeeId: string;
  readonly worksiteId: string;
  readonly startsAtUtc: Date;
  readonly endsAtUtc: Date;
}

/**
 * Auswaehlbare Stammdatenzeile — Beschaeftigte oder Baustelle.
 *
 * `label` traegt in der Datenbank zwei verschiedene Spaltennamen
 * (`employees.display_name`, `worksites.name`). Die Vereinheitlichung passiert
 * hier, weil beide fachlich dasselbe leisten: der Text, den die Planerin liest.
 */
export interface ResourceRow {
  readonly id: string;
  readonly label: string;
  /** `false` = weiterhin sichtbar, aber fuer NEUE Einsaetze nicht auswaehlbar. */
  readonly active: boolean;
}

/**
 * Alles, was in dieser Woche ausgewaehlt werden kann.
 *
 * Enthaelt bewusst **alle** tenant-sichtbaren Eintraege, nicht nur die aktiven:
 * ein bestehender Einsatz auf eine inzwischen deaktivierte Person muss ihren
 * Namen behalten. Die Einschraenkung auf Aktive ist eine Regel der Auswahl,
 * keine Regel der Abfrage.
 */
export interface ResourcesRow {
  readonly employees: readonly ResourceRow[];
  readonly worksites: readonly ResourceRow[];
}

/** Version, ZU DER die angezeigten Zuweisungen gehoeren. */
export interface SourceVersionRow {
  readonly id: string;
  readonly state: "draft" | "published";
}

export interface PlanningWindowRow {
  /** Additive Tagesprojektion; Legacy-Einplanungen werden nicht adoptiert. */
  readonly worksiteDays?: readonly WorksiteDayReadRow[];
  readonly weekKey: string;
  /** IANA-Zone der Organisation aus `organizations.time_zone` (Migration 0004). */
  readonly timeZone: string;
  /**
   * Der bearbeitbare Stand: Zuweisungen des Entwurfs, sonst die der zuletzt
   * veroeffentlichten Version, sonst leer.
   * Begruendung in docs/decisions/2026-07-27-eyt-50-lesesemantik-planungsfenster.md.
   */
  readonly assignments: readonly AssignmentRow[];
  /**
   * Herkunft von `assignments`. Getrennt von `publishedVersionId`, weil ein
   * Entwurf ueber einer bereits veroeffentlichten Version stehen kann — und
   * die Anzeige sonst "Veroeffentlichte Version X" ueber fremde Daten setzt.
   */
  readonly sourceVersion: SourceVersionRow | null;
  /** Zuletzt veroeffentlichte Version derselben Woche, oder `null`. */
  readonly publishedVersionId: string | null;
  /**
   * Auswaehlbare Beschaeftigte und Baustellen, gelesen in DERSELBEN
   * Transaktion wie `assignments`. Deshalb Teil dieses Rows und keine eigene
   * Portmethode: zwei Aufrufe koennten zwei Zeitpunkte sehen.
   */
  readonly resources: ResourcesRow;
}

/** Persistierter Baustellentag mit der Konfiguration des gelesenen Stands. */
export interface WorksiteDayReadRow {
  readonly worksiteDayId: string;
  readonly configurationId: string;
  readonly worksiteId: string;
  readonly localDate: string;
  readonly lockVersion: number;
  readonly team: readonly {
    readonly assignmentId: string;
    readonly employeeId: string;
    readonly startsAtUtc: Date;
    readonly endsAtUtc: Date;
  }[];
}

/** Warum eine Leseanfrage nicht beantwortbar ist. */
export type PlanningQueryProblem =
  /** Angemeldet, aber ohne aktive Mitgliedschaft. */
  | "NO_ORGANISATION"
  /**
   * Mehrere aktive Mitgliedschaften. KEINE stille Auswahl: eine davon zu
   * nehmen waere eine erfundene Mandantenentscheidung, die niemandem auffiele,
   * weil das Ergebnis plausibel aussieht. Der Organisationswechsler gehoert zu
   * EYT-14.
   */
  | "AMBIGUOUS_ORGANISATION";

export type PlanningWindowResult =
  | { readonly ok: true; readonly window: PlanningWindowRow }
  | { readonly ok: false; readonly problem: PlanningQueryProblem };

/**
 * Eine veroeffentlichte Planversion, wie die LESESEITE sie auflistet (EYT-109).
 *
 * Bewusst NICHT `PublishedPlanVersionRow` aus `planning-writes.port`: der Name
 * ist dort bereits vergeben, und die Form ist eine andere (`versionId`,
 * `publishedAtUtc`, `assignmentIds`). Das ist keine Doppelung, sondern ein
 * Bedeutungsunterschied — der Schreibport antwortet auf „was ist gerade
 * veroeffentlicht worden", der Leseport auf „was ist veroeffentlicht". Beide
 * ueber einen Typ zu ziehen hiesse, den einen um Felder zu erweitern, die der
 * andere nie fuellt.
 */
export interface PublishedVersionRow {
  readonly id: string;
  readonly weekKey: string;
  /** Nie `null` — eine unveroeffentlichte Version steht nicht in dieser Liste. */
  readonly publishedAt: Date;
}

/**
 * Der veroeffentlichte Stand EINER konkret benannten Planversion (EYT-109).
 *
 * Enthaelt `weekKey` und `timeZone`, obwohl der Aufrufer nur eine Id genannt
 * hat: der Kosten-Snapshot muss UTC-Instants in Kalendertage der
 * Organisationszone legen, und die Zone aus einer zweiten Abfrage zu holen
 * hiesse, sie an einem anderen Zeitpunkt zu lesen als die Zuweisungen.
 *
 * `resources` traegt dieselben Zeilen wie im Planungsfenster — also die Basis,
 * aus der EYT-109 spaeter Baustellen- und Personenbezeichnungen bildet. Diese
 * Abbildung passiert NICHT hier: die Planung liefert Planungsdaten, die
 * Benennung im Kostenbericht ist eine Entscheidung des Kostenmoduls.
 */
export interface PublishedAssignmentsRow {
  readonly planVersionId: string;
  readonly weekKey: string;
  /** IANA-Zone der Organisation aus `organizations.time_zone` (Migration 0004). */
  readonly timeZone: string;
  readonly publishedAt: Date;
  readonly assignments: readonly AssignmentRow[];
  readonly resources: ResourcesRow;
}

/**
 * Warum eine Anfrage nach einem VEROEFFENTLICHTEN Stand nicht beantwortbar ist.
 *
 * `PLAN_VERSION_NOT_FOUND` deckt zwei Faelle mit EINER Antwort ab: „gibt es
 * nicht" und „gehoert einem anderen Mandanten". Die Unterscheidung waere ein
 * Existenzleck — wer fremde Ids durchprobiert, erfuehre an der Antwort, welche
 * davon echt sind. RLS macht beide Faelle schon in der Datenbank ununterscheidbar
 * (null Zeilen); dieser Typ gibt die Ununterscheidbarkeit nach aussen weiter,
 * statt sie an der Portgrenze wieder aufzutrennen.
 */
export type PublishedReadProblem =
  PlanningQueryProblem | "PLAN_VERSION_NOT_FOUND" | "PLAN_NOT_PUBLISHED";

/**
 * Ergebnis der Bereichsabfrage.
 *
 * Der Fehlertyp ist bewusst der ENGE `PlanningQueryProblem` und nicht
 * {@link PublishedReadProblem}: eine Liste nennt keine einzelne Planversion,
 * also kann sie weder „nicht gefunden" noch „nicht veroeffentlicht" ergeben.
 * Der weite Typ waere hier eine Zusage auf Faelle, die nie eintreten — und
 * jeder Aufrufer muesste sie trotzdem behandeln.
 */
export type PublishedVersionsResult =
  | { readonly ok: true; readonly versions: readonly PublishedVersionRow[] }
  | { readonly ok: false; readonly problem: PlanningQueryProblem };

export type PublishedAssignmentsResult =
  | { readonly ok: true; readonly published: PublishedAssignmentsRow }
  | { readonly ok: false; readonly problem: PublishedReadProblem };

export interface PlanningQueries {
  /** Liest das Fenster einer ISO-Woche im Mandanten des gesetzten Kontexts. */
  planningWindow(weekKey: string): Promise<PlanningWindowResult>;

  /**
   * Listet die VEROEFFENTLICHTEN Planversionen eines Wochenbereichs
   * (einschliesslich beider Grenzen), im Mandanten des gesetzten Kontexts.
   *
   * Entwuerfe kommen nicht vor. Das ist der Unterschied zu
   * {@link PlanningQueries.planningWindow}, das den BEARBEITBAREN Stand liefert
   * und dafuer den Entwurf bevorzugt.
   */
  publishedVersions(fromWeekKey: string, toWeekKey: string): Promise<PublishedVersionsResult>;

  /**
   * Liest den Stand GENAU DER benannten Planversion.
   *
   * Warum nicht `planningWindow(weekKey)` wiederverwenden: dessen Antwort ist
   * an die Woche gebunden, nicht an die Version. Entsteht nach dem
   * Veroeffentlichen ein neuer Entwurf derselben Woche, liefert
   * `planningWindow` dessen Zuweisungen — der veroeffentlichte Stand ist dann
   * nicht mehr erreichbar. Ein Kosten-Snapshot, der darauf rechnete, fror einen
   * Personalplan ein, den niemand veroeffentlicht hat, und saehe hinterher
   * revisionssicher aus. Deshalb adressiert diese Methode die Version.
   */
  publishedAssignments(planVersionId: string): Promise<PublishedAssignmentsResult>;
}

/** DI-Token. Tests ersetzen ihn, genau wie `DATABASE_PING`. */
export const PLANNING_QUERIES = "PLANNING_QUERIES";
