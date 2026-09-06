/**
 * Die WorksiteDay-Transportgrenze (EYT-147, Meilenstein M2, Jira EYT-151).
 *
 * ## Was hier gemessen wird — und was ausdruecklich nicht
 *
 * Nur der VERTRAG. M2 baut keine Businesslogik: es gibt keinen Server, der
 * einen Baustellentag anlegt, und keine Repository-Projektion, die
 * `worksiteDays` fuellt. Was diese Datei belegt, ist die Form, die beide Seiten
 * spaeter einhalten muessen — Schemata, Regeln, Asymmetrien.
 *
 * ## Die Asymmetrie, die keine Nachlaessigkeit ist
 *
 * `team: []` ist im KOMMANDO verboten und in der ANTWORT erlaubt. Confluence
 * 41484289 §2 Nr. 8 verlangt das erste ("ein leerer Baustellentag wird nicht
 * still erzeugt oder veroeffentlicht"). Das zweite folgt aus der Gegenrichtung:
 * ein Antwortschema, das den leeren Tag verbietet, macht aus einer einzelnen
 * unvollstaendigen Zeile eine unlesbare GESAMTE Planungsantwort — der Client
 * verwirft dann das ganze Fenster. Wer die beiden Seiten vereinheitlicht,
 * bricht genau eine der zwei Zusagen.
 */
import { describe, expect, it } from "vitest";

import {
  CONFLICT_CODE_VALUES,
  PlanningWindowSchema,
  PlanWorksiteDayCommandSchema,
  UpdateWorksiteDayTeamCommandSchema,
  WORKSITE_DAY_PROBLEM_TYPE,
  WorksiteDayDtoSchema,
  WorksiteDayTeamCommandSchema,
  WorksiteDayTeamEntrySchema,
  WorksiteDayTeamMemberSchema,
} from "../src/planning/schemas.js";

const WORKSITE_DAY_ID = "00000000-0000-4000-8000-00000000d001";
const CONFIGURATION_ID = "00000000-0000-4000-8000-00000000c001";
const WORKSITE_ID = "00000000-0000-4000-8000-00000000a001";
/**
 * Eine ZWEITE, ebenfalls bekannte Baustelle.
 *
 * Nicht dasselbe wie {@link WORKSITE_FREMD}: die ist unbekannt und faellt schon
 * an der Aufloesbarkeit. Fuer die Uebereinstimmungsregel braucht es zwei Namen,
 * die beide in `resources.worksites` stehen — sonst misst der Fall die
 * Aufloesbarkeit und nicht den Vergleich.
 */
const WORKSITE_ZWEI = "00000000-0000-4000-8000-00000000a002";
const WORKSITE_FREMD = "00000000-0000-4000-8000-00000000a999";
const PERSON_A = "00000000-0000-4000-8000-0000000000a1";
const PERSON_B = "00000000-0000-4000-8000-0000000000b1";
const EINSATZ_1 = "00000000-0000-4000-8000-0000000000e1";
const EINSATZ_2 = "00000000-0000-4000-8000-0000000000e2";
const ENTWURF_ID = "00000000-0000-4000-8000-00000000f001";

/** Halb-offen, wie `TimeIntervalDtoSchema` es verlangt. */
const FRUEH = { startUtc: "2026-08-03T06:00:00.000Z", endUtc: "2026-08-03T10:00:00.000Z" };
const SPAET = { startUtc: "2026-08-03T12:00:00.000Z", endUtc: "2026-08-03T16:00:00.000Z" };
/** Ueberschneidet FRUEH um eine Stunde. */
const UEBERLAPPEND = { startUtc: "2026-08-03T09:00:00.000Z", endUtc: "2026-08-03T11:00:00.000Z" };

const WOCHE = "2026-W32";
const TAG = "2026-08-03";

function baustellentag(team: unknown = []): Record<string, unknown> {
  return {
    worksiteDayId: WORKSITE_DAY_ID,
    configurationId: CONFIGURATION_ID,
    worksiteId: WORKSITE_ID,
    localDate: TAG,
    lockVersion: 0,
    team,
  };
}

function kommando(team: unknown): unknown {
  return { weekKey: WOCHE, worksiteId: WORKSITE_ID, localDate: TAG, team };
}

function teamAenderung(team: unknown): unknown {
  return { weekKey: WOCHE, worksiteDayId: WORKSITE_DAY_ID, expectedLockVersion: 0, team };
}

