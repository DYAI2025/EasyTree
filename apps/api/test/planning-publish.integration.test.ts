/**
 * Veroeffentlichen gegen echtes PostgreSQL (EYT-107).
 *
 * Deckt die Aussagen ab, die ein Unittest strukturell nicht treffen kann:
 * Serialisierung ueber ZWEI echte Verbindungen, Transaktionsklammer ueber
 * einen echten Rollback, den Sync-Trigger aus Migration 0010 und die
 * Exclusion-Constraint, die erst beim Veroeffentlichen greift.
 *
 * ## Gegenmutationen — jede ist ausgefuehrt worden, nicht nur benannt
 *
 * Das Protokoll steht in `docs/reviews/2026-08-03-eyt-107-gegenmutationen.md`.
 * Kurzform, mit dem Fall, der jeweils faellt:
 *
 *  1. `for update` beim Laden der Woche entfernen
 *     -> „zwei parallele Veroeffentlichungen" rot.
 *  2. Den Vergleich mit `expectedVersionId` ueberspringen
 *     -> „veralteter Stand wird abgelehnt" rot.
 *  3. Die Wochenzuordnungspruefung entfernen
 *     -> „fremde Woche blockiert" rot. Diese Mutation ist die einzige ohne
 *        Netz: die Datenbank prueft die Wochenzugehoerigkeit NICHT (Luecke
 *        aus EYT-49).
 *  4. Den Replay-Zweig entfernen
 *     -> „Wiederholung erzeugt nichts Neues" rot, und die Zaehlungen von
 *        Audit und Outbox steigen auf zwei.
 *  5. Audit oder Outbox aus dem `runner.run`-Block herausziehen
 *     -> „erzwungener Fehler hinterlaesst nichts" rot.
 *  6. Die Konfliktpruefung entfernen -> der Fall „ueberlappender Entwurf"
 *     bleibt GRUEN in der Wirkung (PostgreSQL lehnt weiterhin ab), wird aber
 *     rot im erwarteten Fehlertyp. Das ist ehrlich so gemeint: die
 *     Anwendungspruefung liefert die benannte Konfliktliste, die Constraint
 *     liefert die Garantie.
 *
 * ## Nachtrag P1 (04.08.2026)
 *
 * Diese Datei ist seit dem P1-Befund die einzige Stelle, an der der ECHTE
 * Laufzeitkanal gemessen wird: sie verbindet als `easytree_app`, nicht als
 * `postgres`. pgTAP kann das nicht — `session_user` laesst sich dort nicht
 * wechseln. Zwei Gegenmutationen kommen hinzu:
 *
 *  7. `published_by = auth.uid()` aus dem `with check` von 0015 entfernen
 *     -> „lehnt eine fremde Urheberangabe ab" rot.
 *  8. `revoke update` / Spalten-Grant aus 0015 entfernen
 *     -> „laesst die Organisation einer Planversion nicht umschreiben" rot.
 *
 * Protokoll: `docs/reviews/2026-08-04-eyt-107-p1-gegenmutationen.md`.
 */
import {
  createTimeZone,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekKey,
} from "@easytree/domain";
import { Client } from "pg";
import type { DatabaseError, QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FailClosedGate, ORG_ALPHA, probeDatabase, USER_A } from "./tenant-context.helper";
import { PlanningWriteRepository } from "../src/modules/planning";
import { PgIdempotencyStore } from "../src/platform/idempotency/pg-idempotency-store";
import type { TenantQuery, TenantQueryRunner } from "../src/platform/database/tenant-query-runner";

/**
 * ZWEI Verbindungszeichenketten, seit dem P1-Befund vom 04.08.2026.
 *
 * `DB_URL` ist die Verwaltungsverbindung (`postgres`): sie legt Fixtures an,
 * zaehlt Audit-, Outbox- und Idempotenzzeilen und raeumt auf. Sie arbeitet
 * OHNE `set local role authenticated`, braucht also volle Tabellenrechte.
 *
 * `APP_DB_URL` ist der LAUFZEITKANAL (`easytree_app`). Genau ueber sie laeuft
 * der Publish-Command, denn `plan_versions_update_in_org` verlangt seit
 * Migration 0015 zusaetzlich `app.is_runtime_channel()` — also
 * `session_user = 'easytree_app'`. Eine `postgres`-Sitzung erfuellt das nicht;
 * der Publish-Pfad meldete dort „betraf keine Zeile" statt zu veroeffentlichen.
 *
 * Kein Rueckfall auf `DB_URL`: eine stille Vertretung waere genau die Art
 * Bequemlichkeit, die einen Sicherheitsnachweis in eine Behauptung verwandelt.
 * Fehlt die Variable im Pflichtmodus, ist der Lauf rot.
 */
