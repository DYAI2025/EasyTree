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
import {
  createTimeZone,
  isoWeekOfLocalDate,
  localBusinessDate,
  planningWeekKey,
} from "@easytree/domain";
import { Client } from "pg";
import type { DatabaseError, QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FailClosedGate,
  ORG_ALPHA,
  ORG_BETA,
  probeDatabase,
  USER_A,
} from "./tenant-context.helper";
import { PlanningWriteRepository } from "../src/modules/planning";
import { PgIdempotencyStore } from "../src/platform/idempotency/pg-idempotency-store";
import type { TenantQuery, TenantQueryRunner } from "../src/platform/database/tenant-query-runner";

/**
 * Der ECHTE Plattformadapter, nicht eine Attrappe (EYT-107).
 *
 * Das Repository bekommt die Wiederholungserkennung seit EYT-107
 * hereingereicht, statt ihr SQL selbst zu schreiben. Hier steht deshalb
 * derselbe Adapter, den `AppModule` verdrahtet — eine gestellte Fassung wuerde
 * genau die Zusicherung wegnehmen, die dieser Test belegen soll.
 */
const idempotenzSpeicher = new PgIdempotencyStore();

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Der Laufzeitkanal (`easytree_app`), seit EYT-136 zwingend.
 *
 * Migration 0017 bindet das Anlegen von Entwuerfen und Zuweisungen an
 * `app.is_runtime_channel()`. Ohne diese Verbindung misst der Test nicht mehr
 * den Produktionsvertrag — deshalb ist ihr Fehlen im Pflichtmodus rot und
 * nicht etwa ein stiller Rueckfall auf `DB_URL`.
 */
const APP_DB_URL = process.env["EASYTREE_TEST_APP_DB_URL"];

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

/**
 * `USER_B` aus `supabase/seed.sql` — Owner in Organisation BETA, in ALPHA ohne
 * Zeile.
 *
 * Die Konstante steht hier und nicht im Import, weil
 * `tenant-context.helper.ts` nur `USER_A` und `USER_C` exportiert (geprueft
 * 08.08.2026). Quelle des Wertes ist der Seed, nicht diese Datei.
 */
const USER_B = "00000000-0000-4000-8000-00000000bbb2";

/**
 * Id der GELIEHENEN Mitgliedschaft — bewusst unverwechselbar testspezifisch.
 *
 * `e136` traegt die Ticketnummer im Wert selbst: taucht die Zeile je in einem
 * Dump auf, ist ohne Nachschlagen klar, wer sie erzeugt hat. Gueltiges v4-Muster
 * (Version `4`, Variante `8`) — gegen `IdSchema` geprueft, weil EYT-91 offen
 * ist und ungueltige v4-Ids im Bestand dort bereits 500er ausgeloest haben.
 */
const MITGLIEDSCHAFT_GELIEHEN = "00000000-0000-4000-8000-0000e136b001";

/** Woche ohne Seed-Inhalt, damit die Faelle einander nicht stoeren. */
const WOCHE = "2026-W45";

/**
 * Eigene Wochen fuer die beiden Faelle mit VEROEFFENTLICHTER Baseline.
 *
 * Migration 0010 macht veroeffentlichte Zeilen unveraenderlich UND
 * unloeschbar — `app.reject_published_row_change()` wirft bei jedem Versuch.
 * Das ist richtig so und wird hier nicht umgangen: statt aufzuraeumen bekommt
 * jeder dieser Faelle seine eigene Woche. Die Zeilen bleiben stehen, stoeren
 * niemanden und belegen nebenbei, dass die Invariante auch fuer Testcode gilt.
 *
 * Der erste Lauf dieser Suite gegen eine frisch zurueckgesetzte Datenbank ist
 * der einzige, der zaehlt (`db reset` laeuft in db-gates ohnehin zweimal).
 */
const WOCHE_BASELINE = "2026-W46";
const WOCHE_BASELINE_PARALLEL = "2026-W47";
/** Eigene Woche fuer den aus 0006 umgezogenen Definer-Fall (EYT-136). */
const WOCHE_BASELINE_DEFINER = "2026-W48";
/** Eigene Wochen fuer die beiden Rechte-Faelle (EYT-136), damit sie nichts teilen. */
const WOCHE_RECHT_VERSION = "2026-W49";
const WOCHE_RECHT_ZUWEISUNG = "2026-W50";
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

/**
 * Die ECHTE Wochenregel, nicht ein Stub.
 *
 * Eine fruehere Fassung gab konstant `WOCHE` zurueck. Das war bequem und
 * falsch: die `OUTSIDE_WEEK`-Pruefung des Repositories vergleicht dann eine
 * Konstante mit sich selbst und kann nichts mehr finden — genau die Sorte
 * Test, die gruen ist, ohne etwas zu messen. Hier laeuft dieselbe Funktion wie
 * in `AppModule`.
 */
const wochenschluessel = (instant: Date, zone: string): string => {
  const geprueft = createTimeZone(zone);
  if (!geprueft.ok) throw new Error(`Unbekannte Zeitzone ${zone}`);
  return planningWeekKey(isoWeekOfLocalDate(localBusinessDate(instant, geprueft.timeZone)));
};

