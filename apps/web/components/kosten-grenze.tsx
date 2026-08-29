import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorState, StateBanner } from "@easytree/ui";

import type { KostenFreigabe } from "../lib/kosten-freigabe";

/**
 * Serverseitige Verweigerungsflaechen der Kosten-Ladegrenze (EYT-113
 * Inkrement 2).
 *
 * Server-Komponente OHNE "use client": in den vier Verweigerungszustaenden
 * montieren die Kostenseiten NUR diese Flaeche — der Client-Waechter
 * `KostenZugang` und die Kosten-Client-Komponenten kommen gar nicht in den
 * Baum, laden also keinen Chunk und tragen keine Props ins HTML. Deshalb
 * auch kein `onRetry`: eine Server-Flaeche traegt keine Handler.
 *
 * Die Wortlaute folgen dem Client-Waechter `kosten-zugang.tsx`, damit die
 * Planerin server- wie clientseitig dieselbe Auskunft liest. Der Typ der
 * Props schliesst `gewaehrt` aus: den gewaehrten Zweig rendert die Seite,
 * nie diese Flaeche.
 */
export function KostenGrenze({
  freigabe,
}: {
  freigabe: Exclude<KostenFreigabe, { art: "gewaehrt" }>;
}): ReactNode {
  switch (freigabe.art) {
    case "unbekannt":
      // Nichtwissen ist nicht "abgemeldet" — dieselbe Unterscheidung wie im
      // Feld-Gate (`app/feld/layout.tsx`).
      return (
        <ErrorState
          data-testid="kosten-sitzung-unbekannt"
          title="Anmeldung nicht prüfbar"
          description="Die Anmeldung konnte serverseitig nicht geprüft werden. Bitte versuche es später erneut."
        />
      );
    case "abgemeldet":
      return (
        <StateBanner tone="info" title="Nicht angemeldet" data-testid="kosten-unauthenticated">
          Für den Kostenbereich ist eine Anmeldung erforderlich.{" "}
          <Link href="/anmelden">Zur Anmeldung</Link>
        </StateBanner>
      );
    case "keine-auswahl":
      return (
        <StateBanner tone="info" title="Organisation wählen" data-testid="kosten-org-auswahl">
          Du gehörst mehreren Organisationen an. Bitte wähle oben in der Kopfleiste eine aus — ohne
          Auswahl lädt easyTree keine Kostendaten.
        </StateBanner>
      );
    case "verboten":
      // Nennt die AUSGEWAEHLTE Organisation: die Planerin muss lesen koennen,
      // WO ihr das Recht fehlt — keine Any-Org-Aussage.
      return (
        <ErrorState
          data-testid="kosten-forbidden"
          title="Kein Zugriff auf Kosten"
          description={`Deine Rolle in „${freigabe.organisation.name}" hat das Recht costs.read nicht. Wirtschaftsdaten erscheinen nur mit gesondertem Recht.`}
        />
      );
  }
}
