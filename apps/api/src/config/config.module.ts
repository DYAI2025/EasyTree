import { ENV_VAR_META, loadConfig, type AppConfig } from "@easytree/config";
import { Global, Module } from "@nestjs/common";

/** DI token for the validated application configuration. */
export const APP_CONFIG = "EASYTREE_APP_CONFIG";

/**
 * `loadConfig` validates with a STRICT schema (unknown keys are rejected),
 * so the process environment — which always carries unrelated OS/tooling
 * variables — is first narrowed to the canonical variable set declared by
 * `ENV_VAR_META` in @easytree/config.
 */
function declaredEnvSubset(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const subset: Record<string, string | undefined> = {};
  for (const key of Object.keys(ENV_VAR_META)) {
    subset[key] = env[key];
  }
  return subset;
}

/**
 * Wrapper around `@easytree/config` (EYT-43): the environment is validated
 * exactly once at bootstrap and the resulting typed {@link AppConfig} is
 * provided via DI. Invalid environments throw a redacted
 * `ConfigValidationError` and abort startup — no silent fallbacks.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(declaredEnvSubset(process.env)),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
