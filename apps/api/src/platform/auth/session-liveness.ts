/**
 * Sessionpruefung am Supabase-Auth-Server (EYT-106, AK1b).
 *
 * ## Warum kryptografische Gueltigkeit nicht reicht
 *
 * Ein ES256-Token bleibt bis `exp` mathematisch gueltig — auch nach Logout,
 * Passwortwechsel oder Sperrung. Die Entscheidung "lebt diese Session noch?"
 * kann nur der Auth-Server treffen. PO-Vorgabe: Pruefung JE ANFRAGE, keine
 * Zwischenspeicherung in diesem Slice, Auth-Server unerreichbar ⇒ fail-closed.
 *
 * ## Der Kanal
 *
 * `GET <SUPABASE_URL>/auth/v1/user` mit dem Access-Token als Bearer plus dem
 * anon-Key als `apikey`. 200 heisst: Nutzer existiert und die Session ist
 * nicht widerrufen. 401/403 heisst: widerrufen oder ungueltig. ALLES andere
 * (Netzfehler, 5xx, unerwartete Codes) ist KEINE Auskunft und damit Ablehnung
 * — eine Sicherheitspruefung, die im Zweifel durchwinkt, ist keine.
 *
 * ## Kein Token in Fehlern
 *
 * Ablehnungen tragen nur den Code, niemals Token oder Antwortkoerper.
 */

export const SESSION_REJECTIONS = ["SESSION_REVOKED", "AUTH_SERVER_UNAVAILABLE"] as const;
export type SessionRejection = (typeof SESSION_REJECTIONS)[number];

export class SessionRejectedError extends Error {
  constructor(readonly code: SessionRejection) {
    super(`Session abgelehnt: ${code}`);
    this.name = "SessionRejectedError";
  }
}

export interface SessionLivenessInput {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  /** Injizierbar fuer Tests; Produktion nutzt das globale `fetch`. */
  readonly fetchImpl: typeof fetch;
}

export interface SessionLiveness {
  /** Loest auf, wenn die Session lebt; wirft sonst {@link SessionRejectedError}. */
  assertAlive(accessToken: string): Promise<void>;
}

export class GotrueSessionLiveness implements SessionLiveness {
  constructor(private readonly input: SessionLivenessInput) {}

  async assertAlive(accessToken: string): Promise<void> {
    let antwort: Response;
    try {
      antwort = await this.input.fetchImpl(`${this.input.supabaseUrl}/auth/v1/user`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          apikey: this.input.anonKey,
        },
      });
    } catch {
      // Netzfehler ist keine Auskunft. Fail-closed.
      throw new SessionRejectedError("AUTH_SERVER_UNAVAILABLE");
    }
    if (antwort.status === 200) return;
    if (antwort.status === 401 || antwort.status === 403) {
      throw new SessionRejectedError("SESSION_REVOKED");
    }
    // 5xx, Redirects, alles Unerwartete: Nichtwissen, kein Durchlass.
    throw new SessionRejectedError("AUTH_SERVER_UNAVAILABLE");
  }
}

/** DI-Token: Produktion verdrahtet GoTrue, Tests ersetzen die Pruefung. */
export const SESSION_LIVENESS = "AUTH_SESSION_LIVENESS";
