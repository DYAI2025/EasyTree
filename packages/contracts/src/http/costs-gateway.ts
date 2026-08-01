/**
 * Vertragsabgeleiteter HTTP-Client des Kostenbereichs (EYT-108 ff.).
 *
 * Bauart wie `http/planning-gateway.ts`: zentrales `send`, Status→Failure,
 * jede 2xx-Antwort durch `safeParse`. Der Organisationsheader kommt aus einer
 * injizierten Funktion — Komponenten kennen weder Header noch Cookies.
 */
import { z } from "zod";

import { gatewayFailed, gatewayOk, type GatewayFailure, type GatewayResult } from "../gateway.js";
import {
  IDEMPOTENCY_HEADER,
  IdempotencyKeySchema,
  ProblemDocumentSchema,
  type IdempotencyKey,
  type ProblemDocument,
} from "../primitives.js";
import type { WriteOptions } from "../planning/gateway.js";
import type { CostsGateway } from "../costs/gateway.js";
import {
  CreateRateVersionCommandSchema,
  EmployeesForRatesSchema,
  RateHistorySchema,
  RateVersionDtoSchema,
  type CreateRateVersionCommand,
  type EmployeesForRates,
  type RateHistory,
  type RateVersionDto,
} from "../costs/schemas.js";

export const ORGANISATION_HEADER = "X-EasyTree-Organization-Id";

export interface HttpCostsGatewayOptions {
  readonly fetchImpl: typeof fetch;
  /**
   * Liefert die AUSGEWÄHLTE Organisation oder null. Der Header wählt nur
   * aus — die Autorisierung entscheidet der Server gegen die Mitgliedschaft.
   */
  readonly organisationId: () => string | null;
}

interface Call<TOut> {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly idempotencyKey: IdempotencyKey | null;
  readonly schema: z.ZodType<TOut>;
  readonly conflictAs: Extract<GatewayFailure, "REJECTED" | "STALE_VERSION">;
}

export class HttpCostsGateway implements CostsGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly options: HttpCostsGatewayOptions,
  ) {}

  listEmployees(): Promise<GatewayResult<EmployeesForRates>> {
    return this.send({
      path: "/kosten/mitarbeiter",
      method: "GET",
      idempotencyKey: null,
      schema: EmployeesForRatesSchema,
      conflictAs: "REJECTED",
    });
  }

  rateHistory(employeeId: string): Promise<GatewayResult<RateHistory>> {
    return this.send({
      path: `/kosten/stundensaetze/${encodeURIComponent(employeeId)}`,
      method: "GET",
      idempotencyKey: null,
      schema: RateHistorySchema,
      conflictAs: "REJECTED",
    });
  }

  createRateVersion(
    command: CreateRateVersionCommand,
    options: WriteOptions,
  ): Promise<GatewayResult<RateVersionDto>> {
    const geprueft = CreateRateVersionCommandSchema.safeParse(command);
    if (!geprueft.success) {
      return Promise.resolve(gatewayFailed<RateVersionDto>("CONTRACT_VIOLATION", null));
    }
    return this.send({
      path: "/kosten/stundensaetze",
      method: "POST",
      body: geprueft.data,
      idempotencyKey: options.idempotencyKey,
      schema: RateVersionDtoSchema,
      // 409 heisst hier: konkurrierende Änderung erkannt (expectedActiveVersionId
      // stimmt nicht mehr) ODER Überlappung — der Server unterscheidet im
      // ProblemDocument; der Zustand für die UI ist in beiden Fällen "nicht
      // gespeichert, neu laden und entscheiden".
      conflictAs: "STALE_VERSION",
    });
  }

  private async send<TOut>(call: Call<TOut>): Promise<GatewayResult<TOut>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (call.body !== undefined) headers["content-type"] = "application/json";

    const organisation = this.options.organisationId();
    if (organisation !== null) headers[ORGANISATION_HEADER] = organisation;

    if (call.idempotencyKey !== null) {
      const key = IdempotencyKeySchema.safeParse(call.idempotencyKey);
      if (!key.success) return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
      headers[IDEMPOTENCY_HEADER] = key.data;
    }

    let response: Response;
    try {
      response = await this.options.fetchImpl(`${this.baseUrl}${call.path}`, {
        method: call.method,
        headers,
        credentials: "same-origin",
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
    } catch {
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
    if (!parsed.success) return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
    return gatewayOk(parsed.data);
  }
}

async function readProblem(response: Response): Promise<ProblemDocument | null> {
  try {
    const parsed = ProblemDocumentSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
