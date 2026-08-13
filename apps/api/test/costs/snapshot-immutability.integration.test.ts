/**
 * Ein gespeicherter Snapshot ueberlebt eine RUECKWIRKEND wirksame Satzversion
 * (EYT-143, EYT-109 Task 14).
 *
 * ## Warum es diese Datei zusaetzlich zu I8 gibt
 *
 * `snapshot-http.integration.test.ts::I8` faehrt dasselbe Szenario an der
 * HTTP-Naht und misst es gut. Zwei Aussagen kann er aus Bauart nicht treffen,
 * und genau die stehen hier:
 *
 *  1. I8 beobachtet ausschliesslich die LESEAUSGABE. Ein Defekt, der die
 *     gespeicherten Zeilen umschriebe UND sie konsistent zurueckliese, liesse
 *     ihn gruen — beide Haelften waeren gleich falsch und hoben sich auf.
 *     Diese Suite vergleicht die Zeilen SELBST: dieselben Spalten vor und nach
 *     der Abloesung, gelesen ueber die Beobachterverbindung, an jedem Lesepfad
 *     vorbei.
 *  2. I8 belegt die aktuelle Satzauflage mit rohem Admin-SQL
 *     (`wirksameSaetze`). Diese Suite fragt den PRODUKTIONSPFAD:
 *     `PgRateRepository.versionsFor` plus `effectiveRateVersion` — dieselbe
 *     Auswahl, die die Montage benutzt. Ein Defekt in der Satzauswahl waere
 *     unter rohem SQL unsichtbar, und der Angriffsschritt bewiese dann nicht,
 *     was er behauptet.
 *
 * Und sie misst an der PERSISTENZNAHT: `read()` direkt, ohne Controller,
 * Filter und DTO dazwischen.
 *
 * ## Zwei Verbindungen, und warum
 *
 * `EASYTREE_TEST_APP_DB_URL` ist der LAUFZEITKANAL (`easytree_app`) — dieselbe
 * Loginrolle wie API und Worker; nur dort darf geschrieben werden, denn
 * `cost_snapshots` verlangt in beiden insert-Policies `app.is_runtime_channel()`
 * (Migration 0018). `EASYTREE_TEST_DB_URL` ist die Verwaltungs- und
 * BEOBACHTERverbindung (`postgres`).
 *
 * Beobachtungen laufen NIE ueber den Laufzeitkanal. `easytree_app` ist NOINHERIT
 * und saehe nach `set local role authenticated` nur, was RLS durchlaesst — eine
 * Beobachtung dort koennte gerade das nicht sehen, dessen Unveraendertheit sie
 * belegen soll, und scheiterte ausserdem an fehlenden Rechten (42501).
 *
 * ## Warum eigene Person, eigene Ids, eigenes Jahr
 *
 * `effectiveRateVersion` antwortet RATE_AMBIGUOUS, sobald zwei Versionen am
 * selben Tag gelten. Teilte diese Suite ihre Person mit einer anderen,
 * entschiede die Laufreihenfolge ueber das Ergebnis — der Fall waere rot aus dem
 * falschen Grund. Das ist gemessen und nicht befuerchtet: in EYT-108 fielen
 * zwei Faelle genau so (CI-Lauf 30773551669), weil die offene Version des
 * vorigen Falls in das Intervall des naechsten ragte.
 *
 * ## Fail-closed
 *
 * Modus aus `EASYTREE_TENANT_TESTS`. In CI (`required`) ist eine unerreichbare
 * Datenbank ein Fehler, kein Skip. Jeder Lauf schreibt eine greppbare Zeile, die
 * `scripts/assert-tenant-report.sh` auswertet — das Skript prueft zusaetzlich
 * `passed == executed`, was sich als regulaerer Ausdruck nicht formulieren
 * laesst.
 *
 * ## Gegenmutation — AUSGEFUEHRT, nicht nur benannt
 *
 * In `cost-snapshot-repository.pg.ts::read` die Positionsabfrage um einen
 * `left join public.employee_rate_versions` erweitern und `rate_version_id` wie
 * `amount_minor_units` aus dem am Leistungstag DERZEIT wirksamen Satz ermitteln,
 * statt sie zu lesen. Sie kompiliert — die Ergebnisform bleibt Spalte fuer
 * Spalte `PositionsZeile`, `tsc` und `eslint` bleiben gruen.
 *
 * GEMESSEN, und es widerlegt eine naheliegende Annahme: sie faellt NICHT nur
 * hier. `cost-snapshot-repository.test.ts::Fall 18` wird ebenfalls rot, obwohl
 * er ohne Datenbank laeuft — er prueft den SQL-TEXT der abgesetzten Anweisungen
 * gegen `employee_rate_versions`. Der Waechter `costs-touches-only-own-tables`
 * dagegen greift wirklich nicht: die Tabelle gehoert dem Kostenmodul selbst.
 *
 * Diese Suite ist deshalb nicht der einzige, aber der einzige VERHALTENSnahe
 * Nachweis. Fall 18 sagt „die Anweisung nennt die Satztabelle nicht"; er kann
 * nicht sagen, dass die echte Datenbank fuer dieselbe Id nach einer Abloesung
 * wieder die historischen Werte liefert und die gespeicherten Zeilen dabei
 * unberuehrt bleiben. Ein Nachrechnen, das den Namen der Satztabelle nicht im
 * Anweisungstext traegt — ueber eine Sicht, eine Funktion oder eine zweite
 * Datenquelle —, saehe er nicht. Die beiden ersetzen einander nicht.
 */
