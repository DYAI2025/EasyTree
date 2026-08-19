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
 *
 * Seit EYT-140 M6 gilt dasselbe fuer `darfKostenLesen` (`REQ-006`): der
 * Kostenuebergang der Planungsflaeche haengt an `costs.read`, und die Antwort
 * kommt aus DIESEM Waechter — aus derselben Sitzung, die auch `planning.read`
 * beantwortet hat. Ein eigener Waechter im Uebergang waere eine zweite
 * Autorisierungslogik; ausgerechnet an der Kostengrenze ist das die teuerste
 * Stelle fuer zwei Antworten. Gefiltert wird hier, entschieden in
 * `cost-access.policy.ts`.
 */
export function PlanungZugang({
  children,
}: {
  children: (rechte: { darfVeroeffentlichen: boolean; darfKostenLesen: boolean }) => ReactNode;
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

  // Keine EINDEUTIGE aktive Organisation. Das deckt zwei Lagen ab, und der
  // Text muss fuer beide stimmen:
  //
  //   * gar keine aktive Mitgliedschaft (ein angemeldeter Benutzer ohne
  //     Zugehoerigkeit — der Fall von Reisendem B);
  //   * mehrere, ohne getroffene Auswahl.
  //
  // Eine fruehere Fassung sagte hier „Du gehörst mehreren Organisationen an".
  // Fuer B war das schlicht FALSCH — er gehoert keiner an — und die
  // Browserreise hat es aufgedeckt (auth-journey, 03.08.2026): sie erwartete
  // `Forbidden` und fand diesen Banner.
  //
  // Zusammengefasst statt aufgeteilt, weil die Unterscheidung ein
  // Existenzleck waere: „du gehoerst keiner an" gegenueber „waehle aus"
  // verraet einem Fremden, ob er irgendwo Mitglied ist. Derselbe Grund, aus
  // dem die API `ORG_NOT_A_MEMBER` und `PERMISSION_MISSING` gleich
  // beantwortet.
  //
  // Serverseitig entspricht dem `ORG_CONTEXT_REQUIRED`; die Publish-Route
  // beantwortet das mit 403, und daran aendert dieser Zweig nichts — er
  // ersetzt keine Autorisierung, er erklaert sie nur.
  if (organisation === null) {
    return (
      <StateBanner
        tone="info"
        title="Keine eindeutige Organisation"
        data-testid="planung-org-erforderlich"
      >
        Die Planung braucht eine aktive Mitgliedschaft in genau einer Organisation. Gehörst du
        mehreren an, wähle oben in der Kopfleiste eine aus.
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

  return (
    <>
      {children({
        darfVeroeffentlichen: hatRecht("planning.publish"),
        darfKostenLesen: hatRecht("costs.read"),
      })}
    </>
  );
}
