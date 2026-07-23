import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/load.js";
import { redact, SECRET_ENV_VARS } from "../src/redact.js";

const valid = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost:54322/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "anon-placeholder",
  API_PORT: "3001",
};

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

function fullErrorText(error: unknown): string {
  // String(err) + stack + JSON covers every channel a logger might print.
  const asError = error as Error;
  return [String(error), asError.stack ?? "", JSON.stringify(error)].join("\n");
}

describe("secret redaction in validation errors", () => {
  it("never leaks secret values when validation fails elsewhere", () => {
    const error = captureError(() =>
      loadConfig({ ...valid, SUPABASE_ANON_KEY: "sk-REAL-SECRET", API_PORT: "x" }),
    );
    const text = fullErrorText(error);
    expect(text).not.toContain("sk-REAL-SECRET");
    expect(text).toContain("API_PORT");
  });

  it("never leaks the invalid value itself, only the variable name", () => {
    // Invalid URL (spaces) that still carries credential-looking material.
    const error = captureError(() =>
      loadConfig({ ...valid, DATABASE_URL: "no url user:hunter2@db.internal/prod" }),
    );
    const text = fullErrorText(error);
    expect(text).toContain("DATABASE_URL");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.internal");
  });

  it("never leaks values of unknown variables", () => {
    const error = captureError(() => loadConfig({ ...valid, TYPO_VAR: "leaked-value" }));
    const text = fullErrorText(error);
    expect(text).not.toContain("leaked-value");
    expect(text).toContain("TYPO_VAR");
  });
});

describe("secret markers and redact()", () => {
  it("marks SUPABASE_ANON_KEY and DATABASE_URL as secrets in the schema", () => {
    expect(SECRET_ENV_VARS).toContain("SUPABASE_ANON_KEY");
    expect(SECRET_ENV_VARS).toContain("DATABASE_URL");
    expect(SECRET_ENV_VARS).not.toContain("LOG_LEVEL");
  });

  it("redact() masks secret fields for logging and keeps the rest", () => {
    const config = loadConfig(valid);
    const safe = redact(config);
    const text = JSON.stringify(safe);
    expect(text).not.toContain(valid.SUPABASE_ANON_KEY);
    expect(text).not.toContain(valid.DATABASE_URL);
    expect(safe.supabaseAnonKey).toBe("[REDACTED]");
    expect(safe.databaseUrl).toBe("[REDACTED]");
    expect(safe.apiPort).toBe(3001);
    expect(safe.logLevel).toBe("info");
  });

  it("redact() does not mutate the original config", () => {
    const config = loadConfig(valid);
    redact(config);
    expect(config.supabaseAnonKey).toBe(valid.SUPABASE_ANON_KEY);
  });
});
