/**
 * Fail-closed JWT-Verifikation gegen den Supabase-JWKS (EYT-106, AK1).
 *
 * ## Bindende Vorgaben (PO-Entscheidung 31.07.2026)
 *
 * - Asymmetrisch ueber JWKS, erlaubt ist ausschliesslich die Allowlist unten
 *   (ES256). KEIN Shared Secret in der API, KEIN stiller HS256-Rueckfall,
 *   KEINE Algorithmuswahl anhand des Token-Headers.
 * - Gemessen (OQ-005, 31.07.2026): GoTrue signiert Session-Tokens lokal wie
 *   gehostet standardmaessig ES256 mit `kid`; der JWKS-Endpunkt liefert den
 *   passenden Schluessel. `ANON_KEY`/`SERVICE_ROLE_KEY` sind HS256-Legacy-
 *   API-Keys, keine Session-Tokens — genau deshalb ist HS256 hier verboten.
 * - Geprueft werden `kid`, Signatur, `iss`, `aud`, `exp`, `sub` und
 *   `session_id`. Fehlt eines davon oder passt es nicht: Ablehnung mit
 *   praezisem Code, niemals Durchlass.
 *
 * ## Kein Token in Fehlern
 *
 * Ablehnungen tragen NUR den Code. Weder das Token noch Claim-Inhalte
 * erscheinen in Meldungen — derselbe Vertrag wie bei der Konfiguration
 * (AK9 haengt spaeter einen Korrelationslogger daran, nicht mehr Inhalt).
 */
import { errors, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";

/** Jede Ablehnungsklasse einzeln benannt — Tests fahren die Liste ab. */
export const TOKEN_REJECTIONS = [
  "MALFORMED",
  "SIGNATURE_INVALID",
  "ALGORITHM_NOT_ALLOWED",
  "KEY_UNKNOWN",
  "ISSUER_MISMATCH",
  "AUDIENCE_MISMATCH",
  "EXPIRED",
  "SUBJECT_MISSING",
  "SESSION_MISSING",
] as const;
export type TokenRejection = (typeof TOKEN_REJECTIONS)[number];

export class TokenRejectedError extends Error {
  constructor(readonly code: TokenRejection) {
    // Bewusst nur der Code — kein Token, kein Claim-Inhalt.
    super(`Token abgelehnt: ${code}`);
    this.name = "TokenRejectedError";
  }
}

/** Ergebnis einer erfolgreichen Verifikation — mehr gibt es hier nicht. */
export interface VerifiedIdentity {
  readonly userId: string;
  readonly sessionId: string;
}

export interface TokenVerifierInput {
  /**
   * Schluesselquelle: in Produktion `createRemoteJWKSet` auf
   * `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, im Test ein lokales
   * JWKS. Die Quelle ist injizierbar, die Pruefregeln sind es NICHT.
   */
  readonly getKey: JWTVerifyGetKey;
  readonly issuer: string;
  readonly audience: string;
}

export interface TokenVerifier {
  /** Liefert die Identitaet oder wirft {@link TokenRejectedError}. */
  verify(token: string): Promise<VerifiedIdentity>;
}

/** Die EINE erlaubte Algorithmusliste. Nicht konfigurierbar — absichtlich. */
const ALGORITHM_ALLOWLIST = ["ES256"];

export class JoseTokenVerifier implements TokenVerifier {
  constructor(private readonly input: TokenVerifierInput) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: Record<string, unknown>;
    try {
      const ergebnis = await jwtVerify(token, this.input.getKey, {
        issuer: this.input.issuer,
        audience: this.input.audience,
        algorithms: ALGORITHM_ALLOWLIST,
      });
      payload = ergebnis.payload;
    } catch (fehler) {
      throw new TokenRejectedError(klassifiziere(fehler));
    }
    // `sub` und `session_id` prueft jose nicht — hier, und zwar VOR jeder
    // Verwendung. Ein leerer String zaehlt als fehlend: fail-closed.
    const sub = payload["sub"];
    if (typeof sub !== "string" || sub === "") {
      throw new TokenRejectedError("SUBJECT_MISSING");
    }
    const sessionId = payload["session_id"];
    if (typeof sessionId !== "string" || sessionId === "") {
      throw new TokenRejectedError("SESSION_MISSING");
    }
    return { userId: sub, sessionId };
  }
}

/**
 * Ordnet jeden jose-Fehler GENAU EINER Ablehnungsklasse zu. Unbekanntes wird
 * MALFORMED — die fail-closed Restklasse, niemals Durchlass.
 *
 * Reihenfolge: `JWTExpired` erbt von `JWTClaimValidationFailed`, muss also
 * zuerst geprueft werden, sonst wird ein Ablauf als Claim-Fehler gemeldet.
 */
function klassifiziere(fehler: unknown): TokenRejection {
  if (fehler instanceof errors.JWTExpired) return "EXPIRED";
  if (fehler instanceof errors.JWTClaimValidationFailed) {
    if (fehler.claim === "iss") return "ISSUER_MISMATCH";
    if (fehler.claim === "aud") return "AUDIENCE_MISMATCH";
    return "MALFORMED";
  }
  if (fehler instanceof errors.JOSEAlgNotAllowed) return "ALGORITHM_NOT_ALLOWED";
  if (fehler instanceof errors.JWKSNoMatchingKey) return "KEY_UNKNOWN";
  if (fehler instanceof errors.JWSSignatureVerificationFailed) return "SIGNATURE_INVALID";
  return "MALFORMED";
}
