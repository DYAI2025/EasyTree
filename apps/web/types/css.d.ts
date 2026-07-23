/**
 * Eigene CSS-Moduldeklaration, damit `pnpm typecheck` auch auf einem
 * frischen Checkout OHNE vorherigen `next build` funktioniert:
 * `next-env.d.ts` wird von Next generiert (und importiert seit Next 16
 * `.next/types/routes.d.ts`), ist deshalb gitignored und darf für den
 * Typecheck nicht vorausgesetzt werden. Mit vorhandenem next-env.d.ts
 * merged diese leere Ambient-Deklaration konfliktfrei mit Nexts
 * eigener `declare module '*.css' {}`.
 */
declare module "*.css";