describe("WorksiteDayTeamCommand — Regeln eines Kommandoteams", () => {
  it("nimmt einen einzelnen Eintrag an", () => {
    expect(
      WorksiteDayTeamEntrySchema.safeParse({ employeeId: PERSON_A, interval: FRUEH }).success,
    ).toBe(true);
    expect(
      WorksiteDayTeamCommandSchema.safeParse([{ employeeId: PERSON_A, interval: FRUEH }]).success,
    ).toBe(true);
  });

  it("lehnt ein verkehrtes Intervall im Eintrag ab — dieselbe Regel wie ueberall", () => {
    // `TimeIntervalDtoSchema` verlangt endUtc > startUtc; der Teameintrag erbt
    // die Regel, statt sie nachzubauen. Ohne diesen Fall koennte jemand hier ein
    // eigenes, lockereres Intervallschema einsetzen, und niemand merkte es.
    const verkehrt = { startUtc: FRUEH.endUtc, endUtc: FRUEH.startUtc };
    expect(
      WorksiteDayTeamCommandSchema.safeParse([{ employeeId: PERSON_A, interval: verkehrt }])
        .success,
    ).toBe(false);
  });

  it("lehnt ein identisches (employeeId, interval)-Paar doppelt ab — als DUPLIKAT benannt", () => {
    const ergebnis = WorksiteDayTeamCommandSchema.safeParse([
      { employeeId: PERSON_A, interval: FRUEH },
      { employeeId: PERSON_A, interval: { ...FRUEH } },
    ]);
    expect(ergebnis.success).toBe(false);
    if (ergebnis.success) return;

    // ## Warum die MELDUNG geprueft wird und nicht nur `success`
    //
    // Ein identisches Paar ueberlappt sich selbst. Ein Fall, der nur `success`
    // zusichert, bleibt deshalb auch dann rot, wenn man den Duplikatzweig
    // ersatzlos loescht — die Ueberlappungsregel faengt ihn dann. Der Test waere
    // gruen, die Regel weg, und die Planerin suchte nach einer Zeitkollision, wo
    // sie zweimal dieselbe Zeile abgeschickt hat. Erst die Meldung trennt die
    // beiden Regeln, und erst damit gibt es eine Gegenmutation, die feuert.
    const meldungen = ergebnis.error.issues.map((i) => i.message).join(" | ");
    expect(meldungen).toContain("zweimal im Team");
    expect(meldungen).not.toContain("ueberlappen sich");
  });

  it("lehnt ueberlappende Intervalle derselben Person ab — als UEBERLAPPUNG benannt", () => {
    const ergebnis = WorksiteDayTeamCommandSchema.safeParse([
      { employeeId: PERSON_A, interval: FRUEH },
      { employeeId: PERSON_A, interval: UEBERLAPPEND },
    ]);
    expect(ergebnis.success).toBe(false);
    if (ergebnis.success) return;
    // Gegenstueck zum Duplikatfall: hier muss GENAU die andere Meldung stehen.
    // Zusammen zwingen die beiden Faelle die zwei Regeln auseinander.
    const meldungen = ergebnis.error.issues.map((i) => i.message).join(" | ");
    expect(meldungen).toContain("ueberlappen sich");
    expect(meldungen).not.toContain("zweimal im Team");
  });

  it("nimmt zwei getrennte, nicht ueberlappende Intervalle derselben Person an", () => {
    // Der Fall, den die Ueberlappungsregel NICHT verschlucken darf: eine Person
    // kann vormittags und nachmittags auf derselben Baustelle stehen
    // (Confluence 41484289 §2 Nr. 4).
    expect(
      WorksiteDayTeamCommandSchema.safeParse([
        { employeeId: PERSON_A, interval: FRUEH },
        { employeeId: PERSON_A, interval: SPAET },
      ]).success,
    ).toBe(true);
  });

  it("nimmt mehrere unterschiedliche Teammitglieder an", () => {
    expect(
      WorksiteDayTeamCommandSchema.safeParse([
        { employeeId: PERSON_A, interval: FRUEH },
        { employeeId: PERSON_B, interval: FRUEH },
      ]).success,
    ).toBe(true);
  });

  it("bezieht die Ueberlappungsregel auf die Person, nicht auf den Tag", () => {
    // Gegenprobe zur Zeile darueber: waere die Regel personenblind, waere
    // dasselbe Intervall fuer zwei verschiedene Personen bereits ein Konflikt.
    expect(
      WorksiteDayTeamCommandSchema.safeParse([
        { employeeId: PERSON_A, interval: UEBERLAPPEND },
        { employeeId: PERSON_B, interval: FRUEH },
      ]).success,
    ).toBe(true);
  });

  it("lehnt ein leeres Team ab — ein Baustellentag entsteht nicht ohne Besetzung", () => {
    expect(WorksiteDayTeamCommandSchema.safeParse([]).success).toBe(false);
  });
});

