/**
 * Port der Snapshot-Persistenz (EYT-109).
 *
 * ## Warum es diesen Port gibt
 *
 * Der Use-Case (Task 10) muss einen Snapshot ablegen und wiederlesen koennen,
 * ohne PostgreSQL oder die Transportform zu kennen. Ohne diese Naht haenge er
 * entweder am `TenantQueryRunner` — dann waere eine Schemaaenderung eine
 * Aenderung am Use-Case — oder an `@easytree/contracts` — dann bestimmte die
 * Antwortform, was gespeichert wird. Beides dreht die Abhaengigkeitsrichtung um.
 *
 * ## Warum die Formen hier eigene sind und nicht die des Vertrags
 *
 * `CostSnapshot` aus `@easytree/contracts` traegt `days`. Gespeichert ist das
 * NICHT: die Migration `0018` kennt nur `total_minor_units` im Kopf, die
 * Tagessummen werden beim Lesen aus den Positionen abgeleitet. Ein Repository,
 * das `CostSnapshot` zurueckgaebe, muesste diese Ableitung ausfuehren — eine
 * Rechnung in der Persistenzschicht, die dort niemand vermutet. Ausserdem
 * reisen Betraege und Dauern im Vertrag als String; in Prozess bleiben sie
 * `bigint`, und die Umsetzung gehoert an die HTTP-Naht, nicht hierher.
 *
 * ## Was hier bewusst NICHT steht
 *
 * Kein `update`, kein `delete`, kein `replace`, kein `recalculate`. Ein
 * Snapshot ist ein historisches Dokument; die Datenbank haelt das mit fehlenden
 * Grants (Migration `0018`) und dieser Port sagt dasselbe im Typ. Eine Methode
 * „fuer spaeter" waere eine Zusage, die die Datenbank ablehnt.
 *
 * Keine Organisations-Id als AUFRUFERAUTORITAET. Die Fabrik bindet das Subjekt,
 * RLS bindet den Mandanten. Dass {@link NewCostSnapshot} eine bereits
 * aufgeloeste Organisation traegt, ist etwas anderes — siehe dort.
 */
import type { AssembledPosition } from "../domain/cost-snapshot-assembly";

/**
 * Die Rechenregel, unter der ein Snapshot entsteht.
 *
 * Bewusst aus {@link AssembledPosition} abgeleitet und nicht als eigenes
 * Literal geschrieben: die Montage stempelt sie auf jede Position, der Kopf
 * haelt sie einmal fuer den ganzen Snapshot. Waeren es zwei Deklarationen,
 * koennten sie auseinanderlaufen, ohne dass irgendetwas rot wird.
 */
export type CostRuleVersion = AssembledPosition["ruleVersion"];

/**
 * Warum ein Snapshot nicht geschrieben werden konnte.
 *
 * Eingefrorene Liste, gleiche Bauart wie `PLAN_COST_FACTS_PROBLEMS` und
 * `RATE_WRITE_PROBLEMS`: jeder Eintrag braucht spaeter genau eine HTTP-Abbildung.
 */
