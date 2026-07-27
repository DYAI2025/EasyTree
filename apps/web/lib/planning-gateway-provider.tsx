"use client";

/**
 * Planungs-Gateway aus dem React-Kontext (EYT-50).
 *
 * Dasselbe Muster wie `api-client-provider.tsx` (ADR-001 §5): Komponenten
 * greifen nie selbst auf `fetch` oder eine URL zu, sondern bekommen den Port
 * injiziert. Die einzige Konstruktionsstelle ist `app/providers.tsx`.
 *
 * Bewusst KEIN Mock-Fallback. Es gibt keinen Zweig "wenn die API nicht
 * erreichbar ist, nimm Testdaten" — ein solcher Fallback macht aus einem
 * sichtbaren Ausfall eine plausible Anzeige, und genau das schliesst EYT-50
 * AK10 aus ("kein Mock- oder LocalStorage-State ist operative Wahrheit"). Der
 * Mock ist seit PR #21 nicht einmal mehr aus `@easytree/contracts`
 * importierbar.
 */
import type { PlanningGateway } from "@easytree/contracts";
import { createContext, useContext, type ReactNode } from "react";

const PlanningGatewayContext = createContext<PlanningGateway | null>(null);

export function PlanningGatewayProvider({
  gateway,
  children,
}: {
  gateway: PlanningGateway;
  children: ReactNode;
}) {
  return (
    <PlanningGatewayContext.Provider value={gateway}>{children}</PlanningGatewayContext.Provider>
  );
}

export function usePlanningGateway(): PlanningGateway {
  const gateway = useContext(PlanningGatewayContext);
  if (gateway === null) {
    // Lauter Fehler statt stiller Attrappe: eine Komponente ohne Provider
    // wuerde sonst irgendetwas anzeigen, nur nicht den Serverstand.
    throw new Error(
      "usePlanningGateway ausserhalb von PlanningGatewayProvider — siehe app/providers.tsx.",
    );
  }
  return gateway;
}
