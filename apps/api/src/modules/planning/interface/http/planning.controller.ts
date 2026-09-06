/**
 * HTTP-Naht der Planung (EYT-50, Auth-Umbau und Publish in EYT-107).
 *
 * ## Der Umbau, den EYT-107 hier vorgenommen hat
 *
 * Bis EYT-106 gab es in diesem `AppModule` ZWEI Identitaetswahrheiten: die
 * Kostenroute pruefte ein echtes Token samt Session-Liveness
 * (`REQUEST_IDENTITY`), die Planungsroute fragte einen
 * `TENANT_SUBJECT_RESOLVER`, dessen Produktionsimplementierung immer `null`
 * lieferte — jede Planungsanfrage endete in 401, und die fachliche Policy war
 * ohnehin `DenyAllPlanningAccess`.
 *
 * Damit war die Planung produktiv unbenutzbar, und jeder Browsernachweis
 * darueber waere ein Nachweis ueber einen Testharness gewesen. EYT-107
 * verlangt einen real autorisierten Publish-Pfad; deshalb zieht die Planung
 * hier auf dieselbe Kette um, die die Kosten schon benutzen. Der alte
 * Resolver ist danach ohne Verbraucher und entfaellt.
 *
 * ## Reihenfolge jeder Anfrage, ohne Ausnahme
 *
 *   1. Identitaet (Cookie ODER Bearer, verifiziert, Session lebt)
 *   2. Mitgliedschaften und Rechte SERVERSEITIG aufloesen
 *   3. `PlanningAccessPolicy`: Organisation waehlen und atomares Recht pruefen
 *   4. Vertragspruefung der Eingabe
 *   5. Fachliche Arbeit
 *   6. Antwort gegen das Vertragsschema — der Server prueft seine EIGENE
 *      Ausgabe, weil ein Vertragsbruch hier entsteht und nicht beim Client.
 *
 * Die Vertragspruefung steht bewusst NACH der Berechtigung: eine
 * Vertragsverletzung vorher zu melden verriete einem Unberechtigten die Form
 * des Vertrags.
 *
 * Keine Rollenabfrage in diesem Controller (PO-Entscheidung): er fragt die
 * Policy, nie die Rolle. Und selbst wenn die Policy irrte, lehnte RLS
 * unabhaengig ab (Migration 0015) — das ist die Unabhaengigkeitszusage.
 *
 * ## Warum die Organisation hier nicht gewaehlt werden kann
 *
 * Die Policy wird mit `requestedOrganisationId = null` aufgerufen: genau eine
 * aktive Mitgliedschaft ist eindeutig, mehrere ergeben `ORG_CONTEXT_REQUIRED`.
 * Der Organisationsheader, den die Kostenroute kennt, ist im Planungsvertrag
 * nicht deklariert und wird vom Planungs-Client nicht gesendet; ihn hier
 * trotzdem zu lesen waere eine undokumentierte Schnittstelle. Die sichtbare
 * Auswahl fuer mehrere Organisationen gehoert zu EYT-14.
 */
import {
  AssignmentDtoSchema,
  CreateAssignmentCommandSchema,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  PlanValidationResultSchema,
  PlanWorksiteDayCommandSchema,
  PlanningWindowQuerySchema,
  PlanningWindowSchema,
  PublishPlanCommandSchema,
  PublishedPlanVersionSchema,
  ValidatePlanCommandSchema,
  WORKSITE_DAY_PROBLEM_TYPE,
  WorksiteDayDtoSchema,
} from "@easytree/contracts";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Post,
  Query,
  Req,
  UseFilters,
} from "@nestjs/common";
import type { Request } from "express";

import {
  RequestIdentityService,
  REQUEST_IDENTITY,
} from "../../../../platform/auth/request-identity";
// Zugriff auf ein fremdes Modul NUR ueber dessen index.ts (ADR-001 Z. 76).
import {
  AuthProblemFilter,
  SESSION_ORGANISATIONS,
  type SessionOrganisationsPort,
} from "../../../tenancy";
import {
  PLANNING_ACCESS_POLICY,
  type PlanningAccessPolicy,
  type PlanningPermission,
} from "../../application/planning-access.port";
import {
  PLANNING_QUERIES_FACTORY,
  type PlanningQueriesFactory,
} from "../../application/planning-queries.factory";
import type { ResourceRow } from "../../application/planning-queries.port";
import { PLANNING_ERROR_TYPE, PlanningProblemFilter } from "./planning-problem.filter";
import {
  PLANNING_WRITES_FACTORY,
  type PlanningWriteProblem,
  type PlanningWritesFactory,
} from "../../application/planning-writes.port";

