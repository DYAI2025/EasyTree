import { defineConfig } from "@playwright/test";

/**
 * Real-Browser-Smoke der Web-Shell (EYT-58b): laeuft gegen den
 * Produktions-Build (`next start`), Chromium via Playwright.
 *
 * PLAYWRIGHT_CHROMIUM_PATH ist ein OPTIONALER Escape-Hatch fuer
 * Umgebungen mit vorinstalliertem Chromium abweichender Revision
 * (z. B. Sandbox ohne Browser-Download). In CI bleibt die Variable
 * ungesetzt und Playwright nutzt seine eigene Browser-Installation.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  /**
   * Der integrierte Read-Through-Nachweis laeuft NICHT hier (EYT-50).
   *
   * `web-smoke` startet nur `next start` — ohne API, ohne Datenbank, ohne
   * Seed. `read-through.spec.ts` braucht alle drei und wuerde hier zwangslaeufig
   * scheitern. Er hat eine eigene Konfiguration (playwright.harness.config.ts)
   * und einen eigenen CI-Job.
   *
   * Ohne diese Zeile haette der Harness-Commit `web-smoke` rot gemacht — ein
   * Fehlschlag, der wie ein echter Befund aussieht und keiner ist.
   */
  testIgnore: /read-through\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
  },
  webServer: {
    command: "pnpm exec next start -p 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
