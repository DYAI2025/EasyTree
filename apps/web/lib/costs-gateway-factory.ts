import { HttpCostsGateway, API_BASE_PATH, type CostsGateway } from "@easytree/contracts";

/** Die EINE Stelle, an der die Kosten-URL entsteht (Muster: planning-gateway-factory). */
export function buildCostsApiBaseUrl(apiOrigin: string): string {
  return `${apiOrigin.replace(/\/$/, "")}${API_BASE_PATH}`;
}

export function createCostsGateway(
  apiOrigin: string,
  fetchImpl: typeof fetch,
  organisationId: () => string | null,
): CostsGateway {
  return new HttpCostsGateway(buildCostsApiBaseUrl(apiOrigin), { fetchImpl, organisationId });
}
