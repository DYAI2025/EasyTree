/**
 * Der Snapshot-Command (EYT-109, Task 10).
 *
 * ## Was dieser Use-Case ist
 *
 * Orchestrierung, sonst nichts. Er liest versionsgenaue Planfakten, prueft den
 * Baustellenfilter, holt die noetigen Satzhistorien, laesst die Domaene montieren,
 * bildet die Summe, schreibt einmal und liest den geschriebenen Stand zurueck.
 * Jede fachliche Entscheidung liegt woanders: die Satzauswahl je Leistungstag in
 * `assembleCostSnapshotPositions`, die Mandantengrenze in RLS und in der
 * `CostAccessPolicy`, die Kanalgrenze in der Datenbank.
 *
 * ## Warum die Reihenfolge bindend ist
 *
 * Ein Snapshot ist ein unveraenderliches Dokument: es gibt kein `update` und kein
 * `delete` (Migration 0018, keine Grants). Was faelschlich geschrieben wurde,
 * bleibt. Deshalb steht JEDE Blockade vor `create` — nicht aus Stilgefuehl,
 * sondern weil der Teilzustand sonst dauerhaft waere.
 *
 * ## Warum nach dem Schreiben gelesen wird
 *
 * `create` gibt nur eine Id zurueck; Positions-Ids, `createdBy` und der
 * tatsaechlich gespeicherte Kopf entstehen in der Datenbank. Aus der Eingabe
 * eine Antwort zu rekonstruieren hiesse, im Wiederholungsfall etwas anderes zu
 * antworten als beim ersten Aufruf — obwohl beide denselben Vorgang meinen. Ein
 * Replay-Kennzeichen braucht es dadurch nicht: die Aufruferin bekommt in beiden
 * Faellen denselben gespeicherten Stand.
 *
 * ## Was hier bewusst NICHT steht
 *
 * Keine Uhr (`now` reist als Abhaengigkeit herein), keine Id-Erzeugung, keine
 * Tagessummen (`days` entsteht an der HTTP-Naht, Task 13), keine Zod-Pruefung,
 * keine Autorisierung, kein Audit, kein `subjectUserId` — die uebergebenen Ports
 * sind bereits an das Subjekt der Anfrage gebunden (Factory-Muster).
 *
 * ## Ein Lesezeitpunkt fuer alle Satzhistorien (EYT-138)
 *
 * Die Historien kommen aus EINER Lesung (`versionsForMany`): eine Anweisung,
 * eine Transaktion, ein Lesezeitpunkt. Die frueher hier dokumentierte
 * Einschraenkung ist damit erledigt, und der Absatz bleibt stehen, damit ihre
 * Aufloesung sichtbar ist statt bloss ihre Abwesenheit.
 *
 * Der alte Weg rief `versionsFor` je Mitarbeitendem auf; jeder Aufruf oeffnete
 * in der PostgreSQL-Umsetzung seine eigene Verbindung mit eigenem
 * `begin`/`commit`. Eine waehrend des Faechers committete Satzversion konnte
 * fuer einen Teil der Mitarbeitenden schon sichtbar sein und fuer den Rest noch
 * nicht — der Snapshot mischte zwei Datenbankzustaende und widersprach damit
 * der Zusage „unveraenderliches Dokument" weiter oben. Der Faecher lief
 * ausserdem unbegrenzt gegen die Standardgroesse des Pools (10).
 *
 * Die Eigenschaft haengt an der ANWEISUNGSZAHL, nicht an einem Isolationslevel:
 * PostgreSQL wertet jede Anweisung gegen genau einen MVCC-Snapshot aus, auch
 * unter `read committed`. Gemessen wird sie deshalb als Transaktions- und
 * Anweisungszaehlung — hier in `test/costs/create-cost-snapshot.use-case.test.ts`,
 * an der Datenbankgrenze in `test/costs/rate-batch-read.test.ts`.
 */
import { COST_RULE_VERSION } from "@easytree/domain";
import { assembleCostSnapshotPositions } from "../domain/cost-snapshot-assembly";
import type { SnapshotAssemblyResult } from "../domain/cost-snapshot-assembly";
import type {
  CostSnapshotRepository,
  SnapshotReadResult,
  SnapshotWriteProblem,
  SnapshotWriteResult,
  StoredCostSnapshot,
} from "./cost-snapshot-repository.port";
import type { PlanCostFactsPort, PlanCostFactsResult } from "./plan-cost-facts.port";
import type { RateRepository, RateVersionRecord } from "./rate-repository.port";

