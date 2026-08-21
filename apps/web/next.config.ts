import path from "node:path";

import type { NextConfig } from "next";

import { resolveNextOutput } from "./lib/next-output";

/**
 * easyTree Web-/PWA-Shell (EYT-41, Same-Origin seit EYT-50).
 *
 * Bewusst minimal: keine Google-Font-Imports (Build muss offline
 * funktionieren, System-Font-Stack in globals.css) und KEIN Service
 * Worker / keine Offline-Schreibqueue (ADR-001 §1).
 *
 * ## Same-Origin statt CORS
 *
 * Der Browser bleibt auf der Origin der Web-App und ruft relative Pfade. Die
 * Weiterleitung an die API passiert NICHT hier: `rewrites()` wird beim Bauen
 * aufgeloest und in `.next/routes-manifest.json` geschrieben, womit ein
 * fertiges Image an sein Ziel gebunden waere. Zustaendig sind stattdessen die
 * Route Handler unter `app/api/[[...pfad]]`, `app/health` und `app/ready`; sie
 * lesen das Ziel bei jeder Anfrage neu (EYT-126).
 *
 * `/health` und `/ready` sind mit dabei und nicht vergessen: der bestehende
 * ApiClient ruft `/health` relativ zu seiner Basis-URL, und die ist die
 * Web-Origin. Eine Durchreiche nur fuer `/api/*` liesse den Health-Check ins
 * Leere laufen.
 */
const nextConfig: NextConfig = {
  /**
   * Die Ablaufverfolgung fuer `output: "standalone"` braucht die
   * Workspace-Wurzel, nicht `apps/web`. Ohne diese Angabe raet Next sie aus
   * den gefundenen Lockfiles ("Detected additional lockfiles") — und ein
   * Raten entscheidet darueber, ob die Workspace-Pakete im Standalone-Bundle
   * landen.
   */
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  ...resolveNextOutput(process.env),
};

export default nextConfig;
