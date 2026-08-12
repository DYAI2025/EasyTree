/**
 * Lesen VEROEFFENTLICHTER Planstaende gegen echtes PostgreSQL (EYT-109).
 *
 * Deckt die Aussagen ab, die ein Unittest strukturell nicht treffen kann: die
 * Mandantengrenze entsteht in RLS und nicht im Anwendungscode, und die Frage
 * „welcher Stand ist verbindlich" wird von der Datenbank beantwortet, nicht von
 * einer Attrappe.
 *
 * ## Warum es diese beiden Methoden ueberhaupt gibt
 *
 * `planningWindow(weekKey)` beantwortet „was ist in dieser Woche BEARBEITBAR"
 * und bevorzugt dafuer den Entwurf. Ein Kosten-Snapshot braucht das Gegenteil:
 * „was ist in DIESER Version verbindlich geworden". Sobald ueber einer
 * veroeffentlichten Version ein neuer Entwurf derselben Woche steht, liefern
 * beide verschiedene Zuweisungen — und `planningWindow` liefert die falschen.
 * Fall 4 misst genau diesen Unterschied an einer echten Datenbank, statt ihn zu
 * behaupten: er ruft BEIDE Methoden auf demselben Datenstand auf und haelt fest,
 * dass sie auseinandergehen.
 *
 * Die Kette, die dadurch abgeschnitten wird (Failure-Mode A des Plans):
 * neuer Entwurf -> Kosten lesen fremde Zuweisungen -> der Snapshot friert einen
 * Personalplan ein, den niemand veroeffentlicht hat -> die spaetere
 * Excel-Ausgabe zeigt falsche Zahlen, die revisionssicher aussehen.
 *
 * ## Zwei Verbindungen, und warum
 *
 * `DB_URL` ist die Verwaltungs- und BEOBACHTERverbindung (`postgres`): sie legt
 * Fixtures an, veroeffentlicht sie und zaehlt. Sie arbeitet ohne
 * `set local role authenticated` und braucht volle Tabellenrechte.
 *
 * `APP_DB_URL` ist der LAUFZEITKANAL (`easytree_app`) — dieselbe Loginrolle wie
 * API und Worker. Das Repository laeuft ausschliesslich dort. Kein Rueckfall auf
 * `DB_URL`: eine stille Vertretung waere genau die Bequemlichkeit, die einen
 * Nachweis in eine Behauptung verwandelt.
 *
 * Beobachtungen laufen NIE ueber den Laufzeitkanal. `easytree_app` ist NOINHERIT
 * und sieht nach dem Rollenwechsel nur, was RLS durchlaesst — eine Zaehlung
 * dort koennte gerade das nicht sehen, dessen Abwesenheit sie belegen soll, und
 * wuerde ausserdem mit 42501 scheitern.
 *
 * ## Gegenmutation
 *
 * GM1 des Plans: in `planning-window.repository.ts::publishedAssignments` die
 * Bedingung `and published_at is not null` entfernen -> der Fall
 * „lehnt eine Entwurfsversion ab" wird rot. Deshalb steht die Pruefung dort im
 * SQL und nicht als `if` hinter einer gelesenen Zeile: ein `if` waere dieselbe
 * Wirkung an einer Stelle, die die benannte Mutation nicht trifft.
 */
import { Client } from "pg";
import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FailClosedGate,
  ORG_ALPHA,
  ORG_BETA,
  probeDatabase,
  USER_A,
} from "./tenant-context.helper";
import { PlanningWindowRepository } from "../src/modules/planning";
import type { TenantQuery, TenantQueryRunner } from "../src/platform/database/tenant-query-runner";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const APP_DB_URL = process.env["EASYTREE_TEST_APP_DB_URL"];

/** Die Loginrolle, unter der API und Worker arbeiten (Migration 0003). */
const LAUFZEITROLLE = "easytree_app";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("planning-published-reads", TENANT_TESTS_MODE, "EYT-109");

let dbAvailable = false;
const clients: Client[] = [];

/** Seed-Konstanten aus supabase/seed.sql. */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";
const EMPLOYEE_BETA = "00000000-0000-4000-8000-0000004020b2";
const WORKSITE_BETA = "00000000-0000-4000-8000-0000005020b2";

/**
 * Eine Id, die es garantiert nicht gibt.
 *
 * Fest und nicht zufaellig: ein roter Lauf soll sich mit demselben Wert
 * wiederholen lassen. Gueltiges UUID-v4-Format, damit die Datenbank sie als Id
 * annimmt statt sie schon beim Parsen abzulehnen — sonst pruefte Fall 3 die
 * Typumwandlung und nicht die Sichtbarkeit.
 */
const UNBEKANNTE_VERSION = "00000000-0000-4000-8000-0000000f0f0f";

const STAMMDATEN: Record<string, { employeeId: string; worksiteId: string }> = {
  [ORG_ALPHA]: { employeeId: EMPLOYEE_ALPHA, worksiteId: WORKSITE_ALPHA },
  [ORG_BETA]: { employeeId: EMPLOYEE_BETA, worksiteId: WORKSITE_BETA },
};

/**
 * Eigene Wochen, ausserhalb aller anderen Suiten.
 *
 * Belegt sind bereits W01 und W20–W34 (planning-publish), W40/W41
 * (planning-invariants), W45–W51 (planning-write) und W32 (seed.sql).
 * Veroeffentlichte Planversionen sind laut Migration 0010 unveraenderlich UND
 * unloeschbar — der Aufraeumschritt kann sie deshalb nicht entfernen, und das
 * ist Teil der Aussage und kein Mangel. Eigene Wochen sind die Loesung.
 */
