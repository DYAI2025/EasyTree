import type { Metadata } from "next";
import Link from "next/link";

import { IdSchema } from "@easytree/contracts";
import { Card, PageHeader } from "@easytree/ui";

import { KostenAnsicht } from "../../components/kosten-ansicht";
import { KostenZugang } from "../../components/kosten-zugang";

export const metadata: Metadata = { title: "Kosten — easyTree" };

/**
 * `/kosten` — Tageskosten aus veroeffentlichten Planversionen (EYT-109/EYT-144).
 *
 * Hier stand bis EYT-144 der ehrliche Leerzustand: die Berechnung war noch
 * nicht angeschlossen, und easyTree zeigt lieber nichts als eine 0,00-€-Attrappe.
 * Angeschlossen ist sie jetzt — an die ECHTE API, ueber das `CostsGateway`.
 *
 * Die Snapshot-Id kommt aus der URL: `/kosten?snapshot=<id>`. Damit ist ein
 * gespeicherter Stand teilbar und ueberlebt einen Reload — die Ansicht LIEST
 * ihn dann und rechnet nichts neu.
 *
 * Kein stiller Default: ein unbrauchbarer Parameter wird SICHTBAR abgelehnt und
 * das Gateway gar nicht erst gerufen (dasselbe Muster wie `/planung`). Ein
 * mehrfach angegebener Parameter ist keine Id, sondern eine mehrdeutige Angabe.
 */
export default async function KostenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const roh = params["snapshot"];
  const geprueft =
    roh === undefined ? null : IdSchema.safeParse(typeof roh === "string" ? roh : "");

  return (
    /*
     * Derselbe Werkbankrahmen wie `/planung` (EYT-141).
     *
     * Bis EYT-141 stand hier ein blosses Fragment: Kopf und Inhalt lagen ohne
     * Bereichsgrenze direkt im `<main>` der Shell, waehrend die Planung ihre
     * Flaeche als benannten Bereich fuehrte. Beide Seiten sahen dadurch
     * unterschiedlich aufgebaut aus, obwohl sie dieselbe Rolle spielen.
     *
     * `<section aria-label>` und nicht `<main>`: die eine `main`-Landmark
     * stellt die `AppShell`, und eine zweite darin waere derselbe Fehler, den
     * `planungs-werkbank.tsx` gerade abgelegt hat.
     */
    <section aria-label="Kosten" data-testid="werkbank-kostenflaeche" className="werkbank">
      <PageHeader
        className="werkbank__kopf"
        title="Kosten"
        description="Geplante Personalkosten je Baustelle und Tag — aus veröffentlichten Planversionen, bis zur Einzelposition."
      />
      <KostenZugang>
        {geprueft !== null && !geprueft.success ? (
          <p data-testid="kosten-parameterfehler" role="alert">
            Keine gültige Snapshot-Id in der Adresse. Erwartet wird
            `?snapshot=&lt;id-aus-der-Kostenansicht&gt;`.
          </p>
        ) : (
          <KostenAnsicht snapshotId={geprueft === null ? null : geprueft.data} />
        )}
        <Card title="Stundensätze">
          <p>
            Interne Netto-Stundensätze je Mitarbeiter, versioniert mit Gültigkeit — die Grundlage
            jeder Kostenberechnung.
          </p>
          <p>
            <Link href="/kosten/stundensaetze">Zur Stundensatzverwaltung</Link>
          </p>
        </Card>
      </KostenZugang>
    </section>
  );
}
