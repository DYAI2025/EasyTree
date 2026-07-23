/**
 * ApiClient der easyTree-Shell (EYT-41, ADR-001 §5).
 *
 * Komponenten greifen NIE direkt auf `fetch`, Supabase oder eine URL zu —
 * der API-Zugriff läuft ausschließlich über diesen Client, der per
 * React-Context injiziert wird (siehe api-client-provider.tsx). Die
 * fetch-Implementierung ist ihrerseits injizierbar, damit Tests ohne
 * Netzwerk auskommen.
 */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HealthStatus {
  status: string;
}

export interface ApiClient {
  /** Basis-URL der easyTree-API (ohne abschließenden Slash). */
  readonly baseUrl: string;
  /** Liveness der API: `GET /health`. */
  getHealth(): Promise<HealthStatus>;
}

export function createApiClient(baseUrl: string, fetchImpl: FetchLike = fetch): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function getJson<T>(path: string): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`easyTree-API ${path} antwortete mit HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  return {
    baseUrl: base,
    getHealth: () => getJson<HealthStatus>("/health"),
  };
}
