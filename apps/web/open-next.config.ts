import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext-Adapter fuer Cloudflare Workers (EYT-142).
 *
 * Bewusst minimal: Default-Cache, keine zusaetzliche Inkrementalcache- oder
 * Queue-Verdrahtung. Die Datengrenze der Anwendung liegt hinter dem
 * Same-Origin-Rewrite aus `next.config.ts` in der NestJS-API — der Web-Worker
 * haelt selbst keinen Zustand und braucht deshalb keinen.
 */
export default defineCloudflareConfig();
