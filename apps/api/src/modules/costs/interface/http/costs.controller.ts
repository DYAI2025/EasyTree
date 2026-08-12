/**
 * Kosten-Endpunkte (EYT-106/EYT-108/EYT-139): Mitarbeiterliste, Satzhistorie,
 * neue Satzversion, Snapshot erzeugen und Snapshot lesen.
 *
 * ## Reihenfolge jeder Anfrage, ohne Ausnahme
 *
 *   1. Identitaet (Cookie ODER Bearer, verifiziert, Session lebt)
 *   2. Mitgliedschaften und Rechte SERVERSEITIG aufloesen
 *   3. `CostAccessPolicy`: Organisation waehlen und Recht pruefen
 *   4. Entscheidung protokollieren — erlaubt wie abgelehnt
 *   5. erst dann die fachliche Arbeit
 *
 * Keine Rollenabfrage in diesem Controller (PO-Entscheidung): er fragt die
 * Policy, nie die Rolle. Und selbst wenn die Policy irrte, lehnte RLS
 * unabhaengig ab (Migration 0013) — das ist die Unabhaengigkeitszusage AK4.
 *
 * ## Warum das Protokoll hier steht und nicht in einem Interceptor
 *
 * Ein Interceptor saehe den Statuscode, nicht die Entscheidung. `403` sagt
 * nicht, WELCHES Recht gefehlt hat, und `ORG_NOT_A_MEMBER` und
 * `PERMISSION_MISSING` antworten absichtlich identisch, damit die Antwort
 * nicht verraet, ob eine fremde Organisation existiert. Nur hier, an der
 * einen Zugangskette, sind Recht, bestaetigte Organisation und stabiler
 * Ablehnungsgrund gleichzeitig bekannt (EYT-106 AK9).
 *
 * ## Zwei Zugangsmethoden, eine Zugangskette (EYT-139)
 *
 * {@link CostsController.zugang} bleibt die EINE Kette und wird von allen fuenf
 * Routen benutzt. Sie liefert seit EYT-139 zusaetzlich das Snapshot-Repository:
 * das braucht nur das Subjekt, kostet nichts und hat damit genau eine
 * Konstruktionsstelle.
 *
 * Der FAKTENPORT steht bewusst nicht dort, sondern in
 * {@link CostsController.snapshotAbhaengigkeiten} — der einen Konstruktionsstelle
 * der Snapshot-Abhaengigkeiten, die ausschliesslich der Schreibpfad ruft. Der
 * Grund ist strukturell:
 *
 * `GET /kosten/snapshots/{snapshotId}` liest einen gespeicherten Stand und
 * rechnet nichts neu. Wuerde die Zugangskette den Planungs-Faktenport auch dort
 * bauen, waere „rechnet nichts neu" nur noch eine Behauptung ueber den Rumpf der
 * Methode statt eine Eigenschaft der Verdrahtung. Der Test misst genau das
 * (`H8`, Zaehler `fabrikaufrufe`).
 *
 * Eine frueher hier stehende zweite Begruendung — die drei Satzrouten
 * bezahlten sonst „Arbeit je Anfrage ohne Gegenwert" — ist gestrichen, weil sie
 * gemessen nicht traegt: `planCostFactsFactory` ist wie `snapshotsFor` nur ein
 * Feldzuweisungs-Konstruktor, und derselbe Absatz nennt diese Kosten oben
 * „kostet nichts". Eine zu starke Begruendung ist auch eine falsche.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
} from "@nestjs/common";
import type { Request } from "express";

import {
  CreateCostSnapshotCommandSchema,
  CreateRateVersionCommandSchema,
  IDEMPOTENCY_HEADER,
  IdSchema,
  IdempotencyKeySchema,
  type CostSnapshot,
  type EmployeesForRates,
  type RateHistory,
  type RateVersionDto,
} from "@easytree/contracts";

import type { RequestWithCorrelationId } from "../../../../common/correlation-id.middleware";
import {
  RequestIdentityService,
  REQUEST_IDENTITY,
} from "../../../../platform/auth/request-identity";
// Zugriff auf ein fremdes Modul NUR ueber dessen index.ts (ADR-001 Z. 76) —
// der Architekturtest hat den direkten Dateizugriff zu Recht gemeldet.
import {
  AuthProblemFilter,
  SESSION_ORGANISATIONS,
  type SessionOrganisationsPort,
} from "../../../tenancy";
// Die Mitarbeiterliste kommt aus dem WORKFORCE-Modul: `public.employees`
// gehoert dort hin, und `costs` liest ausschliesslich eigene Tabellen.
import { EMPLOYEE_DIRECTORY_FACTORY, type EmployeeDirectoryFactory } from "../../../workforce";
import {
  COST_ACCESS_AUDIT,
  COST_ACCESS_DECISION_EVENT,
  pseudonymSubjekt,
  type CostAccessAuditLog,
  type CostAccessDecisionEvent,
  type CostAccessDenyReason,
} from "../../application/cost-access-audit.port";
import {
  COST_ACCESS_POLICY,
  type CostAccessPolicy,
  type CostPermission,
} from "../../application/cost-access.policy";
import {
  COST_SNAPSHOT_REPOSITORY_FACTORY,
  type CostSnapshotRepository,
  type CostSnapshotRepositoryFactory,
  type SnapshotReadProblem,
  type SnapshotWriteProblem,
} from "../../application/cost-snapshot-repository.port";
import {
  createCostSnapshot,
  type CreateCostSnapshotDependencies,
  type CreateCostSnapshotFailure,
} from "../../application/create-cost-snapshot.use-case";
import {
  PLAN_COST_FACTS_FACTORY,
  type PlanCostFactsFactory,
  type PlanCostFactsProblem,
} from "../../application/plan-cost-facts.port";
import {
  RATE_REPOSITORY_FACTORY,
  type RateRepository,
  type RateRepositoryFactory,
  type RateVersionRecord,
  type RateWriteProblem,
} from "../../application/rate-repository.port";
import type { SnapshotAssemblyProblem } from "../../domain/cost-snapshot-assembly";
import { effectiveRateVersion, rateVersionStatus } from "../../domain/rate-effectivity";
import { toCostSnapshotDto } from "./cost-snapshot.dto";
import {
  COSTS_ERROR_TYPE,
  RATE_ERROR_TYPE,
  SNAPSHOT_ASSEMBLY_ERROR_TYPE,
  SNAPSHOT_READ_ERROR_TYPE,
  SNAPSHOT_WRITE_ERROR_TYPE,
} from "./costs-error-type";
import { ConflictProblem } from "./conflict-problem";
import { CostsProblem, type CostsProblemStatus } from "./costs-problem";
import { CostsProblemFilter } from "./costs-problem.filter";

/** Der Header waehlt die Organisation aus. Er autorisiert nichts. */
const ORGANISATION_HEADER = "x-easytree-organization-id";

