import { defineConfig } from "vitest/config";

/**
 * React-Komponententests: Vitest 4 transformiert TSX mit automatischer
 * JSX-Runtime out of the box — ein zusätzliches React-Plugin ist für
 * Tests (kein HMR) nicht nötig. DOM via jsdom.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
