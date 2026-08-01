/**
 * Zugriffsentscheidungen sind an der echten HTTP-Naht nachvollziehbar
 * (EYT-106 AK9, EYT-135).
 *
 * ## Warum ohne Datenbank
 *
 * Geprueft wird die ENTSCHEIDUNG und ihr Protokoll, nicht die Datenreise.
 * Repository und Mitarbeiterverzeichnis sind deshalb gestellt; Controller,
 * Policy, Korrelations-Middleware, Exception-Filter und Serialisierung sind
 * die echten. Damit laeuft diese Datei im Pflichtjob `unit-tests` — die
 * Datenreise selbst deckt `rate-http-contract.integration.test.ts` in
 * `db-gates` ab.
 *
 * ## Die vier Entscheidungen, die es geben kann
 *
 * `allow`, und drei Ablehnungen. Dazu `UNAUTHENTICATED`: eine Anfrage ohne
 * gueltige Identitaet erreicht die Policy nie, ist aber sehr wohl eine
 * Zugriffsentscheidung ueber eine Kostenressource — und genau die Zeile, die
 * man bei einem Angriff sehen will.
 *
 * ## Gegenmutationen, die diese Datei rot machen
 *
 * - Das `record(...)` im Controller entfernen (kein Ereignis).
 * - Die Korrelations-Id im Ereignis durch einen neuen Wert ersetzen
 *   (Ereignis und Problem-Dokument fielen auseinander).
 * - Den `try`/`catch` um `record(...)` entfernen (ein werfender Logger
 *   verwandelte 200 in 500 und entschiede damit doch).
 * - Die rohe `userId` statt des Pseudonyms schreiben.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
import {
  COST_ACCESS_AUDIT,
  RATE_REPOSITORY_FACTORY,
  pseudonymSubjekt,
  serialisiereZugriffsereignis,
  type CostAccessAuditLog,
  type CostAccessDecisionEvent,
} from "../../src/modules/costs";
import { SESSION_ORGANISATIONS } from "../../src/modules/tenancy";
import { EMPLOYEE_DIRECTORY_FACTORY } from "../../src/modules/workforce";
import { IdentityRejectedError, REQUEST_IDENTITY } from "../../src/platform/auth/request-identity";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_ALPHA = "00000000-0000-4000-8000-00000000a001";
const ORG_FREMD = "00000000-0000-4000-8000-00000000f001";
const EMPLOYEE = "00000000-0000-4000-8000-0000004010a1";

/** Werte, die in KEINER Auditzeile auftauchen duerfen. */
const MITARBEITERNAME = "Demo-Mitarbeiter 01";
const STUNDENSATZ = "3850";
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.streng-geheimes-token.signatur";
const COOKIE = `easytree_access=${TOKEN}`;

class Sammler implements CostAccessAuditLog {
  readonly ereignisse: CostAccessDecisionEvent[] = [];
  record(event: CostAccessDecisionEvent): void {
    this.ereignisse.push(event);
  }
}

class WerfenderLogger implements CostAccessAuditLog {
  record(): void {
    throw new Error("Auditsenke nicht erreichbar");
  }
}

interface Aufbau {
  readonly audit?: CostAccessAuditLog;
  /** Mitgliedschaften des Subjekts; leer bedeutet "nirgends Mitglied". */
  readonly mitgliedschaften?: readonly {
    organisationId: string;
    permissions: readonly string[];
  }[];
  /** Wenn gesetzt, scheitert die Identifikation. */
  readonly unauthentifiziert?: boolean;
}

