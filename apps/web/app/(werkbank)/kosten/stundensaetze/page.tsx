import type { Metadata } from "next";

import { PageHeader } from "@easytree/ui";

import { KostenGrenze } from "../../../../components/kosten-grenze";
import { KostenZugang } from "../../../../components/kosten-zugang";
import { RateManagement } from "../../../../components/rate-management";
import { leseKostenFreigabe } from "../../../../lib/kosten-freigabe";

export const metadata: Metadata = { title: "Stundensätze — easyTree" };

/**
 * `/kosten/stundensaetze` — Satzverwaltung (EYT-108, Basisdesign §5 Punkt 3).
 * Fragment ohne eigenes `<main>`; Zugang über denselben Wächter wie /kosten.
 *
 * Seit EYT-113 Inkrement 2 steht davor die serverseitige Ladegrenze:
 * `leseKostenFreigabe()` prueft das `costs.read` der AUSGEWAEHLTEN
 * Organisation, fail-closed — jeder Verweigerungszustand rendert
 * `KostenGrenze`, `RateManagement` wird dann gar nicht montiert. Die
 * `headers()`/`cookies()`-Lesezugriffe in `leseKostenFreigabe` machen die
 * Route dynamisch; das ist gewollt (EYT-126: nichts davon darf zur Bauzeit
 * festgeschrieben werden).
 */
export default async function StundensaetzePage() {
  const freigabe = await leseKostenFreigabe();

  return (
    <>
      <PageHeader
        title="Stundensätze"
        description="Interne Netto-Stundensätze je Mitarbeiter — unveränderliche Versionen mit Gültigkeit, nie überschrieben."
      />
      {freigabe.art !== "gewaehrt" ? (
        <KostenGrenze freigabe={freigabe} />
      ) : (
        <KostenZugang>
          <RateManagement />
        </KostenZugang>
      )}
    </>
  );
}
