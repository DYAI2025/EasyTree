"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorState, StateBanner } from "@easytree/ui";

import { useSession } from "../lib/session-provider";

/**
 * Zugangswaechter des Kostenbereichs (EYT-106): rendert die verbindlichen
 * Zustaende Loading / Unauthenticated / Forbidden / Organisationswahl,
 * und erst wenn die reale Session `costs.read` traegt, den Inhalt.
 *
 * Sichtbarkeit ersetzt keine Autorisierung — dieselbe Pruefung laeuft
 * serverseitig fuer jeden API-Aufruf.
 */
export function KostenZugang({ children }: { children: ReactNode }) {
  const { sitzung, organisation, hatRecht, neuLaden } = useSession();

  if (sitzung.zustand === "laedt") {
    return (
      <p role="status" data-testid="kosten-laedt">
        Sitzung wird geprüft …
      </p>
    );
  }

  if (sitzung.zustand === "fehler") {
    return (
      <ErrorState
        title="Sitzung konnte nicht geprüft werden"
        description="Der Server war nicht erreichbar. Der Anmeldezustand ist unbekannt — kein Zugriff, bis er geklärt ist."
        onRetry={neuLaden}
      />
    );
  }

  if (sitzung.zustand === "abgemeldet") {
    return (
      <StateBanner tone="info" title="Nicht angemeldet" data-testid="kosten-unauthenticated">
        Für den Kostenbereich ist eine Anmeldung erforderlich.{" "}
        <Link href="/anmelden">Zur Anmeldung</Link>
      </StateBanner>
    );
  }

  if (organisation === null) {
    return (
      <StateBanner tone="info" title="Organisation wählen">
        Du gehörst mehreren Organisationen an. Bitte wähle oben in der Kopfleiste eine aus — ohne
        Auswahl zeigt easyTree keine Kostendaten.
      </StateBanner>
    );
  }

  if (!hatRecht("costs.read")) {
    return (
      <ErrorState
        data-testid="kosten-forbidden"
        title="Kein Zugriff auf Kosten"
        description={`Deine Rolle in „${organisation.name}" hat das Recht costs.read nicht. Wirtschaftsdaten erscheinen nur mit gesondertem Recht.`}
      />
    );
  }

  return <>{children}</>;
}
