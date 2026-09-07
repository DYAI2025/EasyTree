import { describe, expect, it } from "vitest";

import { MockPlanningGateway } from "../src/mock/planning.js";
import {
  EngagementDtoSchema,
  PlanningWindowSchema,
  WorksiteDayDtoSchema,
} from "../src/planning/schemas.js";
import {
  PLANNING_GATEWAY_CONTRACT_FIXTURE,
  PLANNING_PROBLEM_TYPE,
  PLANNING_VALIDATION_CODE,
  planningGatewayContractSuite,
} from "../src/testing/planning-gateway-contract.js";

/**
 * Vertragssuite fuer PlanningGateway.
 *
 * Bewusst gegen die Schnittstelle geschrieben, nicht gegen die Implementierung:
 * derselbe Block laeuft spaeter gegen `HttpPlanningGateway`, sobald es einen
 * Server gibt (EYT-50). Jede Antwort wird gegen das veroeffentlichte Schema
 * geparst — eine Implementierung, die etwas anderes liefert, faellt hier durch.
 *
 * **Evidenzgrenze.** Diese Datei prueft den Mock. Dieselbe exportierte Suite
 * laeuft in der API gegen `HttpPlanningGateway` und einen echten NestJS-Testserver.
 */
const VERSION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3300";
const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const EMPLOYEE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
/** Zweite bekannte Person — nur der Einsatz-Fingerabdruck braucht ein Team, das sich umsortieren laesst. */
const ZWEITE_PERSON_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3321";
const WORKSITE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const INTERVAL = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T14:00:00.000Z" };

function makeMock(): MockPlanningGateway {
  return new MockPlanningGateway({
    timeZone: "Europe/Berlin",
    // Beide Ids der Woche W32 muessen hier auftauchen, sonst verwirft
    // `PlanningWindowSchema` die Antwort als nicht aufloesbar. Genau das ist
    // die Absicht: der Mock kann keine Zuweisung mehr auf jemanden zeigen
    // lassen, den die Auswahlliste nicht kennt.
    resources: {
      employees: [
        { id: EMPLOYEE_ID, label: "Beschaeftigte A", active: true },
        { id: ZWEITE_PERSON_ID, label: "Beschaeftigte B", active: true },
      ],
      worksites: [{ id: WORKSITE_ID, label: "Baustelle A", active: true }],
    },
    weeks: new Map([
      [
        "2026-W32",
        {
          assignments: [
            {
              id: ASSIGNMENT_ID,
              employeeId: EMPLOYEE_ID,
              worksiteId: WORKSITE_ID,
              interval: INTERVAL,
            },
          ],
          publishedVersionId: VERSION_ID,
          publishResult: {
            versionId: VERSION_ID,
            weekKey: "2026-W32",
            publishedAtUtc: "2026-08-01T09:00:00.000Z",
            assignmentIds: [ASSIGNMENT_ID],
          },
        },
      ],
      [
        // Zweite, noch unveroeffentlichte Woche. Ohne sie waere nicht pruefbar,
        // dass Version und Publish-Ergebnis pro Fenster gelten.
        "2026-W33",
        {
          assignments: [],
          publishedVersionId: null,
          publishResult: {
            versionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
            weekKey: "2026-W33",
            publishedAtUtc: "2026-08-08T09:00:00.000Z",
            assignmentIds: [],
          },
        },
      ],
    ]),
    validation: (input) =>
      input.draft.interval.startUtc ===
      PLANNING_GATEWAY_CONTRACT_FIXTURE.overlappingInterval.startUtc
        ? {
            conflicts: [
              {
                code: PLANNING_VALIDATION_CODE.overlap,
                blocking: true,
                message: "Mitarbeitende Person ist in diesem Zeitraum bereits eingeplant.",
              },
            ],
            publishable: false,
          }
        : { conflicts: [], publishable: true },
    nextAssignmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
    // EYT-147 M2: Antwortform der Tagescommands. Die Ids stehen hier und nicht
    // im Mock, damit keine Zusicherung gegen eine eingebaute Konstante prueft.
    nextWorksiteDay: {
      worksiteDayId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305",
      // Die Baustelle des Tages — bewusst die BEKANNTE aus `resources`, damit eine
      // Antwort, die statt dessen eine der beiden anderen Ids traegt, auffliegt.
      worksiteId: WORKSITE_ID,
      localDate: "2026-08-03",
      configurationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3306",
      assignmentIds: [
        "3f2504e0-4f89-41d3-9a0c-0305e82c3307",
        "3f2504e0-4f89-41d3-9a0c-0305e82c3308",
      ],
    },
    // EYT-120: die VORBEREITETE Serverantwort fuer ZWEI Tage mit je bis zu
    // zwei Personen (die zweite Id je Tag braucht nur der Reihenfolge-Fall des
    // Fingerabdrucks). EINSATZGRENZEN stehen hier nicht mehr: sie sind lokale
    // Geschaeftsdaten und kommen unveraendert aus dem Kommando zurueck (D-003).
    // Die Tages-Instants stehen fertig — der Mock rechnet keine Zone. Ein
    // dritter Tag muss auffallen — siehe "erfindet keine Id" unten.
    nextEngagement: {
      engagementId: "3f2504e0-4f89-41d3-9a0c-0305e82c3310",
      days: [
        {
          localDate: "2026-08-05",
          worksiteDayId: "3f2504e0-4f89-41d3-9a0c-0305e82c3311",
          configurationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3313",
          startUtc: "2026-08-05T06:00:00.000Z",
          endUtc: "2026-08-05T16:00:00.000Z",
          assignmentIds: [
            "3f2504e0-4f89-41d3-9a0c-0305e82c3315",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3317",
          ],
        },
        {
          localDate: "2026-08-06",
          worksiteDayId: "3f2504e0-4f89-41d3-9a0c-0305e82c3312",
          configurationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3314",
          startUtc: "2026-08-06T06:00:00.000Z",
          endUtc: "2026-08-06T10:00:00.000Z",
          assignmentIds: [
            "3f2504e0-4f89-41d3-9a0c-0305e82c3316",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3318",
          ],
        },
      ],
    },
  });
}

