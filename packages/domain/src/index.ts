/**
 * Öffentliche API von `@easytree/domain` (EYT-46, ADR-002 §5).
 *
 * Regeln für dieses Paket:
 * - reine Typen, Invarianten und Zustandsmodelle;
 * - keine Abhängigkeiten — `package.json` führt bewusst weder `dependencies`
 *   noch `peerDependencies`, und `tsconfig` setzt `"types": []`. Damit kann ein
 *   Import von `@nestjs/*`, `kysely`, `pg` oder einem Provider-SDK hier nicht
 *   einmal auflösen: `pnpm typecheck` schlägt fehl, bevor ein Architekturtest
 *   überhaupt greifen müsste (ADR-001 Z. 74);
 * - dies ist NICHT das verbotene `packages/shared` (ADR-001 Z. 77): der Inhalt
 *   ist fachlich benannt und begrenzt, kein Sammelbecken für Hilfsfunktionen.
 */
export type {
  AssignmentId,
  Brand,
  EmployeeId,
  IdentifierBrand,
  OrgId,
  PlanVersionId,
  ResourceId,
  UserId,
  WorksiteId,
} from "./identifiers.js";
export { IDENTIFIER_BRANDS, unsafeIdentifier } from "./identifiers.js";
