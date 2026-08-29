"use client";

/**
 * Client-seitige dynamische Importgrenze der Stundensatzverwaltung (EYT-113
 * Inkrement 2, D4 Stufe 3): dieselbe Konstruktion wie `kosten-flaeche.tsx` —
 * diese Datei ist der EINZIGE Route-Entry-Verweis der Satzverwaltung und
 * enthaelt selbst keine Kostenfachflaeche. `KostenZugang` und
 * `RateManagement` sind Lazy-Chunks im CLIENT-Modulgraphen (`next/dynamic`)
 * und laden erst, wenn der Server die Freigabe erteilt hat.
 *
 * WICHTIG: die Marker-Strings der Chunk-Messung (`eyt-kosten-ansicht`,
 * `kosten-laedt`, `saetze-laedt`) duerfen in DIESER Datei nicht vorkommen —
 * deshalb eine eigene, unterscheidbare Lade-Testid (`saetze-flaeche-laedt`).
 */
import dynamic from "next/dynamic";

const KostenZugang = dynamic(() => import("./kosten-zugang").then((m) => m.KostenZugang), {
  loading: () => (
    <p role="status" data-testid="saetze-flaeche-laedt">
      Stundensatzverwaltung wird geladen …
    </p>
  ),
});

const RateManagement = dynamic(() => import("./rate-management").then((m) => m.RateManagement), {
  loading: () => (
    <p role="status" data-testid="saetze-flaeche-laedt">
      Stundensatzverwaltung wird geladen …
    </p>
  ),
});

export function StundensaetzeFlaeche() {
  return (
    <KostenZugang>
      <RateManagement />
    </KostenZugang>
  );
}