async function starte(aufbau: Aufbau): Promise<INestApplication> {
  const mitgliedschaften = aufbau.mitgliedschaften ?? [
    { organisationId: ORG_ALPHA, permissions: ["costs.read", "costs.manage_rates"] },
  ];

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_PING)
    .useValue({ ping: () => Promise.resolve(true) } satisfies DatabasePing)
    .overrideProvider(REQUEST_IDENTITY)
    .useValue({
      identify: () =>
        aufbau.unauthentifiziert === true
          ? Promise.reject(new IdentityRejectedError("MISSING"))
          : Promise.resolve({ userId: USER, sessionId: "sitzung-1" }),
    })
    .overrideProvider(SESSION_ORGANISATIONS)
    .useValue({
      organisationsFor: () =>
        Promise.resolve(
          mitgliedschaften.map((m) => ({
            organisationId: m.organisationId,
            organisationName: "Org",
            role: "owner" as const,
            permissions: m.permissions,
          })),
        ),
    })
    // Gestellt, weil diese Datei die Entscheidung prueft, nicht die Datenreise.
    .overrideProvider(EMPLOYEE_DIRECTORY_FACTORY)
    .useValue(() => ({
      list: () => Promise.resolve([{ id: EMPLOYEE, displayName: MITARBEITERNAME, active: true }]),
    }))
    .overrideProvider(RATE_REPOSITORY_FACTORY)
    .useValue(() => ({
      versionsFor: () =>
        Promise.resolve([
          {
            id: "00000000-0000-4000-8000-0000006ca009",
            employeeId: EMPLOYEE,
            amountMinorUnits: STUNDENSATZ,
            validFrom: "2026-01-01",
            validTo: null,
            predecessorId: null,
            reason: "Auditpruefung",
            createdAt: "2026-08-01T10:00:00.000Z",
            createdBy: USER,
          },
        ]),
      append: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
    }))
    .overrideProvider(COST_ACCESS_AUDIT)
    .useValue(aufbau.audit ?? new Sammler())
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix(API_BASE_PATH);
  await app.init();
  return app;
}

let app: INestApplication | null = null;

afterEach(async () => {
  if (app !== null) {
    await app.close();
    app = null;
  }
});

