import { z } from "zod";

/**
 * Shared technical environment schema for web, api and worker (EYT-43).
 *
 * One canonical set of variables, validated strictly: unknown variables are
 * rejected so that typos (`DATABSE_URL`) fail loudly at startup instead of
 * silently falling back to defaults.
 */

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Secret markers, kept next to the schema as the single source of truth.
 * - SUPABASE_ANON_KEY: credential material by definition.
 * - DATABASE_URL: connection strings routinely embed username/password,
 *   so the whole value is treated as secret.
 * Consumers (loggers, error formatters) must use `redact()` from
 * `./redact.js` before printing configuration.
 */
export const ENV_VAR_META = {
  NODE_ENV: { secret: false },
  DATABASE_URL: { secret: true },
  SUPABASE_URL: { secret: false },
  SUPABASE_ANON_KEY: { secret: true },
  API_PORT: { secret: false },
  LOG_LEVEL: { secret: false },
} as const;

export type EnvVarName = keyof typeof ENV_VAR_META;

const portSchema = z.coerce.number().int().min(1).max(65535);

/**
 * Hostnames that indicate a local development stack. Used to make the
 * production preset reject accidental localhost configuration.
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

const nonLocalUrlSchema = z.url().refine(
  (value) => {
    try {
      return !LOCAL_HOSTNAMES.has(new URL(value).hostname);
    } catch {
      return false;
    }
  },
  // Message intentionally contains no value — see redaction contract in load.ts.
  { message: "must not point to a localhost address in production" },
);

/**
 * Environment presets, selected via NODE_ENV.
 *
 * development: convenience defaults matching the local Supabase stack
 *   (supabase start exposes API on 54321, Postgres on 54322), so a fresh
 *   checkout only needs the anon key to boot.
 *
 * test: NO defaults for connection targets. Tests must state their inputs
 *   explicitly, otherwise a missing variable would be masked by a default
 *   and the suite would silently talk to the wrong backend.
 *
 * production: strictest preset — no defaults at all AND localhost URLs are
 *   rejected outright. Rationale: a production process that falls back to
 *   a localhost default does not fail, it "works" against a non-existent
 *   or wrong database and loses/leaks data. Misconfiguration in production
 *   must be a hard startup failure, never a silent fallback.
 */
export const envSchemas = {
  development: z.strictObject({
    NODE_ENV: z.enum(NODE_ENVS),
    DATABASE_URL: z.url().default("postgresql://localhost:54322/postgres"),
    SUPABASE_URL: z.url().default("http://localhost:54321"),
    SUPABASE_ANON_KEY: z.string().min(1),
    API_PORT: portSchema.default(3001),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  }),
  test: z.strictObject({
    NODE_ENV: z.enum(NODE_ENVS),
    DATABASE_URL: z.url(),
    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    API_PORT: portSchema,
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  }),
  production: z.strictObject({
    NODE_ENV: z.enum(NODE_ENVS),
    DATABASE_URL: nonLocalUrlSchema,
    SUPABASE_URL: nonLocalUrlSchema,
    SUPABASE_ANON_KEY: z.string().min(1),
    API_PORT: portSchema,
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  }),
} satisfies Record<NodeEnv, z.ZodType>;

/** Validated application configuration shared by web, api and worker. */
export interface AppConfig {
  nodeEnv: NodeEnv;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiPort: number;
  logLevel: LogLevel;
}
