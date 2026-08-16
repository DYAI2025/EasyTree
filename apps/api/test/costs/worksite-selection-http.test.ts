/**
 * `GET /kosten/planversionen/{planVersionId}/baustellen` an der echten
 * HTTP-Naht (EYT-146).
 *
 * ## Warum eine eigene Datei
 *
 * Dieselbe Begruendung wie bei `plan-versions-http.test.ts`: jene Datei stellt
 * `publishedFactsForVersion` ausdruecklich auf `reject`, damit ein Rueckfall der
 * Auswahlliste auf eine einzelne Version auffliegt. Hier ist es genau umgekehrt
 * — `publishedFacts` (Wochenfenster) und `publishedVersions` (Auswahlliste)
 * werfen, weil eine Baustellenauswahl NIE das Wochenfenster befragen darf: das
 * liefert bevorzugt den ENTWURF, und eine Auswahl daraus boete Baustellen an,
 * auf die die veroeffentlichte Version gar nichts legt. Drei Dateien, drei
 * gegenlaeufige Fallen.
 *
 * ## Was echt ist
 *
 * `AppModule`, `CostsController`, `MembershipCostAccessPolicy`, die
 * Korrelations-Middleware, `CostsProblemFilter`, `AuthProblemFilter` und der
 * globale `HttpExceptionFilter`. Gestellt sind nur die Adapter an den Raendern.
 * Gemessen wird die VERDRAHTUNG (Recht, Organisationsbindung, Eingabepruefung,
 * Ableitung, Reihenfolge, Fehlerabbildung), nicht die Datenreise.
 *
 * ## Die Reihenfolge ist eine Zusicherung, kein Zufall
 *
 * `W2` waere wertlos, wenn die Fixtur so gebaut waere, dass jede beliebige
 * Ordnung dasselbe Ergebnis liefert. Deshalb widersprechen sich in ihr DREI
 * Ordnungen absichtlich: die Reihenfolge in `work`, die der Ids und die der
 * Bezeichnungen. Nur die Regel „Bezeichnung aufsteigend, dann Id" erzeugt das
 * erwartete Ergebnis; sowohl ein weggelassenes `sort()` (dann gilt
 * `work`-Reihenfolge) als auch ein Sortieren nach Id faellt auf.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { unsafeIdentifier } from "@easytree/domain";
import type { AssignmentId, EmployeeId, PlanVersionId, WorksiteId } from "@easytree/domain";
import { SelectableWorksitesSchema } from "@easytree/contracts";

import { AppModule } from "../../src/app.module";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
import {
  COSTS_ERROR_TYPE,
  COST_ACCESS_AUDIT,
  COST_SNAPSHOT_REPOSITORY_FACTORY,
  PLAN_COST_FACTS_FACTORY,
  RATE_REPOSITORY_FACTORY,
  SNAPSHOT_ASSEMBLY_ERROR_TYPE,
  pseudonymSubjekt,
  type CostAccessAuditLog,
  type CostAccessDecisionEvent,
  type PlanCostFactsPort,
  type PlanCostFactsResult,
  type PlannedWorkFact,
  type PublishedPlanFacts,
} from "../../src/modules/costs";
import { SESSION_ORGANISATIONS } from "../../src/modules/tenancy";
import { EMPLOYEE_DIRECTORY_FACTORY } from "../../src/modules/workforce";
import { IdentityRejectedError, REQUEST_IDENTITY } from "../../src/platform/auth/request-identity";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_ALPHA = "00000000-0000-4000-8000-00000000a001";
const ORG_BETA = "00000000-0000-4000-8000-00000000b001";
/** Eine Organisation, in der USER NICHT Mitglied ist. */
const ORG_FREMD = "00000000-0000-4000-8000-00000000c001";

const VERSION_ALPHA = "00000000-0000-4000-8000-0000000fa101";
const VERSION_BETA = "00000000-0000-4000-8000-0000000fb101";

