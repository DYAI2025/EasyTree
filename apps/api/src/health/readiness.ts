/**
 * Readiness contract for GET /ready (EYT-42).
 *
 * Indicators are intentionally tiny: for Sprint 1 readiness only means
 * "configuration is loaded" plus a stubbed database ping behind an
 * interface, so the real Supabase ping (EYT-15/EYT-44) can be swapped in
 * later without touching the controller.
 */

export interface ReadinessIndicator {
  readonly name: string;
  isReady(): boolean | Promise<boolean>;
}

/** DI token for the list of readiness indicators consumed by /ready. */
export const READINESS_INDICATORS = "EASYTREE_READINESS_INDICATORS";

/** Minimal database ping abstraction — no real Supabase wiring yet. */
export interface DatabasePing {
  ping(): Promise<boolean>;
}

/** DI token for the {@link DatabasePing} implementation. */
export const DATABASE_PING = "EASYTREE_DATABASE_PING";

/**
 * Stub used until the Supabase stack is wired up: always reachable.
 * Replaced via DI (`provide: DATABASE_PING`) once a real client exists.
 */
export class StubDatabasePing implements DatabasePing {
  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
