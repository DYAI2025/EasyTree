/**
 * Port: Organisationen und Rechte einer angemeldeten Person (EYT-106).
 *
 * Serverseitige Aufloesung — der Client rechnet NIE von Rolle auf Recht um.
 * Die Implementierung liest ueber den TenantQueryRunner (RLS begrenzt auf die
 * eigenen aktiven Mitgliedschaften); die Rechte kommen aus `role_permissions`.
 */
import type { OrganisationMembership } from "../domain/membership";

export interface SessionOrganisationsPort {
  organisationsFor(userId: string): Promise<readonly OrganisationMembership[]>;
}

export const SESSION_ORGANISATIONS = "TENANCY_SESSION_ORGANISATIONS";
