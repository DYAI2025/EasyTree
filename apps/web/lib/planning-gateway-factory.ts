import { API_BASE_PATH, HttpPlanningGateway, type PlanningGateway } from "@easytree/contracts";

/**
 * Die EINE Stelle, an der die Planungs-URL entsteht (EYT-50).
 *
 * Warum eine eigene Funktion und nicht ein Ausdruck in `providers.tsx`: ein
 * Test, der sich sein Gateway selbst zusammenbaut, prueft seine eigene
 * Konstruktion — nicht die des Produktionscodes. Genau das war der erste
 * Entwurf von `test/api-base-path.test.ts`, und er waere gruen geblieben, wenn
 * `providers.tsx` etwas voellig anderes gebaut haette.
 *
 * Jetzt ruft die Kompositionswurzel diese Funktion, und der Test ruft
 * dieselbe.
 */
export function buildPlanningApiBaseUrl(apiOrigin: string): string {
  return `${apiOrigin.replace(/\/+$/, "")}${API_BASE_PATH}`;
}

export function createPlanningGateway(
  apiOrigin: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
): PlanningGateway {
  return new HttpPlanningGateway({
    baseUrl: buildPlanningApiBaseUrl(apiOrigin),
    fetchImpl,
  });
}
