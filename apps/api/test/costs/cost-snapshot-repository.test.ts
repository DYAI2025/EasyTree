/**
 * Das Snapshot-Repository an seiner Datenbankgrenze (EYT-138, Task 11).
 *
 * ## Was hier gemessen wird
 *
 * Die Eigenschaften, die KEINE echte Datenbank brauchen und die deshalb auch
 * ohne Docker jederzeit reproduzierbar sind:
 *
 *   - Anzahl der Transaktionen und Anweisungen,
 *   - die Reihenfolge Sperre → Replay-Abfrage → Schreiben → Merken,
 *   - dass `id` und `created_at` NICHT mitgegeben werden,
 *   - dass `ordinal` aus der Arrayreihenfolge entsteht,
 *   - dass null betroffene Kopfzeilen als Kanalgrenze gedeutet werden,
 *   - dass ein Teilstand einen WURF ausloest und keinen Rueckgabewert,
 *   - dass Betraege nie durch `number` laufen.
 *
 * ## Was hier NICHT gemessen wird
 *
 * RLS, Rechte, Fremdschluessel, echte Atomizitaet, das Verhalten des Treibers.
 * Diese Haelfte traegt `test/costs/cost-snapshot.integration.test.ts` gegen
 * PostgreSQL im Job `db-gates`. Ein Skip dort ist kein Nachweis — und dieser
 * Test ersetzt ihn nicht.
 *
 * ## Warum der Doppelgaenger auf dem SQL-Text unterscheidet
 *
 * Ein Runner-Doppel sieht nur Zeichenketten; eine Unterscheidung nach Absicht
 * gibt es an dieser Naht nicht. Das koppelt die Faelle an Tabellennamen — und
 * genau das ist hier gewollt: schriebe das Repository in eine ANDERE Tabelle,
 * faende der Doppelgaenger keinen Handler und der Fall wuerde laut rot, statt
 * still zu einem falschen Ziel zu schreiben.
 */
import { describe, expect, it } from "vitest";

import { PgCostSnapshotRepository } from "../../src/modules/costs";
import type { AssembledPosition, NewCostSnapshot } from "../../src/modules/costs";
import { COST_RULE_VERSION } from "@easytree/domain";
import type {
  TenantContext,
  TenantQuery,
  TenantQueryRunner,
} from "../../src/platform/database/tenant-query-runner";
import type {
  IdempotencyRecord,
  IdempotencyStore,
} from "../../src/platform/idempotency/idempotency-store";

const ORG = "88888888-8888-4888-8888-888888888888";
const SUBJEKT = "66666666-6666-4666-8666-666666666666";
const PLANVERSION = "44444444-4444-4444-8444-444444444444";
const SNAPSHOT_ID = "77777777-7777-4777-8777-777777777777";
const ANNA = "22222222-2222-4222-8222-222222222222";
const NORD = "33333333-3333-4333-8333-333333333333";
const SATZ = "55555555-5555-4555-8555-555555555555";

function position(ueberschreibung: Partial<AssembledPosition> = {}): AssembledPosition {
  return {
    assignmentId: "11111111-1111-4111-8111-111111111111",
    worksiteId: NORD,
    worksiteLabel: "Baustelle Nord",
    employeeId: ANNA,
    employeeLabel: "Anna Bauer",
    localDate: "2026-06-15",
    durationMilliseconds: 28_800_000n,
    rateVersionId: SATZ,
    amountMinorUnits: 20_000n,
    ruleVersion: COST_RULE_VERSION,
    ...ueberschreibung,
  };
}

function neuerSnapshot(ueberschreibung: Partial<NewCostSnapshot> = {}): NewCostSnapshot {
  return {
    organisationId: ORG,
    planVersionId: PLANVERSION,
    worksiteId: null,
    weekKey: "2026-W25",
    timeZone: "Europe/Berlin",
    currency: "EUR",
    ruleVersion: COST_RULE_VERSION,
    totalMinorUnits: 20_000n,
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
    positions: [position()],
    ...ueberschreibung,
  };
}

