"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorState, StateBanner } from "@easytree/ui";

import { useSession } from "../lib/session-provider";

/**
 * Zugangswaechter der Planung (EYT-107) — dieselbe Bauart wie `KostenZugang`.
 *
 * ## Warum es ihn erst jetzt gibt
 *
 * Bis EYT-107 war `/planung` ungeschuetzt: die Seite rief das Gateway
 * unmittelbar, waehrend die API jede Planungsanfrage mit 401 (kein Subjekt)
 * oder 403 (deny-all) beantwortete. Die Planerin sah einen Fehlerzustand ohne
 * Erklaerung, und die Navigation zeigte den Punkt trotzdem jedem an.
 *
 * Basisdesign v2.0 §3.1: „Die Navigation wird serverseitig nach atomaren
 * Rechten gefiltert. Ein sichtbarer Navigationspunkt ersetzt keine
 * Autorisierung." Beides gilt — hier wird gefiltert, in `PlanningController`
 * entschieden, und `app.has_permission` entscheidet noch einmal unabhaengig.
 *
 * ## Was er rendert
 *
 * Die verbindlichen Zustaende aus Basisdesign v2.0 §4: Loading,
 * Unauthenticated, Fehler (= Nichtwissen, nicht „abgemeldet"),
 * Organisationswahl, Forbidden. Erst danach den Inhalt.
 *
 * `darfVeroeffentlichen` wird als Kindfunktion durchgereicht statt per
 * Kontext gelesen: `PlanningWindowView` soll ohne Sitzungsinfrastruktur
 * pruefbar bleiben, und ein zweiter `useSession`-Aufruf tiefer im Baum waere
 * eine zweite Stelle, an der dieselbe Frage anders beantwortet werden koennte.
 */
export function PlanungZugang({
  children,
}: {
  children: (rechte: { darfVeroeffentlichen: boolean }) => ReactNode;
}) {
  const { sitzung, organisation, hatRecht, neuLaden } = useSession();

  if (sitzung.zustand === "laedt") {
    return (
      <p role="status" data-testid="planung-laedt">
        Sitzung wird geprüft …
      </p>
    );
  }

  if (sitzung.zustand === "fehler") {
    return (
      <ErrorState
        data-testid="planung-sitzung-unbekannt"
        title="Sitzung konnte nicht geprüft werden"
        description="Der Server war nicht erreichbar. Der Anmeldezustand ist unbekannt — kein Zugriff, bis er geklärt ist."
        onRetry={neuLaden}
      />
    );
  }

  if (sitzung.zustand === "abgemeldet") {
    return (
      <StateBanner tone="info" title="Nicht angemeldet" data-testid="planung-unauthenticated">
        Für die Planung ist eine Anmeldung erforderlich. <Link href="/anmelden">Zur Anmeldung</Link>
      </StateBanner>
    );
  }

  if (organisation === null) {
    return (
      <StateBanner tone="info" title="Organisation wählen" data-testid="planung-org-wahl">
        Du gehörst mehreren Organisationen an. Bitte wähle oben in der Kopfleiste eine aus — ohne
        Auswahl zeigt easyTree keinen Wochenplan.
      </StateBanner>
    );
  }

  if (!hatRecht("planning.read")) {
    return (
      <ErrorState
        data-testid="planung-forbidden"
        title="Kein Zugriff auf die Planung"
        description={`Deine Rolle in „${organisation.name}" hat das Recht planning.read nicht.`}
      />
    );
  }

  return <>{children({ darfVeroeffentlichen: hatRecht("planning.publish") })}</>;
}
