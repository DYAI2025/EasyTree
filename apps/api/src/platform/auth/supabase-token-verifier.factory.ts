/**
 * Produktionsverdrahtung der Tokenverifikation (EYT-106).
 *
 * Die EINE Stelle, an der aus der validierten Konfiguration die reale
 * Pruefkette entsteht: Remote-JWKS von GoTrue, Issuer/Audience aus derselben
 * SUPABASE_URL. Tests verdrahten stattdessen ein lokales JWKS ueber die
 * DI-Tokens — die Pruefregeln selbst sind nicht injizierbar.
 *
 * Gemessen am EasyTree-Kundenprojekt (OQ-005, 31.07.2026): GoTrue stellt dort
 * ES256-Session-Tokens mit `kid` aus, und der JWKS-Endpunkt liefert den
 * passenden Schluessel.
 */
import { createRemoteJWKSet } from "jose";

import type { AppConfig } from "@easytree/config";

import { GotrueSessionLiveness, type SessionLiveness } from "./session-liveness";
import { JoseTokenVerifier, type TokenVerifier } from "./token-verifier";

export function createSupabaseTokenVerifier(config: AppConfig): TokenVerifier {
  return new JoseTokenVerifier({
    getKey: createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`)),
    issuer: `${config.supabaseUrl}/auth/v1`,
    audience: "authenticated",
  });
}

export function createSupabaseSessionLiveness(config: AppConfig): SessionLiveness {
  return new GotrueSessionLiveness({
    supabaseUrl: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
    fetchImpl: (eingabe, init) => fetch(eingabe, init),
  });
}
