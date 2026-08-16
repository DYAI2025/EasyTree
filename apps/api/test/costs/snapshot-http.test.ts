/**
 * Die beiden Snapshot-Routen an der echten HTTP-Naht (EYT-139, Task 3).
 *
 * ## Warum ohne Datenbank — und was daraus folgt
 *
 * Echt sind hier: `AppModule`, `CostsController`, `MembershipCostAccessPolicy`,
 * die Korrelations-Middleware, `CostsProblemFilter`, `AuthProblemFilter`, der
 * globale `HttpExceptionFilter`, der Use-Case `createCostSnapshot`, die Montage
 * `assembleCostSnapshotPositions`, die Satzauswahl und `toCostSnapshotDto`.
 * Gestellt sind ausschliesslich die ADAPTER an den Raendern — Identitaet,
 * Mitgliedschaften, Faktenport, Satzrepository, Snapshot-Repository,
 * Auditsenke, Datenbank-Ping.
 *
 * Damit misst diese Datei die VERDRAHTUNG und die FEHLERABBILDUNG, nicht die
 * Datenreise; die deckt `cost-snapshot.integration.test.ts` in `db-gates` ab.
 * Weil die Ports gestellt sind, laeuft diese Datei im Pflichtjob `unit-tests`.
 *
 * ## Warum die erwartete Antwort hier als Literal steht
 *
 * `toCostSnapshotDto` benutzt der Controller. Bauete dieser Test seine Erwartung
 * mit derselben Funktion, verglichen beide Seiten dasselbe Ergebnis mit sich
 * selbst — eine vertauschte Feldzuweisung bliebe gruen. Die Erwartung ist
 * deshalb ausgeschrieben, und jedes ihrer Felder traegt einen Wert, den es NUR
 * im gestellten Repository gibt: `planVersionId`, `weekKey`, `timeZone`,
 * `correlationId`, `createdBy` und `totalMinorUnits` widersprechen allesamt dem,
 * was aus Anfrage oder Planfakten rekonstruierbar waere.
 *
 * ## Gegenmutationen, alle eingespielt und gemessen (EYT-139)
 *
 * Jede Zeile nennt die Faelle, die WIRKLICH rot wurden — nicht die, die rot
 * werden sollten.
 *
 * - Die Organisation der Faktenfabrik aus `mitgliedschaften[0]` statt aus
 *   `entscheidung.organisationId` nehmen -> H11 rot.
 * - Dieselbe Stelle auf `organisationHeader ?? ""` umstellen -> H1 rot (dort
 *   wird gar kein Header gesendet, und `fabrikaufrufe` erwartet trotzdem
 *   ORG_ALPHA). Die Variante `organisationHeader ?? entscheidung.organisationId`
 *   ist dagegen KEIN Defekt und wurde deshalb nicht als Gegenmutation gefuehrt:
 *   `MembershipCostAccessPolicy` gibt bei gesetztem Header genau diesen Wert
 *   zurueck, beide Ausdruecke sind auf dem Erfolgspfad derselbe.
 * - Die POST-Antwort aus der Anfrage statt aus dem zurueckgelesenen Stand bauen
 *   -> H1, H2 und H8 rot.
 * - Im Use-Case unbepreisbare Positionen ueberspringen statt zu blockieren
 *   -> H5, H6, H5b und H12 rot.
 * - Im GET die angefragte Id in `detail` aufnehmen -> H9 rot.
 * - `WRITE_CHANNEL_REJECTED` auf 403 statt 500 abbilden -> H12 rot.
 *
 * Drei weitere aus der Spec-Pruefung (12.08.2026). Alle drei liefen zuerst
 * GRUEN — die Datei mass das Verhalten nicht, obwohl es stimmte; die Zeugen
 * `faktenaufrufe`/`subjektaufrufe` und der Fall „Rumpf UND Schluessel kaputt"
 * sind die Nachbesserung:
 *
 * - `publishedPlanVersionId: "…dead"` an den Faktenport statt der Id aus dem
 *   Rumpf -> vorher 20/20 gruen, jetzt H1 rot.
 * - Snapshot-Repository mit fest verdrahtetem Subjekt statt `identitaet.userId`
 *   -> vorher 20/20 gruen, jetzt H1 und H8 rot.
 * - Rumpfpruefung vor die Idempotenzpruefung ziehen -> vorher 20/20 gruen,
 *   jetzt H10 („Rumpf UND Schluessel") und H12 rot.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { COST_RULE_VERSION, unsafeIdentifier } from "@easytree/domain";
import type { AssignmentId, EmployeeId, PlanVersionId, WorksiteId } from "@easytree/domain";
import { CostSnapshotSchema, ProblemDocumentSchema } from "@easytree/contracts";

import { AppModule } from "../../src/app.module";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
// AUSSCHLIESSLICH ueber die Modulwurzel. Ein tiefer Pfad nach `costs/…` faellt
// am Waechter `costs-cross-module-public-api-only`, auch aus einem Test.
import {
  COST_ACCESS_AUDIT,
  COST_SNAPSHOT_REPOSITORY_FACTORY,
  PLAN_COST_FACTS_FACTORY,
  RATE_REPOSITORY_FACTORY,
  pseudonymSubjekt,
  serialisiereZugriffsereignis,
  type CostAccessAuditLog,
  type CostAccessDecisionEvent,
  type CostSnapshotRepository,
  type NewCostSnapshot,
  type PlanCostFactsPort,
  type PlanCostFactsResult,
  type PlannedWorkFact,
  type PublishedPlanFacts,
  type RateVersionRecord,
  type SnapshotReadResult,
  type SnapshotWriteResult,
  type StoredCostSnapshot,
} from "../../src/modules/costs";
import { SESSION_ORGANISATIONS } from "../../src/modules/tenancy";
import { EMPLOYEE_DIRECTORY_FACTORY } from "../../src/modules/workforce";
import { IdentityRejectedError, REQUEST_IDENTITY } from "../../src/platform/auth/request-identity";

/** `supertest`s Anfrageobjekt — ueber den Wertimport, ohne zweiten Typimport. */
type Anfrage = ReturnType<ReturnType<typeof request>["post"]>;

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_ALPHA = "00000000-0000-4000-8000-00000000a001";
const ORG_BETA = "00000000-0000-4000-8000-00000000b001";

/** Beteiligte der ALPHA-Fakten. */
const BERND = unsafeIdentifier<EmployeeId>("00000000-0000-4000-8000-0000000be001");
const BAUSTELLE_ALPHA = unsafeIdentifier<WorksiteId>("00000000-0000-4000-8000-0000000ba001");
const EINSATZ_ALPHA = unsafeIdentifier<AssignmentId>("00000000-0000-4000-8000-0000000ea001");

/** Beteiligte der BETA-Fakten — paarweise verschieden von ALPHA. */
const ANNA = unsafeIdentifier<EmployeeId>("00000000-0000-4000-8000-0000000an001");
const BAUSTELLE_BETA = unsafeIdentifier<WorksiteId>("00000000-0000-4000-8000-0000000bb001");
const EINSATZ_BETA = unsafeIdentifier<AssignmentId>("00000000-0000-4000-8000-0000000eb001");

/**
 * Drei Planversionen, drei Rollen — absichtlich verschieden.
 *
 * ANGEFRAGT steht im Rumpf, FAKTEN in der Antwort des Faktenports, GESPEICHERT
 * im zurueckgelesenen Stand. Waeren sie dieselbe Konstante, koennte der
 * Controller die Antwort aus der Anfrage bauen und nichts wuerde rot.
 */
const PLANVERSION_ANGEFRAGT = "00000000-0000-4000-8000-0000000fa001";
const PLANVERSION_FAKTEN = unsafeIdentifier<PlanVersionId>("00000000-0000-4000-8000-0000000fb001");
const PLANVERSION_GESPEICHERT = "00000000-0000-4000-8000-0000000fc001";

