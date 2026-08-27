/**
 * WCAG-2.x-Kontrast, lokal gerechnet — bewusst OHNE Abhaengigkeit.
 *
 * Die Formel ist kurz und stabil (relative Leuchtdichte nach WCAG 2.1,
 * Definition „relative luminance"); eine Bibliothek dafuer waere eine
 * Abhaengigkeit, die genau diese zehn Zeilen mitbringt.
 *
 * Dass sie STIMMT, ist nicht behauptet, sondern gemessen: die beiden von
 * Confluence 8814623 §2.1 ausdruecklich verworfenen Kombinationen sind dort
 * mit „ca. 4,14:1" und „ca. 3,66:1" beziffert, und diese Funktion
 * reproduziert beide Zahlen auf zwei Nachkommastellen (Fall „reproduziert die
 * in der Baseline genannten Verhaeltnisse" in basisdesign-tokens.test.ts).
 * Das ist die Gegenprobe gegen eine kaputte Implementierung — ohne sie waere
 * eine Funktion, die immer 1 zurueckgibt, fuer die Ablehnungsfaelle gruen.
 */

/**
 * #rrggbb → [r, g, b] in 0..255.
 *
 * Die Kurzform `#rgb` wird bewusst NICHT akzeptiert: die kanonische Datei
 * schreibt sechsstellig, und der Zweig war von keiner Aufrufstelle erreichbar
 * — er versprach eine Toleranz, die der Vertrag nicht hat.
 */
export function kanaele(hex: string): [number, number, number] {
  const roh = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(roh)) {
    throw new Error(`kein 6-stelliger Hexwert: ${hex}`);
  }
  const teil = (i: number): number => Number.parseInt(roh.slice(i, i + 2), 16);
  return [teil(0), teil(2), teil(4)];
}

/** Relative Leuchtdichte nach WCAG 2.1. */
export function leuchtdichte(hex: string): number {
  const linear = (wert: number): number => {
    const anteil = wert / 255;
    return anteil <= 0.04045 ? anteil / 12.92 : Math.pow((anteil + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = kanaele(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Kontrastverhaeltnis zweier Farben, immer >= 1. */
export function kontrast(vordergrund: string, hintergrund: string): number {
  const a = leuchtdichte(vordergrund);
  const b = leuchtdichte(hintergrund);
  const [hell, dunkel] = a > b ? [a, b] : [b, a];
  return (hell + 0.05) / (dunkel + 0.05);
}

/** WCAG 2.1 AA fuer normalen Kleintext. */
export const SCHWELLE_NORMALTEXT = 4.5;
