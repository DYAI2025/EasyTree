/**
 * Eine Stundensatzversion als reiner Domaenenwert (EYT-108).
 *
 * Liegt in `domain/`, nicht in `application/`: die Wirksamkeitsregel
 * (`rate-effectivity.ts`) braucht diese Form, und Domaencode darf nicht nach
 * aussen greifen (ADR-001 Z. 65-69). Der Architekturtest hat genau das
 * gemeldet, als der Typ zuerst im Port stand — die Regel ist keine Formalie:
 * ein Port kann sich an einen Treiber oder ein Transportformat anpassen, ein
 * Domaenenwert darf das nie.
 *
 * Betraege reisen als dezimaler String (Minor Units). Kein `number`: eine
 * JSON-Zahl verliert oberhalb von 2^53 still die Genauigkeit, und `bigint`
 * kommt aus `pg` ohnehin als String.
 */

export interface RateVersionRecord {
  readonly id: string;
  readonly employeeId: string;
  /** Minor Units als dezimaler String — nie Gleitkomma (EYT-95). */
  readonly amountMinorUnits: string;
  readonly currency: "EUR";
  /** Lokales Geschaeftsdatum JJJJ-MM-TT. */
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly predecessorId: string | null;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy: string;
}
