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
import type { PlanningGateway } from "../planning/gateway.js";
import type {
  AssignmentDto,
  CreateAssignmentCommand,
  PlanValidationResult,
  PlanningWindow,
  PlanningWindowQuery,
  PublishPlanCommand,
  PublishedPlanVersion,
  ValidatePlanCommand,
} from "../planning/schemas.js";

export interface MockPlanningState {
  readonly timeZone: string;
  /** Wochenschluessel -> Einsaetze. Fehlt der Schluessel, ist die Woche leer. */
  readonly weeks: ReadonlyMap<string, readonly AssignmentDto[]>;
  readonly publishedVersionId: string | null;
  /** Fest verdrahtete Antwort der Validierung — der Mock rechnet NICHT. */
  readonly validation: PlanValidationResult;
  readonly publishResult: PublishedPlanVersion;
  /** Erzeugte Id fuer `createAssignment`. Kein Zufall, damit Tests reproduzierbar bleiben. */
  readonly nextAssignmentId: string;
}

export class MockPlanningGateway implements PlanningGateway {
  #induced: GatewayFailure | null = null;
  #lastValidated: ValidatePlanCommand | null = null;

  constructor(private readonly state: MockPlanningState) {}

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
    return Promise.resolve(
      gatewayOk({
        weekKey: input.weekKey,
        timeZone: this.state.timeZone,
        assignments: [...(this.state.weeks.get(input.weekKey) ?? [])],
        publishedVersionId: this.state.publishedVersionId,
      }),
    );
  }

  validateDraft(input: ValidatePlanCommand): Promise<GatewayResult<PlanValidationResult>> {
    // Der Mock rechnet NICHT — er merkt sich nur, was geprueft werden sollte.
    // Ein Test kann damit belegen, DASS der Aufruf kam und womit; er kann daraus
    // aber nicht ableiten, dass die Konfliktpruefung stimmt.
    this.#lastValidated = input;
    const failed = this.#maybeFail<PlanValidationResult>();
    return Promise.resolve(failed ?? gatewayOk(this.state.validation));
  }

  /** Zuletzt geprueter Entwurf, oder `null`, solange keiner geprueft wurde. */
  get lastValidated(): ValidatePlanCommand | null {
    return this.#lastValidated;
  }

  createAssignment(input: CreateAssignmentCommand): Promise<GatewayResult<AssignmentDto>> {
    const failed = this.#maybeFail<AssignmentDto>();
    if (failed !== null) return Promise.resolve(failed);
    return Promise.resolve(
      gatewayOk({
        id: this.state.nextAssignmentId,
        employeeId: input.employeeId,
        worksiteId: input.worksiteId,
        interval: input.interval,
      }),
    );
  }

  publishPlan(input: PublishPlanCommand): Promise<GatewayResult<PublishedPlanVersion>> {
    const failed = this.#maybeFail<PublishedPlanVersion>();
    if (failed !== null) return Promise.resolve(failed);
    // Stale-Version-Erkennung ist auch im Mock echt: sonst koennte die Shell den
    // Zustand nie zeigen, den sie behandeln muss.
    if (input.expectedVersionId !== this.state.publishedVersionId) {
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
    return Promise.resolve(gatewayOk(this.state.publishResult));
  }
}
