/**
 * `GET /kosten/planversionen` an der echten HTTP-Naht (EYT-144).
 *
 * ## Warum eine eigene Datei und nicht ein Anhang an `snapshot-http.test.ts`
 *
 * Jene Datei traegt im Kopf die Zusicherung „die beiden Snapshot-Routen" und
 * stellt `publishedVersions` im Faktenport ausdruecklich auf `reject` — genau
 * damit ein Rueckfall der Snapshot-Routen auf die Auswahlliste auffliegt. Diese
 * Zusicherung hier aufzuweichen hiesse, einen bestehenden Nachweis zu
 * schwaechen, um einen neuen unterzubringen. Umgekehrt gilt dasselbe: dieser
 * Port stellt `publishedFacts` und `publishedFactsForVersion` auf `reject`, weil
 * eine Auswahlliste NIE das Wochenfenster oder eine einzelne Version befragen
 * darf. Zwei Dateien, zwei gegenlaeufige Fallen.
 *
 * ## Was echt ist
 *
 * `AppModule`, `CostsController`, `MembershipCostAccessPolicy`, die
 * Korrelations-Middleware, `CostsProblemFilter`, `AuthProblemFilter` und der
 * globale `HttpExceptionFilter`. Gestellt sind nur die Adapter an den Raendern.
 * Damit misst diese Datei die VERDRAHTUNG (Recht, Organisationsbindung,
 * Eingabepruefung, Fehlerabbildung), nicht die Datenreise — die deckt
 * `planning-facts.adapter.test.ts` und in `db-gates` der Planungsleseweg ab.
 *
 * ## Gegenmutationen — eingespielt, gemessen, zurueckgenommen (13.08.2026)
 *
 * Jede Zeile nennt, was WIRKLICH rot wurde, nicht was rot werden sollte:
 *
 * - `"costs.read"` -> `"costs.calculate"` in der Zugangskette dieser Route:
 *   L4, L6 und L12 rot (3 von 13).
 * - Die GANZE Eingabepruefung samt `throw` VOR die Zugangskette ziehen: L5 rot
 *   (1 von 13). Ein Unberechtigter erfuehre dann an einem 400, dass sein
 *   Bereich verkehrt war.
 * - Die Eingabepruefung ersatzlos entfernen (`abfrage` als bereits gueltig
 *   behandeln): L7, L8 und L9 rot (3 von 13).
 * - Eine eigene Sortierung ueber `weekKey` einziehen: L3 rot (1 von 13).
 *
 * Und eine, die GRUEN blieb — sie steht hier, weil ihr Ausbleiben mehr sagt als
 * die drei Treffer: NUR die Zeile `safeParse(...)` nach oben zu ziehen und den
 * `throw` unten stehen zu lassen liess 13 von 13 gruen. Zu Recht — die
 * Reihenfolge, um die es geht, ist die des ABBRUCHS, nicht die der Auswertung.
 * Eine halbe Mutation misst die Selbstverteidigung des Codes, nicht die Regel.
 *
 * Nicht als Gegenmutation gefuehrt: `organisationHeader ?? zugang.organisationId`
 * statt `zugang.organisationId`. `MembershipCostAccessPolicy` gibt bei gesetztem
 * Header genau diesen Wert zurueck — auf dem Erfolgspfad sind beide Ausdruecke
 * derselbe, und ein Fall, der dabei rot wuerde, gaebe es nicht. Dieselbe
 * Feststellung steht in `snapshot-http.test.ts`.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { unsafeIdentifier } from "@easytree/domain";
import type { PlanVersionId } from "@easytree/domain";
import { SelectablePlanVersionsSchema } from "@easytree/contracts";

import { AppModule } from "../../src/app.module";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
import {
  COSTS_ERROR_TYPE,
  COST_ACCESS_AUDIT,
  COST_SNAPSHOT_REPOSITORY_FACTORY,
  PLAN_COST_FACTS_FACTORY,
  RATE_REPOSITORY_FACTORY,
  pseudonymSubjekt,
  type CostAccessAuditLog,
  type CostAccessDecisionEvent,
  type PlanCostFactsPort,
  type PublishedPlanVersionSummary,
  type PublishedVersionsListResult,
} from "../../src/modules/costs";
import { SESSION_ORGANISATIONS } from "../../src/modules/tenancy";
import { EMPLOYEE_DIRECTORY_FACTORY } from "../../src/modules/workforce";
import { IdentityRejectedError, REQUEST_IDENTITY } from "../../src/platform/auth/request-identity";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_ALPHA = "00000000-0000-4000-8000-00000000a001";
const ORG_BETA = "00000000-0000-4000-8000-00000000b001";
/** Eine Organisation, in der USER NICHT Mitglied ist. */
const ORG_FREMD = "00000000-0000-4000-8000-00000000c001";