/**
 * Drei Baustellen, deren Id-Reihenfolge der Bezeichnungsreihenfolge
 * WIDERSPRICHT.
 *
 * Nach Bezeichnung: Alpha, Bravo, Charlie. Nach Id: Charlie (e001), Bravo
 * (e002), Alpha (e003) — also genau umgekehrt. Eine Sortierung nach Id kann das
 * erwartete Ergebnis deshalb nicht zufaellig treffen.
 */
const BAUSTELLE_ALPHA = "00000000-0000-4000-8000-00000000e003";
const BAUSTELLE_BRAVO = "00000000-0000-4000-8000-00000000e002";
const BAUSTELLE_CHARLIE = "00000000-0000-4000-8000-00000000e001";
/** Zwei Baustellen mit DERSELBEN Bezeichnung — der Tiebreak ist erreichbar. */
const BAUSTELLE_DOPPELT_SPAET = "00000000-0000-4000-8000-00000000e009";
const BAUSTELLE_DOPPELT_FRUEH = "00000000-0000-4000-8000-00000000e004";
/** Steht in den Bezeichnungen, aber auf ihr liegt KEIN Einsatz. */
const BAUSTELLE_UNBENUTZT = "00000000-0000-4000-8000-00000000e00f";

const MITARBEITER = "00000000-0000-4000-8000-00000000d001";

let laufendeNummer = 0;

/** Ein veroeffentlichter Einsatz auf einer Baustelle. Zeiten spielen hier keine Rolle. */
function einsatz(worksiteId: string): PlannedWorkFact {
  laufendeNummer += 1;
  return {
    assignmentId: unsafeIdentifier<AssignmentId>(
      `00000000-0000-4000-8000-0000000c${String(laufendeNummer).padStart(4, "0")}`,
    ),
    employeeId: unsafeIdentifier<EmployeeId>(MITARBEITER),
    worksiteId: unsafeIdentifier<WorksiteId>(worksiteId),
    startsAtUtc: new Date("2026-08-03T06:00:00Z"),
    endsAtUtc: new Date("2026-08-03T14:00:00Z"),
  };
}

function fakten(
  planVersionId: string,
  worksiteIds: readonly string[],
  labels: ReadonlyMap<string, string>,
): PublishedPlanFacts {
  return {
    planVersionId: unsafeIdentifier<PlanVersionId>(planVersionId),
    weekKey: "2026-W32",
    timeZone: "Europe/Berlin",
    publishedAt: new Date("2026-08-01T07:08:09.010Z"),
    work: worksiteIds.map(einsatz),
    employeeLabels: new Map([[MITARBEITER, "Mira Baumgart"]]),
    worksiteLabels: labels,
  };
}

/**
 * Die Fixtur von ALPHA — drei Baustellen, eine davon doppelt belegt.
 *
 * `work` nennt Charlie, Alpha, Bravo, Charlie: die Eingabereihenfolge
 * widerspricht sowohl der Bezeichnungs- als auch der Id-Ordnung, und Charlie
 * steht zweimal darin, damit die Entdopplung nicht vakuos ist.
 * `BAUSTELLE_UNBENUTZT` steht ausschliesslich in den Bezeichnungen.
 */
const FAKTEN_ALPHA = fakten(
  VERSION_ALPHA,
  [BAUSTELLE_CHARLIE, BAUSTELLE_ALPHA, BAUSTELLE_BRAVO, BAUSTELLE_CHARLIE],
  new Map([
    [BAUSTELLE_ALPHA, "Alpha Baustelle"],
    [BAUSTELLE_BRAVO, "Bravo Baustelle"],
    [BAUSTELLE_CHARLIE, "Charlie Baustelle"],
    [BAUSTELLE_UNBENUTZT, "Unbenutzte Baustelle"],
  ]),
);

const FAKTEN_BETA = fakten(
  VERSION_BETA,
  [BAUSTELLE_DOPPELT_FRUEH],
  new Map([[BAUSTELLE_DOPPELT_FRUEH, "Baustelle des anderen Mandanten"]]),
);

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
  /** Antwort des Faktenports fuer ORG_ALPHA. */
  readonly alphaErgebnis?: PlanCostFactsResult;
}