@Controller("kosten")
@UseFilters(AuthProblemFilter, CostsProblemFilter)
export class CostsController {
  constructor(
    @Inject(REQUEST_IDENTITY) private readonly identitaet: RequestIdentityService,
    @Inject(SESSION_ORGANISATIONS) private readonly organisationen: SessionOrganisationsPort,
    @Inject(COST_ACCESS_POLICY) private readonly policy: CostAccessPolicy,
    @Inject(RATE_REPOSITORY_FACTORY) private readonly repositoryFor: RateRepositoryFactory,
    @Inject(EMPLOYEE_DIRECTORY_FACTORY)
    private readonly employeeDirectoryFor: EmployeeDirectoryFactory,
    @Inject(COST_ACCESS_AUDIT) private readonly audit: CostAccessAuditLog,
    // EYT-139: beide Fabriken, nie ein fertiger Port. Ein Singleton truege die
    // Identitaet — und beim Faktenport zusaetzlich die Organisation — der
    // ERSTEN Anfrage in alle folgenden.
    @Inject(PLAN_COST_FACTS_FACTORY) private readonly factsFor: PlanCostFactsFactory,
    @Inject(COST_SNAPSHOT_REPOSITORY_FACTORY)
    private readonly snapshotsFor: CostSnapshotRepositoryFactory,
  ) {}

  @Get("mitarbeiter")
  async employees(
    @Req() req: Request,
    @Headers(ORGANISATION_HEADER) organisationHeader?: string,
  ): Promise<EmployeesForRates> {
    const { subjectUserId } = await this.zugang(
      req,
      organisationHeader,
      "costs.read",
      "GET /kosten/mitarbeiter",
    );
    const mitarbeiter = await this.employeeDirectoryFor(subjectUserId).list();
    return {
      employees: mitarbeiter.map((person) => ({
        id: person.id,
        displayName: person.displayName,
        active: person.active,
      })),
    };
  }

  @Get("stundensaetze/:employeeId")
  async rateHistory(
    @Req() req: Request,
    @Param("employeeId") employeeId: string,
    @Headers(ORGANISATION_HEADER) organisationHeader?: string,
  ): Promise<RateHistory> {
    const { rates } = await this.zugang(
      req,
      organisationHeader,
      "costs.read",
      "GET /kosten/stundensaetze/{employeeId}",
    );
    const versionen = await rates.versionsFor(employeeId);
    const heute = heutigesGeschaeftsdatum();
    const wirksam = effectiveRateVersion(versionen, heute);
    return {
      employeeId,
      activeVersionId: wirksam.ok ? wirksam.version.id : null,
      versions: versionen.map((version) => toDto(version, heute)),
    };
  }

