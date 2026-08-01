/**
 * EUR-Eingabe <-> Minor Units, reine Stringarbeit (EYT-108).
 *
 * Kein `parseFloat`, keine Gleitkommazahl: "12,34" wird zu "1234", indem
 * Ziffern verschoben werden, nicht gerechnet. Die Domäne rechnet in bigint
 * (EYT-95); dieser Helfer ist nur die Eingabegrenze der Maske.
 */

/**
 * "1.234,56" | "1234,56" | "1234" -> "123456" | null bei ungueltiger Eingabe.
 *
 * Punkte sind NUR als Tausendertrenner zulaessig und werden strukturell
 * geprueft (Gruppen zu je drei Ziffern), nicht blind entfernt: "38.50" ist
 * mehrdeutig (englischer Dezimalpunkt?) und wird abgelehnt statt als
 * 3.850,00 fehlgelesen — der Testfall dazu hat genau diesen 100x-Fehler
 * gefangen.
 */
export function euroToMinorUnits(eingabe: string): string | null {
  const roh = eingabe.trim();
  const treffer = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(roh);
  if (treffer === null) return null;
  const euros = (treffer[1] ?? "").replace(/\./g, "");
  const cents = (treffer[2] ?? "").padEnd(2, "0");
  const zusammen = `${euros}${cents}`.replace(/^0+(?=\d)/, "");
  return zusammen;
}

/** "123456" -> "1.234,56" fuer die Anzeige (tabellarische Ziffern via CSS). */
export function minorUnitsToEuro(minorUnits: string): string {
  const gefuellt = minorUnits.padStart(3, "0");
  const euros = gefuellt.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = gefuellt.slice(-2);
  return `${euros},${cents}`;
}