interface Anweisung {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface RunnerOptionen {
  /**
   * Antwort auf `select app.is_runtime_channel()`.
   *
   * Gemessen am 12.08.2026: eine verletzte `with check`-Klausel WIRFT bei
   * INSERT (42501), sie liefert keine null Zeilen — nur `using` filtert.
   * Deshalb fragt das Repository den Kanal, statt ihn aus einer Zeilenzahl zu
   * erraten.
   */
  readonly laufzeitkanal?: boolean;
  /** Betroffene Zeilen des Kopf-Inserts. */
  readonly kopfZeilen?: number;
  /** Betroffene Zeilen des Positions-Inserts. */
  readonly positionsZeilen?: number;
  /** Kopfzeilen der Leseabfrage. Leer = nicht sichtbar. */
  readonly gelesenerKopf?: readonly Record<string, unknown>[];
  readonly gelesenePositionen?: readonly Record<string, unknown>[];
  /** Laesst den Positions-Insert werfen — der FK-Fall der echten Datenbank. */
  readonly positionsFehler?: Error;
}

class AufzeichnenderRunner implements TenantQueryRunner {
  runAufrufe = 0;
  readonly anweisungen: Anweisung[] = [];
  readonly kontexte: TenantContext[] = [];

  constructor(private readonly optionen: RunnerOptionen = {}) {}

  /** Nur die Tabellen-/Vorgangsnamen, in der beobachteten Reihenfolge. */
  spuren(): string[] {
    return this.anweisungen.map((a) => spur(a.sql));
  }

  async run<T>(kontext: TenantContext, work: (tx: TenantQuery) => Promise<T>): Promise<T> {
    this.runAufrufe += 1;
    this.kontexte.push(kontext);
    return work({
      query: async <TRow>(sql: string, params: readonly unknown[] = []) => {
        this.anweisungen.push({ sql, params });
        const art = spur(sql);
        if (art === "frage:kanal") {
          const ok = this.optionen.laufzeitkanal ?? true;
          return { rows: [{ ok }] as unknown as TRow[], rowCount: 1 };
        }
        if (art === "insert:kopf") {
          const zeilen = this.optionen.kopfZeilen ?? 1;
          const rows = zeilen === 0 ? [] : [{ id: SNAPSHOT_ID }];
          return { rows: rows as unknown as TRow[], rowCount: rows.length };
        }
        if (art === "insert:positionen") {
          if (this.optionen.positionsFehler !== undefined) throw this.optionen.positionsFehler;
          const zeilen = this.optionen.positionsZeilen;
          const anzahl = zeilen === undefined ? anzahlAusFeldern(params) : zeilen;
          return { rows: [] as unknown as TRow[], rowCount: anzahl };
        }
        if (art === "select:kopf") {
          const rows = this.optionen.gelesenerKopf ?? [];
          return { rows: rows as unknown as TRow[], rowCount: rows.length };
        }
        if (art === "select:positionen") {
          const rows = this.optionen.gelesenePositionen ?? [];
          return { rows: rows as unknown as TRow[], rowCount: rows.length };
        }
        throw new Error(`Unerwartete Anweisung an einer fremden Tabelle:\n${sql}`);
      },
    });
  }
}

function spur(sql: string): string {
  const normalisiert = sql.replace(/\s+/g, " ").toLowerCase();
  if (normalisiert.includes("app.is_runtime_channel")) return "frage:kanal";
  if (normalisiert.includes("insert into public.cost_snapshot_positions")) {
    return "insert:positionen";
  }
  if (normalisiert.includes("insert into public.cost_snapshots")) return "insert:kopf";
  if (normalisiert.includes("from public.cost_snapshot_positions")) return "select:positionen";
  if (normalisiert.includes("from public.cost_snapshots")) return "select:kopf";
  return `fremd:${normalisiert.slice(0, 60)}`;
}

/**
 * Die Zeilenzahl eines Inserts, so wie die echte Datenbank sie meldet.
 *
 * Bei einem `unnest`-Insert steht sie in der Laenge der Felder; bei einem
 * gewoehnlichen `values`-Insert ohne Feldparameter ist sie 1.
 *
 * Der zweite Fall ist NICHT hypothetisch und auch keine Bequemlichkeit: ohne
 * ihn meldete der Doppelgaenger fuer einen zeilenweisen Insert 0 betroffene
 * Zeilen, und die Gegenmutation „Positionen einzeln schreiben" zerbraeche an
 * der Vollstaendigkeitswache statt die Anweisungszahl zu messen. Man maesse
 * dann den Waechter und nicht die Regel — genau die Falle, die der kanonische
 * Plan bei GM6 beschreibt.
 */
function anzahlAusFeldern(params: readonly unknown[]): number {
  const feld = params.find((wert) => Array.isArray(wert));
  return Array.isArray(feld) ? feld.length : 1;
}

interface IdempotenzOptionen {
  readonly bekannt?: IdempotencyRecord | null;
}

class AufzeichnendeIdempotenz implements IdempotencyStore {
  readonly rufe: string[] = [];
  readonly gemerkt: { subjectId: string; fingerprint: string }[] = [];

