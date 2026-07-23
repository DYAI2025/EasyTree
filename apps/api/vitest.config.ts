import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * NestJS relies on legacy decorators + `design:paramtypes` metadata.
 * Vitest's default esbuild transform cannot emit decorator metadata, so
 * TypeScript is transformed with SWC instead (same semantics as the tsc
 * build in tsconfig.build.json: legacyDecorator + decoratorMetadata).
 */
export default defineConfig({
  // Disable Vitest's default Oxc transform — SWC below is authoritative.
  oxc: false,
  plugins: [
    swc.vite({
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: "es6" },
    }),
  ],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
