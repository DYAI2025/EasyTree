/**
 * `@easytree/config` — validated environment configuration for web, api
 * and worker (EYT-43). Strict Zod schema (unknown variables are rejected),
 * NODE_ENV-selected presets and secret redaction for logging.
 */
export {
  ENV_VAR_META,
  envSchemas,
  LOG_LEVELS,
  NODE_ENVS,
  type AppConfig,
  type EnvVarName,
  type LogLevel,
  type NodeEnv,
} from "./schema.js";
export { ConfigValidationError, loadConfig } from "./load.js";
export {
  redact,
  REDACTED,
  SECRET_CONFIG_KEYS,
  SECRET_ENV_VARS,
  type Redacted,
  type SecretConfigKey,
} from "./redact.js";

/** Pipeline readiness flag from the workspace scaffold (EYT-40). */
export const configPackageReady = true;
