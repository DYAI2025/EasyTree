/**
 * Der Kosten-Snapshot gegen echtes PostgreSQL (EYT-109 Task 11, EYT-138).
 *
 * Deckt die Aussagen ab, die ein Unittest strukturell nicht treffen kann:
 * Atomizitaet einer echten Transaktion, RLS, Spaltenrechte, mandantengebundene
 * Fremdschluessel und die Kanalgrenze aus Migration 0018. Der datenbankfreie
 * Zwilling `test/costs/cost-snapshot-repository.test.ts` misst die
 * Anweisungs- und Reihenfolgeeigenschaften; er ersetzt diese Suite nicht und
 * diese ihn nicht.
 *
 * ## Zwei Verbindungen, und warum
 *
 * `DB_URL` ist die Verwaltungs- und BEOBACHTERverbindung (`postgres`): sie legt
 * Fixtures an, raeumt auf und zaehlt. `APP_DB_URL` ist der LAUFZEITKANAL
 * (`easytree_app`) — dieselbe Loginrolle wie API und Worker. Das Repository
 * laeuft ausschliesslich dort.
 *
 * Beobachtungen laufen NIE ueber den Laufzeitkanal. `easytree_app` ist NOINHERIT
 * und sieht nach dem Rollenwechsel nur, was RLS durchlaesst — eine Zaehlung dort
 * koennte gerade das nicht sehen, dessen Abwesenheit sie belegen soll, und
 * scheiterte ausserdem an fehlenden Rechten (42501).
 *
 * ## Warum nach JEDEM Angriff gezaehlt wird und nicht einmal am Ende
 *
 * Netto-Zaehlungen heben sich auf: ein fehlgeschlagener Schreibversuch und eine
 * spaetere erfolgreiche Anlage ergaeben am Ende dieselbe Zeilenzahl wie ein
 * sauberer Lauf. Der Zustand wird deshalb unmittelbar nach dem jeweiligen
 * Versuch gemessen.
 *
 * ## Warum Rechte doppelt geprueft werden
 *
 * `42501` ist mehrdeutig — fehlendes Spaltenrecht ODER RLS-Verstoss. Wo zwei
 * Riegel schuetzen, steht neben dem Verhaltensfall deshalb eine
 * `has_table_privilege`-Aussage; erst beide zusammen sagen, WELCHER Riegel hielt.
 *
 * ## Gegenmutation zur Bezeichnungs-Herkunft (EYT-139)
 *
 * In `cost-snapshot-repository.pg.ts::create` die Parameter $5 und $7 tauschen
 * (`position.worksiteLabel` <-> `position.employeeLabel`) -> Fall 1 rot, in
 * Rundlauf UND Spalten. Denselben Tausch zusaetzlich in `zuPosition`
 * einbauen -> der Rundlauf bleibt gruen und NUR die Spaltenzusicherung faellt.
 * Beide Mutationen sind in `db-gates` AUSGEFUEHRT worden, nicht ausgedacht;
 * die Laufnummern stehen im Plan
 * `docs/plans/2026-08-12-eyt-139-snapshot-label-provenance.md`.
 */
import { Client, DatabaseError } from "pg";
import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgCostSnapshotRepository, PgRateRepository } from "../../src/modules/costs";
import type { AssembledPosition, NewCostSnapshot } from "../../src/modules/costs";
import { COST_RULE_VERSION } from "@easytree/domain";
import { PgIdempotencyStore } from "../../src/platform/idempotency/pg-idempotency-store";
import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../src/platform/database/tenant-query-runner";
import {
  FailClosedGate,
  ORG_ALPHA,
  ORG_BETA,
  probeDatabase,
  USER_A,
} from "../tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APP_DB_URL = process.env["EASYTREE_TEST_APP_DB_URL"];

/** Die Loginrolle, unter der API und Worker arbeiten (Migration 0003). */
const LAUFZEITROLLE = "easytree_app";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("cost-snapshot", TENANT_TESTS_MODE, "EYT-138");

let dbAvailable = false;
let admin: Client;
const clients: Client[] = [];

/** Seed-Konstanten aus supabase/seed.sql. */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";
const EMPLOYEE_BETA = "00000000-0000-4000-8000-0000004020b2";

