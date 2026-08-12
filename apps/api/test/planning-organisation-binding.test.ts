/**
 * Bindung der Planungsabfragen an eine bereits serverseitig aufgeloeste
 * Organisation (EYT-109, Multi-Org-Gate).
 *
 * ## Was diese Datei beweist — und was nicht
 *
 * Bewiesen wird die NAHT: welcher Parameter im SQL ankommt, und welche der
 * sichtbaren Organisationen das Repository daraufhin waehlt. Dass RLS die
 * Sichtbarkeit richtig herstellt, ist eine andere Aussage und steht in
 * `planning-published-reads.integration.test.ts` gegen echtes PostgreSQL.
 *
 * ## Warum die Attrappe filtern DARF
 *
 * Sie filtert nur ueber `params` — also ueber das, was das Repository ihr
 * uebergeben hat. Bleibt der Parameter aus (Gegenmutation GM-MO-1), liefert sie
 * beide Zeilen, und das Repository muss `AMBIGUOUS_ORGANISATION` antworten. Der
 * Fall wird dann rot, ohne dass die Attrappe die Regel selbst kennt.
 */
import { describe, expect, it } from "vitest";

import { PlanningWindowRepository } from "../src/modules/planning";
import type { TenantQuery, TenantQueryRunner } from "../src/platform/database/tenant-query-runner";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";
/** Existiert nicht und ist fuer niemanden sichtbar. */
const ORG_FREMD = "00000000-0000-4000-8000-0000000000c3";

interface OrgZeile {
  readonly id: string;
  readonly time_zone: string;
}

interface Aufzeichnung {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const ALPHA: OrgZeile = { id: ORG_A, time_zone: "Europe/Berlin" };
const BETA: OrgZeile = { id: ORG_B, time_zone: "Europe/Vienna" };

/**
 * Ein Runner, der die RLS-sichtbare Menge stellt und jede Query mitschreibt.
 *
 * Alles ausser `organizations` antwortet leer — diese Suite misst die Auswahl
 * der Organisation, nicht die Nutzdaten.
 */
function runnerMit(sichtbar: readonly OrgZeile[], protokoll: Aufzeichnung[]): TenantQueryRunner {
  const tx: TenantQuery = {
    query: <TRow>(sql: string, params: readonly unknown[] = []) => {
      protokoll.push({ sql, params });
      if (!sql.includes("from public.organizations")) {
        return Promise.resolve({ rows: [] as TRow[], rowCount: 0 });
      }
      const gefiltert =
        params.length === 0 ? sichtbar : sichtbar.filter((org) => org.id === params[0]);
      return Promise.resolve({
        rows: gefiltert as unknown as TRow[],
        rowCount: gefiltert.length,
      });
    },
  };
  return { run: (_kontext, work) => work(tx) };
}

/** Die Abfrage, die die Organisation aufloest — es gibt genau eine je Lauf. */
function organisationsAbfrage(protokoll: readonly Aufzeichnung[]): Aufzeichnung {
  const treffer = protokoll.filter((zeile) => zeile.sql.includes("from public.organizations"));
  expect(treffer, "es muss genau EINE Organisationsabfrage geben").toHaveLength(1);
  return treffer[0] as Aufzeichnung;
}

describe("PlanningWindowRepository — Organisationsbindung (EYT-109)", () => {
  // M1
  it("liest ohne Bindung unveraendert, wenn genau eine Organisation sichtbar ist", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(runnerMit([ALPHA], protokoll), USER);

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.window.timeZone).toBe("Europe/Berlin");
    // Ungebunden heisst: KEIN Parameter. Der Text bleibt der bisherige.
    expect(organisationsAbfrage(protokoll).params).toHaveLength(0);
  });

  // M2
  it("bleibt ohne Bindung bei zwei Mitgliedschaften mehrdeutig", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(runnerMit([ALPHA, BETA], protokoll), USER);

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    // Kein „erste Zeile gewinnt". Die Auswahl muss sichtbar getroffen werden.
    expect(ergebnis.problem).toBe("AMBIGUOUS_ORGANISATION");
  });

  // M3
  it("liest mit Bindung auf A ausschliesslich A", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokoll),
      USER,
      ORG_A,
    );

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.window.timeZone).toBe("Europe/Berlin");
    expect(ergebnis.window.timeZone).not.toBe("Europe/Vienna");
  });

  // M4 — der Beweis, dass nicht schlicht die erste Zeile genommen wird.
  it("liest mit Bindung auf B ausschliesslich B", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokoll),
      USER,
      ORG_B,
    );

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    // ALPHA steht in der sichtbaren Menge VORNE. Waere die Bindung wirkungslos
    // oder ein „first row wins", staende hier Europe/Berlin.
    expect(ergebnis.window.timeZone).toBe("Europe/Vienna");
  });

  // M5
  it("liefert bei einer nicht sichtbaren Organisation nichts und faellt auf keine sichtbare zurueck", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokoll),
      USER,
      ORG_FREMD,
    );

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("NO_ORGANISATION");
  });

  // M5, zweite Haelfte: die Bindung wirkt auch auf die versionsgenauen Wege.
  it("bindet auch publishedVersions und publishedAssignments", async () => {
    const protokollListe: Aufzeichnung[] = [];
    const liste = await new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokollListe),
      USER,
      ORG_FREMD,
    ).publishedVersions("2026-W02", "2026-W03");
    expect(liste.ok).toBe(false);
    if (!liste.ok) expect(liste.problem).toBe("NO_ORGANISATION");

    const protokollStand: Aufzeichnung[] = [];
    const stand = await new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokollStand),
      USER,
      ORG_FREMD,
    ).publishedAssignments("00000000-0000-4000-8000-0000000f0f0f");
    expect(stand.ok).toBe(false);
    if (!stand.ok) expect(stand.problem).toBe("NO_ORGANISATION");
  });

  // M7
  it("uebergibt die Organisation als Parameter und interpoliert sie nicht", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokoll),
      USER,
      ORG_B,
    );

    await repository.planningWindow("2026-W02");

    const abfrage = organisationsAbfrage(protokoll);
    expect(abfrage.params).toEqual([ORG_B]);
    expect(abfrage.sql).toContain("$1");
    // Der Kern: die Id steht NICHT im Text. Waere sie interpoliert, staende sie hier.
    expect(abfrage.sql).not.toContain(ORG_B);
  });

  // M7, Gegenprobe mit einer boesartigen Eingabe
  it("behandelt eine SQL-artige Eingabe als Wert, nicht als Text", async () => {
    const protokoll: Aufzeichnung[] = [];
    const boese = "' or true --";
    const repository = new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokoll),
      USER,
      boese,
    );

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("NO_ORGANISATION");
    const abfrage = organisationsAbfrage(protokoll);
    expect(abfrage.sql).not.toContain(boese);
    expect(abfrage.params).toEqual([boese]);
  });
});
