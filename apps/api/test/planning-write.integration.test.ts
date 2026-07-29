/**
 * Schreibpfad gegen echtes PostgreSQL (EYT-92).
 *
 * Deckt die drei Aussagen ab, die ein Unittest strukturell nicht treffen kann:
 * Idempotenz ueber einen echten unique-Index, Transaktionsklammer ueber einen
 * echten Rollback, und Serialisierung ueber ZWEI echte Verbindungen. Eine
 * Sitzung kann eine Constraint zwar ablehnen sehen, aber nicht serialisieren
 * — dieselbe Begruendung wie in `planning-invariants.integration.test.ts`.
 *
 * ## Gegenmutationen
 *
 * 1. Entfernt man in `PlanningWriteRepository` die Abfrage auf
 *    `idempotency_records` vor dem Schreiben, wird „derselbe Schluessel liefert
 *    dieselbe Id" rot: es entstuende ein zweiter Einsatz mit neuer Id.
 * 2. Verschiebt man den Audit- oder Outbox-Insert aus dem `runner.run`-Block
 *    heraus, wird „nach erzwungenem Fehler bleibt nichts zurueck" rot — die
 *    Zeile ueberlebte den Rollback des Einsatzes.
 * 3. Entfernt man den `app.lock_employee_planning`-Aufruf, wird „zwei parallele
 *    Anfragen erzeugen nur einen Einsatz" rot: beide Ueberlappungspruefungen
 *    saehen unter `read committed` den Bestand ohne die jeweils andere Zeile.
 * 4. Entfernt man die Uebernahme des veroeffentlichten Stands in den ersten
 *    Entwurf, wird „der erste Entwurf laesst den Planstand nicht verschwinden"
 *    rot: die Woche zeigte danach nur noch die eine neue Zeile.
 */
import { Client } from "pg";
import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FailClosedGate, ORG_ALPHA, probeDatabase, USER_A } from "./tenant-context.helper";
import { PlanningWriteRepository } from "../src/modules/planning";
import type { TenantQuery, TenantQueryRunner } from "../src/platform/database/tenant-query-runner";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("planning-write", TENANT_TESTS_MODE, "EYT-92");

let dbAvailable = false;
const clients: Client[] = [];

/** Seed-Konstanten aus supabase/seed.sql (Org Alpha). */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";

/**
 * Zweite AKTIVE Person, vom Test selbst angelegt.
 *
 * `supabase/seed.sql` hat in Organisation Alpha genau eine aktive Person; die
 * zweite Seed-Zeile ist ausdruecklich inaktiv. Fuer das Entwurfs-Wettrennen
 * werden aber zwei VERSCHIEDENE Personen gebraucht — sonst legt der
 * Employee-Lock die beiden Transaktionen ohnehin hintereinander, und der Test
 * bewiese die falsche Serialisierung.
 *
 * Angelegt und wieder entfernt statt in den Seed geschrieben: der Seed ist
 * gemeinsame Grundlage vieler Suiten, und eine zusaetzliche aktive Person
 * wuerde dort Zaehlungen verschieben, die niemand hier ueberblickt.
 */
const EMPLOYEE_ALPHA_2 = "00000000-0000-4000-8000-0000004012a1";

/** Woche ohne Seed-Inhalt, damit die Faelle einander nicht stoeren. */
const WOCHE = "2026-W45";
const START = new Date("2026-11-03T07:00:00Z");
const ENDE = new Date("2026-11-03T15:00:00Z");

/**
 * Echter Runner auf einer eigenen Verbindung.
 *
 * Bewusst nicht der Produktions-`TenantQueryRunnerProvider`: der haelt einen
 * Pool, und fuer den Nebenlaeufigkeitsfall braucht dieser Test zwei
 * NACHWEISLICH verschiedene Verbindungen. Der Tenantkontext wird exakt so
 * gesetzt wie in Produktion — transaktionslokal, aus dem verifizierten
 * Subjekt.
 */
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

const wochenschluessel = (): string => WOCHE;