const SNAPSHOT_ID = "00000000-0000-4000-8000-0000000c5001";
const POSITION_ID = "00000000-0000-4000-8000-0000000c5002";
const ERZEUGER = "00000000-0000-4000-8000-0000000c5003";
const GESPEICHERTE_BAUSTELLE = "00000000-0000-4000-8000-0000000c5004";
const GESPEICHERTE_PERSON = "00000000-0000-4000-8000-0000000c5005";
const GESPEICHERTER_EINSATZ = "00000000-0000-4000-8000-0000000c5006";
const GESPEICHERTER_SATZ = "00000000-0000-4000-8000-0000000c5007";
const GESPEICHERTE_KORRELATION = "korrelation-aus-der-datenbank";

/** Drei Ids fuer H9 — unbekannt, fremd, unlesbar. Von aussen nicht zu trennen. */
const ID_UNBEKANNT = "00000000-0000-4000-8000-0000000d0001";
const ID_FREMD = "00000000-0000-4000-8000-0000000d0002";
const ID_UNLESBAR = "00000000-0000-4000-8000-0000000d0003";

/**
 * Der Ablehnungstext der Leseroute, WOERTLICH.
 *
 * Er steht hier als Literal, weil die Zusicherung aus H9 genau das ist: fuer
 * „unbekannt", „fremd" und „nicht lesbar" derselbe Satz. Ein aus der
 * Produktionskonstante importierter Text bewiese das nicht — er waere in allen
 * drei Faellen gleich, egal was der Controller tut.
 */
const LESE_DETAIL =
  "Dieser Snapshot ist nicht verfuegbar. Bitte die Kostenansicht oeffnen und einen Snapshot aus der Liste waehlen.";

const SCHLUESSEL = "snapshot-schluessel-1";
const SCHLUESSEL_ZWEI = "snapshot-schluessel-2";

/** Werte, die in KEINER Auditzeile stehen duerfen. */
const PERSONENNAME = "Bernd Christ";
const GESPEICHERTER_NAME = "Gespeicherte Person";
const BETRAG = "4711";
const STUNDENSATZ = "2500";

/**
 * Feste Korrelations-Id fuer den Auditfall — gegen ein echtes Flakerisiko.
 *
 * `serialisiereZugriffsereignis` traegt die Korrelations-Id in die Zeile. Ohne
 * mitgeschickten Header erzeugt `CorrelationIdMiddleware` eine UUID v4; die
 * Marker `BETRAG` (4711) und `STUNDENSATZ` (2500) sind vier Hexziffern und
 * koennen darin zufaellig vorkommen — Groessenordnung 1 zu ~1100 Laeufen. Ein
 * Test, der einmal im Quartal ohne Codeaenderung rot wird, wird abgeschaltet.
 * Der Wert enthaelt bewusst KEINE Hexziffern.
 */
const KORRELATION_FEST = "korrelation-ohne-hexziffern";

// Bewusst NICHT JWT-foermig — eine Markierung, kein echt aussehendes Token.
const TOKEN = ["kein", "echtes", "token", "nur", "markierung"].join("-");
const COOKIE = `easytree_access=${TOKEN}`;
const ORGANISATION_HEADER = "x-easytree-organization-id";
const IDEMPOTENZ_HEADER = "Idempotency-Key";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function satz(ueberschreibung: Partial<RateVersionRecord> = {}): RateVersionRecord {
  return {
    id: "00000000-0000-4000-8000-0000000ca001",
    employeeId: BERND,
    amountMinorUnits: STUNDENSATZ,
    currency: "EUR",
    validFrom: "2026-01-01",
    validTo: null,
    predecessorId: null,
    reason: "Ersteintrag",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: USER,
    ...ueberschreibung,
  };
}

/** 08:00–16:00 Berlin am 2026-06-15 = 06:00–14:00 UTC. */
const EINSATZ_IN_ALPHA: PlannedWorkFact = {
  assignmentId: EINSATZ_ALPHA,
  employeeId: BERND,
  worksiteId: BAUSTELLE_ALPHA,
  startsAtUtc: new Date("2026-06-15T06:00:00.000Z"),
  endsAtUtc: new Date("2026-06-15T14:00:00.000Z"),
};

const EINSATZ_IN_BETA: PlannedWorkFact = {
  assignmentId: EINSATZ_BETA,
  employeeId: ANNA,
  worksiteId: BAUSTELLE_BETA,
  startsAtUtc: new Date("2026-06-16T06:00:00.000Z"),
  endsAtUtc: new Date("2026-06-16T10:00:00.000Z"),
};

function faktenAlpha(ueberschreibung: Partial<PublishedPlanFacts> = {}): PublishedPlanFacts {
  return {
    planVersionId: PLANVERSION_FAKTEN,
    weekKey: "2026-W25",
    timeZone: "Europe/Berlin",
    publishedAt: new Date("2026-06-10T09:15:00.000Z"),
    work: [EINSATZ_IN_ALPHA],
    employeeLabels: new Map<string, string>([[BERND, PERSONENNAME]]),
    worksiteLabels: new Map<string, string>([[BAUSTELLE_ALPHA, "Baustelle Alpha"]]),
    ...ueberschreibung,
  };
}

function faktenBeta(): PublishedPlanFacts {
  return {
    planVersionId: PLANVERSION_FAKTEN,
    weekKey: "2026-W25",
    timeZone: "Europe/Berlin",
    publishedAt: new Date("2026-06-10T09:15:00.000Z"),
    work: [EINSATZ_IN_BETA],
    employeeLabels: new Map<string, string>([[ANNA, "Anna Bauer"]]),
    worksiteLabels: new Map<string, string>([[BAUSTELLE_BETA, "Baustelle Beta"]]),
  };
}

/**
 * Der gespeicherte Stand — in JEDEM Feld erkennbar anders als die Eingabe.
 *
 * `weekKey`, `timeZone`, `planVersionId`, `correlationId`, `createdBy` und
 * `totalMinorUnits` liessen sich aus Anfrage oder Fakten nicht herleiten. Genau
 * daran ist ablesbar, ob die Antwort aus der Persistenz kommt.
 */
const GESPEICHERT: StoredCostSnapshot = {
  id: SNAPSHOT_ID,
  organisationId: ORG_ALPHA,
  planVersionId: PLANVERSION_GESPEICHERT,
  worksiteId: null,
  weekKey: "2026-W31",
  timeZone: "Europe/Lisbon",
  currency: "EUR",
  ruleVersion: COST_RULE_VERSION,
  totalMinorUnits: 424242n,
  createdAt: new Date("2026-08-01T11:22:33.000Z"),
  createdBy: ERZEUGER,
  correlationId: GESPEICHERTE_KORRELATION,
  positions: [
    {
      id: POSITION_ID,
      assignmentId: GESPEICHERTER_EINSATZ,
      worksiteId: GESPEICHERTE_BAUSTELLE,
      worksiteLabel: "Gespeicherte Baustelle",
      employeeId: GESPEICHERTE_PERSON,
      employeeLabel: GESPEICHERTER_NAME,
      localDate: "2026-07-29",
      durationMilliseconds: 3600000n,
      rateVersionId: GESPEICHERTER_SATZ,
      amountMinorUnits: 4711n,
    },
  ],
};

