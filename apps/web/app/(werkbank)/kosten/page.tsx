import type { Metadata } from "next";
import type { ReactNode } from "react";

import { IdSchema } from "@easytree/contracts";
import { PageHeader } from "@easytree/ui";

import { KostenFlaeche } from "../../../components/kosten-flaeche";
import { KostenGrenze } from "../../../components/kosten-grenze";
import { leseKostenFreigabe } from "../../../lib/kosten-freigabe";

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
 *
 * Seit EYT-113 Inkrement 2 steht VOR jedem Kosteninhalt die serverseitige
 * Ladegrenze: `leseKostenFreigabe()` prueft das `costs.read` der
 * AUSGEWAEHLTEN Organisation, fail-closed — jeder Verweigerungszustand
 * rendert `KostenGrenze` statt der Kosten-Client-Komponenten. Die
 * `headers()`/`cookies()`-Lesezugriffe in `leseKostenFreigabe` machen die
 * Route dynamisch; das ist gewollt (EYT-126: nichts davon darf zur Bauzeit
 * festgeschrieben werden).
 */
export default async function KostenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const freigabe = await leseKostenFreigabe();
  const params = await searchParams;
  const roh = params["snapshot"];
  const geprueft =
    roh === undefined ? null : IdSchema.safeParse(typeof roh === "string" ? roh : "");

  // Client-seitige Importgrenze (EYT-113 Inkrement 2, D4 Stufe 3): die Seite
  // verweist statisch NUR auf die kostenfreie `KostenFlaeche`; die
  // eigentlichen Kosten-Client-Komponenten laedt erst deren `next/dynamic`.
  // Stufe 2 (`await import()` im gewaehrten Zweig) reichte nicht — gemessen
  // am 29.08.2026: Next 16.2.11/Turbopack schreibt die gesamte
  // Client-Referenz-Chunkliste der Route als unbedingte `<script async>`-Tags
  // in den Dokumentkopf, die Kosten-Chunks erreichten den verweigerten
  // Browser trotzdem. Nur Lazy-Chunks im CLIENT-Modulgraphen stehen weder als
  // Route-Entry noch im Client-Referenz-Manifest der Seite und werden erst
  // angefordert, wenn der gewaehrte Zweig tatsaechlich rendert; der
  // Journey-Nachweis (member, /kosten und /kosten/stundensaetze) misst genau
  // das.
  let inhalt: ReactNode;
  if (freigabe.art !== "gewaehrt") {
    inhalt = <KostenGrenze freigabe={freigabe} />;
  } else {
    inhalt = (
      // Bei einem Parameterfehler ist `snapshotId` bewusst `null`: die
      // Flaeche rendert dann den Fehlerhinweis und liest die Id nie.
      <KostenFlaeche
        snapshotId={geprueft !== null && geprueft.success ? geprueft.data : null}
        parameterfehler={geprueft !== null && !geprueft.success}
      />
    );
  }

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
      {inhalt}
    </section>
  );
}