describe("WorksiteDayDto", () => {
  it("traegt Identitaet und Konfigurationsrevision unabhaengig voneinander", () => {
    const dto = WorksiteDayDtoSchema.parse(baustellentag());
    expect(dto.worksiteDayId).toBe(WORKSITE_DAY_ID);
    expect(dto.configurationId).toBe(CONFIGURATION_ID);
    expect(dto.worksiteDayId).not.toBe(dto.configurationId);

    // Die eigentliche Aussage: vertauscht ergibt ein ANDERES Objekt. Waere eins
    // ein Alias des anderen, waeren beide Ergebnisse gleich.
    const vertauscht = WorksiteDayDtoSchema.parse({
      ...baustellentag(),
      worksiteDayId: CONFIGURATION_ID,
      configurationId: WORKSITE_DAY_ID,
    });
    expect(vertauscht).not.toEqual(dto);
    expect(vertauscht.worksiteDayId).toBe(CONFIGURATION_ID);
  });

  it("verlangt BEIDE Ids — ohne Revision ist der Tag nicht adressierbar, ohne Identitaet nicht wiedererkennbar", () => {
    const ohneRevision = Object.fromEntries(
      Object.entries(baustellentag()).filter(([k]) => k !== "configurationId"),
    );
    const ohneIdentitaet = Object.fromEntries(
      Object.entries(baustellentag()).filter(([k]) => k !== "worksiteDayId"),
    );
    expect(WorksiteDayDtoSchema.safeParse(ohneRevision).success).toBe(false);
    expect(WorksiteDayDtoSchema.safeParse(ohneIdentitaet).success).toBe(false);
  });

  it("nimmt ein leeres Team an", () => {
    expect(WorksiteDayDtoSchema.safeParse(baustellentag([])).success).toBe(true);
  });

  it("nimmt ein Teammitglied mit Assignment-Id an", () => {
    const mitglied = { assignmentId: EINSATZ_1, employeeId: PERSON_A, interval: FRUEH };
    expect(WorksiteDayTeamMemberSchema.safeParse(mitglied).success).toBe(true);
    expect(WorksiteDayDtoSchema.safeParse(baustellentag([mitglied])).success).toBe(true);
  });

  it("verlangt lockVersion als ganze Zahl ab null", () => {
    expect(WorksiteDayDtoSchema.safeParse({ ...baustellentag(), lockVersion: 0 }).success).toBe(
      true,
    );
    expect(WorksiteDayDtoSchema.safeParse({ ...baustellentag(), lockVersion: -1 }).success).toBe(
      false,
    );
    expect(WorksiteDayDtoSchema.safeParse({ ...baustellentag(), lockVersion: 1.5 }).success).toBe(
      false,
    );
  });

  it("lehnt einen kalendarisch unmoeglichen localDate ab", () => {
    expect(
      WorksiteDayDtoSchema.safeParse({ ...baustellentag(), localDate: "2026-02-30" }).success,
    ).toBe(false);
  });
});

describe("Kommando/Antwort-Asymmetrie beim leeren Team", () => {
  it("lehnt team: [] im PlanWorksiteDayCommand ab", () => {
    expect(PlanWorksiteDayCommandSchema.safeParse(kommando([])).success).toBe(false);
  });

  it("lehnt team: [] im UpdateWorksiteDayTeamCommand ab", () => {
    expect(UpdateWorksiteDayTeamCommandSchema.safeParse(teamAenderung([])).success).toBe(false);
  });

  it("nimmt team: [] im WorksiteDayDto an", () => {
    expect(WorksiteDayDtoSchema.safeParse(baustellentag([])).success).toBe(true);
  });
});

