import { defineConfig } from "@playwright/test";

import { pruefeStagingUrl } from "./harness-wachen";

/**
 * Staging-Abnahme EYT-142 — laeuft gegen das reale VPS/Coolify-Staging.
 * KEIN webServer: das Ziel existiert unabhaengig von diesem Lauf.
 * Bewusst nicht Teil von `pnpm test` und nicht Teil der auth-journey-Suite.
 *
 * Das Ziel wird HIER geprueft, beim Laden der Konfiguration und damit vor
 * jedem Browserstart: die Vorgabe ist die kanonische HTTPS-Origin, ein
 * ausdruecklich gesetztes `EYT_STAGING_URL` muss HTTPS sein — ueber plain
 * HTTP scheitert jeder Schreibvorgang im Browser still an
 * `crypto.randomUUID` (Secure Context; gemessen 25.08.2026, Runbook §3).
 * Eine unbrauchbare Adresse bricht sofort ab, statt spaeter im Lauf in
 * Timeouts oder wirkungslose Klicks zu muenden.
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
    baseURL: pruefeStagingUrl(process.env["EYT_STAGING_URL"]),
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
});