  constructor(private readonly optionen: IdempotenzOptionen = {}) {}

  async lock(): Promise<void> {
    this.rufe.push("lock");
  }

  async find(): Promise<IdempotencyRecord | null> {
    this.rufe.push("find");
    return this.optionen.bekannt ?? null;
  }

  async remember(
    _tx: TenantQuery,
    _organisationId: string,
    _operation: string,
    _key: string,
    subjectId: string,
    requestFingerprint: string,
  ): Promise<void> {
    this.rufe.push("remember");
    this.gemerkt.push({ subjectId, fingerprint: requestFingerprint });
  }
}

function gespeicherteKopfzeile(ueberschreibung: Record<string, unknown> = {}) {
  return {
    id: SNAPSHOT_ID,
    org_id: ORG,
    plan_version_id: PLANVERSION,
    worksite_id: null,
    week_key: "2026-W25",
    time_zone: "Europe/Berlin",
    currency: "EUR",
    rule_version: COST_RULE_VERSION,
    total_minor_units: "20000",
    created_by: SUBJEKT,
    correlation_id: "corr-1",
    created_at: new Date("2026-06-20T08:30:00.000Z"),
    ...ueberschreibung,
  };
}

function gespeichertePositionszeile(ueberschreibung: Record<string, unknown> = {}) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    assignment_id: "11111111-1111-4111-8111-111111111111",
    worksite_id: NORD,
    worksite_label: "Baustelle Nord",
    employee_id: ANNA,
    employee_label: "Anna Bauer",
    local_date: "2026-06-15",
    duration_ms: "28800000",
    rate_version_id: SATZ,
    amount_minor_units: "20000",
    ...ueberschreibung,
  };
}

function repositoryMit(
  runnerOptionen: RunnerOptionen = {},
  idempotenzOptionen: IdempotenzOptionen = {},
): {
  readonly repository: PgCostSnapshotRepository;
  readonly runner: AufzeichnenderRunner;
  readonly idempotenz: AufzeichnendeIdempotenz;
} {
  const runner = new AufzeichnenderRunner(runnerOptionen);
  const idempotenz = new AufzeichnendeIdempotenz(idempotenzOptionen);
  return {
    repository: new PgCostSnapshotRepository(runner, SUBJEKT, idempotenz),
    runner,
    idempotenz,
  };
}

