/**
 * Mitgliedschafts- und Rechteaufloesung ueber den TenantQueryRunner (EYT-106).
 *
 * RLS begrenzt die Sicht: `memberships_select_own` liefert nur die eigenen
 * Zeilen, `organizations` nur die eigenen Organisationen. Der Runner setzt
 * den Kontext (`request.jwt.claims.sub` = userId) — dieselbe Kette wie jede
 * fachliche Abfrage, kein Sonderweg fuer die Sitzung.
 *
 * ## `role_permissions` existiert erst ab Migration 0013
 *
 * Bis dahin liefert die Rechteabfrage 42P01 (relation does not exist). Das
 * wird HIER und NUR HIER als "keine Rechte" uebersetzt — fail-closed: die
 * Navigation zeigt dann keinen Kostenbereich, und /kosten lehnt ab. Nach der
 * Migration kippt das Verhalten ohne Codeaenderung auf echt. Jede ANDERE
 * Fehlerklasse wird weitergeworfen, nicht verschluckt.
 */
import type { TenantQueryRunner } from "../../../platform/database/tenant-query-runner";
import type { OrganisationMembership } from "../domain/membership";
import { isMembershipRole } from "../domain/membership";
import type { SessionOrganisationsPort } from "../application/session-organisations.port";

interface MembershipRow {
  readonly org_id: string;
  readonly role: string;
  readonly name: string;
}

interface PermissionRow {
  readonly role: string;
  readonly permission: string;
}

const RELATION_MISSING = "42P01";

export class MembershipRepository implements SessionOrganisationsPort {
  constructor(private readonly runner: TenantQueryRunner) {}

  async organisationsFor(userId: string): Promise<readonly OrganisationMembership[]> {
    const zeilen = await this.runner.run({ userId }, async (tx) => {
      const ergebnis = await tx.query<MembershipRow>(
        `select m.org_id, m.role, o.name
           from public.memberships m
           join public.organizations o on o.id = m.org_id
          where m.active
          order by o.name`,
      );
      return ergebnis.rows;
    });

    const rollen = [...new Set(zeilen.map((z) => z.role))];
    const rechteJeRolle = await this.permissionsByRole(userId, rollen);

    return zeilen.map((zeile) => {
      if (!isMembershipRole(zeile.role)) {
        // Eine Rolle, die das Modell nicht kennt, ist ein Datenfehler —
        // laut, nicht still als "member" uminterpretiert.
        throw new Error(`Unbekannte Mitgliedsrolle in der Datenbank fuer Organisation.`);
      }
      return {
        organisationId: zeile.org_id,
        organisationName: zeile.name,
        role: zeile.role,
        permissions: rechteJeRolle.get(zeile.role) ?? [],
      };
    });
  }

  private async permissionsByRole(
    userId: string,
    rollen: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (rollen.length === 0) return new Map();
    try {
      const zeilen = await this.runner.run({ userId }, async (tx) => {
        const ergebnis = await tx.query<PermissionRow>(
          `select rp.role, rp.permission
             from public.role_permissions rp
            where rp.role = any($1::text[])
            order by rp.permission`,
          [rollen as string[]],
        );
        return ergebnis.rows;
      });
      const karte = new Map<string, string[]>();
      for (const zeile of zeilen) {
        const liste = karte.get(zeile.role) ?? [];
        liste.push(zeile.permission);
        karte.set(zeile.role, liste);
      }
      return karte;
    } catch (fehler) {
      if (istRelationFehlt(fehler)) return new Map();
      throw fehler;
    }
  }
}

function istRelationFehlt(fehler: unknown): boolean {
  return (
    typeof fehler === "object" &&
    fehler !== null &&
    "code" in fehler &&
    (fehler as { code?: unknown }).code === RELATION_MISSING
  );
}
