"use client";

import { API_BASE_PATH, HttpPlanningGateway } from "@easytree/contracts";
import { useMemo, type ReactNode } from "react";

import { createApiClient } from "../lib/api-client";
import { ApiClientProvider } from "../lib/api-client-provider";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Kompositionswurzel der Web-Shell: die EINZIGE Stelle, an der ein
 * ApiClient oder ein Gateway konstruiert wird. Alle Komponenten erhalten sie
 * per Hook aus dem Kontext (ADR-001 §5).
 *
 * Der Vertragspfad wird IMPORTIERT, nicht wiederholt. `API_BASE_PATH` ist
 * dieselbe Konstante, aus der `servers[0].url` des OpenAPI-Dokuments entsteht
 * (`packages/contracts/src/openapi/document.ts`). Eine zweite, frei gepflegte
 * Zeichenkette war genau die Falle, aus der `/api/v1` serverseitig ueberhaupt
 * nicht existierte, ohne dass etwas rot wurde.
 *
 * Hier stand zuvor eine lokale Kopie samt Kommentar, der auf einen Test
 * verwies, den es nicht gab. `apps/web/test/api-base-path.test.ts` existiert
 * jetzt wirklich und prueft, dass die Gateway-URL den exportierten Pfad
 * verwendet.
 */

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => createApiClient(API_BASE_URL), []);
  const planning = useMemo(
    () =>
      new HttpPlanningGateway({
        baseUrl: `${API_BASE_URL.replace(/\/+$/, "")}${API_BASE_PATH}`,
        fetchImpl: (input, init) => fetch(input, init),
      }),
    [],
  );

  return (
    <ApiClientProvider client={client}>
      <PlanningGatewayProvider gateway={planning}>{children}</PlanningGatewayProvider>
    </ApiClientProvider>
  );
}