describe("UpdateWorksiteDayTeamCommand adressiert die stabile Identitaet", () => {
  it("nimmt weekKey, worksiteDayId, expectedLockVersion und team an", () => {
    const ergebnis = UpdateWorksiteDayTeamCommandSchema.safeParse(
      teamAenderung([{ employeeId: PERSON_A, interval: FRUEH }]),
    );
    expect(ergebnis.success).toBe(true);
  });

  it("kennt weder configurationId noch localDate", () => {
    // Beide waeren stille Zweitwahrheiten: die Revision ist durch weekKey
    // eindeutig (hoechstens ein Draft je Woche, 41484289 §4), der Stand durch
    // expectedLockVersion, der Tag steht an der Identitaet. Ein Kommando, das
    // sie mitschickt, koennte ihnen widersprechen.
    const basis = teamAenderung([{ employeeId: PERSON_A, interval: FRUEH }]) as Record<
      string,
      unknown
    >;
    expect(
      UpdateWorksiteDayTeamCommandSchema.safeParse({ ...basis, configurationId: CONFIGURATION_ID })
        .success,
    ).toBe(false);
    expect(UpdateWorksiteDayTeamCommandSchema.safeParse({ ...basis, localDate: TAG }).success).toBe(
      false,
    );
  });

  it("verlangt expectedLockVersion als ganze Zahl ab null", () => {
    const team = [{ employeeId: PERSON_A, interval: FRUEH }];
    for (const wert of [-1, 1.5, "0", null, undefined]) {
      expect(
        UpdateWorksiteDayTeamCommandSchema.safeParse({
          ...(teamAenderung(team) as Record<string, unknown>),
          expectedLockVersion: wert,
        }).success,
        `expectedLockVersion ${JSON.stringify(wert)} wurde angenommen`,
      ).toBe(false);
    }
  });

  it("wendet dieselben Teamregeln an wie das Anlegekommando", () => {
    expect(
      UpdateWorksiteDayTeamCommandSchema.safeParse(
        teamAenderung([
          { employeeId: PERSON_A, interval: FRUEH },
          { employeeId: PERSON_A, interval: UEBERLAPPEND },
        ]),
      ).success,
    ).toBe(false);
  });
});

describe("Striktheit der neuen Schemata", () => {
  /**
   * ## Warum das ein eigener Fall ist und nicht der Drift-Test genuegt
   *
   * `openapi-drift.test.ts` sichert zu, dass jedes Antwortobjekt im erzeugten
   * Dokument `additionalProperties: false` traegt. Fuer DIESE Eigenschaft misst
   * das nichts: gemessen mit zod 4.4.3 gibt `z.toJSONSchema` fuer `z.object` und
   * `z.strictObject` dasselbe `additionalProperties: false` aus. Der Unterschied
   * existiert nur zur LAUFZEIT — `z.object` entfernt einen unbekannten Schluessel
   * still und meldet Erfolg. Faellt eines dieser Schemata auf `z.object` zurueck,
   * bliebe `v1.json` byteweise gleich und der Drift-Test gruen, waehrend ein
   * undokumentiertes Feld durch die Leitung ginge.
   *
   * Geprueft wird deshalb das Verhalten, tabellengetrieben, damit ein spaeter
   * hinzugefuegtes Schema als fehlende Zeile auffaellt und nicht als Luecke.
   */
  const STRENGE: ReadonlyArray<{
    readonly name: string;
    readonly schema: { safeParse: (wert: unknown) => { success: boolean } };
    readonly gueltig: () => Record<string, unknown>;
  }> = [
    {
      name: "WorksiteDayTeamEntrySchema",
      schema: WorksiteDayTeamEntrySchema,
      gueltig: () => ({ employeeId: PERSON_A, interval: FRUEH }),
    },
    {
      name: "WorksiteDayTeamMemberSchema",
      schema: WorksiteDayTeamMemberSchema,
      gueltig: () => ({ assignmentId: EINSATZ_1, employeeId: PERSON_A, interval: FRUEH }),
    },
    {
      name: "WorksiteDayDtoSchema",
      schema: WorksiteDayDtoSchema,
      gueltig: () => baustellentag(),
    },
    {
      name: "PlanWorksiteDayCommandSchema",
      schema: PlanWorksiteDayCommandSchema,
      gueltig: () =>
        kommando([{ employeeId: PERSON_A, interval: FRUEH }]) as Record<string, unknown>,
    },
    {
      name: "UpdateWorksiteDayTeamCommandSchema",
      schema: UpdateWorksiteDayTeamCommandSchema,
      gueltig: () =>
        teamAenderung([{ employeeId: PERSON_A, interval: FRUEH }]) as Record<string, unknown>,
    },
  ];

  it("deckt jedes neue Objektschema ab — sonst misst diese Tabelle zu wenig", () => {
    // Vakanzschutz: ohne diese Zeile waere die Tabelle auch dann gruen, wenn sie
    // versehentlich leer liefe oder ein Schema stillschweigend herausfiele.
    expect(STRENGE.map((s) => s.name)).toEqual([
      "WorksiteDayTeamEntrySchema",
      "WorksiteDayTeamMemberSchema",
      "WorksiteDayDtoSchema",
      "PlanWorksiteDayCommandSchema",
      "UpdateWorksiteDayTeamCommandSchema",
    ]);
  });

  for (const eintrag of STRENGE) {
    it(`${eintrag.name} nimmt seinen gueltigen Rumpf an und lehnt einen Fremdschluessel ab`, () => {
      // Beide Richtungen. Ohne die positive Haelfte waere die negative auch dann
      // gruen, wenn der Rumpf aus einem ganz anderen Grund durchfaellt.
      expect(eintrag.schema.safeParse(eintrag.gueltig()).success).toBe(true);
      expect(
        eintrag.schema.safeParse({ ...eintrag.gueltig(), fremdesFeld: "geheim" }).success,
        `${eintrag.name} verschluckt unbekannte Schluessel — z.object statt z.strictObject?`,
      ).toBe(false);
    });
  }
});

