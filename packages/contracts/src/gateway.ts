/**
 * Gateway-Ports für beide Rollen-Shells (EYT-79).
 *
 * Die Signaturen stammen aus `docs/audit/INTEGRATION_ARCHITECTURE.md`
 * („UI-Port für Clickdummy und spätere API"). Zwei bewusste Abweichungen, beide
 * begründet statt still vorgenommen:
 *
 * 1. **Rückgabe ist `GatewayResult`, kein nacktes `Promise<T>`.** Das Ticket
 *    verlangt, dass Fehler-, Leer- und Stale-Version-Zustände **über den Port**
 *    modelliert sind (AK 5). Mit `Promise<T>` blieben sie Ausnahmen, und jede
 *    Komponente müsste sie einzeln fangen — genau die Verteilung, die der Port
 *    verhindern soll. `packages/domain` verwendet dasselbe Ergebnisobjekt-Muster.
 * 2. **Transporttypen statt Domaintypen.** Die Analyse tippte `AssignmentView`
 *    mit `TimeInterval`. Das ist eine Klasse mit privaten Feldern und kann nicht
 *    über die Leitung; siehe Dateikopf von `planning/schemas.ts`.
 *
 * `loading` ist absichtlich **kein** Zustand des Ports: das Warten auf ein
 * Promise ist bereits der Ladezustand, ein zusätzliches `{ state: "loading" }`
 * wäre nie beobachtbar. Der Ladezustand gehört in die Komponente, die das
 * Promise hält.
 */
import type { ProblemDocument } from "./primitives.js";

/** Gründe, aus denen ein Portaufruf nicht liefern kann. */
export const GATEWAY_FAILURES = [
  /** Netzwerk oder Server nicht erreichbar. */
  "UNAVAILABLE",
  /** Antwort entspricht nicht dem Vertrag — der Client vertraut ihr bewusst nicht. */
  "CONTRACT_VIOLATION",
  /** Nicht angemeldet oder Sitzung abgelaufen. */
  "UNAUTHENTICATED",
  /** Angemeldet, aber nicht berechtigt. */
  "FORBIDDEN",
  /** Der Client arbeitete auf einem veralteten Stand; inzwischen wurde veröffentlicht. */
  "STALE_VERSION",
  /** Fachliche Ablehnung, Details in `problem`. */
  "REJECTED",
] as const;

export type GatewayFailure = (typeof GATEWAY_FAILURES)[number];

export type GatewayResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly failure: GatewayFailure;
      /** Serverantwort, falls eine kam. `null` bei Netzwerkfehlern. */
      readonly problem: ProblemDocument | null;
    };

export function gatewayOk<T>(value: T): GatewayResult<T> {
  return { ok: true, value };
}

export function gatewayFailed<T>(
  failure: GatewayFailure,
  problem: ProblemDocument | null = null,
): GatewayResult<T> {
  return { ok: false, failure, problem };
}