/**
 * Je Organisation eine EIGENE Version — sonst saehe eine Liste aus der falschen
 * Organisation genauso aus wie die richtige, und L6 waere vakuos.
 */
const VERSION_ALPHA = unsafeIdentifier<PlanVersionId>("00000000-0000-4000-8000-0000000fa101");
const VERSION_ALPHA_ZWEI = unsafeIdentifier<PlanVersionId>("00000000-0000-4000-8000-0000000fa102");
const VERSION_BETA = unsafeIdentifier<PlanVersionId>("00000000-0000-4000-8000-0000000fb101");

const LISTE_ALPHA: readonly PublishedPlanVersionSummary[] = [
  {
    planVersionId: VERSION_ALPHA,
    weekKey: "2026-W32",
    publishedAt: new Date("2026-08-01T07:08:09.010Z"),
  },
  {
    planVersionId: VERSION_ALPHA_ZWEI,
    weekKey: "2026-W33",
    publishedAt: new Date("2026-08-08T11:12:13.140Z"),
  },
];

const LISTE_BETA: readonly PublishedPlanVersionSummary[] = [
  {
    planVersionId: VERSION_BETA,
    weekKey: "2026-W32",
    publishedAt: new Date("2026-08-02T01:02:03.040Z"),
  },
];

// Bewusst NICHT JWT-foermig — eine Markierung, kein echt aussehendes Token.
const TOKEN = ["kein", "echtes", "token", "nur", "markierung"].join("-");
const COOKIE = `easytree_access=${TOKEN}`;
const ORGANISATION_HEADER = "x-easytree-organization-id";

class Sammler implements CostAccessAuditLog {
  readonly ereignisse: CostAccessDecisionEvent[] = [];
  record(event: CostAccessDecisionEvent): void {
    this.ereignisse.push(event);
  }
}

interface Aufbau {
  readonly mitgliedschaften?: readonly {
    organisationId: string;
    permissions: readonly string[];
  }[];
  readonly unauthentifiziert?: boolean;
  /** Antwort der Auswahlliste fuer ORG_ALPHA. */
  readonly alphaErgebnis?: PublishedVersionsListResult;
}

interface Zeugen {
  /** Je Aufruf der Faktenfabrik Subjekt und Organisation — daran haengt L6. */
  readonly fabrikaufrufe: { subject: string; organisation: string }[];
  /** Je Aufruf der Auswahlliste der WIRKLICH uebergebene Bereich. */
  readonly bereiche: { von: string; bis: string }[];
  readonly sammler: Sammler;
}

interface Gestartet {
  readonly app: INestApplication;
  readonly zeugen: Zeugen;
}

/**
 * Ein Faktenport, der AUSSCHLIESSLICH die Auswahlliste beantwortet.
 *
 * Die beiden anderen Methoden werfen. Griffe die Route auf das Wochenfenster
 * oder auf eine einzelne Version zurueck — beides liefert auch Entwuerfe
 * beziehungsweise verlangt eine Version —, wuerde der Fall rot statt still eine
 * plausible Liste zu zeigen.
 */
function faktenPort(
  ergebnis: PublishedVersionsListResult,
  aufzeichnen: (von: string, bis: string) => void,
): PlanCostFactsPort {
  return {
    publishedFacts: () =>
      Promise.reject(new Error("die Auswahlliste darf das Wochenfenster nicht befragen")),
    publishedFactsForVersion: () =>
      Promise.reject(new Error("die Auswahlliste darf keine einzelne Version befragen")),
    publishedVersions: (fromWeekKey, toWeekKey) => {
      aufzeichnen(fromWeekKey, toWeekKey);
      return Promise.resolve(ergebnis);
    },
  };
}

