import { describe, expect, it } from "vitest";

import type {
  RolePrivilegeReader,
  RolePrivileges,
} from "../../src/platform/database/role-privileges";
import { createRoleGateLatch } from "../../src/platform/runtime/role-gate-latch";

/**
 * EYT-142 — fail-closed Rollengate fuer Requestlaufzeiten.
 *
 * Auf Cloudflare Workers gibt es keinen Bootstrap, in dem `verifyDatabaseRole`
 * einmal laufen koennte: der Modulscope darf kein I/O (gemessen in Spike A3),
 * und ein I/O-Objekt darf die Requestgrenze nicht ueberleben (gemessen in Spike
 * A4: "Cannot perform I/O on behalf of a different request"). Das Gate muss also
 * IM Request laufen — und trotzdem nicht bei jedem Request erneut.
 *
 * Der Latch speichert deshalb ausschliesslich EINFACHE WERTE. Kein memoisiertes
 * Promise: ein noch laufendes Promise aus Request A, in Request B awaited, waere
 * genau das requestuebergreifende I/O-Objekt, das N2/N3 verbieten.
 *
 * GEGENMUTATION — am 20.08.2026 EINGESPIELT, GEMESSEN, zurueckgenommen:
 * der Latch wurde so veraendert, dass er `verifyDatabaseRole` gar nicht mehr
 * aufruft und unbedingt `{ ok: true }` liefert. Ergebnis: 9 von 10 Faellen rot,
 * darunter (a), (b), (c), (e) und ALLE vier Rot-Faelle aus (f).
 *
 * Gruen blieb einzig (d)/N3 — und das ist richtig, nicht eine Luecke: die
 * Mutation speichert weiterhin ausschliesslich einfache Werte, also misst (d)
 * korrekt weiter "kein Promise im Zustand".
 *
 * ZWEITE GEGENMUTATION, ebenfalls ausgefuehrt und zurueckgenommen: ein
 * `laufend: Promise.resolve(1)` in den gespeicherten Zustand aufgenommen —
 * genau der memoisierte-Promise-Bau, vor dem der Kopfkommentar der
 * Implementierung warnt. Ergebnis: 1 failed | 9 passed, und zwar exakt (d).
 * Damit ist jeder der zehn Faelle durch mindestens eine Mutation belegt.
 */
const SICHER: RolePrivileges = {
  role: "easytree_app",
  isSuperuser: false,
  bypassesRls: false,
  inheritsPrivileges: false,
};

function leser(antwort: RolePrivileges | Error): {
  lies: RolePrivilegeReader;
  aufrufe: () => number;
} {
  let aufrufe = 0;
  return {
    aufrufe: () => aufrufe,
    lies: () => {
      aufrufe += 1;
      return antwort instanceof Error ? Promise.reject(antwort) : Promise.resolve(antwort);
    },
  };
}

describe("Rollengate-Latch (EYT-142)", () => {
  describe("(a)/(b) prueft genau einmal und danach nicht erneut", () => {
    it("verifiziert beim ersten Aufruf genau einmal", async () => {
      const { lies, aufrufe } = leser(SICHER);
      const latch = createRoleGateLatch(lies);

      await expect(latch.sicherstellen()).resolves.toEqual({ ok: true });
      expect(aufrufe()).toBe(1);
    });

    it("prueft nach Erfolg nicht erneut — auch beim zehnten Aufruf nicht", async () => {
      const { lies, aufrufe } = leser(SICHER);
      const latch = createRoleGateLatch(lies);

      for (let i = 0; i < 10; i += 1) {
        await expect(latch.sicherstellen()).resolves.toEqual({ ok: true });
      }
      expect(aufrufe()).toBe(1);
    });
  });

  describe("(c) einmal abgelehnt heisst dauerhaft abgelehnt", () => {
    it("liefert auch beim zehnten Aufruf ok:false", async () => {
      const { lies } = leser(new Error("Datenbank nicht erreichbar"));
      const latch = createRoleGateLatch(lies);

      for (let i = 0; i < 10; i += 1) {
        const ergebnis = await latch.sicherstellen();
        expect(ergebnis.ok).toBe(false);
      }
    });

    it("wiederholt die Pruefung nach einer Ablehnung nicht", async () => {
      const { lies, aufrufe } = leser(new Error("Datenbank nicht erreichbar"));
      const latch = createRoleGateLatch(lies);

      await latch.sicherstellen();
      await latch.sicherstellen();
      await latch.sicherstellen();
      expect(aufrufe()).toBe(1);
    });
  });

  describe("(d) N3 — kein laufendes Promise ueber Aufrufgrenzen", () => {
    it("haelt nach einem Aufruf ausschliesslich einfache Werte", async () => {
      const { lies } = leser(SICHER);
      const latch = createRoleGateLatch(lies);
      await latch.sicherstellen();

      const zustand = latch.zustandFuerTest();
      for (const wert of Object.values(zustand)) {
        expect(wert).not.toBeInstanceOf(Promise);
        expect(["string", "boolean", "undefined"]).toContain(typeof wert);
      }
    });
  });

  describe("(e) N4 — vor der Verifikation laeuft keine Fachquery", () => {
    it("laesst den Fachzaehler bei 0, solange das Gate nicht bestanden ist", async () => {
      const { lies } = leser(new Error("Datenbank nicht erreichbar"));
      const latch = createRoleGateLatch(lies);
      let fachaufrufe = 0;

      const ergebnis = await latch.sicherstellen();
      if (ergebnis.ok) {
        fachaufrufe += 1;
      }

      expect(ergebnis.ok).toBe(false);
      expect(fachaufrufe).toBe(0);
    });
  });

  describe("(f) Rot-Faelle des Gates, je einzeln — fail-closed", () => {
    const faelle: ReadonlyArray<readonly [string, RolePrivileges | Error]> = [
      ["Superuser", { ...SICHER, isSuperuser: true }],
      ["BYPASSRLS", { ...SICHER, bypassesRls: true }],
      ["INHERIT", { ...SICHER, inheritsPrivileges: true }],
      ["Leser wirft (unerreichbare DB)", new Error("connect ECONNREFUSED")],
    ];

    for (const [name, antwort] of faelle) {
      it(`lehnt ab: ${name}`, async () => {
        const { lies } = leser(antwort);
        const latch = createRoleGateLatch(lies);

        const ergebnis = await latch.sicherstellen();
        expect(ergebnis.ok).toBe(false);
        if (!ergebnis.ok) {
          expect(ergebnis.grund.length).toBeGreaterThan(0);
        }
      });
    }
  });
});
