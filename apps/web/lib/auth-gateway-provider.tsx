"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AuthGateway } from "@easytree/contracts";

/**
 * Kontext ohne Mock-Fallback — dieselbe Entscheidung wie beim
 * PlanningGateway (EYT-50 AK10): fehlt der Provider, wirft der Hook laut.
 */
const AuthGatewayContext = createContext<AuthGateway | null>(null);

export function AuthGatewayProvider({
  gateway,
  children,
}: {
  gateway: AuthGateway;
  children: ReactNode;
}) {
  return <AuthGatewayContext.Provider value={gateway}>{children}</AuthGatewayContext.Provider>;
}

export function useAuthGateway(): AuthGateway {
  const gateway = useContext(AuthGatewayContext);
  if (gateway === null) {
    throw new Error(
      "useAuthGateway: kein AuthGatewayProvider gefunden. Die einzige Konstruktionsstelle ist app/providers.tsx.",
    );
  }
  return gateway;
}
