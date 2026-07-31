import { envSchemas, NODE_ENVS, type AppConfig, type NodeEnv } from "./schema.js";

type ProblemReason = "missing" | "invalid" | "unknown";

interface Problem {
  variable: string;
  reason: ProblemReason;
}

/**
 * Redaction contract (EYT-43): validation errors name ONLY variable names,
 * never values. We deliberately do not rethrow or attach the underlying
 * ZodError (no `cause`) because its issues/messages can embed the received
 * input, which may be a secret. Everything a logger could serialize from
 * this error (message, stack, JSON) is built exclusively from variable
 * names and coarse reasons.
 */
export class ConfigValidationError extends Error {
  readonly problems: readonly Problem[];

  constructor(problems: readonly Problem[]) {
    const byReason = (reason: ProblemReason): string[] =>
      problems.filter((p) => p.reason === reason).map((p) => p.variable);

    const parts: string[] = [];
    const missing = byReason("missing");
    const invalid = byReason("invalid");
    const unknown = byReason("unknown");
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (invalid.length > 0) parts.push(`invalid: ${invalid.join(", ")}`);
    if (unknown.length > 0) parts.push(`unknown: ${unknown.join(", ")}`);

    super(
      `Invalid environment configuration — ${parts.join("; ")}. ` +
        "Variable values are never included in this message.",
    );
    this.name = "ConfigValidationError";
    this.problems = problems;
  }
}

function isNodeEnv(value: string): value is NodeEnv {
  return (NODE_ENVS as readonly string[]).includes(value);
}

/**
 * Validates the given environment against the preset selected by NODE_ENV
 * and returns the typed application configuration.
 *
 * Throws {@link ConfigValidationError} for missing, wrongly typed and
 * unknown variables. Keys with `undefined` values are ignored so that
 * `process.env` can be passed directly.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) cleaned[key] = value;
  }

  const nodeEnv = cleaned["NODE_ENV"];
  if (nodeEnv === undefined || !isNodeEnv(nodeEnv)) {
    throw new ConfigValidationError([
      { variable: "NODE_ENV", reason: nodeEnv === undefined ? "missing" : "invalid" },
    ]);
  }

  const result = envSchemas[nodeEnv].safeParse(cleaned);
  if (!result.success) {
    const problems = new Map<string, Problem>();
    for (const issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) {
          problems.set(key, { variable: key, reason: "unknown" });
        }
        continue;
      }
      const variable = String(issue.path[0] ?? "NODE_ENV");
      // "missing" vs. "invalid" is derived from the input keys, not from
      // zod's message, so no received value can ever leak into the error.
      const reason: ProblemReason = variable in cleaned ? "invalid" : "missing";
      problems.set(variable, { variable, reason });
    }
    throw new ConfigValidationError([...problems.values()]);
  }

  const data = result.data;
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    supabaseUrl: data.SUPABASE_URL,
    supabaseAnonKey: data.SUPABASE_ANON_KEY,
    apiPort: data.API_PORT,
    logLevel: data.LOG_LEVEL,
    databaseSslRootCert: data.DATABASE_SSL_ROOT_CERT,
  };
}
