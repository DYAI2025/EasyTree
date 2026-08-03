/**
 * Kosten-Endpunkte (EYT-106/EYT-108): Mitarbeiterliste, Satzhistorie, neue
 * Satzversion.
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
  CreateRateVersionCommandSchema,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
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
  RATE_REPOSITORY_FACTORY,
  type RateRepository,
  type RateRepositoryFactory,
  type RateVersionRecord,
  type RateWriteProblem,
} from "../../application/rate-repository.port";
import { effectiveRateVersion, rateVersionStatus } from "../../domain/rate-effectivity";
import { COSTS_ERROR_TYPE, RATE_ERROR_TYPE } from "./costs-error-type";
import { ConflictProblem } from "./conflict-problem";
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
    const { repository } = await this.zugang(
      req,
      organisationHeader,
      "costs.read",
      "GET /kosten/stundensaetze/{employeeId}",
    );
    const versionen = await repository.versionsFor(employeeId);
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
    const { repository, organisationId } = await this.zugang(
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

    const ergebnis = await repository.append({
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

  /** Die eine Zugangskette. Wirft, wenn irgendetwas daran nicht traegt. */
  private async zugang(
    req: Request,
    organisationHeader: string | undefined,
    permission: CostPermission,
    route: string,
  ): Promise<{ repository: RateRepository; organisationId: string; subjectUserId: string }> {
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
      repository: this.repositoryFor(identitaet.userId),
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
  // Deshalb ConflictProblem und nicht BadRequestException — nur der
  // 409-Pfad traegt seinen URN bis in die Antwort, weil ausschliesslich
  // `CostsProblemFilter` (@Catch(ConflictProblem)) ihn setzt; eine
  // HttpException faellt in den globalen Filter und wird zu "about:blank".
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