/**
 * Fachproblem -> HTTP-Antwort.
 *
 * Jeder Zweig ist ausgeschrieben, es gibt keinen Standardfall: ein
 * `default: 500` wuerde ein neu hinzugefuegtes Problem stillschweigend als
 * Serverfehler ausgeben, obwohl es eine erklaerbare Ablehnung ist. Fehlt hier
 * ein Zweig, faellt es beim Typcheck auf.
 *
 * Die Texte sind fuer eine PLANERIN geschrieben, nicht fuer ein Log. "Konflikt"
 * sagt ihr nicht, was sie tun soll; "ueberschneidet sich mit einem Einsatz von
 * 08:00 bis 16:00" schon.
 */
function problemFor(problem: PlanningWriteProblem): Error {
  switch (problem.kind) {
    case "NO_ORGANISATION":
      return new ForbiddenException({
        type: PLANNING_ERROR_TYPE.NO_ORGANISATION,
        title: "Keine Organisation",
        detail: "Keine aktive Mitgliedschaft in einer Organisation.",
      });
    case "AMBIGUOUS_ORGANISATION":
      return new ForbiddenException({
        type: PLANNING_ERROR_TYPE.AMBIGUOUS_ORGANISATION,
        title: "Mehrdeutige Organisation",
        detail: "Mehrere aktive Organisationen. Die Auswahl ist noch nicht modelliert (EYT-14).",
      });
    case "RESOURCE_NOT_SELECTABLE":
      return new BadRequestException({
        type: PLANNING_ERROR_TYPE.RESOURCE_NOT_SELECTABLE,
        title: "Ressource nicht auswählbar",
        detail:
          problem.feld === "employeeId"
            ? "Diese mitarbeitende Person steht für neue Einsätze nicht zur Auswahl."
            : "Diese Baustelle steht für neue Einsätze nicht zur Auswahl.",
      });
    case "OVERLAPPING_ASSIGNMENT":
      return new ConflictException({
        type: PLANNING_ERROR_TYPE.OVERLAPPING_ASSIGNMENT,
        title: "Überschneidender Einsatz",
        detail: `Diese Person ist in diesem Zeitraum bereits eingeplant: ${problem.overlap.startsAtUtc.toISOString()} bis ${problem.overlap.endsAtUtc.toISOString()}. Der Entwurf wurde NICHT gespeichert.`,
      });
    case "IDEMPOTENCY_KEY_REUSED":
      // 409 und nicht 400: die Anfrage ist fuer sich genommen gueltig, sie
      // steht nur im Widerspruch zu einem bereits abgeschlossenen Vorgang.
      return new ConflictException({
        type: PLANNING_ERROR_TYPE.IDEMPOTENCY_KEY_REUSED,
        title: "Idempotenzschlüssel bereits für eine andere Anfrage verwendet",
        detail:
          "Dieser Idempotenzschlüssel gehört zu einem anderen Einsatz. Für einen neuen Einsatz einen neuen Schlüssel verwenden; für einen Wiederholungsversuch dieselbe Anfrage senden.",
      });
    case "DUPLICATE_WORKSITE_DAY":
      return new ConflictException({
        type: WORKSITE_DAY_PROBLEM_TYPE.DUPLICATE_WORKSITE_DAY,
        title: "Baustellentag besteht bereits",
        detail:
          "Für diese Baustelle und diesen lokalen Tag existiert im aktuellen Entwurf bereits ein Baustellentag.",
      });
    case "INTERVAL_OUTSIDE_DAY":
      return new ConflictException({
        type: WORKSITE_DAY_PROBLEM_TYPE.INTERVAL_OUTSIDE_DAY,
        title: "Arbeitszeit liegt außerhalb des Baustellentags",
        detail: "Jedes Teamintervall muss vollständig im angefragten lokalen Baustellentag liegen.",
      });
    case "OUTSIDE_WEEK":
      return new BadRequestException({
        type: PLANNING_ERROR_TYPE.OUTSIDE_WEEK,
        title: "Einsatz außerhalb der Woche",
        detail: `Der Einsatz liegt in Kalenderwoche ${problem.tatsaechlicheWoche}, nicht in der geöffneten Woche. Bitte das Datum prüfen.`,
      });
    // -------------------------------------------------------------------
    // Veroeffentlichen (EYT-107) — alle vier sind 409
    // -------------------------------------------------------------------
    // Der Status allein traegt hier keine Bedeutung mehr: `HttpPlanningGateway`
    // bildet 409 fuer `publishPlan` pauschal auf `STALE_VERSION` ab. Die
    // Unterscheidung haengt am `type`, und die Oberflaeche verzweigt darauf.
    case "STALE_VERSION":
      return new ConflictException({
        type: PLANNING_ERROR_TYPE.STALE_VERSION,
        title: "Der Plan wurde zwischenzeitlich geändert",
        detail:
          "Seit dem Laden dieser Woche hat jemand anders den Entwurf verändert oder veröffentlicht. Es wurde NICHTS veröffentlicht. Bitte die Woche neu laden und erneut entscheiden.",
      });
    case "ALREADY_PUBLISHED":
      return new ConflictException({
        type: PLANNING_ERROR_TYPE.ALREADY_PUBLISHED,
        title: "Diese Woche ist bereits veröffentlicht",
        detail:
          "Für diese Woche gibt es keinen unveröffentlichten Entwurf mehr. Es wurde nichts erneut veröffentlicht.",
      });
    case "BLOCKING_CONFLICT":
      return new ConflictException({
        type: PLANNING_ERROR_TYPE.BLOCKING_CONFLICT,
        title: "Der Entwurf hat blockierende Konflikte",
        detail: `Der Entwurf wurde NICHT veröffentlicht. Blockierend: ${problem.conflicts
          .map((konflikt) => konflikt.code)
          .join(", ")}.`,
      });
    case "ASSIGNMENT_OUTSIDE_WEEK":
      return new ConflictException({
        type: PLANNING_ERROR_TYPE.ASSIGNMENT_OUTSIDE_WEEK,
        title: "Einsatz gehört nicht in diese Woche",
        detail: `Mindestens ein Einsatz dieses Entwurfs liegt in Kalenderwoche ${problem.tatsaechlicheWoche}, nicht in der Woche der Planversion. Der Entwurf wurde NICHT veröffentlicht.`,
      });
  }
}

