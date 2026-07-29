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
import { PlanningWindowQuerySchema, PlanningWindowSchema } from "@easytree/contracts";
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  InternalServerErrorException,
  Query,
  Req,
  UnauthorizedException,
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

@Controller("planung")
export class PlanningController {
  constructor(
    @Inject(TENANT_SUBJECT_RESOLVER)
    private readonly subjects: TenantSubjectResolver,
    @Inject(PLANNING_QUERIES_FACTORY)
    private readonly queriesFor: PlanningQueriesFactory,
    @Inject(PLANNING_ACCESS_POLICY)
    private readonly access: PlanningAccessPolicy,
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
}
