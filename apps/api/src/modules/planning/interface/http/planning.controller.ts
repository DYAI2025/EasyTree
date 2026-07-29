/**
 * HTTP-Naht der Planung (EYT-50).
 *
 * Die erste Fachroute des Projekts. Sie ist bewusst schmal: lesen, sonst
 * nichts.
 *
 * ## Reihenfolge der Pruefungen, und warum sie so ist
 *
 * 1. Subjekt. Ohne verifiziertes Subjekt endet die Anfrage mit 401, BEVOR
 *    irgendeine Query entsteht. Eine Query ohne Subjekt liefe mit leerem
 *    `app.user_org_ids()` — jede Policy griffe fail-closed, und das Ergebnis
 *    waere ein leeres Fenster statt einer Ablehnung. Ein leeres Fenster sieht
 *    aus wie "diese Woche ist nicht geplant"; genau diese Verwechslung soll
 *    hier nicht entstehen.
 * 2. Berechtigung. Verifiziert heisst nicht berechtigt — `PlanningAccessPolicy`
 *    entscheidet, und zwar VOR jeder Abfrage. Laege die Entscheidung erst bei
 *    RLS, kaeme sie zu spaet und waere ausserdem die falsche: RLS kennt den
 *    Mandanten, nicht die fachliche Rolle.
 * 3. Eingabe. `PlanningWindowQuerySchema` aus dem Vertrag, nicht eine eigene
 *    Pruefung. Ein zweiter Satz Regeln waere ein zweiter Ableitungspfad.
 * 4. Abfrage.
 * 5. Antwort gegen `PlanningWindowSchema`. Der Server prueft seine EIGENE
 *    Ausgabe, weil ein Vertragsbruch hier entsteht und nicht beim Client — und
 *    weil der Client ihn sonst als CONTRACT_VIOLATION meldet, ohne dass
 *    jemand die Ursache sieht.
 */
import {
  AssignmentDtoSchema,
  CreateAssignmentCommandSchema,
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  PlanValidationResultSchema,
  PlanningWindowQuerySchema,
  PlanningWindowSchema,
  ValidatePlanCommandSchema,
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
  UnauthorizedException,
  UseFilters,
} from "@nestjs/common";

import {
  TENANT_SUBJECT_RESOLVER,
  type TenantSubjectResolver,
} from "../../../../common/tenant-subject";
import {
  PLANNING_ACCESS_POLICY,
  type PlanningAccessPolicy,
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
    case "OUTSIDE_WEEK":
      return new BadRequestException({
        type: PLANNING_ERROR_TYPE.OUTSIDE_WEEK,
        title: "Einsatz außerhalb der Woche",
        detail: `Der Einsatz liegt in Kalenderwoche ${problem.tatsaechlicheWoche}, nicht in der geöffneten Woche. Bitte das Datum prüfen.`,
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
@UseFilters(PlanningProblemFilter)
export class PlanningController {
  constructor(
    @Inject(TENANT_SUBJECT_RESOLVER)
    private readonly subjects: TenantSubjectResolver,
    @Inject(PLANNING_QUERIES_FACTORY)
    private readonly queriesFor: PlanningQueriesFactory,
    @Inject(PLANNING_ACCESS_POLICY)
    private readonly access: PlanningAccessPolicy,
    @Inject(PLANNING_WRITES_FACTORY)
    private readonly writesFor: PlanningWritesFactory,
  ) {}

  @Get("fenster")
  async planningWindow(
    @Req() request: unknown,
    @Query("weekKey") weekKey?: string,
  ): Promise<unknown> {
    const subject = this.subjects.resolve(request);
    if (subject === null) {
      // Kein Detail zur Ursache: ob ein Token fehlte, abgelaufen war oder
      // ungueltig ist, geht den Aufrufer nichts an.
      throw new UnauthorizedException("Kein verifiziertes Subjekt.");
    }

    // Verifiziert heisst nicht berechtigt. Die Pruefung steht VOR jeder
    // Abfrage — sonst laege die Entscheidung faktisch bei RLS, und RLS kennt
    // nur den Mandanten, nicht die fachliche Rolle.
    if (!(await this.access.mayReadPlanning(subject))) {
      throw new ForbiddenException("Keine Leseberechtigung fuer die Planung.");
    }

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
  async validateDraft(@Req() request: unknown, @Body() body: unknown): Promise<unknown> {
    const subject = this.subjects.resolve(request);
    if (subject === null) {
      throw new UnauthorizedException("Kein verifiziertes Subjekt.");
    }
    // Schreibberechtigung, nicht Leseberechtigung: wer nicht anlegen darf, soll
    // auch nicht ausprobieren duerfen, was ein Anlegen ergaebe.
    if (!(await this.access.mayWritePlanning(subject))) {
      throw new ForbiddenException("Keine Schreibberechtigung fuer die Planung.");
    }

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
    @Req() request: unknown,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<unknown> {
    const subject = this.subjects.resolve(request);
    if (subject === null) {
      throw new UnauthorizedException("Kein verifiziertes Subjekt.");
    }
    if (!(await this.access.mayWritePlanning(subject))) {
      throw new ForbiddenException("Keine Schreibberechtigung fuer die Planung.");
    }

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
}
