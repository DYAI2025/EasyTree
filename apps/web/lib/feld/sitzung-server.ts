import { API_BASE_PATH, SessionDtoSchema, type SessionDto } from "@easytree/contracts";

import { aktuellesProxyziel } from "../proxy-durchreichen";

/**
 * Serverseitige Sitzungslesung (EYT-113).
 *
 * Server Components (Feld-Gate, Start-Dispatch) fragen die echte API nach der
 * Session — mit den Cookies der eingehenden Anfrage, gegen dasselbe
 * Laufzeit-Proxyziel, das auch `lib/proxy-durchreichen.ts` benutzt. Die
 * Umgebung wird hier bewusst NICHT gelesen: `aktuellesProxyziel()` ist die
 * eine erlaubte Lesestelle (secret-surface-Waechter, EYT-126).
 *
 * Drei Zustaende, fail-closed:
 *   angemeldet — 200 und der Body besteht das strikte SessionDto-Schema
 *   abgemeldet — die API antwortet 401 (verifiziertes Nichtangemeldetsein)
 *   unbekannt  — alles andere. Nichtwissen ist NICHT abgemeldet: ein
 *                API-Ausfall darf angemeldete Nutzer nicht zur Anmeldung
 *                umleiten, er zeigt eine ehrliche Fehlerflaeche.
 */
export type ServerSitzung =
  | { zustand: "angemeldet"; session: SessionDto }
  | { zustand: "abgemeldet" }
  | { zustand: "unbekannt" };

export async function leseServerSitzung(
  cookieHeader: string | null,
  fetchImpl: typeof fetch = fetch,
  zielLeser: () => string = aktuellesProxyziel,
): Promise<ServerSitzung> {
  let ziel: string;
  try {
    ziel = zielLeser();
  } catch {
    return { zustand: "unbekannt" };
  }

  const headers = new Headers({ accept: "application/json" });
  if (cookieHeader !== null && cookieHeader !== "") {
    headers.set("cookie", cookieHeader);
  }

  let antwort: Response;
  try {
    antwort = await fetchImpl(`${ziel}${API_BASE_PATH}/auth/session`, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return { zustand: "unbekannt" };
  }

  if (antwort.status === 401) {
    return { zustand: "abgemeldet" };
  }
  if (antwort.status !== 200) {
    return { zustand: "unbekannt" };
  }

  let body: unknown;
  try {
    body = await antwort.json();
  } catch {
    return { zustand: "unbekannt" };
  }

  const geparst = SessionDtoSchema.safeParse(body);
  if (!geparst.success) {
    return { zustand: "unbekannt" };
  }
  return { zustand: "angemeldet", session: geparst.data };
}
