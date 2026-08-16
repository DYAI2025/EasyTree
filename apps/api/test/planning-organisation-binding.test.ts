/**
 * Bindung der Planungsabfragen an eine bereits serverseitig aufgeloeste
 * Organisation (EYT-109, Multi-Org-Gate).
 *
 * ## Was diese Datei beweist — und was nicht
 *
 * Bewiesen werden zwei Naehte. Erstens die AUFLOESUNG: welcher Parameter im SQL
 * ankommt, und welche der sichtbaren Organisationen das Repository daraufhin
 * waehlt (`runnerMit`). Zweitens die VERENGUNG: dass die Nutzdatenabfragen die
 * aufgeloeste Organisation ebenfalls nennen, statt ueber alle Mitgliedschaften
 * zu vereinigen (`runnerMitRls`). Dass RLS die Sichtbarkeit richtig herstellt,
 * ist eine dritte Aussage und steht in
 * `planning-published-reads.integration.test.ts` gegen echtes PostgreSQL.
 *
 * ## Warum die Attrappe filtern DARF
 *
 * Sie filtert nur ueber `params` — also ueber das, was das Repository ihr
 * uebergeben hat. Bleibt der Parameter aus (Gegenmutation GM-MO-1), liefert sie
 * beide Zeilen, und das Repository muss `AMBIGUOUS_ORGANISATION` antworten. Der
 * Fall wird dann rot, ohne dass die Attrappe die Regel selbst kennt.
 *
 * Dasselbe gilt fuer `runnerMitRls`: er haelt die Zeilen BEIDER Organisationen
 * — das ist RLS, eine Vereinigung ueber alle aktiven Mitgliedschaften — und
 * ehrt ausschliesslich Bedingungen, die im SQL tatsaechlich stehen. Fehlt
 * `org_id = $n`, liefert er beide Mandanten und der Fall wird rot. Er kennt
 * keine Regel, die der Code nicht ausspricht.
 */
import { describe, expect, it } from "vitest";

import { PlanningWindowRepository } from "../src/modules/planning";
import type { TenantQuery, TenantQueryRunner } from "../src/platform/database/tenant-query-runner";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";
/** Existiert nicht und ist fuer niemanden sichtbar. */
const ORG_FREMD = "00000000-0000-4000-8000-0000000000c3";

/** Planversionen, Personen und Baustellen je Mandant — je genau eine. */
const VERSION_A = "00000000-0000-4000-8000-00000000ba01";
const VERSION_B = "00000000-0000-4000-8000-00000000ba02";
const PERSON_A = "00000000-0000-4000-8000-00000000e001";
const PERSON_B = "00000000-0000-4000-8000-00000000e002";
const BAUSTELLE_A = "00000000-0000-4000-8000-00000000c001";
const BAUSTELLE_B = "00000000-0000-4000-8000-00000000c002";

const ANGELEGT = new Date("2026-01-05T08:00:00.000Z");
const VEROEFFENTLICHT = new Date("2026-01-06T09:00:00.000Z");

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

/** Eine Zeile aus `plan_versions`, wie die RLS-Attrappe sie haelt. */
interface VersionsZeile {
  readonly id: string;
  readonly org_id: string;
  readonly week_key: string;
  readonly published_at: Date | null;
  readonly created_at: Date;
}

/** Eine Zeile aus `employees` bzw. `worksites`, schon auf `label` benannt. */
interface StammZeile {
  readonly id: string;
  readonly org_id: string;
  readonly label: string;
  readonly active: boolean;
}

/** Die RLS-sichtbare Menge: immer BEIDE Mandanten, in jeder Tabelle. */
interface Datenstand {
  readonly organisationen: readonly OrgZeile[];
  readonly versionen: readonly VersionsZeile[];
  readonly beschaeftigte: readonly StammZeile[];
  readonly baustellen: readonly StammZeile[];
}