interface Zeugen {
  /** Je Aufruf der Faktenfabrik Subjekt und Organisation — daran haengt W6. */
  readonly fabrikaufrufe: { subject: string; organisation: string }[];
  /** Je Aufruf die WIRKLICH uebergebene Planversions-Id — daran haengt W7. */
  readonly versionen: string[];
  readonly sammler: Sammler;
}

interface Gestartet {
  readonly app: INestApplication;
  readonly zeugen: Zeugen;
}

/**
 * Ein Faktenport, der AUSSCHLIESSLICH die versionsgenaue Lesung beantwortet.
 *
 * Die beiden anderen Methoden werfen. Griffe die Route auf das Wochenfenster
 * zurueck, boete sie Baustellen aus dem ENTWURF an; griffe sie auf die
 * Auswahlliste zurueck, kaeme ueberhaupt keine Baustelle heraus. Beides wuerde
 * hier laut scheitern statt still eine plausible Liste zu zeigen.
 */
function faktenPort(
  ergebnis: PlanCostFactsResult,
  aufzeichnen: (planVersionId: string) => void,
): PlanCostFactsPort {
  return {
    publishedFacts: () =>
      Promise.reject(new Error("die Baustellenauswahl darf das Wochenfenster nicht befragen")),
    publishedVersions: () =>
      Promise.reject(new Error("die Baustellenauswahl darf nicht die Auswahlliste befragen")),
    publishedFactsForVersion: (planVersionId) => {
      aufzeichnen(planVersionId);
      return Promise.resolve(ergebnis);
    },
  };
}

async function starte(aufbau: Aufbau = {}): Promise<Gestartet> {
  const mitgliedschaften = aufbau.mitgliedschaften ?? [
    { organisationId: ORG_ALPHA, permissions: ["costs.read", "costs.calculate"] },
  ];
  const zeugen: Zeugen = { fabrikaufrufe: [], versionen: [], sammler: new Sammler() };
  const aufzeichnen = (planVersionId: string): void => {
    zeugen.versionen.push(planVersionId);
  };

  const portAlpha = faktenPort(
    aufbau.alphaErgebnis ?? { ok: true, facts: FAKTEN_ALPHA },
    aufzeichnen,
  );
  const portBeta = faktenPort({ ok: true, facts: FAKTEN_BETA }, aufzeichnen);

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
      // Die BETA-Fakten haengen an der Organisation, nicht an einer Weiche im
      // Test: wird die Fabrik mit der falschen Id gerufen, kommt die falsche
      // Antwort heraus und der Fall faellt auf.
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
  readonly version?: string;
  readonly organisation?: string;
  readonly ohneCookie?: boolean;
}