import { COST_RULE_VERSION } from "@easytree/domain";
import { Client } from "pg";
import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// AUSSCHLIESSLICH ueber die Modulwurzel. Ein tiefer Pfad nach `costs/…` faellt
// am Waechter `costs-cross-module-public-api-only`, auch aus einem Test.
import {
  PgCostSnapshotRepository,
  PgRateRepository,
  effectiveRateVersion,
} from "../../src/modules/costs";
import type { AssembledPosition, NewCostSnapshot } from "../../src/modules/costs";
import type {
  TenantQuery,
  TenantQueryRunner,
} from "../../src/platform/database/tenant-query-runner";
import { PgIdempotencyStore } from "../../src/platform/idempotency/pg-idempotency-store";
import { FailClosedGate, ORG_ALPHA, probeDatabase, USER_A } from "../tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APP_DB_URL = process.env["EASYTREE_TEST_APP_DB_URL"];

/** Die Loginrolle, unter der API und Worker arbeiten (Migration 0003). */
const LAUFZEITROLLE = "easytree_app";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("snapshot-immutability", TENANT_TESTS_MODE, "EYT-143");

/** Marke, an der der Aufraeumschritt die Zeilen dieser Suite erkennt. */
const MARKE = "snapshot-immutability-integration";

/** Eigene Person dieser Suite — siehe Kopf, Abschnitt „eigene Person". */
const EMPLOYEE = "00000000-0000-4000-8000-000000401431";
/** Baustelle aus `supabase/seed.sql` (Org ALPHA). */
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";
/** Feste Id der Ausgangsversion — ein roter Lauf soll sich wiederholen lassen. */
const SATZ_V1 = "00000000-0000-4000-8000-0000006d1431";

/**
 * Der Leistungstag, den der Snapshot bepreist.
 *
 * V2 beginnt GENAU an diesem Tag — das ist der scharfe Teil. Eine erst danach
 * beginnende Version veraenderte auch eine Neuberechnung nicht und unterschiede
 * „Snapshot" deshalb nicht von „Cache".
 *
 * Das Intervall ist halboffen (`[validFrom, validTo)`, Migration 0013): nach der
 * Abloesung endet V1 am Leistungstag und gilt dort NICHT mehr, V2 gilt ab ihm.
 * Genau eine Version ist wirksam, `effectiveRateVersion` bleibt eindeutig.
 */
const LEISTUNGSTAG = "2029-03-15";
const V1_AB = "2029-01-01";

/** Acht Stunden Schicht. */
const SCHICHT_MS = 28_800_000n;
/**
 * Deutlich verschieden, und das ist bindend: traegt V2 denselben Betrag wie V1,
 * saehe auch eine Neuberechnung dieselbe Zahl und der Fall bewiese nichts.
 */
