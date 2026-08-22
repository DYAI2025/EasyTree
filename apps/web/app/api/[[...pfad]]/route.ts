/**
 * Same-Origin-Durchreiche fuer alle API-Pfade (EYT-126).
 *
 * Optionaler Catch-all (`[[...pfad]]`), damit auch `/api` selbst getroffen wird
 * und nicht als 404 aus der Web-App zurueckkommt.
 */
import { durchreichen } from "../../../lib/proxy-durchreichen";

export const dynamic = "force-dynamic";

export const GET = durchreichen;
export const POST = durchreichen;
export const PUT = durchreichen;
export const PATCH = durchreichen;
export const DELETE = durchreichen;
export const OPTIONS = durchreichen;
export const HEAD = durchreichen;