const W_VEROEFFENTLICHT = "2026-W10";
const W_ENTWURF = "2026-W11";
const W_FREMD = "2026-W12";
const W_SCHATTEN = "2026-W13";
const W_VOR_BEREICH = "2026-W14";
const W_BEREICH_VON = "2026-W15";
const W_BEREICH_MITTE = "2026-W16";
const W_BEREICH_BIS = "2026-W17";
const W_NACH_BEREICH = "2026-W18";
const W_STEMPEL = "2026-W19";

/** Multi-Org-Faelle (EYT-109). Eigene Wochen, ausserhalb aller anderen Suiten. */
const W_MO_ALPHA = "2026-W02";
const W_MO_BETA = "2026-W03";

/** Existiert in keiner Migration und keinem Seed — die „fremde" Organisation. */
const ORG_UNBEKANNT = "00000000-0000-4000-8000-0000000000c3";

/** Feste Id der geliehenen Zweitmitgliedschaft. Nicht im Seed vergeben. */
const MITGLIEDSCHAFT_ZWEITE = "00000000-0000-4000-8000-0000000e0ab9";

const ALLE_WOCHEN = [
  W_VEROEFFENTLICHT,
  W_ENTWURF,
  W_FREMD,
  W_SCHATTEN,
  W_VOR_BEREICH,
  W_BEREICH_VON,
  W_BEREICH_MITTE,
  W_BEREICH_BIS,
  W_NACH_BEREICH,
  W_STEMPEL,
  W_MO_ALPHA,
  W_MO_BETA,
];

/**
 * Montag der ISO-Woche, berechnet statt hartkodiert.
 *
 * Eine Tabelle mit neun Datumsangaben waere eine zweite Wochenrechnung, und ein
 * Tippfehler darin liesse den falschen Fall gruen laufen. `2026-W01` beginnt am
 * Montag, 29.12.2025.
 */
function montagDerWoche(woche: string): Date {
  const nummer = Number(woche.slice(-2));
  return new Date(Date.UTC(2025, 11, 29) + (nummer - 1) * 7 * 24 * 60 * 60 * 1000);
}

/** Ein Intervall am `tag`-ten Tag der Woche, 06:00–14:00 UTC. */
function intervall(woche: string, tag: number): { von: Date; bis: Date } {
  const montag = montagDerWoche(woche).getTime();
  const start = montag + tag * 24 * 60 * 60 * 1000;
  return {
    von: new Date(start + 6 * 60 * 60 * 1000),
    bis: new Date(start + 14 * 60 * 60 * 1000),
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

/** Verwaltungs- und Beobachterverbindung (`postgres`). */
async function neueAdminVerbindung(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

/** Verbindung auf dem Laufzeitkanal (`easytree_app`). */
async function neueVerbindung(): Promise<Client> {
  if (APP_DB_URL === undefined) {
    throw new Error(
      "[planning-published-reads] EASYTREE_TEST_APP_DB_URL fehlt — der Laufzeitkanal ist nicht konfiguriert.",
    );
  }
  const client = new Client({ connectionString: APP_DB_URL });
  await client.connect();
  clients.push(client);
  return client;
}

function repositoryAuf(
  client: Client,
  subject: string = USER_A,
  organisationId: string | null = null,
): PlanningWindowRepository {
  return new PlanningWindowRepository(runnerAuf(client), subject, organisationId);
}

/**
 * Legt eine Planversion als ENTWURF an — direkt per SQL, ohne den Schreibpfad.
 *
 * Bewusst nicht ueber `createAssignment`/`publishPlan`: diese Suite prueft das
 * LESEN. Ein Fehler im Schreibpfad wuerde hier sonst als Lesefehler erscheinen.
 */
async function entwurfMit(
  admin: Client,
  woche: string,
  zuweisungen: readonly { von: Date; bis: Date }[],
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
      [orgId, id, stamm.employeeId, stamm.worksiteId, zuweisung.von, zuweisung.bis],
    );
  }
  return id;
}

/**
 * Veroeffentlicht eine Planversion mit EXPLIZITEM Zeitstempel.
 *
 * Explizit statt `now()`, weil Fall 5 die nachrangige Sortierung misst: zwei
 * Veroeffentlichungen derselben Transaktion trugen sonst denselben Wert, und
 * die Reihenfolge waere nicht mehr bestimmbar. Der Trigger aus Migration 0010
 * stempelt dabei jede Zuweisung der Version mit.
 */
async function veroeffentliche(admin: Client, versionId: string, zeitpunkt: Date): Promise<void> {
  const ergebnis = await admin.query(
    `update public.plan_versions
        set published_at = $2, published_by = $3
      where id = $1`,
    [versionId, zeitpunkt, USER_A],
  );
  if (ergebnis.rowCount !== 1) {
    throw new Error(`Planversion ${versionId} liess sich nicht veroeffentlichen.`);
  }
}

async function zaehle(admin: Client, sql: string, params: readonly unknown[]): Promise<number> {
  const ergebnis = await admin.query<{ n: string }>(sql, [...params]);
  return Number(ergebnis.rows[0]?.n ?? "0");
}

/** Beobachtung: wie viele Zuweisungen haengen an dieser Version? */
const zuweisungsZaehler = (admin: Client, versionId: string): Promise<number> =>
  zaehle(admin, "select count(*) as n from public.assignments where plan_version_id = $1", [
    versionId,
  ]);

/** Beobachtung: Existenz und Veroeffentlichungsstand einer Version. */
async function beobachteVersion(
  admin: Client,
  versionId: string,
): Promise<{ orgId: string; publishedAt: Date | null } | null> {
  const rows = await admin.query<{ org_id: string; published_at: Date | null }>(
    "select org_id, published_at from public.plan_versions where id = $1",
    [versionId],
  );
  const zeile = rows.rows[0];
  return zeile === undefined ? null : { orgId: zeile.org_id, publishedAt: zeile.published_at };
}

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
        "[planning-published-reads] fail-closed: EASYTREE_TEST_APP_DB_URL ist nicht gesetzt. " +
          "Die Leseoperationen sollen auf demselben Kanal gemessen werden, auf dem API und " +
          "Worker arbeiten (Loginrolle easytree_app).",
      );
    }
    console.warn(
      "[planning-published-reads.integration] SKIPPED: EASYTREE_TEST_APP_DB_URL nicht gesetzt.",
    );
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

