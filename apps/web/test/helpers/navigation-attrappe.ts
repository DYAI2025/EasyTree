/**
 * Nachbildung der Next-Navigation fuer die Werkbanktests (EYT-140, Slice 1).
 *
 * ## Warum es diese Datei gibt
 *
 * `AppShell` und jede Wochennavigation haengen an `next/navigation`. jsdom hat
 * keinen App-Router, also muss das Modul ersetzt werden — bisher taten die
 * Tests das mit festen Werten (`apps/web/test/a11y.test.tsx:21`). Fuer die
 * Wochennavigation genuegt das NICHT: ein `router.push("/planung?weekKey=…")`
 * liefe gegen eine Attrappe, die nichts tut, und der Test koennte eine
 * KORREKTE Umsetzung nie gruen sehen.
 *
 * Diese Attrappe ist deshalb ein arbeitender Router: sie merkt sich jede
 * Navigation und meldet sie an die Seite zurueck, die daraufhin — wie der echte
 * App Router — mit den neuen `searchParams` neu ausgefuehrt wird.
 *
 * ## Was sie bewusst NICHT entscheidet
 *
 * Sie schreibt der Umsetzung nicht vor, WIE die Woche wechselt. Ein Wechsel
 * ueber `router.push`, ueber einen `<Link>` oder ueber reinen Clientzustand
 * fuehren alle zu demselben beobachtbaren Ergebnis; der Test misst das
 * Ergebnis, nicht den Weg.
 */

export interface NavigationsAttrappe {
  /** Was `usePathname()` liefert. */
  pfad: string;
  /** Der aktuelle Suchteil, z. B. `?weekKey=2026-W35` — oder leer. */
  suche: string;
  /** Jede angeforderte Navigation, in Reihenfolge. */
  readonly navigationen: string[];
  /**
   * Wird von der Nachbildung gesetzt. `null` heisst: niemand hoert zu — dann
   * wird die Navigation nur protokolliert.
   */
  aufNavigation: ((ziel: string) => void) | null;
}

export const navigation: NavigationsAttrappe = {
  pfad: "/planung",
  suche: "",
  navigationen: [],
  aufNavigation: null,
};

export function navigationZuruecksetzen(pfad = "/planung", suche = ""): void {
  navigation.pfad = pfad;
  navigation.suche = suche;
  navigation.navigationen.length = 0;
  navigation.aufNavigation = null;
}

export function navigieren(ziel: string): void {
  navigation.navigationen.push(ziel);
  navigation.aufNavigation?.(ziel);
}

const routerAttrappe = {
  push: (ziel: string) => navigieren(ziel),
  replace: (ziel: string) => navigieren(ziel),
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
};

/**
 * Das Ersatzmodul fuer `vi.mock("next/navigation", …)`.
 *
 * Als Funktion und nicht als Objektliteral, weil `vi.mock` seine Fabrik
 * hochzieht: die Testdatei darf zum Zeitpunkt der Fabrik nichts aus dem eigenen
 * Modulgeltungsbereich lesen, ein dynamischer Import hierher ist erlaubt.
 */
export function nextNavigationModul(): Record<string, unknown> {
  return {
    usePathname: () => navigation.pfad,
    useRouter: () => routerAttrappe,
    useSearchParams: () => new URLSearchParams(navigation.suche),
    useParams: () => ({}),
  };
}