export const SNAPSHOT_WRITE_PROBLEMS = [
  /**
   * Derselbe Idempotenzschluessel fuer eine ANDERE Nutzlast.
   *
   * Kein Wiederholungsfall — ein Retry mit gleicher Nutzlast liefert dieselbe
   * Id und ist ein Erfolg. Dies hier ist ein Aufruferfehler. Der Mechanismus
   * dahinter ist der bestehende (`public.idempotency_records`, Migration
   * `0012`); dieser Port fuehrt keinen zweiten ein, er verlangt nur den
   * Schluessel im Kommando.
   */
  "IDEMPOTENCY_KEY_REUSED",
  /**
   * Der Baustellenfilter zeigt auf eine Baustelle ausserhalb des Mandanten.
   *
   * Die Datenbank lehnt das ueber den mandantengebundenen Fremdschluessel
   * `(worksite_id, org_id)` ab (Migration `0018`), unabhaengig von RLS. Der
   * Use-Case prueft es zusaetzlich vorher — dieser Grund ist die zweite Haelfte,
   * nicht die einzige.
   */
  "WORKSITE_NOT_IN_ORG",
  /**
   * Die persistente Kanalgrenze hat den Schreibversuch abgelehnt.
   *
   * Bedeutet ausschliesslich das: die Verbindung war nicht der Laufzeitkanal,
   * den `app.is_runtime_channel()` verlangt — etwa die PostgREST-Data-API oder
   * der Transaktionspooler. KEINE Umdeutung in einen Auth- oder Mandantenfehler:
   * das Subjekt kann korrekt angemeldet und berechtigt sein und trotzdem ueber
   * den falschen Kanal kommen. Ein `401`/`403` daraus zu machen schickte die
   * Betreiberin auf die Suche nach einem Rechteproblem, das es nicht gibt.
   */
  "WRITE_CHANNEL_REJECTED",
] as const;
export type SnapshotWriteProblem = (typeof SNAPSHOT_WRITE_PROBLEMS)[number];

/**
 * Warum ein Snapshot nicht gelesen werden konnte.
 *
 * Nur ein Grund, und das ist Absicht: „gibt es nicht", „gehoert einem anderen
 * Mandanten" und „das Subjekt darf Kosten nicht sehen" fallen zu EINER Antwort
 * zusammen. Die Unterscheidung waere ein Existenzleck — wer Ids durchprobiert,
 * erfuehre an der Antwort, welche echt sind. Gleiche Begruendung wie
 * `PLAN_VERSION_NOT_FOUND` im Faktenport.
 */
export const SNAPSHOT_READ_PROBLEMS = ["SNAPSHOT_NOT_FOUND"] as const;
export type SnapshotReadProblem = (typeof SNAPSHOT_READ_PROBLEMS)[number];

/**
 * Ein anzulegender Snapshot: Kopf und ALLE Positionen in einem Wert.
 *
 * Die Positionen stehen hier drin und nicht in einer zweiten Methode, weil der
 * Vorgang fachlich unteilbar ist (siehe {@link CostSnapshotRepository.create}).
 */
