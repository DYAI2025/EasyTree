/**
 * Punktkonsistenz der Satz-Buendellesung (EYT-138).
 *
 * ## Was dieser Test misst — und was ausdruecklich NICHT
 *
 * Er misst die STRUKTURELLE Ursache des PR-Befundes
 * `RATE_FANOUT_NOT_POINT_IN_TIME`: wie viele Transaktionen und wie viele
 * Anweisungen eine Buendellesung oeffnet. Er ist KEIN echter Wettlauf.
 *
 * Ein echter waere nicht deterministisch herstellbar. Bei EINER Anweisung gibt
 * es kein Fenster, in das ein fremder Commit fallen koennte — und ein Test, der
 * auf ein nicht existierendes Fenster wartet, misst seine eigene Wartezeit und
 * nicht die Eigenschaft. Deshalb stellt der gefaelschte Runner das Fenster
 * selbst her: er laesst ZWISCHEN zwei abgeschlossenen `run(...)` eine
 * vorgemerkte Satzaenderung wirksam werden, genau so, wie ein fremder Commit es
 * zwischen zwei echten Transaktionen taete. Mit drei Transaktionen sieht die
 * Ergebnisabbildung zwei Datenbankzustaende; mit einer kann sie das nicht.
 *
 * Die INHALTLICHE Haelfte — Gruppierung, Vollstaendigkeit, Reihenfolge,
 * Betraege und die Mandantengrenze — misst
 * `test/costs/cost-snapshot.integration.test.ts` gegen die echte Datenbank im
 * Job `db-gates`. Dieser Test hier ersetzt sie nicht und behauptet das nirgends.
 *
 * ## Warum der Runner gefaelscht ist und nicht die Datenbank
 *
 * Die Zusicherung lautet „ein Lesezeitpunkt", und ihr Traeger ist die
 * Anweisungszahl. Ein `pg`-Doppel waere hier die falsche Naht: es wuerde den
 * Treiber messen. Gefaelscht wird deshalb genau die Grenze, die das Repository
 * sieht — `TenantQueryRunner`.
 */
import { describe, expect, it } from "vitest";

import { PgRateRepository } from "../../src/modules/costs";
import type { RateVersionRecord } from "../../src/modules/costs";
import type {
  TenantContext,
  TenantQuery,
  TenantQueryRunner,
} from "../../src/platform/database/tenant-query-runner";
import type { IdempotencyStore } from "../../src/platform/idempotency/idempotency-store";

const ANNA = "22222222-2222-4222-8222-222222222222";
const BERND = "27777777-2777-4777-8777-277777777777";
const CARLA = "2ccccccc-2ccc-4ccc-8ccc-2ccccccccccc";
/** Beschaeftigte OHNE jede Satzversion — der Fall „gefragt, nichts da". */
const OHNE_SATZ = "2dddddd0-2ddd-4ddd-8ddd-2ddddddddddd";

const SUBJEKT = "66666666-6666-4666-8666-666666666666";

/** Die Zeilenform, die `rate-repository.pg.ts` aus der Datenbank erwartet. */
interface SatzZeile {
  readonly id: string;
  readonly employee_id: string;
  readonly amount_minor_units: string;
  readonly currency: string;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly predecessor_id: string | null;
  readonly reason: string;
  readonly created_at: string;
  readonly created_by: string;
}

function zeile(ueberschreibung: Partial<SatzZeile> = {}): SatzZeile {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    employee_id: ANNA,
    amount_minor_units: "2500",
    currency: "EUR",
    valid_from: "2026-01-01",
    valid_to: null,
    predecessor_id: null,
    reason: "Ersteintrag",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: SUBJEKT,
    ...ueberschreibung,
  };
}

/**
 * Die Mitarbeitenden-Ids einer Anfrage — gleichgueltig, ob sie als Feld
 * (`= any($1::uuid[])`) oder einzeln (`= $1`) uebergeben wurden.
 *
 * Beide Formen zu lesen ist Absicht: sonst zerbraeche die Gegenmutation
 * „zurueck zum Faecher" an einer Formatannahme des Testdoubles, und der rote
 * Lauf bewiese die Robustheit des Doubles statt die Eigenschaft. Eine
 * Gegenmutation muss die KOHAERENTE falsche Umsetzung herstellen koennen.
 */