/**
 * Leiht `USER_A` fuer die Dauer EINES Falls eine aktive `member`-Mitgliedschaft
 * in Organisation BETA — damit ist das Subjekt echt mehrfach-organisatorisch.
 *
 * Warum geliehen und nicht geseedet: `supabase/seed.sql` kennt bewusst keinen
 * Multi-Org-Benutzer, und eine dauerhafte zweite Mitgliedschaft veraenderte jede
 * andere Mandantensuite im selben Job — die Mandantengates laufen als eigene
 * Schritte um diese Datei herum. Die Zeile lebt deshalb nur so lange wie der
 * Fall, der sie braucht, und ihr Verschwinden wird NACHGESEHEN statt angenommen.
 *
 * Bauart woertlich uebernommen aus `planning-write.integration.test.ts`
 * (`mitGeliehenerMitgliedschaft`), einschliesslich der beiden Punkte, die dort
 * teuer gelernt wurden:
 *
 * - `catch` statt `finally`. Ein `throw` im `finally` verwuerfe einen bereits
 *   laufenden Fehler aus dem Fall; `no-unsafe-finally` verbietet ihn, und die
 *   erste Fassung ist im Lauf 31230613284 genau daran gescheitert. Eingefangen
 *   statt durchgereicht laeuft das Aufraeumen auf JEDEM Weg.
 * - Der Fehler liegt in einem Tupel und nicht nackt in der Variablen: `fn` ist
 *   von aussen hereingereicht, und ein nacktes `let fehler: unknown = null`
 *   koennte „kein Fehler" nicht von „hat `null` geworfen" unterscheiden.
 *
 * Alle Beobachtungen laufen ueber die Verwaltungsverbindung. Ueber den
 * Laufzeitkanal saehe `easytree_app` nach dem Rollenwechsel nur, was RLS
 * durchlaesst — eine Zaehlung dort belegte das Verschwinden der Zeile nicht.
 */
async function mitZweiterMitgliedschaft(fn: () => Promise<void>): Promise<void> {
  await admin.query(
    `insert into public.memberships (id, org_id, user_id, role, active)
     values ($1, $2, $3, 'member', true)`,
    [MITGLIEDSCHAFT_ZWEITE, ORG_BETA, USER_A],
  );

  let fehlerAusFall: [unknown] | null = null;
  try {
    // Die Leihe hat gewirkt — gemessen, nicht angenommen. Ohne diese Kontrolle
    // koennte ein Fall gruen sein, weil das Subjekt gar nicht mehrfach
    // organisiert war: dann maesse er die Einorganisationsantwort und nennte
    // sie eine Bindung.
    const stand = await admin.query<{ role: string; active: boolean }>(
      "select role, active from public.memberships where id = $1",
      [MITGLIEDSCHAFT_ZWEITE],
    );
    expect(stand.rows[0]?.role, "die geliehene Mitgliedschaft traegt die falsche Rolle").toBe(
      "member",
    );
    expect(stand.rows[0]?.active, "die geliehene Mitgliedschaft ist nicht aktiv").toBe(true);
    await fn();
  } catch (e) {
    fehlerAusFall = [e];
  }

  await admin.query("delete from public.memberships where id = $1", [MITGLIEDSCHAFT_ZWEITE]);
  const rest = await zaehle(admin, "select count(*) as n from public.memberships where id = $1", [
    MITGLIEDSCHAFT_ZWEITE,
  ]);
  // Vorrang fuer den gefaehrlicheren Befund: ein fehlgeschlagener Fall kostet
  // diesen Lauf, eine ueberlebende Mitgliedschaft verfaelscht spaetere
  // Mandantengates im selben Job. `cause` haengt den urspruenglichen Fehler an,
  // statt ihn zu verschlucken — sonst berichtete ein doppelt gescheiterter Lauf
  // nur das Aufraeumproblem und verloere den Grund.
  if (rest !== 0) {
    throw new Error(
      "[planning-published-reads] die geliehene Mitgliedschaft ist NICHT entfernt worden — " +
        "spaetere Mandantengates wuerden auf einem falschen Zustand messen (EYT-109).",
      fehlerAusFall === null ? undefined : { cause: fehlerAusFall[0] },
    );
  }
  if (fehlerAusFall !== null) throw fehlerAusFall[0];
}