export interface NewCostSnapshot {
  /**
   * Die bereits AUFGELOESTE Organisation der schreibenden Identitaet.
   *
   * Gleiche Bauart und gleiche Begruendung wie `NewRateVersion.organisationId`:
   * der Wert ist eine Spalte der zu schreibenden Zeile, keine Autoritaet des
   * Aufrufers. Er stammt aus der `CostAccessPolicy`, nicht aus URL oder Rumpf,
   * und RLS prueft ihn ohnehin gegen `app.user_org_ids()` — eine erfundene
   * Organisation kommt nicht durch.
   */
  readonly organisationId: string;
  /**
   * Die veroeffentlichte Planversion, aus der die Fakten stammen.
   *
   * In der Datenbank ein Wert OHNE Fremdschluessel (Migration `0018`): ein
   * historisches Dokument soll die Planung weder festhalten noch mit ihr
   * verschwinden.
   */
  readonly planVersionId: string;
  /** Baustellenfilter, mit dem der Snapshot entstand. `null` = alle Baustellen. */
  readonly worksiteId: string | null;
  readonly weekKey: string;
  /** IANA-Zone, nach der die lokalen Tage abgegrenzt wurden. */
  readonly timeZone: string;
  /**
   * Waehrung des Snapshots.
   *
   * Als Literal und nicht als `string`: die Datenbank laesst per
   * `check (currency = 'EUR')` nichts anderes zu. Waere das Feld `string`,
   * verschoebe sich ein Tippfehler von einem Typfehler zu einem
   * Constraint-Verstoss zur Laufzeit. Kommt eine zweite Waehrung, aendert sich
   * dieser Typ, und jede betroffene Stelle meldet sich.
   */
  readonly currency: "EUR";
  /** Rechenregel, unter der die Positionen entstanden sind. */
  readonly ruleVersion: CostRuleVersion;
  /**
   * Vorberechnete Gesamtsumme in Minor Units.
   *
   * `bigint` und nicht `number`: Betraege ueberschreiten 2^53 zwar praktisch
   * nie, aber die Umrechnung ueber `number` waere die Stelle, an der Genauigkeit
   * still verloren geht. Die Uebersetzung nach `::text` passiert im Repository
   * (Task 11), nicht hier.
   */
  readonly totalMinorUnits: bigint;
  /**
   * Erstellungszeitpunkt des Kopfes.
   *
   * Reist herein statt aus `now()` zu entstehen (Plan Session B, „Task 10"):
   * der Use-Case bekommt seine Uhr als Abhaengigkeit und ist damit ohne
   * Zeitmanipulation testbar. Der Default `now()` der Migration bleibt als
   * Schutz des direkten Schreibwegs bestehen; auf diesem Pfad feuert er nicht.
   */
  readonly createdAt: Date;
  readonly correlationId: string;
  /**
   * Der Wiederholungsschluessel des Aufrufers.
   *
   * Verlangt, weil `POST /kosten/snapshots` ihn im Vertrag fuehrt und ein Retry
   * nach abgerissener Verbindung sonst einen ZWEITEN Snapshot anlegte. Der
   * Abgleich laeuft ueber die bestehende Infrastruktur (Task 11); hier steht nur
   * die Information, ohne die er nicht laufen kann.
   */
  readonly idempotencyKey: string;
  /**
   * Die Positionen in ihrer endgueltigen Reihenfolge.
   *
   * Die Reihenfolge dieses Arrays IST das gespeicherte `ordinal`
   * (`unique (snapshot_id, ordinal)`, Migration `0018`). Deshalb traegt die
   * Position bewusst KEIN eigenes `ordinal`-Feld: zwei Quellen fuer dieselbe
   * Ordnung koennten sich widersprechen, und der Widerspruch faellt niemandem
   * auf — beide Varianten sehen sortiert aus.
   *
   * Darf leer sein. Eine veroeffentlichte Planversion ohne Zuweisungen ergibt
   * einen Kopf mit Summe 0 und keinen Positionen; die Datenbank laesst genau das
   * zu (`total_minor_units >= 0`). Deshalb steht `ruleVersion` oben im Kopf und
   * nicht nur auf den Positionen — sonst waere sie bei leerer Liste nirgends.
   */
  readonly positions: readonly AssembledPosition[];
}

/**
 * Eine gespeicherte Position, so wie das Repository sie zurueckgibt.
 *
 * Abgeleitet von {@link AssembledPosition}, damit beide Formen nicht getrennt
 * driften — die Tabelle speichert, was die Montage erzeugt hat. Zwei bewusste
 * Unterschiede:
 *
 * - `ruleVersion` faellt weg. `cost_snapshot_positions` hat keine solche Spalte;
 *   sie steht einmal im Kopf. Sie hier zu fuehren hiesse, sie beim Lesen aus dem
 *   Kopf zu kopieren und damit eine Spalte zu behaupten, die es nicht gibt.
 * - `id` kommt hinzu. Sie entsteht erst beim Schreiben und ist Teil der
 *   Antwortform (`CostPositionDto.id`).
 *
 * Kein `ordinal`, aus demselben Grund wie oben: die Reihenfolge des Arrays ist
 * die gespeicherte Ordnung. Das Repository liest `order by ordinal`.
 */
export type StoredCostSnapshotPosition = Omit<AssembledPosition, "ruleVersion"> & {
  readonly id: string;
};

/**
 * Ein gespeicherter Snapshot, unveraendert aus der Datenbank.
 *
 * Enthaelt bewusst KEINE Tagessummen: `days` ist eine Ableitung aus den
 * Positionen und entsteht an der HTTP-Naht. Stuende sie hier, muesste das
 * Repository rechnen — und der Unterschied zwischen „gespeichert" und
 * „berechnet" waere an der Portgrenze nicht mehr ablesbar.
 */
