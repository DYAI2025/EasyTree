import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { pruefeDeployAutoritaet, SCHEMA_WERKZEUGE } from "./architecture/deploy-authority-rules";

/**
 * EYT-142 — Cloudflare deployt Web und API, NIEMALS das Schema.
 *
 * Eigentuemerin des Migrationspfads bleibt die Supabase-GitHub-Integration.
 * Zwei Stellen, die dasselbe Schema aendern duerfen, sind kein Redundanzgewinn,
 * sondern ein Rennen ohne Schiedsrichter.
 *
 * Der Rot-Fall unten ist kein Beiwerk: ohne ihn waere dieser Test gruen, auch
 * wenn die Regel gar nichts prueft.
 */
const REPO = resolve(__dirname, "../../..");
const WRANGLER_DATEIEN = [
  join(REPO, "apps/api/wrangler.jsonc"),
  join(REPO, "apps/web/wrangler.jsonc"),
];

describe("keine zweite Migrationsautoritaet (EYT-142)", () => {
  it("liest ueberhaupt Konfigurationen — sonst prueft dieser Test nichts", () => {
    expect(WRANGLER_DATEIEN.length).toBeGreaterThan(1);
    expect(() => pruefeDeployAutoritaet(WRANGLER_DATEIEN)).not.toThrow();
  });

  it("kein Cloudflare-Build ruft ein Schemawerkzeug auf", () => {
    expect(pruefeDeployAutoritaet(WRANGLER_DATEIEN)).toEqual([]);
  });

  it("ist fail-closed: ohne Konfiguration wird die Regel rot", () => {
    expect(() => pruefeDeployAutoritaet([])).toThrow(/fail-closed/);
  });

  describe("Rot-Fall — die Regel feuert wirklich", () => {
    for (const werkzeug of SCHEMA_WERKZEUGE) {
      it(`meldet "${werkzeug}" im build.command`, () => {
        const verzeichnis = mkdtempSync(join(tmpdir(), "eyt142-deploy-"));
        const datei = join(verzeichnis, "wrangler.jsonc");
        try {
          writeFileSync(
            datei,
            `{
  // Wegwerf-Fixture, niemals im Repo
  "name": "boese",
  "build": { "command": "pnpm build && ${werkzeug} --db-url $DATABASE_URL" }
}
`,
          );
          const funde = pruefeDeployAutoritaet([datei]);
          expect(funde).toHaveLength(1);
          expect(funde[0]?.werkzeug).toBe(werkzeug);
          expect(funde[0]?.feld).toBe("build.command");
        } finally {
          rmSync(verzeichnis, { recursive: true, force: true });
        }
      });
    }
  });

  it("laesst harmlose Buildbefehle durch", () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), "eyt142-deploy-ok-"));
    const datei = join(verzeichnis, "wrangler.jsonc");
    try {
      writeFileSync(
        datei,
        `{
  "name": "brav",
  "build": { "command": "pnpm --filter @easytree/api... build" }
}
`,
      );
      expect(pruefeDeployAutoritaet([datei])).toEqual([]);
    } finally {
      rmSync(verzeichnis, { recursive: true, force: true });
    }
  });
});
