/**
 * `/health` gehoert der API, nicht der Web-Shell (EYT-50).
 *
 * Der bestehende ApiClient ruft `/health` relativ zu seiner Basis-URL, und die
 * ist die Web-Origin. Ohne diese Route liefe der Health-Check ins Leere.
 */
import { durchreichen } from "../../lib/proxy-durchreichen";

export const dynamic = "force-dynamic";

export const GET = durchreichen;
export const HEAD = durchreichen;