/** Derselbe Stammdatenbestand fuer jeden Fall — beide Mandanten, je einer. */
function standMit(versionen: readonly VersionsZeile[]): Datenstand {
  return {
    organisationen: [ALPHA, BETA],
    versionen,
    beschaeftigte: [
      { id: PERSON_A, org_id: ORG_A, label: "Anders", active: true },
      { id: PERSON_B, org_id: ORG_B, label: "Berger", active: true },
    ],
    baustellen: [
      { id: BAUSTELLE_A, org_id: ORG_A, label: "Allee", active: true },
      { id: BAUSTELLE_B, org_id: ORG_B, label: "Bergweg", active: true },
    ],
  };
}

/**
 * Verengt auf die Organisation — aber NUR, wenn das SQL sie ueberhaupt nennt.
 *
 * Die Attrappe kennt die Regel nicht, sie liest sie am Text ab. Fehlt
 * `org_id = $n`, liefert sie beide Mandanten, genau wie RLS es taete.
 * Gefiltert wird nach dem Parameter, dessen WERT eine bekannte
 * Organisations-Id ist; die Nummer im Text zu deuten hiesse, den SQL-Dialekt
 * hier ein zweites Mal zu implementieren.
 */
function orgVerengung<TZeile extends { readonly org_id: string }>(
  sql: string,
  params: readonly unknown[],
  zeilen: readonly TZeile[],
  bekannteOrgIds: readonly string[],
): readonly TZeile[] {
  if (!/org_id = \$\d+/.test(sql)) return zeilen;
  const wert = params.find((p) => typeof p === "string" && bekannteOrgIds.includes(p));
  if (wert === undefined) return zeilen;
  return zeilen.filter((zeile) => zeile.org_id === wert);
}

/**
 * Wertet ein Statement gegen den Datenstand aus.
 *
 * Bewusst NICHT sortierend: `order by` steht zwar im SQL, aber keiner der
 * Faelle hier haengt an der Reihenfolge — nach der Verengung bleibt je Tabelle
 * hoechstens eine Zeile uebrig. Eine nachgebaute Sortierung waere eine Zusage,
 * die diese Suite nicht einloest; die misst `planning-published-reads`.
 */
function auswerten(sql: string, params: readonly unknown[], stand: Datenstand): readonly unknown[] {
  const orgIds = stand.organisationen.map((org) => org.id);

  if (sql.includes("from public.organizations")) {
    if (!sql.includes("where id::text = $1")) return stand.organisationen;
    return stand.organisationen.filter((org) => org.id === params[0]);
  }

  if (sql.includes("from public.plan_versions")) {
    let zeilen: readonly VersionsZeile[] = stand.versionen;
    if (sql.includes("where week_key = $1")) {
      zeilen = zeilen.filter((zeile) => zeile.week_key === params[0]);
    }
    if (sql.includes("where id = $1")) {
      zeilen = zeilen.filter((zeile) => zeile.id === params[0]);
    }
    if (sql.includes('week_key collate "C" >= $1')) {
      zeilen = zeilen.filter((zeile) => zeile.week_key >= String(params[0]));
    }
    if (sql.includes('week_key collate "C" <= $2')) {
      zeilen = zeilen.filter((zeile) => zeile.week_key <= String(params[1]));
    }
    if (sql.includes("published_at is not null")) {
      zeilen = zeilen.filter((zeile) => zeile.published_at !== null);
    }
    return orgVerengung(sql, params, zeilen, orgIds);
  }

  if (sql.includes("from public.employees")) {
    return orgVerengung(sql, params, stand.beschaeftigte, orgIds);
  }
  if (sql.includes("from public.worksites")) {
    return orgVerengung(sql, params, stand.baustellen, orgIds);
  }

  // `assignments` bleibt leer. Diese Suite misst die Mandantenverengung, und
  // `assignmentsOf` traegt sie bewusst nicht — der tenantgebundene
  // Fremdschluessel der Version erledigt das bereits. Ein Datenstand mit
  // Zuweisungen suggerierte eine Aussage, die hier nicht getroffen wird.
  return [];
}

