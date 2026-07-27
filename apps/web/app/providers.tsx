"use client";

import { useMemo, type ReactNode } from "react";

import { createApiClient } from "../lib/api-client";
import { ApiClientProvider } from "../lib/api-client-provider";
import { createPlanningGateway } from "../lib/planning-gateway-factory";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";

/**
 * Leere Origin: der Browser ruft RELATIV. Die Weiterleitung an die API macht
 * das Rewrite in `next.config.ts`, serverseitig konfiguriert.
 *
 * `NEXT_PUBLIC_API_URL` ist hier bewusst weg. Ein `NEXT_PUBLIC_*`-Wert wird
 * ins Browserbuendel eingebacken und beim Build festgeschrieben — und er
 * zwaenge die API, fuer eine fremde Origin zu oeffnen.
 */
const SAME_ORIGIN = "";

/**
 * Kompositionswurzel der Web-Shell: die EINZIGE Stelle, an der ein
 * ApiClient oder ein Gateway konstruiert wird. Alle Komponenten erhalten sie
 * per Hook aus dem Kontext (ADR-001 §5).
 *
 * Der Vertragspfad wird nicht hier zusammengesetzt: `createPlanningGateway`
 * (../lib/planning-gateway-factory) ist die einzige Stelle, an der die URL
 * entsteht, und `test/api-base-path.test.ts` prueft GENAU diese Funktion.
 *
 * Hier stand zuvor eine lokale Kopie "/api/v1" samt Kommentar, der auf einen
 * Test verwies, den es nicht gab.
 */

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => createApiClient(SAME_ORIGIN), []);
  const planning = useMemo(
    () => createPlanningGateway(SAME_ORIGIN, (input, init) => fetch(input, init)),
    [],
  );

  return (
    <ApiClientProvider client={client}>
      <PlanningGatewayProvider gateway={planning}>{children}</PlanningGatewayProvider>
    </ApiClientProvider>
  );
}