describe("WORKSITE_DAY_PROBLEM_TYPE — Vokabular der Tagescommands", () => {
  it("folgt dem URN-Muster der Planung und traegt genau die fuenf M3/M4-Faelle", () => {
    // Dasselbe Muster wie PLANNING_ERROR_TYPE in apps/api
    // (planning-problem.filter.ts): urn:easytree:planning:<kebab>. M3/M4 IMPORTIEREN
    // diese Konstante, statt die Zeichenketten erneut zu tippen.
    expect(Object.keys(WORKSITE_DAY_PROBLEM_TYPE).sort()).toEqual([
      "DUPLICATE_WORKSITE_DAY",
      "INTERVAL_OUTSIDE_DAY",
      "STALE_WORKSITE_DAY",
      "WORKSITE_DAY_NOT_FOUND",
      "WORKSITE_DAY_TEAM_REQUIRED",
    ]);
    for (const urn of Object.values(WORKSITE_DAY_PROBLEM_TYPE)) {
      expect(urn).toMatch(/^urn:easytree:planning:[a-z-]+$/);
    }
    expect(new Set(Object.values(WORKSITE_DAY_PROBLEM_TYPE)).size).toBe(5);
  });

  it("fuehrt WORKSITE_DAY_INCOMPLETE NICHT — das ist ein reiner Publish-Typ (M5)", () => {
    // Ein unvollstaendiger Baustellentag ist beim Lesen und Bearbeiten voellig in
    // Ordnung und wird erst beim Veroeffentlichen zum Hindernis. Stuende er in
    // `CONFLICT_CODE_VALUES`, veroeffentlichte `v1.json` ihn als gewoehnlichen
    // Konfliktcode und ein Client duerfte ihn wie eine Ueberlappung behandeln.
    const alles = [...CONFLICT_CODE_VALUES, ...Object.keys(WORKSITE_DAY_PROBLEM_TYPE)].join(" ");
    expect(alles).not.toContain("WORKSITE_DAY_INCOMPLETE");
    expect(Object.values(WORKSITE_DAY_PROBLEM_TYPE).join(" ")).not.toContain(
      "worksite-day-incomplete",
    );
  });

  it("laesst die bestehende Konfliktcodeliste unveraendert", () => {
    // Gegenprobe zur Zeile darueber: ohne sie waere das Verbot auch dann gruen,
    // wenn jemand die Liste komplett leerte.
    expect([...CONFLICT_CODE_VALUES]).toEqual([
      "EMPLOYEE_INTERVAL_OVERLAP",
      "EMPLOYEE_WEEKLY_CAPACITY",
      "EMPLOYEE_INACTIVE",
      "WORKSITE_NOT_PUBLISHABLE",
    ]);
  });
});