/**
 * Zeile -> Vertragsform. Explizit Feld fuer Feld, nicht per Spread: ein Spread
 * wuerde jede kuenftige Spalte des Repositories automatisch veroeffentlichen,
 * und bei `employees` waere das ein Personenbezug, den niemand entschieden hat.
 */
const zuRessource = (row: ResourceRow): { id: string; label: string; active: boolean } => ({
  id: row.id,
  label: row.label,
  active: row.active,
});

@Controller("planung")
// Reihenfolge ist bedeutungstragend, und zwar RUECKWAERTS: Nest prueft den
// ZULETZT genannten Filter zuerst. `PlanningProblemFilter` ist `@Catch()` ohne
// Argumente, faengt also alles — steht er hinten, verschluckt er
// `IdentityRejectedError` und die Antwort waere 500 statt 401.
//
// Gemessen, nicht vermutet: mit der umgekehrten Reihenfolge schlagen
// „antwortet ohne verifiziertes Subjekt mit 401" und „fragt ohne Subjekt gar
// nicht erst ab" in `planning-window.http.test.ts` fehl. Diese beiden Faelle
// sind damit die Regressionssicherung fuer genau diese Zeile.
//
// Der Kostencontroller braucht die Vorsicht nicht: `CostsProblemFilter` ist
// `@Catch(ConflictProblem, CostsProblem)` und damit ohnehin schmal.
@UseFilters(PlanningProblemFilter, AuthProblemFilter)
export class PlanningController {
  constructor(
    @Inject(REQUEST_IDENTITY)
    private readonly identitaet: RequestIdentityService,
    @Inject(SESSION_ORGANISATIONS)
    private readonly organisationen: SessionOrganisationsPort,
    @Inject(PLANNING_QUERIES_FACTORY)
    private readonly queriesFor: PlanningQueriesFactory,
    @Inject(PLANNING_ACCESS_POLICY)
    private readonly access: PlanningAccessPolicy,
    @Inject(PLANNING_WRITES_FACTORY)
    private readonly writesFor: PlanningWritesFactory,
  ) {}