const SATZ_V1_PRO_STUNDE = 2_500n;
const SATZ_V2_PRO_STUNDE = 9_900n;
const BETRAG_V1 = (SATZ_V1_PRO_STUNDE * SCHICHT_MS) / 3_600_000n;

/**
 * Eine Planversion existiert fuer `cost_snapshots` nur als WERT.
 *
 * Migration 0018 legt bewusst keinen Fremdschluessel auf `plan_versions` an — ein
 * historisches Dokument soll die Planung weder festhalten noch mit ihr
 * verschwinden. Deshalb genuegt hier eine Id, die niemand vergeben hat.
 */
const PLANVERSION = "00000000-0000-4000-8000-00000000f143";
const WOCHE = "2029-W11";

let dbAvailable = false;
let admin: Client;
const clients: Client[] = [];

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
      "[snapshot-immutability] EASYTREE_TEST_APP_DB_URL fehlt — der Laufzeitkanal ist nicht konfiguriert.",
    );
  }
  const client = new Client({ connectionString: APP_DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

function snapshotRepositoryAuf(client: Client): PgCostSnapshotRepository {
  return new PgCostSnapshotRepository(runnerAuf(client), USER_A, new PgIdempotencyStore());
}

function satzRepositoryAuf(client: Client): PgRateRepository {
  return new PgRateRepository(runnerAuf(client), USER_A, new PgIdempotencyStore());
}

/**
 * Die gespeicherten Positionsspalten, roh — ueber die BEOBACHTERverbindung.
 *
 * Das ist die Aussage, die I8 strukturell nicht treffen kann: er sieht nur, was
 * `read` zurueckgibt. Hier steht, was in der Tabelle STEHT.
 *
 * `local_date` ueber `to_char` und die beiden `bigint`-Spalten ueber `::text`:
 * sonst waere der Vergleich von der Prozesszeitzone und von der
 * Zahlengenauigkeit des Treibers abhaengig statt von der Zeile.
 */
async function gespeichertePositionen(snapshotId: string): Promise<readonly unknown[]> {
  const ergebnis = await admin.query<{
    ordinal: number;
    assignment_id: string;
    worksite_id: string;
    worksite_label: string;
    employee_id: string;
    employee_label: string;
    local_date: string;
    duration_ms: string;
    rate_version_id: string;
    amount_minor_units: string;
  }>(
    `select ordinal, assignment_id, worksite_id, worksite_label, employee_id,
            employee_label, to_char(local_date, 'YYYY-MM-DD') as local_date,
            duration_ms::text as duration_ms, rate_version_id,
            amount_minor_units::text as amount_minor_units
       from public.cost_snapshot_positions
      where snapshot_id = $1
      order by ordinal`,
    [snapshotId],
  );
  return ergebnis.rows;
}

/** Der gespeicherte Kopf, roh — dieselbe Begruendung. */
async function gespeicherterKopf(snapshotId: string): Promise<unknown> {
  const ergebnis = await admin.query<{
    id: string;
    org_id: string;
    plan_version_id: string;
    worksite_id: string | null;
    week_key: string;
    time_zone: string;
    currency: string;
    rule_version: string;
    total_minor_units: string;
    created_by: string;
    correlation_id: string;
    created_at: Date;
  }>(
    `select id, org_id, plan_version_id, worksite_id, week_key, time_zone, currency,
            rule_version, total_minor_units::text as total_minor_units, created_by,
            correlation_id, created_at
       from public.cost_snapshots
      where id = $1`,
    [snapshotId],
  );
  return ergebnis.rows[0];
}

/**
 * Die am `tag` wirksame Satzversion — ueber den PRODUKTIONSPFAD.
 *
 * `versionsFor` liest ueber den Laufzeitkanal und RLS, `effectiveRateVersion`
 * ist dieselbe reine Auswahl, die die Montage benutzt. Rohes SQL waere die
 * schwaechere Aussage: es kaeme an einem Defekt in der Auswahl vorbei und
 * behauptete trotzdem, der Angriffsschritt habe gewirkt.
 *
 * `null` heisst „kein eindeutiger Satz" — RATE_NOT_FOUND wie RATE_AMBIGUOUS.
 * Beides waere hier ein Fixturefehler und soll als solcher auffallen, statt
 * stillschweigend eine Version auszuwaehlen.
 */
async function wirksamerSatzId(client: Client, tag: string): Promise<string | null> {
  const versionen = await satzRepositoryAuf(client).versionsFor(EMPLOYEE);
  const gewaehlt = effectiveRateVersion(versionen, tag);
  return gewaehlt.ok ? gewaehlt.version.id : null;
}

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(
        `SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar — ` +
          "lokal starten mit `pnpm exec supabase start && pnpm exec supabase db reset`.",
      );
      return;
    }
    await gate.run(fn);
  });
}