export interface StoredCostSnapshot {
  readonly id: string;
  readonly organisationId: string;
  readonly planVersionId: string;
  readonly worksiteId: string | null;
  readonly weekKey: string;
  readonly timeZone: string;
  /** Durch `check (currency = 'EUR')` in Migration `0018` garantiert. */
  readonly currency: "EUR";
  /**
   * Die Regel, unter der DIESER Snapshot gerechnet wurde — bewusst `string`.
   *
   * Nicht {@link CostRuleVersion}: das ist die Regel, unter der HEUTE
   * geschrieben werden darf. Ein unter v1 entstandener Snapshot bleibt v1, auch
   * wenn v2 die aktuelle Regel ist. Waere dieses Feld auf die aktuelle Version
   * getippt, machte der Wechsel auf v2 jeden bestehenden Snapshot untypisierbar
   * — und die Leseroute antwortete mit einem Vertragsfehler auf korrekt
   * gespeicherte Daten. Die Spalte traegt aus demselben Grund nur
   * `length(trim(...)) > 0` und keine Wertebeschraenkung, waehrend `currency`
   * eine hat; die Asymmetrie ist gemessen, nicht geraten.
   */
  readonly ruleVersion: string;
  readonly totalMinorUnits: bigint;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly correlationId: string;
  /** In der gespeicherten Reihenfolge (`order by ordinal`). */
  readonly positions: readonly StoredCostSnapshotPosition[];
}

export type SnapshotWriteResult =
  | {
      readonly ok: true;
      /**
       * Die Id des Snapshots — bei einer Wiederholung dieselbe wie beim ersten
       * Aufruf.
       *
       * Bewusst nicht der ganze Snapshot: `create` ist ein Kommando, `read` die
       * Abfrage. Gaebe `create` den gelesenen Stand zurueck, muesste es entweder
       * zurueckschreiben oder aus der Eingabe rekonstruieren — im zweiten Fall
       * saehe die Antwort des Wiederholungsfalls anders aus als die des ersten
       * Aufrufs, obwohl beide denselben Vorgang meinen.
       */
      readonly snapshotId: string;
    }
  | { readonly ok: false; readonly problem: SnapshotWriteProblem };

export type SnapshotReadResult =
  | { readonly ok: true; readonly snapshot: StoredCostSnapshot }
  | { readonly ok: false; readonly problem: SnapshotReadProblem };

export interface CostSnapshotRepository {
  /**
   * Legt Kopf und ALLE Positionen als eine atomare Repositoryoperation an.
   *
   * Bewusst kein `createHeader()` / `appendPosition()` / `finish()`: eine solche
   * API liesse Teilzustaende entstehen — einen Kopf ohne Positionen, der
   * aussieht wie ein Snapshot ueber 0,00 EUR. Die Datenbank kennt keinen Weg,
   * ihn nachtraeglich zu vervollstaendigen oder zu loeschen; der Teilzustand
   * waere dauerhaft. Alles oder nichts ist deshalb keine Bequemlichkeit,
   * sondern die einzige Form, die zu einem unveraenderlichen Dokument passt.
   */
  create(input: NewCostSnapshot): Promise<SnapshotWriteResult>;

  /**
   * Liest ausschliesslich den bereits GESPEICHERTEN Stand. Rechnet nichts neu.
   *
   * Deshalb nimmt diese Methode nur die Id — keine Saetze, keine Planfakten,
   * keinen Zeitpunkt. Waere hier ein Satz- oder Planungseingang, koennte eine
   * spaetere Satzaenderung historische Kosten umdeuten: derselbe Snapshot
   * zeigte andere Zahlen, und der Export (EYT-110) lieferte fuer dieselbe Id
   * zweimal etwas anderes. Die Signatur macht das strukturell unmoeglich.
   */
  read(snapshotId: string): Promise<SnapshotReadResult>;
}

/** Je Anfrage ein Repository mit dem Subjekt der Anfrage — nie ein Singleton. */
export type CostSnapshotRepositoryFactory = (subjectUserId: string) => CostSnapshotRepository;

export const COST_SNAPSHOT_REPOSITORY_FACTORY = "COST_SNAPSHOT_REPOSITORY_FACTORY";