/** Ein Fenster, das ohne die WorksiteDay-Erweiterung schon gueltig ist. */
function fenster(zusatz: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    weekKey: WOCHE,
    timeZone: "Europe/Berlin",
    assignments: [
      { id: EINSATZ_1, employeeId: PERSON_A, worksiteId: WORKSITE_ID, interval: FRUEH },
      { id: EINSATZ_2, employeeId: PERSON_B, worksiteId: WORKSITE_ID, interval: SPAET },
    ],
    sourceVersion: { id: ENTWURF_ID, state: "draft" },
    publishedVersionId: null,
    resources: {
      employees: [
        { id: PERSON_A, label: "Anna", active: true },
        { id: PERSON_B, label: "Bruno", active: true },
      ],
      worksites: [{ id: WORKSITE_ID, label: "Baustelle Nord", active: true }],
    },
    ...zusatz,
  };
}

function tagImFenster(team: unknown): Record<string, unknown> {
  return { ...baustellentag(team), worksiteId: WORKSITE_ID };
}

const MITGLIED_1 = { assignmentId: EINSATZ_1, employeeId: PERSON_A, interval: FRUEH };
const MITGLIED_2 = { assignmentId: EINSATZ_2, employeeId: PERSON_B, interval: SPAET };

describe("PlanningWindow.worksiteDays — additive Projektion", () => {
  it("bleibt ohne das Feld gueltig: Legacy-Assignments ohne Baustellentag", () => {
    // Die Kernzusage der Additivitaet. Der heutige Server sendet `worksiteDays`
    // nicht; seine Antwort muss weiterhin parsen.
    expect(PlanningWindowSchema.safeParse(fenster()).success).toBe(true);
  });

  it("nimmt ein vollstaendiges Fenster mit Assignments UND Baustellentagen an", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([MITGLIED_1, MITGLIED_2])] }),
    );
    expect(ergebnis.success).toBe(true);
  });

  it("nimmt ein leeres worksiteDays-Array an", () => {
    expect(PlanningWindowSchema.safeParse(fenster({ worksiteDays: [] })).success).toBe(true);
  });

  it("lehnt einen Baustellentag auf einer unbekannten Baustelle ab", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({
        worksiteDays: [{ ...tagImFenster([MITGLIED_1]), worksiteId: WORKSITE_FREMD }],
      }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt eine unbekannte assignmentId im Team ab", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({
        worksiteDays: [
          tagImFenster([{ ...MITGLIED_1, assignmentId: "00000000-0000-4000-8000-0000000000ff" }]),
        ],
      }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt ein Teammitglied ab, dessen employeeId dem Assignment widerspricht", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([{ ...MITGLIED_1, employeeId: PERSON_B }])] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt ein Teammitglied ab, dessen Intervall dem Assignment widerspricht", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([{ ...MITGLIED_1, interval: SPAET }])] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt dieselbe Assignment-Id in zwei Baustellentagen ab", () => {
    const zweiterTag = {
      ...tagImFenster([MITGLIED_1]),
      worksiteDayId: "00000000-0000-4000-8000-00000000d002",
      configurationId: "00000000-0000-4000-8000-00000000c002",
      localDate: "2026-08-04",
    };
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([MITGLIED_1]), zweiterTag] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  /**
   * Ein Fenster, in dem BEIDE Baustellen bekannt sind.
   *
   * `einsatzBaustelle` entscheidet, auf welcher Baustelle `EINSATZ_1` liegt.
   * Der Baustellentag zeigt unveraendert auf {@link WORKSITE_ID} — damit ist
   * die Uebereinstimmung die EINZIGE Groesse, die sich zwischen den beiden
   * Richtungen dieses Falls unterscheidet.
   */
  function fensterMitZweiBaustellen(einsatzBaustelle: string): Record<string, unknown> {
    return fenster({
      assignments: [
        { id: EINSATZ_1, employeeId: PERSON_A, worksiteId: einsatzBaustelle, interval: FRUEH },
        { id: EINSATZ_2, employeeId: PERSON_B, worksiteId: WORKSITE_ID, interval: SPAET },
      ],
      resources: {
        employees: [
          { id: PERSON_A, label: "Anna", active: true },
          { id: PERSON_B, label: "Bruno", active: true },
        ],
        worksites: [
          { id: WORKSITE_ID, label: "Baustelle Nord", active: true },
          { id: WORKSITE_ZWEI, label: "Baustelle Sued", active: true },
        ],
      },
      worksiteDays: [tagImFenster([MITGLIED_1])],
    });
  }

  it("lehnt ein Teammitglied ab, dessen Zuweisung auf einer ANDEREN Baustelle liegt", () => {
    // PO-Review 15164, Important 1. Person, Intervall und Assignment-Id stimmen
    // vollstaendig ueberein — nur die Baustelle nicht. Ohne diese Regel passiert
    // ein fachlich widerspruechlicher Payload die Runtime-Validation: die
    // Tageskarte zeigt die Person auf Baustelle Nord, die Einsatzliste auf
    // Baustelle Sued, und beide Ansichten sehen fuer sich richtig aus.
    const ergebnis = PlanningWindowSchema.safeParse(fensterMitZweiBaustellen(WORKSITE_ZWEI));
    expect(ergebnis.success).toBe(false);
  });

  it("nimmt dasselbe Fenster an, sobald Zuweisung und Tag dieselbe Baustelle nennen", () => {
    // Gegenprobe zur Zeile darueber. Ohne sie waere der negative Fall auch dann
    // gruen, wenn die zweite Baustelle aus einem ganz anderen Grund durchfiele.
    const ergebnis = PlanningWindowSchema.safeParse(fensterMitZweiBaustellen(WORKSITE_ID));
    expect(ergebnis.success).toBe(true);
  });

  it("lehnt dieselbe worksiteDayId zweimal als primaere Tageszeile ab", () => {
    // PO-Review 15164, Important 2 (A). Die Teams sind ABSICHTLICH verschieden,
    // sonst schluege die bestehende Assignment-Einmaligkeit zu und der Fall
    // maesse sie statt der Identitaet.
    const zweiterTag = {
      ...tagImFenster([MITGLIED_2]),
      configurationId: "00000000-0000-4000-8000-00000000c002",
      localDate: "2026-08-04",
    };
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([MITGLIED_1]), zweiterTag] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("lehnt dieselbe configurationId zweimal als primaere Tageszeile ab", () => {
    // PO-Review 15164, Important 2 (B). Gleiche Bauart, andere Achse: die
    // Identitaeten unterscheiden sich, die Revision nicht.
    const zweiterTag = {
      ...tagImFenster([MITGLIED_2]),
      worksiteDayId: "00000000-0000-4000-8000-00000000d002",
      localDate: "2026-08-04",
    };
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([MITGLIED_1]), zweiterTag] }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("nimmt zwei Tageszeilen mit verschiedenen Ids an", () => {
    // Gegenprobe zu den beiden Zeilen darueber: der Waechter darf nicht jede
    // zweite Tageszeile ablehnen, sondern nur die doppelte.
    const zweiterTag = {
      ...tagImFenster([MITGLIED_2]),
      worksiteDayId: "00000000-0000-4000-8000-00000000d002",
      configurationId: "00000000-0000-4000-8000-00000000c002",
      localDate: "2026-08-04",
    };
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({ worksiteDays: [tagImFenster([MITGLIED_1]), zweiterTag] }),
    );
    expect(ergebnis.success).toBe(true);
  });

  it("lehnt Baustellentage ohne sourceVersion ab", () => {
    const ergebnis = PlanningWindowSchema.safeParse(
      fenster({
        assignments: [],
        sourceVersion: null,
        publishedVersionId: null,
        worksiteDays: [tagImFenster([])],
      }),
    );
    expect(ergebnis.success).toBe(false);
  });

  it("laesst die bestehende Assignment-Projektion unangetastet", () => {
    // Gegenprobe: die alten Regeln muessen weiter feuern, sonst haette die
    // Erweiterung sie ersetzt statt ergaenzt.
    const unaufloesbar = PlanningWindowSchema.safeParse(
      fenster({
        assignments: [
          { id: EINSATZ_1, employeeId: PERSON_A, worksiteId: WORKSITE_FREMD, interval: FRUEH },
        ],
      }),
    );
    expect(unaufloesbar.success).toBe(false);

    const ohneHerkunft = PlanningWindowSchema.safeParse(
      fenster({ sourceVersion: null, publishedVersionId: null }),
    );
    expect(ohneHerkunft.success).toBe(false);
  });
});