  /**
   * Die eine Zugangskette. Wirft, wenn irgendetwas daran nicht traegt.
   *
   * Identisch aufgebaut wie `CostsController.zugang` — bewusst, denn zwei
   * verschiedene Formen fuer dieselbe Entscheidung waeren zwei Stellen, an
   * denen man sie falsch treffen kann.
   */
  private async zugang(
    request: Request,
    permission: PlanningPermission,
  ): Promise<{ subjectUserId: string }> {
    // Wirft `IdentityRejectedError`, `TokenRejectedError` oder
    // `SessionRejectedError`; `AuthProblemFilter` macht daraus 401/503 mit
    // stabilem URN. Kein Detail zur Ursache — ob ein Token fehlte, abgelaufen
    // war oder manipuliert ist, geht den Aufrufer nichts an.
    const identitaet = await this.identitaet.identify({
      cookieHeader: request.headers.cookie,
      authorizationHeader: request.headers.authorization,
    });

    // Mitgliedschaften und Rechte kommen aus der Datenbank unter RLS, nie aus
    // dem Request. Ein `orgId`-Feld im Koerper waere Clienteingabe.
    const mitgliedschaften = await this.organisationen.organisationsFor(identitaet.userId);
    const entscheidung = this.access.authorize(
      mitgliedschaften.map((mitgliedschaft) => ({
        organisationId: mitgliedschaft.organisationId,
        permissions: mitgliedschaft.permissions,
      })),
      // Siehe Dateikopf: keine Organisationsauswahl in diesem Vertrag (EYT-14).
      null,
      permission,
    );

    if (!entscheidung.ok) {
      if (entscheidung.problem === "ORG_CONTEXT_REQUIRED") {
        throw new ForbiddenException({
          type: PLANNING_ERROR_TYPE.AMBIGUOUS_ORGANISATION,
          title: "Organisation nicht eindeutig",
          detail:
            "Keine oder mehrere aktive Organisationen. Die sichtbare Auswahl ist noch nicht modelliert (EYT-14).",
        });
      }
      // ORG_NOT_A_MEMBER und PERMISSION_MISSING antworten GLEICH: sonst
      // verriete die Antwort, ob eine fremde Organisation existiert oder
      // welche Rechte es ueberhaupt gibt.
      throw new ForbiddenException({
        type: PLANNING_ERROR_TYPE.NO_ORGANISATION,
        title: "Kein Zugriff",
        detail: "Kein Zugriff auf die Planung dieser Organisation.",
      });
    }

    return { subjectUserId: identitaet.userId };
  }

  @Get("fenster")
  async planningWindow(
    @Req() request: Request,
    @Query("weekKey") weekKey?: string,
  ): Promise<unknown> {
    const { subjectUserId: subject } = await this.zugang(request, "planning.read");

    const query = PlanningWindowQuerySchema.safeParse({ weekKey });
    if (!query.success) {
      throw new BadRequestException("weekKey fehlt oder hat nicht das Format 2026-W32.");
    }

    const result = await this.queriesFor(subject).planningWindow(query.data.weekKey);
    if (!result.ok) {
      if (result.problem === "NO_ORGANISATION") {
        throw new ForbiddenException("Keine aktive Mitgliedschaft in einer Organisation.");
      }
      // Mehrere Organisationen: ausdruecklich KEINE stille Auswahl. Der
      // Organisationswechsler ist eine Produktentscheidung (EYT-14).
      throw new ForbiddenException(
        "Mehrere aktive Organisationen. Die Auswahl ist noch nicht modelliert (EYT-14).",
      );
    }

    const body = {
      weekKey: result.window.weekKey,
      timeZone: result.window.timeZone,
      worksiteDays: result.window.worksiteDays?.map((day) => ({
        worksiteDayId: day.worksiteDayId,
        configurationId: day.configurationId,
        worksiteId: day.worksiteId,
        localDate: day.localDate,
        lockVersion: day.lockVersion,
        team: day.team.map((member) => ({
          assignmentId: member.assignmentId,
          employeeId: member.employeeId,
          interval: {
            startUtc: member.startsAtUtc.toISOString(),
            endUtc: member.endsAtUtc.toISOString(),
          },
        })),
      })),
      assignments: result.window.assignments.map((assignment) => ({
        id: assignment.id,
        employeeId: assignment.employeeId,
        worksiteId: assignment.worksiteId,
        interval: {
          startUtc: assignment.startsAtUtc.toISOString(),
          endUtc: assignment.endsAtUtc.toISOString(),
        },
      })),
      sourceVersion: result.window.sourceVersion,
      publishedVersionId: result.window.publishedVersionId,
      resources: {
        employees: result.window.resources.employees.map(zuRessource),
        worksites: result.window.resources.worksites.map(zuRessource),
      },
    };

    const validated = PlanningWindowSchema.safeParse(body);
    if (!validated.success) {
      // Der Server hat etwas gebaut, das seinem eigenen Vertrag nicht
      // entspricht. Das ist ein Serverfehler, kein Aufruferfehler — und er
      // gehoert hierhin gemeldet, nicht als kaputte Antwort hinausgereicht.
      throw new InternalServerErrorException("Antwort entspricht nicht dem Vertrag.");
    }
    return validated.data;
  }