/**
 * Verwaltungsverbindung (`postgres`) — Fixtures, Zaehlungen, Aufraeumen.
 *
 * Sie arbeitet OHNE `set local role authenticated` und braucht deshalb volle
 * Tabellenrechte. Seit EYT-136 ist sie ausserdem die EINZIGE Verbindung, die
 * Entwuerfe wieder loeschen kann: `authenticated` hat auf `public.assignments`
 * weder `update` noch `delete` (Migration 0017), und das ist der Punkt.
 */
async function neueAdminVerbindung(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  clients.push(client);
  admin = client;
  return client;
}

/** Genau eine Verwaltungsverbindung je Lauf; Fixtures brauchen keine zweite. */
let admin: Client | undefined;

function adminVerbindung(): Client {
  if (admin === undefined) {
    throw new Error("[planning-write] Verwaltungsverbindung fehlt — beforeAll ist nicht gelaufen.");
  }
  return admin;
}

/**
 * Beobachtung — IMMER ueber die Verwaltungsverbindung, nie ueber den
 * Laufzeitkanal.
 *
 * `easytree_app` ist NOINHERIT (Migration 0003) und hat vor
 * `set local role authenticated` keinerlei Tabellenrechte. Eine rohe Zaehlung
 * auf dieser Verbindung endet deshalb in `permission denied` — gemessen im
 * Lauf 31222989167, acht von zehn Pflichttests. Diese Funktion macht die
 * richtige Wahl zur einzigen bequemen: wer beobachtet, ruft `beobachte`.
 */
async function beobachte<TRow extends QueryResultRow>(
  sql: string,
  parameter: readonly unknown[] = [],
): Promise<TRow[]> {
  const ergebnis = await adminVerbindung().query<TRow>(sql, [...parameter]);
  return ergebnis.rows;
}

/**
 * Verbindung auf dem LAUFZEITKANAL (`easytree_app`) — dieselbe Loginrolle wie
 * API und Worker, und seit EYT-136 die einzige, ueber die ein Entwurf
 * ueberhaupt entstehen kann.
 *
 * Vorher lief dieser Test seinen Kommandopfad ueber `postgres`. Das war schon
 * damals nicht der Produktionsvertrag, fiel aber nicht auf, weil die
 * Insert-Policy nur die Organisation prueft. Migration 0017 verlangt
 * zusaetzlich `app.is_runtime_channel()`, also `session_user = 'easytree_app'`
 * — eine `postgres`-Sitzung erfuellt das nicht. Dieselbe Umstellung hat der
 * Publish-Pfad mit EYT-107 bereits erhalten.
 *
 * Kein Rueckfall auf `DB_URL`: eine stille Vertretung waere genau die
 * Bequemlichkeit, die einen Sicherheitsnachweis in eine Behauptung verwandelt.
 */
