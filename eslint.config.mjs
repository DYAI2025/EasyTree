// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `dist-harness` ist das Buildziel des Read-Through-Nachweises (EYT-50).
    // Ohne diesen Eintrag lintet ESLint kompiliertes JavaScript und meldet
    // Fehler in Code, den niemand geschrieben hat.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-harness/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      // Cloudflare-Buildartefakte (EYT-142). `.open-next/` enthaelt den
      // gebuendelten Next-Server; ihn zu linten meldete 21145 Fehler aus
      // fremdem, generiertem Code und machte `pnpm lint` unbrauchbar.
      "**/.open-next/**",
      "**/.wrangler/**",
      "**/.wrangler-dry/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
