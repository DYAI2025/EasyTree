import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { API_BASE_PATH } from "../src/common/api-base-path";
import { createApiApp, wireApiApp } from "../src/main";
import type { PgConnectionInput } from "../src/platform/database/pg-connection";
import type { RolePrivilegeReader } from "../src/platform/database/role-privileges";

/**
 * EYT-142 — die Naht zwischen Verdrahtung und Rollenpruefung.
 *
 * Der Cloudflare-Entry braucht die Verdrahtung im Modulscope, das Gate aber im
 * Requestscope. Gemessen in Spike A3: das Konstruieren des Providersatzes ist im
 * Modulscope erlaubt. Gemessen in Spike A4: ein I/O-Objekt darf die Requestgrenze
 * NICHT ueberleben ("Cannot perform I/O on behalf of a different request").
 * Deshalb wird hier die Verdrahtung von der Rollenpruefung getrennt — und nicht
 * etwa `setGlobalPrefix` & Co. im Entry dupliziert, was die zweite Baustelle
 * waere, die `createApiApp` laut eigenem Kommentar verhindern soll.
 *
 * GEGENMUTATIONEN — am 20.08.2026 EINGESPIELT, GEMESSEN und zurueckgenommen:
 *  1. `app.setGlobalPrefix(...)` aus `wireApiApp` entfernt -> Fall 1 rot
 *     (1 failed | 2 passed).
 *  2. `verifyDatabaseRole` zusaetzlich in `wireApiApp` aufgerufen -> alle drei rot
 *     (3 failed) — `wireApiApp` braucht dann eine Datenbank.
 *  3. Den try/catch-Block aus `createApiApp` entfernt -> Fall 3 rot mit
 *     `expected +0 to be 1`.
 *
 * Fall 1 war in der ersten Fassung VAKUOES und ist erst durch Mutation 1
 * aufgefallen: er verglich `/health` (200) und `/api/v1/health` (404), und beide
 * antworten MIT und OHNE Praefix gleich. Erst die Fachroute `planung/fenster`
 * unterscheidet. Wer diese Zusicherung wieder auf eine Betriebsschnittstelle
 * umstellt, macht den Test still wirkungslos.
 */
describe("wireApiApp trennt Verdrahtung von der Rollenpruefung (EYT-142)", () => {
  let app: INestApplication | null = null;

  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  /** Zaehlt, ob das Rollengate ueberhaupt angefasst wurde. */
  function zaehlenderLeser(): {
    aufrufe: () => number;
    leser: (verbindung: PgConnectionInput) => RolePrivilegeReader;
  } {
    let aufrufe = 0;
    return {
      aufrufe: () => aufrufe,
      leser: () => () => {
        aufrufe += 1;
        return Promise.resolve({
          role: "easytree_app",
          isSuperuser: false,
          bypassesRls: false,
          inheritsPrivileges: false,
        });
      },
    };
  }

  it("setzt denselben Basispfad wie der Produktionsstart", async () => {
    app = await wireApiApp();
    await app.init();

    // Die Zusicherung muss UNTERSCHEIDEN, nicht nur zutreffen. `/health` und
    // `/api/v1/health` antworten mit UND ohne Praefix gleich (200 bzw. 404) —
    // eine Zusicherung darauf bliebe gruen, wenn `setGlobalPrefix` verschwindet.
    // Eine FACHroute kippt dagegen: mit Praefix liegt sie unter `/api/v1/...`
    // und ist an der Wurzel weg, ohne Praefix genau umgekehrt.
    const mitPraefix = await request(app.getHttpServer()).get(`/${API_BASE_PATH}/planung/fenster`);
    expect(mitPraefix.status).not.toBe(404);

    const ohnePraefix = await request(app.getHttpServer()).get("/planung/fenster");
    expect(ohnePraefix.status).toBe(404);

    // health bleibt trotz Praefix unversioniert (das `exclude`).
    await request(app.getHttpServer()).get("/health").expect(200);
  });

  it("laeuft OHNE Datenbank durch — also ohne die Rollenpruefung", async () => {
    // Der Standardleser aus `createRolePrivilegeReader` oeffnet eine echte
    // Verbindung. Dass `wireApiApp()` ohne jede Datenbank aufloest, ist der
    // Nachweis, dass es das Gate nicht anfasst.
    app = await wireApiApp();
    await expect(app.init()).resolves.toBeDefined();
  });

  it("createApiApp ruft die Rollenpruefung weiterhin genau einmal auf", async () => {
    const { aufrufe, leser } = zaehlenderLeser();

    app = await createApiApp(leser);
    await app.init();

    expect(aufrufe()).toBe(1);
  });
});
