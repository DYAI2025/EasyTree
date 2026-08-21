import path from "node:path";

import type { NextConfig } from "next";

import { resolveBuildProxyTarget } from "./lib/api-proxy-target";
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
 * Der Browser bleibt auf der Origin der Web-App und ruft relative Pfade. Next
 * leitet sie serverseitig an die API weiter. Die Alternative waere gewesen,
 * die API fuer eine fremde Origin zu oeffnen — also zusaetzliche oeffentliche
 * Oberflaeche fuer ein Problem, das ein Proxy loest.
 *
 * `/health` und `/ready` sind mit dabei und nicht vergessen: der bestehende
 * ApiClient ruft `/health` relativ zu seiner Basis-URL, und die ist ab jetzt
 * die Web-Origin. Ein Rewrite nur fuer `/api/:path*` liesse den Health-Check
 * ins Leere laufen.
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
  async rewrites() {
    const target = resolveBuildProxyTarget(process.env);
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/health", destination: `${target}/health` },
      { source: "/ready", destination: `${target}/ready` },
    ];
  },
};

export default nextConfig;
