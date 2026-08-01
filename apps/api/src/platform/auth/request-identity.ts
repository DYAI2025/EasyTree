/**
 * Identitaet einer Anfrage (EYT-106): Cookie ODER Bearer, niemals Raten.
 *
 * Kette je Anfrage, keine Zwischenspeicherung (PO-Entscheidung): zuerst das
 * Token entnehmen, dann Signatur und Claims mit dem JoseTokenVerifier
 * pruefen, danach die Session-Liveness am Auth-Server, erst dann steht die
 * Identitaet fest.
 *
 * Sind Cookie UND Bearer vorhanden und ergeben NICHT dieselbe Identitaet
 * (userId + sessionId), ist das ein Widerspruch, kein Auswahlproblem:
 * `CREDENTIAL_CONFLICT`, HTTP 401 (PO: AUTH_CREDENTIAL_CONFLICT).
 */
import { ACCESS_COOKIE, readCookie } from "./session-cookies";
import type { SessionLiveness } from "./session-liveness";
import type { TokenVerifier, VerifiedIdentity } from "./token-verifier";

export const IDENTITY_REJECTIONS = ["MISSING", "CREDENTIAL_CONFLICT"] as const;
export type IdentityRejection = (typeof IDENTITY_REJECTIONS)[number];

export class IdentityRejectedError extends Error {
  constructor(readonly code: IdentityRejection) {
    super(`Identitaet abgelehnt: ${code}`);
    this.name = "IdentityRejectedError";
  }
}

export interface RequestCredentials {
  readonly cookieHeader: string | undefined;
  readonly authorizationHeader: string | undefined;
}

export class RequestIdentityService {
  constructor(
    private readonly verifier: TokenVerifier,
    private readonly liveness: SessionLiveness,
  ) {}

  /**
   * Liefert die verifizierte Identitaet oder wirft:
   * {@link IdentityRejectedError}, `TokenRejectedError`, `SessionRejectedError`.
   */
  async identify(credentials: RequestCredentials): Promise<VerifiedIdentity> {
    const cookieToken = readCookie(credentials.cookieHeader, ACCESS_COOKIE);
    const bearerToken = readBearer(credentials.authorizationHeader);

    if (cookieToken === null && bearerToken === null) {
      throw new IdentityRejectedError("MISSING");
    }

    if (cookieToken !== null && bearerToken !== null && cookieToken !== bearerToken) {
      // Zwei VERSCHIEDENE Tokens: beide pruefen und vergleichen. Gleiche
      // Identitaet (z. B. frisches plus aelteres Token derselben Sitzung
      // gibt es nicht — session_id unterscheidet) => Konflikt nur bei
      // tatsaechlich abweichender Identitaet.
      const [vomCookie, vomBearer] = await Promise.all([
        this.verifier.verify(cookieToken),
        this.verifier.verify(bearerToken),
      ]);
      if (vomCookie.userId !== vomBearer.userId || vomCookie.sessionId !== vomBearer.sessionId) {
        throw new IdentityRejectedError("CREDENTIAL_CONFLICT");
      }
      await this.liveness.assertAlive(cookieToken);
      return vomCookie;
    }

    const token = cookieToken ?? bearerToken;
    // readCookie/readBearer liefern hier mindestens einen Wert; die Pruefung
    // oben hat den Doppel-null-Fall bereits beendet.
    const identitaet = await this.verifier.verify(token as string);
    await this.liveness.assertAlive(token as string);
    return identitaet;
  }
}

function readBearer(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined) return null;
  const treffer = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return treffer?.[1] ?? null;
}

/** DI-Token fuer die komplette Identitaetskette einer Anfrage. */
export const REQUEST_IDENTITY = "AUTH_REQUEST_IDENTITY";