async function starte(aufbau: Aufbau = {}): Promise<Gestartet> {
  const mitgliedschaften = aufbau.mitgliedschaften ?? [
    { organisationId: ORG_ALPHA, permissions: ["costs.read", "costs.calculate"] },
  ];
  const zeugen: Zeugen = { fabrikaufrufe: [], bereiche: [], sammler: new Sammler() };
  const aufzeichnen = (von: string, bis: string): void => {
    zeugen.bereiche.push({ von, bis });
  };

  const portAlpha = faktenPort(
    aufbau.alphaErgebnis ?? { ok: true, versions: LISTE_ALPHA },
    aufzeichnen,
  );
  const portBeta = faktenPort({ ok: true, versions: LISTE_BETA }, aufzeichnen);

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
    .overrideProvider(EMPLOYEE_DIRECTORY_FACTORY)
    .useValue(() => ({ list: () => Promise.resolve([]) }))
    .overrideProvider(RATE_REPOSITORY_FACTORY)
    .useValue(() => ({
      versionsFor: () => Promise.resolve([]),
      versionsForMany: () => Promise.resolve(new Map()),
      append: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
    }))
    .overrideProvider(PLAN_COST_FACTS_FACTORY)
    .useValue((subjectUserId: string, organisationId: string) => {
      zeugen.fabrikaufrufe.push({ subject: subjectUserId, organisation: organisationId });
      // Die BETA-Liste haengt an der Organisation, nicht an einer Weiche im
      // Test: wird die Fabrik mit der falschen Id gerufen, kommt die falsche
      // Liste heraus und der Fall faellt auf.
      return organisationId === ORG_BETA ? portBeta : portAlpha;
    })
    .overrideProvider(COST_SNAPSHOT_REPOSITORY_FACTORY)
    .useValue(() => ({
      create: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
      read: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
    }))
    .overrideProvider(COST_ACCESS_AUDIT)
    .useValue(zeugen.sammler)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix(API_BASE_PATH);
  await app.init();
  return { app, zeugen };
}

let gestartet: Gestartet | null = null;

afterEach(async () => {
  if (gestartet !== null) {
    await gestartet.app.close();
    gestartet = null;
  }
});

interface GetOptionen {
  readonly abfrage?: string;
  readonly organisation?: string;
  readonly ohneCookie?: boolean;
}

function getVersionen(app: INestApplication, optionen: GetOptionen = {}) {
  const abfrage = optionen.abfrage ?? "fromWeekKey=2026-W32&toWeekKey=2026-W33";
  let anfrage = request(app.getHttpServer()).get(
    `/${API_BASE_PATH}/kosten/planversionen?${abfrage}`,
  );
  if (optionen.ohneCookie !== true) anfrage = anfrage.set("cookie", COOKIE);
  if (optionen.organisation !== undefined) {
    anfrage = anfrage.set(ORGANISATION_HEADER, optionen.organisation);
  }
  return anfrage;
}

function typVon(antwortkoerper: unknown): unknown {
  return (antwortkoerper as { type?: unknown }).type;
}

function detailVon(antwortkoerper: unknown): unknown {
  return (antwortkoerper as { detail?: unknown }).detail;
}

/**
 * Der Ablehnungstext der Zugangskette, WOERTLICH.
 *
 * Als Literal und nicht aus der Produktionskonstante importiert: die Aussage
 * ist, dass „kein Recht" (L4) und „fremde Organisation" (L6b) DENSELBEN Satz
 * bekommen. Ein importierter Text waere in beiden Faellen gleich, egal was der
 * Controller tut, und bewiese die Ununterscheidbarkeit nicht.
 *
 * Diese beiden Faelle tragen KEINEN URN, sondern `about:blank` — sie werden als
 * `ForbiddenException` geworfen und landen im globalen `HttpExceptionFilter`.
 * Das ist der Stand der GANZEN Kostenoberflaeche seit EYT-106 und wird hier
 * festgehalten statt fuer diese eine Route abweichend repariert; eine eigene
 * URN-Fuehrung fuer 401/403 ist eine Vertragsentscheidung, keine Beifuegung
 * eines Slices.
 */
