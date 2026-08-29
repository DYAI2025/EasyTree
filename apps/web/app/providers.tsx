"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { createApiClient } from "../lib/api-client";
import { ApiClientProvider } from "../lib/api-client-provider";
import { AuthGatewayProvider } from "../lib/auth-gateway-provider";
import { createAuthGateway } from "../lib/auth-gateway-factory";
import { CostsGatewayProvider } from "../lib/costs-gateway-provider";
import { createCostsGateway } from "../lib/costs-gateway-factory";
import { liesOrgAuswahlAusDokument, schreibeOrgAuswahl } from "../lib/organisations-auswahl-cookie";
import { createPlanningGateway } from "../lib/planning-gateway-factory";
import { PlanningGatewayProvider } from "../lib/planning-gateway-provider";
import { SessionProvider } from "../lib/session-provider";

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
 * Die Organisationsauswahl fliesst ueber eine Ref in das CostsGateway: der
 * Header waehlt nur aus, autorisiert nichts — und die Gateways bleiben
 * stabil (kein Neubau bei jedem Orgwechsel).
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const client = useMemo(() => createApiClient(SAME_ORIGIN), []);
  const planning = useMemo(
    () => createPlanningGateway(SAME_ORIGIN, (input, init) => fetch(input, init)),
    [],
  );
  const auth = useMemo(
    () => createAuthGateway(SAME_ORIGIN, (input, init) => fetch(input, init)),
    [],
  );

  const organisationRef = useRef<string | null>(null);
  const costs = useMemo(
    () =>
      createCostsGateway(
        SAME_ORIGIN,
        (input, init) => fetch(input, init),
        () => organisationRef.current,
      ),
    [],
  );

  const setOrganisation = useCallback(
    (id: string | null) => {
      organisationRef.current = id;
      // Cookie = Selector fuer das Server-Gate (EYT-113 Inkrement 2); der
      // refresh laesst die Server-Flaechen der Auswahl folgen. Der
      // Gleichheits-Guard verhindert Refresh-Schleifen und den Extra-RSC-Lauf
      // beim unveraenderten Reload.
      if (liesOrgAuswahlAusDokument() !== id) {
        schreibeOrgAuswahl(id);
        router.refresh();
      }
    },
    [router],
  );

  // Der Initialwert laeuft nur clientseitig (useState-Initializer); beim SSR
  // liefert er null — folgenlos, solange die Sitzung ohnehin "laedt" rendert.
  const [initialeOrganisationId] = useState(liesOrgAuswahlAusDokument);

  return (
    <ApiClientProvider client={client}>
      <PlanningGatewayProvider gateway={planning}>
        <AuthGatewayProvider gateway={auth}>
          <CostsGatewayProvider gateway={costs}>
            <SessionProvider
              onOrganisationChange={setOrganisation}
              initialeOrganisationId={initialeOrganisationId}
            >
              {children}
            </SessionProvider>
          </CostsGatewayProvider>
        </AuthGatewayProvider>
      </PlanningGatewayProvider>
    </ApiClientProvider>
  );
}
