import { defineConfig } from "@playwright/test";

/**
 * Staging-Abnahme EYT-142 — laeuft gegen das reale VPS/Coolify-Staging.
 * KEIN webServer: das Ziel existiert unabhaengig von diesem Lauf.
 * Bewusst nicht Teil von `pnpm test` und nicht Teil der auth-journey-Suite.
 */
export default defineConfig({
  testDir: ".",
  // .pwtest.ts wie bei auth-journey: faellt damit weder in den Default-Match
  // der Haupt-Playwright-Config noch in vitest.
  testMatch: /\.pwtest\.ts$/,
  timeout: 180_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env["EYT_STAGING_URL"] ?? "http://srv1308064.hstgr.cloud:3009",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
});