  @Post("stundensaetze")
  async createRateVersion(
    @Req() req: Request,
    @Body() body: unknown,
    @Headers(ORGANISATION_HEADER) organisationHeader?: string,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<RateVersionDto> {
    // Anlegen braucht ein ANDERES Recht als Lesen — atomar, nicht "wer lesen
    // darf, darf auch schreiben".
    const { rates, organisationId } = await this.zugang(
      req,
      organisationHeader,
      "costs.manage_rates",
      "POST /kosten/stundensaetze",
    );

    // Der Vertrag deklariert den Schluessel als required. Er wird HIER
    // geprueft und nicht erst im Repository: ohne ihn gibt es keinen
    // Wiederholungsschutz, und eine Anfrage ohne Schutz darf gar nicht erst
    // in die Transaktion.
    const schluessel = IdempotencyKeySchema.safeParse(idempotencyKey);
    if (!schluessel.success) {
      throw new ConflictProblem(
        RATE_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY,
        "Diese Anfrage braucht einen gueltigen Idempotency-Key. Ohne ihn koennte eine Wiederholung eine zweite Satzversion anlegen.",
      );
    }

    const geprueft = CreateRateVersionCommandSchema.safeParse(body);
    if (!geprueft.success) {
      throw new BadRequestException(
        `Ungueltige Satzversion: ${geprueft.error.issues.map((i) => i.path.join(".") || "koerper").join(", ")}`,
      );
    }

    const ergebnis = await rates.append({
      organisationId,
      employeeId: geprueft.data.employeeId,
      amountMinorUnits: geprueft.data.amountMinorUnits,
      validFrom: geprueft.data.validFrom,
      validTo: geprueft.data.validTo,
      reason: geprueft.data.reason,
      expectedActiveVersionId: geprueft.data.expectedActiveVersionId,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unbekannt",
      idempotencyKey: schluessel.data,
    });

    if (!ergebnis.ok) throw problemFor(ergebnis.problem);
    return toDto(ergebnis.version, heutigesGeschaeftsdatum());
  }

  /**
   * Erzeugt aus einer VEROEFFENTLICHTEN Planversion einen unveraenderlichen
   * Personalkosten-Snapshot (EYT-139).
   *
   * Reihenfolge, und sie ist bindend: Zugangskette, dann Idempotenzschluessel,
   * dann Rumpf, dann erst der Use-Case. Der Schluessel steht VOR dem Rumpf und
   * VOR jedem Portzugriff — eine Anfrage ohne Wiederholungsschutz darf gar
   * nicht erst in die Transaktion, und ein Snapshot laesst sich nicht mehr
   * loeschen (Migration 0018, keine Grants).
   *
   * `organisationId` kommt AUSSCHLIESSLICH aus der Zugangskette.
   * `CreateCostSnapshotCommandSchema` kennt das Feld nicht; ein `organisationId`
   * im Rumpf faellt am `strictObject` durch.
   */
  @Post("snapshots")
  async createSnapshot(
    @Req() req: Request,
    @Body() body: unknown,
    @Headers(ORGANISATION_HEADER) organisationHeader?: string,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<CostSnapshot> {
    // Rechnen ist ein anderes Recht als Lesen: wer Kosten sehen darf, darf
    // deshalb noch lange keinen revisionssicheren Stand einfrieren.
    const zugang = await this.zugang(
      req,
      organisationHeader,
      "costs.calculate",
      "POST /kosten/snapshots",
    );

    const schluessel = IdempotencyKeySchema.safeParse(idempotencyKey);
    if (!schluessel.success) {
      throw new ConflictProblem(
        RATE_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY,
        "Diese Anfrage braucht einen gueltigen Idempotency-Key. Ohne ihn koennte eine Wiederholung einen zweiten Snapshot anlegen — und ein Snapshot laesst sich nicht loeschen.",
      );
    }

    const geprueft = CreateCostSnapshotCommandSchema.safeParse(body);
    if (!geprueft.success) {
      throw new BadRequestException(
        `Ungueltiger Snapshot-Auftrag: ${geprueft.error.issues.map((i) => i.path.join(".") || "koerper").join(", ")}`,
      );
    }

    const ergebnis = await createCostSnapshot(this.snapshotAbhaengigkeiten(zugang), {
      organisationId: zugang.organisationId,
      publishedPlanVersionId: geprueft.data.publishedPlanVersionId,
      worksiteId: geprueft.data.worksiteId,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unbekannt",
      idempotencyKey: schluessel.data,
    });
    if (!ergebnis.ok) throw snapshotProblemFor(ergebnis);
    // Der zurueckgelesene Stand, nicht die Eingabe. Beim Retry ist das der
    // Unterschied zwischen „dieselbe Wahrheit" und „nochmal dieselbe Frage".
    return toCostSnapshotDto(ergebnis.snapshot);
  }

  /**
   * Liest den GESPEICHERTEN Snapshot. Rechnet nichts neu (EYT-139).
   *
   * Deshalb baut dieser Pfad keinen Faktenport und keine Satzhistorie: was
   * hier nicht konstruiert wird, kann auch nicht heimlich in die Antwort
   * einfliessen.
   */
  @Get("snapshots/:snapshotId")
  async snapshot(
    @Req() req: Request,
    @Param("snapshotId") snapshotId: string,
    @Headers(ORGANISATION_HEADER) organisationHeader?: string,
  ): Promise<CostSnapshot> {
    const { snapshots } = await this.zugang(
      req,
      organisationHeader,
      "costs.read",
      "GET /kosten/snapshots/{snapshotId}",
    );

    const geprueft = IdSchema.safeParse(snapshotId);
    if (!geprueft.success) {
      throw new BadRequestException(
        "Die angegebene Snapshot-Id ist keine gueltige Id. Bitte den Link aus der Kostenansicht verwenden.",
      );
    }

    const gelesen = await snapshots.read(geprueft.data);
    if (!gelesen.ok) throw leseProblem(gelesen.problem);
    return toCostSnapshotDto(gelesen.snapshot);
  }

  /**
   * Die EINE Konstruktionsstelle der Snapshot-Abhaengigkeiten (EYT-139).
   *
   * Sie nimmt den Rueckgabewert der Zugangskette entgegen und ergaenzt genau
   * eines: den Faktenport. Bindend ist dabei, WOMIT er gebaut wird —
   * `zugang.organisationId` ist der Wert, den `CostAccessPolicy.authorize`
   * serverseitig aus den Mitgliedschaften aufgeloest hat. Nicht der Header
   * (unbestaetigter Wunsch) und nicht `mitgliedschaften[0]` (bei mehreren
   * Mitgliedschaften schlicht geraten). Beides saehe im Erfolgsfall des
   * Ein-Organisations-Benutzers korrekt aus und rechnete beim
   * Mehr-Organisations-Benutzer im falschen Mandanten.
   */
  private snapshotAbhaengigkeiten(zugang: {
    rates: RateRepository;
    snapshots: CostSnapshotRepository;
    organisationId: string;
    subjectUserId: string;
  }): CreateCostSnapshotDependencies {
    return {
      facts: this.factsFor(zugang.subjectUserId, zugang.organisationId),
      rates: zugang.rates,
      repository: zugang.snapshots,
    };
  }

  /** Die eine Zugangskette. Wirft, wenn irgendetwas daran nicht traegt. */
  private async zugang(
    req: Request,
    organisationHeader: string | undefined,
    permission: CostPermission,
    route: string,
  ): Promise<{
    /**
     * Die Satzhistorie je Subjekt.
     *
     * Heisst `rates` und nicht `repository`: `snapshotAbhaengigkeiten` bildet
     * daraus `repository: zugang.snapshots` ab, und zwei verschiedene Dinge
     * unter demselben Namen sind an genau der Naht, die beide zusammenfuehrt,
     * eine Leseeinladung zum Vertauschen. Die Typen verhindern den Fehler, der
     * Name soll ihn gar nicht erst nahelegen.
     */
    rates: RateRepository;
    /**
     * Das Snapshot-Repository — je Subjekt, hier gebaut und nirgends sonst.
     *
     * Es steht in DIESER Methode und nicht erst im Schreibpfad, weil die
     * Leseroute nichts anderes braucht als die Zugangsentscheidung und dieses
     * Repository. Zwei Konstruktionsstellen fuer dieselbe Fabrik waeren zwei
     * Stellen, an denen jemand ein anderes Subjekt einsetzen koennte.
     */
    snapshots: CostSnapshotRepository;
    organisationId: string;
    subjectUserId: string;
  }> {
    let identitaet;
    try {
      identitaet = await this.identitaet.identify({
        cookieHeader: req.headers.cookie,
        authorizationHeader: req.headers.authorization,
      });
    } catch (fehler) {
      // Ohne Identitaet gibt es kein Subjekt und keine Organisation — aber
      // sehr wohl eine Entscheidung ueber eine Kostenressource. Genau diese
      // Zeile will man bei einem Angriff sehen. Der urspruengliche Fehler
      // laeuft unveraendert weiter zum AuthProblemFilter.
      this.protokolliere(req, route, permission, {
        decision: "deny",
        reason: "UNAUTHENTICATED",
        organisationId: null,
        subject: null,
      });
      throw fehler;
    }

    const mitgliedschaften = await this.organisationen.organisationsFor(identitaet.userId);
    const entscheidung = this.policy.authorize(
      mitgliedschaften.map((m) => ({
        organisationId: m.organisationId,
        permissions: m.permissions,
      })),
      organisationHeader ?? null,
      permission,
    );
    const subject = pseudonymSubjekt(identitaet.userId);

    if (!entscheidung.ok) {
      this.protokolliere(req, route, permission, {
        decision: "deny",
        reason: entscheidung.problem,
        // Nur bei PERMISSION_MISSING steht die Zugehoerigkeit fest. Bei den
        // anderen beiden waere jede Organisations-Id im Protokoll erfunden:
        // der Header ist unbestaetigt, und ohne Auswahl gibt es keine.
        organisationId:
          entscheidung.problem === "PERMISSION_MISSING"
            ? (organisationHeader ?? mitgliedschaften[0]?.organisationId ?? null)
            : null,
        subject,
      });

      if (entscheidung.problem === "ORG_CONTEXT_REQUIRED") {
        throw new BadRequestException({
          type: COSTS_ERROR_TYPE.NO_ORGANISATION,
          message: "Es ist keine Organisation ausgewaehlt. Bitte oben eine Organisation waehlen.",
        });
      }
      // ORG_NOT_A_MEMBER und PERMISSION_MISSING beantworten wir GLEICH:
      // sonst verriete die Antwort, ob eine fremde Organisation existiert.
      // Im Protokoll bleiben sie getrennt — dort ist das kein Leck, sondern
      // der Zweck.
      throw new ForbiddenException({
        type: COSTS_ERROR_TYPE.NO_ORGANISATION,
        message: "Kein Zugriff auf die Kostendaten dieser Organisation.",
      });
    }

    this.protokolliere(req, route, permission, {
      decision: "allow",
      reason: null,
      organisationId: entscheidung.organisationId,
      subject,
    });

    return {
      rates: this.repositoryFor(identitaet.userId),
      snapshots: this.snapshotsFor(identitaet.userId),
      organisationId: entscheidung.organisationId,
      subjectUserId: identitaet.userId,
    };
  }

  /**
   * Schreibt die Entscheidung fort — und niemals mehr als das.
   *
   * Der `catch` ist Absicht und keine Nachlaessigkeit: eine unerreichbare
   * Auditsenke darf eine Ablehnung nicht in einen Serverfehler und eine
   * Erlaubnis nicht in eine Ablehnung verwandeln. Fail-closed waere hier der
   * falsche Reflex — es hiesse, dass ein kaputter Logger den gesamten
   * Kostenzugriff sperrt (EYT-106 AK9, PO: "Loggerfehler veraendern keine
   * Autorisierungsentscheidung").
   */
  private protokolliere(
    req: Request,
    route: string,
    permission: CostPermission,
    ausgang: {
      decision: "allow" | "deny";
      reason: CostAccessDenyReason | null;
      organisationId: string | null;
      subject: string | null;
    },
  ): void {
    const ereignis: CostAccessDecisionEvent = {
      event: COST_ACCESS_DECISION_EVENT,
      correlationId: (req as Partial<RequestWithCorrelationId>).correlationId ?? "unbekannt",
      decision: ausgang.decision,
      permission,
      organisationId: ausgang.organisationId,
      subject: ausgang.subject,
      reason: ausgang.reason,
      at: new Date().toISOString(),
      route,
    };
    try {
      this.audit.record(ereignis);
    } catch {
      // bewusst verschluckt — siehe oben
    }
  }
}

function toDto(version: RateVersionRecord, businessDate: string): RateVersionDto {
  return {
    id: version.id,
    employeeId: version.employeeId,
    amountMinorUnits: version.amountMinorUnits,
    currency: "EUR",
    validFrom: version.validFrom,
    validTo: version.validTo,
    status: rateVersionStatus(version, businessDate),
    predecessorId: version.predecessorId,
    reason: version.reason,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  };
}

function problemFor(problem: RateWriteProblem): Error {
  if (problem === "RATE_INTERVAL_OVERLAP") {
    return new ConflictProblem(
      RATE_ERROR_TYPE.RATE_INTERVAL_OVERLAP,
      "In diesem Zeitraum existiert bereits eine Satzversion fuer diese Person. Die neue Version wurde NICHT gespeichert.",
    );
  }
  if (problem === "STALE_ACTIVE_VERSION") {
    return new ConflictProblem(
      RATE_ERROR_TYPE.STALE_VERSION,
      "Der aktive Satz hat sich zwischenzeitlich geaendert. Die Historie wurde neu geladen — bitte pruefen und erneut entscheiden.",
    );
  }
  // Die drei Abloesungsablehnungen (EYT-108). Alle als 409: der Aufrufer hat
  // nichts falsch FORMULIERT, sein Stand passt nur nicht mehr zum Server.
  // Deshalb ConflictProblem und nicht BadRequestException: eine HttpException
  // faellt in den globalen Filter und wird zu "about:blank", ihr URN geht
  // verloren. Den URN traegt ausschliesslich `CostsProblemFilter`
  // (@Catch(ConflictProblem, CostsProblem)) in die Antwort — seit EYT-139 fuer
  // JEDEN Status, nicht mehr nur fuer 409. Die Wahl ist damit inhaltlich:
  // `ConflictProblem` fuer 409, `CostsProblem` fuer jeden anderen Status.
  if (problem === "VORGAENGER_BEREITS_GESCHLOSSEN") {
    return new ConflictProblem(
      RATE_ERROR_TYPE.RATE_PREDECESSOR_CLOSED,
      "Die angegebene Vorgaengerversion ist bereits abgeloest. Die Historie wurde neu geladen — bitte die aktive Version waehlen.",
    );
  }
  if (problem === "NACHFOLGER_NICHT_SPAETER") {
    return new ConflictProblem(
      RATE_ERROR_TYPE.RATE_SUCCESSOR_NOT_LATER,
      "Die neue Version muss spaeter beginnen als die abzuloesende. Bitte ein spaeteres Datum waehlen.",
    );
  }
  if (problem === "IDEMPOTENCY_KEY_REUSED") {
    return new ConflictProblem(
      RATE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
      "Dieser Idempotency-Key wurde bereits fuer eine andere Satzversion verwendet. Bitte einen neuen Schluessel senden.",
    );
  }
  if (problem === "FREMDER_MITARBEITER") {
    return new ConflictProblem(
      RATE_ERROR_TYPE.RATE_EMPLOYEE_MISMATCH,
      "Die angegebene Vorgaengerversion gehoert zu einer anderen Person. Die neue Version wurde NICHT gespeichert.",
    );
  }
  return new BadRequestException({
    type: RATE_ERROR_TYPE.RATE_NOT_FOUND,
    message: "Diese Person ist in der gewaehlten Organisation nicht vorhanden.",
  });
}

// ---------------------------------------------------------------------------
// Die Fehlerabbildung des Snapshot-Pfades (EYT-139)
//
// Erschoepfend ueber `failure.stage` und ueber jeden Grund JEDER Stufe — ohne
// `default`-Zweig und ohne `as`. Die drei Tabellen tragen `satisfies
// Record<Problem, …>`: kommt ein Grund dazu, kompiliert diese Datei nicht mehr.
// Ein `default` haette den neuen Grund stillschweigend auf irgendetwas
// abgebildet, und niemand haette es bemerkt.
// ---------------------------------------------------------------------------

/**
 * Der Titel gehoert zum Status, nicht zur Aufrufstelle.
 *
 * Eine Tabelle statt eines Textes je `throw`: sonst hiesse derselbe 409 an der
 * einen Stelle "Konflikt" und an der naechsten "Nicht moeglich", und der Titel
 * waere Zufall statt Aussage.
 */
const TITEL = {
  400: "Ungueltige Anfrage",
  403: "Kein Zugriff",
  409: "Konflikt",
  500: "Serverfehler",
} as const satisfies Record<CostsProblemStatus, string>;

/** Eine Ablehnung ohne Kontextfelder: Status, URN und Text stehen fest. */
interface Ablehnung {
  readonly status: CostsProblemStatus;
  readonly type: string;
  readonly detail: string;
}

function costsProblem(ablehnung: Ablehnung): CostsProblem {
  return new CostsProblem({
    status: ablehnung.status,
    title: TITEL[ablehnung.status],
    type: ablehnung.type,
    detail: ablehnung.detail,
  });
}

/** Ablehnungen des Faktenports. */
const FAKTEN_ABLEHNUNG = {
  NO_ORGANISATION: {
    status: 400,
    type: COSTS_ERROR_TYPE.NO_ORGANISATION,
    detail:
      "Es ist keine Organisation ausgewaehlt. Bitte oben eine Organisation waehlen und den Snapshot erneut erzeugen.",
  },
  AMBIGUOUS_ORGANISATION: {
    status: 400,
    type: COSTS_ERROR_TYPE.AMBIGUOUS_ORGANISATION,
    detail:
      "Es sind mehrere Organisationen moeglich. Bitte oben genau eine Organisation waehlen und den Snapshot erneut erzeugen.",
  },
  // 409 und nicht 400: die Anfrage ist korrekt formuliert, der Serverzustand
  // passt nur nicht. Behoben wird sie durch eine HANDLUNG in der Planung
  // (veroeffentlichen), nicht durch eine andere Formulierung.
  PLAN_NOT_PUBLISHED: {
    status: 409,
    type: COSTS_ERROR_TYPE.PLAN_NOT_PUBLISHED,
    detail:
      "Diese Planversion ist ein Entwurf. Kosten entstehen ausschliesslich aus einer veroeffentlichten Planung — bitte zuerst veroeffentlichen.",
  },
  // 400 und nicht 409: die genannte Version ist in diesem Mandanten nicht
  // sichtbar. Der Vertrag fuehrt kein 404, und ob sie „nicht existiert" oder
  // „einem anderen Mandanten gehoert", bleibt bewusst ununterscheidbar.
  PLAN_VERSION_NOT_FOUND: {
    status: 400,
    type: COSTS_ERROR_TYPE.PLAN_VERSION_NOT_FOUND,
    detail:
      "Diese Planversion ist nicht verfuegbar. Bitte die Version in der Auswahlliste neu waehlen.",
  },
} as const satisfies Record<PlanCostFactsProblem, Ablehnung>;

/** Ablehnungen des Schreibvorgangs. */
const SCHREIB_ABLEHNUNG = {
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    type: SNAPSHOT_WRITE_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
    detail:
      "Dieser Idempotency-Key wurde bereits fuer einen anderen Snapshot verwendet. Bitte einen neuen Schluessel senden.",
  },
  WORKSITE_NOT_IN_ORG: {
    status: 400,
    type: SNAPSHOT_WRITE_ERROR_TYPE.WORKSITE_NOT_IN_ORG,
    detail:
      "Die gewaehlte Baustelle gehoert nicht zu dieser Organisation. Es wurde kein Snapshot gespeichert. Bitte eine Baustelle aus der Auswahlliste waehlen.",
  },
  /**
   * 500, und das ist entschieden statt offen (EYT-139).
   *
   * Der Port schliesst die Umdeutung in einen Auth- oder Mandantenfehler
   * ausdruecklich aus: das Subjekt kann korrekt angemeldet und berechtigt sein
   * und trotzdem ueber den falschen Kanal kommen (PostgREST-Data-API,
   * Transaktionspooler). Ein 403 schickte die Betreiberin auf die Suche nach
   * einem Rechteproblem, das es nicht gibt; ein 409 legte einen Retry nahe, der
   * nichts behebt; ein 400 beschuldigte die Aufruferin. Bleibt 5xx — und das
   * ist auf diesen Routen bereits gelebte Praxis (`AuthProblemFilter` liefert
   * dort 503, `HttpCostsGateway.send` behandelt `>= 500` als `UNAVAILABLE`).
   */
  WRITE_CHANNEL_REJECTED: {
    status: 500,
    type: SNAPSHOT_WRITE_ERROR_TYPE.WRITE_CHANNEL_REJECTED,
    detail:
      "Der Snapshot konnte nicht gespeichert werden: die Datenbank hat den Schreibkanal abgelehnt. Das ist ein Betriebsfehler und kein Rechteproblem — bitte den Betrieb mit der Korrelations-Id verstaendigen.",
  },
} as const satisfies Record<SnapshotWriteProblem, Ablehnung>;

/**
 * Der Snapshot wurde geschrieben und war danach nicht lesbar.
 *
 * 500, nicht 403: hier ist die Id gerade eben entstanden, das Subjekt ist
 * dasselbe, und die Aufruferin hat nichts falsch gemacht. Der gespeicherte
 * Stand existiert moeglicherweise — nur die Antwort fehlt.
 */
const LESEN_NACH_SCHREIBEN = {
  SNAPSHOT_NOT_FOUND: {
    status: 500,
    type: SNAPSHOT_READ_ERROR_TYPE.SNAPSHOT_NOT_FOUND,
    detail:
      "Der Snapshot wurde angelegt, konnte danach aber nicht gelesen werden. Bitte die Kostenansicht neu laden; wiederholt sich das, den Betrieb mit der Korrelations-Id verstaendigen.",
  },
} as const satisfies Record<SnapshotReadProblem, Ablehnung>;

/**
 * Die Leseroute — 403 fuer alle drei zusammengefassten Faelle.
 *
 * „Unbekannt", „fremd" und „nicht lesbar" sind hier EINE Antwort, und die
 * Ununterscheidbarkeit ist strukturell: `SnapshotReadProblem` hat genau einen
 * Wert, `SNAPSHOT_READ_ERROR_TYPE` genau einen URN, und dieser Text nennt die
 * angefragte Id NICHT. Wer Ids durchprobiert, erfaehrt an der Antwort nichts.
 *
 * Warum 403 und nicht 404: der Vertrag fuehrt in keiner seiner Operationen ein
 * 404 (`problemResponses` = 400/401/403/409), und `CostsProblemStatus` laesst
 * es deshalb gar nicht zu. Unter den verfuegbaren Codes ist 403 die
 * wahrheitsgemaesse Aussage — „du bekommst diesen Snapshot nicht".
 */
const LESE_ABLEHNUNG = {
  SNAPSHOT_NOT_FOUND: {
    status: 403,
    type: SNAPSHOT_READ_ERROR_TYPE.SNAPSHOT_NOT_FOUND,
    detail:
      "Dieser Snapshot ist nicht verfuegbar. Bitte die Kostenansicht oeffnen und einen Snapshot aus der Liste waehlen.",
  },
} as const satisfies Record<SnapshotReadProblem, Ablehnung>;

/**
 * Warum die Montage blockiert hat — als Handlungsanweisung.
 *
 * Bewusst OHNE Betrag und ohne Stundensatz: der Fehlertext ist keine
 * Kostenauskunft, und `HttpExceptionFilter` haelt fuer den Rest der API
 * dieselbe Linie. Person, Tag und Einsatz stehen darin, weil ohne sie
 * „irgendwo fehlt ein Satz" die einzige mitgeteilte Information waere.
 */
const MONTAGE_HINWEIS = {
  RATE_NOT_FOUND:
    "fehlt ein gueltiger Stundensatz. Bitte den Satz hinterlegen und den Snapshot erneut erzeugen.",
  RATE_AMBIGUOUS:
    "gelten mehrere Stundensaetze gleichzeitig. Bitte die ueberlappenden Satzversionen bereinigen und den Snapshot erneut erzeugen.",
  RATE_INVALID:
    "ist die gespeicherte Satzversion nicht verwendbar. Bitte die Satzversion pruefen und korrigieren.",
  LABEL_MISSING:
    "fehlt eine Bezeichnung fuer Person oder Baustelle. Bitte die Stammdaten vervollstaendigen.",
  DAY_BOUNDARY_NONEXISTENT:
    "faellt die lokale Tagesgrenze in eine Stunde, die es in der Zeitzone der Organisation nicht gibt. Bitte den Einsatzzeitraum anpassen.",
  DAY_BOUNDARY_AMBIGUOUS:
    "gibt es die lokale Tagesgrenze in der Zeitzone der Organisation zweimal. Bitte den Einsatzzeitraum anpassen.",
  TIME_ZONE_UNKNOWN:
    "ist die Zeitzone der Organisation unbekannt. Bitte sie in den Organisationseinstellungen korrigieren.",
  INTERVAL_INVALID:
    "ist der Einsatzzeitraum ungueltig. Bitte Beginn und Ende des Einsatzes korrigieren.",
} as const satisfies Record<SnapshotAssemblyProblem, string>;

/**
 * Alle acht Montagegruende sind 409.
 *
 * Nicht 400: die Aufruferin hat nichts falsch FORMULIERT — der Rumpf ist
 * gueltig, der Serverzustand passt nur nicht. Behoben wird jeder dieser Faelle
 * durch eine Handlung an den Stammdaten, nicht durch eine andere Anfrage.
 */
function montageProblem(
  failure: Extract<CreateCostSnapshotFailure, { stage: "ASSEMBLY" }>,
): CostsProblem {
  const teile = [
    failure.employeeId === null ? null : `Person ${failure.employeeId}`,
    failure.localDate === null ? null : `den ${failure.localDate}`,
    failure.assignmentId === null ? null : `Einsatz ${failure.assignmentId}`,
  ].filter((teil): teil is string => teil !== null);
  const wo = teile.length === 0 ? "In dieser Planversion" : `Fuer ${teile.join(", ")}`;
  return costsProblem({
    status: 409,
    type: SNAPSHOT_ASSEMBLY_ERROR_TYPE[failure.problem],
    detail: `${wo} ${MONTAGE_HINWEIS[failure.problem]} Es wurde kein Snapshot gespeichert.`,
  });
}

/**
 * Die eine Abbildung Ablehnung -> HTTP fuer `POST /kosten/snapshots`.
 *
 * `switch` ohne `default`: kommt eine fuenfte Stufe dazu, meldet der Compiler
 * den fehlenden Rueckgabewert. Ein `default` haette sie stillschweigend auf
 * einen bestehenden Fall abgebildet.
 */
function snapshotProblemFor(failure: CreateCostSnapshotFailure): CostsProblem {
  switch (failure.stage) {
    case "FACTS":
      return costsProblem(FAKTEN_ABLEHNUNG[failure.problem]);
    case "ASSEMBLY":
      return montageProblem(failure);
    case "WRITE":
      return costsProblem(SCHREIB_ABLEHNUNG[failure.problem]);
    case "READ":
      return costsProblem(LESEN_NACH_SCHREIBEN[failure.problem]);
  }
}

/** Die Abbildung der Leseroute — siehe {@link LESE_ABLEHNUNG}. */
function leseProblem(problem: SnapshotReadProblem): CostsProblem {
  return costsProblem(LESE_ABLEHNUNG[problem]);
}

/**
 * Heutiges Geschaeftsdatum in UTC.
 *
 * Bewusst NICHT aus lokalen Bestandteilen konstruiert (`no-local-time`-Regel):
 * `toISOString().slice(0,10)` ist eine reine Projektion eines Instants.
 * Die organisationsbezogene Zeitzone gehoert zu EYT-109 und wird dort
 * eingefuehrt, wo sie fachlich zaehlt (Tagesallokation) — hier steuert das
 * Datum nur die ANZEIGE von "aktiv/kommend/abgelaufen".
 */
function heutigesGeschaeftsdatum(): string {
  return new Date().toISOString().slice(0, 10);
}
