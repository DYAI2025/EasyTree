/**
 * Vertragsabgeleiteter HTTP-Client fuer den Planer-Port (EYT-50 AK3).
 *
 * ## Was "vertragsabgeleitet" heisst — und was es nicht heisst
 *
 * Kein Codegenerator. Diese Datei schreibt KEINE eigenen Datentypen: jede
 * Anfrage- und Antwortform kommt aus den Zod-Schemata in `../planning/schemas.js`,
 * und die Typen entstehen daraus per `z.infer`. Ein von Hand nachgebautes DTO
 * waere eine zweite Wahrheit, die still auseinanderlaufen kann; genau deshalb
 * gibt es hier keine.
 *
 * Das Erzeugen eines Clients AUS dem OpenAPI-Dokument bleibt ausdruecklich
 * draussen (EYT-47). Das Dokument entsteht selbst aus diesem Vertragscode —
 * ein Client daraus waere ein Rundweg, der keine Sicherheit hinzufuegt, die
 * nicht schon aus den Schemata kaeme. Das Dokument bleibt, wofuer es taugt:
 * Dokumentation, Routenkonformitaet, Driftpruefung.
 *
 * ## Warum die Antwort geprueft wird, obwohl der Server denselben Vertrag hat
 *
 * Weil "hat denselben Vertrag" eine Annahme ueber einen anderen Prozess ist.
 * Ein aelterer Server, ein Proxy mit Fehlerseite, ein halb ausgerollter Stand —
 * in allen drei Faellen kommt etwas an, das wie JSON aussieht. Ungeprueft
 * wanderte es als `PlanningWindow` durch die UI und faellt erst irgendwo tief
 * drin auf.
 *
 * `GATEWAY_FAILURES` sieht dafuer `CONTRACT_VIOLATION` vor, mit dem Kommentar
 * "der Client vertraut ihr bewusst nicht" — der Zustand war vorgesehen und nie
 * gebaut. Hier wird er erzeugt.
 *
 * ## Was hier NICHT entschieden wird
 *
 * Authentifizierung. Der Client reicht durch, was ihm `authorization` liefert,
 * und erfindet nichts. Ohne Anmeldung antwortet der Server 401, und daraus wird
 * `UNAUTHENTICATED` — nicht ein stiller Leerzustand.
 */
import type { z } from "zod";

import { gatewayFailed, gatewayOk, type GatewayResult } from "../gateway.js";
import {
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  ProblemDocumentSchema,
  type ProblemDocument,
} from "../primitives.js";
import type { PlanningGateway, WriteOptions } from "../planning/gateway.js";
import {
  AssignmentDtoSchema,
  PlanValidationResultSchema,
  PlanningWindowSchema,
  PublishedPlanVersionSchema,
  type CreateAssignmentCommand,
  type PlanningWindowQuery,
  type PublishPlanCommand,
  type ValidatePlanCommand,
} from "../planning/schemas.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpPlanningGatewayOptions {
  /** Basis inklusive Vertragspfad, z. B. `https://api.example.org/api/v1`. */
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
  /**
   * Liefert den `Authorization`-Wert, oder `null`. Bewusst eine Funktion: ein
   * einmal eingesammeltes Token waere nach dem ersten Ablauf still falsch.
   */
  readonly authorization?: () => string | null;
}
// Bewusst KEINE Option fuer den Idempotenzschluessel.
//
// Hier stand eine `newIdempotencyKey`-Fabrik, und sie war der Fehler: der
// Client erzeugte bei jedem Aufruf einen neuen Schluessel. Eine Wiederholung
// nach verlorener Antwort bekam damit einen ANDEREN Schluessel, der Server
// erkannte sie nicht als Wiederholung, und der Doppeleffekt trat genau in dem
// Fall ein, gegen den der Schluessel schuetzen soll.
//
// Der Test dazu war ebenfalls wertlos: er spritzte eine Fabrik ein, die immer
// dieselbe Konstante lieferte, und "bewies" damit nur das Verhalten der
// Attrappe. Zwei Aufrufe desselben fachlichen Vorgangs hat er nie gefahren.
//
// Jetzt liefert der AUFRUFER den Schluessel (siehe `WriteOptions`). Der Client
// kann keinen erfinden — nicht als Vorsichtsmassnahme, sondern weil ihm die
// Faehigkeit fehlt.

/** Ein einzelner Aufruf, bevor `fetch` ihn sieht. */
interface Call<TOut> {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  /** Der Schluessel des fachlichen Vorgangs, oder `null` bei lesenden Aufrufen. */
  readonly idempotencyKey: string | null;
  readonly schema: z.ZodType<TOut>;
  /** Was ein 409 an dieser Stelle bedeutet. */
  readonly conflictAs: "REJECTED" | "STALE_VERSION";
}

