import type { MetadataRoute } from "next";

/**
 * PWA-Manifest der easyTree-Shell (EYT-41), ausgeliefert unter
 * /manifest.webmanifest.
 *
 * AUSDRÜCKLICH AUSGESCHLOSSEN (ADR-001 §1): Es gibt KEINEN Service
 * Worker und KEINE Offline-Schreib-/Sync-Queue. Die App ist
 * installierbar (display: standalone), arbeitet aber ausschließlich
 * online gegen die easyTree-API — Offline-Schreibvorgänge werden weder
 * gepuffert noch nachträglich synchronisiert.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "easyTree",
    short_name: "easyTree",
    description: "easyTree — mandantenfähige Web-App (PWA-Shell, Sprint 1)",
    lang: "de",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#166534",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