/**
 * Ein Runner mit RLS-Semantik: er liefert die Zeilen BEIDER Organisationen.
 *
 * Das ist der Unterschied zu {@link runnerMit}, der ausserhalb von
 * `organizations` gar nichts liefert. Verengt wird hier nur, was das SQL selbst
 * verengt — die Attrappe ist Datenlage, nicht Regelwerk.
 */
function runnerMitRls(stand: Datenstand, protokoll: Aufzeichnung[]): TenantQueryRunner {
  const tx: TenantQuery = {
    query: <TRow>(sql: string, params: readonly unknown[] = []) => {
      protokoll.push({ sql, params });
      const zeilen = auswerten(sql, params, stand);
      return Promise.resolve({ rows: zeilen as unknown as TRow[], rowCount: zeilen.length });
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

/**
 * Alle aufgezeichneten Abfragen auf EINE Tabelle.
 *
 * Eine leere Auswahl meldet die Hilfsfunktion selbst rot. Sonst waere jede
 * darauf gebaute Zusicherung vacuously gruen: eine Schleife ueber null Treffer
 * prueft nichts und faellt trotzdem nicht auf.
 */
function abfragenAuf(protokoll: readonly Aufzeichnung[], tabelle: string): Aufzeichnung[] {
  const treffer = protokoll.filter((zeile) => zeile.sql.includes(`from ${tabelle}`));
  expect(treffer, `keine Abfrage auf ${tabelle} aufgezeichnet`).not.toHaveLength(0);
  return treffer;
}

/**
 * Zusichern, dass eine Org-Bedingung an den RICHTIGEN Parameter gebunden ist.
 *
 * Nicht nur „irgendwo steht `org_id = $n`": die Attrappe filtert nach WERT und
 * saehe eine falsche Nummer nicht — `and org_id = $1` mit `[weekKey, org.id]`
 * verglich die Organisation mit einer Wochenkennung und lieferte still null
 * Zeilen. Diese Pruefung liest die Nummer aus dem SQL und schaut nach, was an
 * GENAU DIESER Stelle uebergeben wurde.
 */
function orgBedingungBindetAn(zeile: Aufzeichnung, erwartet: string): void {
  const treffer = /org_id = \$(\d+)/.exec(zeile.sql);
  expect(treffer, `keine org_id-Bedingung im SQL: ${zeile.sql}`).not.toBeNull();
  const nummer = Number(treffer?.[1]);
  expect(
    zeile.params[nummer - 1],
    `org_id haengt an $${nummer}, dort steht aber ${String(zeile.params[nummer - 1])}`,
  ).toBe(erwartet);
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
    const abfrage = organisationsAbfrage(protokoll);
    expect(abfrage.params).toHaveLength(0);
    expect(abfrage.sql).toBe("select id, time_zone from public.organizations");
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
    expect(organisationsAbfrage(protokollListe).params).toEqual([ORG_FREMD]);

    const protokollStand: Aufzeichnung[] = [];
    const stand = await new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokollStand),
      USER,
      ORG_FREMD,
    ).publishedAssignments("00000000-0000-4000-8000-0000000f0f0f");
    expect(stand.ok).toBe(false);
    if (!stand.ok) expect(stand.problem).toBe("NO_ORGANISATION");
    expect(organisationsAbfrage(protokollStand).params).toEqual([ORG_FREMD]);
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
    // Nicht nur "irgendein $1": DIESE Spalte, DIESER Vergleich. Sonst bleibt
    // `where time_zone = $1` gruen — gemessen.
    expect(abfrage.sql).toMatch(/where id::text = \$1/);
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

/**
 * Die zweite Naht: wirkt die Bindung auch auf die NUTZDATEN?
 *
 * Die Faelle oben messen, welche Organisation gewaehlt wird. Diese hier messen,
 * ob die Wahl danach noch etwas bedeutet. Ohne `and org_id = $n` in den
 * Nutzdatenabfragen wirkte eine Bindung nur auf die Zeitzone, waehrend
 * Versionen und Stammdaten weiter aus ALLEN Mitgliedschaften kaemen — das
 * Ergebnis waere eine Collage aus zwei Mandanten, die plausibel aussieht.
 */
describe("PlanningWindowRepository — Verengung der Nutzdaten (EYT-109)", () => {
  // MO1
  it("liefert an B gebunden keine Stammdaten und keinen Entwurf aus A", async () => {
    const protokoll: Aufzeichnung[] = [];
    // ALPHA hat einen Entwurf derselben Woche, BETA eine veroeffentlichte
    // Version. Ohne Verengung gewaenne ALPHAs Entwurf, weil ein Entwurf im
    // Fenster Vorrang hat — und zwar unbemerkt, mit BETAs Zeitzone daneben.
    const repository = new PlanningWindowRepository(
      runnerMitRls(
        standMit([
          {
            id: VERSION_A,
            org_id: ORG_A,
            week_key: "2026-W02",
            published_at: null,
            created_at: ANGELEGT,
          },
          {
            id: VERSION_B,
            org_id: ORG_B,
            week_key: "2026-W02",
            published_at: VEROEFFENTLICHT,
            created_at: ANGELEGT,
          },
        ]),
        protokoll,
      ),
      USER,
      ORG_B,
    );

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.window.timeZone).toBe("Europe/Vienna");
    expect(ergebnis.window.resources.employees.map((zeile) => zeile.id)).toEqual([PERSON_B]);
    expect(ergebnis.window.resources.worksites.map((zeile) => zeile.id)).toEqual([BAUSTELLE_B]);
    expect(ergebnis.window.sourceVersion).toEqual({ id: VERSION_B, state: "published" });
    // Und die Bedingung haengt an der richtigen Parameterstelle (GM-MO-4).
    for (const tabelle of ["public.plan_versions", "public.employees", "public.worksites"]) {
      for (const abfrage of abfragenAuf(protokoll, tabelle)) orgBedingungBindetAn(abfrage, ORG_B);
    }
  });

  // MO2
  it("listet an B gebunden nur veroeffentlichte Versionen aus B", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(
      runnerMitRls(
        standMit([
          {
            id: VERSION_A,
            org_id: ORG_A,
            week_key: "2026-W02",
            published_at: VEROEFFENTLICHT,
            created_at: ANGELEGT,
          },
          {
            id: VERSION_B,
            org_id: ORG_B,
            week_key: "2026-W02",
            published_at: VEROEFFENTLICHT,
            created_at: ANGELEGT,
          },
        ]),
        protokoll,
      ),
      USER,
      ORG_B,
    );

    const ergebnis = await repository.publishedVersions("2026-W02", "2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.versions.map((version) => version.id)).toEqual([VERSION_B]);
    // Die Ergebnisliste allein genuegt nicht: die Attrappe filtert nach WERT
    // und bliebe bei einer falschen Parameternummer gruen (GM-MO-4).
    for (const abfrage of abfragenAuf(protokoll, "public.plan_versions")) {
      orgBedingungBindetAn(abfrage, ORG_B);
    }
  });

  // MO3
  it("erreicht an A gebunden die Planversion aus B nicht", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(
      runnerMitRls(
        standMit([
          {
            id: VERSION_B,
            org_id: ORG_B,
            week_key: "2026-W02",
            published_at: VEROEFFENTLICHT,
            created_at: ANGELEGT,
          },
        ]),
        protokoll,
      ),
      USER,
      ORG_A,
    );

    const ergebnis = await repository.publishedAssignments(VERSION_B);

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    // Nicht `PLAN_NOT_PUBLISHED`: fuer den gebundenen Mandanten existiert die
    // Version schlicht nicht, und genau diese Ununterscheidbarkeit ist gewollt.
    expect(ergebnis.problem).toBe("PLAN_VERSION_NOT_FOUND");
    // Die Existenzabfrage traegt die Organisation an der richtigen Stelle
    // — hier $2, denn $1 ist die Planversion (GM-MO-4).
    for (const abfrage of abfragenAuf(protokoll, "public.plan_versions")) {
      orgBedingungBindetAn(abfrage, ORG_A);
    }
  });
});