describe("Leseoperationen fuer veroeffentlichte Staende gegen echtes PostgreSQL", () => {
  /**
   * Der Kanal gehoert gemessen, nicht angenommen.
   *
   * Ohne diese Aussage koennte `APP_DB_URL` unbemerkt auf `postgres` zeigen und
   * jede folgende Mandantenaussage waere wertlos — `postgres` traegt BYPASSRLS.
   */
  dbIt("laeuft auf dem Laufzeitkanal, nicht auf der Verwaltungsverbindung", async () => {
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
  // Fall 1
  // -------------------------------------------------------------------------
  dbIt(
    "liefert Zuweisungen, Woche, Zone und Ressourcen einer veroeffentlichten Version",
    async () => {
      const zeit = intervall(W_VEROEFFENTLICHT, 0);
      const versionId = await entwurfMit(admin, W_VEROEFFENTLICHT, [zeit]);

      // Zustand NACH dem Anlegen — nicht erst am Ende.
      expect(await zuweisungsZaehler(admin, versionId)).toBe(1);
      expect((await beobachteVersion(admin, versionId))?.publishedAt).toBeNull();

      await veroeffentliche(admin, versionId, new Date("2026-03-02T10:00:00.000Z"));

      // Zustand NACH dem Veroeffentlichen.
      const nachher = await beobachteVersion(admin, versionId);
      expect(nachher?.publishedAt).not.toBeNull();
      expect(await zuweisungsZaehler(admin, versionId)).toBe(1);

      const client = await neueVerbindung();
      const ergebnis = await repositoryAuf(client).publishedAssignments(versionId);

      expect(ergebnis.ok).toBe(true);
      if (!ergebnis.ok) return;
      expect(ergebnis.published.planVersionId).toBe(versionId);
      expect(ergebnis.published.weekKey).toBe(W_VEROEFFENTLICHT);
      expect(ergebnis.published.publishedAt).toEqual(new Date("2026-03-02T10:00:00.000Z"));

      // Die Zone kommt aus organizations.time_zone — nicht aus der Maschine.
      const zone = await admin.query<{ time_zone: string }>(
        "select time_zone from public.organizations where id = $1",
        [ORG_ALPHA],
      );
      expect(ergebnis.published.timeZone).toBe(zone.rows[0]?.time_zone);

      expect(ergebnis.published.assignments).toHaveLength(1);
      expect(ergebnis.published.assignments[0]?.employeeId).toBe(EMPLOYEE_ALPHA);
      expect(ergebnis.published.assignments[0]?.worksiteId).toBe(WORKSITE_ALPHA);
      expect(ergebnis.published.assignments[0]?.startsAtUtc).toEqual(zeit.von);
      expect(ergebnis.published.assignments[0]?.endsAtUtc).toEqual(zeit.bis);

      // Die Basis, aus der EYT-109 spaeter employeeLabels/worksiteLabels bildet:
      // je Bezeichner ein nicht leerer Text. Ohne ihn blockiert die Montage
      // spaeter mit LABEL_MISSING.
      const person = ergebnis.published.resources.employees.find((e) => e.id === EMPLOYEE_ALPHA);
      const baustelle = ergebnis.published.resources.worksites.find((w) => w.id === WORKSITE_ALPHA);
      expect(person?.label).toBeTruthy();
      expect(baustelle?.label).toBeTruthy();

      // Und: die Version wurde NICHT ueber die Woche rekonstruiert. Waere sie es,
      // stuende hier die Id eines beliebigen Standes derselben Woche.
      expect(ergebnis.published.planVersionId).toBe(versionId);
    },
  );

  // -------------------------------------------------------------------------
  // Fall 2 — Titel ist bindend: GM1 adressiert ihn namentlich.
  // -------------------------------------------------------------------------
  dbIt("lehnt eine Entwurfsversion ab", async () => {
    const versionId = await entwurfMit(admin, W_ENTWURF, [intervall(W_ENTWURF, 0)]);

    // Beobachtung: die Version EXISTIERT und ist unveroeffentlicht. Ohne diese
    // Zeile koennte der Test auch dann gruen sein, wenn der Fixture gescheitert
    // waere — dann maesse er „nicht gefunden" und nennte es „nicht
    // veroeffentlicht".
    const beobachtet = await beobachteVersion(admin, versionId);
    expect(beobachtet).not.toBeNull();
    expect(beobachtet?.publishedAt).toBeNull();
    expect(beobachtet?.orgId).toBe(ORG_ALPHA);

    const client = await neueVerbindung();
    const ergebnis = await repositoryAuf(client).publishedAssignments(versionId);

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("PLAN_NOT_PUBLISHED");
    // Ausdruecklich NICHT „nicht gefunden": die Version ist sichtbar, sie ist
    // nur nicht verbindlich. Die beiden Gruende verlangen verschiedene
    // Reaktionen.
    expect(ergebnis.problem).not.toBe("PLAN_VERSION_NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // Fall 3
  // -------------------------------------------------------------------------
  dbIt("macht eine fremde Planversion von einer unbekannten nicht unterscheidbar", async () => {
    const fremdeId = await entwurfMit(admin, W_FREMD, [intervall(W_FREMD, 0)], ORG_BETA);
    await veroeffentliche(admin, fremdeId, new Date("2026-03-03T10:00:00.000Z"));

    // Beobachtung: die fremde Version existiert WIRKLICH und ist
    // veroeffentlicht. Sonst pruefte dieser Fall nur, dass eine nicht
    // existierende Id nicht gefunden wird — also nichts.
    const beobachtet = await beobachteVersion(admin, fremdeId);
    expect(beobachtet?.orgId).toBe(ORG_BETA);
    expect(beobachtet?.publishedAt).not.toBeNull();
    expect(await zuweisungsZaehler(admin, fremdeId)).toBe(1);

    const client = await neueVerbindung();
    const fremd = await repositoryAuf(client).publishedAssignments(fremdeId);
    const unbekannt = await repositoryAuf(client).publishedAssignments(UNBEKANNTE_VERSION);

    expect(fremd.ok).toBe(false);
    expect(unbekannt.ok).toBe(false);
    if (fremd.ok || unbekannt.ok) return;

    expect(fremd.problem).toBe("PLAN_VERSION_NOT_FOUND");
    // Der Kern: BEIDE Antworten sind identisch. Waeren sie es nicht, verriete
    // die Antwort, welche fremden Ids echt sind.
    expect(fremd.problem).toBe(unbekannt.problem);
  });

  // -------------------------------------------------------------------------
  // Fall 4 — der Grund, weshalb planningWindow hier nicht genuegt.
  // -------------------------------------------------------------------------
  dbIt(
    "liefert den veroeffentlichten Stand, auch wenn ein neuerer Entwurf derselben Woche existiert",
    async () => {
      const veroeffentlichteZeit = intervall(W_SCHATTEN, 0);
      const veroeffentlichteId = await entwurfMit(admin, W_SCHATTEN, [veroeffentlichteZeit]);
      await veroeffentliche(admin, veroeffentlichteId, new Date("2026-03-04T10:00:00.000Z"));

      // Zustand NACH dem Veroeffentlichen, vor dem Angriffsschritt.
      expect(await zuweisungsZaehler(admin, veroeffentlichteId)).toBe(1);
      expect((await beobachteVersion(admin, veroeffentlichteId))?.publishedAt).not.toBeNull();

      // Der Angriffsschritt: ein NEUER Entwurf derselben Woche, mit einer
      // ANDEREN Zuweisung.
      const entwurfsZeit = intervall(W_SCHATTEN, 1);
      const entwurfsId = await entwurfMit(admin, W_SCHATTEN, [entwurfsZeit]);

      // Zustand NACH dem Angriffsschritt — beide Seiten einzeln geprueft, nicht
      // als Netto-Differenz: ein Zaehler ueber die ganze Woche waere 2 und saehe
      // gleich aus, egal an welcher Version die Zuweisungen haengen.
      expect(entwurfsId).not.toBe(veroeffentlichteId);
      expect((await beobachteVersion(admin, entwurfsId))?.publishedAt).toBeNull();
      expect(await zuweisungsZaehler(admin, entwurfsId)).toBe(1);
      expect(await zuweisungsZaehler(admin, veroeffentlichteId)).toBe(1);

      const client = await neueVerbindung();
      const repository = repositoryAuf(client);

      const ergebnis = await repository.publishedAssignments(veroeffentlichteId);
      expect(ergebnis.ok).toBe(true);
      if (!ergebnis.ok) return;
      expect(ergebnis.published.planVersionId).toBe(veroeffentlichteId);
      expect(ergebnis.published.assignments).toHaveLength(1);
      // Die VEROEFFENTLICHTE Zuweisung, nicht die des Entwurfs.
      expect(ergebnis.published.assignments[0]?.startsAtUtc).toEqual(veroeffentlichteZeit.von);
      expect(ergebnis.published.assignments[0]?.startsAtUtc).not.toEqual(entwurfsZeit.von);

      // Und der Gegenbeweis auf demselben Datenstand: `planningWindow` liefert
      // hier den ENTWURF. Damit ist belegt, dass die neue Methode nicht bloss
      // eine umbenannte Wiederverwendung ist — die beiden Antworten gehen
      // auseinander, und nur eine davon taugt fuer Kosten.
      const fenster = await repository.planningWindow(W_SCHATTEN);
      expect(fenster.ok).toBe(true);
      if (!fenster.ok) return;
      expect(fenster.window.sourceVersion?.state).toBe("draft");
      expect(fenster.window.sourceVersion?.id).toBe(entwurfsId);
      expect(fenster.window.assignments[0]?.startsAtUtc).toEqual(entwurfsZeit.von);
    },
  );

  // -------------------------------------------------------------------------
  // Fall 5
  // -------------------------------------------------------------------------
  dbIt("listet nur veroeffentlichte Versionen des eigenen Mandanten im Bereich", async () => {
    // Anlegen und Veroeffentlichen ABWECHSELND, nicht erst alle Entwuerfe.
    //
    // Der erste Anlauf legte zwei Entwuerfe derselben Woche an und lief in
    // `plan_versions_one_draft_per_week` (0007, partieller Unique-Index):
    // je Organisation und Woche darf es hoechstens EINEN unveroeffentlichten
    // Stand geben, sonst waere „der" Entwurf nicht bestimmbar. Mehrere
    // VEROEFFENTLICHTE Versionen pro Woche sind dagegen erlaubt — genau die
    // Konstellation, die dieser Fall braucht. Der Weg dorthin fuehrt deshalb
    // ueber Veroeffentlichen, nicht ueber gleichzeitige Entwuerfe.
    //
    // Die Reihenfolgen widersprechen einander mit Absicht, sonst maskierte ein
    // gleichlaufender Nebenschluessel den geprueften:
    //
    //   Anlage (created_at):   B  <  A  <  frueh
    //   Veroeffentlichung:     A  <  B  <  frueh
    //   Woche (week_key):      frueh (W15)  <  A = B (W17)
    //
    // Erwartet ist damit [frueh, A, B]. Eine Sortierung ueber `created_at`
    // ergaebe [B, A, frueh] — also sowohl der Wochenschluessel als auch die
    // Sekundaerordnung innerhalb von W17 sind widerlegbar geprueft.
    //
    // Die Zeitstempel stehen explizit und nicht als `now()`: sonst waere die
    // Veroeffentlichungsreihenfolge an die Anlagereihenfolge gekoppelt und der
    // Widerspruch nicht herstellbar.
    const spaetB = await entwurfMit(admin, W_BEREICH_BIS, []);
    await veroeffentliche(admin, spaetB, new Date("2026-03-05T09:00:00.000Z"));
    const spaetA = await entwurfMit(admin, W_BEREICH_BIS, []);
    await veroeffentliche(admin, spaetA, new Date("2026-03-05T08:00:00.000Z"));
    const frueh = await entwurfMit(admin, W_BEREICH_VON, []);
    await veroeffentliche(admin, frueh, new Date("2026-03-05T10:00:00.000Z"));

    // Zwei veroeffentlichte Versionen derselben Woche — die Voraussetzung des
    // Sekundaerschluessels. Ohne diese Zeile koennte der Fall unbemerkt zu
    // einem Test mit nur einer Version je Woche verkommen.
    expect(spaetA).not.toBe(spaetB);
    expect((await beobachteVersion(admin, spaetA))?.publishedAt).toEqual(
      new Date("2026-03-05T08:00:00.000Z"),
    );
    expect((await beobachteVersion(admin, spaetB))?.publishedAt).toEqual(
      new Date("2026-03-05T09:00:00.000Z"),
    );

    // Ein ENTWURF mitten im Bereich — darf nicht erscheinen.
    const entwurfImBereich = await entwurfMit(admin, W_BEREICH_MITTE, []);
    // Eine FREMDE veroeffentlichte Version mitten im Bereich — darf nicht
    // erscheinen.
    const fremdImBereich = await entwurfMit(admin, W_BEREICH_VON, [], ORG_BETA);
    await veroeffentliche(admin, fremdImBereich, new Date("2026-03-05T11:00:00.000Z"));
    // Veroeffentlichte Versionen AUSSERHALB des Bereichs, unten und oben.
    const davor = await entwurfMit(admin, W_VOR_BEREICH, []);
    await veroeffentliche(admin, davor, new Date("2026-03-05T12:00:00.000Z"));
    const danach = await entwurfMit(admin, W_NACH_BEREICH, []);
    await veroeffentliche(admin, danach, new Date("2026-03-05T13:00:00.000Z"));

    // Zustand nach JEDEM Aufbau einzeln geprueft.
    expect((await beobachteVersion(admin, entwurfImBereich))?.publishedAt).toBeNull();
    expect((await beobachteVersion(admin, fremdImBereich))?.orgId).toBe(ORG_BETA);
    expect((await beobachteVersion(admin, fremdImBereich))?.publishedAt).not.toBeNull();
    expect((await beobachteVersion(admin, davor))?.publishedAt).not.toBeNull();
    expect((await beobachteVersion(admin, danach))?.publishedAt).not.toBeNull();

    const client = await neueVerbindung();
    const ergebnis = await repositoryAuf(client).publishedVersions(W_BEREICH_VON, W_BEREICH_BIS);

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    const gelesen = ergebnis.versions;

    // Eigenschaften der GANZEN Liste, nicht nur der eigenen Zeilen. Das ist
    // staerker als ein Vergleich gegen eine erwartete Liste: es gilt auch fuer
    // Zeilen, die dieser Test nicht angelegt hat.
    for (const zeile of gelesen) {
      expect(zeile.weekKey >= W_BEREICH_VON).toBe(true);
      expect(zeile.weekKey <= W_BEREICH_BIS).toBe(true);
      expect(zeile.publishedAt).toBeInstanceOf(Date);
    }
    // Aufsteigend nach weekKey — geprueft ueber die tatsaechliche Folge.
    const wochen = gelesen.map((z) => z.weekKey);
    expect(wochen).toEqual([...wochen].sort());

    // Beobachtung: JEDE gelieferte Zeile ist wirklich veroeffentlicht und
    // gehoert wirklich dem eigenen Mandanten. Gemessen ueber die
    // Verwaltungsverbindung, nicht ueber dieselbe Abfrage.
    const kontrolle = await admin.query<{ org_id: string; published_at: Date | null }>(
      "select org_id, published_at from public.plan_versions where id = any($1::uuid[])",
      [gelesen.map((z) => z.id)],
    );
    expect(kontrolle.rows).toHaveLength(gelesen.length);
    for (const zeile of kontrolle.rows) {
      expect(zeile.org_id).toBe(ORG_ALPHA);
      expect(zeile.published_at).not.toBeNull();
    }

    const ids = gelesen.map((z) => z.id);
    // Die drei eigenen, in der kanonischen Reihenfolge: erst die fruehere
    // Woche, dann innerhalb von W17 nach published_at.
    expect(ids.filter((id) => [frueh, spaetA, spaetB].includes(id))).toEqual([
      frueh,
      spaetA,
      spaetB,
    ]);
    // Und die drei, die nicht vorkommen duerfen.
    expect(ids).not.toContain(entwurfImBereich);
    expect(ids).not.toContain(fremdImBereich);
    expect(ids).not.toContain(davor);
    expect(ids).not.toContain(danach);
  });

  /**
   * Die Invariante, die den Verzicht auf einen zweiten Filter traegt.
   *
   * `publishedAssignments` filtert die Zuweisungen NICHT zusaetzlich auf
   * `published_at is not null`. Das ist nur dann richtig, wenn eine
   * veroeffentlichte Version gar keine unveroeffentlichte Zuweisung enthalten
   * KANN — Migration 0010 stempelt beim Veroeffentlichen alle mit (Punkt 3) und
   * weist danach jede weitere ab (Punkt 5). Statt einer Bedingung, die keine
   * Datenlage je verletzt, steht hier die Messung dieser Zusicherung.
   */
  dbIt("haelt jede Zuweisung einer veroeffentlichten Version fuer gestempelt", async () => {
    const zielId = await entwurfMit(admin, W_STEMPEL, [intervall(W_STEMPEL, 0)]);
    await veroeffentliche(admin, zielId, new Date("2026-03-06T10:00:00.000Z"));

    // Der Trigger aus 0010 Punkt 3 hat die vorhandene Zuweisung mitgestempelt.
    expect(
      await zaehle(
        admin,
        "select count(*) as n from public.assignments where plan_version_id = $1 and published_at is null",
        [zielId],
      ),
    ).toBe(0);

    // Und der Weg zu einer ungestempelten Zeile ist versperrt: eine Zuweisung
    // in eine bereits veroeffentlichte Version wird abgewiesen (0010 Punkt 5).
    const zeit = intervall(W_STEMPEL, 3);
    await expect(
      admin.query(
        `insert into public.assignments
           (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
         values ($1, $2, $3, $4, $5, $6)`,
        [ORG_ALPHA, zielId, EMPLOYEE_ALPHA, WORKSITE_ALPHA, zeit.von, zeit.bis],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Zustand NACH dem Angriffsschritt, einzeln geprueft: es ist nichts
    // entstanden. Eine Netto-Zaehlung ueber die Woche saehe hier gleich aus,
    // egal ob der INSERT abgewiesen oder angelegt-und-verworfen wurde.
    expect(await zuweisungsZaehler(admin, zielId)).toBe(1);

    // Die Invariante gilt datenbankweit, nicht nur fuer diese Version.
    expect(
      await zaehle(
        admin,
        `select count(*) as n from public.assignments a
           join public.plan_versions v on v.id = a.plan_version_id
          where v.published_at is not null and a.published_at is null`,
        [],
      ),
    ).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Multi-Org-Gate (EYT-109) — die Bindung gegen echtes RLS, nicht gegen
  // Attrappen. Bis hierher ist sie ausschliesslich mit Doubles gemessen; erst
  // db-gates fuehrt die beiden folgenden Faelle je gegen eine echte Datenbank.
  // -------------------------------------------------------------------------

  /**
   * Gegenmutation: streicht man in `sichtbareOrganisationen` den gebundenen
   * Zweig (`where id::text = $1`), sieht ein mehrfach-organisatorisches Subjekt
   * wieder beide Organisationen — die beiden gebundenen Lesungen unten liefern
   * dann `AMBIGUOUS_ORGANISATION` statt einer Liste, und der Fall wird rot.
   * Streicht man stattdessen die `and org_id = $3`-Bedingung aus
   * `publishedVersions`, enthaelt jede der beiden Listen BEIDE Versionen — auch
   * dann wird er rot.
   */
  dbIt("bindet einen Multi-Org-Kontext deterministisch an die gewaehlte Organisation", async () => {
    // Zustand nach JEDEM Schritt einzeln beobachtet — eine Summe ueber beide
    // Wochen saehe gleich aus, egal an welcher Organisation die Versionen
    // haengen, und genau das ist die Frage dieses Falls.
    const alphaId = await entwurfMit(admin, W_MO_ALPHA, [intervall(W_MO_ALPHA, 0)], ORG_ALPHA);
    expect((await beobachteVersion(admin, alphaId))?.orgId).toBe(ORG_ALPHA);
    expect((await beobachteVersion(admin, alphaId))?.publishedAt).toBeNull();
    expect(await zuweisungsZaehler(admin, alphaId)).toBe(1);

    await veroeffentliche(admin, alphaId, new Date("2026-01-05T10:00:00.000Z"));
    expect((await beobachteVersion(admin, alphaId))?.publishedAt).not.toBeNull();

    const betaId = await entwurfMit(admin, W_MO_BETA, [intervall(W_MO_BETA, 0)], ORG_BETA);
    expect((await beobachteVersion(admin, betaId))?.orgId).toBe(ORG_BETA);
    expect((await beobachteVersion(admin, betaId))?.publishedAt).toBeNull();
    expect(await zuweisungsZaehler(admin, betaId)).toBe(1);

    await veroeffentliche(admin, betaId, new Date("2026-01-12T10:00:00.000Z"));
    expect((await beobachteVersion(admin, betaId))?.publishedAt).not.toBeNull();

    // Und die Alpha-Seite steht nach dem zweiten Aufbauschritt unveraendert da.
    expect(alphaId).not.toBe(betaId);
    expect((await beobachteVersion(admin, alphaId))?.orgId).toBe(ORG_ALPHA);
    expect(await zuweisungsZaehler(admin, alphaId)).toBe(1);

    const client = await neueVerbindung();

    await mitZweiterMitgliedschaft(async () => {
      const idsGebundenAn = async (org: string): Promise<string[]> => {
        const ergebnis = await repositoryAuf(client, USER_A, org).publishedVersions(
          W_MO_ALPHA,
          W_MO_BETA,
        );
        expect(ergebnis.ok, `publishedVersions gebunden an ${org} haette antworten muessen`).toBe(
          true,
        );
        return ergebnis.ok ? ergebnis.versions.map((v) => v.id) : [];
      };

      // Ohne Bindung bleibt es mehrdeutig. Kein „erste Zeile gewinnt": eine
      // stille Auswahl waere die gefaehrlichste aller Antworten, weil sie
      // aussieht wie ein Ergebnis.
      const ohne = await repositoryAuf(client, USER_A, null).publishedVersions(
        W_MO_ALPHA,
        W_MO_BETA,
      );
      expect(ohne.ok).toBe(false);
      if (ohne.ok) return;
      expect(ohne.problem).toBe("AMBIGUOUS_ORGANISATION");

      // Gebunden an ALPHA: liefert Alpha und NICHT Beta.
      const gebundenAnAlpha = await idsGebundenAn(ORG_ALPHA);
      expect(gebundenAnAlpha).toContain(alphaId);
      expect(gebundenAnAlpha).not.toContain(betaId);

      // Gebunden an BETA: liefert Beta und NICHT Alpha. Erst dieser zweite
      // Durchgang belegt, dass nicht schlicht die erste sichtbare Organisation
      // genommen wird — mit nur einer Richtung waere „immer Alpha" gruen.
      const gebundenAnBeta = await idsGebundenAn(ORG_BETA);
      expect(gebundenAnBeta).toContain(betaId);
      expect(gebundenAnBeta).not.toContain(alphaId);

      // Und die versionsgenaue Lesung folgt derselben Bindung: die fremde
      // Version ist unter der Gegenbindung nicht erreichbar — obwohl RLS sie
      // dem Subjekt in diesem Moment durchliesse.
      const querzugriff = await repositoryAuf(client, USER_A, ORG_ALPHA).publishedAssignments(
        betaId,
      );
      expect(querzugriff.ok).toBe(false);
      if (querzugriff.ok) return;
      expect(querzugriff.problem).toBe("PLAN_VERSION_NOT_FOUND");
    });
  });

  /**
   * Fail-closed, ohne Rueckfall — und ohne Auskunft darueber, welche Id echt
   * ist.
   *
   * Gegenmutation: laesst man `organisationOf` bei null Zeilen auf die erste
   * sichtbare Organisation zurueckfallen, antwortet der erste Teil mit
   * `ok: true` und den Alpha-Versionen, und der Fall wird rot.
   */
  dbIt(
    "liefert bei einer nicht sichtbaren Organisation nichts und faellt nicht zurueck",
    async () => {
      // Beobachtung gegen Vacuitaet: ORG_BETA existiert WIRKLICH. Ohne sie
      // maesse der zweite Teil nur, dass eine nicht existierende Id nichts
      // findet — also dasselbe wie der erste, und damit nichts.
      expect(
        await zaehle(admin, "select count(*) as n from public.organizations where id = $1", [
          ORG_BETA,
        ]),
        "ORG_BETA muss wirklich existieren, sonst misst der zweite Teil nichts",
      ).toBe(1);

      const client = await neueVerbindung();
      const antworten: string[] = [];

      await mitZweiterMitgliedschaft(async () => {
        // Eine Organisation, die es nirgends gibt — angefragt aus einem Kontext,
        // in dem zwei andere sichtbar waeren.
        const unbekannt = await repositoryAuf(client, USER_A, ORG_UNBEKANNT).publishedVersions(
          W_MO_ALPHA,
          W_MO_BETA,
        );
        expect(unbekannt.ok).toBe(false);
        if (unbekannt.ok) return;
        expect(unbekannt.problem).toBe("NO_ORGANISATION");
        antworten.push(unbekannt.problem);
      });

      // Ausserhalb der Leihe, also wieder einorganisatorisch: eine Organisation,
      // die es WIRKLICH gibt, in der `USER_A` aber nicht Mitglied ist.
      const fremd = await repositoryAuf(client, USER_A, ORG_BETA).publishedVersions(
        W_MO_ALPHA,
        W_MO_BETA,
      );
      expect(fremd.ok).toBe(false);
      if (fremd.ok) return;
      expect(fremd.problem).toBe("NO_ORGANISATION");
      antworten.push(fremd.problem);

      // Der Kern: BEIDE Antworten sind identisch. Waeren sie es nicht, verriete
      // die Antwort, welche fremden Organisations-Ids echt sind. Ueber die Liste
      // geprueft und nicht ueber zwei Einzelvergleiche, weil ein uebersprungener
      // Zweig sonst unbemerkt bliebe.
      expect(antworten).toEqual(["NO_ORGANISATION", "NO_ORGANISATION"]);
    },
  );
});