async function neueVerbindung(): Promise<Client> {
  if (APP_DB_URL === undefined) {
    throw new Error(
      "[planning-write] EASYTREE_TEST_APP_DB_URL fehlt — der Laufzeitkanal ist nicht konfiguriert (EYT-136).",
    );
  }
  const client = new Client({ connectionString: APP_DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

/**
 * Legt eine VEROEFFENTLICHTE Planversion mit einer Zuweisung an.
 *
 * Die Reihenfolge ist nicht beliebig, und die erste Fassung hatte sie falsch:
 * `app.reject_assignment_in_published_plan()` (Migration 0010) verbietet, eine
 * Zuweisung in eine bereits veroeffentlichte Version einzufuegen. Die Version
 * entsteht deshalb als ENTWURF, bekommt ihre Zuweisung, und wird erst danach
 * veroeffentlicht — genau der Weg, den auch der spaetere Publish-Pfad nimmt.
 *
 * `assignments.published_at` wird dabei NICHT von Hand gesetzt: der Trigger
 * `plan_versions_publish_assignments` leitet es aus der Version ab. Es selbst
 * zu setzen waere eine zweite Wahrheit neben der abgeleiteten.
 */
async function veroeffentlichteBaseline(woche: string, von: string, bis: string): Promise<string> {
  const client = adminVerbindung();
  const version = await client.query<{ id: string }>(
    "insert into public.plan_versions (org_id, week_key) values ($1, $2) returning id",
    [ORG_ALPHA, woche],
  );
  const id = version.rows[0]?.id;
  if (id === undefined) throw new Error("Baseline-Version konnte nicht angelegt werden.");

  await client.query(
    `insert into public.assignments
       (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
     values ($1, $2, $3, $4, $5, $6)`,
    [ORG_ALPHA, id, EMPLOYEE_ALPHA, WORKSITE_ALPHA, von, bis],
  );

  await client.query(
    "update public.plan_versions set published_at = now(), published_by = $2 where id = $1",
    [id, USER_A],
  );
  return id;
}

/**
 * Raeumt ENTWUERFE der Testwochen ab — nicht Veroeffentlichtes.
 *
 * Veroeffentlichte Planversionen und ihre Zuweisungen sind laut Migration 0010
 * unloeschbar. Der Versuch endet in `app.reject_published_row_change()`, und
 * genau daran ist die erste Fassung dieser Funktion gescheitert. Die
 * Einschraenkung ist deshalb keine Bequemlichkeit, sondern die Regel.
 */
async function raeumeWoche(woche: string = WOCHE): Promise<void> {
  const client = adminVerbindung();
  await client.query(
    `delete from public.assignments
      where published_at is null
        and plan_version_id in (
          select id from public.plan_versions
           where week_key = $1 and published_at is null
        )`,
    [woche],
  );
  await client.query(
    "delete from public.plan_versions where week_key = $1 and published_at is null",
    [woche],
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
  await client.query(
    `insert into public.employees (id, org_id, user_id, display_name, active)
     values ($1, $2, null, 'Alpha Zweite (Testfixture EYT-92)', true)
     on conflict (id) do update set active = true`,
    [EMPLOYEE_ALPHA_2, ORG_ALPHA],
  );
}

/**
 * Leiht `USER_B` fuer die Dauer EINES Falls eine aktive `member`-Mitgliedschaft
 * in Organisation Alpha (EYT-136).
 *
 * Warum geliehen und nicht angelegt: eine neue Identitaet braeuchte eine Zeile
 * in `auth.users` — das legt in echten Umgebungen ausschliesslich GoTrue an,
 * und der Product Owner hat den direkten Schreibzugriff fuer diesen Slice
 * ausgeschlossen. `USER_B` existiert im Seed bereits, ist Owner in Organisation
 * BETA und hat in ALPHA bis hierher keine Zeile (geprueft gegen
 * `supabase/seed.sql`: dort stehen A/Alpha, B/Beta und C/Alpha-inaktiv).
 * `USER_C` waere naeher dran, ist aber INAKTIV — er scheiterte an der
 * Mitgliedschaft statt am Recht, und der Test bewiese den falschen Riegel.
 * Seine Seed-Zeile bleibt deshalb unangetastet, ebenso die Beta-Mitgliedschaft
 * von `USER_B`; diese Funktion FUEGT nur hinzu.
 *
 * Warum genau ein Fall und nicht die ganze Suite: `tenant-isolation` laeuft im
 * db-gates-Job vor dieser Datei, `tenant-pooling` danach — und letzteres prueft,
 * wer welche Organisation sieht. Die Mitgliedschaft darf deshalb keine Sekunde
 * laenger existieren als der Fall, der sie braucht. Das `finally` raeumt auch
 * nach einem geworfenen Fehler ab, und die Nachkontrolle glaubt dem DELETE
 * nicht, sondern sieht nach.
 */
async function mitGeliehenerMitgliedschaft<T>(fn: () => Promise<T>): Promise<T> {
  await adminVerbindung().query(
    `insert into public.memberships (id, org_id, user_id, role, active)
     values ($1, $2, $3, 'member', true)`,
    [MITGLIEDSCHAFT_GELIEHEN, ORG_ALPHA, USER_B],
  );
  try {
    // Die Leihe hat gewirkt — gemessen, nicht angenommen. Ohne diese Kontrolle
    // koennte eine unwirksame Mitgliedschaft den Fall gruen lassen, waehrend in
    // Wahrheit die Mandantenbedingung ablehnt statt der Rechtebedingung.
    const stand = await beobachte<{ role: string; active: boolean }>(
      "select role, active from public.memberships where id = $1",
      [MITGLIEDSCHAFT_GELIEHEN],
    );
    expect(stand[0]?.role, "die geliehene Mitgliedschaft traegt die falsche Rolle").toBe("member");
    expect(stand[0]?.active, "die geliehene Mitgliedschaft ist nicht aktiv").toBe(true);
    return await fn();
  } finally {
    await adminVerbindung().query("delete from public.memberships where id = $1", [
      MITGLIEDSCHAFT_GELIEHEN,
    ]);
    const rest = await beobachte<{ n: string }>(
      "select count(*) as n from public.memberships where id = $1",
      [MITGLIEDSCHAFT_GELIEHEN],
    );
    if (rest[0]?.n !== "0") {
      throw new Error(
        "[planning-write] die geliehene Mitgliedschaft ist NICHT entfernt worden — " +
          "spaetere Mandantengates wuerden auf einem falschen Zustand messen (EYT-136).",
      );
    }
  }
}

/** Die drei Konjunkte der Insert-Policies aus Migration 0017, einzeln gemessen. */
type KonjunktSonde = {
  kanal: boolean;
  mandant_alpha: boolean;
  recht_alpha: boolean;
  recht_beta: boolean;
};

/**
 * Misst die Konjunkte EINZELN — im selben Kanal und mit demselben Subjekt wie
 * die gleich folgende Anweisung (EYT-136).
 *
 * Ohne diese Sonde ist ein 42501 mehrdeutig: fehlendes Spaltenrecht, fehlender
 * Mandant und fehlendes Recht melden denselben Code, und die Meldung nennt nur
 * die Tabelle, nie den Riegel. Danach ist genau ein Konjunkt falsch, und es ist
 * benannt.
 *
 * `recht_beta` ist die Gegenprobe zur Sonde selbst: `USER_B` ist Owner in BETA
 * und traegt `planning.write` DORT. Antwortete die Sonde schlicht auf alles mit
 * `false`, faellt genau diese Zusicherung — und nebenbei ist bewiesen, dass das
 * Recht je Organisation ausgewertet wird und nicht ueber Mandanten hinweg blutet.
 */
async function konjunkteAlsMitglied(client: Client, ziel: string): Promise<void> {
  const ergebnis = await runnerAuf(client).run({ userId: USER_B }, (tx) =>
    tx.query<KonjunktSonde>(
      `select app.is_runtime_channel()                      as kanal,
              $1::uuid in (select app.user_org_ids())       as mandant_alpha,
              app.has_permission($1::uuid, 'planning.write') as recht_alpha,
              app.has_permission($2::uuid, 'planning.write') as recht_beta`,
      [ORG_ALPHA, ORG_BETA],
    ),
  );
  const sonde = ergebnis.rows[0];
  if (sonde === undefined) {
    throw new Error("[planning-write] Konjunktsonde lieferte keine Zeile (EYT-136).");
  }

  process.stdout.write(
    `[planning-write] member-probe ziel=${ziel} kanal=${String(sonde.kanal)} ` +
      `mandant_alpha=${String(sonde.mandant_alpha)} recht_alpha=${String(sonde.recht_alpha)} ` +
      `recht_beta=${String(sonde.recht_beta)}\n`,
  );

  expect(sonde.kanal, "kein Laufzeitkanal — gemessen wuerde der falsche Riegel").toBe(true);
  expect(sonde.mandant_alpha, "die geliehene Mitgliedschaft wirkt nicht in Alpha").toBe(true);
  expect(sonde.recht_alpha, "das Subjekt traegt planning.write in Alpha").toBe(false);
  expect(sonde.recht_beta, "die Sonde antwortet auf alles mit false und misst nichts").toBe(true);
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

  // Fail-closed, nicht fail-open: ohne Laufzeitkanal misst diese Suite seit
  // EYT-136 nicht mehr den Produktionsvertrag. Im Pflichtmodus ist das ein
  // Fehler, kein Ueberspringen — sonst koennte ein fehlendes Secret ein
  // Sicherheitsgate gruen machen.
  if (APP_DB_URL === undefined) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        "[planning-write] fail-closed: EASYTREE_TEST_APP_DB_URL ist nicht gesetzt. " +
          "Der Entwurfspfad braucht den Laufzeitkanal (Loginrolle easytree_app), " +
          "seit Migration 0017 (EYT-136).",
      );
    }
    console.warn("[planning-write.integration] SKIPPED: EASYTREE_TEST_APP_DB_URL nicht gesetzt.");
    dbAvailable = false;
    return;
  }

  await neueAdminVerbindung();
  await raeumeWoche();
});