const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const APP_DB_URL = process.env["EASYTREE_TEST_APP_DB_URL"];

/** Die Loginrolle, die `app.is_runtime_channel()` in Migration 0015 verlangt. */
const LAUFZEITROLLE = "easytree_app";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("planning-publish", TENANT_TESTS_MODE, "EYT-107");

const idempotenzSpeicher = new PgIdempotencyStore();

let dbAvailable = false;
const clients: Client[] = [];

/** Seed-Konstanten aus supabase/seed.sql (Org Alpha). */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";
const ORG_BETA = "00000000-0000-4000-8000-0000000000b2";
const EMPLOYEE_BETA = "00000000-0000-4000-8000-0000004020b2";
const WORKSITE_BETA = "00000000-0000-4000-8000-0000005020b2";
const USER_B = "00000000-0000-4000-8000-00000000bbb2";

/**
 * Stammdaten je Mandant — nicht je Aufruf zusammengesucht.
 *
 * Eine erste Fassung nahm fuer BEIDE Organisationen die Beschaeftigte von
 * Alpha und nur die Baustelle mandantenabhaengig. Der tenantgebundene
 * Fremdschluessel `(employee_id, org_id)` hat das korrekt abgelehnt
 * (`assignments_employee_id_org_id_fkey`, gemessen in db-gates 03.08.2026) —
 * die Constraint tat genau das, wofuer sie da ist, und der Fixture war falsch.
 * Beide Bezuege kommen deshalb aus derselben Quelle.
 */
const STAMMDATEN: Record<string, { employeeId: string; worksiteId: string }> = {
  [ORG_ALPHA]: { employeeId: EMPLOYEE_ALPHA, worksiteId: WORKSITE_ALPHA },
  [ORG_BETA]: { employeeId: EMPLOYEE_BETA, worksiteId: WORKSITE_BETA },
};

/**
 * Jeder Fall bekommt seine EIGENE Woche.
 *
 * Veroeffentlichte Planversionen sind laut Migration 0010 unveraenderlich UND
 * unloeschbar. Ein gemeinsamer Aufraeumschritt kann sie deshalb nicht
 * entfernen — und soll es auch nicht: dass die Invariante auch fuer Testcode
 * gilt, ist Teil der Aussage. Eigene Wochen sind die Loesung, nicht ein
 * Umgehen der Regel.
 */
const W_ERFOLG = "2026-W20";
const W_REPLAY = "2026-W21";
const W_STALE = "2026-W22";
const W_SCHON = "2026-W23";
const W_KONFLIKT = "2026-W24";
const W_FREMDE_WOCHE = "2026-W25";
const W_PARALLEL = "2026-W26";
const W_TEILWIRKUNG_A = "2026-W27";
const W_TEILWIRKUNG_B = "2026-W28";
const W_TEILWIRKUNG_C = "2026-W29";
const W_FREMDER_MANDANT = "2026-W30";
const W_SCHLUESSEL = "2026-W31";
// Beide Wochen enden als ENTWURF — ihre Faelle sollen ja gerade scheitern.
const W_URHEBER = "2026-W33";
const W_SPALTE = "2026-W34";

const ALLE_WOCHEN = [
  W_ERFOLG,
  W_REPLAY,
  W_STALE,
  W_SCHON,
  W_KONFLIKT,
  W_FREMDE_WOCHE,
  W_PARALLEL,
  W_TEILWIRKUNG_A,
  W_TEILWIRKUNG_B,
  W_TEILWIRKUNG_C,
  W_FREMDER_MANDANT,
  W_SCHLUESSEL,
  W_URHEBER,
  W_SPALTE,
];

/**
 * Montag 08:00–16:00 Europe/Berlin der jeweiligen ISO-Woche.
 *
 * Berechnet statt hartkodiert: eine Tabelle mit zwoelf Datumsangaben waere
 * eine zweite Wochenrechnung, und ein Tippfehler darin liesse den falschen
 * Fall gruen laufen. `2026-W20` beginnt am 11.05.2026.
 */