/**
 * Eigene Satzversionen dieser Suite, mit festen Ids.
 *
 * Fest statt zufaellig, damit ein roter Lauf sich mit denselben Werten
 * wiederholen laesst. Gueltiges UUID-v4-Format — `IdSchema` und die Datenbank
 * lehnen andere Formen ab (EYT-91).
 */
const SATZ_ALPHA_1 = "00000000-0000-4000-8000-0000006c5001";
const SATZ_ALPHA_2 = "00000000-0000-4000-8000-0000006c5002";
const SATZ_BETA = "00000000-0000-4000-8000-0000006c50b2";
const SATZ_IDS = [SATZ_ALPHA_1, SATZ_ALPHA_2, SATZ_BETA];

/** Marke, an der der Aufraeumschritt die Zeilen dieser Suite erkennt. */
const MARKE = "cost-snapshot-integration";

/** Frei, weil `week_key` auf cost_snapshots keine Eindeutigkeit traegt. */
const WOCHE = "2026-W35";

/**
 * Eine Planversion existiert fuer diese Tabelle nur als WERT.
 *
 * Migration 0018 legt bewusst keinen Fremdschluessel auf `plan_versions` an — ein
 * historisches Dokument soll die Planung weder festhalten noch mit ihr
 * verschwinden. Deshalb genuegt hier eine Id, die niemand vergeben hat.
 */
const PLANVERSION = "00000000-0000-4000-8000-00000000f001";

function runnerAuf(client: Client): TenantQueryRunner {
  const tx: TenantQuery = {
    query: <TRow>(sql: string, params?: readonly unknown[]) =>
      client.query<TRow extends QueryResultRow ? TRow : never>(
        sql,
        params === undefined ? undefined : [...params],
      ) as never,
  };
  return {
    async run(kontext, work) {
      await client.query("begin");
      try {
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: kontext.userId, role: "authenticated" }),
        ]);
        await client.query("set local role authenticated");
        const ergebnis = await work(tx);
        await client.query("commit");
        return ergebnis;
      } catch (fehler) {
        await client.query("rollback");
        throw fehler;
      }
    },
  };
}