function idsAus(params: readonly unknown[]): string[] {
  const erster = params[0];
  if (Array.isArray(erster))
    return erster.filter((wert): wert is string => typeof wert === "string");
  return typeof erster === "string" ? [erster] : [];
}

/**
 * Ein Runner, der zwischen zwei Transaktionen die Welt veraendern darf.
 *
 * `sicht` wird zu Beginn jedes `run` festgehalten — das ist die Entsprechung
 * des MVCC-Snapshots, den PostgreSQL je Anweisung bildet. Der Mutator laeuft
 * NACH dem Commit; wer nur eine Transaktion oeffnet, sieht ihn nie.
 */
class StufenRunner implements TenantQueryRunner {
  runAufrufe = 0;
  readonly anweisungen: string[] = [];
  readonly kontexte: TenantContext[] = [];

  constructor(
    private zeilen: readonly SatzZeile[],
    private readonly nachTransaktion: (zeilen: readonly SatzZeile[]) => readonly SatzZeile[] = (
      zeilen,
    ) => zeilen,
  ) {}

  async run<T>(kontext: TenantContext, work: (tx: TenantQuery) => Promise<T>): Promise<T> {
    this.runAufrufe += 1;
    this.kontexte.push(kontext);
    const sicht = this.zeilen;
    const ergebnis = await work({
      query: async <TRow>(sql: string, params: readonly unknown[] = []) => {
        this.anweisungen.push(sql);
        const gesucht = new Set(idsAus(params));
        const treffer = sicht.filter((z) => gesucht.has(z.employee_id));
        return { rows: treffer as unknown as TRow[], rowCount: treffer.length };
      },
    });
    this.zeilen = this.nachTransaktion(this.zeilen);
    return ergebnis;
  }
}

/** Nie aufgerufen: eine Lesung fasst die Wiederholungserkennung nicht an. */
const idempotenzWaechter: IdempotencyStore = {
  lock: () => {
    throw new Error("Eine Lesung sperrt nichts.");
  },
  find: () => {
    throw new Error("Eine Lesung fragt keine Wiederholung ab.");
  },
  remember: () => {
    throw new Error("Eine Lesung merkt sich nichts.");
  },
};

function repositoryMit(
  zeilen: readonly SatzZeile[],
  nachTransaktion?: (zeilen: readonly SatzZeile[]) => readonly SatzZeile[],
): { readonly repository: PgRateRepository; readonly runner: StufenRunner } {
  const runner =
    nachTransaktion === undefined
      ? new StufenRunner(zeilen)
      : new StufenRunner(zeilen, nachTransaktion);
  return { repository: new PgRateRepository(runner, SUBJEKT, idempotenzWaechter), runner };
}

/**
 * Annas drei Versionen stehen in einer Reihenfolge, die WEDER auf- NOCH
 * absteigend nach `valid_from` ist.
 *
 * Das ist der Punkt: die Sortierung leistet die Datenbank (`order by
 * employee_id, valid_from desc`), nicht dieses Repository. Was das Repository
 * leisten muss, ist die Reihenfolge UNVERAENDERT durchzureichen. Waere die
 * Eingabe bereits absteigend, bliebe ein versehentliches `.sort()` in der
 * Gruppierungsschleife unsichtbar — die Zusicherung waere von einer
 * zufaellig passenden Eingabe maskiert.
 */
const DREI_HISTORIEN: readonly SatzZeile[] = [
  zeile({
    id: "5a000000-5a00-4a00-8a00-5a0000000002",
    employee_id: ANNA,
    valid_from: "2025-06-01",
    valid_to: "2025-12-31",
    amount_minor_units: "2200",
  }),
  zeile({
    id: "5a000000-5a00-4a00-8a00-5a0000000003",
    employee_id: ANNA,
    valid_from: "2026-01-01",
    amount_minor_units: "2500",
  }),
  zeile({
    id: "5a000000-5a00-4a00-8a00-5a0000000001",
    employee_id: ANNA,
    valid_from: "2025-01-01",
    valid_to: "2025-05-31",
    amount_minor_units: "2000",
  }),
  zeile({
    id: "5b000000-5b00-4b00-8b00-5b0000000001",
    employee_id: BERND,
    valid_from: "2026-02-01",
    amount_minor_units: "3000",
  }),
  zeile({
    id: "5c000000-5c00-4c00-8c00-5c0000000001",
    employee_id: CARLA,
    valid_from: "2026-03-01",
    amount_minor_units: "3500",
  }),
];