describe("Erlaubter Kostenzugriff wird protokolliert (EYT-106 AK9)", () => {
  let sammler: Sammler;

  beforeEach(async () => {
    sammler = new Sammler();
    app = await starte({ audit: sammler });
  });

  it("schreibt genau ein allow-Ereignis mit der Korrelations-Id der Antwort", async () => {
    const antwort = await request(app!.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .expect(200);

    expect(sammler.ereignisse).toHaveLength(1);
    const ereignis = sammler.ereignisse[0] as CostAccessDecisionEvent;
    expect(ereignis.event).toBe("cost_access_decision");
    expect(ereignis.decision).toBe("allow");
    expect(ereignis.permission).toBe("costs.read");
    expect(ereignis.organisationId).toBe(ORG_ALPHA);
    expect(ereignis.reason).toBeNull();
    expect(ereignis.route).toBe("GET /kosten/mitarbeiter");
    // Die Bruecke zwischen Log und Antwort — ohne sie ist das Ereignis
    // nicht nachvollziehbar, sondern nur vorhanden.
    expect(ereignis.correlationId).toBe(antwort.headers["x-correlation-id"]);
  });

  it("uebernimmt eine mitgebrachte Korrelations-Id", async () => {
    const mitgebracht = "8d0d1f2e-2b7c-4c1a-9a0e-11aa22bb33cc";
    await request(app!.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .set("x-correlation-id", mitgebracht)
      .expect(200);

    expect((sammler.ereignisse[0] as CostAccessDecisionEvent).correlationId).toBe(mitgebracht);
  });

  it("nennt das Subjekt nur pseudonym", async () => {
    await request(app!.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .expect(200);

    const ereignis = sammler.ereignisse[0] as CostAccessDecisionEvent;
    expect(ereignis.subject).toBe(pseudonymSubjekt(USER));
    expect(ereignis.subject).not.toBe(USER);
  });

  it("traegt in der Logzeile weder Token noch Cookie, Name oder Betrag", async () => {
    // Die Satzhistorie, weil hier Name UND Betrag durch dieselbe Anfrage
    // fliessen — eine Zeile, die beides nicht enthaelt, beweist mehr als
    // eine Anfrage, die sie nie gesehen hat.
    await request(app!.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/stundensaetze/${EMPLOYEE}`)
      .set("cookie", COOKIE)
      .set("authorization", `Bearer ${TOKEN}`)
      .expect(200);

    const zeile = serialisiereZugriffsereignis(sammler.ereignisse[0] as CostAccessDecisionEvent);
    expect(zeile).not.toContain(TOKEN);
    expect(zeile).not.toContain("easytree_access");
    expect(zeile).not.toContain(MITARBEITERNAME);
    expect(zeile).not.toContain(STUNDENSATZ);
    expect(zeile).not.toContain(USER);
    expect(zeile).not.toContain("Bearer");
  });

  it("nennt fuer das Anlegen ein anderes Recht als fuer das Lesen", async () => {
    await request(app!.getHttpServer())
      .post(`/${API_BASE_PATH}/kosten/stundensaetze`)
      .set("cookie", COOKIE)
      .send({ employeeId: EMPLOYEE });

    expect((sammler.ereignisse[0] as CostAccessDecisionEvent).permission).toBe(
      "costs.manage_rates",
    );
  });
});

describe("Jede Ablehnung hinterlaesst ihren stabilen Grund (EYT-106 AK9)", () => {
  it("ORG_CONTEXT_REQUIRED bei mehreren Organisationen ohne Auswahl", async () => {
    const sammler = new Sammler();
    app = await starte({
      audit: sammler,
      mitgliedschaften: [
        { organisationId: ORG_ALPHA, permissions: ["costs.read"] },
        { organisationId: ORG_FREMD, permissions: ["costs.read"] },
      ],
    });

    const antwort = await request(app.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .expect(400);

    const ereignis = sammler.ereignisse[0] as CostAccessDecisionEvent;
    expect(ereignis.decision).toBe("deny");
    expect(ereignis.reason).toBe("ORG_CONTEXT_REQUIRED");
    // Keine Organisation bestaetigt — also auch keine im Protokoll.
    expect(ereignis.organisationId).toBeNull();
    expect(ereignis.correlationId).toBe((antwort.body as { correlationId: string }).correlationId);
  });

  it("ORG_NOT_A_MEMBER bei einem fremden Organisationsheader", async () => {
    const sammler = new Sammler();
    app = await starte({ audit: sammler });

    const antwort = await request(app.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .set("x-easytree-organization-id", ORG_FREMD)
      .expect(403);

    const ereignis = sammler.ereignisse[0] as CostAccessDecisionEvent;
    expect(ereignis.decision).toBe("deny");
    expect(ereignis.reason).toBe("ORG_NOT_A_MEMBER");
    // Der unbestaetigte Header darf NICHT als Organisation protokolliert
    // werden — sonst stuende im Audit eine Zugehoerigkeit, die es nicht gibt.
    expect(ereignis.organisationId).toBeNull();
    expect(antwort.body).not.toHaveProperty("organisationId");
  });

  it("PERMISSION_MISSING bei fehlendem atomarem Recht", async () => {
    const sammler = new Sammler();
    app = await starte({
      audit: sammler,
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: [] }],
    });

    await request(app.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .expect(403);

    const ereignis = sammler.ereignisse[0] as CostAccessDecisionEvent;
    expect(ereignis.decision).toBe("deny");
    expect(ereignis.reason).toBe("PERMISSION_MISSING");
    // Hier IST die Organisation bestaetigt: das Subjekt ist Mitglied, ihm
    // fehlt nur das Recht. Genau diese Unterscheidung macht das Audit
    // auswertbar.
    expect(ereignis.organisationId).toBe(ORG_ALPHA);
    expect(ereignis.subject).toBe(pseudonymSubjekt(USER));
  });

  it("UNAUTHENTICATED ohne Identitaet — ohne Subjekt und ohne Organisation", async () => {
    const sammler = new Sammler();
    app = await starte({ audit: sammler, unauthentifiziert: true });

    const antwort = await request(app.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .expect(401);

    const ereignis = sammler.ereignisse[0] as CostAccessDecisionEvent;
    expect(ereignis.decision).toBe("deny");
    expect(ereignis.reason).toBe("UNAUTHENTICATED");
    expect(ereignis.subject).toBeNull();
    expect(ereignis.organisationId).toBeNull();
    expect(ereignis.correlationId).toBe(antwort.headers["x-correlation-id"]);
  });
});

describe("Das Protokoll entscheidet nichts (EYT-106 AK9)", () => {
  it("ein werfender Logger laesst den erlaubten Zugriff erlaubt", async () => {
    app = await starte({ audit: new WerfenderLogger() });

    await request(app.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .expect(200);
  });

  it("ein werfender Logger laesst die Ablehnung eine Ablehnung bleiben", async () => {
    app = await starte({
      audit: new WerfenderLogger(),
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: [] }],
    });

    // Nicht 500: eine kaputte Auditsenke darf weder oeffnen noch die
    // Fehlerklasse verfaelschen.
    await request(app.getHttpServer())
      .get(`/${API_BASE_PATH}/kosten/mitarbeiter`)
      .set("cookie", COOKIE)
      .expect(403);
  });
});
