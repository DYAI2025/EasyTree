import { defineConfig } from "@playwright/test";

/**
 * Konfiguration des integrierten Read-Through-Nachweises (EYT-50).
 *
 * Getrennt von `playwright.config.ts`, weil die Voraussetzungen andere sind:
 * hier laufen Supabase, eine echte API und die Web-App bereits — gestartet vom
 * CI-Job, nicht von Playwright. Deshalb KEIN `webServer`-Block: wer den Server
 * startet, raeumt ihn auch auf, und das ist der Job.
 *
 * `PLAYWRIGHT_BASE_URL` zeigt auf die Web-Origin. Der Browser sieht
 * ausschliesslich sie; die API erreicht er ueber das Next-Rewrite.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /read-through\.spec\.ts$/,
  // Serie statt parallel: die Nachweise arbeiten auf einem gemeinsamen
  // Datenbankstand, und Nachweis 7 stoppt die API fuer alle.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
