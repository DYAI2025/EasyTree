/**
 * Mitgliedschaft als reiner Domaenenbegriff (EYT-106).
 *
 * `manager` steht bereits im Typ, obwohl die Datenbank ihn erst mit
 * Migration 0013 zulaesst: der Typ beschreibt das Zielmodell des Slices,
 * und eine Datenbankzeile mit unbekannter Rolle wuerde an der Schemapruefung
 * der Transportgrenze scheitern, nicht still durchrutschen.
 */

export const MEMBERSHIP_ROLES = ["owner", "manager", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

/** Eine Organisation aus Sicht einer angemeldeten Person. */
export interface OrganisationMembership {
  readonly organisationId: string;
  readonly organisationName: string;
  readonly role: MembershipRole;
  /** Serverseitig aus `role_permissions` aufgeloeste atomare Rechte. */
  readonly permissions: readonly string[];
}