afterAll(async () => {
  if (dbAvailable && admin !== undefined) {
    for (const woche of [
      WOCHE,
      WOCHE_BASELINE,
      WOCHE_BASELINE_PARALLEL,
      WOCHE_BASELINE_DEFINER,
      WOCHE_RECHT_VERSION,
      WOCHE_RECHT_ZUWEISUNG,
    ]) {
      await raeumeWoche(woche);
    }
    // Die geliehene Mitgliedschaft wird NICHT hier abgeraeumt: sie lebt und
    // stirbt innerhalb ihres Falls (siehe mitGeliehenerMitgliedschaft). Ein
    // Aufraeumen erst hier waere zu spaet — dazwischen laufen weitere Faelle.
    // Die selbst angelegte Person wieder entfernen — sonst waechst der
    // Bestand mit jedem Lauf, und die naechste Suite zaehlt anders.
    await admin.query("delete from public.employees where id = $1", [EMPLOYEE_ALPHA_2]);
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
      await raeumeWoche();
      const repo = new PlanningWriteRepository(
        runnerAuf(client),
        USER_A,
        wochenschluessel,
        idempotenzSpeicher,
      );

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
      const anzahl = await beobachte<{ n: string }>(
        `select count(*) as n from public.assignments
        where plan_version_id in (select id from public.plan_versions where week_key = $1)`,
        [WOCHE],
      );
      expect(anzahl[0]?.n).toBe("1");

      // Auch die Nebenwirkungen gibt es genau einmal.
      const outbox = await beobachte<{ n: string }>(
        "select count(*) as n from public.outbox_messages where org_id = $1 and message_type = $2",
        [ORG_ALPHA, "planning.assignment_created"],
      );
      expect(outbox[0]?.n).toBe("1");
    },
  );

  dbIt("Auditzeile und Outboxnachricht entstehen mit dem Einsatz", async () => {
    const client = await neueVerbindung();
    await raeumeWoche();
    const repo = new PlanningWriteRepository(
      runnerAuf(client),
      USER_A,
      wochenschluessel,
      idempotenzSpeicher,
    );

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

    const audit = await beobachte<{ subject_id: string; actor_user_id: string }>(
      `select subject_id, actor_user_id from public.audit_events
        where org_id = $1 and event_type = 'planning.assignment_created'`,
      [ORG_ALPHA],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.subject_id).toBe(ergebnis.assignment.id);
    // Der Urheber kommt aus app.current_user_id(), nicht aus der Anwendung.
    expect(audit[0]?.actor_user_id).toBe(USER_A);

    const outbox = await beobachte<{ payload: { assignmentId: string } }>(
      `select payload from public.outbox_messages
        where org_id = $1 and message_type = 'planning.assignment_created'`,
      [ORG_ALPHA],
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload.assignmentId).toBe(ergebnis.assignment.id);
  });

  dbIt("nach erzwungenem Fehler bleibt weder Einsatz noch Audit- oder Outboxzeile", async () => {
    const client = await neueVerbindung();
    await raeumeWoche();
    // Abbruch NACH dem Einsatz-Insert: die Zeile stand bereits in der
    // Transaktion. Nur die Klammer kann sie jetzt noch entfernen.
    const repo = new PlanningWriteRepository(
      runnerAuf(client),
      USER_A,
      wochenschluessel,
      idempotenzSpeicher,
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
      const zeilen = await beobachte<{ n: string }>(sql);
      expect(zeilen[0]?.n, `Teilwirkung in ${tabelle}`).toBe("0");
    }
  });

  dbIt("zwei parallele Anfragen erzeugen nur einen Einsatz, nicht zwei", async () => {
    // ZWEI echte Verbindungen. Eine Sitzung kann die Serialisierung nicht
    // zeigen: sie saehe ihre eigene, noch nicht committete Zeile ohnehin.
    const a = await neueVerbindung();
    const b = await neueVerbindung();
    await raeumeWoche();

    const repoA = new PlanningWriteRepository(
      runnerAuf(a),
      USER_A,
      wochenschluessel,
      idempotenzSpeicher,
    );
    const repoB = new PlanningWriteRepository(
      runnerAuf(b),
      USER_A,
      wochenschluessel,
      idempotenzSpeicher,
    );
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

    const anzahl = await beobachte<{ n: string }>(
      `select count(*) as n from public.assignments
        where plan_version_id in (select id from public.plan_versions where week_key = $1)`,
      [WOCHE],
    );
    expect(anzahl[0]?.n).toBe("1");
  });

  dbIt(
    "der erste Entwurf ueber einer veroeffentlichten Woche laesst den Planstand nicht verschwinden",
    async () => {
      const client = await neueVerbindung();
      await raeumeWoche(WOCHE_BASELINE);

      // Eine veroeffentlichte Version mit einer Zuweisung — der Stand, den die
      // Planerin vor sich hat.
      const veroeffentlicht = await veroeffentlichteBaseline(
        WOCHE_BASELINE,
        "2026-11-10T07:00:00Z",
        "2026-11-10T15:00:00Z",
      );

      const repo = new PlanningWriteRepository(
        runnerAuf(client),
        USER_A,
        wochenschluessel,
        idempotenzSpeicher,
      );
      const ergebnis = await repo.createAssignment({
        weekKey: WOCHE_BASELINE,
        employeeId: EMPLOYEE_ALPHA,
        worksiteId: WORKSITE_ALPHA,
        startsAtUtc: new Date("2026-11-11T07:00:00Z"),
        endsAtUtc: new Date("2026-11-11T15:00:00Z"),
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      });
      expect(ergebnis.ok).toBe(true);
      if (!ergebnis.ok) return;

      // Der neue Entwurf traegt ZWEI Zuweisungen: die uebernommene und die neue.
      // Ohne die Uebernahme waere es eine — und die veroeffentlichte Planung
      // waere aus der Ansicht verschwunden, ohne dass jemand sie geloescht hat.
      const imEntwurf = await beobachte<{ n: string }>(
        "select count(*) as n from public.assignments where plan_version_id = $1",
        [ergebnis.assignment.planVersionId],
      );
      expect(imEntwurf[0]?.n).toBe("2");
      expect(ergebnis.assignment.planVersionId).not.toBe(veroeffentlicht);
    },
  );

  dbIt("zwei parallele Anfragen mit DEMSELBEN Schluessel erzeugen nur einen Einsatz", async () => {
    // Der Fall, den die erste Fassung nicht abdeckte: der Replay-Blick lief
    // VOR jeder Sperre, also sahen beide Anfragen "nicht vorhanden".
    const a = await neueVerbindung();
    const b = await neueVerbindung();
    await raeumeWoche();

    const repoA = new PlanningWriteRepository(
      runnerAuf(a),
      USER_A,
      wochenschluessel,
      idempotenzSpeicher,
    );
    const repoB = new PlanningWriteRepository(
      runnerAuf(b),
      USER_A,
      wochenschluessel,
      idempotenzSpeicher,
    );
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

    const anzahl = await beobachte<{ n: string }>(
      `select count(*) as n from public.assignments
        where plan_version_id in (select id from public.plan_versions where week_key = $1)`,
      [WOCHE],
    );
    expect(anzahl[0]?.n).toBe("1");
  });

  dbIt(
    "derselbe Schluessel mit ANDERER Anfrage wird abgelehnt, nicht als Replay beantwortet",
    async () => {
      const client = await neueVerbindung();
      await raeumeWoche();
      const repo = new PlanningWriteRepository(
        runnerAuf(client),
        USER_A,
        wochenschluessel,
        idempotenzSpeicher,
      );
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
    await raeumeWoche();
    const repo = new PlanningWriteRepository(
      runnerAuf(client),
      USER_A,
      wochenschluessel,
      idempotenzSpeicher,
    );
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

    // Stammdaten umschalten gehoert zur Beobachterseite: der Laufzeitkanal ist
    // ausserhalb von `runnerAuf` rechtlos (NOINHERIT, Migration 0003), und ein
    // `update public.employees` von dort endete in `permission denied`.
    await adminVerbindung().query("update public.employees set active = false where id = $1", [
      EMPLOYEE_ALPHA,
    ]);
    try {
      const zweit = await repo.createAssignment(eingabe);
      expect(zweit.ok).toBe(true);
      if (!zweit.ok) return;
      expect(zweit.assignment.id).toBe(erst.assignment.id);
      expect(zweit.replayed).toBe(true);
    } finally {
      await adminVerbindung().query("update public.employees set active = true where id = $1", [
        EMPLOYEE_ALPHA,
      ]);
    }
  });

  dbIt(
    "zwei Personen gleichzeitig kopieren die veroeffentlichte Baseline genau einmal",
    async () => {
      const a = await neueVerbindung();
      const b = await neueVerbindung();
      await raeumeWoche(WOCHE_BASELINE_PARALLEL);

      // Veroeffentlichte Baseline mit EINER Zuweisung.
      await veroeffentlichteBaseline(
        WOCHE_BASELINE_PARALLEL,
        "2026-11-17T07:00:00Z",
        "2026-11-17T15:00:00Z",
      );

      const repoA = new PlanningWriteRepository(
        runnerAuf(a),
        USER_A,
        wochenschluessel,
        idempotenzSpeicher,
      );
      const repoB = new PlanningWriteRepository(
        runnerAuf(b),
        USER_A,
        wochenschluessel,
        idempotenzSpeicher,
      );
      const basis = { weekKey: WOCHE_BASELINE_PARALLEL, worksiteId: WORKSITE_ALPHA };

      // VERSCHIEDENE Personen, damit der Employee-Lock die beiden nicht ohnehin
      // hintereinander legt — nur so ist das Entwurfs-Wettrennen echt.
      const [x, y] = await Promise.all([
        repoA.createAssignment({
          ...basis,
          employeeId: EMPLOYEE_ALPHA,
          startsAtUtc: new Date("2026-11-18T07:00:00Z"),
          endsAtUtc: new Date("2026-11-18T15:00:00Z"),
          idempotencyKey: "99999999-9999-4999-8999-99999999999a",
        }),
        repoB.createAssignment({
          ...basis,
          employeeId: EMPLOYEE_ALPHA_2,
          startsAtUtc: new Date("2026-11-18T16:00:00Z"),
          endsAtUtc: new Date("2026-11-18T20:00:00Z"),
          idempotencyKey: "99999999-9999-4999-8999-99999999999b",
        }),
      ]);
      expect(x.ok && y.ok).toBe(true);
      if (!x.ok || !y.ok) return;
      expect(x.assignment.planVersionId).toBe(y.assignment.planVersionId);

      // Baseline genau einmal, beide neuen Einsaetze genau einmal: drei Zeilen.
      const zeilen = await beobachte<{ starts_at_utc: Date }>(
        "select starts_at_utc from public.assignments where plan_version_id = $1 order by starts_at_utc",
        [x.assignment.planVersionId],
      );
      expect(zeilen).toHaveLength(3);
      const baseline = zeilen.filter(
        (r) => r.starts_at_utc.toISOString() === "2026-11-17T07:00:00.000Z",
      );
      expect(baseline).toHaveLength(1);
    },
  );

  /**
   * Umgezogen aus `supabase/tests/0006_planning_invariants.sql` (EYT-136).
   *
   * Dort lief dieser Fall ueber `authenticated` und trug eine zweite,
   * nicht offensichtliche Last: `app.reject_assignment_in_published_plan()`
   * liest die Elternzeile mit `for share`, und PostgreSQL prueft bei einer
   * Sperrklausel zusaetzlich die `using`-Klausel der UPDATE-Policy. Ohne
   * `security definer` (Migration 0015) faende dieses select nichts, der Zweig
   * „nicht gefunden" liesse die Zuweisung durch — und der Test waere
   * gruen-falsch. Genau so fiel er am 04.08.2026 auf (Lauf 30862744360).
   *
   * Seit Migration 0017 lehnt die INSERT-Policy in pgTAP schon VOR dem Trigger
   * ab (42501, fehlender Laufzeitkanal), dort ist die Aussage also nicht mehr
   * messbar. Hier ist sie es: diese Verbindung IST der Laufzeitkanal, der
   * Insert passiert die Policy und laeuft in den Trigger — genau die
   * Konstellation, um die es geht.
   *
   * Bewusst ein direkter Insert statt `createAssignment`: der Command wuerde
   * eine eigene Entwurfsversion anlegen und die veroeffentlichte nie
   * beruehren. Gemessen wird hier die Datenbankregel, nicht der Command.
   */
  dbIt(
    "eine veroeffentlichte Planversion nimmt ueber den Laufzeitkanal keine Zuweisung mehr auf",
    async () => {
      await raeumeWoche(WOCHE_BASELINE_DEFINER);
      const veroeffentlicht = await veroeffentlichteBaseline(
        WOCHE_BASELINE_DEFINER,
        "2026-11-24T07:00:00Z",
        "2026-11-24T15:00:00Z",
      );

      const client = await neueVerbindung();
      let fehler: DatabaseError | null = null;
      try {
        await runnerAuf(client).run({ userId: USER_A }, async (tx) => {
          await tx.query(
            `insert into public.assignments
               (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              ORG_ALPHA,
              veroeffentlicht,
              EMPLOYEE_ALPHA,
              WORKSITE_ALPHA,
              new Date("2026-11-25T07:00:00Z"),
              new Date("2026-11-25T15:00:00Z"),
            ],
          );
        });
      } catch (e) {
        fehler = e as DatabaseError;
      }

      // Nicht `toBeTruthy()`: der Code unterscheidet die Regel (23514) von
      // einem fehlenden Recht (42501). Waere es 42501, haette die Policy
      // abgelehnt und der Trigger — also die eigentliche Aussage — waere
      // ungemessen geblieben.
      expect(fehler).not.toBeNull();
      expect(fehler?.code).toBe("23514");
      expect(fehler?.message).toContain("nimmt keine Zuweisung mehr auf");
    },
  );

  /**
   * Der Vertrag selbst, nicht seine Wirkung (EYT-136).
   *
   * Alle anderen Faelle wuerden auch dann gruen, wenn der Command versehentlich
   * ueber `postgres` liefe — sie messen Ergebnisse, nicht den Kanal. Dieser Fall
   * misst den Kanal: `session_user` ist die LOGINrolle und laesst sich durch
   * `set local role` nicht faelschen, `current_user` ist die gewechselte Rolle.
   * Genau dieses Paar verlangt `app.is_runtime_channel()` in den Insert-Policies
   * aus Migration 0017.
   *
   * Die Sonde laeuft INNERHALB des Runners und nicht daneben: `easytree_app`
   * ist NOINHERIT (Migration 0003) und erreicht vor dem Rollenwechsel nicht
   * einmal das Schema `app`.
   */
  dbIt("der Entwurfspfad laeuft auf dem Laufzeitkanal, nicht als postgres", async () => {
    const client = await neueVerbindung();
    const wer = await runnerAuf(client).run({ userId: USER_A }, (tx) =>
      tx.query<{ session_user: string; current_user: string; runtime: boolean }>(
        "select session_user, current_user, app.is_runtime_channel() as runtime",
      ),
    );
    const zeile = wer.rows[0];

    process.stdout.write(
      `[planning-write] session_user=${zeile?.session_user ?? "?"} ` +
        `current_user=${zeile?.current_user ?? "?"} ` +
        `runtime_channel=${String(zeile?.runtime ?? false)}\n`,
    );

    // Ohne diese drei Zeilen koennte die Suite eines Tages still wieder als
    // `postgres` laufen, und jeder Nachweis ueber die Kanalgrenze waere
    // wertlos, ohne rot zu werden.
    expect(zeile?.session_user).toBe("easytree_app");
    expect(zeile?.current_user).toBe("authenticated");
    expect(zeile?.runtime).toBe(true);
  });

  // =========================================================================
  // Die Rechtegrenze aus Migration 0017 — behavioural, nicht als Textvergleich
  // =========================================================================
  // Beide Faelle schreiben ROH statt ueber `createAssignment`, und das ist
  // keine Bequemlichkeit, sondern die einzige Moeglichkeit:
  //
  // 1. `createAssignment` bricht bei mehr als einer sichtbaren Organisation mit
  //    `AMBIGUOUS_ORGANISATION` ab (planning-write.repository.ts, direkt nach
  //    `select id, time_zone from public.organizations`). `USER_B` ist Owner in
  //    BETA und waehrend der Leihe zusaetzlich Mitglied in ALPHA — der Command
  //    kaeme also nie bis zur Datenbankregel. Ueber den Command ist die
  //    Rechtegrenze mit diesem Subjekt schlicht nicht erreichbar.
  // 2. Der Command legt IMMER zuerst die Planversion an. Die Zuweisungs-Policy
  //    aus 0017 wuerde er nie erreichen — sie ist deshalb nur roh messbar.
  //
  // Was dadurch NICHT gemessen wird: dass der Command selbst ablehnt. Das ist
  // Aufgabe der Anwendungsschicht und liegt ausserhalb dieses Tickets; hier
  // steht die Datenbank als zweiter, unabhaengiger Riegel im Beweis.

  /**
   * Die Planversion: Kanal ja, Mandant ja, Recht nein (EYT-136).
   *
   * Gegenmutation: streicht man `app.has_permission(org_id, 'planning.write')`
   * aus `plan_versions_insert_in_org` in Migration 0017, gelingt dieses Insert
   * und der Fall wird rot. Die Konjunktsonde davor sagt zusaetzlich, WELCHE
   * Bedingung gefallen ist — ohne sie waere 42501 nicht von einem fehlenden
   * Spaltenrecht oder einer fehlenden Mitgliedschaft zu unterscheiden.
   */
  dbIt(
    "ein aktives Mitglied ohne planning.write legt ueber den Laufzeitkanal keine Planversion an",
    async () => {
      await mitGeliehenerMitgliedschaft(async () => {
        // Gegenprobe zum Spaltenrecht, in derselben Bauart wie A3 in
        // supabase/tests/0012_planning_data_api_boundary.sql: waere das
        // Insert-Recht entzogen, meldete PostgreSQL denselben Code 42501, und
        // die Ablehnung sagte nichts ueber die Policy aus.
        const rechte = await beobachte<{ v1: boolean }>(
          `select has_column_privilege('authenticated','public.plan_versions','week_key','INSERT') as v1`,
        );
        expect(rechte[0]?.v1, "ohne Insert-Spaltenrecht waere 42501 mehrdeutig").toBe(true);

        const client = await neueVerbindung();
        await konjunkteAlsMitglied(client, "plan_versions");

        let fehler: DatabaseError | null = null;
        try {
          await runnerAuf(client).run({ userId: USER_B }, async (tx) => {
            await tx.query("insert into public.plan_versions (org_id, week_key) values ($1, $2)", [
              ORG_ALPHA,
              WOCHE_RECHT_VERSION,
            ]);
          });
        } catch (e) {
          fehler = e as DatabaseError;
        }

        expect(fehler, "das Mitglied konnte eine Planversion anlegen").not.toBeNull();
        expect(fehler?.code).toBe("42501");

        const danach = await beobachte<{ n: string }>(
          "select count(*) as n from public.plan_versions where org_id = $1 and week_key = $2",
          [ORG_ALPHA, WOCHE_RECHT_VERSION],
        );
        expect(danach[0]?.n, "trotz Fehler ist eine Planversion entstanden").toBe("0");
      });
    },
  );

  /**
   * Die Zuweisung in einen ENTWURF: der Riegel, den sonst nichts prueft
   * (EYT-136).
   *
   * `createAssignment` legt immer zuerst die Planversion an und scheitert dort
   * schon — kein Test dieses Repositories erreicht die Zuweisungs-Policy je
   * ueber den Command. Bliebe es dabei, wuerde das Streichen von
   * `app.has_permission(org_id, 'planning.write')` aus
   * `assignments_insert_in_org` NIRGENDS rot: der einzige weitere Waechter ist
   * die Textprobe ueber `pg_policies` in
   * `supabase/tests/0012_planning_data_api_boundary.sql` (B3), und ein
   * Textvergleich bleibt auch gegen `… or true` und gegen eine kaputte
   * `app.has_permission` gruen.
   *
   * Gegenmutation: streicht man den `has_permission`-Konjunkt aus
   * `assignments_insert_in_org` in Migration 0017, gelingt dieses Insert und
   * der Fall wird rot.
   *
   * Die Elternzeile ist ein ENTWURF und keine veroeffentlichte Version: sonst
   * fiele `app.reject_assignment_in_published_plan()` zuerst (23514) und
   * verdeckte die Policy — genau der Fall, den der Nachbarfall oben misst.
   */
  dbIt(
    "ein aktives Mitglied ohne planning.write haengt auch in einen Entwurf keine Zuweisung",
    async () => {
      await raeumeWoche(WOCHE_RECHT_ZUWEISUNG);
      const entwurf = await adminVerbindung().query<{ id: string }>(
        "insert into public.plan_versions (org_id, week_key) values ($1, $2) returning id",
        [ORG_ALPHA, WOCHE_RECHT_ZUWEISUNG],
      );
      const versionId = entwurf.rows[0]?.id;
      if (versionId === undefined) {
        throw new Error("[planning-write] Entwurfsversion liess sich nicht anlegen.");
      }

      await mitGeliehenerMitgliedschaft(async () => {
        const rechte = await beobachte<{ v1: boolean }>(
          `select has_column_privilege('authenticated','public.assignments','starts_at_utc','INSERT') as v1`,
        );
        expect(rechte[0]?.v1, "ohne Insert-Spaltenrecht waere 42501 mehrdeutig").toBe(true);

        const client = await neueVerbindung();
        await konjunkteAlsMitglied(client, "assignments");

        let fehler: DatabaseError | null = null;
        try {
          await runnerAuf(client).run({ userId: USER_B }, async (tx) => {
            await tx.query(
              `insert into public.assignments
                 (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
               values ($1, $2, $3, $4, $5, $6)`,
              [
                ORG_ALPHA,
                versionId,
                EMPLOYEE_ALPHA,
                WORKSITE_ALPHA,
                new Date("2026-12-08T07:00:00Z"),
                new Date("2026-12-08T15:00:00Z"),
              ],
            );
          });
        } catch (e) {
          fehler = e as DatabaseError;
        }

        // 42501 und nicht 23514: bei 23514 haette der Trigger aus 0010
        // abgelehnt, die Elternzeile waere entgegen der Absicht veroeffentlicht
        // gewesen, und die Policy bliebe ungemessen.
        expect(fehler, "das Mitglied konnte eine Zuweisung anlegen").not.toBeNull();
        expect(fehler?.code).toBe("42501");

        const danach = await beobachte<{ n: string }>(
          "select count(*) as n from public.assignments where plan_version_id = $1",
          [versionId],
        );
        expect(danach[0]?.n, "trotz Fehler ist eine Zuweisung entstanden").toBe("0");
      });
    },
  );
});