async function neueVerbindung(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

/** Raeumt die Testwoche vollstaendig ab — Zuweisungen, Versionen, Nebenwirkungen. */
async function raeumeWoche(client: Client): Promise<void> {
  await client.query(
    `delete from public.assignments
      where plan_version_id in (select id from public.plan_versions where week_key = $1)`,
    [WOCHE],
  );
  await client.query("delete from public.plan_versions where week_key = $1", [WOCHE]);
  await client.query(
    `insert into public.employees (id, org_id, user_id, display_name, active)
     values ($1, $2, null, 'Alpha Zweite (Testfixture EYT-92)', true)
     on conflict (id) do update set active = true`,
    [EMPLOYEE_ALPHA_2, ORG_ALPHA],
  );
  await client.query("delete from public.idempotency_records where org_id = $1", [ORG_ALPHA]);
  await client.query("delete from public.outbox_messages where org_id = $1 and message_type = $2", [
    ORG_ALPHA,
    "planning.assignment_created",
  ]);
  await client.query("delete from public.audit_events where org_id = $1 and event_type = $2", [
    ORG_ALPHA,
    "planning.assignment_created",
  ]);
}

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(`SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar.`);
    }
    await gate.run(fn);
  });
}

beforeAll(async () => {
  dbAvailable = await probeDatabase(DB_URL);
  if (!dbAvailable) return;
  const admin = await neueVerbindung();
  await raeumeWoche(admin);
});

afterAll(async () => {
  const ersteVerbindung = clients[0];
  if (dbAvailable && ersteVerbindung !== undefined) {
    await raeumeWoche(ersteVerbindung);
    // Die selbst angelegte Person wieder entfernen — sonst waechst der
    // Bestand mit jedem Lauf, und die naechste Suite zaehlt anders.
    await ersteVerbindung.query("delete from public.employees where id = $1", [EMPLOYEE_ALPHA_2]);
  }
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
  process.stdout.write(gate.reportLine());
  gate.assertOrThrow();
});