function montagDerWoche(woche: string): { von: Date; bis: Date } {
  const nummer = Number(woche.slice(-2));
  // 2026-W01 beginnt am Montag, 29.12.2025 (ISO). Ab dort in Wochenschritten.
  const basis = Date.UTC(2025, 11, 29);
  const montag = basis + (nummer - 1) * 7 * 24 * 60 * 60 * 1000;
  return {
    // 06:00 UTC = 08:00 Europe/Berlin (Sommerzeit) bzw. 07:00 (Winterzeit);
    // beides liegt sicher innerhalb desselben lokalen Montags.
    von: new Date(montag + 6 * 60 * 60 * 1000),
    bis: new Date(montag + 14 * 60 * 60 * 1000),
  };
}

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

/**
 * Fuehrt `arbeit` auf dem Laufzeitkanal aus und gibt den erwarteten Fehler
 * zurueck — oder `null`, wenn KEINER kam.
 *
 * Bewusst try/catch statt `.catch()` auf eine ausserhalb deklarierte Variable:
 * TypeScript verfolgt Zuweisungen aus einer Closure nicht, `abgelehnt` bliebe
 * dort `unknown` und jede Aussage ueber `.code` waere ein Cast.
 */
async function erwarteAblehnung(
  client: Client,
  arbeit: (tx: TenantQuery) => Promise<void>,
): Promise<DatabaseError | null> {
  try {
    await runnerAuf(client).run({ userId: USER_A }, arbeit);
    return null;
  } catch (fehler) {
    return fehler as DatabaseError;
  }
}

/** Die ECHTE Wochenregel, dieselbe Funktion wie in `AppModule`. */
const wochenschluessel = (instant: Date, zone: string): string => {
  const geprueft = createTimeZone(zone);
  if (!geprueft.ok) throw new Error(`Unbekannte Zeitzone ${zone}`);
  return planningWeekKey(isoWeekOfLocalDate(localBusinessDate(instant, geprueft.timeZone)));
};