async function raeumeAuf(): Promise<void> {
  // Reihenfolge nach Fremdschluesseln: Positionen vor dem Kopf (der
  // mandantengebundene FK steht auf `on delete restrict`), Saetze vor der
  // Person (dito).
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
  await admin.query("delete from public.employee_rate_versions where employee_id = $1::uuid", [
    EMPLOYEE,
  ]);
  await admin.query("delete from public.employees where id = $1::uuid", [EMPLOYEE]);
}

beforeAll(async () => {
  if (APP_DB_URL === undefined) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        "[snapshot-immutability] fail-closed: EASYTREE_TEST_APP_DB_URL ist nicht gesetzt. " +
          "Gemessen werden soll auf dem Kanal, auf dem API und Worker arbeiten (easytree_app).",
      );
    }
    console.warn("[snapshot-immutability] SKIPPED: EASYTREE_TEST_APP_DB_URL nicht gesetzt.");
    return;
  }
  dbAvailable = (await probeDatabase(DB_URL)) && (await probeDatabase(APP_DB_URL));
  if (!dbAvailable) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        `[snapshot-immutability] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-143).`,
      );
    }
    console.warn(`[snapshot-immutability] SKIPPED: Postgres unter ${DB_URL} nicht erreichbar.`);
    return;
  }

  admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  clients.push(admin);
  await raeumeAuf();

  // Fixture-Aufbau ohne Rollenwechsel, also an RLS vorbei. Das ist Absicht: er
  // ist Vorbedingung und keine Zusicherung. Was RLS zulaesst, messen die Faelle.
  await admin.query(
    `insert into public.employees (id, org_id, user_id, display_name, active)
     values ($1::uuid, $2::uuid, null, $3, true)`,
    [EMPLOYEE, ORG_ALPHA, `${MARKE}-person`],
  );
  await admin.query(
    `insert into public.employee_rate_versions
       (id, org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
        reason, created_by, correlation_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::bigint, 'EUR', $5::date, null, $6, $7::uuid, $8)`,
    [SATZ_V1, ORG_ALPHA, EMPLOYEE, String(SATZ_V1_PRO_STUNDE), V1_AB, `${MARKE}-v1`, USER_A, MARKE],
  );
  // Vorbedingung, nicht Annahme: ohne `owner` scheiterte die Abloesung an RLS
  // statt an dem, was sie messen soll — sie waere rot aus dem falschen Grund.
  await admin.query(
    "update public.memberships set role = 'owner' where org_id = $1 and user_id = $2",
    [ORG_ALPHA, USER_A],
  );
});

afterAll(async () => {
  if (dbAvailable) {
    await raeumeAuf().catch(() => undefined);
  }
  process.stdout.write(gate.reportLine());
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
  gate.assertOrThrow();
});

