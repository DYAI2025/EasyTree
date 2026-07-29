import type { NextConfig } from "next";

import { normalizeProxyTarget } from "./lib/api-proxy-target";

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
  async rewrites() {
    const target = normalizeProxyTarget(process.env.EASYTREE_API_PROXY_TARGET);
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/health", destination: `${target}/health` },
      { source: "/ready", destination: `${target}/ready` },
    ];
  },
};

export default nextConfig;