/**
 * Das Kommando.
 *
 * `organisationId` ist eine bereits SERVERSEITIG aufgeloeste Tatsache aus der
 * `CostAccessPolicy` und stammt nie aus `CreateCostSnapshotCommandSchema`: der
 * HTTP-Rumpf kennt nur `publishedPlanVersionId` und `worksiteId`. Eine
 * clientseitige Organisationsautoritaet gaebe es damit nicht — und soll es auch
 * nicht geben (REQ-002).
 */
export interface CreateCostSnapshotCommand {
  readonly organisationId: string;
  readonly publishedPlanVersionId: string;
  /** `null` = alle Baustellen der Planversion. */
  readonly worksiteId: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface CreateCostSnapshotDependencies {
  readonly facts: PlanCostFactsPort;
  readonly rates: RateRepository;
  readonly repository: CostSnapshotRepository;
  /**
   * Die Uhr als kleinste moegliche Abhaengigkeit.
   *
   * Kein globaler Clock-Dienst: ein `now: () => Date` ist im Test ein Literal
   * und in der Verdrahtung ein Einzeiler. Ein `new Date()` im Rumpf machte den
   * Erstellungszeitpunkt unpruefbar.
   */
  readonly now: () => Date;
}

/**
 * Der Fehlerzweig eines bestehenden Resultattyps, ohne dessen `ok`.
 *
 * `Extract` statt abgeschriebener Stringlisten: verschwaende jemand einen Grund
 * aus einer der eingefrorenen Listen, wird dieser Typ enger und die betroffene
 * Rueckgabe kompiliert nicht mehr. Eine zweite Liste haette den Verlust
 * verschwiegen.
 */
type Failure<T> = Omit<Extract<T, { ok: false }>, "ok">;

/**
 * Warum kein Snapshot entstanden ist — nach Abschnitt getrennt.
 *
 * Das `stage`-Feld ist keine zweite Fehlertaxonomie, sondern die Fehlerliste,
 * aus der der Grund stammt — nicht der Abschnitt, in dem er entstanden ist:
 * `WORKSITE_NOT_IN_ORG` traegt `stage: "WRITE"`, obwohl der Use-Case es
 * feststellt, BEVOR geschrieben wird. Die Problemnamen selbst sind unveraendert
 * die der bestehenden Ports. Es steht hier, weil nur der Montagezweig
 * Kontextfelder traegt und die HTTP-Abbildung (Task 13) ohne `as`-Cast
 * erschoepfend werden soll.
 */
export type CreateCostSnapshotFailure =
  | ({ readonly stage: "FACTS" } & Failure<PlanCostFactsResult>)
  | ({ readonly stage: "ASSEMBLY" } & Failure<SnapshotAssemblyResult>)
  | ({ readonly stage: "WRITE" } & Failure<SnapshotWriteResult>)
  | ({ readonly stage: "READ" } & Failure<SnapshotReadResult>);

export type CreateCostSnapshotResult =
  | { readonly ok: true; readonly snapshot: StoredCostSnapshot }
  | ({ readonly ok: false } & CreateCostSnapshotFailure);

/**
 * Derselbe Grund, den das Repository beim Schreiben nennt — hier nur frueher.
 *
 * Ueber `Extract` an die eingefrorene Liste gebunden statt als nacktes Literal:
 * verschwaende der Name dort, wuerde dieser Typ `never` und die Zuweisung rot.
 * Ein zweiter, unabhaengiger String saehe dagegen bis zur HTTP-Naht korrekt aus.
 */
const WORKSITE_NOT_IN_ORG: Extract<SnapshotWriteProblem, "WORKSITE_NOT_IN_ORG"> =
  "WORKSITE_NOT_IN_ORG";

export async function createCostSnapshot(
  deps: CreateCostSnapshotDependencies,
  command: CreateCostSnapshotCommand,
): Promise<CreateCostSnapshotResult> {
  // 1. Versionsgenaue Fakten. Nicht `publishedFacts(weekKey)`: dessen Antwort
  //    haengt an der Woche und koennte einen neuen, unveroeffentlichten Entwurf
  //    derselben Woche einfrieren.
  const faktenErgebnis = await deps.facts.publishedFactsForVersion(command.publishedPlanVersionId);
  if (!faktenErgebnis.ok) {
    return { ok: false, stage: "FACTS", problem: faktenErgebnis.problem };
  }
  const facts = faktenErgebnis.facts;

  // 2. Baustellenfilter gegen die BEZEICHNUNGEN pruefen, nicht gegen die
  //    Einsaetze: eine eigene Baustelle ohne Einsatz bleibt eine eigene
  //    Baustelle und ergibt einen leeren Snapshot. Wer hier „hat mindestens
  //    einen Einsatz" pruefte, verwandelte ein leeres Ergebnis in einen Fehler.
  if (command.worksiteId !== null && !facts.worksiteLabels.has(command.worksiteId)) {
    return { ok: false, stage: "WRITE", problem: WORKSITE_NOT_IN_ORG };
  }

  // 3. Nur die tatsaechlich beteiligten Mitarbeitenden, dedupliziert. Ein
  //    ungefiltertes Laden waere eine Satzlesung fuer Personen, die im Snapshot
  //    nicht vorkommen.
  //
  //    ACHTUNG — dasselbe Praedikat steht ein zweites Mal in
  //    `cost-snapshot-assembly.ts` (dort entscheidet es, WAS montiert wird;
  //    hier, WESSEN Saetze geladen werden). Laufen die beiden auseinander,
  //    trifft die Montage auf einen Einsatz, dessen Mitarbeitende in
  //    `ratesByEmployee` fehlt, greift dort auf `?? []` und meldet
  //    `RATE_NOT_FOUND` fuer eine Person, deren Satz sehr wohl existiert — laut,
  //    aber mit irrefuehrender Diagnose. Kein Test kann das fangen, wenn die
  //    Divergenz auf BEIDEN Seiten zugleich eingebaut wird; die beiden Filter
  //    gehoeren perspektivisch hinter ein gemeinsames Praedikat (nicht in Task
  //    10 aenderbar: das beruehrte `cost-snapshot-assembly.ts`, das an seinem
  //    eigenen Nachweisgatter bereits abgenommen ist).
  const relevant =
    command.worksiteId === null
      ? facts.work
      : facts.work.filter((einsatz) => einsatz.worksiteId === command.worksiteId);
  const employeeIds = [...new Set<string>(relevant.map((einsatz) => einsatz.employeeId))];
  // EINE Lesung, ein Lesezeitpunkt (EYT-138). Ein Faecher aus N Einzelaufrufen
  // koennte zwei Datenbankzustaende in EINEN unveraenderlichen Snapshot mischen.
  const ratesByEmployee: ReadonlyMap<string, readonly RateVersionRecord[]> =
    await deps.rates.versionsForMany(employeeIds);

  // 4. Montage. Die Auswahl des Satzes je lokalem Leistungstag passiert
  //    ausschliesslich dort.
  const montage = assembleCostSnapshotPositions({
    facts,
    worksiteFilter: command.worksiteId,
    employeeLabels: facts.employeeLabels,
    worksiteLabels: facts.worksiteLabels,
    ratesByEmployee,
  });
  if (!montage.ok) {
    // Vollstaendig erhalten — `employeeId` und `localDate` sind der Unterschied
    // zwischen „ein Satz fehlt" und „irgendwo fehlt ein Satz".
    return {
      ok: false,
      stage: "ASSEMBLY",
      problem: montage.problem,
      assignmentId: montage.assignmentId,
      employeeId: montage.employeeId,
      localDate: montage.localDate,
    };
  }

  // 5. Summe in Minor Units, durchgehend `bigint`. Ein `Number(...)` waere die
  //    Stelle, an der Genauigkeit still verloren geht.
  const totalMinorUnits = montage.positions.reduce(
    (summe, position) => summe + position.amountMinorUnits,
    0n,
  );

  // 6. Ein Schreibvorgang, Kopf und alle Positionen zusammen. `planVersionId`,
  //    `weekKey` und `timeZone` kommen aus den gelesenen Fakten, nicht aus dem
  //    Kommando; `ruleVersion` aus der kanonischen Konstante, nicht aus
  //    `positions[0]` — den gibt es bei leerer Liste nicht.
  const schreiben = await deps.repository.create({
    organisationId: command.organisationId,
    planVersionId: facts.planVersionId,
    worksiteId: command.worksiteId,
    weekKey: facts.weekKey,
    timeZone: facts.timeZone,
    currency: "EUR",
    ruleVersion: COST_RULE_VERSION,
    totalMinorUnits,
    createdAt: deps.now(),
    correlationId: command.correlationId,
    idempotencyKey: command.idempotencyKey,
    positions: montage.positions,
  });
  if (!schreiben.ok) {
    return { ok: false, stage: "WRITE", problem: schreiben.problem };
  }

  // 7. Persistenzwahrheit statt Rekonstruktion — auch und gerade beim Retry.
  const gelesen = await deps.repository.read(schreiben.snapshotId);
  if (!gelesen.ok) {
    return { ok: false, stage: "READ", problem: gelesen.problem };
  }
  return { ok: true, snapshot: gelesen.snapshot };
}
