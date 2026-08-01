/**
 * Fachlicher Konflikt (HTTP 409) mit stabilem URN (EYT-108).
 *
 * Eigene Datei, damit Controller und Filter nicht zirkulaer voneinander
 * abhaengen: der Controller wirft, der Filter faengt, beide kennen nur diesen
 * Typ.
 */
export class ConflictProblem extends Error {
  constructor(
    readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = "ConflictProblem";
  }
}
