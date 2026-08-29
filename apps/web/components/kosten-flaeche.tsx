"use client";

/**
 * Client-seitige dynamische Importgrenze der Kostenflaeche (EYT-113
 * Inkrement 2, D4 Stufe 3): diese Datei ist der EINZIGE Route-Entry-Verweis
 * der Kostenflaeche und enthaelt selbst keine Kostenfachflaeche. Die
 * Kosten-Chunks (`KostenZugang`, `KostenAnsicht`) sind Lazy-Chunks im
 * CLIENT-Modulgraphen (`next/dynamic`) — sie stehen weder im Route-Entry noch
 * im Client-Referenz-Manifest der Seite und laden erst, wenn diese Komponente
 * tatsaechlich rendert. Das erlaubt der Server nur im gewaehrten Zweig.
 *
 * WICHTIG: die Marker-Strings der Chunk-Messung (`eyt-kosten-ansicht`,
 * `kosten-laedt`, `saetze-laedt`) duerfen in DIESER Datei nicht vorkommen —
 * deshalb eigene Lade-Testids (`kosten-flaeche-laedt`).
 */
import dynamic from "next/dynamic";
import Link from "next/link";

import { Card } from "@easytree/ui";

const KostenZugang = dynamic(() => import("./kosten-zugang").then((m) => m.KostenZugang), {
  loading: () => (
    <p role="status" data-testid="kosten-flaeche-laedt">
      Kostenbereich wird geladen …
    </p>
  ),
});

const KostenAnsicht = dynamic(() => import("./kosten-ansicht").then((m) => m.KostenAnsicht), {
  loading: () => (
    <p role="status" data-testid="kosten-flaeche-laedt">
      Kostenbereich wird geladen …
    </p>
  ),
});

export function KostenFlaeche({
  snapshotId,
  parameterfehler,
}: {
  snapshotId: string | null;
  parameterfehler: boolean;
}) {
  return (
    <KostenZugang>
      {parameterfehler ? (
        <p data-testid="kosten-parameterfehler" role="alert">
          Keine gültige Snapshot-Id in der Adresse. Erwartet wird
          `?snapshot=&lt;id-aus-der-Kostenansicht&gt;`.
        </p>
      ) : (
        <KostenAnsicht snapshotId={snapshotId} />
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
  );
}