planningGatewayContractSuite("MockPlanningGateway", () => ({ gateway: makeMock() }));

describe("weitere Mock-Zustände", () => {
  it("liefert eine leere Woche als leere Liste, nicht als Fehler", async () => {
    const result = await makeMock().getPlanningWindow({ weekKey: "2026-W40" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assignments).toEqual([]);
  });

  it("veroeffentlicht auf dem erwarteten Stand", async () => {
    const result = await makeMock().publishPlan({
      weekKey: "2026-W32",
      expectedVersionId: VERSION_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versionId).toBe(VERSION_ID);
  });

  it("lehnt eine Veroeffentlichung auf veraltetem Stand ab", async () => {
    const result = await makeMock().publishPlan({
      weekKey: "2026-W32",
      expectedVersionId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("STALE_VERSION");
    expect(result.problem?.status).toBe(409);
  });

  it("modelliert Fehlerzustaende ueber den Port, nicht ueber Ausnahmen", async () => {
    const mock = makeMock();
    mock.induce("FORBIDDEN");
    const result = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("FORBIDDEN");
    expect(result.problem?.status).toBe(403);
  });

  it("faellt nach einem induzierten Fehler wieder auf den Normalfall zurueck", async () => {
    const mock = makeMock();
    mock.induce("UNAVAILABLE");
    await mock.getPlanningWindow({ weekKey: "2026-W32" });
    const second = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(second.ok).toBe(true);
  });
});

describe("Mock-Ehrlichkeit", () => {
  it("merkt sich den geprueften Entwurf, rechnet ihn aber nicht", () => {
    const mock = makeMock();
    expect(mock.lastValidated).toBeNull();
    const command = {
      weekKey: "2026-W32",
      draft: { employeeId: EMPLOYEE_ID, worksiteId: WORKSITE_ID, interval: INTERVAL },
    };
    void mock.validateDraft(command);
    expect(mock.lastValidated).toEqual(command);
  });
});

describe("Planversion gilt pro Woche", () => {
  it("meldet fuer eine unveroeffentlichte Woche keine fremde Version", async () => {
    const gateway = makeMock();
    const w33 = await gateway.getPlanningWindow({ weekKey: "2026-W33" });
    expect(w33.ok).toBe(true);
    if (!w33.ok) return;
    expect(w33.value.publishedVersionId).toBeNull();
  });

  it("veroeffentlicht in Woche 33 das Ergebnis von Woche 33", async () => {
    const gateway = makeMock();
    const published = await gateway.publishPlan({ weekKey: "2026-W33", expectedVersionId: null });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.weekKey).toBe("2026-W33");
  });

  it("meldet Stale-Version anhand der ANGEFRAGTEN Woche", async () => {
    const gateway = makeMock();
    // Die Version aus Woche 32 ist fuer Woche 33 kein gueltiger Erwartungswert.
    const wrong = await gateway.publishPlan({ weekKey: "2026-W33", expectedVersionId: VERSION_ID });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.failure).toBe("STALE_VERSION");
  });

  it("lehnt ein unbekanntes Planungsfenster ab, statt eine fremde Version zu liefern", async () => {
    const gateway = makeMock();
    const unknown = await gateway.publishPlan({ weekKey: "2026-W40", expectedVersionId: null });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.failure).toBe("REJECTED");
  });
});

describe("Baustellentag-Kommandos des Mocks (EYT-147 M2)", () => {
  const SCHLUESSEL = PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey;
  const TEAM = [
    {
      employeeId: EMPLOYEE_ID,
      interval: { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T10:00:00.000Z" },
    },
  ];

  it("liefert beim Anlegen eine vertragskonforme Antwort mit getrennten Ids", async () => {
    const result = await makeMock().planWorksiteDay(
      { weekKey: "2026-W32", worksiteId: WORKSITE_ID, localDate: "2026-08-03", team: TEAM },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Gegen das VEROEFFENTLICHTE Schema geparst, nicht nur auf Felder geprueft:
    // eine Attrappe, die etwas anderes liefert, faellt hier durch.
    expect(() => WorksiteDayDtoSchema.parse(result.value)).not.toThrow();
    expect(result.value.worksiteDayId).not.toBe(result.value.configurationId);
    // Dieselbe Dreierprobe wie beim Aendern: die Baustelle stammt aus dem
    // KOMMANDO, die beiden anderen Ids aus dem Fixture.
    expect(result.value.worksiteId).toBe(WORKSITE_ID);
    expect(result.value.worksiteDayId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3305");
    expect(result.value.configurationId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3306");
    expect(result.value.lockVersion).toBe(0);
    expect(result.value.team).toHaveLength(1);
    expect(result.value.team[0]?.employeeId).toBe(EMPLOYEE_ID);
    // Die Assignment-Id kommt aus dem Fixture — der Mock erfindet keine.
    expect(result.value.team[0]?.assignmentId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3307");
  });

  it("schreibt beim Ersetzen der Besetzung die lockVersion fort", async () => {
    const result = await makeMock().updateWorksiteDayTeam(
      {
        weekKey: "2026-W32",
        worksiteDayId: "3f2504e0-4f89-41d3-9a0c-0305e82c3305",
        expectedLockVersion: 3,
        team: TEAM,
      },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => WorksiteDayDtoSchema.parse(result.value)).not.toThrow();
    // Ohne Fortschreibung muesste der Client fuer jede zweite Aenderung neu
    // laden — genau die Luecke, in der der veraltete Stand entsteht.
    expect(result.value.lockVersion).toBe(4);

    // ## Warum die drei Ids EINZELN zugesichert werden
    //
    // `WorksiteDayDtoSchema.parse` kann sie nicht auseinanderhalten: alle drei
    // sind `IdSchema`, also bestaetigt ein Rundlauf jede Belegung. Drei getrennte
    // Zusicherungen auf drei verschiedene Fixturewerte sind die einzige Form, die
    // einen Tausch nicht ueberlebt.
    expect(result.value.worksiteId).toBe(WORKSITE_ID);
    expect(result.value.worksiteDayId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3305");
    expect(result.value.configurationId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3306");
    expect(
      new Set([result.value.worksiteId, result.value.worksiteDayId, result.value.configurationId])
        .size,
    ).toBe(3);
  });

  it("lehnt ein leeres Team ab, statt einen leeren Tag anzulegen", async () => {
    const result = await makeMock().planWorksiteDay(
      { weekKey: "2026-W32", worksiteId: WORKSITE_ID, localDate: "2026-08-03", team: [] },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("REJECTED");
  });

  it("erfindet keine Assignment-Id, wenn das Fixture nicht reicht", async () => {
    // Der Mock haelt zwei Ids bereit. Ein drittes Teammitglied muss auffallen —
    // eine still abgeschnittene Besetzung waere die schlimmere Antwort.
    const zuGross = [0, 1, 2].map((tag) => ({
      employeeId: EMPLOYEE_ID,
      interval: {
        startUtc: `2026-08-0${3 + tag}T06:00:00.000Z`,
        endUtc: `2026-08-0${3 + tag}T10:00:00.000Z`,
      },
    }));
    const result = await makeMock().planWorksiteDay(
      { weekKey: "2026-W32", worksiteId: WORKSITE_ID, localDate: "2026-08-03", team: zuGross },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem?.detail).toContain("Fixture erweitern");
  });
});

describe("Einsatz-Kommando des Mocks (EYT-120)", () => {
  const SCHLUESSEL = PLANNING_GATEWAY_CONTRACT_FIXTURE.idempotencyKey;
  // 2026-08-05 ist ein Mittwoch, 2026-08-06 ein Donnerstag — beide Werktage in
  // der veroeffentlichten Woche W32 des Fixtures. Nur dort kann das Fenster Tage
  // MIT Herkunft zeigen (der Mock kennt keinen Entwurf). Es gibt KEINE Tagesliste
  // im Kommando: Montag bis Freitag entstehen automatisch (D-005).
  const EINSATZ = {
    worksiteId: WORKSITE_ID,
    startDate: "2026-08-05",
    endDate: "2026-08-06",
    planningHorizonDate: null,
    defaults: { workingTime: { from: "08:00", to: "18:00" } },
    team: [EMPLOYEE_ID],
  };

  it("leitet die Werktage selbst ab und legt je Tag einen Baustellentag an — vertragskonform", async () => {
    const result = await makeMock().createEngagement(EINSATZ, { idempotencyKey: SCHLUESSEL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => EngagementDtoSchema.parse(result.value)).not.toThrow();
    expect(result.value.engagementId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3310");
    // Die Tage kommen aus der Ableitung, nicht aus dem Kommando — es nennt keine.
    expect(result.value.days.map((tag) => tag.localDate)).toEqual(["2026-08-05", "2026-08-06"]);
    expect(result.value.days.map((tag) => tag.weekKey)).toEqual(["2026-W32", "2026-W32"]);
    // Ids aus dem Fixture, der Reihe nach — und nicht aus `nextWorksiteDay`.
    expect(result.value.days.map((tag) => tag.worksiteDayId)).toEqual([
      "3f2504e0-4f89-41d3-9a0c-0305e82c3311",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3312",
    ]);
    expect(result.value.days.map((tag) => tag.team[0]?.assignmentId)).toEqual([
      "3f2504e0-4f89-41d3-9a0c-0305e82c3315",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3316",
    ]);
    expect(result.value.days[0]?.team[0]?.interval).toEqual({
      startUtc: "2026-08-05T06:00:00.000Z",
      endUtc: "2026-08-05T16:00:00.000Z",
    });
  });

  it("gibt die Einsatzgrenzen als lokale DATEN zurueck, nicht als Zeitpunkte (D-003)", async () => {
    const result = await makeMock().createEngagement(EINSATZ, { idempotencyKey: SCHLUESSEL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startDate).toBe("2026-08-05");
    expect(result.value.endDate).toBe("2026-08-06");
    expect(result.value.planningHorizonDate).toBeNull();
    // Und die verworfene Instant-Form taucht nirgends mehr auf.
    expect(Object.keys(result.value)).not.toContain("startsAtUtc");
    expect(Object.keys(result.value)).not.toContain("endsAtUtc");
  });

  it("materialisiert bei offenem Ende nur bis zum Horizont — ohne endDate zu setzen (D-006)", async () => {
    // Horizont bis Freitag; das Fixture kennt Mittwoch und Donnerstag. Der
    // Ausschluss des Freitags haelt die Ableitung auf den vorhandenen Tagen —
    // gemessen wird hier, dass `endDate` null BLEIBT.
    const result = await makeMock().createEngagement(
      {
        ...EINSATZ,
        endDate: null,
        planningHorizonDate: "2026-08-07",
        calendar: { include: [], exclude: ["2026-08-07"] },
      },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.endDate).toBeNull();
    expect(result.value.planningHorizonDate).toBe("2026-08-07");
    expect(result.value.days.map((tag) => tag.localDate)).toEqual(["2026-08-05", "2026-08-06"]);
  });

  it("zeigt die angelegten Tage danach im Planungsfenster — samt Zuweisungen", async () => {
    const mock = makeMock();
    const angelegt = await mock.createEngagement(EINSATZ, { idempotencyKey: SCHLUESSEL });
    expect(angelegt.ok).toBe(true);
    const fenster = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(fenster.ok).toBe(true);
    if (!fenster.ok) return;
    // Gegen das Fensterschema geparst: es verlangt, dass jedes Teammitglied
    // eine Zuweisung unter `assignments` hat — ein Mock, der nur die Tage
    // ablegt, fiele hier durch.
    expect(() => PlanningWindowSchema.parse(fenster.value)).not.toThrow();
    expect(fenster.value.worksiteDays?.map((tag) => tag.localDate)).toEqual([
      "2026-08-05",
      "2026-08-06",
    ]);
    expect(fenster.value.assignments.map((z) => z.id)).toEqual(
      expect.arrayContaining([
        "3f2504e0-4f89-41d3-9a0c-0305e82c3315",
        "3f2504e0-4f89-41d3-9a0c-0305e82c3316",
      ]),
    );
  });

  it("lehnt ein Kommando ab, das das Schema verwirft, und legt dann nichts an", async () => {
    const mock = makeMock();
    const result = await mock.createEngagement(
      // Ein Ausschluss ausserhalb des Zeitraums — dieselbe Klasse Eingabefehler
      // wie frueher ein Tag ausserhalb, nur jetzt am Override statt an der Liste.
      { ...EINSATZ, calendar: { include: [], exclude: ["2026-08-10"] } },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("REJECTED");
    expect(result.problem?.status).toBe(400);
    const fenster = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(fenster.ok && fenster.value.worksiteDays).toEqual([]);
  });

  it("erfindet keine Id, wenn das Fixture die abgeleiteten Tage nicht deckt", async () => {
    // Der Zeitraum bis Freitag leitet einen dritten Werktag ab, den das Fixture
    // nicht kennt.
    const result = await makeMock().createEngagement(
      { ...EINSATZ, endDate: "2026-08-07" },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem?.detail).toContain("Fixture erweitern");
    // Die Ablehnung nennt den Tag, den das Fixture nicht kennt.
    expect(result.problem?.detail).toContain("2026-08-07");
  });

  it("respektiert einen induzierten Fehler", async () => {
    const mock = makeMock();
    mock.induce("UNAVAILABLE");
    const result = await mock.createEngagement(EINSATZ, { idempotencyKey: SCHLUESSEL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("UNAVAILABLE");
  });

  it("wiederholt denselben Schluessel statt den Einsatz zu verdoppeln", async () => {
    // Dieselbe Mechanik wie bei `createAssignment`: ein wiederholter Aufruf mit
    // demselben Schluessel UND demselben Kommando ist ein Replay, keine zweite
    // Anlage. Ein Mock, der hier ein zweites Mal anlegt, zeigt der Shell nach
    // einem Netz-Retry doppelte Tage — und `PlanningWindowSchema` verwirft
    // ein Fenster, in dem eine Tagesidentitaet zweimal steht.
    const mock = makeMock();
    const erster = await mock.createEngagement(EINSATZ, { idempotencyKey: SCHLUESSEL });
    const zweiter = await mock.createEngagement(EINSATZ, { idempotencyKey: SCHLUESSEL });
    expect(erster.ok).toBe(true);
    expect(zweiter.ok).toBe(true);
    if (!erster.ok || !zweiter.ok) return;
    expect(zweiter.value).toEqual(erster.value);

    const fenster = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(fenster.ok).toBe(true);
    if (!fenster.ok) return;
    expect(PlanningWindowSchema.safeParse(fenster.value).success).toBe(true);
    const tagesIds = fenster.value.worksiteDays?.map((tag) => tag.worksiteDayId) ?? [];
    expect(tagesIds).toHaveLength(2);
    expect(new Set(tagesIds).size).toBe(tagesIds.length);
    for (const tag of erster.value.days) {
      expect(tagesIds.filter((id) => id === tag.worksiteDayId)).toHaveLength(1);
    }
  });

  it("HP2-R5 behandelt ausgelassene defaults und defaults: {} beim Replay gleich", async () => {
    const mock = makeMock();
    const { defaults, ...ohneDefaults } = EINSATZ;
    void defaults;

    const erster = await mock.createEngagement(ohneDefaults, { idempotencyKey: SCHLUESSEL });
    const zweiter = await mock.createEngagement(
      { ...ohneDefaults, defaults: {} },
      { idempotencyKey: SCHLUESSEL },
    );

    expect(erster.ok).toBe(true);
    expect(zweiter.ok).toBe(true);
    if (!erster.ok || !zweiter.ok) return;
    expect(zweiter.value).toEqual(erster.value);
  });

  it("erkennt dasselbe Kommando auch in anderer Reihenfolge von Overrides und Team als Wiederholung", async () => {
    // `calendar.include`, `calendar.exclude` und `team` sind MENGEN: dieselbe
    // Auswahl in anderer Reihenfolge ist dasselbe Kommando. Ein Fingerabdruck,
    // der die Reihenfolge mitliest, meldete hier 409 (Schluessel wiederverwendet) —
    // der Client haette nach einem Netz-Retry weder seine Antwort noch einen
    // zweiten Einsatz.
    //
    // Gegenmutation M12: `.sort()` auf `exclude` ODER auf `team` im
    // Fingerabdruck entfernen — beides macht diesen Fall rot.
    //
    // Der Zeitraum Mo–Fr leitet fuenf Werktage ab; drei davon werden abgewaehlt,
    // damit genau die zwei Tage uebrig bleiben, die das Fixture kennt. Das gibt
    // eine Ausschlussliste mit drei Eintraegen, die sich umsortieren laesst.
    const mock = makeMock();
    const zuZweit = {
      ...EINSATZ,
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      calendar: { include: [], exclude: ["2026-08-03", "2026-08-04", "2026-08-07"] },
      team: [EMPLOYEE_ID, ZWEITE_PERSON_ID],
    };
    const erster = await mock.createEngagement(zuZweit, { idempotencyKey: SCHLUESSEL });
    const zweiter = await mock.createEngagement(
      {
        ...zuZweit,
        calendar: { include: [], exclude: [...zuZweit.calendar.exclude].reverse() },
        team: [...zuZweit.team].reverse(),
      },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(erster.ok).toBe(true);
    expect(zweiter.ok).toBe(true);
    if (!erster.ok || !zweiter.ok) return;
    expect(erster.value.days.map((tag) => tag.localDate)).toEqual(["2026-08-05", "2026-08-06"]);
    expect(zweiter.value).toEqual(erster.value);

    // Keine Verdopplung im Fenster: zwei Tage, und jede der vier Zuweisungen des
    // Einsatzes genau einmal (die Woche traegt daneben ihre Fixture-Zuweisung).
    const fenster = await mock.getPlanningWindow({ weekKey: "2026-W32" });
    expect(fenster.ok).toBe(true);
    if (!fenster.ok) return;
    expect(PlanningWindowSchema.safeParse(fenster.value).success).toBe(true);
    const tagesIds = fenster.value.worksiteDays?.map((tag) => tag.worksiteDayId) ?? [];
    expect(tagesIds).toHaveLength(2);
    expect(new Set(tagesIds).size).toBe(2);
    const eigene = erster.value.days.flatMap((tag) => tag.team.map((m) => m.assignmentId));
    expect(eigene).toHaveLength(4);
    const imFenster = fenster.value.assignments.map((z) => z.id);
    for (const id of eigene) {
      expect(imFenster.filter((kandidat) => kandidat === id)).toHaveLength(1);
    }
  });

  it("lehnt denselben Schluessel mit anderem Kommando ab", async () => {
    // Gleicher Schluessel, anderes Team: dieselbe Ablehnung wie bei
    // `createAssignment` mit wiederverwendetem Schluessel — der Typ macht sie
    // von einer "Fixture erweitern"-Ablehnung unterscheidbar, denn beide
    // tragen `failure: "REJECTED"`.
    const ANDERE_PERSON = "3f2504e0-4f89-41d3-9a0c-0305e82c3320";
    const mock = makeMock();
    const erster = await mock.createEngagement(EINSATZ, { idempotencyKey: SCHLUESSEL });
    expect(erster.ok).toBe(true);
    const anderes = await mock.createEngagement(
      { ...EINSATZ, team: [ANDERE_PERSON] },
      { idempotencyKey: SCHLUESSEL },
    );
    expect(anderes.ok).toBe(false);
    if (anderes.ok) return;
    expect(anderes.failure).toBe("REJECTED");
    expect(anderes.problem?.type).toBe(PLANNING_PROBLEM_TYPE.idempotencyKeyReused);
    expect(anderes.problem?.status).toBe(409);
  });
});
