import { ENV_VAR_META, type EnvVarName } from "./schema.js";

/** Placeholder that replaces secret values in log-safe output. */
export const REDACTED = "[REDACTED]";

/** Env variable names marked as secret in the schema metadata. */
export const SECRET_ENV_VARS: readonly EnvVarName[] = (
  Object.keys(ENV_VAR_META) as EnvVarName[]
).filter((name) => ENV_VAR_META[name].secret);

/** AppConfig keys corresponding to the secret env variables. */
export const SECRET_CONFIG_KEYS = ["databaseUrl", "supabaseAnonKey"] as const;
export type SecretConfigKey = (typeof SECRET_CONFIG_KEYS)[number];

export type Redacted<T> = {
  [K in keyof T]: K extends SecretConfigKey ? typeof REDACTED : T[K];
};

/**
 * Returns a copy of the given configuration with all secret fields replaced
 * by {@link REDACTED}. Use this before logging or serializing configuration;
 * the input object is never mutated.
 */
export function redact<T extends object>(config: T): Redacted<T> {
  const copy: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  for (const key of SECRET_CONFIG_KEYS) {
    if (key in copy) copy[key] = REDACTED;
  }
  return copy as Redacted<T>;
}
