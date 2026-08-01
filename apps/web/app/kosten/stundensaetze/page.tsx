import type { Metadata } from "next";

import { PageHeader } from "@easytree/ui";

import { KostenZugang } from "../../../components/kosten-zugang";
import { RateManagement } from "../../../components/rate-management";

export const metadata: Metadata = { title: "Stundensätze — easyTree" };

/**
 * `/kosten/stundensaetze` — Satzverwaltung (EYT-108, Basisdesign §5 Punkt 3).
 * Fragment ohne eigenes `<main>`; Zugang über denselben Wächter wie /kosten.
 */
export default function StundensaetzePage() {
  return (
    <>
      <PageHeader
        title="Stundensätze"
        description="Interne Netto-Stundensätze je Mitarbeiter — unveränderliche Versionen mit Gültigkeit, nie überschrieben."
      />
      <KostenZugang>
        <RateManagement />
      </KostenZugang>
    </>
  );
}
