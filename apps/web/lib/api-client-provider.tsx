"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ApiClient } from "./api-client";

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  client: ApiClient;
  children?: ReactNode;
}

/** Stellt den (einzigen) ApiClient für den Komponentenbaum bereit. */
export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

/**
 * Liefert den injizierten ApiClient. Komponenten konstruieren NIE selbst
 * einen Client (ADR-001 §5) — fehlt der Provider, ist das ein
 * Verdrahtungsfehler und schlägt hier laut und verständlich fehl.
 */
export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (client === null) {
    throw new Error(
      "useApiClient: Kein ApiClient im React-Kontext. Komponenten dürfen nie selbst einen " +
        "Client konstruieren — diese Komponente muss unterhalb eines <ApiClientProvider> " +
        "gerendert werden (Kompositionswurzel: app/providers.tsx).",
    );
  }
  return client;
}