function getBaustellen(app: INestApplication, optionen: GetOptionen = {}) {
  const version = optionen.version ?? VERSION_ALPHA;
  let anfrage = request(app.getHttpServer()).get(
    `/${API_BASE_PATH}/kosten/planversionen/${encodeURIComponent(version)}/baustellen`,
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
 * Der Ablehnungstext der Zugangskette, WOERTLICH — nicht importiert.
 *
 * Die Aussage ist, dass „kein Recht" (W4) und „fremde Organisation" (W6b)
 * DENSELBEN Satz bekommen. Ein importierter Text waere in beiden Faellen gleich,
 * egal was der Controller tut, und bewiese die Ununterscheidbarkeit nicht.
 */
const ZUGANG_ABLEHNUNG = "Kein Zugriff auf die Kostendaten dieser Organisation.";

describe("GET /kosten/planversionen/{id}/baustellen — die Baustellenauswahl (EYT-146)", () => {
  it("W1 liefert die Baustellen der Version, entdoppelt und mit Bezeichnung", async () => {
    gestartet = await starte();
    const antwort = await getBaustellen(gestartet.app).expect(200);

    const geprueft = SelectableWorksitesSchema.safeParse(antwort.body);
    expect(geprueft.success, JSON.stringify(antwort.body)).toBe(true);

    // Ausgeschrieben statt aus der Fixtur gebaut: eine Erwartung, die ihre
    // eigene Quelle abbildet, vergleicht sich mit sich selbst.
    expect(antwort.body).toEqual({
      worksites: [
        { id: "00000000-0000-4000-8000-00000000e003", label: "Alpha Baustelle" },
        { id: "00000000-0000-4000-8000-00000000e002", label: "Bravo Baustelle" },
        { id: "00000000-0000-4000-8000-00000000e001", label: "Charlie Baustelle" },
      ],
    });
  });

  it("W2 ordnet nach Bezeichnung — weder nach Eingabe- noch nach Id-Reihenfolge", async () => {
    gestartet = await starte();
    const antwort = await getBaustellen(gestartet.app).expect(200);
    const koerper = antwort.body as { worksites: { id: string; label: string }[] };

    expect(koerper.worksites.map((b) => b.label)) //
      .toEqual(["Alpha Baustelle", "Bravo Baustelle", "Charlie Baustelle"]);
    // Und die Gegenprobe an derselben Antwort: die Ids laufen dabei ABSTEIGEND.
    // Ein `sort()` nach Id lieferte die umgekehrte Reihenfolge, ein fehlendes
    // `sort()` die der Einsaetze (Charlie, Alpha, Bravo).
    expect(koerper.worksites.map((b) => b.id)).toEqual([
      "00000000-0000-4000-8000-00000000e003",
      "00000000-0000-4000-8000-00000000e002",
      "00000000-0000-4000-8000-00000000e001",
    ]);
  });

  it("W2b ordnet bei gleicher Bezeichnung nach Id — der Tiebreak ist erreichbar", async () => {
    // `public.worksites` fuehrt KEINE Eindeutigkeit auf `name` (Migration 0006),
    // zwei gleichnamige Baustellen sind also moeglich. Ohne Tiebreak gaebe der
    // Komparator die Reihenfolge an das Eingabearray zurueck — also an die
    // Reihenfolge der Einsaetze, genau die zufaellige Ordnung, die diese Regel
    // beseitigen soll. Die Fixtur nennt deshalb die spaetere Id zuerst.
    gestartet = await starte({
      alphaErgebnis: {
        ok: true,
        facts: fakten(
          VERSION_ALPHA,
          [BAUSTELLE_DOPPELT_SPAET, BAUSTELLE_DOPPELT_FRUEH],
          new Map([
            [BAUSTELLE_DOPPELT_SPAET, "Doppelte Baustelle"],
            [BAUSTELLE_DOPPELT_FRUEH, "Doppelte Baustelle"],
          ]),
        ),
      },
    });
    const antwort = await getBaustellen(gestartet.app).expect(200);
    expect((antwort.body as { worksites: { id: string }[] }).worksites.map((b) => b.id)).toEqual([
      "00000000-0000-4000-8000-00000000e004",
      "00000000-0000-4000-8000-00000000e009",
    ]);
  });

  it("W3 nennt KEINE Baustelle, auf der diese Version nichts geplant hat", async () => {
    gestartet = await starte();
    const antwort = await getBaustellen(gestartet.app).expect(200);
    // `BAUSTELLE_UNBENUTZT` steht in `worksiteLabels` — die Ressourcenliste der
    // Planung fuehrt alle sichtbaren Baustellen des Mandanten. Wer sie
    // durchreichte, boete einen Filter an, der garantiert null Positionen
    // ergibt, und das saehe wie ein Rechenfehler aus.
    expect(JSON.stringify(antwort.body)).not.toContain("00000000-0000-4000-8000-00000000e00f");
    expect(JSON.stringify(antwort.body)).not.toContain("Unbenutzte Baustelle");
  });

  it("W4 verlangt costs.read — costs.calculate allein genuegt nicht", async () => {
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.calculate"] }],
    });
    const antwort = await getBaustellen(gestartet.app).expect(403);
    expect(detailVon(antwort.body)).toBe(ZUGANG_ABLEHNUNG);
    // Und die Faktenfabrik lief GAR NICHT: die Ablehnung faellt vor jeder
    // fachlichen Arbeit.
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    expect(gestartet.zeugen.versionen).toEqual([]);
  });

  it("W5 lehnt VOR der Eingabepruefung ab, wenn das Recht fehlt", async () => {
    // Kaputte Id UND fehlendes Recht. Antwortete die Route hier 400, erfuehre
    // ein Unberechtigter etwas ueber seine Eingabe — und die Zugangskette liefe
    // erst danach.
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: [] }],
    });
    await getBaustellen(gestartet.app, { version: "keine-id" }).expect(403);
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
  });

  it("W6 bindet die Organisation an die Zugangsentscheidung, nicht an den Header", async () => {
    gestartet = await starte({
      mitgliedschaften: [
        { organisationId: ORG_ALPHA, permissions: ["costs.read"] },
        { organisationId: ORG_BETA, permissions: ["costs.read"] },
      ],
    });
    const antwort = await getBaustellen(gestartet.app, { organisation: ORG_BETA }).expect(200);

    expect(gestartet.zeugen.fabrikaufrufe).toEqual([{ subject: USER, organisation: ORG_BETA }]);
    // Und die Antwort traegt BETAs Baustelle, nicht ALPHAs.
    expect((antwort.body as { worksites: { label: string }[] }).worksites.map((b) => b.label)) //
      .toEqual(["Baustelle des anderen Mandanten"]);
  });

  it("W6b laesst einen fremden Mandanten nicht durch", async () => {
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.read"] }],
    });
    const antwort = await getBaustellen(gestartet.app, { organisation: ORG_FREMD }).expect(403);
    // WOERTLICH dieselbe Antwort wie bei fehlendem Recht (W4) — kein
    // Existenzleck.
    expect(detailVon(antwort.body)).toBe(ZUGANG_ABLEHNUNG);
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    // Und nichts aus ALPHA reist mit.
    expect(JSON.stringify(antwort.body)).not.toContain("Alpha Baustelle");
  });

  it("W7 reicht GENAU die angefragte Planversions-Id an den Port weiter", async () => {
    gestartet = await starte();
    await getBaustellen(gestartet.app, { version: VERSION_BETA }).expect(200);
    // Ohne diesen Zeugen koennte die Route eine feste Id senden und der
    // Statuscode bliebe 200.
    expect(gestartet.zeugen.versionen).toEqual([VERSION_BETA]);
  });

  it("W8 lehnt eine ungueltige Planversions-Id ab, ohne den Port zu rufen", async () => {
    gestartet = await starte();
    await getBaustellen(gestartet.app, { version: "keine-id" }).expect(400);
    // Eine um ein Zeichen verkuerzte Id — der Fall, den ein abgeschnittener
    // Kopiervorgang erzeugt und den eine blosse Laengenpruefung durchliesse.
    await getBaustellen(gestartet.app, { version: "00000000-0000-4000-8000-00000000e00" }) //
      .expect(400);
    expect(gestartet.zeugen.versionen).toEqual([]);

    // EHRLICH DAZU, damit hier niemand einen vakuosen Fall nachtraegt: `IdSchema`
    // ist `z.uuid()` und prueft die SCHREIBWEISE, nicht die UUID-Version. Die
    // Null-UUID `00000000-0000-0000-0000-000000000000` faellt hier deshalb NICHT
    // durch — sie erreicht den Port und wird dort zu `PLAN_VERSION_NOT_FOUND`
    // (`W10`). Der Kommentar an `IdSchema` sagt „UUID v4"; das ist die
    // Beschreibung einer Absicht, nicht der ausgefuehrten Pruefung.
  });

  it("W9 meldet einen Entwurf als 409 mit stabilem URN", async () => {
    gestartet = await starte({ alphaErgebnis: { ok: false, problem: "PLAN_NOT_PUBLISHED" } });
    const antwort = await getBaustellen(gestartet.app).expect(409);
    expect(typVon(antwort.body)).toBe(COSTS_ERROR_TYPE.PLAN_NOT_PUBLISHED);
  });

  it("W10 meldet eine unsichtbare Version, ohne ihre Existenz zu verraten", async () => {
    gestartet = await starte({ alphaErgebnis: { ok: false, problem: "PLAN_VERSION_NOT_FOUND" } });
    const antwort = await getBaustellen(gestartet.app).expect(400);
    expect(typVon(antwort.body)).toBe(COSTS_ERROR_TYPE.PLAN_VERSION_NOT_FOUND);
    // „gibt es nicht" und „gehoert einem anderen Mandanten" sind EINE Antwort:
    // die angefragte Id steht nicht im Text, sonst liesse sich an der Laenge
    // oder am Echo etwas ablesen.
    expect(JSON.stringify(antwort.body)).not.toContain(VERSION_ALPHA);
  });

  it.each<["NO_ORGANISATION" | "AMBIGUOUS_ORGANISATION", string]>([
    ["NO_ORGANISATION", COSTS_ERROR_TYPE.NO_ORGANISATION],
    ["AMBIGUOUS_ORGANISATION", COSTS_ERROR_TYPE.AMBIGUOUS_ORGANISATION],
  ])("W11 bildet %s auf 400 mit stabilem URN ab", async (problem, urn) => {
    gestartet = await starte({ alphaErgebnis: { ok: false, problem } });
    const antwort = await getBaustellen(gestartet.app).expect(400);
    expect(typVon(antwort.body)).toBe(urn);
  });

  it("W12 lehnt ohne Anmeldung ab", async () => {
    gestartet = await starte({ unauthentifiziert: true });
    await getBaustellen(gestartet.app, { ohneCookie: true }).expect(401);
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
  });

  it("W13 zeigt bei fehlender Bezeichnung KEINE rohe Id, sondern lehnt ab", async () => {
    // Eine Baustelle in `work`, fuer die `worksiteLabels` nichts fuehrt. Ein
    // Fallback auf die Id waere eine Auswahlzeile, die niemand lesen kann; eine
    // erfundene Bezeichnung waere schlimmer. Also fail-closed — mit dem
    // BESTEHENDEN URN der Montage, denn die Aussage ist dieselbe.
    gestartet = await starte({
      alphaErgebnis: {
        ok: true,
        facts: fakten(
          VERSION_ALPHA,
          [BAUSTELLE_ALPHA, BAUSTELLE_BRAVO],
          new Map([[BAUSTELLE_ALPHA, "Alpha Baustelle"]]),
        ),
      },
    });
    const antwort = await getBaustellen(gestartet.app).expect(409);
    expect(typVon(antwort.body)).toBe(SNAPSHOT_ASSEMBLY_ERROR_TYPE.LABEL_MISSING);
    // Die Id der bezeichnungslosen Baustelle steht NICHT in der Antwort.
    expect(JSON.stringify(antwort.body)).not.toContain(BAUSTELLE_BRAVO);
    // Und auch keine halbe Liste: entweder alle Baustellen oder keine.
    expect(JSON.stringify(antwort.body)).not.toContain("Alpha Baustelle");
  });

  it("W14 protokolliert die Entscheidung mit Route und Recht", async () => {
    gestartet = await starte();
    await getBaustellen(gestartet.app).expect(200);

    const ereignisse = gestartet.zeugen.sammler.ereignisse;
    expect(ereignisse).toHaveLength(1);
    expect(ereignisse[0]).toMatchObject({
      decision: "allow",
      permission: "costs.read",
      route: "GET /kosten/planversionen/{planVersionId}/baustellen",
      organisationId: ORG_ALPHA,
      subject: pseudonymSubjekt(USER),
      reason: null,
    });
  });
});
