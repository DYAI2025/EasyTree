/**
 * Vertragsabgeleiteter HTTP-Client der Anmeldung (EYT-106).
 *
 * Dieselbe Bauart wie `http/planning-gateway.ts`: zentrales `send`,
 * Status→Failure-Abbildung, JEDE 2xx-Antwort geht durch `safeParse`. Cookies
 * setzt und trägt der Browser (`credentials: "same-origin"`); dieser Client
 * fasst sie nie an und kennt keine Tokens.
 */
import { z } from "zod";

import { gatewayFailed, gatewayOk, type GatewayResult } from "../gateway.js";
import { ProblemDocumentSchema, type ProblemDocument } from "../primitives.js";
import type { AuthGateway } from "../auth/gateway.js";
import { SessionDtoSchema, type LoginCommand, type SessionDto } from "../auth/schemas.js";

export interface HttpAuthGatewayOptions {
  readonly fetchImpl: typeof fetch;
}

interface Call<TOut> {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly schema: z.ZodType<TOut>;
  /** 204-Antworten haben keinen Koerper; dann liefert der Aufruf `empty`. */
  readonly empty?: TOut;
}

export class HttpAuthGateway implements AuthGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly options: HttpAuthGatewayOptions,
  ) {}

  login(command: LoginCommand): Promise<GatewayResult<SessionDto>> {
    return this.send({
      path: "/auth/login",
      method: "POST",
      body: command,
      schema: SessionDtoSchema,
    });
  }

  logout(): Promise<GatewayResult<null>> {
    return this.send<null>({
      path: "/auth/logout",
      method: "POST",
      schema: z.null(),
      empty: null,
    });
  }

  session(): Promise<GatewayResult<SessionDto>> {
    return this.send({
      path: "/auth/session",
      method: "GET",
      schema: SessionDtoSchema,
    });
  }

  private async send<TOut>(call: Call<TOut>): Promise<GatewayResult<TOut>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (call.body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await this.options.fetchImpl(`${this.baseUrl}${call.path}`, {
        method: call.method,
        headers,
        // Same-Origin-Cookies explizit — der Vertrag haengt nicht am
        // Browser-Default.
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
      if (response.status >= 500) return gatewayFailed<TOut>("UNAVAILABLE", problem);
      return gatewayFailed<TOut>("REJECTED", problem);
    }

    if (response.status === 204 && call.empty !== undefined) {
      return gatewayOk(call.empty);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
    }

    const parsed = call.schema.safeParse(payload);
    if (!parsed.success) {
      return gatewayFailed<TOut>("CONTRACT_VIOLATION", null);
    }
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
