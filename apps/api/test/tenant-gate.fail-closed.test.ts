/**
 * EYT-66: Fail-closed-Beweis. Im Required-Modus MUSS eine unerreichbare
 * Testdatenbank die Tenant-Suite fehlschlagen lassen (kein gruener Lauf
 * durch Skips). Spawnt einen Kind-Vitest-Lauf mit unerreichbarer DB-URL.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("tenant gate fail-closed (EYT-66)", () => {
  it("required mode + unreachable DB => non-zero exit and no skipped-as-green", async () => {
    let exitCode = 0;
    let output: string;
    try {
      const res = await run(
        "pnpm",
        ["exec", "vitest", "run", "test/tenant-isolation.integration.test.ts"],
        {
          cwd: __dirname + "/..",
          env: {
            ...process.env,
            EASYTREE_TENANT_TESTS: "required",
            EASYTREE_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:59999/postgres",
          },
          timeout: 120_000,
        },
      );
      output = res.stdout + res.stderr;
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      exitCode = e.code ?? 1;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(exitCode).not.toBe(0);
    expect(output).toContain("fail-closed");
  }, 150_000);
});