describe("Ein gespeicherter Snapshot ueberlebt eine spaetere Satzversion (EYT-143)", () => {
  dbIt("laeuft auf dem Laufzeitkanal, nicht auf der Verwaltungsverbindung", async () => {
    // Ohne diese Aussage koennte APP_DB_URL unbemerkt auf `postgres` zeigen —
    // und `postgres` traegt BYPASSRLS. Jede folgende Aussage waere dann wertlos.
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
  dbIt("eine rueckwirkend wirksame V2 laesst Zeile, Antwort und Summe unveraendert", async () => {
    const schreibkanal = await neueVerbindung();
    const lesekanal = await neueVerbindung();

    // --- Vorbedingung, gemessen: am Leistungstag gilt GENAU V1, und zwar
    //     ueber denselben Pfad, ueber den die Montage den Satz waehlt.
    expect(await wirksamerSatzId(lesekanal, LEISTUNGSTAG)).toBe(SATZ_V1);

    // --- 1. Der Snapshot entsteht unter V1.
    const eingabe: NewCostSnapshot = {
      organisationId: ORG_ALPHA,
      planVersionId: PLANVERSION,
      worksiteId: null,
      weekKey: WOCHE,
      timeZone: "Europe/Berlin",
      currency: "EUR",
      ruleVersion: COST_RULE_VERSION,
      totalMinorUnits: BETRAG_V1,
      correlationId: `${MARKE}-fall1`,
      idempotencyKey: `${MARKE}-fall1-key`,
      positions: [
        {
          assignmentId: "00000000-0000-4000-8000-00000000a143",
          worksiteId: WORKSITE_ALPHA,
          worksiteLabel: "Baustelle Rosenweg",
          employeeId: EMPLOYEE,
          employeeLabel: "Erste Kraft",
          localDate: LEISTUNGSTAG,
          durationMilliseconds: SCHICHT_MS,
          rateVersionId: SATZ_V1,
          amountMinorUnits: BETRAG_V1,
          ruleVersion: COST_RULE_VERSION,
        } satisfies AssembledPosition,
      ],
    };

    const geschrieben = await snapshotRepositoryAuf(schreibkanal).create(eingabe);
    expect(geschrieben.ok, JSON.stringify(geschrieben)).toBe(true);
    if (!geschrieben.ok) return;
    const snapshotId = geschrieben.snapshotId;

    // Persistiert — gemessen ueber die Beobachterverbindung, nicht angenommen.
    // Diese beiden Werte sind zugleich der Vergleichsstand fuer Schritt 4.
    const kopfVorher = await gespeicherterKopf(snapshotId);
    const zeilenVorher = await gespeichertePositionen(snapshotId);
    expect(kopfVorher).toBeDefined();
    expect(zeilenVorher).toHaveLength(1);

    const vorher = await snapshotRepositoryAuf(lesekanal).read(snapshotId);
    expect(vorher.ok).toBe(true);
    if (!vorher.ok) return;
    expect(vorher.snapshot.positions[0]?.rateVersionId).toBe(SATZ_V1);
    expect(vorher.snapshot.positions[0]?.amountMinorUnits).toBe(BETRAG_V1);
    expect(vorher.snapshot.totalMinorUnits).toBe(BETRAG_V1);

    // --- 2. V2 entsteht ueber den regulaeren EYT-108-Abloesungspfad.
    //     Keine neue Regel und kein SQL an der Anwendung vorbei: `append` ist
    //     genau das, was die Betreiberin in der Oberflaeche ausloest.
    const abgeloest = await satzRepositoryAuf(schreibkanal).append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE,
      amountMinorUnits: String(SATZ_V2_PRO_STUNDE),
      validFrom: LEISTUNGSTAG,
      validTo: null,
      reason: `${MARKE}-v2`,
      expectedActiveVersionId: SATZ_V1,
      correlationId: `${MARKE}-v2`,
      idempotencyKey: `${MARKE}-v2-key`,
    });
    expect(abgeloest.ok, JSON.stringify(abgeloest)).toBe(true);
    if (!abgeloest.ok) return;
    const v2 = abgeloest.version;

    // --- 3. Der Angriffsschritt hat GEWIRKT. Ohne diese drei Zusicherungen
    //     bewiese der Fall nur, dass ein unveraenderter Zustand unveraendert
    //     bleibt — also nichts.
    expect(v2.id).not.toBe(SATZ_V1);
    expect(v2.amountMinorUnits).toBe(String(SATZ_V2_PRO_STUNDE));
    expect(v2.amountMinorUnits).not.toBe(String(SATZ_V1_PRO_STUNDE));
    expect(v2.predecessorId).toBe(SATZ_V1);
    // Die eigentliche Aussage: am SELBEN Leistungstag waehlt der
    // Produktionspfad jetzt V2. Genau das wuerde eine Neuberechnung sehen.
    expect(await wirksamerSatzId(lesekanal, LEISTUNGSTAG)).toBe(v2.id);

    // --- 4. Der GESPEICHERTE Stand ist Spalte fuer Spalte derselbe.
    //     Das ist die Aussage, die I8 nicht treffen kann: er sieht nur die
    //     Leseausgabe. Haette irgendetwas die Zeilen umgeschrieben und liese
    //     sie konsistent zurueck, bliebe er gruen und diese Zeile faellt.
    expect(await gespeichertePositionen(snapshotId)).toEqual(zeilenVorher);
    expect(await gespeicherterKopf(snapshotId)).toEqual(kopfVorher);

    // --- 5. Und dieselbe Id liefert erneut dasselbe Dokument.
    const nachher = await snapshotRepositoryAuf(await neueVerbindung()).read(snapshotId);
    expect(nachher.ok).toBe(true);
    if (!nachher.ok) return;

    expect(nachher.snapshot.id).toBe(snapshotId);
    expect(nachher.snapshot.positions[0]?.rateVersionId).toBe(SATZ_V1);
    expect(nachher.snapshot.positions[0]?.rateVersionId).not.toBe(v2.id);
    expect(nachher.snapshot.positions[0]?.amountMinorUnits).toBe(BETRAG_V1);
    expect(nachher.snapshot.totalMinorUnits).toBe(BETRAG_V1);
    expect(nachher.snapshot.ruleVersion).toBe(COST_RULE_VERSION);
    expect(nachher.snapshot.createdBy).toBe(USER_A);
    // Der Vollvergleich zuletzt: er faengt auch ein Feld, das oben niemand
    // einzeln genannt hat — etwa `createdAt`, `weekKey` oder `timeZone`.
    expect(nachher.snapshot).toEqual(vorher.snapshot);
  });

  // -------------------------------------------------------------------------
  dbIt("dem Laufzeitkanal fehlt jedes Recht, einen gespeicherten Snapshot zu aendern", async () => {
    // Der Fall oben zeigt, dass NICHTS die Zeilen umgeschrieben hat. Er sagt
    // nicht, WARUM — und SQLSTATE 42501 ist mehrdeutig (fehlendes Spaltenrecht
    // ODER RLS-Verstoss). Wo zwei Riegel schuetzen, steht neben dem
    // Verhaltensfall deshalb die strukturelle Aussage: es gibt gar kein Recht,
    // das ein Umschreiben oder Loeschen erlaubte (Migration 0018 erteilt weder
    // update- noch delete-Grants und legt entsprechend keine solchen Policies
    // an).
    const rechte = await admin.query<{
      positionen_update: boolean;
      positionen_delete: boolean;
      kopf_update: boolean;
      kopf_delete: boolean;
    }>(
      `select has_table_privilege($1, 'public.cost_snapshot_positions', 'update') as positionen_update,
              has_table_privilege($1, 'public.cost_snapshot_positions', 'delete') as positionen_delete,
              has_table_privilege($1, 'public.cost_snapshots', 'update') as kopf_update,
              has_table_privilege($1, 'public.cost_snapshots', 'delete') as kopf_delete`,
      [LAUFZEITROLLE],
    );

    expect(rechte.rows[0]).toEqual({
      positionen_update: false,
      positionen_delete: false,
      kopf_update: false,
      kopf_delete: false,
    });

    // Gegenprobe im selben Aufruf: `insert` und `select` MUESSEN vorhanden sein.
    // Ohne sie pruefte die Zusicherung darueber nur, dass die Rolle ueberhaupt
    // nichts darf — etwa weil der Name falsch geschrieben ist, denn
    // `has_table_privilege` wuerfe bei einer unbekannten Rolle zwar, nicht aber
    // bei einer existierenden ohne jedes Recht.
    const vorhanden = await admin.query<{ ins: boolean; sel: boolean }>(
      `select has_table_privilege($1, 'public.cost_snapshot_positions', 'insert') as ins,
              has_table_privilege($1, 'public.cost_snapshot_positions', 'select') as sel`,
      [LAUFZEITROLLE],
    );
    expect(vorhanden.rows[0]).toEqual({ ins: true, sel: true });
  });
});