/** Verbindung auf dem Laufzeitkanal (`easytree_app`). */
async function neueVerbindung(): Promise<Client> {
  if (APP_DB_URL === undefined) {
    throw new Error(
      "[cost-snapshot] EASYTREE_TEST_APP_DB_URL fehlt — der Laufzeitkanal ist nicht konfiguriert.",
    );
  }
  const client = new Client({ connectionString: APP_DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

async function neueAdminVerbindung(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

function repositoryAuf(client: Client, subject: string = USER_A): PgCostSnapshotRepository {
  return new PgCostSnapshotRepository(runnerAuf(client), subject, new PgIdempotencyStore());
}

/**
 * Bezeichnungen, die einander nicht vertreten koennen (EYT-139).
 *
 * `worksite_label` und `employee_label` reisen als zwei BENACHBARTE, gleich
 * getypte `text[]`-Parameter in dieselbe `insert … select … from unnest(...)`-
 * Anweisung ($5 und $7). Ein Tausch der beiden ist typkorrekt, uebersteht
 * `tsc` und verletzt keine Datenbankbedingung — beide Spalten sind
 * `text not null check (length(trim(...)) > 0)` (Migration 0018). Nur ein Test
 * kann ihn sehen.
 *
 * Die beiden Sorten teilen deshalb kein Wort, und die beiden Positionen tragen
 * VERSCHIEDENE Werte: eine je Sorte wiederholte Bezeichnung maskierte
 * zusaetzlich einen Ordnungsfehler.
 */
const BAUSTELLE_ERSTE = "Baustelle Alpha Nord";
const BAUSTELLE_ZWEITE = "Baustelle Alpha Sued";
const PERSON_ERSTE = "Anna Alpha";
const PERSON_ZWEITE = "Bernd Beispiel";

function position(ueberschreibung: Partial<AssembledPosition> = {}): AssembledPosition {
  return {
    assignmentId: "00000000-0000-4000-8000-00000000a551",
    worksiteId: WORKSITE_ALPHA,
    worksiteLabel: "Baustelle Alpha",
    employeeId: EMPLOYEE_ALPHA,
    employeeLabel: "Anna Alpha",
    localDate: "2026-08-24",
    durationMilliseconds: 28_800_000n,
    rateVersionId: SATZ_ALPHA_1,
    amountMinorUnits: 20_000n,
    ruleVersion: COST_RULE_VERSION,
    ...ueberschreibung,
  };
}

let schluesselZaehler = 0;
function neuerSnapshot(ueberschreibung: Partial<NewCostSnapshot> = {}): NewCostSnapshot {
  schluesselZaehler += 1;
  return {
    organisationId: ORG_ALPHA,
    planVersionId: PLANVERSION,
    worksiteId: null,
    weekKey: WOCHE,
    timeZone: "Europe/Berlin",
    currency: "EUR",
    ruleVersion: COST_RULE_VERSION,
    totalMinorUnits: 20_000n,
    correlationId: `${MARKE}-${String(schluesselZaehler)}`,
    idempotencyKey: `${MARKE}-key-${String(schluesselZaehler)}`,
    positions: [position()],
    ...ueberschreibung,
  };
}

async function zaehle(sql: string, params: readonly unknown[]): Promise<number> {
  const ergebnis = await admin.query<{ n: string }>(sql, [...params]);
  return Number(ergebnis.rows[0]?.n ?? "0");
}

/** Beobachtung ueber die Adminverbindung — nie ueber den Laufzeitkanal. */
const koepfeMitKorrelation = (korrelation: string): Promise<number> =>
  zaehle("select count(*) as n from public.cost_snapshots where correlation_id = $1", [
    korrelation,
  ]);

const positionenVon = (snapshotId: string): Promise<number> =>
  zaehle("select count(*) as n from public.cost_snapshot_positions where snapshot_id = $1", [
    snapshotId,
  ]);

const alleKoepfeDieserSuite = (): Promise<number> =>
  zaehle("select count(*) as n from public.cost_snapshots where correlation_id like $1", [
    `${MARKE}%`,
  ]);

async function fehlercode(arbeit: () => Promise<unknown>): Promise<string | null> {
  try {
    await arbeit();
    return null;
  } catch (fehler) {
    return fehler instanceof DatabaseError ? (fehler.code ?? null) : null;
  }
}

/** Setzt die Rolle des Seed-Users in Org Alpha — ausserhalb jeder RLS. */
async function setzeRolle(rolle: "owner" | "manager" | "member"): Promise<void> {
  await admin.query("update public.memberships set role = $1 where org_id = $2 and user_id = $3", [
    rolle,
    ORG_ALPHA,
    USER_A,
  ]);
}

async function raeumeAuf(): Promise<void> {
  // Positionen zuerst: der mandantengebundene FK auf den Kopf steht auf
  // `on delete restrict`.
  await admin.query(
    `delete from public.cost_snapshot_positions
      where snapshot_id in (select id from public.cost_snapshots where correlation_id like $1)`,
    [`${MARKE}%`],
  );
  await admin.query("delete from public.cost_snapshots where correlation_id like $1", [
    `${MARKE}%`,
  ]);
  await admin.query("delete from public.idempotency_records where idempotency_key like $1", [
    `${MARKE}%`,
  ]);
  await admin.query("delete from public.employee_rate_versions where id = any($1::uuid[])", [
    SATZ_IDS,
  ]);
}

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(
        `SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar — ` +
          "lokal starten mit `pnpm exec supabase start && pnpm exec supabase db reset`.",
      );
    }
    await gate.run(fn);
  });
}

