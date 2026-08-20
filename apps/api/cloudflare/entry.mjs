/**
 * Cloudflare-Worker-Entrypoint der API (EYT-142).
 *
 * ## Warum diese Datei von Hand geschrieben ist und nicht von tsc kommt
 *
 * Drei gemessene Zwaenge lassen zusammen nur diese Loesung uebrig:
 *   1. Nest braucht `emitDecoratorMetadata`; esbuild (und damit Wranglers
 *      Bundler) kann das nicht. Der Nest-Code muss also von tsc kommen —
 *      aus `apps/api/dist/`.
 *   2. `apps/api` emittiert CommonJS (kein `"type": "module"`).
 *   3. Wrangler verlangt einen ESM-Entry mit `export default`.
 * Ein winziger ESM-Shim ueber das kompilierte CJS ist die einzige Bruecke.
 *
 * ## Warum die Verdrahtung im Modulscope liegen darf
 *
 * Spike A3 hat gemessen, dass sich der komplette Providersatz aus `AppModule`
 * im Modulscope KONSTRUIEREN laesst — Pool, PgDatabasePing, die beiden
 * Supabase-Fabriken und GotruePasswordLogin — ohne "Disallowed operation
 * called within global scope". Spike A2 hat gemessen, dass eine NestJS-11-App
 * unter `nodejs_compat` per `httpServerHandler` startet und antwortet.
 *
 * ## Warum trotzdem kein Pool ueber Requests hinweg
 *
 * Spike A4 hat gemessen, dass ein in Request 1 erzeugter Socket in Request 2
 * unbenutzbar ist ("Cannot perform I/O on behalf of a different request").
 * Die Verbindungsherkunft liegt deshalb in `request-scoped-pool.ts` und
 * oeffnet je `run()` frisch. Siehe dort.
 *
 * ## Warum das Rollengate hier und nicht im Bootstrap sitzt
 *
 * Auf Node prueft `createApiApp` die Rolle einmal beim Start und verhindert
 * ihn. Diesen Start gibt es hier nicht. Der Latch (getestet in
 * `role-gate-latch.ts`) prueft deshalb beim ersten Request und merkt sich das
 * Ergebnis als einfachen Wert — fail-closed. Kein Request erreicht Nest,
 * bevor das Gate bestanden ist (N4).
 *
 * Diese Datei enthaelt ausschliesslich Verdrahtung. Jede Entscheidung liegt
 * getestet in `src/`.
 */
import { httpServerHandler } from "cloudflare:node";

import mainCjs from "../dist/main.js";
import latchCjs from "../dist/platform/runtime/role-gate-latch.js";
import rolesCjs from "../dist/platform/database/role-privileges.js";
import configCjs from "../dist/config/config.module.js";

const { wireApiApp } = mainCjs;
const { createRoleGateLatch } = latchCjs;
const { createRolePrivilegeReader } = rolesCjs;
const { APP_CONFIG } = configCjs;

/** Prozessintern; nach aussen sichtbar ist nur der Worker-Port von Cloudflare. */
const PORT = 8080;

const app = await wireApiApp();
await app.listen(PORT);

const config = app.get(APP_CONFIG);
const latch = createRoleGateLatch(
  createRolePrivilegeReader({
    databaseUrl: config.databaseUrl,
    sslRootCert: config.databaseSslRootCert,
  }),
);

const nest = httpServerHandler({ port: PORT });

export default {
  async fetch(request, env, ctx) {
    const gate = await latch.sicherstellen();
    if (!gate.ok) {
      // Fail-closed und ohne Details: der Grund nennt Rollennamen und
      // Verbindungsfehler, beides gehoert nicht in eine HTTP-Antwort.
      return new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "Die Datenbankrolle konnte nicht als RLS-gebunden bestaetigt werden.",
        }),
        { status: 503, headers: { "content-type": "application/problem+json" } },
      );
    }
    return nest.fetch(request, env, ctx);
  },
};
