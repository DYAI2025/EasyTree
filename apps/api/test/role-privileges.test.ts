import { describe, expect, it } from "vitest";

import {
  assertRoleCannotBypassRls,
  InsecureDatabaseRoleError,
  verifyDatabaseRole,
  type RolePrivileges,
} from "../src/platform/database/role-privileges";

const SAFE: RolePrivileges = {
  role: "easytree_app",
  isSuperuser: false,
  bypassesRls: false,
  inheritsPrivileges: false,
};

describe("assertRoleCannotBypassRls", () => {
  it("laesst die vorgesehene Laufzeitrolle durch", () => {
    expect(() => assertRoleCannotBypassRls(SAFE)).not.toThrow();
  });

  it("lehnt einen Superuser ab — genau der Zustand vor EYT-45", () => {
    // `postgres` stand bis hierher in jeder DATABASE_URL des Repositories.
    expect(() =>
      assertRoleCannotBypassRls({ ...SAFE, role: "postgres", isSuperuser: true }),
    ).toThrow(InsecureDatabaseRoleError);
  });

  it("lehnt BYPASSRLS ab, auch ohne Superuser", () => {
    expect(() => assertRoleCannotBypassRls({ ...SAFE, bypassesRls: true })).toThrow(
      InsecureDatabaseRoleError,
    );
  });

  it("lehnt eine vererbende Rolle ab", () => {
    // Mit INHERIT haette eine Query VOR `set local role authenticated` bereits
    // vollen Tabellenzugriff — die Kontextsetzung waere nur Konvention.
    expect(() => assertRoleCannotBypassRls({ ...SAFE, inheritsPrivileges: true })).toThrow(
      InsecureDatabaseRoleError,
    );
  });

  it("nennt die Rolle beim Namen, ohne Verbindungsdaten preiszugeben", () => {
    try {
      assertRoleCannotBypassRls({ ...SAFE, role: "postgres", isSuperuser: true });
      expect.unreachable("haette werfen muessen");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("postgres");
      expect(message).not.toContain("postgresql://");
      expect(message).not.toContain("password");
    }
  });
});

describe("verifyDatabaseRole — fail-closed", () => {
  it("gibt die Attribute zurueck, wenn die Rolle sicher ist", async () => {
    await expect(verifyDatabaseRole(() => Promise.resolve(SAFE))).resolves.toEqual(SAFE);
  });

  it("verweigert den Start, wenn die Datenbank nicht erreichbar ist", async () => {
    // Der gefaehrlichste Fall: eine unerreichbare Datenbank duerfte die
    // Sicherheitspruefung NICHT stillschweigend ueberspringen. CLAUDE.md nennt
    // genau dieses Muster ("Skip, der ein Pflichtgate gruen macht") verboten.
    await expect(
      verifyDatabaseRole(() => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:54322"))),
    ).rejects.toBeInstanceOf(InsecureDatabaseRoleError);
  });

  it("reicht einen bereits erkannten Rollenfehler unveraendert durch", async () => {
    const original = new InsecureDatabaseRoleError("keine Auskunft");
    await expect(verifyDatabaseRole(() => Promise.reject(original))).rejects.toBe(original);
  });

  it("verweigert den Start bei unsicherer Rolle", async () => {
    await expect(
      verifyDatabaseRole(() => Promise.resolve({ ...SAFE, role: "postgres", isSuperuser: true })),
    ).rejects.toBeInstanceOf(InsecureDatabaseRoleError);
  });
});
