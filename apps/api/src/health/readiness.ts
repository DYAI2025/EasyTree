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

/**
 * Minimal database ping abstraction. Production wires `PgDatabasePing`
 * (EYT-58, siehe ../platform/database/pg-database-ping.ts); tests override the token.
 */
export interface DatabasePing {
  ping(): Promise<boolean>;
}

/** DI token for the {@link DatabasePing} implementation. */
export const DATABASE_PING = "EASYTREE_DATABASE_PING";

/**
 * Always-reachable stub, kept ONLY for tests: e2e cases override
 * `DATABASE_PING` with it to model a healthy database without opening
 * real TCP connections. Production uses `PgDatabasePing`.
 */
export class StubDatabasePing implements DatabasePing {
  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
