/**
 * Getypte Bezeichner des Domainkerns (EYT-46).
 *
 * Zweck: Verwechslung strukturell unmöglich machen. Ohne Branding sind
 * `EmployeeId` und `WorksiteId` beide `string`, und ein vertauschtes Argument
 * fällt erst zur Laufzeit auf — im schlechtesten Fall als falsche Zuweisung in
 * einer veröffentlichten Planversion.
 *
 * Bewusst KEINE Laufzeitvalidierung hier: das Format (UUID) wird an der
 * Systemgrenze geprüft (API-DTO, Datenbank-Constraint). Dieses Modul bleibt
 * framework- und abhängigkeitsfrei (ADR-001 Z. 74, ADR-002 §5).
 */

declare const brand: unique symbol;

/** Nominaler Typ über einem Primitiv — zur Laufzeit ist es weiterhin der Basistyp. */
export type Brand<TBase, TBrand extends string> = TBase & { readonly [brand]: TBrand };

/** Mandant. Entspricht `public.organizations.id`. */
export type OrgId = Brand<string, "OrgId">;

/** Person mit Zugang. Entspricht `public.users.id` (1:1 auf `auth.users`). */
export type UserId = Brand<string, "UserId">;

/** Beschäftigte Person in einer Organisation. Nicht identisch mit {@link UserId}. */
export type EmployeeId = Brand<string, "EmployeeId">;

/** Baustelle. */
export type WorksiteId = Brand<string, "WorksiteId">;

/** Einzelne Zuweisung einer Person zu einer Baustelle in einem Zeitraum. */
export type AssignmentId = Brand<string, "AssignmentId">;

/** Unveränderliche Planversion. Referenz für Bestätigung und Audit. */
export type PlanVersionId = Brand<string, "PlanVersionId">;

/** Betriebsmittel (Fahrzeug oder Gerät). */
export type ResourceId = Brand<string, "ResourceId">;

/**
 * Unveränderliche Liste aller Bezeichnerarten. Dient als Testanker: neue
 * Bezeichner müssen hier eingetragen werden, damit die Vollständigkeitsprüfung
 * in `test/identifiers.test.ts` grün bleibt.
 */
export const IDENTIFIER_BRANDS = [
  "OrgId",
  "UserId",
  "EmployeeId",
  "WorksiteId",
  "AssignmentId",
  "PlanVersionId",
  "ResourceId",
] as const;

export type IdentifierBrand = (typeof IDENTIFIER_BRANDS)[number];

/**
 * Hebt einen rohen `string` auf einen gebrandeten Bezeichner.
 *
 * Bewusst ohne Prüfung — der Aufruf ist die dokumentierte Stelle, an der die
 * Herkunft des Wertes bereits belegt ist (Datenbankspalte, validiertes DTO,
 * Testfixture). Wer sie ohne solchen Beleg aufruft, umgeht die Typgrenze
 * absichtlich und muss das im Code begründen.
 */
export function unsafeIdentifier<T extends Brand<string, IdentifierBrand>>(value: string): T {
  return value as T;
}