describe("PgCostSnapshotRepository.create", () => {
  it("Fall 1 — schreibt Kopf und Positionen in genau EINER Transaktion", async () => {
    const { repository, runner } = repositoryMit();

    const ergebnis = await repository.create(neuerSnapshot());

    // Zwei Transaktionen waeren zwei Commits: dazwischen existierte ein Kopf
    // ohne Positionen — ein Snapshot ueber 0,00 EUR, den die Datenbank
    // mangels update- und delete-Recht nie wieder loswird.
    expect(runner.runAufrufe).toBe(1);
    expect(ergebnis).toEqual({ ok: true, snapshotId: SNAPSHOT_ID });
    expect(runner.kontexte).toEqual([{ userId: SUBJEKT }]);
  });

  it("Fall 2 — gibt weder `id` noch `created_at` mit", async () => {
    const { repository, runner } = repositoryMit();

    await repository.create(neuerSnapshot());

    const kopf = runner.anweisungen.find((a) => spur(a.sql) === "insert:kopf");
    const spalten = kopf?.sql.slice(0, kopf.sql.indexOf(")")) ?? "";
    // Migration 0018 erteilt insert SPALTENWEISE; `id` und `created_at` fehlen
    // dort. Wer sie mitgibt, bekommt 42501 — erst in der echten Datenbank.
    expect(spalten).not.toMatch(/\bid\b/);
    expect(spalten).not.toContain("created_at");
    // Die Id kommt aus der Datenbank zurueck, nicht aus dem Prozess.
    expect(kopf?.sql).toContain("returning id");
    // `created_by` ebenfalls aus der Datenbank: die insert-Policy verlangt
    // `created_by = auth.uid()`, ein Wert aus der Eingabe waere eine
    // Behauptung, die die Policy prueft und ablehnt.
    expect(kopf?.sql).toContain("app.current_user_id()");
  });

  it("Fall 3 — schreibt ALLE Positionen mit EINER Anweisung", async () => {
    const vierzig = Array.from({ length: 40 }, (_, i) =>
      position({ localDate: `2026-06-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    const { repository, runner } = repositoryMit();

    await repository.create(neuerSnapshot({ positions: vierzig, totalMinorUnits: 800_000n }));

    const positionsAnweisungen = runner.spuren().filter((s) => s === "insert:positionen");
    // Vierzig Rundreisen statt einer waeren nicht bloss langsam: jede weitere
    // Anweisung ist eine weitere Stelle, an der die Transaktion abbrechen kann.
    expect(positionsAnweisungen).toHaveLength(1);
  });

  it("Fall 4 — setzt `ordinal` aus der Arrayreihenfolge", async () => {
    const drei = [
      position({ localDate: "2026-06-15" }),
      position({ localDate: "2026-06-16" }),
      position({ localDate: "2026-06-17" }),
    ];
    const { repository, runner } = repositoryMit();

    await repository.create(neuerSnapshot({ positions: drei, totalMinorUnits: 60_000n }));

    const insert = runner.anweisungen.find((a) => spur(a.sql) === "insert:positionen");
    // Die Reihenfolge des Arrays IST die gespeicherte Ordnung — der Port fuehrt
    // bewusst kein eigenes `ordinal`-Feld, weil zwei Quellen derselben Ordnung
    // sich widersprechen koennten, ohne dass es auffiele.
    const ordinale = insert?.params.find(
      (wert) => Array.isArray(wert) && wert.every((e) => typeof e === "number"),
    );
    expect(ordinale).toEqual([0, 1, 2]);
    // Die Ortstage reisen in derselben Reihenfolge — sonst waere `ordinal`
    // zwar aufsteigend, aber an die falsche Position geheftet.
    const tage = insert?.params.find(
      (wert) => Array.isArray(wert) && wert.some((e) => e === "2026-06-16"),
    );
    expect(tage).toEqual(["2026-06-15", "2026-06-16", "2026-06-17"]);
  });

  it("Fall 5 — der fremde Kanal wird VOR dem Schreiben erkannt", async () => {
    const { repository, runner } = repositoryMit({ laufzeitkanal: false });

    const ergebnis = await repository.create(neuerSnapshot());

    expect(ergebnis).toEqual({ ok: false, problem: "WRITE_CHANNEL_REJECTED" });
    // Es wurde NICHTS geschrieben — weder Kopf noch Positionen.
    expect(runner.spuren()).toEqual(["frage:kanal"]);
  });

  it("Fall 5b — null Kopfzeilen bei bestaetigtem Kanal WIRFT, statt einen Grund zu erfinden", async () => {
    const { repository } = repositoryMit({ kopfZeilen: 0 });

    // Nach bestaetigtem Kanal ist das unerklaerlich: ein INSERT liefert die
    // Zeile oder wirft. `WRITE_CHANNEL_REJECTED` waere hier eine Diagnose, die
    // gerade widerlegt wurde.
    await expect(repository.create(neuerSnapshot())).rejects.toThrow(/Laufzeitkanal/);
  });

  it("Fall 6 — sperrt VOR der Replay-Abfrage und merkt sich erst nach dem Schreiben", async () => {
    const { repository, idempotenz } = repositoryMit();

    await repository.create(neuerSnapshot());

    // Ohne die Sperre saehen zwei gleichzeitige Anfragen mit demselben
    // Schluessel beide "nicht vorhanden", und der unique-Index faenge das erst
    // als Constraint-Fehler statt als Wiederholung mit dem Ergebnis der ersten.
    expect(idempotenz.rufe).toEqual(["lock", "find", "remember"]);
    expect(idempotenz.gemerkt[0]?.subjectId).toBe(SNAPSHOT_ID);
  });

  it("Fall 7 — derselbe Schluessel mit derselben Nutzlast liefert dieselbe Id, ohne zweiten Insert", async () => {
    const eingabe = neuerSnapshot();
    // Den Fingerabdruck der ersten Anfrage aus einem echten Lauf holen, statt
    // ihn im Test nachzubauen: eine nachgebaute Formel pruefte ihre eigene
    // Kopie und bliebe gruen, wenn die echte sich aenderte.
    const erst = repositoryMit();
    await erst.repository.create(eingabe);
    const fingerabdruck = erst.idempotenz.gemerkt[0]?.fingerprint ?? "";
    expect(fingerabdruck).not.toBe("");

    const { repository, runner, idempotenz } = repositoryMit(
      {},
      { bekannt: { subjectId: SNAPSHOT_ID, requestFingerprint: fingerabdruck } },
    );
    const ergebnis = await repository.create(eingabe);

    expect(ergebnis).toEqual({ ok: true, snapshotId: SNAPSHOT_ID });
    expect(runner.spuren()).toEqual([]);
    expect(idempotenz.rufe).toEqual(["lock", "find"]);
  });

  it("Fall 8 — derselbe Schluessel mit ANDERER Nutzlast ergibt IDEMPOTENCY_KEY_REUSED, ohne Insert", async () => {
    const { repository, runner } = repositoryMit(
      {},
      { bekannt: { subjectId: SNAPSHOT_ID, requestFingerprint: "ein-anderer-abdruck" } },
    );

    const ergebnis = await repository.create(neuerSnapshot());

    // Die alte Antwort zurueckzugeben waere falsch: die Aufruferin bekaeme ein
    // "angelegt" fuer etwas, das sie nie geschickt hat.
    expect(ergebnis).toEqual({ ok: false, problem: "IDEMPOTENCY_KEY_REUSED" });
    expect(runner.spuren()).toEqual([]);
  });

  it("Fall 9 — die Korrelations-Id gehoert NICHT zum Fingerabdruck", async () => {
    const a = repositoryMit();
    await a.repository.create(neuerSnapshot({ correlationId: "corr-1" }));
    const b = repositoryMit();
    await b.repository.create(neuerSnapshot({ correlationId: "corr-2" }));

    // Ein echter Retry traegt eine ANDERE Korrelations-Id. Waere sie Teil des
    // Abdrucks, saehe jede Wiederholung wie eine andere Nutzlast aus und der
    // Wiederholungsschutz waere wirkungslos.
    expect(a.idempotenz.gemerkt[0]?.fingerprint).toBe(b.idempotenz.gemerkt[0]?.fingerprint);
  });

  it("Fall 10 — eine fachlich andere Nutzlast ergibt einen ANDEREN Fingerabdruck", async () => {
    const a = repositoryMit();
    await a.repository.create(neuerSnapshot());
    const b = repositoryMit();
    await b.repository.create(neuerSnapshot({ totalMinorUnits: 20_001n }));

    // Die Gegenprobe zu Fall 9: waere der Abdruck konstant, waere er kein
    // Abdruck, und Fall 9 bliebe gruen, ohne etwas zu bedeuten.
    expect(a.idempotenz.gemerkt[0]?.fingerprint).not.toBe(b.idempotenz.gemerkt[0]?.fingerprint);
  });

  it("Fall 11 — ein Fehler beim Positions-Insert WIRFT und gibt nichts zurueck", async () => {
    const fkFehler = Object.assign(new Error("insert or update violates foreign key"), {
      code: "23503",
    });
    const { repository } = repositoryMit({ positionsFehler: fkFehler });

    // Ab hier ist der Kopf bereits geschrieben. Ein Rueckgabewert wuerde die
    // Transaktion COMMITTEN und einen Kopf ohne Positionen hinterlassen — und
    // den wird die Datenbank mangels delete-Recht nie wieder los.
    await expect(repository.create(neuerSnapshot())).rejects.toThrow();
  });

  it("Fall 12 — eine unvollstaendige Positionsschreibung WIRFT ebenfalls", async () => {
    const { repository } = repositoryMit({ positionsZeilen: 1 });

    await expect(
      repository.create(neuerSnapshot({ positions: [position(), position()] })),
    ).rejects.toThrow(/2/);
  });

  it("Fall 13 — Betraege und Dauern reisen als Zeichenkette, nie als number", async () => {
    const riesig = 9_007_199_254_740_993n; // ungerade, oberhalb 2^53
    const { repository, runner } = repositoryMit();

    await repository.create(
      neuerSnapshot({
        totalMinorUnits: riesig,
        positions: [position({ amountMinorUnits: riesig })],
      }),
    );

    const kopf = runner.anweisungen.find((a) => spur(a.sql) === "insert:kopf");
    expect(kopf?.params).toContain("9007199254740993");
    const positionen = runner.anweisungen.find((a) => spur(a.sql) === "insert:positionen");
    const betraege = positionen?.params.find(
      (wert) => Array.isArray(wert) && wert.includes("9007199254740993"),
    );
    // Ein `Number(...)` unterwegs machte daraus 9007199254740992 — lautlos.
    expect(betraege).toEqual(["9007199254740993"]);
  });

  it("Fall 14 — ein leerer Snapshot schreibt einen Kopf und KEINE Positionen", async () => {
    const { repository, runner } = repositoryMit();

    const ergebnis = await repository.create(neuerSnapshot({ positions: [], totalMinorUnits: 0n }));

    expect(ergebnis).toEqual({ ok: true, snapshotId: SNAPSHOT_ID });
    // Eine veroeffentlichte Planversion ohne Zuweisungen ist ein gueltiger
    // Fall; die Datenbank laesst `total_minor_units >= 0` ausdruecklich zu.
    expect(runner.spuren()).toEqual(["frage:kanal", "insert:kopf"]);
  });
});

describe("PgCostSnapshotRepository.read", () => {
  it("Fall 15 — liest Kopf und Positionen in genau EINER Transaktion", async () => {
    const { repository, runner } = repositoryMit({
      gelesenerKopf: [gespeicherteKopfzeile()],
      gelesenePositionen: [gespeichertePositionszeile()],
    });

    await repository.read(SNAPSHOT_ID);

    // Zwei Transaktionen saehen zwei Lesezeitpunkte — derselbe Fehler wie beim
    // Satzfaecher, nur eine Ebene hoeher.
    expect(runner.runAufrufe).toBe(1);
    expect(runner.spuren()).toEqual(["select:kopf", "select:positionen"]);
  });

  it("Fall 16 — liefert den gespeicherten Stand mit bigint-Betraegen", async () => {
    const { repository } = repositoryMit({
      gelesenerKopf: [gespeicherteKopfzeile({ total_minor_units: "9007199254740993" })],
      gelesenePositionen: [gespeichertePositionszeile({ amount_minor_units: "9007199254740993" })],
    });

    const ergebnis = await repository.read(SNAPSHOT_ID);

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.snapshot.totalMinorUnits).toBe(9_007_199_254_740_993n);
    expect(ergebnis.snapshot.positions[0]?.amountMinorUnits).toBe(9_007_199_254_740_993n);
    expect(ergebnis.snapshot.positions[0]?.durationMilliseconds).toBe(28_800_000n);
    expect(ergebnis.snapshot.createdAt).toEqual(new Date("2026-06-20T08:30:00.000Z"));
    expect(ergebnis.snapshot.createdBy).toBe(SUBJEKT);
    expect(ergebnis.snapshot.positions[0]?.localDate).toBe("2026-06-15");
  });

  it("Fall 17 — keine sichtbare Kopfzeile ergibt SNAPSHOT_NOT_FOUND", async () => {
    const { repository, runner } = repositoryMit({ gelesenerKopf: [] });

    const ergebnis = await repository.read(SNAPSHOT_ID);

    // "gibt es nicht", "gehoert einem anderen Mandanten" und "darf Kosten
    // nicht sehen" fallen zu EINER Antwort zusammen — sonst erfuehre, wer Ids
    // durchprobiert, an der Antwort, welche echt sind.
    expect(ergebnis).toEqual({ ok: false, problem: "SNAPSHOT_NOT_FOUND" });
    // Und die Positionen werden dann gar nicht erst gelesen.
    expect(runner.spuren()).toEqual(["select:kopf"]);
  });

  it("Fall 18 — rechnet beim Lesen nichts nach", async () => {
    const { repository, runner } = repositoryMit({
      gelesenerKopf: [gespeicherteKopfzeile({ total_minor_units: "123456" })],
      gelesenePositionen: [gespeichertePositionszeile({ amount_minor_units: "1" })],
    });

    const ergebnis = await repository.read(SNAPSHOT_ID);

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    // Die Summe des Kopfes widerspricht den Positionen ABSICHTLICH. Wer beim
    // Lesen nachrechnet, faellt hier auf — und genau das waere der Unterschied
    // zwischen einem Snapshot und einem Cache.
    expect(ergebnis.snapshot.totalMinorUnits).toBe(123_456n);
    // Keine Satz- oder Planungstabelle im Lesepfad (D7). Der Doppelgaenger
    // wuerde eine fremde Tabelle ohnehin mit einem Wurf quittieren; diese
    // Zusicherung sagt es nochmal ausdruecklich.
    expect(runner.anweisungen.every((a) => !a.sql.includes("employee_rate_versions"))).toBe(true);
    expect(runner.anweisungen.every((a) => !a.sql.includes("assignments"))).toBe(true);
  });
});
