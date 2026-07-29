/**
 * Mock-Planer-Gateway (EYT-79).
 *
 * Zweck: die Rollen-Shell klickbar machen, **ohne** eine Backendfunktion
 * vorzutaeuschen. Jede Antwort stammt aus einem sichtbar synthetischen
 * Datenbestand; der Konstruktor verlangt ihn ausdruecklich, es gibt keine
 * eingebauten Demodaten.
 *
 * `induce` setzt gezielt einen Fehlerzustand, damit die Shell Fehler-, Leer- und
 * Stale-Version-Darstellung zeigen kann, ohne dass jemand den Server abschaltet.
 */
import { gatewayFailed, gatewayOk, type GatewayFailure, type GatewayResult } from "../gateway.js";
import type { WriteOptions } from "../planning/gateway.js";
import type { PlanningGateway } from "../planning/gateway.js";
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanValidationResult,
  PlanningWindow,
  PlanningResources,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  ValidatePlanCommand,
} from "../planning/schemas.js";
import { CreateAssignmentCommandSchema, ValidatePlanCommandSchema } from "../planning/schemas.js";
import { IdempotencyKeySchema } from "../primitives.js";

/**
 * Zustand einer einzelnen Woche.
 *
 * Bewusst je Woche und nicht global: eine einzige `publishedVersionId` fuer den
 * ganzen Mock haette die Version aus Woche 32 auch fuer Woche 40 gemeldet, und
 * eine Veroeffentlichung in Woche 40 haette das Ergebnis aus Woche 32 geliefert.
 * Die Stale-Version-Semantik ist aber ausdruecklich pro Planungsfenster — ein
 * Mock, der das vermischt, laesst die Shell einen Zustand ueben, den es nicht gibt.
 */
export interface MockWeekState {
  readonly assignments: readonly AssignmentDto[];
  readonly publishedVersionId: string | null;
  readonly publishResult: PublishedPlanVersion;
}

export interface MockPlanningState {
  readonly timeZone: string;
  /**
   * Auswaehlbare Stammdaten. Ohne Standardwert und ohne eingebaute Demonamen —
   * dieselbe Begruendung wie fuer den ganzen Mock: was hier erscheint, hat ein
   * Test ausdruecklich hingeschrieben. Ein eingebauter Vorrat an „Max
   * Mustermann" liesse eine Auswahlliste befuellt aussehen, ohne dass irgendwo
   * eine Datenquelle existiert.
   */
  readonly resources: PlanningResources;
  /** Wochenschluessel -> Wochenzustand. Fehlt der Schluessel, ist die Woche leer und unveroeffentlicht. */
  readonly weeks: ReadonlyMap<string, MockWeekState>;
  /**
   * Fest verdrahtete oder explizit vom Test konfigurierte Validierungsantwort.
   * Der Mock besitzt weiterhin keine eigene Fachlogik.
   */
  readonly validation:
    PlanValidationResult | ((input: ValidatePlanCommand) => PlanValidationResult);
  /** Erzeugte Id fuer `createAssignment`. Kein Zufall, damit Tests reproduzierbar bleiben. */
  readonly nextAssignmentId: string;
}

export class MockPlanningGateway implements PlanningGateway {
  #induced: GatewayFailure | null = null;
  #lastValidated: ValidatePlanCommand | null = null;
  readonly #assignments = new Map<string, AssignmentDto[]>();
  readonly #idempotency = new Map<
    string,
    { readonly fingerprint: string; readonly assignment: AssignmentDto }
  >();

  constructor(private readonly state: MockPlanningState) {
    for (const [weekKey, week] of state.weeks) {
      this.#assignments.set(weekKey, [...week.assignments]);
    }
  }

  /** Naechster Aufruf schlaegt mit diesem Grund fehl. `null` hebt es auf. */
  induce(failure: GatewayFailure | null): void {
    this.#induced = failure;
  }

  #maybeFail<T>(): GatewayResult<T> | null {
    if (this.#induced === null) return null;
    const failure = this.#induced;
    this.#induced = null;
    return gatewayFailed<T>(failure, {
      type: "about:blank",
      title: "Induzierter Mockfehler",
      status: failure === "FORBIDDEN" ? 403 : 500,
      detail: "Dieser Fehler wurde vom Clickdummy absichtlich ausgeloest.",
      correlationId: "mock-correlation-id",
    });
  }

