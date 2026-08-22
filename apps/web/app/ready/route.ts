/**
 * `/ready` gehoert der API, nicht der Web-Shell (EYT-50).
 */
import { durchreichen } from "../../lib/proxy-durchreichen";

export const dynamic = "force-dynamic";

export const GET = durchreichen;
export const HEAD = durchreichen;
