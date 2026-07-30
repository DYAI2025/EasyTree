/**
 * Exportport des Kostenmoduls (EYT-105, REQ-001, ADR-003).
 *
 * ## Warum der Port heute schon steht, der Adapter aber nicht
 *
 * REQ-001 verlangt, dass der XLSX-Renderer **hinter** einem Application-Port
 * haengt und nicht neu rechnet. Damit ist der Port Teil der Modulgrenze und
 * gehoert zu EYT-105; der konkrete XLSX-Adapter gehoert zu EYT-110 und
 * existiert hier bewusst **nicht**. Ein Stub-Renderer waere ein Wert, den
 * niemand geprueft hat — er machte die Regel `costs-xlsx-behind-application-port`
 * scheinbar wirksam, obwohl sie mangels XLSX-Import gar nicht zugreift, und er
 * faerbte spaetere Exporttests zufaellig gruen.
 *
 * Die Wahl der Bibliothek ist ausdruecklich offen: `XLSX_LIBRARY_PATTERN` in
 * `apps/api/test/architecture/costs-rules.ts` haelt fest, dass heute keine im
 * Monorepo liegt und die erste eine bewusste Entscheidung mit
 * Supply-Chain-Pruefung ist, kein Nebeneffekt eines Imports.
 *
 * ## Warum die Rendermenge nur eine Snapshot-Id ist
 *
 * Der Export rendert einen **gespeicherten** Snapshot. Bekaeme der Port die
 * Positionen als Argument, koennte der Aufrufer andere Zahlen hineinreichen als
 * die persistierten — und die Paritaet zwischen Oberflaeche, Datenbank und
 * Datei waere nicht mehr strukturell, sondern nur noch Absprache (REQ-007).
 */

/** Ergebnis eines Exports: fertige Bytes plus die Angaben der HTTP-Antwort. */
export interface CostExportRendering {
  /** MIME-Typ der erzeugten Datei. */
  readonly contentType: string;
  /** Dateiname fuer `Content-Disposition`. */
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface CostExportPort {
  /**
   * Rendert einen bereits gespeicherten Snapshot.
   *
   * Der Bezeichner ist heute `string` und keine Marke: die Marke gehoert zum
   * Snapshotmodell aus EYT-109, und sie hier zu erfinden hiesse, in
   * `@easytree/domain` vorzugreifen (dort fuehrt `IDENTIFIER_BRANDS` die
   * vollstaendige Liste, an die eine Vollstaendigkeitspruefung gebunden ist).
   */
  render(snapshotId: string): Promise<CostExportRendering>;
}

/** DI-Token. Der Adapter dahinter ist austauschbar (CAN-008). */
export const COST_EXPORT_PORT = "COST_EXPORT_PORT";
