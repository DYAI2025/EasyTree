/**
 * Startprüfung der Datenbankrolle (EYT-45).
 *
 * ## Was hier geprüft wird und warum
 *
 * ADR-001 Z. 85: „Normale Runtime-Credentials dürfen RLS nicht umgehen."
 *
 * Row Level Security ist kein Schalter, den man einmal anlegt — sie gilt nur,
 * solange die verbindende Rolle sie nicht umgehen darf. Ein Superuser umgeht
 * sie vollständig, unabhängig von jeder Policy und unabhängig von
 * `force row level security`. Bis Migration `0003_app_role` verband die
 * Anwendung mit `postgres`; sämtliche Policies aus `0002_tenancy` waren für sie
 * damit wirkungslos.
 *
 * Diese Prüfung stellt sicher, dass so eine Konfiguration den Prozess **nicht
 * starten lässt**. Sie ist bewusst fail-closed: kann sie nichts feststellen,
 * verweigert sie ebenfalls den Start. Eine Sicherheitsprüfung, die im Zweifel
 * durchwinkt, ist keine.
 *
 * ## Warum sie nicht im `AppModule` hängt
 *
 * Sie läuft im Bootstrap von `main.ts` und `worker.ts`, nicht in einem
 * Modul-Lifecycle-Hook. Grund: die bestehenden Tests booten `AppModule` direkt
 * (`Test.createTestingModule`) und dürfen dafür keine echte Datenbank brauchen.
 * Der Produktivpfad läuft trotzdem durch — die Runtime-Smokes in
 * `scripts/smoke-api.sh` und `scripts/smoke-worker.sh` starten genau diese
 * Entrypoints.
 */
import { Client } from "pg";

/** Rollenattribute, die über RLS entscheiden. */
export interface RolePrivileges {
  readonly role: string;
  readonly isSuperuser: boolean;
  readonly bypassesRls: boolean;
  /** `false` heisst: Rechte gibt es erst nach explizitem `set role`. */
  readonly inheritsPrivileges: boolean;
}

export class InsecureDatabaseRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureDatabaseRoleError";
  }
}

/** Liest die Attribute der tatsächlich verbundenen Rolle. */
export type RolePrivilegeReader = () => Promise<RolePrivileges>;

/**
 * Bewertet die Attribute und wirft bei jeder Abweichung.
 *
 * Rein und synchron, damit die Entscheidungslogik ohne Datenbank testbar ist —
 * die Ja/Nein-Frage ist der sicherheitsrelevante Teil, nicht das SQL.
 */
export function assertRoleCannotBypassRls(privileges: RolePrivileges): void {
  if (privileges.isSuperuser) {
    throw new InsecureDatabaseRoleError(
      `Die Datenbankrolle "${privileges.role}" ist Superuser. Superuser umgehen Row Level Security vollstaendig; saemtliche Policies waeren wirkungslos (ADR-001 Z. 85). Verbinde mit easytree_app statt postgres.`,
    );
  }
  if (privileges.bypassesRls) {
    throw new InsecureDatabaseRoleError(
      `Die Datenbankrolle "${privileges.role}" traegt BYPASSRLS und umgeht damit Row Level Security (ADR-001 Z. 85).`,
    );
  }
  if (privileges.inheritsPrivileges) {
    // Kein RLS-Bypass, aber die Kontextsetzung waere damit nur noch Konvention:
    // eine Query VOR `set local role authenticated` haette bereits vollen
    // Tabellenzugriff. Mit NOINHERIT scheitert sie stattdessen mit
    // "permission denied" — fail-closed auf Datenbankebene.
    throw new InsecureDatabaseRoleError(
      `Die Datenbankrolle "${privileges.role}" vererbt Rechte automatisch (INHERIT). Erwartet wird NOINHERIT, damit ohne gesetzten Tenantkontext kein Tabellenzugriff moeglich ist (EYT-45).`,
    );
  }
}

/** Fragt die Attribute der verbundenen Rolle ab. */
export function createRolePrivilegeReader(databaseUrl: string): RolePrivilegeReader {
  return async (): Promise<RolePrivileges> => {
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    try {
      await client.connect();
      const result = await client.query<{
        role: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolinherit: boolean;
      }>(
        "select current_user as role, rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = current_user",
      );
      const row = result.rows[0];
      if (row === undefined) {
        // Fail-closed: ohne Auskunft keine Freigabe.
        throw new InsecureDatabaseRoleError(
          "Die Attribute der verbundenen Datenbankrolle sind nicht ermittelbar. Start wird verweigert (fail-closed).",
        );
      }
      return {
        role: row.role,
        isSuperuser: row.rolsuper,
        bypassesRls: row.rolbypassrls,
        inheritsPrivileges: row.rolinherit,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}

/**
 * Startpforte. Wirft, wenn die Rolle RLS umgehen könnte — der Prozess startet
 * dann nicht.
 *
 * Ein Verbindungsfehler wird ebenfalls zur Ablehnung: sonst würde eine
 * unerreichbare Datenbank die Sicherheitsprüfung stillschweigend überspringen,
 * und genau das ist das Muster, das `CLAUDE.md` als „Skip, der ein Pflichtgate
 * grün macht" verbietet.
 */
export async function verifyDatabaseRole(read: RolePrivilegeReader): Promise<RolePrivileges> {
  let privileges: RolePrivileges;
  try {
    privileges = await read();
  } catch (error) {
    if (error instanceof InsecureDatabaseRoleError) throw error;
    throw new InsecureDatabaseRoleError(
      `Die Datenbankrolle konnte nicht geprueft werden: ${error instanceof Error ? error.message : String(error)}. Start wird verweigert (fail-closed).`,
    );
  }
  assertRoleCannotBypassRls(privileges);
  return privileges;
}