/** Die Satzversion, die MITTEN im Faecher committet wuerde. */
const NACHGESCHOBEN = zeile({
  id: "5b000000-5b00-4b00-8b00-5b0000000002",
  employee_id: BERND,
  valid_from: "2026-07-01",
  amount_minor_units: "9900",
  reason: "Erhoehung, waehrend der Snapshot lief",
});

function ids(historien: readonly RateVersionRecord[]): string[] {
  return historien.map((version) => version.id);
}

describe("PgRateRepository.versionsForMany", () => {
  it("Fall 1 — oeffnet fuer drei Beschaeftigte genau EINE Transaktion", async () => {
    const { repository, runner } = repositoryMit(DREI_HISTORIEN);

    await repository.versionsForMany([ANNA, BERND, CARLA]);

    // Der ganze Befund in einer Zahl: drei Transaktionen sind drei
    // Lesezeitpunkte, und ein Snapshot aus drei Zeitpunkten ist eine Collage.
    expect(runner.runAufrufe).toBe(1);
  });

  it("Fall 2 — setzt genau EINE Anweisung ab", async () => {
    const { repository, runner } = repositoryMit(DREI_HISTORIEN);

    await repository.versionsForMany([ANNA, BERND, CARLA]);

    // Die Zusicherung haengt an der Anweisungszahl, nicht an einem
    // Isolationslevel: PostgreSQL wertet JEDE Anweisung gegen genau einen
    // MVCC-Snapshot aus, auch unter `read committed`. Zwei Anweisungen in
    // derselben Transaktion waeren bereits zwei Zeitpunkte.
    expect(runner.anweisungen).toHaveLength(1);
  });

  it("Fall 3 — ein Satz, der zwischen zwei Transaktionen committet, erreicht KEINE der Historien", async () => {
    const { repository, runner } = repositoryMit(DREI_HISTORIEN, (zeilen) => [
      ...zeilen,
      NACHGESCHOBEN,
    ]);

    const abbildung = await repository.versionsForMany([ANNA, BERND, CARLA]);

    // Mit einer Transaktion ist der Mutator strukturell unerreichbar. Mit dem
    // alten Faecher saehe die zweite oder dritte Lesung ihn — und der Snapshot
    // mischte zwei Datenbankzustaende.
    const alle = [...abbildung.values()].flatMap(ids);
    expect(alle).not.toContain(NACHGESCHOBEN.id);
    expect(runner.runAufrufe).toBe(1);
  });

  it("Fall 4 — traegt fuer eine Person ohne Satz eine LEERE Historie, nicht `undefined`", async () => {
    const { repository } = repositoryMit(DREI_HISTORIEN);

    const abbildung = await repository.versionsForMany([ANNA, OHNE_SATZ]);

    // Der Unterschied zwischen „gefragt, nichts vorhanden" und „nie gefragt".
    // Mit `undefined` waeren beide ununterscheidbar, und die Montage koennte
    // einen Auslassungsfehler nicht von einem fehlenden Satz trennen.
    expect(abbildung.size).toBe(2);
    expect(abbildung.get(OHNE_SATZ)).toEqual([]);
    expect(abbildung.has(OHNE_SATZ)).toBe(true);
  });

  it("Fall 5 — dedupliziert Ids, ohne die Abbildung zu verkleinern", async () => {
    const { repository, runner } = repositoryMit(DREI_HISTORIEN);

    const abbildung = await repository.versionsForMany([ANNA, ANNA, ANNA]);

    expect(abbildung.size).toBe(1);
    expect(runner.anweisungen).toHaveLength(1);
    expect(ids(abbildung.get(ANNA) ?? [])).toHaveLength(3);
  });

  it("Fall 6 — oeffnet bei leerer Eingabe GAR KEINE Transaktion", async () => {
    const { repository, runner } = repositoryMit(DREI_HISTORIEN);

    const abbildung = await repository.versionsForMany([]);

    // Eine veroeffentlichte Planversion ohne Zuweisungen ist ein gueltiger
    // Fall (leerer Snapshot, Summe 0). Eine Verbindung fuer eine Abfrage ohne
    // Kandidaten waere Poolzeit ohne Gegenwert.
    expect(runner.runAufrufe).toBe(0);
    expect(abbildung.size).toBe(0);
  });

  it("Fall 7 — reicht die Reihenfolge der Datenbank UNVERAENDERT durch", async () => {
    const { repository } = repositoryMit(DREI_HISTORIEN);

    const abbildung = await repository.versionsForMany([ANNA, BERND, CARLA]);

    // Die Fixtures stehen weder auf- noch absteigend nach `validFrom`. Ein
    // `.sort()` in der Gruppierungsschleife — in welche Richtung auch immer —
    // wird hier rot.
    //
    // Dass die ANWEISUNG `order by employee_id, valid_from desc` traegt und
    // die Datenbank sie befolgt, ist hier NICHT gemessen und wird hier auch
    // nicht behauptet: dieser Runner fuehrt kein SQL aus. Diese Haelfte misst
    // `test/costs/cost-snapshot.integration.test.ts` gegen PostgreSQL.
    expect(ids(abbildung.get(ANNA) ?? [])).toEqual([
      "5a000000-5a00-4a00-8a00-5a0000000002",
      "5a000000-5a00-4a00-8a00-5a0000000003",
      "5a000000-5a00-4a00-8a00-5a0000000001",
    ]);
    // Die Zeilen werden vollstaendig in Datensaetze gewandelt, nicht nur ihre Ids.
    expect(abbildung.get(ANNA)?.[1]?.amountMinorUnits).toBe("2500");
    expect(abbildung.get(ANNA)?.[1]?.validTo).toBeNull();
    // EYT-109 D1: die DB fuehrt `[von, bis)`, die Fachwelt `[von, bis]`.
    // Gespeichert ist `2025-12-31` (exklusiv); fachlich endet die Version am
    // 30.12. Gegenmutation: `dbEndeZuValidTo` in `toRecord` entfernen -> rot.
    expect(abbildung.get(ANNA)?.[0]?.validTo).toBe("2025-12-30");
    expect(abbildung.get(BERND)?.[0]?.employeeId).toBe(BERND);
  });

  it("Fall 7a — liefert am Wechseltag den letzten wirksamen Tag, nicht die DB-Grenze", async () => {
    // Der Fall aus PO-Kommentar 13533: Vorgaenger [2026-06-01, 2026-07-01) in
    // der Datenbank, Nachfolger ab 2026-07-01. Oberhalb der Persistenzgrenze
    // endet der Vorgaenger am 30.06. — sonst zeigte die Oberflaeche „gueltig
    // bis 01.07." fuer eine Version, die am 01.07. nicht mehr gilt.
    //
    // Gegenmutation: `dbEndeZuValidTo` in `toRecord` entfernen -> `2026-07-01`,
    // rot. Und `null` muss `null` bleiben: die einzige Zeile, die heute in
    // Produktion steht, traegt `valid_to IS NULL`.
    const { repository } = repositoryMit([
      zeile({
        id: "5a000000-5a00-4a00-8a00-5a000000000a",
        employee_id: ANNA,
        valid_from: "2026-06-01",
        valid_to: "2026-07-01",
      }),
      zeile({
        id: "5a000000-5a00-4a00-8a00-5a000000000b",
        employee_id: ANNA,
        valid_from: "2026-07-01",
        valid_to: null,
      }),
    ]);

    const abbildung = await repository.versionsForMany([ANNA]);
    const historie = abbildung.get(ANNA) ?? [];

    // Die Reihenfolge der Fixtur bleibt erhalten (Fall 7) — der erste Eintrag
    // ist der Vorgaenger.
    expect(historie).toHaveLength(2);
    expect(historie.map((v) => v.validTo)).toEqual(["2026-06-30", null]);
    // Lueckenlos und ueberlappungsfrei: der Nachfolger beginnt am Tag NACH dem
    // letzten wirksamen Tag des Vorgaengers (EYT-95).
    expect(historie[1]?.validFrom).toBe("2026-07-01");
  });

  it("Fall 8 — bindet die Lesung an das Subjekt der Anfrage", async () => {
    const { repository, runner } = repositoryMit(DREI_HISTORIEN);

    await repository.versionsForMany([ANNA]);

    // Ohne diesen Zeugen koennte die Methode den Mandantenkontext ganz
    // weglassen — die Attrappe antwortete trotzdem, und RLS faellt erst in
    // Produktion auf.
    expect(runner.kontexte).toEqual([{ userId: SUBJEKT }]);
  });
});