  /**
   * Einsatz im Entwurf der Woche anlegen (EYT-92).
   *
   * ## Woher die Woche kommt
   *
   * Der Client SENDET `weekKey`, aber der Server GLAUBT ihn nicht. Die Woche
   * eines Einsatzes ergibt sich allein aus seinem Beginn in der Zone der
   * Organisation; das Repository rechnet sie selbst und vergleicht. Stimmen
   * beide nicht ueberein, hat die Planerin ein Datum ausserhalb der offenen
   * Woche erwischt, und sie bekommt das gesagt — statt einer Zuweisung, die
   * nach dem Speichern spurlos verschwindet.
   *
   * ## Warum die Reihenfolge so ist
   *
   * Subjekt, dann Berechtigung, dann Vertragspruefung, dann Fachpruefung.
   * Eine Vertragsverletzung vor der Berechtigungspruefung zu melden verraet
   * einem Unberechtigten die Form des Vertrags.
   */
  /**
   * Entwurf pruefen, ohne ihn anzulegen (EYT-92).
   *
   * Ohne Idempotenzschluessel — es entsteht nichts, was sich verdoppeln
   * koennte. Antwortcode 200 statt 201: es wurde nichts erzeugt.
   *
   * Die Route macht `validateDraft` aus `modules/planning/domain` erstmals
   * ueber einen Nutzerpfad erreichbar. Bis hierher hatte die Funktion
   * Unittests und keinen Produktionsaufrufer — die Regel existierte, aber
   * niemand konnte sie ausloesen.
   */
  @Post("entwuerfe/validierung")
  @HttpCode(200)
  async validateDraft(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    // Schreibberechtigung, nicht Leseberechtigung: wer nicht anlegen darf, soll
    // auch nicht ausprobieren duerfen, was ein Anlegen ergaebe.
    const { subjectUserId: subject } = await this.zugang(request, "planning.write");

    const command = ValidatePlanCommandSchema.safeParse(body);
    if (!command.success) {
      throw new BadRequestException({
        type: PLANNING_ERROR_TYPE.INVALID_INTERVAL,
        title: "Prüfauftrag unvollständig oder Intervall ungültig",
        detail: "Der Entwurf ist unvollständig oder das Ende liegt nicht nach dem Beginn.",
      });
    }

    const result = await this.writesFor(subject).validateDraft({
      weekKey: command.data.weekKey,
      employeeId: command.data.draft.employeeId,
      worksiteId: command.data.draft.worksiteId,
      startsAtUtc: new Date(command.data.draft.interval.startUtc),
      endsAtUtc: new Date(command.data.draft.interval.endUtc),
    });
    if (!result.ok) throw problemFor(result.problem);

    const validated = PlanValidationResultSchema.safeParse({
      conflicts: result.conflicts,
      publishable: result.publishable,
    });
    if (!validated.success) {
      throw new InternalServerErrorException("Antwort entspricht nicht dem Vertrag.");
    }
    return validated.data;
  }