  getPlanningWindow(input: PlanningWindowQuery): Promise<GatewayResult<PlanningWindow>> {
    const failed = this.#maybeFail<PlanningWindow>();
    if (failed !== null) return Promise.resolve(failed);
    const week = this.state.weeks.get(input.weekKey);
    return Promise.resolve(
      gatewayOk({
        weekKey: input.weekKey,
        timeZone: this.state.timeZone,
        assignments: [...(this.#assignments.get(input.weekKey) ?? [])],
        // Der Mock kennt nur veroeffentlichte Staende; einen Entwurf ueber
        // einer Veroeffentlichung bildet er bewusst nicht nach. Wer diesen
        // Fall pruefen will, braucht den echten Server (EYT-50 AK10).
        sourceVersion:
          week?.publishedVersionId === undefined || week.publishedVersionId === null
            ? null
            : { id: week.publishedVersionId, state: "published" as const },
        publishedVersionId: week?.publishedVersionId ?? null,
        resources: this.state.resources,
      }),
    );
  }

  validateDraft(input: ValidatePlanCommand): Promise<GatewayResult<PlanValidationResult>> {
    // Der Mock rechnet NICHT — er merkt sich nur, was geprueft werden sollte.
    // Ein Test kann damit belegen, DASS der Aufruf kam und womit; er kann daraus
    // aber nicht ableiten, dass die Konfliktpruefung stimmt.
    this.#lastValidated = input;
    const failed = this.#maybeFail<PlanValidationResult>();
    if (failed !== null) return Promise.resolve(failed);
    const parsed = ValidatePlanCommandSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Prüfauftrag unvollständig oder Intervall ungültig",
          400,
        ),
      );
    }
    const validation =
      typeof this.state.validation === "function"
        ? this.state.validation(parsed.data)
        : this.state.validation;
    return Promise.resolve(gatewayOk(validation));
  }

  /** Zuletzt geprueter Entwurf, oder `null`, solange keiner geprueft wurde. */
  get lastValidated(): ValidatePlanCommand | null {
    return this.#lastValidated;
  }

  createAssignment(
    input: CreateAssignmentCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<AssignmentDto>> {
    const failed = this.#maybeFail<AssignmentDto>();
    if (failed !== null) return Promise.resolve(failed);

    const parsed = CreateAssignmentCommandSchema.safeParse(input);
    const key = IdempotencyKeySchema.safeParse(options.idempotencyKey);
    if (!parsed.success || !key.success) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:invalid-interval",
          "Einsatz unvollständig oder Intervall ungültig",
          400,
        ),
      );
    }

    const fingerprint = JSON.stringify(parsed.data);
    const previous = this.#idempotency.get(key.data);
    if (previous !== undefined) {
      return Promise.resolve(
        previous.fingerprint === fingerprint
          ? gatewayOk(previous.assignment)
          : planningRejected(
              "urn:easytree:planning:idempotency-key-reused",
              "Idempotenzschlüssel wurde für einen anderen Einsatz wiederverwendet",
              409,
            ),
      );
    }

    const start = Date.parse(parsed.data.interval.startUtc);
    const end = Date.parse(parsed.data.interval.endUtc);
    const overlap = (this.#assignments.get(parsed.data.weekKey) ?? []).find(
      (assignment) =>
        assignment.employeeId === parsed.data.employeeId &&
        Date.parse(assignment.interval.startUtc) < end &&
        start < Date.parse(assignment.interval.endUtc),
    );
    if (overlap !== undefined) {
      return Promise.resolve(
        planningRejected(
          "urn:easytree:planning:overlapping-assignment",
          "Mitarbeitende Person ist in diesem Zeitraum bereits eingeplant",
          409,
        ),
      );
    }

    const assignment: AssignmentDto = {
      id: this.state.nextAssignmentId,
      employeeId: parsed.data.employeeId,
      worksiteId: parsed.data.worksiteId,
      interval: parsed.data.interval,
    };
    const assignments = this.#assignments.get(parsed.data.weekKey) ?? [];
    this.#assignments.set(parsed.data.weekKey, [...assignments, assignment]);
    this.#idempotency.set(key.data, { fingerprint, assignment });
    return Promise.resolve(gatewayOk(assignment));
  }

  publishPlan(input: PublishPlanCommand): Promise<GatewayResult<PublishedPlanVersion>> {
    const failed = this.#maybeFail<PublishedPlanVersion>();
    if (failed !== null) return Promise.resolve(failed);
    const week = this.state.weeks.get(input.weekKey);
    // Stale-Version-Erkennung ist auch im Mock echt und PRO WOCHE: sonst koennte
    // die Shell den Zustand nie zeigen, den sie behandeln muss — und ein
    // wochenuebergreifender Vergleich wuerde einen Konflikt melden, den es in
    // der angefragten Woche gar nicht gibt.
    if (input.expectedVersionId !== (week?.publishedVersionId ?? null)) {
      return Promise.resolve(
        gatewayFailed<PublishedPlanVersion>("STALE_VERSION", {
          type: "about:blank",
          title: "Veralteter Planstand",
          status: 409,
          detail: "Seit dem Laden wurde eine neue Planversion veroeffentlicht.",
          correlationId: "mock-correlation-id",
        }),
      );
    }
    if (week === undefined) {
      return Promise.resolve(
        gatewayFailed<PublishedPlanVersion>("REJECTED", {
          type: "about:blank",
          title: "Unbekanntes Planungsfenster",
          status: 404,
          detail: `Fuer ${input.weekKey} ist im Clickdummy kein Zustand hinterlegt.`,
          correlationId: "mock-correlation-id",
        }),
      );
    }
    return Promise.resolve(gatewayOk(week.publishResult));
  }
}

function planningRejected<T>(type: string, detail: string, status: number): GatewayResult<T> {
  return gatewayFailed<T>("REJECTED", {
    type,
    title: status === 409 ? "Planungskonflikt" : "Ungültige Planung",
    status,
    detail,
    correlationId: "mock-correlation-id",
  });
}
