import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/load.js";

const valid = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost:54322/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "anon-placeholder",
  API_PORT: "3001",
};

/** Removes a key without triggering unused-variable lint noise. */
function omit(env: Record<string, string>, key: string): Record<string, string> {
  const copy: Record<string, string> = { ...env };
  delete copy[key];
  return copy;
}

describe("loadConfig — shared technical schema", () => {
  it("accepts a valid environment", () => {
    const config = loadConfig(valid);
    expect(config.apiPort).toBe(3001);
    expect(config.nodeEnv).toBe("test");
    expect(config.databaseUrl).toBe(valid.DATABASE_URL);
    expect(config.supabaseUrl).toBe(valid.SUPABASE_URL);
    expect(config.supabaseAnonKey).toBe(valid.SUPABASE_ANON_KEY);
  });

  it("defaults LOG_LEVEL to info", () => {
    expect(loadConfig(valid).logLevel).toBe("info");
  });

  it("accepts an explicit LOG_LEVEL", () => {
    expect(loadConfig({ ...valid, LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });

  it("ignores keys whose value is undefined (process.env shape)", () => {
    expect(() => loadConfig({ ...valid, OPTIONAL_UNSET: undefined })).not.toThrow();
  });

  it("rejects missing variables and names them", () => {
    expect(() => loadConfig(omit(valid, "DATABASE_URL"))).toThrow(/DATABASE_URL/);
    expect(() => loadConfig(omit(valid, "SUPABASE_ANON_KEY"))).toThrow(/SUPABASE_ANON_KEY/);
  });

  it("rejects wrongly typed variables and names them", () => {
    expect(() => loadConfig({ ...valid, API_PORT: "not-a-port" })).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...valid, API_PORT: "70000" })).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...valid, API_PORT: "0" })).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...valid, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...valid, LOG_LEVEL: "loudest" })).toThrow(/LOG_LEVEL/);
  });

  it("rejects unknown variables and names them", () => {
    expect(() => loadConfig({ ...valid, TYPO_VAR: "x" })).toThrow(/TYPO_VAR/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});

describe("loadConfig — environment presets", () => {
  it("development falls back to local-stack defaults, except for DATABASE_URL", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      SUPABASE_ANON_KEY: "anon-placeholder",
      DATABASE_URL: "postgresql://easytree_app:local@localhost:54322/postgres",
    });
    expect(config.supabaseUrl).toContain("localhost");
    expect(config.apiPort).toBe(3001);
  });

  it("development requires DATABASE_URL explicitly (EYT-45)", () => {
    // Seit die Anwendung als easytree_app verbindet und die Rolle beim Start
    // prueft, kann ein Default, der keinen Benutzer nennt, nur scheitern.
    // Lieber gar keiner als ein bequem aussehender, der eine Fehlersuche kostet.
    expect(() =>
      loadConfig({ NODE_ENV: "development", SUPABASE_ANON_KEY: "anon-placeholder" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("test preset has no localhost defaults — every variable must be explicit", () => {
    expect(() => loadConfig({ NODE_ENV: "test", SUPABASE_ANON_KEY: "anon-placeholder" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("production is stricter: no default fallback, missing variables throw", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", SUPABASE_ANON_KEY: "anon-placeholder" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("production rejects localhost database and supabase URLs", () => {
    const prod = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db.example.com:5432/easytree",
      SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_ANON_KEY: "anon-placeholder",
      API_PORT: "3001",
    };
    expect(() => loadConfig(prod)).not.toThrow();
    expect(() =>
      loadConfig({ ...prod, DATABASE_URL: "postgresql://localhost:54322/postgres" }),
    ).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...prod, SUPABASE_URL: "http://127.0.0.1:54321" })).toThrow(
      /SUPABASE_URL/,
    );
  });
});
