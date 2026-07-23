import type { NextConfig } from "next";

/**
 * easyTree Web-/PWA-Shell (EYT-41).
 *
 * Bewusst minimal: keine Google-Font-Imports (Build muss offline
 * funktionieren, System-Font-Stack in globals.css) und KEIN Service
 * Worker / keine Offline-Schreibqueue (ADR-001 §1).
 */
const nextConfig: NextConfig = {};

export default nextConfig;