beforeAll(async () => {
  if (APP_DB_URL === undefined) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        "[cost-snapshot] fail-closed: EASYTREE_TEST_APP_DB_URL ist nicht gesetzt. Der " +
          "Snapshot-Schreibweg soll auf demselben Kanal gemessen werden, auf dem API und " +
          "Worker arbeiten (Loginrolle easytree_app).",
      );
    }
    console.warn("[cost-snapshot.integration] SKIPPED: EASYTREE_TEST_APP_DB_URL nicht gesetzt.");
    return;
  }
  dbAvailable = (await probeDatabase(DB_URL)) && (await probeDatabase(APP_DB_URL));
  if (!dbAvailable) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        `[cost-snapshot] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-138).`,
      );
    }
    console.warn(`[cost-snapshot.integration] SKIPPED: Postgres unter ${DB_URL} nicht erreichbar.`);
    return;
  }
  admin = await neueAdminVerbindung();
  await raeumeAuf();

  // Fixture-Aufbau ohne Rollenwechsel, also an RLS vorbei. Das ist Absicht: es
  // ist Vorbedingung und keine Zusicherung. Was RLS zulaesst, messen die Faelle.
  await admin.query(
    `insert into public.employee_rate_versions
       (id, org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
        reason, created_by, correlation_id)
     values ($1, $2, $3, 2500, 'EUR', date '2026-01-01', null, $6, $4, $5),
            ($7, $2, $3, 2600, 'EUR', date '2025-01-01', date '2025-12-31', $6, $4, $5)`,
    [SATZ_ALPHA_1, ORG_ALPHA, EMPLOYEE_ALPHA, USER_A, MARKE, MARKE, SATZ_ALPHA_2],
  );
  await admin.query(
    `insert into public.employee_rate_versions
       (id, org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
        reason, created_by, correlation_id)
     values ($1, $2, $3, 3300, 'EUR', date '2026-01-01', null, $5, $4, $5)`,
    [SATZ_BETA, ORG_BETA, EMPLOYEE_BETA, USER_A, MARKE],
  );
  await setzeRolle("owner");
});

afterAll(async () => {
  if (dbAvailable) {
    await setzeRolle("owner").catch(() => undefined);
    await raeumeAuf().catch(() => undefined);
  }
  process.stdout.write(gate.reportLine());
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
  gate.assertOrThrow();
});