const ZUGANG_ABLEHNUNG = "Kein Zugriff auf die Kostendaten dieser Organisation.";

describe("GET /kosten/planversionen — die Auswahlliste von /kosten (EYT-144)", () => {
  it("L1 antwortet mit den veroeffentlichten Versionen des Bereichs", async () => {
    gestartet = await starte();
    const antwort = await getVersionen(gestartet.app).expect(200);

    // Die Antwort muss den VERTRAG erfuellen, nicht nur „irgendein JSON" sein.
    const geprueft = SelectablePlanVersionsSchema.safeParse(antwort.body);
    expect(geprueft.success, JSON.stringify(antwort.body)).toBe(true);

    // Ausgeschrieben statt aus `LISTE_ALPHA` gebaut: eine Abbildung, die ihre
    // eigene Quelle als Erwartung benutzt, vergleicht sich mit sich selbst.
    expect(antwort.body).toEqual({
      versions: [
        {
          id: "00000000-0000-4000-8000-0000000fa101",
          weekKey: "2026-W32",
          publishedAt: "2026-08-01T07:08:09.010Z",
        },
        {
          id: "00000000-0000-4000-8000-0000000fa102",
          weekKey: "2026-W33",
          publishedAt: "2026-08-08T11:12:13.140Z",
        },
      ],
    });
  });

  it("L2 reicht den Bereich unveraendert an den Port weiter", async () => {
    gestartet = await starte();
    await getVersionen(gestartet.app, {
      abfrage: "fromWeekKey=2026-W02&toWeekKey=2026-W50",
    }).expect(200);
    // Ohne diesen Zeugen koennte die Route einen festen Bereich senden und der
    // Statuscode bliebe 200.
    expect(gestartet.zeugen.bereiche).toEqual([{ von: "2026-W02", bis: "2026-W50" }]);
  });

  it("L3 laesst die Reihenfolge der Planung unangetastet", async () => {
    // Absichtlich absteigend: eine Route, die selbst sortiert, dreht das um.
    gestartet = await starte({
      alphaErgebnis: {
        ok: true,
        versions: [
          { ...LISTE_ALPHA[1]! },
          { ...LISTE_ALPHA[0]! },
        ] as readonly PublishedPlanVersionSummary[],
      },
    });
    const antwort = await getVersionen(gestartet.app).expect(200);
    expect((antwort.body as { versions: { weekKey: string }[] }).versions.map((v) => v.weekKey)) //
      .toEqual(["2026-W33", "2026-W32"]);
  });

  it("L4 verlangt costs.read — costs.calculate allein genuegt nicht", async () => {
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.calculate"] }],
    });
    const antwort = await getVersionen(gestartet.app).expect(403);
    expect(detailVon(antwort.body)).toBe(ZUGANG_ABLEHNUNG);
    // Und die Faktenfabrik lief GAR NICHT: die Ablehnung faellt vor jeder
    // fachlichen Arbeit.
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    expect(gestartet.zeugen.bereiche).toEqual([]);
  });

  it("L5 lehnt VOR der Eingabepruefung ab, wenn das Recht fehlt", async () => {
    // Kaputter Bereich UND fehlendes Recht. Antwortete die Route hier 400,
    // erfuehre ein Unberechtigter etwas ueber seine Eingabe — und die
    // Zugangskette liefe erst danach.
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: [] }],
    });
    await getVersionen(gestartet.app, {
      abfrage: "fromWeekKey=2026-W33&toWeekKey=2026-W32",
    }).expect(403);
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
  });

  it("L6 bindet die Organisation an die Zugangsentscheidung, nicht an den Header", async () => {
    gestartet = await starte({
      mitgliedschaften: [
        { organisationId: ORG_ALPHA, permissions: ["costs.read"] },
        { organisationId: ORG_BETA, permissions: ["costs.read"] },
      ],
    });
    const antwort = await getVersionen(gestartet.app, { organisation: ORG_BETA }).expect(200);

    expect(gestartet.zeugen.fabrikaufrufe).toEqual([{ subject: USER, organisation: ORG_BETA }]);
    // Und die Antwort traegt BETAs Version, nicht ALPHAs.
    expect((antwort.body as { versions: { id: string }[] }).versions.map((v) => v.id)).toEqual([
      "00000000-0000-4000-8000-0000000fb101",
    ]);
  });

  it("L6b laesst einen fremden Mandanten nicht durch", async () => {
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.read"] }],
    });
    const antwort = await getVersionen(gestartet.app, { organisation: ORG_FREMD }).expect(403);
    // WOERTLICH dieselbe Antwort wie bei fehlendem Recht (L4) — kein
    // Existenzleck: von aussen ist „gibt es nicht" nicht von „du gehoerst nicht
    // dazu" zu unterscheiden.
    expect(detailVon(antwort.body)).toBe(ZUGANG_ABLEHNUNG);
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    // Und nichts aus ALPHA reist mit.
    expect(JSON.stringify(antwort.body)).not.toContain("0000000fa101");
  });

  it("L7 lehnt einen verkehrten Wochenbereich ab", async () => {
    gestartet = await starte();
    await getVersionen(gestartet.app, {
      abfrage: "fromWeekKey=2026-W33&toWeekKey=2026-W32",
    }).expect(400);
    expect(gestartet.zeugen.bereiche).toEqual([]);
  });

  it("L8 lehnt einen ungueltigen Wochenschluessel ab", async () => {
    gestartet = await starte();
    await getVersionen(gestartet.app, {
      abfrage: "fromWeekKey=2026-W54&toWeekKey=2026-W54",
    }).expect(400);
    await getVersionen(gestartet.app, { abfrage: "fromWeekKey=2026-W32" }).expect(400);
    await getVersionen(gestartet.app, { abfrage: "" }).expect(400);
    expect(gestartet.zeugen.bereiche).toEqual([]);
  });

  it("L9 lehnt einen doppelt angegebenen Parameter ab", async () => {
    // `?fromWeekKey=a&fromWeekKey=b` ist keine Woche, sondern eine mehrdeutige
    // Angabe. Express macht daraus ein Array; ohne Pruefung stuende hier
    // stillschweigend der erste oder letzte Wert.
    gestartet = await starte();
    await getVersionen(gestartet.app, {
      abfrage: "fromWeekKey=2026-W32&fromWeekKey=2026-W40&toWeekKey=2026-W41",
    }).expect(400);
    expect(gestartet.zeugen.bereiche).toEqual([]);
  });

  it("L10 bildet die Ablehnungen der Liste auf 400 mit stabilem URN ab", async () => {
    gestartet = await starte({ alphaErgebnis: { ok: false, problem: "NO_ORGANISATION" } });
    const ohne = await getVersionen(gestartet.app).expect(400);
    expect(typVon(ohne.body)).toBe(COSTS_ERROR_TYPE.NO_ORGANISATION);
    await gestartet.app.close();

    gestartet = await starte({ alphaErgebnis: { ok: false, problem: "AMBIGUOUS_ORGANISATION" } });
    const mehrdeutig = await getVersionen(gestartet.app).expect(400);
    expect(typVon(mehrdeutig.body)).toBe(COSTS_ERROR_TYPE.AMBIGUOUS_ORGANISATION);
  });

  it("L11 lehnt ohne Anmeldung ab", async () => {
    gestartet = await starte({ unauthentifiziert: true });
    await getVersionen(gestartet.app, { ohneCookie: true }).expect(401);
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
  });

  it("L12 protokolliert die Entscheidung mit Route und Recht", async () => {
    gestartet = await starte();
    await getVersionen(gestartet.app).expect(200);

    const ereignisse = gestartet.zeugen.sammler.ereignisse;
    expect(ereignisse).toHaveLength(1);
    expect(ereignisse[0]).toMatchObject({
      decision: "allow",
      permission: "costs.read",
      route: "GET /kosten/planversionen",
      organisationId: ORG_ALPHA,
      subject: pseudonymSubjekt(USER),
      reason: null,
    });
  });
});