export class HttpPlanningGateway implements PlanningGateway {
  private readonly baseUrl: string;

  constructor(private readonly options: HttpPlanningGatewayOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  getPlanningWindow(
    input: PlanningWindowQuery,
  ): Promise<GatewayResult<z.infer<typeof PlanningWindowSchema>>> {
    const query = new URLSearchParams({ weekKey: input.weekKey });
    return this.send({
      path: `/planung/fenster?${query.toString()}`,
      method: "GET",
      idempotencyKey: null,
      schema: PlanningWindowSchema,
      conflictAs: "REJECTED",
    });
  }

  validateDraft(
    input: ValidatePlanCommand,
  ): Promise<GatewayResult<z.infer<typeof PlanValidationResultSchema>>> {
    // Pruefen ohne Schreibwirkung: kein Idempotenzschluessel, weil es nichts
    // gibt, das ein zweites Mal entstehen koennte.
    return this.send({
      path: "/planung/entwuerfe/validierung",
      method: "POST",
      body: input,
      idempotencyKey: null,
      schema: PlanValidationResultSchema,
      conflictAs: "REJECTED",
    });
  }

  createAssignment(
    input: CreateAssignmentCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<z.infer<typeof AssignmentDtoSchema>>> {
    return this.send({
      path: "/planung/einsaetze",
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey,
      schema: AssignmentDtoSchema,
      conflictAs: "REJECTED",
    });
  }

  publishPlan(
    input: PublishPlanCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<z.infer<typeof PublishedPlanVersionSchema>>> {
    // 409 heisst hier etwas anderes als bei den uebrigen Aufrufen: der Client
    // arbeitete auf einem veralteten Stand. `expectedVersionId` ist genau
    // dafuer da, und die UI muss darauf anders reagieren als auf eine
    // fachliche Ablehnung — deshalb ein eigener Fehlerzustand.
    return this.send({
      path: "/planung/versionen",
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey,
      schema: PublishedPlanVersionSchema,
      conflictAs: "STALE_VERSION",
    });
  }

  private async send<TOut>(call: Call<TOut>): Promise<GatewayResult<TOut>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (call.body !== undefined) headers["content-type"] = "application/json";

    const authorization = this.options.authorization?.() ?? null;
    if (authorization !== null) headers["authorization"] = authorization;

    if (call.idempotencyKey !== null) {
      // Geprueft, obwohl der Typ gebrandet ist: ein `as IdempotencyKey` beim
      // Aufrufer umgeht den Brand, und ein leerer oder formal ungueltiger
      // Schluessel waere fuer den Server nicht unterscheidbar von gar keinem.
      // Der Fehler gehoert hierhin, wo er benannt werden kann, und nicht in
      // eine Serverantwort, die niemand einem Header zuordnet.
      const key = IdempotencyKeySchema.safeParse(call.idempotencyKey);
      if (!key.success) {
        return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
      }
      headers[IDEMPOTENCY_HEADER] = key.data;
    }

    let response: Response;
    try {
      response = await this.options.fetchImpl(`${this.baseUrl}${call.path}`, {
        method: call.method,
        headers,
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
    } catch {
      // Netzwerk, DNS, abgebrochene Verbindung: es kam nichts an, also gibt es
      // auch kein ProblemDocument.
      return gatewayFailed<TOut>("UNAVAILABLE", null);
    }

    if (!response.ok) {
      const problem = await readProblem(response);
      if (response.status === 401) return gatewayFailed<TOut>("UNAUTHENTICATED", problem);
      if (response.status === 403) return gatewayFailed<TOut>("FORBIDDEN", problem);
      if (response.status === 409) return gatewayFailed<TOut>(call.conflictAs, problem);
      if (response.status >= 500) return gatewayFailed<TOut>("UNAVAILABLE", problem);
      return gatewayFailed<TOut>("REJECTED", problem);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
    }

    const parsed = call.schema.safeParse(payload);
    if (!parsed.success) {
      // Der Server hat 200 gesagt und etwas anderes geliefert. Das ist kein
      // Fachfehler, sondern ein gebrochener Vertrag — und der Client gibt die
      // Daten NICHT weiter, auch nicht "so gut es geht".
      return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
    }
    return gatewayOk(parsed.data);
  }
}

/**
 * Liest ein ProblemDocument aus einer Fehlerantwort, oder `null`.
 *
 * Ein Server, der bei 4xx etwas Unerwartetes schickt, macht daraus keinen
 * zweiten Fehler: der Fehlerzustand steht schon fest, das Dokument ist die
 * Zusatzinformation.
 */
async function readProblem(response: Response): Promise<ProblemDocument | null> {
  try {
    const parsed = ProblemDocumentSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