describe("Kosten-Snapshot gegen echtes PostgreSQL", () => {
  dbIt("laeuft auf dem Laufzeitkanal, nicht auf der Verwaltungsverbindung", async () => {
    // Ohne diese Aussage koennte APP_DB_URL unbemerkt auf `postgres` zeigen —
    // und `postgres` traegt BYPASSRLS. Jede folgende Mandantenaussage waere
    // dann wertlos.
    const client = await neueVerbindung();
    const gemessen = await runnerAuf(client).run({ userId: USER_A }, async (tx) => {
      const zeile = await tx.query<{ session_user: string; current_user: string }>(
        "select session_user, current_user",
      );
      return zeile.rows[0];
    });

    expect(gemessen?.session_user).toBe(LAUFZEITROLLE);
    expect(gemessen?.current_user).toBe("authenticated");
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 1 — schreibt Kopf und Positionen und liest sie unveraendert zurueck", async () => {
    const client = await neueVerbindung();
    const eingabe = neuerSnapshot({
      positions: [
        position({
          localDate: "2026-08-24",
          amountMinorUnits: 20_000n,
          worksiteLabel: BAUSTELLE_ERSTE,
          employeeLabel: PERSON_ERSTE,
        }),
        position({
          localDate: "2026-08-25",
          amountMinorUnits: 10_000n,
          durationMilliseconds: 14_400_000n,
          worksiteLabel: BAUSTELLE_ZWEITE,
          employeeLabel: PERSON_ZWEITE,
        }),
      ],
      totalMinorUnits: 30_000n,
    });

    const geschrieben = await repositoryAuf(client).create(eingabe);
    expect(geschrieben.ok).toBe(true);
    if (!geschrieben.ok) return;

    // Zustand unmittelbar nach dem Schreiben, ueber die Beobachterverbindung.
    expect(await koepfeMitKorrelation(eingabe.correlationId)).toBe(1);
    expect(await positionenVon(geschrieben.snapshotId)).toBe(2);

    const gelesen = await repositoryAuf(await neueVerbindung()).read(geschrieben.snapshotId);
    expect(gelesen.ok).toBe(true);
    if (!gelesen.ok) return;

    expect(gelesen.snapshot.id).toBe(geschrieben.snapshotId);
    expect(gelesen.snapshot.organisationId).toBe(ORG_ALPHA);
    expect(gelesen.snapshot.planVersionId).toBe(PLANVERSION);
    expect(gelesen.snapshot.weekKey).toBe(WOCHE);
    expect(gelesen.snapshot.timeZone).toBe("Europe/Berlin");
    expect(gelesen.snapshot.currency).toBe("EUR");
    expect(gelesen.snapshot.ruleVersion).toBe(COST_RULE_VERSION);
    expect(gelesen.snapshot.totalMinorUnits).toBe(30_000n);
    // `created_by` kommt aus app.current_user_id(), nicht aus der Eingabe —
    // die insert-Policy verlangt `created_by = auth.uid()`.
    expect(gelesen.snapshot.createdBy).toBe(USER_A);
    // `created_at` stammt aus dem Serverdefault: Migration 0018 erteilt kein
    // insert-Recht auf die Spalte (EYT-138, Entscheidung D-11-1).
    expect(gelesen.snapshot.createdAt).toBeInstanceOf(Date);

    // Reihenfolge nach `ordinal`, nicht nach Zufall.
    expect(gelesen.snapshot.positions.map((p) => p.localDate)).toEqual([
      "2026-08-24",
      "2026-08-25",
    ]);
    expect(gelesen.snapshot.positions.map((p) => p.amountMinorUnits)).toEqual([20_000n, 10_000n]);
    expect(gelesen.snapshot.positions[1]?.durationMilliseconds).toBe(14_400_000n);
    expect(gelesen.snapshot.positions[0]?.rateVersionId).toBe(SATZ_ALPHA_1);
    // Die Ids der Positionen entstehen in der Datenbank.
    expect(gelesen.snapshot.positions.every((p) => p.id.length === 36)).toBe(true);

    // Herkunft beider Bezeichnungen — nicht blosse Anwesenheit (EYT-139).
    //
    // Der Rundlauf zuerst: er faengt einen Tausch, der NUR beim Schreiben
    // passiert.
    expect(gelesen.snapshot.positions.map((p) => p.worksiteLabel)).toEqual([
      BAUSTELLE_ERSTE,
      BAUSTELLE_ZWEITE,
    ]);
    expect(gelesen.snapshot.positions.map((p) => p.employeeLabel)).toEqual([
      PERSON_ERSTE,
      PERSON_ZWEITE,
    ]);

    // Und dann die GESPEICHERTEN Spalten, ueber die Beobachterverbindung.
    //
    // Diese Zusicherung ist der eigentliche Herkunftsbeweis: ein Tausch, der in
    // `create` UND in `zuPosition` gleich falsch ist, hebt sich im Rundlauf auf
    // — zurueck kaeme das Richtige, waehrend in der Tabelle das Vertauschte
    // steht. Ein Snapshot laesst sich weder aendern noch loeschen (Migration
    // 0018 erteilt kein update- und kein delete-Grant); was hier falsch liegt,
    // bleibt falsch und wandert so in den Export (EYT-110).
    const gespeicherteBezeichnungen = await admin.query<{
      worksite_label: string;
      employee_label: string;
    }>(
      `select worksite_label, employee_label
         from public.cost_snapshot_positions
        where snapshot_id = $1
        order by ordinal`,
      [geschrieben.snapshotId],
    );
    expect(gespeicherteBezeichnungen.rows).toEqual([
      { worksite_label: BAUSTELLE_ERSTE, employee_label: PERSON_ERSTE },
      { worksite_label: BAUSTELLE_ZWEITE, employee_label: PERSON_ZWEITE },
    ]);
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 2 — ein Fehler bei der letzten Position hinterlaesst KEINEN Kopf", async () => {
    const client = await neueVerbindung();
    const eingabe = neuerSnapshot({
      positions: [
        position(),
        // Die Satzversion gehoert Mandant BETA. Der mandantengebundene FK
        // (rate_version_id, org_id) lehnt das ab — unabhaengig von RLS, mit
        // SQLSTATE 23503.
        position({ localDate: "2026-08-25", rateVersionId: SATZ_BETA }),
      ],
      totalMinorUnits: 40_000n,
    });

    const code = await fehlercode(() => repositoryAuf(client).create(eingabe));
    expect(code).toBe("23503");

    // Zustand unmittelbar nach DIESEM Angriff. Der Kopf war zum Zeitpunkt des
    // Fehlers bereits geschrieben — nur der Rollback macht ihn ungeschehen.
    // Es gibt kein delete-Grant: was hier committet waere, bliebe fuer immer.
    expect(await koepfeMitKorrelation(eingabe.correlationId)).toBe(0);
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 3 — Unveraenderlichkeit: Verhalten UND fehlendes Recht", async () => {
    const client = await neueVerbindung();
    const eingabe = neuerSnapshot();
    const geschrieben = await repositoryAuf(client).create(eingabe);
    expect(geschrieben.ok).toBe(true);
    if (!geschrieben.ok) return;

    // (a) Verhalten: ein update ueber den Laufzeitkanal scheitert.
    const updateVerbindung = await neueVerbindung();
    const updateCode = await fehlercode(() =>
      runnerAuf(updateVerbindung).run({ userId: USER_A }, (tx) =>
        tx.query("update public.cost_snapshots set total_minor_units = 0 where id = $1", [
          geschrieben.snapshotId,
        ]),
      ),
    );
    expect(updateCode).toBe("42501");

    // (b) Struktur: `42501` allein ist mehrdeutig — Spaltenrecht ODER RLS.
    // Diese Aussage sagt, WELCHER Riegel hielt: es gibt gar kein Recht.
    const rechte = await admin.query<{
      snapshot_update: boolean;
      snapshot_delete: boolean;
      position_update: boolean;
      position_delete: boolean;
    }>(
      `select has_table_privilege('authenticated', 'public.cost_snapshots', 'UPDATE') as snapshot_update,
              has_table_privilege('authenticated', 'public.cost_snapshots', 'DELETE') as snapshot_delete,
              has_table_privilege('authenticated', 'public.cost_snapshot_positions', 'UPDATE') as position_update,
              has_table_privilege('authenticated', 'public.cost_snapshot_positions', 'DELETE') as position_delete`,
    );
    expect(rechte.rows[0]).toEqual({
      snapshot_update: false,
      snapshot_delete: false,
      position_update: false,
      position_delete: false,
    });

    // Die Zeile steht unveraendert da.
    const summe = await admin.query<{ total_minor_units: string }>(
      "select total_minor_units::text as total_minor_units from public.cost_snapshots where id = $1",
      [geschrieben.snapshotId],
    );
    expect(summe.rows[0]?.total_minor_units).toBe("20000");
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 4 — ein fremder Mandant liest den Snapshot nicht, obwohl er existiert", async () => {
    const client = await neueVerbindung();
    const eingabe = neuerSnapshot();
    const geschrieben = await repositoryAuf(client).create(eingabe);
    expect(geschrieben.ok).toBe(true);
    if (!geschrieben.ok) return;

    // Ein Subjekt, das in Org Alpha NICHT Mitglied ist. `USER_B` gibt es im
    // Seed als Mitglied von Beta.
    const fremdeSicht = await repositoryAuf(
      await neueVerbindung(),
      "00000000-0000-4000-8000-00000000bbb2",
    ).read(geschrieben.snapshotId);

    expect(fremdeSicht).toEqual({ ok: false, problem: "SNAPSHOT_NOT_FOUND" });

    // Die zweite Haelfte: die Zeile EXISTIERT. Ohne sie waere „nicht sichtbar"
    // von „nicht vorhanden" nicht zu trennen, und der Fall bewiese nichts.
    expect(await koepfeMitKorrelation(eingabe.correlationId)).toBe(1);
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 5 — die Rolle `member` darf weder erzeugen noch lesen", async () => {
    const client = await neueVerbindung();
    const eingabe = neuerSnapshot();
    const geschrieben = await repositoryAuf(client).create(eingabe);
    expect(geschrieben.ok).toBe(true);
    if (!geschrieben.ok) return;

    await setzeRolle("member");
    try {
      // Lesen: die select-Policy verlangt `costs.read`.
      const gelesen = await repositoryAuf(await neueVerbindung()).read(geschrieben.snapshotId);
      expect(gelesen).toEqual({ ok: false, problem: "SNAPSHOT_NOT_FOUND" });

      // Erzeugen: die insert-Policy verlangt `costs.calculate`.
      //
      // Gemessen am 12.08.2026 im ersten db-gates-Lauf dieser Suite: eine
      // verletzte `with check`-Klausel WIRFT bei INSERT (42501, "new row
      // violates row-level security policy") — sie liefert KEINE null Zeilen.
      // Nur eine `using`-Klausel filtert. Eine frueher hier stehende Erwartung
      // „liefert ok: false" war deshalb falsch, und zwar nicht nur im Test: das
      // Repository hat daraufhin die Kanalfrage vor das Schreiben gezogen,
      // statt den Kanal aus einer Zeilenzahl zu erraten.
      //
      // Der Wurf ist hier das RICHTIGE Verhalten: die `CostAccessPolicy` hat
      // `costs.calculate` bereits geprueft: kommt der Aufruf trotzdem bis
      // hierher, widersprechen sich Anwendungsschicht und Datenbank, und das
      // ist ein Defekt, kein fachlicher Fall.
      const zweiter = neuerSnapshot();
      const schreibVerbindung = await neueVerbindung();
      const code = await fehlercode(() => repositoryAuf(schreibVerbindung).create(zweiter));
      expect(code).toBe("42501");
      expect(await koepfeMitKorrelation(zweiter.correlationId)).toBe(0);

      // Und derselbe Mitgliedsstatus liest auch roh nichts — das Mitglied ist
      // Teil DERSELBEN Organisation, es fehlt nur das Recht.
      const roh = await runnerAuf(await neueVerbindung()).run({ userId: USER_A }, async (tx) => {
        const zeilen = await tx.query<{ id: string }>("select id from public.cost_snapshots");
        return zeilen.rows.length;
      });
      expect(roh).toBe(0);
    } finally {
      await setzeRolle("owner");
    }
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 6 — Wiederholung: gleicher Schluessel, gleiche Nutzlast, EINE Zeile", async () => {
    const eingabe = neuerSnapshot();

    const erst = await repositoryAuf(await neueVerbindung()).create(eingabe);
    expect(erst.ok).toBe(true);
    if (!erst.ok) return;
    expect(await koepfeMitKorrelation(eingabe.correlationId)).toBe(1);

    // Ein echter Retry traegt eine ANDERE Korrelations-Id — sie gehoert
    // deshalb nicht zum Fingerabdruck.
    const wieder = await repositoryAuf(await neueVerbindung()).create({
      ...eingabe,
      correlationId: `${eingabe.correlationId}-retry`,
    });
    expect(wieder).toEqual({ ok: true, snapshotId: erst.snapshotId });

    // KEINE zweite Zeile — weder unter der alten noch unter der neuen
    // Korrelations-Id.
    expect(await koepfeMitKorrelation(eingabe.correlationId)).toBe(1);
    expect(await koepfeMitKorrelation(`${eingabe.correlationId}-retry`)).toBe(0);
    expect(await positionenVon(erst.snapshotId)).toBe(1);
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 7 — gleicher Schluessel, ANDERE Nutzlast: abgelehnt, ohne zweite Zeile", async () => {
    const eingabe = neuerSnapshot();
    const erst = await repositoryAuf(await neueVerbindung()).create(eingabe);
    expect(erst.ok).toBe(true);
    if (!erst.ok) return;

    const anders = await repositoryAuf(await neueVerbindung()).create({
      ...eingabe,
      totalMinorUnits: 99_999n,
      correlationId: `${eingabe.correlationId}-anders`,
    });

    expect(anders).toEqual({ ok: false, problem: "IDEMPOTENCY_KEY_REUSED" });
    expect(await koepfeMitKorrelation(`${eingabe.correlationId}-anders`)).toBe(0);
    expect(await koepfeMitKorrelation(eingabe.correlationId)).toBe(1);
  });

  // -------------------------------------------------------------------------
  dbIt("Fall 8 — dieselbe Anlage ausserhalb des Laufzeitkanals wird abgelehnt", async () => {
    // Das ist der Nachweis, den pgTAP nicht fuehren kann: `SET SESSION
    // AUTHORIZATION` braucht Superuser, und pgTAP laeuft als `postgres`. Hier
    // gibt es eine zweite echte Verbindung — session_user ist `postgres`,
    // also erfuellt `app.is_runtime_channel()` nicht.
    const nichtLaufzeit = await neueAdminVerbindung();
    const vorher = await alleKoepfeDieserSuite();

    const korrelation = `${MARKE}-fremder-kanal`;
    const code = await fehlercode(() =>
      runnerAuf(nichtLaufzeit).run({ userId: USER_A }, (tx) =>
        tx.query(
          `insert into public.cost_snapshots
             (org_id, plan_version_id, worksite_id, week_key, time_zone, currency,
              rule_version, total_minor_units, created_by, correlation_id)
           values ($1::uuid, $2::uuid, null, $3, 'Europe/Berlin', 'EUR', $4, 1, app.current_user_id(), $5)`,
          [ORG_ALPHA, PLANVERSION, WOCHE, COST_RULE_VERSION, korrelation],
        ),
      ),
    );

    // 42501: die insert-Policy hat `with check` verletzt gesehen.
    expect(code).toBe("42501");
    expect(await koepfeMitKorrelation(korrelation)).toBe(0);
    // Und nichts anderes ist dabei entstanden.
    expect(await alleKoepfeDieserSuite()).toBe(vorher);

    // Gegenprobe zur Aussage selbst: dieselbe Verbindung meldet tatsaechlich
    // NICHT die Laufzeitrolle. Ohne sie koennte der Fall aus einem ganz
    // anderen Grund fehlschlagen und trotzdem gruen aussehen.
    const wer = await nichtLaufzeit.query<{ session_user: string }>("select session_user");
    expect(wer.rows[0]?.session_user).not.toBe(LAUFZEITROLLE);
  });

  // -------------------------------------------------------------------------
  dbIt(
    "Fall 8b — das Repository selbst erkennt den fremden Kanal und schreibt nichts",
    async () => {
      // Fall 8 misst die Datenbank, dieser Fall das Repository auf derselben
      // Lage: `app.is_runtime_channel()` ist hier falsch, also kommt der
      // benannte Grund zurueck statt eines Wurfs — und es wird nichts
      // geschrieben, nicht einmal versucht.
      const nichtLaufzeit = await neueAdminVerbindung();
      const eingabe = neuerSnapshot();

      const ergebnis = await repositoryAuf(nichtLaufzeit).create(eingabe);

      expect(ergebnis).toEqual({ ok: false, problem: "WRITE_CHANNEL_REJECTED" });
      expect(await koepfeMitKorrelation(eingabe.correlationId)).toBe(0);
    },
  );

  // -------------------------------------------------------------------------
  dbIt(
    "Fall 9 — versionsForMany liefert vollstaendige, mandantenreine Historien (EYT-138)",
    async () => {
      const client = await neueVerbindung();
      const rates = new PgRateRepository(runnerAuf(client), USER_A, new PgIdempotencyStore());

      // Drei Ids: eine mit zwei Versionen, eine Beta-Person (fuer diesen
      // Mandanten unsichtbar) und eine, die es nicht gibt.
      const abbildung = await rates.versionsForMany([
        EMPLOYEE_ALPHA,
        EMPLOYEE_BETA,
        "00000000-0000-4000-8000-0000004010ff",
      ]);

      // Jede angefragte Id traegt einen Eintrag — auch die ohne Treffer.
      expect(abbildung.size).toBe(3);

      const alpha = abbildung.get(EMPLOYEE_ALPHA) ?? [];
      const dieserSuite = alpha.filter((version) => SATZ_IDS.includes(version.id));
      // Absteigend nach validFrom — die Datenbank sortiert, nicht der Prozess.
      expect(dieserSuite.map((version) => version.id)).toEqual([SATZ_ALPHA_1, SATZ_ALPHA_2]);
      expect(dieserSuite.map((version) => version.amountMinorUnits)).toEqual(["2500", "2600"]);

      // RLS: die Historie des fremden Mandanten kommt NICHT mit, obwohl die
      // Zeile existiert.
      expect(abbildung.get(EMPLOYEE_BETA)).toEqual([]);
      expect(
        await zaehle("select count(*) as n from public.employee_rate_versions where id = $1", [
          SATZ_BETA,
        ]),
      ).toBe(1);

      // Die unbekannte Person: gefragt, nichts vorhanden — und das ist etwas
      // anderes als „nie gefragt".
      expect(abbildung.get("00000000-0000-4000-8000-0000004010ff")).toEqual([]);
    },
  );
});
