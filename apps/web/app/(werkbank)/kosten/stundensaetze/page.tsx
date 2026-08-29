import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PageHeader } from "@easytree/ui";

import { KostenGrenze } from "../../../../components/kosten-grenze";
import { StundensaetzeFlaeche } from "../../../../components/stundensaetze-flaeche";
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

  // Client-seitige Importgrenze (EYT-113 Inkrement 2, D4 Stufe 3): die Seite
  // verweist statisch NUR auf die kostenfreie `StundensaetzeFlaeche`; deren
  // `next/dynamic` laedt die Kosten-Client-Komponenten als Lazy-Chunks im
  // CLIENT-Modulgraphen. Stufe 2 (`await import()` im gewaehrten Zweig)
  // reichte nicht: Turbopack schreibt Route-Entry-Chunks unbedingt in den
  // Dokumentkopf (Messung und Begruendung im Kommentar von `../page.tsx`).
  let inhalt: ReactNode;
  if (freigabe.art !== "gewaehrt") {
    inhalt = <KostenGrenze freigabe={freigabe} />;
  } else {
    inhalt = <StundensaetzeFlaeche />;
  }

  return (
    <>
      <PageHeader
        title="Stundensätze"
        description="Interne Netto-Stundensätze je Mitarbeiter — unveränderliche Versionen mit Gültigkeit, nie überschrieben."
      />
      {inhalt}
    </>
  );
}
