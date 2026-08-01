import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, PageHeader } from "@easytree/ui";

import { KostenZugang } from "../../components/kosten-zugang";

export const metadata: Metadata = { title: "Kosten — easyTree" };

/**
 * `/kosten` — Tageskosten und Snapshotuebersicht (EYT-109, Basisdesign §5).
 *
 * Die Route steht VOR der Berechnung: bis der Tageskosten-Endpunkt
 * angeschlossen ist (Slice-Schritt 5), zeigt sie den ehrlichen Leerzustand —
 * keinen Mock, keine erfundenen Betraege, keine 0,00-€-Attrappe.
 */
export default function KostenPage() {
  return (
    <>
      <PageHeader
        title="Kosten"
        description="Geplante Personalkosten je Baustelle und Tag — aus veröffentlichten Planversionen, bis zur Einzelposition."
      />
      <KostenZugang>
        <div className="eyt-card-grid">
          <Card title="Tageskosten">
            <EmptyState
              data-testid="kosten-leer"
              title="Noch keine Kostenberechnung verfügbar"
              description="Die Tageskostenberechnung wird in diesem Sprint angeschlossen. Bis dahin gibt es hier bewusst keine Zahlen — easyTree zeigt nie erfundene Beträge."
            />
          </Card>
          <Card title="Stundensätze">
            <p>
              Interne Netto-Stundensätze je Mitarbeiter, versioniert mit Gültigkeit — die Grundlage
              jeder Kostenberechnung.
            </p>
            <p>
              <Link href="/kosten/stundensaetze">Zur Stundensatzverwaltung</Link>
            </p>
          </Card>
        </div>
      </KostenZugang>
    </>
  );
}
