import { join, resolve } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Konfiguration der realen Auth-Kostenreise (EYT-106 AK8, EYT-134).
 *
 * ## Warum eine eigene Konfiguration in diesem Ordner
 *
 * `apps/web/playwright.config.ts` (Job `web-smoke`) startet nur `next start` —
 * ohne API, ohne Datenbank, ohne Auth-Server. Diese Reise braucht alle drei.
 * Dieselbe Trennung wie beim Read-Through-Nachweis (EYT-50).
 *
 * ## Warum die Reisedatei nicht `.spec.ts` heisst
 *
 * `web-smoke` sammelt mit `testDir: "./e2e"` rekursiv jede `*.spec.ts` ein und
 * kennt heute genau eine Ausnahme (`read-through.spec.ts`). Eine zweite
 * Ausnahme dort einzutragen hiesse, `apps/web/playwright.config.ts` zu
 * aendern — diese Datei steht nicht im freigegebenen Aenderungsbereich von
 * Sprint 5. Die Endung `.pwtest.ts` faellt aus Playwrights Standard-`testMatch`
 * heraus und wird hier ausdruecklich eingesammelt; damit bleibt `web-smoke`
 * unberuehrt, ohne dass jemand eine Ignorierliste pflegen muss.
 *
 * ## Warum Playwright die Server startet, Supabase aber nicht
 *
 * API und Web gehoeren zu DIESEM Lauf: Playwright startet sie und beendet sie
 * garantiert wieder, auch wenn ein Test abstuerzt — das ist verlaesslicher als
 * ein `trap` ueber mehrere Workflow-Schritte. Supabase ist Docker und lebt
 * laenger als der Lauf; es bleibt Sache des CI-Jobs, der es auch wieder
 * stoppt.
 *
 * ## Die API ist die ECHTE
 *
 * `apps/api/dist/main.js`, nicht `dist-harness`. Der Harness ersetzt
 * Subjektresolver und Access-Policy und wuerde jede Anfrage autorisieren —
 * genau das, was AK8 ausschliesst. Der erste Nachweis der Reise misst das
 * nach, statt es zu behaupten.
 *
 * ## Warum jeder Pfad hier absolut ist
 *
 * Playwright loest `webServer.cwd` und `reporter.outputFile` gegen das
 * ARBEITSVERZEICHNIS des Aufrufs auf, `outputDir` und `globalSetup` dagegen
 * gegen das Konfigurationsverzeichnis. Zwei Bezugspunkte in einer Datei sind
 * eine Falle: relativ notiert zeigte `../../../api` je nach Aufrufort auf
 * `apps/api` oder neben das Repository.
 */
// `__dirname`, nicht `import.meta.url`: Playwright laedt Konfiguration,
// Setup und Testdateien als CommonJS — `apps/web/package.json` traegt kein
// "type": "module". Mit import.meta bricht der Lauf mit
// "Cannot use 'import.meta' outside a module" ab, bevor irgendein
// Nachweis laeuft (gemessen in CI 01.08.2026). Die beiden bestehenden
// Playwright-Konfigurationen benutzen aus demselben Grund keine.
const HIER = __dirname;
const WEB_WURZEL = resolve(HIER, "..", "..");
const API_WURZEL = resolve(WEB_WURZEL, "..", "api");
// Unterhalb von `test-results/` — dieses Verzeichnis ist bereits in
// `.gitignore` (Z. 11) und wird vom Read-Through-Job schon als Artefakt
// eingesammelt. Ein neuer Ordner daneben waere untracked, nicht ignoriert
// und faende sich beim naechsten `git add` im Commit wieder.
const ARTEFAKTE = join(WEB_WURZEL, "test-results", "auth-journey");

const API_PORT = process.env["EASYTREE_JOURNEY_API_PORT"] ?? "3101";
const WEB_PORT = process.env["EASYTREE_JOURNEY_WEB_PORT"] ?? "3100";
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

function pflicht(name: string): string {
  const wert = process.env[name];
  if (wert === undefined || wert === "") {
    // Fail-closed: ohne echte Supabase-Koordinaten liefe die Reise gegen einen
    // Auth-Server, den es nicht gibt, und scheiterte mit einer irrefuehrenden
    // Browsermeldung statt mit dem wahren Grund.
    throw new Error(
      `[auth-journey] ${name} fehlt. Die Reise braucht den laufenden lokalen Supabase-Stack ` +
        `(pnpm exec supabase status -o env).`,
    );
  }
  return wert;
}

export default defineConfig({
  testDir: ".",
  testMatch: /\.pwtest\.ts$/,
  // Testdaten entstehen vor dem Lauf und verschwinden danach (AK8). Der
  // CI-Job raeumt zusaetzlich mit `if: always()` ab — falls Playwright selbst
  // abstuerzt, laeuft `globalTeardown` naemlich nicht mehr.
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  // Eine Reise, ein Zustand: Schritt 10 macht die Sitzung ungueltig, die
  // vorherigen brauchen sie.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // Die Kernreise ist EIN Test mit Dutzenden Schritten. Gemessen 06.09.2026
  // (colima, M-Serie, drei Laeufe): 43 s vor EYT-158, 60–84 s mit den
  // zusaetzlichen axe-, Tastatur- und Zweitkontext-Nachweisen des
  // Baustellentag-Schritts — bei 60 s fiel der Lauf am LETZTEN Schritt
  // (ungueltige Sitzung) ins Timeout, obwohl jeder Nachweis bestanden hatte.
  // Ein Deckel ist kein Ziel: grosszuegig, weil Ubuntu-Runner nicht schneller
  // sind und ein Timeout hier stets den falschen Schritt beschuldigt.
  timeout: 180_000,
  outputDir: join(ARTEFAKTE, "artefakte"),
  reporter: [
    ["list"],
    // Maschinenlesbare Zusammenfassung (AK8): wird als CI-Artefakt abgelegt.
    ["json", { outputFile: join(ARTEFAKTE, "ergebnis.json") }],
  ],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
    // Kein automatischer Screenshot: die beiden geforderten Bilder entstehen
    // benannt im Test, damit sie auch bei einem gruenen Lauf existieren.
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node dist/main.js",
      cwd: API_WURZEL,
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        DATABASE_URL: pflicht("EASYTREE_JOURNEY_DATABASE_URL"),
        SUPABASE_URL: pflicht("EASYTREE_JOURNEY_SUPABASE_URL"),
        SUPABASE_ANON_KEY: pflicht("EASYTREE_JOURNEY_ANON_KEY"),
        API_PORT,
        LOG_LEVEL: "debug",
      },
    },
    {
      command: `pnpm exec next start -p ${WEB_PORT}`,
      cwd: WEB_WURZEL,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { EASYTREE_API_PROXY_TARGET: API_ORIGIN },
    },
  ],
});