describe("Schreibpfad gegen echtes PostgreSQL (EYT-92)", () => {
  dbIt(
    "derselbe Idempotenzschluessel liefert dieselbe Id und schreibt kein zweites Mal",
    async () => {
      const client = await neueVerbindung();
      await raeumeWoche(client);
      const repo = new PlanningWriteRepository(runnerAuf(client), USER_A, wochenschluessel);

      const eingabe = {
        weekKey: WOCHE,
        employeeId: EMPLOYEE_ALPHA,
        worksiteId: WORKSITE_ALPHA,
        startsAtUtc: START,
        endsAtUtc: ENDE,
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      };

      const erst = await repo.createAssignment(eingabe);
      expect(erst.ok).toBe(true);
      if (!erst.ok) return;
      expect(erst.replayed).toBe(false);

      const zweit = await repo.createAssignment(eingabe);
      expect(zweit.ok).toBe(true);
      if (!zweit.ok) return;
      // Dieselbe Id — nicht nur "auch erfolgreich".
      expect(zweit.assignment.id).toBe(erst.assignment.id);
      expect(zweit.replayed).toBe(true);

      // Und wirklich nur EINE Zeile. Ohne diese Zaehlung waere der Test auch
      // dann gruen, wenn der zweite Aufruf eine zweite Zeile anlegte und
      // zufaellig die erste Id zurueckgaebe.
      const anzahl = await client.query<{ n: string }>(
        `select count(*) as n from public.assignments
        where plan_version_id in (select id from public.plan_versions where week_key = $1)`,
        [WOCHE],
      );
      expect(anzahl.rows[0]?.n).toBe("1");

      // Auch die Nebenwirkungen gibt es genau einmal.
      const outbox = await client.query<{ n: string }>(
        "select count(*) as n from public.outbox_messages where org_id = $1 and message_type = $2",
        [ORG_ALPHA, "planning.assignment_created"],
      );
      expect(outbox.rows[0]?.n).toBe("1");
    },
  );

  dbIt("Auditzeile und Outboxnachricht entstehen mit dem Einsatz", async () => {
    const client = await neueVerbindung();
    await raeumeWoche(client);
    const repo = new PlanningWriteRepository(runnerAuf(client), USER_A, wochenschluessel);

    const ergebnis = await repo.createAssignment({
      weekKey: WOCHE,
      employeeId: EMPLOYEE_ALPHA,
      worksiteId: WORKSITE_ALPHA,
      startsAtUtc: START,
      endsAtUtc: ENDE,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;

    const audit = await client.query<{ subject_id: string; actor_user_id: string }>(
      `select subject_id, actor_user_id from public.audit_events
        where org_id = $1 and event_type = 'planning.assignment_created'`,
      [ORG_ALPHA],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.subject_id).toBe(ergebnis.assignment.id);
    // Der Urheber kommt aus app.current_user_id(), nicht aus der Anwendung.
    expect(audit.rows[0]?.actor_user_id).toBe(USER_A);

    const outbox = await client.query<{ payload: { assignmentId: string } }>(
      `select payload from public.outbox_messages
        where org_id = $1 and message_type = 'planning.assignment_created'`,
      [ORG_ALPHA],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]?.payload.assignmentId).toBe(ergebnis.assignment.id);
  });

  dbIt("nach erzwungenem Fehler bleibt weder Einsatz noch Audit- oder Outboxzeile", async () => {
    const client = await neueVerbindung();
    await raeumeWoche(client);
    // Abbruch NACH dem Einsatz-Insert: die Zeile stand bereits in der
    // Transaktion. Nur die Klammer kann sie jetzt noch entfernen.
    const repo = new PlanningWriteRepository(
      runnerAuf(client),
      USER_A,
      wochenschluessel,
      "assignment",
    );

    await expect(
      repo.createAssignment({
        weekKey: WOCHE,
        employeeId: EMPLOYEE_ALPHA,
        worksiteId: WORKSITE_ALPHA,
        startsAtUtc: START,
        endsAtUtc: ENDE,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toThrow(/erzwungener Fehler/);

    for (const [tabelle, sql] of [
      [
        "assignments",
        `select count(*) as n from public.assignments
          where plan_version_id in (select id from public.plan_versions where week_key = '${WOCHE}')`,
      ],
      [
        "plan_versions",
        `select count(*) as n from public.plan_versions where week_key = '${WOCHE}'`,
      ],
      [
        "audit_events",
        `select count(*) as n from public.audit_events
          where org_id = '${ORG_ALPHA}' and event_type = 'planning.assignment_created'`,
      ],
      [
        "outbox_messages",
        `select count(*) as n from public.outbox_messages
          where org_id = '${ORG_ALPHA}' and message_type = 'planning.assignment_created'`,
      ],
      [
        "idempotency_records",
        `select count(*) as n from public.idempotency_records where org_id = '${ORG_ALPHA}'`,
      ],
    ] as const) {
      const zeilen = await client.query<{ n: string }>(sql);
      expect(zeilen.rows[0]?.n, `Teilwirkung in ${tabelle}`).toBe("0");
    }
  });

  dbIt("zwei parallele Anfragen erzeugen nur einen Einsatz, nicht zwei", async () => {
    // ZWEI echte Verbindungen. Eine Sitzung kann die Serialisierung nicht
    // zeigen: sie saehe ihre eigene, noch nicht committete Zeile ohnehin.
    const a = await neueVerbindung();
    const b = await neueVerbindung();
    await raeumeWoche(a);

    const repoA = new PlanningWriteRepository(runnerAuf(a), USER_A, wochenschluessel);
    const repoB = new PlanningWriteRepository(runnerAuf(b), USER_A, wochenschluessel);
    const basis = {
      weekKey: WOCHE,
      employeeId: EMPLOYEE_ALPHA,
      worksiteId: WORKSITE_ALPHA,
      startsAtUtc: START,
      endsAtUtc: ENDE,
    };

    // VERSCHIEDENE Schluessel — sonst griffe der Idempotenzschutz und der Test
    // bewiese die falsche Sache.
    const [ergebnisA, ergebnisB] = await Promise.all([
      repoA.createAssignment({ ...basis, idempotencyKey: "44444444-4444-4444-8444-44444444444a" }),
      repoB.createAssignment({ ...basis, idempotencyKey: "44444444-4444-4444-8444-44444444444b" }),
    ]);

    const erfolge = [ergebnisA, ergebnisB].filter((e) => e.ok);
    const konflikte = [ergebnisA, ergebnisB].filter(
      (e) => !e.ok && e.problem.kind === "OVERLAPPING_ASSIGNMENT",
    );
    expect(erfolge).toHaveLength(1);
    expect(konflikte).toHaveLength(1);

    const anzahl = await a.query<{ n: string }>(
      `select count(*) as n from public.assignments
        where plan_version_id in (select id from public.plan_versions where week_key = $1)`,
      [WOCHE],
    );
    expect(anzahl.rows[0]?.n).toBe("1");
  });

  dbIt(
    "der erste Entwurf ueber einer veroeffentlichten Woche laesst den Planstand nicht verschwinden",
    async () => {
      const client = await neueVerbindung();
      await raeumeWoche(client);

      // Eine veroeffentlichte Version mit einer Zuweisung — der Stand, den die
      // Planerin vor sich hat.
      const version = await client.query<{ id: string }>(
        `insert into public.plan_versions (org_id, week_key, published_at, published_by)
       values ($1, $2, now(), $3) returning id`,
        [ORG_ALPHA, WOCHE, USER_A],
      );
      const veroeffentlicht = version.rows[0]?.id;
      expect(veroeffentlicht).toBeDefined();
      await client.query(
        `insert into public.assignments
         (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc, published_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
        [
          ORG_ALPHA,
          veroeffentlicht,
          EMPLOYEE_ALPHA,
          WORKSITE_ALPHA,
          "2026-11-05T07:00:00Z",
          "2026-11-05T15:00:00Z",
        ],
      );

      const repo = new PlanningWriteRepository(runnerAuf(client), USER_A, wochenschluessel);
      const ergebnis = await repo.createAssignment({
        weekKey: WOCHE,
        employeeId: EMPLOYEE_ALPHA,
        worksiteId: WORKSITE_ALPHA,
        startsAtUtc: START,
        endsAtUtc: ENDE,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      });
      expect(ergebnis.ok).toBe(true);
      if (!ergebnis.ok) return;

      // Der neue Entwurf traegt ZWEI Zuweisungen: die uebernommene und die neue.
      // Ohne die Uebernahme waere es eine — und die veroeffentlichte Planung
      // waere aus der Ansicht verschwunden, ohne dass jemand sie geloescht hat.
      const imEntwurf = await client.query<{ n: string }>(
        "select count(*) as n from public.assignments where plan_version_id = $1",
        [ergebnis.assignment.planVersionId],
      );
      expect(imEntwurf.rows[0]?.n).toBe("2");
      expect(ergebnis.assignment.planVersionId).not.toBe(veroeffentlicht);
    },
  );

  dbIt("zwei parallele Anfragen mit DEMSELBEN Schluessel erzeugen nur einen Einsatz", async () => {
    // Der Fall, den die erste Fassung nicht abdeckte: der Replay-Blick lief
    // VOR jeder Sperre, also sahen beide Anfragen "nicht vorhanden".
    const a = await neueVerbindung();
    const b = await neueVerbindung();
    await raeumeWoche(a);

    const repoA = new PlanningWriteRepository(runnerAuf(a), USER_A, wochenschluessel);
    const repoB = new PlanningWriteRepository(runnerAuf(b), USER_A, wochenschluessel);
    const eingabe = {
      weekKey: WOCHE,
      employeeId: EMPLOYEE_ALPHA,
      worksiteId: WORKSITE_ALPHA,
      startsAtUtc: START,
      endsAtUtc: ENDE,
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    };

    const [x, y] = await Promise.all([
      repoA.createAssignment(eingabe),
      repoB.createAssignment(eingabe),
    ]);

    // Beide erfolgreich, beide mit DERSELBEN Id — eine davon als Replay.
    expect(x.ok && y.ok).toBe(true);
    if (!x.ok || !y.ok) return;
    expect(y.assignment.id).toBe(x.assignment.id);
    expect([x.replayed, y.replayed].filter(Boolean)).toHaveLength(1);

    const anzahl = await a.query<{ n: string }>(
      `select count(*) as n from public.assignments
        where plan_version_id in (select id from public.plan_versions where week_key = $1)`,
      [WOCHE],
    );
    expect(anzahl.rows[0]?.n).toBe("1");
  });

  dbIt(
    "derselbe Schluessel mit ANDERER Anfrage wird abgelehnt, nicht als Replay beantwortet",
    async () => {
      const client = await neueVerbindung();
      await raeumeWoche(client);
      const repo = new PlanningWriteRepository(runnerAuf(client), USER_A, wochenschluessel);
      const schluessel = "77777777-7777-4777-8777-777777777777";

      const erst = await repo.createAssignment({
        weekKey: WOCHE,
        employeeId: EMPLOYEE_ALPHA,
        worksiteId: WORKSITE_ALPHA,
        startsAtUtc: START,
        endsAtUtc: ENDE,
        idempotencyKey: schluessel,
      });
      expect(erst.ok).toBe(true);

      // Anderer Zeitraum, gleicher Schluessel.
      const zweit = await repo.createAssignment({
        weekKey: WOCHE,
        employeeId: EMPLOYEE_ALPHA,
        worksiteId: WORKSITE_ALPHA,
        startsAtUtc: new Date("2026-11-04T07:00:00Z"),
        endsAtUtc: new Date("2026-11-04T15:00:00Z"),
        idempotencyKey: schluessel,
      });
      expect(zweit.ok).toBe(false);
      if (zweit.ok) return;
      expect(zweit.problem.kind).toBe("IDEMPOTENCY_KEY_REUSED");
    },
  );

  dbIt("ein Retry ueberlebt eine zwischenzeitliche Deaktivierung der Person", async () => {
    // Replay steht VOR der `active`-Pruefung. Ohne diese Reihenfolge
    // scheiterte eine Wiederholung an einer Bedingung, die beim
    // urspruenglichen Vorgang erfuellt war.
    const client = await neueVerbindung();
    await raeumeWoche(client);
    const repo = new PlanningWriteRepository(runnerAuf(client), USER_A, wochenschluessel);
    const eingabe = {
      weekKey: WOCHE,
      employeeId: EMPLOYEE_ALPHA,
      worksiteId: WORKSITE_ALPHA,
      startsAtUtc: START,
      endsAtUtc: ENDE,
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    };
    const erst = await repo.createAssignment(eingabe);
    expect(erst.ok).toBe(true);
    if (!erst.ok) return;

    await client.query("update public.employees set active = false where id = $1", [
      EMPLOYEE_ALPHA,
    ]);
    try {
      const zweit = await repo.createAssignment(eingabe);
      expect(zweit.ok).toBe(true);
      if (!zweit.ok) return;
      expect(zweit.assignment.id).toBe(erst.assignment.id);
      expect(zweit.replayed).toBe(true);
    } finally {
      await client.query("update public.employees set active = true where id = $1", [
        EMPLOYEE_ALPHA,
      ]);
    }
  });

  dbIt(
    "zwei Personen gleichzeitig kopieren die veroeffentlichte Baseline genau einmal",
    async () => {
      const a = await neueVerbindung();
      const b = await neueVerbindung();
      await raeumeWoche(a);

      // Veroeffentlichte Baseline mit EINER Zuweisung.
      const version = await a.query<{ id: string }>(
        `insert into public.plan_versions (org_id, week_key, published_at, published_by)
       values ($1, $2, now(), $3) returning id`,
        [ORG_ALPHA, WOCHE, USER_A],
      );
      const veroeffentlicht = version.rows[0]?.id;
      await a.query(
        `insert into public.assignments
         (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc, published_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
        [
          ORG_ALPHA,
          veroeffentlicht,
          EMPLOYEE_ALPHA,
          WORKSITE_ALPHA,
          "2026-11-06T07:00:00Z",
          "2026-11-06T15:00:00Z",
        ],
      );

      const repoA = new PlanningWriteRepository(runnerAuf(a), USER_A, wochenschluessel);
      const repoB = new PlanningWriteRepository(runnerAuf(b), USER_A, wochenschluessel);
      const basis = { weekKey: WOCHE, worksiteId: WORKSITE_ALPHA };

      // VERSCHIEDENE Personen, damit der Employee-Lock die beiden nicht ohnehin
      // hintereinander legt — nur so ist das Entwurfs-Wettrennen echt.
      const [x, y] = await Promise.all([
        repoA.createAssignment({
          ...basis,
          employeeId: EMPLOYEE_ALPHA,
          startsAtUtc: START,
          endsAtUtc: ENDE,
          idempotencyKey: "99999999-9999-4999-8999-99999999999a",
        }),
        repoB.createAssignment({
          ...basis,
          employeeId: EMPLOYEE_ALPHA_2,
          startsAtUtc: new Date("2026-11-03T16:00:00Z"),
          endsAtUtc: new Date("2026-11-03T20:00:00Z"),
          idempotencyKey: "99999999-9999-4999-8999-99999999999b",
        }),
      ]);
      expect(x.ok && y.ok).toBe(true);
      if (!x.ok || !y.ok) return;
      expect(x.assignment.planVersionId).toBe(y.assignment.planVersionId);

      // Baseline genau einmal, beide neuen Einsaetze genau einmal: drei Zeilen.
      const zeilen = await a.query<{ starts_at_utc: Date }>(
        "select starts_at_utc from public.assignments where plan_version_id = $1 order by starts_at_utc",
        [x.assignment.planVersionId],
      );
      expect(zeilen.rows).toHaveLength(3);
      const baseline = zeilen.rows.filter(
        (r) => r.starts_at_utc.toISOString() === "2026-11-06T07:00:00.000Z",
      );
      expect(baseline).toHaveLength(1);
    },
  );
});