/** Verwaltungsverbindung — Fixtures, Zaehlungen, Aufraeumen. */
async function neueAdminVerbindung(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

/**
 * Verbindung auf dem LAUFZEITKANAL — dieselbe Loginrolle wie API und Worker.
 *
 * `easytree_app` ist NOINHERIT (Migration 0003): vor `set local role
 * authenticated` hat sie keinerlei Tabellenrechte. Genau deshalb laeuft hier
 * jede Anweisung durch `runnerAuf`, das den Rollenwechsel setzt — und genau
 * deshalb kann diese Verbindung keine Fixtures anlegen.
 */
async function neueVerbindung(): Promise<Client> {
  if (APP_DB_URL === undefined) {
    throw new Error(
      "[planning-publish] EASYTREE_TEST_APP_DB_URL fehlt — der Laufzeitkanal ist nicht konfiguriert (EYT-107 P1).",
    );
  }
  const client = new Client({ connectionString: APP_DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

function repositoryAuf(
  client: Client,
  fehlerNach: "assignment" | "audit" | "outbox" | "published" | null = null,
  subject: string = USER_A,
): PlanningWriteRepository {
  return new PlanningWriteRepository(
    runnerAuf(client),
    subject,
    wochenschluessel,
    idempotenzSpeicher,
    fehlerNach,
  );
}

/**
 * Legt einen ENTWURF mit einer Zuweisung an — direkt, ohne den Publish-Pfad.
 *
 * Bewusst per SQL und nicht ueber `createAssignment`: dieser Test soll das
 * Veroeffentlichen pruefen, nicht das Anlegen. Ein Fehler im Anlegepfad wuerde
 * hier sonst als Publish-Fehler erscheinen.
 */
async function entwurfMit(
  admin: Client,
  woche: string,
  zuweisungen: readonly { von: Date; bis: Date; employeeId?: string }[],
  orgId: string = ORG_ALPHA,
): Promise<string> {
  const version = await admin.query<{ id: string }>(
    "insert into public.plan_versions (org_id, week_key) values ($1, $2) returning id",
    [orgId, woche],
  );
  const id = version.rows[0]?.id;
  if (id === undefined) throw new Error(`Entwurf fuer ${woche} liess sich nicht anlegen.`);

  const stamm = STAMMDATEN[orgId];
  if (stamm === undefined) throw new Error(`Keine Stammdaten fuer Organisation ${orgId}.`);

  for (const zuweisung of zuweisungen) {
    await admin.query(
      `insert into public.assignments
         (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        orgId,
        id,
        zuweisung.employeeId ?? stamm.employeeId,
        stamm.worksiteId,
        zuweisung.von,
        zuweisung.bis,
      ],
    );
  }
  return id;
}

async function zaehle(admin: Client, sql: string, params: readonly unknown[]): Promise<number> {
  const ergebnis = await admin.query<{ n: string }>(sql, [...params]);
  return Number(ergebnis.rows[0]?.n ?? "0");
}

const auditZaehler = (admin: Client, versionId: string): Promise<number> =>
  zaehle(
    admin,
    `select count(*) as n from public.audit_events
      where event_type = 'planning.plan_published' and subject_id = $1`,
    [versionId],
  );

const outboxZaehler = (admin: Client, schluessel: string): Promise<number> =>
  zaehle(
    admin,
    `select count(*) as n from public.outbox_messages
      where message_type = 'planning.plan_published' and idempotency_key = $1`,
    [schluessel],
  );

const idempotenzZaehler = (admin: Client, schluessel: string): Promise<number> =>
  zaehle(
    admin,
    `select count(*) as n from public.idempotency_records
      where operation = 'planning.publish_plan' and idempotency_key = $1`,
    [schluessel],
  );

/** Raeumt nur ENTWUERFE — Veroeffentlichtes ist unloeschbar (Migration 0010). */
async function raeumeEntwuerfe(admin: Client): Promise<void> {
  await admin.query(
    `delete from public.assignments
      where published_at is null
        and plan_version_id in (
          select id from public.plan_versions
           where week_key = any($1::text[]) and published_at is null)`,
    [ALLE_WOCHEN],
  );
  await admin.query(
    "delete from public.plan_versions where week_key = any($1::text[]) and published_at is null",
    [ALLE_WOCHEN],
  );
  await admin.query(
    "delete from public.idempotency_records where operation = 'planning.publish_plan'",
  );
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

let admin: Client;

beforeAll(async () => {
  if (APP_DB_URL === undefined) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        "[planning-publish] fail-closed: EASYTREE_TEST_APP_DB_URL ist nicht gesetzt. " +
          "Der Publish-Pfad braucht den Laufzeitkanal (Loginrolle easytree_app), " +
          "sonst filtert die RLS-Policy aus Migration 0015 jede Zeile heraus (EYT-107 P1).",
      );
    }
    console.warn("[planning-publish.integration] SKIPPED: EASYTREE_TEST_APP_DB_URL nicht gesetzt.");
    return;
  }
  dbAvailable = (await probeDatabase(DB_URL)) && (await probeDatabase(APP_DB_URL));
  if (!dbAvailable) return;
  admin = await neueAdminVerbindung();
  await raeumeEntwuerfe(admin);
});

afterAll(async () => {
  if (dbAvailable) {
    await raeumeEntwuerfe(admin).catch(() => undefined);
  }
  process.stdout.write(gate.reportLine());
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
  gate.assertOrThrow();
});

describe("publishPlan gegen echtes PostgreSQL", () => {
  dbIt("veroeffentlicht atomar und stempelt die Zuweisungen ueber den Trigger", async () => {
    const zeit = montagDerWoche(W_ERFOLG);
    const versionId = await entwurfMit(admin, W_ERFOLG, [zeit]);
    const client = await neueVerbindung();
    const schluessel = `pub-erfolg-${W_ERFOLG}`;

    const ergebnis = await repositoryAuf(client).publishPlan({
      weekKey: W_ERFOLG,
      expectedVersionId: versionId,
      idempotencyKey: schluessel,
    });

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.replayed).toBe(false);
    expect(ergebnis.version.versionId).toBe(versionId);
    expect(ergebnis.version.weekKey).toBe(W_ERFOLG);
    expect(ergebnis.version.assignmentIds).toHaveLength(1);

    // plan_versions.published_at ist gesetzt.
    const version = await admin.query<{ published_at: Date | null; published_by: string | null }>(
      "select published_at, published_by from public.plan_versions where id = $1",
      [versionId],
    );
    expect(version.rows[0]?.published_at).not.toBeNull();
    // published_by kommt aus app.current_user_id(), nicht aus dem Aufruf.
    expect(version.rows[0]?.published_by).toBe(USER_A);

    // Der Trigger aus 0010 hat JEDE Zuweisung mitgestempelt.
    const offen = await zaehle(
      admin,
      `select count(*) as n from public.assignments
        where plan_version_id = $1 and published_at is null`,
      [versionId],
    );
    expect(offen).toBe(0);

    // Genau ein Audit-, ein Outbox- und ein Idempotenzdatensatz.
    expect(await auditZaehler(admin, versionId)).toBe(1);
    expect(await outboxZaehler(admin, schluessel)).toBe(1);
    expect(await idempotenzZaehler(admin, schluessel)).toBe(1);
  });

  dbIt("beantwortet eine Wiederholung ohne zweite Wirkung", async () => {
    const zeit = montagDerWoche(W_REPLAY);
    const versionId = await entwurfMit(admin, W_REPLAY, [zeit]);
    const client = await neueVerbindung();
    const schluessel = `pub-replay-${W_REPLAY}`;
    const eingabe = {
      weekKey: W_REPLAY,
      expectedVersionId: versionId,
      idempotencyKey: schluessel,
    };

    const erst = await repositoryAuf(client).publishPlan(eingabe);
    const zweit = await repositoryAuf(client).publishPlan(eingabe);

    expect(erst.ok).toBe(true);
    expect(zweit.ok).toBe(true);
    if (!erst.ok || !zweit.ok) return;
    expect(zweit.replayed).toBe(true);
    expect(zweit.version.versionId).toBe(erst.version.versionId);
    expect(zweit.version.publishedAtUtc.toISOString()).toBe(
      erst.version.publishedAtUtc.toISOString(),
    );

    // Der eigentliche Nachweis: die Nebenwirkungen haben sich NICHT verdoppelt.
    expect(await auditZaehler(admin, versionId)).toBe(1);
    expect(await outboxZaehler(admin, schluessel)).toBe(1);
    expect(await idempotenzZaehler(admin, schluessel)).toBe(1);
  });

  dbIt("lehnt denselben Schluessel mit anderer Nutzlast ab", async () => {
    const zeit = montagDerWoche(W_SCHLUESSEL);
    const versionId = await entwurfMit(admin, W_SCHLUESSEL, [zeit]);
    const client = await neueVerbindung();
    const schluessel = `pub-anders-${W_SCHLUESSEL}`;

    const erst = await repositoryAuf(client).publishPlan({
      weekKey: W_SCHLUESSEL,
      expectedVersionId: versionId,
      idempotencyKey: schluessel,
    });
    expect(erst.ok).toBe(true);

    // Gleicher Schluessel, ANDERE Woche: keine Wiederholung, sondern ein
    // Aufruferfehler. Die alte Antwort zurueckzugeben waere die schlechteste
    // Reaktion.
    const zweit = await repositoryAuf(client).publishPlan({
      weekKey: W_ERFOLG,
      expectedVersionId: versionId,
      idempotencyKey: schluessel,
    });
    expect(zweit.ok).toBe(false);
    if (zweit.ok) return;
    expect(zweit.problem.kind).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  dbIt("lehnt einen veralteten Stand ab, ohne etwas zu veroeffentlichen", async () => {
    const zeit = montagDerWoche(W_STALE);
    const versionId = await entwurfMit(admin, W_STALE, [zeit]);
    const client = await neueVerbindung();

    const ergebnis = await repositoryAuf(client).publishPlan({
      weekKey: W_STALE,
      // Eine Id, die es gibt, aber nicht die des Entwurfs.
      expectedVersionId: "00000000-0000-4000-8000-0000006010a1",
      idempotencyKey: `pub-stale-${W_STALE}`,
    });

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem.kind).toBe("STALE_VERSION");
    if (ergebnis.problem.kind !== "STALE_VERSION") return;
    expect(ergebnis.problem.aktuelleVersionId).toBe(versionId);

    const offen = await zaehle(
      admin,
      "select count(*) as n from public.plan_versions where id = $1 and published_at is null",
      [versionId],
    );
    expect(offen).toBe(1);
  });

  dbIt("meldet eine bereits veroeffentlichte Woche als solche", async () => {
    const zeit = montagDerWoche(W_SCHON);
    const versionId = await entwurfMit(admin, W_SCHON, [zeit]);
    const client = await neueVerbindung();

    await repositoryAuf(client).publishPlan({
      weekKey: W_SCHON,
      expectedVersionId: versionId,
      idempotencyKey: `pub-schon-1-${W_SCHON}`,
    });

    // Neuer Schluessel, also keine Wiederholung: der Entwurf ist weg.
    const zweit = await repositoryAuf(client).publishPlan({
      weekKey: W_SCHON,
      expectedVersionId: versionId,
      idempotencyKey: `pub-schon-2-${W_SCHON}`,
    });

    expect(zweit.ok).toBe(false);
    if (zweit.ok) return;
    expect(zweit.problem.kind).toBe("ALREADY_PUBLISHED");
    if (zweit.problem.kind !== "ALREADY_PUBLISHED") return;
    expect(zweit.problem.versionId).toBe(versionId);
    expect(await auditZaehler(admin, versionId)).toBe(1);
  });

  dbIt("veroeffentlicht keinen Entwurf mit ueberlappenden Zuweisungen", async () => {
    const zeit = montagDerWoche(W_KONFLIKT);
    // Zwei Einsaetze DERSELBEN Person, die sich ueberschneiden. Als Entwurf
    // ist das erlaubt (Migration 0010 nimmt Entwuerfe aus); erst das
    // Veroeffentlichen macht es unzulaessig.
    const versionId = await entwurfMit(admin, W_KONFLIKT, [
      zeit,
      { von: new Date(zeit.von.getTime() + 3600_000), bis: zeit.bis },
    ]);
    const client = await neueVerbindung();

    const ergebnis = await repositoryAuf(client).publishPlan({
      weekKey: W_KONFLIKT,
      expectedVersionId: versionId,
      idempotencyKey: `pub-konflikt-${W_KONFLIKT}`,
    });

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem.kind).toBe("BLOCKING_CONFLICT");
    if (ergebnis.problem.kind !== "BLOCKING_CONFLICT") return;
    expect(ergebnis.problem.conflicts.map((k) => k.code)).toContain("EMPLOYEE_INTERVAL_OVERLAP");

    // Kein halber Zustand: weder Version noch Zuweisungen sind gestempelt.
    const version = await admin.query<{ published_at: Date | null }>(
      "select published_at from public.plan_versions where id = $1",
      [versionId],
    );
    expect(version.rows[0]?.published_at).toBeNull();
    const gestempelt = await zaehle(
      admin,
      `select count(*) as n from public.assignments
        where plan_version_id = $1 and published_at is not null`,
      [versionId],
    );
    expect(gestempelt).toBe(0);
  });

  dbIt("veroeffentlicht keinen Entwurf mit einer Zuweisung aus fremder Woche", async () => {
    // Das Schema verknuepft `week_key` mit KEINEM Zeitstempel (Luecke aus
    // EYT-49). Ohne die serverseitige Pruefung ginge das hier durch.
    const zeit = montagDerWoche(W_FREMDE_WOCHE);
    const fremd = montagDerWoche(W_ERFOLG);
    const versionId = await entwurfMit(admin, W_FREMDE_WOCHE, [zeit, fremd]);
    const client = await neueVerbindung();

    const ergebnis = await repositoryAuf(client).publishPlan({
      weekKey: W_FREMDE_WOCHE,
      expectedVersionId: versionId,
      idempotencyKey: `pub-fremd-${W_FREMDE_WOCHE}`,
    });

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem.kind).toBe("ASSIGNMENT_OUTSIDE_WEEK");
    if (ergebnis.problem.kind !== "ASSIGNMENT_OUTSIDE_WEEK") return;
    expect(ergebnis.problem.tatsaechlicheWoche).toBe(W_ERFOLG);

    const version = await admin.query<{ published_at: Date | null }>(
      "select published_at from public.plan_versions where id = $1",
      [versionId],
    );
    expect(version.rows[0]?.published_at).toBeNull();
  });

  dbIt("laesst bei zwei parallelen Anfragen genau einen Gewinner zu", async () => {
    const zeit = montagDerWoche(W_PARALLEL);
    const versionId = await entwurfMit(admin, W_PARALLEL, [zeit]);
    // ZWEI echte Verbindungen. Eine Sitzung kann eine Sperre nicht
    // beobachten — sie wartet nie auf sich selbst.
    const a = await neueVerbindung();
    const b = await neueVerbindung();

    const [ergebnisA, ergebnisB] = await Promise.all([
      repositoryAuf(a).publishPlan({
        weekKey: W_PARALLEL,
        expectedVersionId: versionId,
        idempotencyKey: `pub-parallel-a-${W_PARALLEL}`,
      }),
      repositoryAuf(b).publishPlan({
        weekKey: W_PARALLEL,
        expectedVersionId: versionId,
        idempotencyKey: `pub-parallel-b-${W_PARALLEL}`,
      }),
    ]);

    const gewinner = [ergebnisA, ergebnisB].filter((e) => e.ok);
    const verlierer = [ergebnisA, ergebnisB].filter((e) => !e.ok);
    expect(gewinner).toHaveLength(1);
    expect(verlierer).toHaveLength(1);

    // Der Verlierer bekommt eine STABILE fachliche Auskunft, keinen 500er.
    const problem = verlierer[0];
    if (problem !== undefined && !problem.ok) {
      expect(["ALREADY_PUBLISHED", "STALE_VERSION"]).toContain(problem.problem.kind);
    }

    // Genau EINE Wirkung, nicht zwei.
    expect(await auditZaehler(admin, versionId)).toBe(1);
    const outbox = await zaehle(
      admin,
      `select count(*) as n from public.outbox_messages
        where message_type = 'planning.plan_published'
          and payload->>'planVersionId' = $1`,
      [versionId],
    );
    expect(outbox).toBe(1);
    const offen = await zaehle(
      admin,
      `select count(*) as n from public.assignments
        where plan_version_id = $1 and published_at is null`,
      [versionId],
    );
    expect(offen).toBe(0);
  });

  const teilwirkung: ReadonlyArray<readonly ["published" | "audit" | "outbox", string]> = [
    ["published", W_TEILWIRKUNG_A],
    ["audit", W_TEILWIRKUNG_B],
    ["outbox", W_TEILWIRKUNG_C],
  ];

  for (const [punkt, woche] of teilwirkung) {
    dbIt(`erzwungener Fehler nach "${punkt}" hinterlaesst keine Teilwirkung`, async () => {
      const zeit = montagDerWoche(woche);
      const versionId = await entwurfMit(admin, woche, [zeit]);
      const client = await neueVerbindung();
      const schluessel = `pub-fehler-${punkt}-${woche}`;

      await expect(
        repositoryAuf(client, punkt).publishPlan({
          weekKey: woche,
          expectedVersionId: versionId,
          idempotencyKey: schluessel,
        }),
      ).rejects.toThrow(/erzwungener Fehler/);

      // Nichts davon darf den Rollback ueberlebt haben.
      const version = await admin.query<{ published_at: Date | null }>(
        "select published_at from public.plan_versions where id = $1",
        [versionId],
      );
      expect(version.rows[0]?.published_at).toBeNull();
      const gestempelt = await zaehle(
        admin,
        `select count(*) as n from public.assignments
          where plan_version_id = $1 and published_at is not null`,
        [versionId],
      );
      expect(gestempelt).toBe(0);
      expect(await auditZaehler(admin, versionId)).toBe(0);
      expect(await outboxZaehler(admin, schluessel)).toBe(0);
      expect(await idempotenzZaehler(admin, schluessel)).toBe(0);
    });
  }

  dbIt("sieht die Planversion eines fremden Mandanten nicht", async () => {
    const zeit = montagDerWoche(W_FREMDER_MANDANT);
    const versionBeta = await entwurfMit(admin, W_FREMDER_MANDANT, [zeit], ORG_BETA);
    const client = await neueVerbindung();

    // Benutzer A (Org Alpha) nennt die Version von Org Beta. RLS macht sie
    // unsichtbar; die Antwort darf sich nicht von „gibt es nicht"
    // unterscheiden.
    const ergebnis = await repositoryAuf(client).publishPlan({
      weekKey: W_FREMDER_MANDANT,
      expectedVersionId: versionBeta,
      idempotencyKey: `pub-fremd-mandant-${W_FREMDER_MANDANT}`,
    });

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(["STALE_VERSION", "ALREADY_PUBLISHED"]).toContain(ergebnis.problem.kind);

    // Und bei Beta hat sich nichts geruehrt.
    const beta = await admin.query<{ published_at: Date | null }>(
      "select published_at from public.plan_versions where id = $1",
      [versionBeta],
    );
    expect(beta.rows[0]?.published_at).toBeNull();
    expect(await auditZaehler(admin, versionBeta)).toBe(0);

    // Gegenprobe: Benutzer B DARF dieselbe Version veroeffentlichen. Ohne sie
    // bewiese der Fall oben nur, dass irgendetwas fehlschlaegt.
    const clientB = await neueVerbindung();
    const erlaubt = await repositoryAuf(clientB, null, USER_B).publishPlan({
      weekKey: W_FREMDER_MANDANT,
      expectedVersionId: versionBeta,
      idempotencyKey: `pub-beta-${W_FREMDER_MANDANT}`,
    });
    expect(erlaubt.ok).toBe(true);
  });

  // =========================================================================
  // Die Kanal- und Spaltengrenze aus dem P1-Befund (04.08.2026)
  // =========================================================================
  // Diese drei Faelle koennen NUR hier stehen. pgTAP laeuft als `postgres` und
  // erreicht den `with check`-Zweig gar nicht — die `using`-Klausel filtert
  // dort schon vorher. Erst auf dem echten Laufzeitkanal kommt eine Anweisung
  // so weit, dass der neue Zeilenzustand geprueft wird.

  dbIt("laeuft ueber die echte Laufzeit-Loginrolle, nicht ueber postgres", async () => {
    const client = await neueVerbindung();

    // Die Sonde laeuft INNERHALB des Runners, nicht daneben — und das ist
    // keine Formalie: `easytree_app` ist NOINHERIT (Migration 0003) und hat
    // vor `set local role authenticated` nicht einmal Zugriff auf das Schema
    // `app`. Eine erste Fassung fragte direkt auf der Verbindung und scheiterte
    // mit „permission denied for schema app" (gemessen in db-gates 04.08.2026,
    // Lauf 30863219624). Der Fehlschlag war korrekt: er hat das Fail-closed
    // von 0003 vorgefuehrt.
    //
    // Innerhalb des Runners ist die Aussage ausserdem staerker. Genau hier
    // gilt `current_user = authenticated` UND `session_user = easytree_app` —
    // der Rollenwechsel aendert die Loginrolle nicht, und darauf beruht die
    // ganze Kanalgrenze.
    const wer = await runnerAuf(client).run({ userId: USER_A }, (tx) =>
      tx.query<{ session_user: string; current_user: string; runtime: boolean }>(
        "select session_user, current_user, app.is_runtime_channel() as runtime",
      ),
    );
    const zeile = wer.rows[0];
    process.stdout.write(
      `[planning-publish] session_user=${zeile?.session_user ?? "?"} runtime_channel=${String(
        zeile?.runtime ?? false,
      )}\n`,
    );
    // Ohne diese drei Zeilen koennte die Suite eines Tages still wieder als
    // `postgres` laufen, und JEDER Nachweis ueber die Kanalgrenze waere
    // wertlos, ohne rot zu werden.
    expect(zeile?.session_user).toBe(LAUFZEITROLLE);
    expect(zeile?.current_user).toBe("authenticated");
    expect(zeile?.runtime).toBe(true);
  });

  dbIt("lehnt eine fremde Urheberangabe ab — with check auf dem neuen Stand", async () => {
    const zeit = montagDerWoche(W_URHEBER);
    const versionId = await entwurfMit(admin, W_URHEBER, [zeit]);
    const client = await neueVerbindung();

    const abgelehnt = await erwarteAblehnung(client, async (tx) => {
      // published_by zeigt bewusst auf eine ANDERE Person als das
      // JWT-Subjekt. Der Publish-Command tut das nie — er setzt
      // `app.current_user_id()`. Genau deshalb steht hier eine rohe
      // Anweisung: die Zusicherung soll auch dann halten, wenn jemand am
      // Repository vorbeischreibt.
      await tx.query(
        `update public.plan_versions
            set published_at = now(), published_by = $2
          where id = $1`,
        [versionId, USER_B],
      );
    });

    expect(abgelehnt, "eine fremde Urheberangabe wurde angenommen").not.toBeNull();
    expect(abgelehnt?.code).toBe("42501");

    const stand = await admin.query<{ published_at: Date | null }>(
      "select published_at from public.plan_versions where id = $1",
      [versionId],
    );
    expect(stand.rows[0]?.published_at).toBeNull();
  });

  dbIt("laesst die Organisation einer Planversion nicht umschreiben", async () => {
    const zeit = montagDerWoche(W_SPALTE);
    const versionId = await entwurfMit(admin, W_SPALTE, [zeit]);
    const client = await neueVerbindung();

    const abgelehnt = await erwarteAblehnung(client, async (tx) => {
      await tx.query("update public.plan_versions set org_id = $2 where id = $1", [
        versionId,
        ORG_BETA,
      ]);
    });

    // 42501 und nicht „0 Zeilen": das Spaltenrecht wird geprueft, bevor
    // ueberhaupt eine Zeile ausgewaehlt wird. Das Publish-Recht oeffnet
    // ausschliesslich published_at und published_by.
    expect(abgelehnt, "org_id liess sich ueber das Publish-Recht aendern").not.toBeNull();
    expect(abgelehnt?.code).toBe("42501");

    const stand = await admin.query<{ org_id: string }>(
      "select org_id from public.plan_versions where id = $1",
      [versionId],
    );
    expect(stand.rows[0]?.org_id).toBe(ORG_ALPHA);
  });
});