  @Post("einsaetze")
  @HttpCode(201)
  async createAssignment(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<unknown> {
    const { subjectUserId: subject } = await this.zugang(request, "planning.write");

    // Der Schluessel wird GEPRUEFT, nicht geglaubt. Das OpenAPI-Dokument
    // fuehrt ihn seit EYT-47 als Pflichtparameter; bis EYT-92 las ihn
    // serverseitig niemand, und ein Wiederholungsversuch legte einen zweiten
    // Einsatz an. Ohne Schluessel gibt es deshalb keinen Schreibvorgang.
    const schluessel = IdempotencyKeySchema.safeParse(idempotencyKey);
    if (!schluessel.success) {
      throw new BadRequestException({
        type: PLANNING_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY,
        title: "Idempotenzschlüssel fehlt oder ist unbrauchbar",
        detail: `Der Header ${IDEMPOTENCY_HEADER} fehlt oder entspricht nicht dem Vertrag. Ohne ihn kann ein Wiederholungsversuch nicht von einem neuen Einsatz unterschieden werden.`,
      });
    }

    const command = CreateAssignmentCommandSchema.safeParse(body);
    if (!command.success) {
      // Kein ZodError im Rumpf: er traegt die eingesandten Werte, und die
      // koennen Personenbezug enthalten.
      throw new BadRequestException({
        type: PLANNING_ERROR_TYPE.INVALID_INTERVAL,
        title: "Einsatz unvollständig oder Intervall ungültig",
        detail: "Der Einsatz ist unvollständig oder das Ende liegt nicht nach dem Beginn.",
      });
    }

    const result = await this.writesFor(subject).createAssignment({
      weekKey: command.data.weekKey,
      employeeId: command.data.employeeId,
      worksiteId: command.data.worksiteId,
      startsAtUtc: new Date(command.data.interval.startUtc),
      endsAtUtc: new Date(command.data.interval.endUtc),
      idempotencyKey: schluessel.data,
    });

    if (!result.ok) throw problemFor(result.problem);

    const angelegt = {
      id: result.assignment.id,
      employeeId: result.assignment.employeeId,
      worksiteId: result.assignment.worksiteId,
      interval: {
        startUtc: result.assignment.startsAtUtc.toISOString(),
        endUtc: result.assignment.endsAtUtc.toISOString(),
      },
    };
    const validated = AssignmentDtoSchema.safeParse(angelegt);
    if (!validated.success) {
      throw new InternalServerErrorException("Antwort entspricht nicht dem Vertrag.");
    }
    return validated.data;
  }

  @Post("baustellentage")
  @HttpCode(201)
  async planWorksiteDay(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<unknown> {
    const { subjectUserId: subject } = await this.zugang(request, "planning.write");

    const schluessel = IdempotencyKeySchema.safeParse(idempotencyKey);
    if (!schluessel.success) {
      throw new BadRequestException({
        type: PLANNING_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY,
        title: "Idempotenzschlüssel fehlt oder ist unbrauchbar",
        detail: `Der Header ${IDEMPOTENCY_HEADER} fehlt oder entspricht nicht dem Vertrag.`,
      });
    }

    const command = PlanWorksiteDayCommandSchema.safeParse(body);
    if (!command.success) {
      const teamIsEmpty =
        typeof body === "object" &&
        body !== null &&
        "team" in body &&
        Array.isArray((body as { team?: unknown }).team) &&
        (body as { team: unknown[] }).team.length === 0;
      throw new BadRequestException({
        type: teamIsEmpty
          ? WORKSITE_DAY_PROBLEM_TYPE.WORKSITE_DAY_TEAM_REQUIRED
          : PLANNING_ERROR_TYPE.INVALID_INTERVAL,
        title: teamIsEmpty
          ? "Baustellentag benötigt ein Team"
          : "Baustellentag unvollständig oder ungültig",
        detail: teamIsEmpty
          ? "Ein Baustellentag wird nicht ohne Team angelegt."
          : "Woche, Baustelle, lokales Datum oder Teamintervall entsprechen nicht dem Vertrag.",
      });
    }

    const result = await this.writesFor(subject).planWorksiteDay({
      weekKey: command.data.weekKey,
      worksiteId: command.data.worksiteId,
      localDate: command.data.localDate,
      team: command.data.team.map((member) => ({
        employeeId: member.employeeId,
        startsAtUtc: new Date(member.interval.startUtc),
        endsAtUtc: new Date(member.interval.endUtc),
      })),
      idempotencyKey: schluessel.data,
    });
    if (!result.ok) throw problemFor(result.problem);

    const response = WorksiteDayDtoSchema.safeParse({
      worksiteDayId: result.worksiteDay.worksiteDayId,
      configurationId: result.worksiteDay.configurationId,
      worksiteId: result.worksiteDay.worksiteId,
      localDate: result.worksiteDay.localDate,
      lockVersion: result.worksiteDay.lockVersion,
      team: result.worksiteDay.team.map((member) => ({
        assignmentId: member.assignmentId,
        employeeId: member.employeeId,
        interval: {
          startUtc: member.startsAtUtc.toISOString(),
          endUtc: member.endsAtUtc.toISOString(),
        },
      })),
    });
    if (!response.success) {
      throw new InternalServerErrorException("Antwort entspricht nicht dem Vertrag.");
    }
    return response.data;
  }

  /**
   * Den Entwurf einer Woche veroeffentlichen (EYT-107).
   *
   * ## Warum `planning.publish` und nicht `planning.write`
   *
   * Veroeffentlichen macht einen Plan verbindlich: ab dann ist er
   * unveraenderlich (Migration 0010) und die Quelle, aus der Plan-Kosten
   * entstehen sollen (EYT-109). Wer einen Entwurf bearbeiten darf, hat damit
   * nicht automatisch die Befugnis, ihn fuer die ganze Organisation
   * festzuschreiben. Die Trennung ist eine Product-Owner-Entscheidung und
   * hat einen eigenen Testfall — ohne ihn waere sie eine Behauptung.
   *
   * ## Warum 201 und nicht 200
   *
   * Es entsteht etwas Neues und Bleibendes: eine veroeffentlichte
   * Planversion. Das OpenAPI-Dokument fuehrt 201 als einzigen Erfolgsstatus.
   *
   * ## Was diese Route NICHT prueft
   *
   * Abwesenheiten, Qualifikationen, Zertifikate, Ressourcen, Fahrzeuge,
   * Geraete, Reise- und Ruhezeiten. Fuer sie existiert im Repository keine
   * Regel; sie hier zu behaupten waere eine erfundene Zusicherung. EYT-18
   * bleibt offen. Siehe `docs/runbooks/planning-publish.md`.
   */
  @Post("versionen")
  @HttpCode(201)
  async publishPlan(
    @Req() request: Request,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<unknown> {
    const { subjectUserId: subject } = await this.zugang(request, "planning.publish");

    // Ohne Schluessel kein Schreibvorgang: ein Wiederholungsversuch nach einer
    // verlorenen Antwort waere sonst nicht von einer zweiten Veroeffentlichung
    // zu unterscheiden.
    const schluessel = IdempotencyKeySchema.safeParse(idempotencyKey);
    if (!schluessel.success) {
      throw new BadRequestException({
        type: PLANNING_ERROR_TYPE.MISSING_IDEMPOTENCY_KEY,
        title: "Idempotenzschlüssel fehlt oder ist unbrauchbar",
        detail: `Der Header ${IDEMPOTENCY_HEADER} fehlt oder entspricht nicht dem Vertrag. Ohne ihn kann ein Wiederholungsversuch nicht von einer zweiten Veröffentlichung unterschieden werden.`,
      });
    }

    const command = PublishPlanCommandSchema.safeParse(body);
    if (!command.success) {
      // Kein ZodError im Rumpf: er traegt die eingesandten Werte.
      throw new BadRequestException({
        type: PLANNING_ERROR_TYPE.INVALID_INTERVAL,
        title: "Veröffentlichungsauftrag unvollständig",
        detail:
          "Woche oder erwartete Versions-Id fehlen oder haben nicht das vereinbarte Format. `expectedVersionId` ist Pflicht — `null` bedeutet „ich erwarte, dass noch nichts veröffentlicht ist“.",
      });
    }

    const result = await this.writesFor(subject).publishPlan({
      weekKey: command.data.weekKey,
      expectedVersionId: command.data.expectedVersionId,
      idempotencyKey: schluessel.data,
    });

    if (!result.ok) throw problemFor(result.problem);

    const veroeffentlicht = {
      versionId: result.version.versionId,
      weekKey: result.version.weekKey,
      publishedAtUtc: result.version.publishedAtUtc.toISOString(),
      assignmentIds: [...result.version.assignmentIds],
    };
    const validated = PublishedPlanVersionSchema.safeParse(veroeffentlicht);
    if (!validated.success) {
      throw new InternalServerErrorException("Antwort entspricht nicht dem Vertrag.");
    }
    return validated.data;
  }
}
