"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { CostsGateway } from "@easytree/contracts";

/** Kein Mock-Fallback — fehlender Provider wirft laut (Muster EYT-50 AK10). */
const CostsGatewayContext = createContext<CostsGateway | null>(null);

export function CostsGatewayProvider({
  gateway,
  children,
}: {
  gateway: CostsGateway;
  children: ReactNode;
}) {
  return <CostsGatewayContext.Provider value={gateway}>{children}</CostsGatewayContext.Provider>;
}

export function useCostsGateway(): CostsGateway {
  const gateway = useContext(CostsGatewayContext);
  if (gateway === null) {
    throw new Error(
      "useCostsGateway: kein CostsGatewayProvider gefunden. Die einzige Konstruktionsstelle ist app/providers.tsx.",
    );
  }
  return gateway;
}