/** Ausgeschrieben statt mit `toCostSnapshotDto` gebaut — siehe Kopfkommentar. */
const ERWARTETER_RUMPF = {
  id: SNAPSHOT_ID,
  planVersionId: PLANVERSION_GESPEICHERT,
  worksiteId: null,
  weekKey: "2026-W31",
  timeZone: "Europe/Lisbon",
  currency: "EUR",
  ruleVersion: "personnel-plan-cost-v1",
  createdAt: "2026-08-01T11:22:33.000Z",
  createdBy: ERZEUGER,
  correlationId: GESPEICHERTE_KORRELATION,
  totalMinorUnits: "424242",
  days: [{ localDate: "2026-07-29", amountMinorUnits: BETRAG }],
  positions: [
    {
      id: POSITION_ID,
      assignmentId: GESPEICHERTER_EINSATZ,
      worksiteId: GESPEICHERTE_BAUSTELLE,
      worksiteLabel: "Gespeicherte Baustelle",
      employeeId: GESPEICHERTE_PERSON,
      employeeLabel: GESPEICHERTER_NAME,
      localDate: "2026-07-29",
      durationMilliseconds: "3600000",
      rateVersionId: GESPEICHERTER_SATZ,
      amountMinorUnits: BETRAG,
    },
  ],
};

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

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
  readonly faktenAlphaErgebnis?: PlanCostFactsResult;
  readonly saetze?: ReadonlyMap<string, readonly RateVersionRecord[]>;
  readonly schreiben?: SnapshotWriteResult;
  readonly lesen?: SnapshotReadResult;
}

interface Zeugen {
  /** Je Aufruf der Faktenfabrik ein Eintrag — daran haengt H11. */
  readonly fabrikaufrufe: { subject: string; organisation: string }[];
  /**
   * Je Aufruf der Snapshot-Fabrik das uebergebene Subjekt.
   *
   * Ohne diesen Zeugen war „Fabrik je Subjekt" fuer das Snapshot-Repository
   * unbelegt: der Stub verwarf sein Argument, und ein fest verdrahtetes Subjekt
   * im Controller blieb gruen (gemessen, 12.08.2026). Fuer die Faktenfabrik
   * stand der Nachweis von Anfang an, fuer diese nicht — und genau diese Fabrik
   * reicht das Subjekt an `PgCostSnapshotRepository` und damit an den
   * Mandantenkontext weiter.
   */
  readonly subjektaufrufe: string[];
  /**
   * Je Aufruf der SATZ-Fabrik das uebergebene Subjekt.
   *
   * Dieselbe Luecke wie bei `subjektaufrufe`, eine Zeile hoeher im Aufbau: der
   * Stub verwarf sein Argument, und `this.repositoryFor("…dead")` blieb gruen
   * (gemessen, 12.08.2026). Auf dem neuen Schreibpfad ist genau dieses
   * Repository der Port, der die Stundensaetze laedt — es unbelegt zu lassen
   * waere die falsche Haelfte. `rate-http-contract.integration.test.ts` faengt
   * die Mutation vermutlich in `db-gates`; im Pflichtjob `unit-tests` fing sie
   * niemand.
   */
  readonly satzsubjekte: string[];
  /**
   * Die `planVersionId`, mit der der Faktenport WIRKLICH befragt wurde.
   *
   * Ohne diesen Zeugen antwortet der Stub auf jede Id gleich, und der Controller
   * koennte eine beliebige andere Planversion einfrieren, ohne dass die
   * HTTP-Naht es bemerkt (gemessen: `publishedPlanVersionId: "…dead"` liess alle
   * 20 Faelle gruen). Der Use-Case-Test misst die Weiterleitung, der
   * Controller-Hop bis EYT-139 nicht.
   */
  readonly faktenaufrufe: string[];
  readonly createAufrufe: NewCostSnapshot[];
  readonly readAufrufe: string[];
  readonly sammler: Sammler;
}

interface Gestartet {
  readonly app: INestApplication;
  readonly zeugen: Zeugen;
}

function faktenPort(
  ergebnis: PlanCostFactsResult,
  aufzeichnen: (planVersionId: string) => void,
): PlanCostFactsPort {
  return {
    publishedFacts: () => Promise.resolve(ergebnis),
    publishedFactsForVersion: (planVersionId) => {
      aufzeichnen(planVersionId);
      return Promise.resolve(ergebnis);
    },
    publishedVersions: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
  };
}

