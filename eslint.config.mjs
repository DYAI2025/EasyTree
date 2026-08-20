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
  {
    // Cloudflare-Worker-Entrypoints (EYT-142). Sie laufen in der
    // Workers-Laufzeit, nicht in Node: `Response`, `Request` und `fetch` sind
    // dort globale Standardobjekte. Ohne diese Deklaration meldet `no-undef`
    // sie als undefiniert — ein Fehler ueber die falsche Laufzeit, nicht ueber
    // den Code.
    files: ["**/cloudflare/*.mjs"],
    languageOptions: {
      globals: {
        Response: "readonly",
        Request: "readonly",
        fetch: "readonly",
        URL: "readonly",
        console: "readonly",
      },
    },
  },
);
