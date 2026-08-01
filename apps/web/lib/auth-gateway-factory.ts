import { HttpAuthGateway, API_BASE_PATH, type AuthGateway } from "@easytree/contracts";

/**
 * Die EINE Stelle, an der die Auth-URL entsteht — dieselbe Bauart und
 * Begruendung wie `planning-gateway-factory.ts`: der Test prueft GENAU die
 * Funktion, die die Kompositionswurzel ruft.
 */
export function buildAuthApiBaseUrl(apiOrigin: string): string {
  return `${apiOrigin.replace(/\/$/, "")}${API_BASE_PATH}`;
}

export function createAuthGateway(apiOrigin: string, fetchImpl: typeof fetch): AuthGateway {
  return new HttpAuthGateway(buildAuthApiBaseUrl(apiOrigin), { fetchImpl });
}
