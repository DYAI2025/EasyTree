import { defineConfig } from "vitest/config";

/**
 * Vitest 4 transformiert TSX mit automatischer JSX-Runtime out of the
 * box — für Tests (kein HMR) ist kein zusätzliches React-Plugin nötig.
 * DOM via jsdom.
 */
export default defineConfig({
  // Next.js setzt im tsconfig `jsx: "preserve"` — für die Tests muss JSX
  // aber transformiert werden (automatische React-Runtime).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