async function starte(aufbau: Aufbau = {}): Promise<Gestartet> {
  const mitgliedschaften = aufbau.mitgliedschaften ?? [
    { organisationId: ORG_ALPHA, permissions: ["costs.read", "costs.calculate"] },
  ];
  const zeugen: Zeugen = {
    fabrikaufrufe: [],
    subjektaufrufe: [],
    satzsubjekte: [],
    faktenaufrufe: [],
    createAufrufe: [],
    readAufrufe: [],
    sammler: new Sammler(),
  };

  const aufzeichnen = (planVersionId: string): void => {
    zeugen.faktenaufrufe.push(planVersionId);
  };
  const faktenPortAlpha = faktenPort(
    aufbau.faktenAlphaErgebnis ?? { ok: true, facts: faktenAlpha() },
    aufzeichnen,
  );
  const faktenPortBeta = faktenPort({ ok: true, facts: faktenBeta() }, aufzeichnen);

  const saetze =
    aufbau.saetze ??
    new Map<string, readonly RateVersionRecord[]>([
      [BERND, [satz()]],
      [ANNA, [satz({ id: "00000000-0000-4000-8000-0000000ca002", employeeId: ANNA })]],
    ]);

  const schreiben: SnapshotWriteResult = aufbau.schreiben ?? { ok: true, snapshotId: SNAPSHOT_ID };
  const lesen: SnapshotReadResult = aufbau.lesen ?? { ok: true, snapshot: GESPEICHERT };

  const snapshotRepository: CostSnapshotRepository = {
    create: (eingabe) => {
      zeugen.createAufrufe.push(eingabe);
      return Promise.resolve(schreiben);
    },
    read: (snapshotId) => {
      zeugen.readAufrufe.push(snapshotId);
      return Promise.resolve(lesen);
    },
  };

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
    .useValue(() => ({
      list: () => Promise.resolve([{ id: BERND, displayName: PERSONENNAME, active: true }]),
    }))
    .overrideProvider(RATE_REPOSITORY_FACTORY)
    .useValue((subjectUserId: string) => {
      // Das Subjekt wird AUFGEZEICHNET, nicht verworfen — siehe `satzsubjekte`.
      zeugen.satzsubjekte.push(subjectUserId);
      return {
        versionsFor: (employeeId: string) => Promise.resolve(saetze.get(employeeId) ?? []),
        versionsForMany: (employeeIds: readonly string[]) =>
          Promise.resolve(
            new Map<string, readonly RateVersionRecord[]>(
              employeeIds.map((id) => [id, saetze.get(id) ?? []]),
            ),
          ),
        append: () => Promise.reject(new Error("in dieser Suite nicht benutzt")),
      };
    })
    .overrideProvider(PLAN_COST_FACTS_FACTORY)
    .useValue((subjectUserId: string, organisationId: string) => {
      zeugen.fabrikaufrufe.push({ subject: subjectUserId, organisation: organisationId });
      // Fakten NUR fuer ORG_BETA. Wird die Fabrik mit ORG_ALPHA gerufen, gibt es
      // keine passenden Fakten — der Test faellt auf, statt gruen zu bleiben.
      return organisationId === ORG_BETA ? faktenPortBeta : faktenPortAlpha;
    })
    .overrideProvider(COST_SNAPSHOT_REPOSITORY_FACTORY)
    .useValue((subjectUserId: string) => {
      // Das Argument wird AUFGEZEICHNET und nicht verworfen: sonst bliebe ein
      // fest verdrahtetes Subjekt im Controller unbemerkt — siehe `subjektaufrufe`.
      zeugen.subjektaufrufe.push(subjectUserId);
      return snapshotRepository;
    })
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

interface PostOptionen {
  /** `null` = Header bewusst weglassen. */
  readonly schluessel?: string | null;
  readonly rumpf?: unknown;
  readonly organisation?: string;
}

function postSnapshot(app: INestApplication, optionen: PostOptionen = {}): Anfrage {
  let anfrage = request(app.getHttpServer())
    .post(`/${API_BASE_PATH}/kosten/snapshots`)
    .set("cookie", COOKIE);
  if (optionen.organisation !== undefined) {
    anfrage = anfrage.set(ORGANISATION_HEADER, optionen.organisation);
  }
  const schluessel = optionen.schluessel === undefined ? SCHLUESSEL : optionen.schluessel;
  if (schluessel !== null) anfrage = anfrage.set(IDEMPOTENZ_HEADER, schluessel);
  return anfrage.send(
    optionen.rumpf ?? { publishedPlanVersionId: PLANVERSION_ANGEFRAGT, worksiteId: null },
  );
}

function getSnapshot(app: INestApplication, snapshotId: string = SNAPSHOT_ID): Anfrage {
  return request(app.getHttpServer())
    .get(`/${API_BASE_PATH}/kosten/snapshots/${snapshotId}`)
    .set("cookie", COOKIE);
}

/**
 * Genau die vier Felder, die eine Ablehnung ausmachen — ohne Korrelations-Id.
 *
 * `title` steht seit dem 12.08.2026 mit drin: die `TITEL`-Tabelle im Controller
 * war bis dahin VOLLSTAENDIG ungemessen, alle vier Titel rotieren liess 645
 * Faelle gruen. Ihr Kopfkommentar begruendet sie ausfuehrlich („sonst waere der
 * Titel Zufall statt Aussage") — eine Begruendung ohne Messung.
 */
function ablehnung(antwortkoerper: unknown): {
  status: unknown;
  title: unknown;
  type: unknown;
  detail: unknown;
} {
  const problem = antwortkoerper as {
    status?: unknown;
    title?: unknown;
    type?: unknown;
    detail?: unknown;
  };
  return {
    status: problem.status,
    title: problem.title,
    type: problem.type,
    detail: problem.detail,
  };
}

function typVon(antwortkoerper: unknown): unknown {
  return (antwortkoerper as { type?: unknown }).type;
}

/**
 * Genau ein Ereignis — und wirft laut, wenn es das nicht ist.
 *
 * Kein `as`: ein Cast machte aus einem fehlenden Ereignis eine
 * `undefined`-Dereferenzierung mit unverstaendlicher Meldung.
 */
function einziges(ereignisse: readonly CostAccessDecisionEvent[]): CostAccessDecisionEvent {
  const erstes = ereignisse[0];
  if (ereignisse.length !== 1 || erstes === undefined) {
    throw new Error(`Erwartet war genau ein Zugriffsereignis, gezaehlt: ${ereignisse.length}`);
  }
  return erstes;
}

// ---------------------------------------------------------------------------
// H1–H3: der Erfolgsfall und die Wiederholung
// ---------------------------------------------------------------------------

describe("POST /kosten/snapshots (EYT-139)", () => {
  it("H1 — POST liefert 201 und den gespeicherten Snapshot", async () => {
    gestartet = await starte();

    const antwort = await postSnapshot(gestartet.app).expect(201);

    // Der Rumpf ist vertragsgueltig …
    expect(CostSnapshotSchema.safeParse(antwort.body).success).toBe(true);
    // … und stammt Feld fuer Feld aus dem gestellten Repository.
    expect(antwort.body).toEqual(ERWARTETER_RUMPF);
    // Geschrieben wurde genau einmal, und zurueckgelesen wurde die Id, die das
    // Repository gemeldet hat — nicht die aus der Anfrage.
    expect(gestartet.zeugen.createAufrufe).toHaveLength(1);
    expect(gestartet.zeugen.readAufrufe).toEqual([SNAPSHOT_ID]);
    // Die Organisation der Faktenfabrik ist die AUFGELOESTE, nicht der Header:
    // hier wurde gar kein Header gesendet, und trotzdem steht ORG_ALPHA da.
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([{ subject: USER, organisation: ORG_ALPHA }]);
    // Gefragt wurde nach GENAU der Planversion aus dem Rumpf. Ohne diese Zeile
    // koennte der Controller eine beliebige andere einfrieren — die Fakten
    // saehen gleich aus, weil der Stub auf jede Id dasselbe antwortet.
    expect(gestartet.zeugen.faktenaufrufe).toEqual([PLANVERSION_ANGEFRAGT]);
    // Und BEIDE Fabriken wurden mit dem Subjekt DIESER Anfrage gerufen.
    expect(gestartet.zeugen.subjektaufrufe).toEqual([USER]);
    expect(gestartet.zeugen.satzsubjekte).toEqual([USER]);
    // Die zwei Kommandofelder, die bis zum 12.08.2026 ungemessen waren.
    //
    // Ein konstanter Idempotenzschluessel gaebe JEDEM verschiedenen Auftrag
    // denselben Fingerabdruck — genau der Doppeleffekt, gegen den diese Route
    // ihr eigenes 409 fuehrt. Und die Korrelations-Id wird in ein Dokument
    // eingefroren, fuer das es kein `update` und kein `delete` gibt (Migration
    // 0018); sie ist der einzige Faden zwischen Antwort und Logzeile.
    expect(gestartet.zeugen.createAufrufe[0]).toMatchObject({
      idempotencyKey: SCHLUESSEL,
      correlationId: antwort.headers["x-correlation-id"],
      worksiteId: null,
    });
  });

  it("H2 — Retry mit gleichem Schluessel liefert dieselbe gespeicherte Wahrheit", async () => {
    gestartet = await starte();

    const erste = await postSnapshot(gestartet.app).expect(201);
    const zweite = await postSnapshot(gestartet.app).expect(201);

    expect(zweite.body).toEqual(erste.body);
    // Und beide sind der gespeicherte Stand. Ohne diese zweite Zusicherung
    // waeren auch zwei aus der Anfrage rekonstruierte Antworten gleich.
    expect(erste.body).toEqual(ERWARTETER_RUMPF);
    expect(zweite.body).toEqual(ERWARTETER_RUMPF);
    // Das Repository meldet beide Male dieselbe Id — das ist der Retry.
    expect(gestartet.zeugen.readAufrufe).toEqual([SNAPSHOT_ID, SNAPSHOT_ID]);
  });

  it("H3 — gleicher Schluessel mit anderer Nutzlast wird fail-closed abgelehnt", async () => {
    gestartet = await starte({ schreiben: { ok: false, problem: "IDEMPOTENCY_KEY_REUSED" } });

    const antwort = await postSnapshot(gestartet.app).expect(409);

    expect(typVon(antwort.body)).toBe("urn:easytree:costs:idempotency-key-reused");
    expect(ProblemDocumentSchema.safeParse(antwort.body).success).toBe(true);
    // Nichts wurde zurueckgelesen: der Vorgang endet bei der Ablehnung.
    expect(gestartet.zeugen.readAufrufe).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// H4–H7: jede Blockade steht VOR dem Schreiben
// ---------------------------------------------------------------------------

describe("Blockaden erzeugen keinen Snapshot (EYT-139)", () => {
  it("H4 — nicht veroeffentlichte Planversion schreibt keinen Snapshot", async () => {
    gestartet = await starte({ faktenAlphaErgebnis: { ok: false, problem: "PLAN_NOT_PUBLISHED" } });

    const antwort = await postSnapshot(gestartet.app).expect(409);

    expect(typVon(antwort.body)).toBe("urn:easytree:costs:plan-not-published");
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H4b — unbekannte oder fremde Planversion antwortet mit einem Grund", async () => {
    gestartet = await starte({
      faktenAlphaErgebnis: { ok: false, problem: "PLAN_VERSION_NOT_FOUND" },
    });

    const antwort = await postSnapshot(gestartet.app).expect(400);

    expect(typVon(antwort.body)).toBe("urn:easytree:costs:plan-version-not-found");
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H5 — fehlender Satz nennt Person und Tag und erzeugt keinen 0-EUR-Snapshot", async () => {
    gestartet = await starte({
      saetze: new Map<string, readonly RateVersionRecord[]>([[BERND, []]]),
    });

    const antwort = await postSnapshot(gestartet.app).expect(409);

    const problem = ablehnung(antwort.body);
    expect(problem.type).toBe("urn:easytree:costs:rate-not-found");
    // Person UND Tag — ohne beides waere die Meldung nicht handlungsfaehig.
    expect(String(problem.detail)).toContain(BERND);
    expect(String(problem.detail)).toContain("2026-06-15");
    // Aber KEIN Betrag: der Fehlertext ist keine Kostenauskunft.
    expect(String(problem.detail)).not.toContain(STUNDENSATZ);
    expect(String(problem.detail)).not.toContain("EUR");
    // Strikt: ein sechstes Feld kostete den Client das ganze Dokument.
    expect(ProblemDocumentSchema.safeParse(antwort.body).success).toBe(true);
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H6 — mehrdeutiger Satz erzeugt keinen Snapshot", async () => {
    gestartet = await starte({
      saetze: new Map<string, readonly RateVersionRecord[]>([
        [BERND, [satz(), satz({ id: "00000000-0000-4000-8000-0000000ca003" })]],
      ]),
    });

    const antwort = await postSnapshot(gestartet.app).expect(409);

    expect(typVon(antwort.body)).toBe("urn:easytree:costs:rate-ambiguous");
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H7 — fremde Baustelle wird fail-closed abgelehnt", async () => {
    gestartet = await starte();

    const antwort = await postSnapshot(gestartet.app, {
      rumpf: {
        publishedPlanVersionId: PLANVERSION_ANGEFRAGT,
        // Die Baustelle der BETA-Fakten — in ALPHA gibt es sie nicht.
        worksiteId: BAUSTELLE_BETA,
      },
    }).expect(400);

    expect(typVon(antwort.body)).toBe("urn:easytree:costs:worksite-not-in-org");
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H5b — jeder der acht Montagegruende wird zu 409 mit eigenem URN", async () => {
    // Alle acht Gruende ueber die echte HTTP-Naht ausgeloest. Ohne diesen Fall
    // blieben sechs Zeilen der Fehlerabbildung ungemessen.
    //
    // Die kaputte Mitternacht an echten Zonen (Quelle:
    // `cost-snapshot-assembly.test.ts`): in America/Santiago existiert die
    // lokale Mitternacht des 2026-09-06 nicht, in America/Havana zweimal.
    const faelle: readonly [string, Aufbau, string][] = [
      [
        "RATE_NOT_FOUND",
        { saetze: new Map<string, readonly RateVersionRecord[]>([[BERND, []]]) },
        "urn:easytree:costs:rate-not-found",
      ],
      [
        "RATE_AMBIGUOUS",
        {
          saetze: new Map<string, readonly RateVersionRecord[]>([
            [BERND, [satz(), satz({ id: "00000000-0000-4000-8000-0000000ca004" })]],
          ]),
        },
        "urn:easytree:costs:rate-ambiguous",
      ],
      [
        // Der negative Betrag ist KEINE ehrliche Nachbildung eines
        // Datenbankzustands: Migration 0013 fuehrt `check (amount_minor_units
        // >= 0)`, so eine Zeile kann von dort nicht kommen. Der Zweig ist
        // Defense in depth — `hourlyRateAmount` prueft, statt `!` zu behaupten
        // (siehe `cost-snapshot-assembly.ts`) —, und dieser Fall misst seine
        // HTTP-Abbildung, nicht seine Erreichbarkeit im Betrieb.
        "RATE_INVALID",
        {
          saetze: new Map<string, readonly RateVersionRecord[]>([
            [BERND, [satz({ amountMinorUnits: "-100" })]],
          ]),
        },
        "urn:easytree:costs:rate-invalid",
      ],
      [
        "LABEL_MISSING",
        {
          faktenAlphaErgebnis: {
            ok: true,
            facts: faktenAlpha({ employeeLabels: new Map<string, string>() }),
          },
        },
        "urn:easytree:costs:label-missing",
      ],
      [
        "TIME_ZONE_UNKNOWN",
        {
          faktenAlphaErgebnis: { ok: true, facts: faktenAlpha({ timeZone: "Europa/Buxtehude" }) },
        },
        "urn:easytree:costs:time-zone-unknown",
      ],
      [
        "INTERVAL_INVALID",
        {
          faktenAlphaErgebnis: {
            ok: true,
            facts: faktenAlpha({
              work: [{ ...EINSATZ_IN_ALPHA, endsAtUtc: EINSATZ_IN_ALPHA.startsAtUtc }],
            }),
          },
        },
        "urn:easytree:costs:interval-invalid",
      ],
      [
        "DAY_BOUNDARY_NONEXISTENT",
        {
          faktenAlphaErgebnis: {
            ok: true,
            facts: faktenAlpha({
              timeZone: "America/Santiago",
              work: [
                {
                  ...EINSATZ_IN_ALPHA,
                  startsAtUtc: new Date("2026-09-06T02:00:00.000Z"),
                  endsAtUtc: new Date("2026-09-06T08:00:00.000Z"),
                },
              ],
            }),
          },
        },
        "urn:easytree:costs:day-boundary-nonexistent",
      ],
      [
        "DAY_BOUNDARY_AMBIGUOUS",
        {
          faktenAlphaErgebnis: {
            ok: true,
            facts: faktenAlpha({
              timeZone: "America/Havana",
              work: [
                {
                  ...EINSATZ_IN_ALPHA,
                  startsAtUtc: new Date("2026-11-01T02:00:00.000Z"),
                  endsAtUtc: new Date("2026-11-01T08:00:00.000Z"),
                },
              ],
            }),
          },
        },
        "urn:easytree:costs:day-boundary-ambiguous",
      ],
    ];

    const gemessen: { grund: string; status: number; type: unknown; geschrieben: number }[] = [];
    for (const [grund, aufbau] of faelle) {
      const lauf = await starte(aufbau);
      try {
        const antwort = await postSnapshot(lauf.app);
        gemessen.push({
          grund,
          status: antwort.status,
          type: typVon(antwort.body),
          geschrieben: lauf.zeugen.createAufrufe.length,
        });
      } finally {
        await lauf.app.close();
      }
    }

    expect(gemessen).toEqual(
      faelle.map(([grund, , type]) => ({ grund, status: 409, type, geschrieben: 0 })),
    );
  });
});

// ---------------------------------------------------------------------------
// H8/H9: die Leseroute
// ---------------------------------------------------------------------------

describe("GET /kosten/snapshots/{snapshotId} (EYT-139)", () => {
  it("H8 — GET liefert den gespeicherten Stand, nicht eine Neuberechnung", async () => {
    gestartet = await starte();

    const erzeugt = await postSnapshot(gestartet.app).expect(201);
    const fabrikaufrufeNachPost = gestartet.zeugen.fabrikaufrufe.length;
    const faktenaufrufeNachPost = [...gestartet.zeugen.faktenaufrufe];

    const gelesen = await getSnapshot(gestartet.app).expect(200);

    // Der gespeicherte Stand widerspricht den Montagefakten in weekKey,
    // timeZone, planVersionId, Summe und Positionen — die Antwort zeigt ihn.
    expect(gelesen.body).toEqual(ERWARTETER_RUMPF);
    // Und sie ist dieselbe wie die des Erzeugens.
    expect(gelesen.body).toEqual(erzeugt.body);
    // Die Faktenfabrik wird auf dem Lesepfad NIE gerufen. Was nicht gebaut
    // wird, kann auch nicht heimlich in die Antwort einfliessen.
    expect(gestartet.zeugen.fabrikaufrufe).toHaveLength(fabrikaufrufeNachPost);
    // Und auch kein bereits gebauter Port wird noch einmal befragt.
    expect(gestartet.zeugen.faktenaufrufe).toEqual(faktenaufrufeNachPost);
    expect(gestartet.zeugen.readAufrufe).toEqual([SNAPSHOT_ID, SNAPSHOT_ID]);
    // Die Snapshot-Fabrik lief auf BEIDEN Routen mit dem Subjekt der Anfrage —
    // der zweite Eintrag stammt vom GET. Ein Repository je Anfrage, nie ein
    // Singleton mit der Identitaet der ersten.
    expect(gestartet.zeugen.subjektaufrufe).toEqual([USER, USER]);
  });

  it("H9 — unbekannte, fremde und unlesbare Snapshot-Id sind ununterscheidbar", async () => {
    // Was dieser Fall WIRKLICH belegt, und was nicht: an der HTTP-Naht sind die
    // drei Ids drei beliebige UUIDs, und der gestellte Port antwortet allen
    // gleich. Gemessen ist damit die ANTWORTSEITE der Zusage — gleicher Status,
    // gleicher Titel, gleicher URN, gleicher Text, angefragte Id nie
    // zurueckgespiegelt. Dass die drei DATENBANKZUSTAENDE („gibt es nicht",
    // „fremder Mandant", „nicht lesbar") ueberhaupt zu einem Grund zusammen-
    // fallen, entscheidet RLS und misst `cost-snapshot.integration.test.ts` in
    // `db-gates`. Beides zusammen ergibt die Zusage; dieser Test allein nicht.
    gestartet = await starte({ lesen: { ok: false, problem: "SNAPSHOT_NOT_FOUND" } });

    const antworten: { status: unknown; type: unknown; detail: unknown }[] = [];
    for (const id of [ID_UNBEKANNT, ID_FREMD, ID_UNLESBAR]) {
      const antwort = await getSnapshot(gestartet.app, id).expect(403);
      antworten.push(ablehnung(antwort.body));
    }

    // Byteweise gleich, in allen drei Faellen — Status, Titel, URN UND Text.
    const erwartung = {
      status: 403,
      title: "Kein Zugriff",
      type: "urn:easytree:costs:snapshot-not-found",
      detail: LESE_DETAIL,
    };
    expect(antworten).toEqual([erwartung, erwartung, erwartung]);
    // Und KEINE der drei Antworten nennt eine der drei Ids — geprueft am
    // ANTWORTRUMPF, nicht an `LESE_DETAIL`.
    //
    // Diese Schleife verglich bis 12.08.2026 zwei Testkonstanten miteinander und
    // konnte durch keine Produktionsaenderung rot werden. Sie bleibt trotzdem
    // stehen statt gestrichen zu werden, und zwar aus einem Grund, den das
    // `toEqual` daruber nicht abdeckt: jenes friert EINEN Wortlaut ein. Wird der
    // Text spaeter absichtlich umformuliert, zieht jemand `LESE_DETAIL` nach —
    // und die Aussage „die Antwort nennt die angefragte Id nicht" haenge dann
    // allein an der Sorgfalt dieser Person. Als Zusicherung ueber den Rumpf ist
    // sie vom Wortlaut unabhaengig und wird von GM-H4 (Id in `detail`) rot.
    for (const antwort of antworten) {
      for (const id of [ID_UNBEKANNT, ID_FREMD, ID_UNLESBAR]) {
        expect(String(antwort.detail)).not.toContain(id);
      }
    }
    // Die Leseabsicht wurde dreimal wirklich ausgefuehrt.
    expect(gestartet.zeugen.readAufrufe).toEqual([ID_UNBEKANNT, ID_FREMD, ID_UNLESBAR]);
  });

  it("H9b — eine ungueltige Snapshot-Id wird abgelehnt, bevor gelesen wird", async () => {
    gestartet = await starte();

    await getSnapshot(gestartet.app, "keine-uuid").expect(400);

    expect(gestartet.zeugen.readAufrufe).toEqual([]);
  });

  it("H9c — ohne costs.read gewinnt die Zugangskette, auch bei kaputter Id", async () => {
    // Der einzige Fall, der die REIHENFOLGE auf dem Lesepfad misst. `H9b` faehrt
    // MIT Rechten: die Kette passiert, dann faellt die Id — ein Vorziehen der
    // Id-Pruefung bliebe dort unsichtbar (gemessen: 21/21 gruen).
    //
    // Die Folge waere kein Schoenheitsfehler: ein unberechtigter Aufrufer
    // unterschiede dann „kaputte Id" (400) von „wohlgeformte Id" (403) und
    // haette damit ein Existenzorakel ueber die Id-FORM. Schlimmer noch, eine
    // kaputte Id erzeugte GAR KEINE `cost_access_decision`-Zeile — ein Loch in
    // AK9 genau dort, wo jemand Ids durchprobiert.
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.calculate"] }],
    });

    await getSnapshot(gestartet.app, "keine-uuid").expect(403);

    const ereignis = einziges(gestartet.zeugen.sammler.ereignisse);
    expect(ereignis.decision).toBe("deny");
    expect(ereignis.reason).toBe("PERMISSION_MISSING");
    expect(ereignis.route).toBe("GET /kosten/snapshots/{snapshotId}");
    expect(gestartet.zeugen.readAufrufe).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// H10: die Zugangskette
// ---------------------------------------------------------------------------

describe("Zugang zu den Snapshot-Routen (EYT-139)", () => {
  it("H10 — POST ohne costs.calculate wird abgelehnt, auch mit costs.read", async () => {
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.read"] }],
    });

    await postSnapshot(gestartet.app).expect(403);

    // Weder Fakten gelesen noch geschrieben: die Ablehnung steht ganz vorn.
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H10 — GET ohne costs.read wird abgelehnt, auch mit costs.calculate", async () => {
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.calculate"] }],
    });

    await getSnapshot(gestartet.app).expect(403);

    expect(gestartet.zeugen.readAufrufe).toEqual([]);
  });

  it("H10 — POST ohne Idempotenzschluessel wird abgelehnt", async () => {
    gestartet = await starte();

    const antwort = await postSnapshot(gestartet.app, { schluessel: null }).expect(409);

    expect(typVon(antwort.body)).toBe("urn:easytree:costs:missing-idempotency-key");
    // Ohne Wiederholungsschutz kommt die Anfrage gar nicht erst in die
    // Transaktion — und beruehrt auch den Faktenport nicht.
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H10 — bei kaputtem Rumpf UND fehlendem Schluessel gewinnt der Schluessel", async () => {
    // Der einzige Fall, der die REIHENFOLGE der beiden Vorpruefungen misst.
    // Solange ein Fall nur je eine der beiden verletzt, ist ein Tausch der
    // Pruefungen unsichtbar (gemessen: alle 20 Faelle blieben gruen).
    //
    // Die Reihenfolge ist keine Kosmetik: stuende die Rumpfpruefung vorn, meldete
    // der Server 400 und verschwiege, dass zusaetzlich der Wiederholungsschutz
    // fehlt. Die Aufruferin repariert den Rumpf, schickt erneut ohne Schluessel —
    // und ein Verbindungsabriss legt dann zwei Snapshots an, von denen sich
    // keiner loeschen laesst.
    gestartet = await starte();

    const antwort = await postSnapshot(gestartet.app, {
      schluessel: null,
      rumpf: { publishedPlanVersionId: "keine-uuid", worksiteId: 42 },
    }).expect(409);

    expect(typVon(antwort.body)).toBe("urn:easytree:costs:missing-idempotency-key");
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H10 — organisationId im Rumpf wird abgelehnt", async () => {
    gestartet = await starte();

    await postSnapshot(gestartet.app, {
      rumpf: {
        publishedPlanVersionId: PLANVERSION_ANGEFRAGT,
        worksiteId: null,
        organisationId: ORG_BETA,
      },
    }).expect(400);

    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });

  it("H10b — ohne Identitaet antwortet der Auth-Filter, nicht der Kostenpfad", async () => {
    gestartet = await starte({ unauthentifiziert: true });

    await request(gestartet.app.getHttpServer())
      .post(`/${API_BASE_PATH}/kosten/snapshots`)
      .set(IDEMPOTENZ_HEADER, SCHLUESSEL)
      .send({ publishedPlanVersionId: PLANVERSION_ANGEFRAGT, worksiteId: null })
      .expect(401);

    expect(gestartet.zeugen.fabrikaufrufe).toEqual([]);
    expect(gestartet.zeugen.createAufrufe).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// H11: die Organisation kommt aus der Policy
// ---------------------------------------------------------------------------

describe("Der Mandant der Rechnung (EYT-139)", () => {
  it("H11 — POST verarbeitet ausschliesslich die von der Policy aufgeloeste Organisation", async () => {
    gestartet = await starte({
      mitgliedschaften: [
        { organisationId: ORG_ALPHA, permissions: ["costs.read", "costs.calculate"] },
        { organisationId: ORG_BETA, permissions: ["costs.read", "costs.calculate"] },
      ],
    });

    await postSnapshot(gestartet.app, { organisation: ORG_BETA }).expect(201);

    // Genau ein Aufruf, und zwar mit der AUFGELOESTEN Organisation. Ein
    // `mitgliedschaften[0]` ergaebe hier ORG_ALPHA.
    expect(gestartet.zeugen.fabrikaufrufe).toEqual([{ subject: USER, organisation: ORG_BETA }]);

    const geschrieben = gestartet.zeugen.createAufrufe;
    expect(geschrieben).toHaveLength(1);
    const positionen = geschrieben.flatMap((eintrag) => [...eintrag.positions]);
    // Ohne diese Zeile bewiese eine leere Liste "keine Position aus A".
    expect(positionen.length).toBeGreaterThan(0);
    // Keine einzige Position aus ALPHA — weder Baustelle noch Person noch Einsatz.
    expect(positionen.map((position) => position.worksiteId)).toEqual([BAUSTELLE_BETA]);
    expect(positionen.map((position) => position.employeeId)).toEqual([ANNA]);
    expect(positionen.map((position) => position.assignmentId)).toEqual([EINSATZ_BETA]);
    expect(geschrieben.map((eintrag) => eintrag.organisationId)).toEqual([ORG_BETA]);
  });
});

// ---------------------------------------------------------------------------
// H12: Form jeder Ablehnung, und das Zugriffsprotokoll
// ---------------------------------------------------------------------------

/** Ein Ablehnungsfall: Aufbau, Aufruf, erwarteter Status und erwarteter `type`. */
interface Ablehnungsfall {
  readonly name: string;
  readonly aufbau: Aufbau;
  readonly ausfuehren: (app: INestApplication) => Anfrage;
  readonly status: number;
  /**
   * Der erwartete Titel — aus `TITEL` im Controller, ausser bei `about:blank`.
   *
   * Dort antwortet der globale `HttpExceptionFilter` und setzt
   * `STATUS_CODES[status]`, also die englischen HTTP-Namen. Dass beide Quellen
   * in dieser Spalte nebeneinander stehen, ist die Messung: sie trennt die
   * Faelle, die der Kostenpfad selbst formuliert, von denen, die er an den
   * generischen Filter verliert.
   */
  readonly title: string;
  readonly type: string;
  /**
   * `false` dort, wo bewusst der generische `HttpExceptionFilter` antwortet.
   *
   * Er setzt `type` hart auf `about:blank` — ein `throw new
   * BadRequestException({ type: … })` verliert seinen URN also auf dem Weg nach
   * draussen. Das ist gemessenes Bestandsverhalten der Zugangskette (EYT-106)
   * und steht hier als Tatsache, nicht als Wunsch.
   */
  readonly urnErwartet: boolean;
}

const ABLEHNUNGEN: readonly Ablehnungsfall[] = [
  {
    name: "ZUGANG/ORG_CONTEXT_REQUIRED",
    title: "Bad Request",
    aufbau: {
      mitgliedschaften: [
        { organisationId: ORG_ALPHA, permissions: ["costs.read", "costs.calculate"] },
        { organisationId: ORG_BETA, permissions: ["costs.read", "costs.calculate"] },
      ],
    },
    ausfuehren: (app) => postSnapshot(app),
    status: 400,
    type: "about:blank",
    urnErwartet: false,
  },
  {
    name: "ZUGANG/PERMISSION_MISSING",
    title: "Forbidden",
    aufbau: { mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: [] }] },
    ausfuehren: (app) => postSnapshot(app),
    status: 403,
    type: "about:blank",
    urnErwartet: false,
  },
  {
    name: "MISSING_IDEMPOTENCY_KEY",
    title: "Konflikt",
    aufbau: {},
    ausfuehren: (app) => postSnapshot(app, { schluessel: null }),
    status: 409,
    type: "urn:easytree:costs:missing-idempotency-key",
    urnErwartet: true,
  },
  {
    name: "RUMPF_UNGUELTIG",
    title: "Bad Request",
    aufbau: {},
    ausfuehren: (app) => postSnapshot(app, { rumpf: { publishedPlanVersionId: "keine-uuid" } }),
    status: 400,
    type: "about:blank",
    urnErwartet: false,
  },
  {
    // Beides kaputt — der fehlende Wiederholungsschutz gewinnt. Diese Zeile
    // misst die Reihenfolge der beiden Vorpruefungen; die zwei Zeilen darueber
    // verletzen je nur eine davon und lassen einen Tausch durchgehen.
    name: "RUMPF_UNGUELTIG UND SCHLUESSEL FEHLT",
    title: "Konflikt",
    aufbau: {},
    ausfuehren: (app) =>
      postSnapshot(app, {
        schluessel: null,
        rumpf: { publishedPlanVersionId: "keine-uuid", worksiteId: 42 },
      }),
    status: 409,
    type: "urn:easytree:costs:missing-idempotency-key",
    urnErwartet: true,
  },
  {
    name: "FACTS/NO_ORGANISATION",
    title: "Ungueltige Anfrage",
    aufbau: { faktenAlphaErgebnis: { ok: false, problem: "NO_ORGANISATION" } },
    ausfuehren: (app) => postSnapshot(app),
    status: 400,
    type: "urn:easytree:costs:no-organisation",
    urnErwartet: true,
  },
  {
    name: "FACTS/AMBIGUOUS_ORGANISATION",
    title: "Ungueltige Anfrage",
    aufbau: { faktenAlphaErgebnis: { ok: false, problem: "AMBIGUOUS_ORGANISATION" } },
    ausfuehren: (app) => postSnapshot(app),
    status: 400,
    type: "urn:easytree:costs:ambiguous-organisation",
    urnErwartet: true,
  },
  {
    name: "FACTS/PLAN_NOT_PUBLISHED",
    title: "Konflikt",
    aufbau: { faktenAlphaErgebnis: { ok: false, problem: "PLAN_NOT_PUBLISHED" } },
    ausfuehren: (app) => postSnapshot(app),
    status: 409,
    type: "urn:easytree:costs:plan-not-published",
    urnErwartet: true,
  },
  {
    name: "FACTS/PLAN_VERSION_NOT_FOUND",
    title: "Ungueltige Anfrage",
    aufbau: { faktenAlphaErgebnis: { ok: false, problem: "PLAN_VERSION_NOT_FOUND" } },
    ausfuehren: (app) => postSnapshot(app),
    status: 400,
    type: "urn:easytree:costs:plan-version-not-found",
    urnErwartet: true,
  },
  {
    name: "ASSEMBLY/RATE_NOT_FOUND",
    title: "Konflikt",
    aufbau: { saetze: new Map<string, readonly RateVersionRecord[]>([[BERND, []]]) },
    ausfuehren: (app) => postSnapshot(app),
    status: 409,
    type: "urn:easytree:costs:rate-not-found",
    urnErwartet: true,
  },
  {
    name: "WRITE/IDEMPOTENCY_KEY_REUSED",
    title: "Konflikt",
    aufbau: { schreiben: { ok: false, problem: "IDEMPOTENCY_KEY_REUSED" } },
    ausfuehren: (app) => postSnapshot(app, { schluessel: SCHLUESSEL_ZWEI }),
    status: 409,
    type: "urn:easytree:costs:idempotency-key-reused",
    urnErwartet: true,
  },
  {
    name: "WRITE/WORKSITE_NOT_IN_ORG",
    title: "Ungueltige Anfrage",
    aufbau: {},
    ausfuehren: (app) =>
      postSnapshot(app, {
        rumpf: { publishedPlanVersionId: PLANVERSION_ANGEFRAGT, worksiteId: BAUSTELLE_BETA },
      }),
    status: 400,
    type: "urn:easytree:costs:worksite-not-in-org",
    urnErwartet: true,
  },
  {
    // 500 und nicht 403: der Kanal ist kein Rechteproblem (EYT-139, entschieden).
    name: "WRITE/WRITE_CHANNEL_REJECTED",
    title: "Serverfehler",
    aufbau: { schreiben: { ok: false, problem: "WRITE_CHANNEL_REJECTED" } },
    ausfuehren: (app) => postSnapshot(app),
    status: 500,
    type: "urn:easytree:costs:write-channel-rejected",
    urnErwartet: true,
  },
  {
    // Derselbe Grund wie unten, anderer Status: hier ist der Snapshot gerade
    // entstanden, die Aufruferin hat nichts falsch gemacht.
    name: "READ/nach dem Schreiben",
    title: "Serverfehler",
    aufbau: { lesen: { ok: false, problem: "SNAPSHOT_NOT_FOUND" } },
    ausfuehren: (app) => postSnapshot(app),
    status: 500,
    type: "urn:easytree:costs:snapshot-not-found",
    urnErwartet: true,
  },
  {
    name: "GET/ungueltige Id",
    title: "Bad Request",
    aufbau: {},
    ausfuehren: (app) => getSnapshot(app, "keine-uuid"),
    status: 400,
    type: "about:blank",
    urnErwartet: false,
  },
  {
    name: "GET/SNAPSHOT_NOT_FOUND",
    title: "Kein Zugriff",
    aufbau: { lesen: { ok: false, problem: "SNAPSHOT_NOT_FOUND" } },
    ausfuehren: (app) => getSnapshot(app),
    status: 403,
    type: "urn:easytree:costs:snapshot-not-found",
    urnErwartet: true,
  },
];

describe("Form und Protokoll jeder Ablehnung (EYT-139)", () => {
  it("H12 — jede Ablehnung dieser Routen erfuellt ProblemDocumentSchema", async () => {
    // Ohne diese Zeile liefe die Schleife an einer leeren Liste vakuum-gruen.
    expect(ABLEHNUNGEN.length).toBeGreaterThan(10);

    const gemessen: {
      name: string;
      status: number;
      title: unknown;
      type: unknown;
      gueltig: boolean;
      urnGesehen: boolean;
    }[] = [];

    for (const fall of ABLEHNUNGEN) {
      const lauf = await starte(fall.aufbau);
      try {
        const antwort = await fall.ausfuehren(lauf.app);
        const type = typVon(antwort.body);
        gemessen.push({
          name: fall.name,
          status: antwort.status,
          title: ablehnung(antwort.body).title,
          type,
          // Strikt: `ProblemDocumentSchema` ist ein `z.strictObject`, und
          // `readProblem` verwirft bei einem Fehlschlag das GANZE Dokument.
          gueltig: ProblemDocumentSchema.safeParse(antwort.body).success,
          urnGesehen: typeof type === "string" && type.startsWith("urn:easytree:"),
        });
      } finally {
        await lauf.app.close();
      }
    }

    expect(gemessen).toEqual(
      ABLEHNUNGEN.map((fall) => ({
        name: fall.name,
        status: fall.status,
        title: fall.title,
        type: fall.type,
        gueltig: true,
        urnGesehen: fall.urnErwartet,
      })),
    );
  });

  it("H12 — beide Routen erzeugen genau ein cost.access.decision-Ereignis", async () => {
    // Erlaubt: POST.
    gestartet = await starte();
    const erzeugt = await postSnapshot(gestartet.app).expect(201);
    const postEreignis = einziges(gestartet.zeugen.sammler.ereignisse);
    expect(postEreignis.decision).toBe("allow");
    expect(postEreignis.permission).toBe("costs.calculate");
    expect(postEreignis.route).toBe("POST /kosten/snapshots");
    expect(postEreignis.organisationId).toBe(ORG_ALPHA);
    expect(postEreignis.subject).toBe(pseudonymSubjekt(USER));
    expect(postEreignis.correlationId).toBe(erzeugt.headers["x-correlation-id"]);
    await gestartet.app.close();
    gestartet = null;

    // Erlaubt: GET.
    gestartet = await starte();
    const gelesen = await getSnapshot(gestartet.app)
      .set("x-correlation-id", KORRELATION_FEST)
      .expect(200);
    const getEreignis = einziges(gestartet.zeugen.sammler.ereignisse);
    // Die Middleware uebernimmt eine mitgebrachte Id — damit ist die Zeile
    // deterministisch und die Markerpruefung unten kann nicht zufaellig treffen.
    expect(getEreignis.correlationId).toBe(KORRELATION_FEST);
    expect(getEreignis.decision).toBe("allow");
    expect(getEreignis.permission).toBe("costs.read");
    expect(getEreignis.route).toBe("GET /kosten/snapshots/{snapshotId}");
    expect(getEreignis.correlationId).toBe(gelesen.headers["x-correlation-id"]);
    // Die Zeile traegt weder Namen noch Betraege noch Token — und beide sind
    // durch diese Anfrage tatsaechlich geflossen.
    const zeile = serialisiereZugriffsereignis(getEreignis);
    expect(zeile).not.toContain(PERSONENNAME);
    expect(zeile).not.toContain(GESPEICHERTER_NAME);
    expect(zeile).not.toContain(BETRAG);
    expect(zeile).not.toContain(STUNDENSATZ);
    expect(zeile).not.toContain(TOKEN);
    expect(zeile).not.toContain(USER);
    await gestartet.app.close();
    gestartet = null;

    // Abgelehnt: dieselbe Zusicherung, anderer Ausgang.
    gestartet = await starte({
      mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: ["costs.read"] }],
    });
    const abgelehnt = await postSnapshot(gestartet.app).expect(403);
    const denyEreignis = einziges(gestartet.zeugen.sammler.ereignisse);
    expect(denyEreignis.decision).toBe("deny");
    expect(denyEreignis.reason).toBe("PERMISSION_MISSING");
    expect(denyEreignis.route).toBe("POST /kosten/snapshots");
    expect(denyEreignis.correlationId).toBe(
      (abgelehnt.body as { correlationId: string }).correlationId,
    );
  });
});
