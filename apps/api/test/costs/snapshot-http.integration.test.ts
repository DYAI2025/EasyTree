/**
 * Die beiden Snapshot-Routen gegen echtes PostgreSQL (EYT-139, Task 5).
 *
 * ## Was der Nahttest strukturell nicht treffen kann — und hier steht
 *
 * `test/costs/snapshot-http.test.ts` faehrt dieselben Routen mit GESTELLTEM
 * Repository und gestelltem Faktenport. Er misst damit Verdrahtung und
 * Fehlerabbildung, und das gut. Vier Aussagen kann er aus Bauart nicht treffen:
 *
 *  1. RLS blendet die fremde Organisation WIRKLICH aus. Der Nahttest bliebe
 *     gruen, wenn die Datenbank jedem alles zeigte — sein Repository antwortet
 *     ohnehin nur, was der Stub hergibt (I9, I11).
 *  2. Ein Montagefehler hinterlaesst KEINE Zeile. Der Nahttest zaehlt
 *     Stubaufrufe, keine Datenbankzeilen (I5).
 *  3. Ein gelesener Snapshot sieht eine spaetere Satzversion nicht. Das
 *     verlangt echte Zeit und echte Zeilen (I8).
 *  4. Ein Retry legt keinen zweiten Snapshot an. Der Nahttest misst gegen einen
 *     KONSTANTEN Stub — er ist ausdruecklich kein Idempotenznachweis (I2).
 *
 * Diese Datei misst deshalb nichts, was dort schon gemessen wird: keine
 * Statusabbildung je Montagegrund, keine Zugangsketten, keine Titel- oder
 * URN-Tabellen. Sie misst die DATENREISE.
 *
 * ## Was echt ist und was ersetzt
 *
 * Echt sind `AppModule`, Controller, Policy, Filter, Korrelations-Middleware,
 * Use-Case, Montage, `PgCostSnapshotRepository`, `PgRateRepository`,
 * `PlanningWindowRepository`, `PgTenantQueryRunner`, Pool und PostgreSQL.
 *
 * Ersetzt sind genau drei Tokens: `REQUEST_IDENTITY` (sonst braeuchte der Test
 * einen laufenden GoTrue), `SESSION_ORGANISATIONS` (sonst dieselbe Kette noch
 * einmal) und `DATABASE_PING` (die Bereitschaftssonde gehoert nicht hierher).
 *
 * `TENANT_QUERY_RUNNER` ist KEIN Ersatz im selben Sinn: eingesetzt wird die
 * echte Klasse `PgTenantQueryRunner`, nur ihre VERBINDUNG zeigt auf die
 * Testinstanz. `apps/api/test/setup.ts` setzt eine `DATABASE_URL` ohne
 * Zugangsdaten, mit der das `AppModule` keine echte Verbindung aufbauen kann;
 * Transaktion, Rollenwechsel und Kontextsetzung bleiben unveraendert die
 * produktiven (gleiche Bauart wie `rate-http-contract.integration.test.ts`).
 *
 * ## Zwei Verbindungen, und warum
 *
 * `EASYTREE_TEST_DB_URL` ist die Verwaltungs- und BEOBACHTERverbindung
 * (`postgres`): sie legt Fixtures an, veroeffentlicht, raeumt auf und zaehlt.
 *
 * `EASYTREE_TEST_APP_DB_URL` ist der LAUFZEITKANAL (`easytree_app`) — dieselbe
 * Loginrolle wie API und Worker. Ueber ihn schreibt das `AppModule`, und nur
 * ueber ihn: `cost_snapshots` verlangt in beiden insert-Policies
 * `app.is_runtime_channel()` (Migration 0018). Kein Rueckfall auf `DB_URL` —
 * eine stille Vertretung waere genau die Bequemlichkeit, die einen Nachweis in
 * eine Behauptung verwandelt.
 *
 * Beobachtungen laufen NIE ueber den Laufzeitkanal. `easytree_app` ist
 * NOINHERIT und saehe nach `set local role authenticated` nur, was RLS
 * durchlaesst — eine Zaehlung dort koennte gerade das nicht sehen, dessen
 * Abwesenheit sie belegen soll, und scheiterte ausserdem an fehlenden Rechten
 * (42501).
 *
 * ## Warum nach JEDEM Versuch gezaehlt wird und nicht einmal am Ende
 *
 * Netto-Zaehlungen heben sich auf: ein fehlgeschlagener Schreibversuch und eine
 * spaetere erfolgreiche Anlage ergaeben am Ende dieselbe Zeilenzahl wie ein
 * sauberer Lauf. Der Zustand wird deshalb unmittelbar nach dem jeweiligen
 * Versuch gemessen — und zusaetzlich gegen den Gesamtstand dieser Suite, damit
 * eine Zeile unter einer ANDEREN Korrelations-Id nicht unbemerkt bleibt.
 *
 * ## Eigene ISO-Wochen, und warum sie im Jahr 2027 liegen
 *
 * Veroeffentlichte Planversionen sind laut Migration 0010 unveraenderlich UND
 * unloeschbar — der Aufraeumschritt kann sie nicht entfernen, und das ist Teil
 * der Aussage, kein Mangel. Diese Suite legt deshalb ausschliesslich Wochen in
 * 2027 an: gemessen am Quelltext (`grep -rn "20[0-9][0-9]-W[0-9][0-9]"` ueber
 * `apps/api/test`, `supabase/tests` und `supabase/seed.sql`) belegt KEINE
 * andere Suite und kein Seed eine Woche in 2027. Damit kann eine Hinterlassenschaft
 * dieser Datei keine andere Suite stoeren, ohne dass die Aufzaehlung der freien
 * 2026-Wochen ein zweites Mal gepflegt werden muesste.
 *
 * Ebenso legt sie je Woche hoechstens EINEN Entwurf je Organisation an
 * (`plan_versions_one_draft_per_week`, Migration 0007) und veroeffentlicht ihn
 * sofort.
 *
 * ## Die geliehene Zweitmitgliedschaft
 *
 * `supabase/seed.sql` kennt bewusst keinen Multi-Org-Benutzer, und eine
 * DAUERHAFTE zweite Mitgliedschaft veraenderte jede andere Mandantensuite im
 * selben Job. Sie wird deshalb geliehen und ihr Verschwinden NACHGESEHEN statt
 * angenommen — Bauart uebernommen aus
 * `test/planning-published-reads.integration.test.ts::mitZweiterMitgliedschaft`.
 *
 * ## Gegenmutationen — BENANNT, nicht ausgefuehrt
 *
 * Diese Datei laeuft ausschliesslich in `db-gates`; auf der
 * Entwicklungsmaschine gibt es keine Datenbank, also auch keinen Rot-Lauf.
 * Genannt sind deshalb Mutationen, die genau EINEN Fall treffen und die der
 * Nahttest nicht faengt:
 *
 * - In `cost-snapshot-repository.pg.ts::create` den Replay-Zweig
 *   (`if (bekannt !== null) return { ok: true, snapshotId: bekannt.subjectId }`)
 *   entfernen -> I2 rot: zwei Koepfe unter einem Schluessel.
 * - Im Use-Case den Montagezweig `if (!montage.ok) return …` streichen und mit
 *   leerer Positionsliste weiterschreiben -> I5 rot: es bliebe eine Zeile.
 * - In `cost-snapshot-repository.pg.ts::read` den Betrag ueber einen Join auf
 *   `public.employee_rate_versions` neu ermitteln statt ihn zu lesen -> I8 rot.
 *   Diese Mutation faengt KEIN Waechter: `employee_rate_versions` gehoert dem
 *   Kostenmodul selbst, `costs-touches-only-own-tables` sieht sie also als
 *   erlaubt an. Nur eine zweite Lesung nach einer Satzabloesung zeigt sie.
 * - In Migration 0018 aus `cost_snapshots_select` die Bedingung
 *   `org_id in (select app.user_org_ids())` entfernen -> I9 rot: der fremde
 *   Snapshot waere lesbar.
 * - In `costs.controller.ts::snapshotAbhaengigkeiten` statt
 *   `zugang.organisationId` die erste Mitgliedschaft verwenden -> I11 rot: die
 *   Faktenfabrik saehe ALPHA, und BETAs Planversion waere unauffindbar.
 */
import {
  CostSnapshotSchema,
  IDEMPOTENCY_HEADER,
  RateVersionDtoSchema,
  type CostSnapshot,
} from "@easytree/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { API_BASE_PATH } from "../../src/common/api-base-path";
import { CORRELATION_ID_HEADER } from "../../src/common/correlation-id.middleware";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
// AUSSCHLIESSLICH ueber die Modulwurzel. Ein tiefer Pfad nach `costs/…` faellt
// am Waechter `costs-cross-module-public-api-only`, auch aus einem Test.
import {
  COSTS_ERROR_TYPE,
  SNAPSHOT_ASSEMBLY_ERROR_TYPE,
  SNAPSHOT_READ_ERROR_TYPE,
} from "../../src/modules/costs";
import { SESSION_ORGANISATIONS } from "../../src/modules/tenancy";
import { REQUEST_IDENTITY } from "../../src/platform/auth/request-identity";
import { PgTenantQueryRunner } from "../../src/platform/database/tenant-query-runner";
import { TENANT_QUERY_RUNNER } from "../../src/platform/database/tenant-query-runner.provider";
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
const gate = new FailClosedGate("snapshot-http", TENANT_TESTS_MODE, "EYT-139");

/** Seed-Konstanten aus supabase/seed.sql. */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";
const EMPLOYEE_BETA = "00000000-0000-4000-8000-0000004020b2";
const WORKSITE_BETA = "00000000-0000-4000-8000-0000005020b2";
/** `USER_B` fuehrt `tenant-context.helper.ts` nicht — aktiv in Org BETA. */
const USER_B = "00000000-0000-4000-8000-00000000bbb2";

/** Marke, an der der Aufraeumschritt die Zeilen dieser Suite erkennt. */
const MARKE = "snapshot-http-integration";

/**
 * Eigene Wochen dieser Suite. Siehe Kopf: 2027 ist ausserhalb jeder anderen
 * Suite und ausserhalb des Seeds.
 */
const W_ERFOLG = "2027-W10";
const W_OHNE_SATZ = "2027-W12";
const W_ABLOESUNG = "2027-W14";
const W_MO_ALPHA = "2027-W16";
const W_MO_BETA = "2027-W17";
const ALLE_WOCHEN = [W_ERFOLG, W_OHNE_SATZ, W_ABLOESUNG, W_MO_ALPHA, W_MO_BETA];

/** Feste Ids der Satzversionen dieser Suite — ein roter Lauf soll wiederholbar sein. */
const SATZ_ERFOLG = "00000000-0000-4000-8000-0000006d5001";
const SATZ_ABLOESUNG_V1 = "00000000-0000-4000-8000-0000006d5002";
const SATZ_BETA = "00000000-0000-4000-8000-0000006d50b2";

/** Feste Id der geliehenen Zweitmitgliedschaft. Nicht im Seed vergeben. */
const MITGLIEDSCHAFT_ZWEITE = "00000000-0000-4000-8000-0000000e0ab8";

/**
 * Eine Snapshot-Id, die es garantiert nicht gibt.
 *
 * Gueltiges UUID-v4-Format, damit `IdSchema` sie annimmt: sonst pruefte I9 die
 * Formatpruefung des Controllers statt die Ununterscheidbarkeit (EYT-91).
 */
const ID_ERFUNDEN = "00000000-0000-4000-8000-0000000d5f0f";

/**
 * Stundensaetze in Minor Units.
 *
 * Bindend ist genau eine Verschiedenheit: `V2` muss sich von `V1` deutlich
 * unterscheiden, sonst zeigte eine Neuberechnung in I8 dieselbe Zahl wie das
 * gespeicherte Dokument und der Fall waere blind. Dass `ERFOLG` und `V1`
 * denselben Wert tragen, ist dagegen unerheblich — sie treffen sich nie in
 * einem Fall.
 */
const SATZ_PRO_STUNDE_ERFOLG = 2500n;
const SATZ_PRO_STUNDE_V1 = 2500n;
const SATZ_PRO_STUNDE_V2 = 9900n;
const SATZ_PRO_STUNDE_BETA = 3300n;

/** Acht Stunden Schicht — 06:00–14:00 UTC. */
const SCHICHT_MS = 28_800_000n;
const BETRAG_ERFOLG_JE_TAG = (SATZ_PRO_STUNDE_ERFOLG * SCHICHT_MS) / 3_600_000n;

const ORGANISATION_HEADER = "x-easytree-organization-id";

/** `supertest`s Anfrageobjekt — ueber den Wertimport, ohne zweiten Typimport. */
type Anfrage = ReturnType<ReturnType<typeof request>["post"]>;

let dbAvailable = false;
let admin: Client;
let runner: PgTenantQueryRunner | null = null;
let app: INestApplication | null = null;

/**
 * Die gestartete Anwendung — ohne `!`.
 *
 * Ein `app!.getHttpServer()` behauptete, was hier gemessen gehoert: dass der
 * Start ueberhaupt stattgefunden hat. Der Wurf sagt es benannt.
 */
function anwendung(): INestApplication {
  if (app === null) {
    throw new Error("[snapshot-http] Die Anwendung ist nicht gestartet — Fixture fehlgeschlagen.");
  }
  return app;
}

/**
 * Der Laufzeitkanal — dieselbe Instanz, die das `AppModule` benutzt.
 *
 * Nullbar deklariert und nicht mit `!` behauptet: scheitert eine Fixture
 * zwischen Probe und Aufbau, laeuft `afterAll` trotzdem — und die Berichtszeile
 * darf dort nicht an einer `TypeError` auf `undefined` haengenbleiben.
 */
function laufzeitkanal(): PgTenantQueryRunner {
  if (runner === null) {
    throw new Error(
      "[snapshot-http] Der Laufzeitkanal ist nicht aufgebaut — Fixture fehlgeschlagen.",
    );
  }
  return runner;
}

// ---------------------------------------------------------------------------
// Sitzung: Subjekt und Mitgliedschaften, umschaltbar je Fall
// ---------------------------------------------------------------------------

interface Mitgliedschaft {
  readonly organisationId: string;
  readonly permissions: readonly string[];
}

interface Sitzung {
  readonly userId: string;
  readonly mitgliedschaften: readonly Mitgliedschaft[];
}

/**
 * Die Kostenrechte, die diese Suite in ALPHA braucht.
 *
 * Eine echte Teilmenge dessen, was `owner` laut Migration 0013 traegt — dort
 * steht zusaetzlich `costs.export`, das hier keine Route ruft.
 *
 * Ausgeschrieben und NICHT aus `public.role_permissions` gelesen: die
 * Anwendungsschicht entscheidet primaer, die Datenbank ueber
 * `app.has_permission` unabhaengig noch einmal (EYT-106 AK4). Eine aus
 * derselben Tabelle gelesene Liste liesse beide Haelften dieselbe Quelle
 * befragen — und der Nachweis der Unabhaengigkeit waere fort.
 */
const RECHTE_ALPHA = ["costs.read", "costs.calculate", "costs.manage_rates"] as const;

const SITZUNG_ALPHA: Sitzung = {
  userId: USER_A,
  mitgliedschaften: [{ organisationId: ORG_ALPHA, permissions: RECHTE_ALPHA }],
};

let sitzung: Sitzung = SITZUNG_ALPHA;

/** Setzt die Sitzung fuer die Dauer EINES Falls und stellt sie danach zurueck. */
async function alsSitzung<T>(neu: Sitzung, fn: () => Promise<T>): Promise<T> {
  const vorher = sitzung;
  sitzung = neu;
  try {
    return await fn();
  } finally {
    // Kein `throw` in diesem `finally` — es reicht nur einen Wert zurueck und
    // kann den Fehler aus `fn` deshalb nicht verdraengen (`no-unsafe-finally`).
    sitzung = vorher;
  }
}

// ---------------------------------------------------------------------------
// Zeitrechnung der Fixtures
// ---------------------------------------------------------------------------

/**
 * Montag der ISO-Woche, gerechnet statt hartkodiert.
 *
 * Eine Tabelle mit Datumsangaben waere eine zweite Wochenrechnung, und ein
 * Tippfehler darin liesse den falschen Fall gruen laufen. `2027-W01` beginnt am
 * Montag, 04.01.2027 — der 01.01.2027 ist ein Freitag, der erste Donnerstag des
 * Jahres faellt auf den 07.01.2027.
 *
 * Der Ankertag ist nicht bloss nachgerechnet: `packages/domain/test/planning-week.test.ts`
 * fuehrt `[2027, 1, 4, "2027-W01"]` als Fall der produktiven Wochenregel. Waere
 * die Basis hier falsch, widerspraeche sie einer bereits gemessenen Aussage.
 */
function montagDerWoche(woche: string): number {
  const nummer = Number(woche.slice(-2));
  return Date.UTC(2027, 0, 4) + (nummer - 1) * 7 * 24 * 60 * 60 * 1000;
}

interface Schicht {
  readonly von: Date;
  readonly bis: Date;
  /** Ortstag in Europe/Berlin, `JJJJ-MM-TT`. */
  readonly ortstag: string;
}

/**
 * Eine Achtstundenschicht am `tag`-ten Tag der Woche, 06:00–14:00 UTC.
 *
 * Der Ortstag ist hier gleich dem UTC-Tag, und das ist kein Zufall: in
 * Europe/Berlin liegt die Schicht bei 07:00–15:00 (CET) bzw. 08:00–16:00
 * (CEST) und ueberschreitet in keiner der beiden Lagen eine lokale
 * Tagesgrenze. Deshalb genuegt hier die Projektion des Instants; eine zweite
 * Zonenrechnung im Test waere genau die Doppelung, die `no-local-time`
 * verbietet.
 */
function schicht(woche: string, tag: number): Schicht {
  const start = montagDerWoche(woche) + tag * 24 * 60 * 60 * 1000;
  const von = new Date(start + 6 * 60 * 60 * 1000);
  return {
    von,
    bis: new Date(start + 14 * 60 * 60 * 1000),
    ortstag: von.toISOString().slice(0, 10),
  };
}

/** Kalendertag `JJJJ-MM-TT` relativ zum Montag einer Woche — fuer Satzgrenzen. */
function datumDerWoche(woche: string, tag: number): string {
  return new Date(montagDerWoche(woche) + tag * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Beobachtung — ausschliesslich ueber die Verwaltungsverbindung
// ---------------------------------------------------------------------------

async function zaehle(sql: string, params: readonly unknown[]): Promise<number> {
  const ergebnis = await admin.query<{ n: string }>(sql, [...params]);
  return Number(ergebnis.rows[0]?.n ?? "0");
}

const koepfeMitKorrelation = (korrelation: string): Promise<number> =>
  zaehle("select count(*) as n from public.cost_snapshots where correlation_id = $1", [
    korrelation,
  ]);

const alleKoepfeDieserSuite = (): Promise<number> =>
  zaehle("select count(*) as n from public.cost_snapshots where correlation_id like $1", [
    `${MARKE}%`,
  ]);

const positionenVon = (snapshotId: string): Promise<number> =>
  zaehle("select count(*) as n from public.cost_snapshot_positions where snapshot_id = $1", [
    snapshotId,
  ]);

async function organisationVon(snapshotId: string): Promise<string | null> {
  const ergebnis = await admin.query<{ org_id: string }>(
    "select org_id from public.cost_snapshots where id = $1",
    [snapshotId],
  );
  return ergebnis.rows[0]?.org_id ?? null;
}

/** Die am `tag` wirksame Satzversion — halboffen `[valid_from, valid_to)` wie 0013. */
async function wirksameSaetze(
  employeeId: string,
  orgId: string,
  tag: string,
): Promise<readonly string[]> {
  const ergebnis = await admin.query<{ id: string }>(
    `select id
       from public.employee_rate_versions
      where employee_id = $1 and org_id = $2
        and valid_from <= $3::date
        and (valid_to is null or $3::date < valid_to)
      order by valid_from`,
    [employeeId, orgId, tag],
  );
  return ergebnis.rows.map((zeile) => zeile.id);
}

// ---------------------------------------------------------------------------
// Fixtures — angelegt ueber die Verwaltungsverbindung, also an RLS vorbei.
// Das ist Absicht: sie sind Vorbedingung und keine Zusicherung. Was RLS
// zulaesst, messen die Faelle.
// ---------------------------------------------------------------------------

const STAMMDATEN: Record<
  string,
  { employeeId: string; worksiteId: string; veroeffentlichtVon: string }
> = {
  [ORG_ALPHA]: {
    employeeId: EMPLOYEE_ALPHA,
    worksiteId: WORKSITE_ALPHA,
    veroeffentlichtVon: USER_A,
  },
  // Veroeffentlicht von B's eigenem Seed-Benutzer. `published_by` traegt zwar
  // nur einen FK auf `public.users` und keine Mitgliedschaftsbedingung — eine
  // Fixture, die in BETA ein ALPHA-Subjekt einsetzt, waere trotzdem eine
  // Datenlage, die es im Betrieb nicht gibt.
  [ORG_BETA]: { employeeId: EMPLOYEE_BETA, worksiteId: WORKSITE_BETA, veroeffentlichtVon: USER_B },
};

/**
 * Legt eine Planversion an, haengt Schichten daran und VEROEFFENTLICHT sie.
 *
 * Der Zustand wird nach jedem Schritt einzeln beobachtet, nicht am Ende: eine
 * Zaehlung ueber die ganze Woche saehe gleich aus, egal an welcher Version die
 * Zuweisungen haengen.
 */
async function veroeffentlichterPlan(
  woche: string,
  orgId: string,
  schichten: readonly Schicht[],
): Promise<string> {
  const stamm = STAMMDATEN[orgId];
  if (stamm === undefined) throw new Error(`Keine Stammdaten fuer Organisation ${orgId}.`);

  const version = await admin.query<{ id: string }>(
    "insert into public.plan_versions (org_id, week_key) values ($1, $2) returning id",
    [orgId, woche],
  );
  const id = version.rows[0]?.id;
  if (id === undefined) throw new Error(`Entwurf fuer ${woche} liess sich nicht anlegen.`);

  for (const eine of schichten) {
    await admin.query(
      `insert into public.assignments
         (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
       values ($1, $2, $3, $4, $5, $6)`,
      [orgId, id, stamm.employeeId, stamm.worksiteId, eine.von, eine.bis],
    );
  }

  // Zustand NACH dem Anlegen: die Version ist ein Entwurf und traegt genau die
  // erwarteten Zuweisungen.
  const entwurf = await admin.query<{ org_id: string; published_at: Date | null }>(
    "select org_id, published_at from public.plan_versions where id = $1",
    [id],
  );
  expect(entwurf.rows[0]?.org_id, `Planversion ${woche} gehoert der falschen Organisation`).toBe(
    orgId,
  );
  expect(
    entwurf.rows[0]?.published_at,
    `Planversion ${woche} ist schon veroeffentlicht`,
  ).toBeNull();
  expect(
    await zaehle("select count(*) as n from public.assignments where plan_version_id = $1", [id]),
    `Planversion ${woche} traegt nicht die erwartete Zahl Zuweisungen`,
  ).toBe(schichten.length);

  const veroeffentlicht = await admin.query(
    "update public.plan_versions set published_at = now(), published_by = $2 where id = $1",
    [id, stamm.veroeffentlichtVon],
  );
  if (veroeffentlicht.rowCount !== 1) {
    throw new Error(`Planversion ${woche} liess sich nicht veroeffentlichen.`);
  }

  // Zustand NACH dem Veroeffentlichen. Ohne diese Zeile koennte ein Fall
  // „Entwurf" messen und „veroeffentlicht" nennen.
  const nachher = await admin.query<{ published_at: Date | null }>(
    "select published_at from public.plan_versions where id = $1",
    [id],
  );
  expect(
    nachher.rows[0]?.published_at,
    `Planversion ${woche} ist nicht veroeffentlicht`,
  ).not.toBeNull();
  return id;
}

/** Eine Satzversion mit fester Id. `bis === null` = offenes Intervall. */
async function satzversion(
  id: string,
  orgId: string,
  employeeId: string,
  betragProStunde: bigint,
  von: string,
  bis: string | null,
): Promise<void> {
  await admin.query(
    `insert into public.employee_rate_versions
       (id, org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
        reason, created_by, correlation_id)
     values ($1, $2, $3, $4::bigint, 'EUR', $5::date, $6::date, $7, $8, $7)`,
    [id, orgId, employeeId, String(betragProStunde), von, bis, MARKE, USER_A],
  );
}

// ---------------------------------------------------------------------------
// Anfragen
// ---------------------------------------------------------------------------

interface PostOptionen {
  readonly korrelation: string;
  readonly schluessel: string;
  readonly planVersionId: string;
  readonly worksiteId?: string | null;
  readonly organisation?: string;
}

/**
 * `POST /kosten/snapshots`.
 *
 * Kein Cookie: die Identitaet entscheidet in dieser Suite der gestellte
 * `REQUEST_IDENTITY`. Ein mitgeschicktes Token liesse eine Pruefung vermuten,
 * die hier nicht stattfindet — die fuehrt `auth-journey`.
 */
function postSnapshot(optionen: PostOptionen): Anfrage {
  let anfrage = request(anwendung().getHttpServer())
    .post(`/${API_BASE_PATH}/kosten/snapshots`)
    .set(CORRELATION_ID_HEADER, optionen.korrelation)
    .set(IDEMPOTENCY_HEADER, optionen.schluessel);
  if (optionen.organisation !== undefined) {
    anfrage = anfrage.set(ORGANISATION_HEADER, optionen.organisation);
  }
  return anfrage.send({
    publishedPlanVersionId: optionen.planVersionId,
    worksiteId: optionen.worksiteId ?? null,
  });
}

function getSnapshot(snapshotId: string, korrelation: string, organisation?: string): Anfrage {
  let anfrage = request(anwendung().getHttpServer())
    .get(`/${API_BASE_PATH}/kosten/snapshots/${snapshotId}`)
    .set(CORRELATION_ID_HEADER, korrelation);
  if (organisation !== undefined) anfrage = anfrage.set(ORGANISATION_HEADER, organisation);
  return anfrage;
}

/**
 * Die drei Felder, an denen zwei Ablehnungen vergleichbar sind.
 *
 * Ohne `correlationId` und ohne `status`: die erste ist je Anfrage neu, der
 * zweite steht im Antwortobjekt und wird getrennt geprueft.
 */
function ablehnung(antwortkoerper: unknown): {
  title: unknown;
  type: unknown;
  detail: unknown;
} {
  const problem = antwortkoerper as { title?: unknown; type?: unknown; detail?: unknown };
  return { title: problem.title, type: problem.type, detail: problem.detail };
}

/**
 * Ein vertragsgueltiger Snapshot — geprueft, nicht behauptet.
 *
 * `parse` statt `safeParse` und Cast: der Rueckgabewert ist damit typisiert,
 * OHNE dass ein `as` eine Pruefung vortaeuscht, die niemand ausfuehrt.
 */
function alsSnapshot(antwortkoerper: unknown): CostSnapshot {
  return CostSnapshotSchema.parse(antwortkoerper);
}

// ---------------------------------------------------------------------------
// Aufraeumen
// ---------------------------------------------------------------------------

async function raeumeAuf(): Promise<void> {
  // Reihenfolge ist Pflicht, nicht Stil: die mandantengebundenen
  // Fremdschluessel stehen auf `on delete restrict`.
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

  // Zwei Anweisungen, und das ist kein Versehen: `predecessor_id` verweist auf
  // dieselbe Tabelle mit `on delete restrict`, und RESTRICT wird je Zeile
  // sofort geprueft. Ein einziges DELETE koennte den Vorgaenger vor seinem
  // Nachfolger treffen und scheiterte dann an einer Reihenfolge, die niemand
  // steuert.
  await admin.query(
    "delete from public.employee_rate_versions where correlation_id like $1 and predecessor_id is not null",
    [`${MARKE}%`],
  );
  await admin.query("delete from public.employee_rate_versions where correlation_id like $1", [
    `${MARKE}%`,
  ]);

  // Nur ENTWUERFE. Veroeffentlichtes ist unloeschbar (Migration 0010) — siehe
  // Kopf: deshalb liegen die Wochen dieser Suite in 2027.
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

  // Netz gegen einen Prozessabbruch mitten in `mitZweiterMitgliedschaft`. Der
  // regulaere Weg raeumt die geliehene Mitgliedschaft selbst auf; ueberlebt sie
  // den Abbruch dazwischen, misst ein spaeteres Mandantengate desselben Jobs auf
  // falschem Zustand — `tenant-pooling` erwartet fuer `USER_A` genau
  // `[ORG_ALPHA]` und ginge rot. Der Ausfall waere dann laut, aber am falschen
  // Ort. Deshalb steht der Griff HIER: er wirkt am Anfang UND am Ende des Laufs.
  await admin.query("delete from public.memberships where id = $1", [MITGLIEDSCHAFT_ZWEITE]);
}

/**
 * Leiht `USER_A` fuer die Dauer EINES Falls eine aktive `manager`-Mitgliedschaft
 * in Organisation BETA.
 *
 * `manager` und nicht `member`: die insert-Policy aus Migration 0018 verlangt
 * `app.has_permission(org_id, 'costs.calculate')`, und `member` traegt laut
 * Migration 0013 ueberhaupt kein Kostenrecht. Mit `member` maesse der Fall die
 * Rechteablehnung statt der Mandantenbindung.
 *
 * Bauart uebernommen aus `planning-published-reads.integration.test.ts`, samt
 * der beiden dort teuer gelernten Punkte:
 *
 * - `catch` statt `finally`. Ein `throw` im `finally` verwuerfe einen bereits
 *   laufenden Fehler aus dem Fall; `no-unsafe-finally` verbietet ihn.
 * - Der Fehler liegt in einem Tupel und nicht nackt in der Variablen: `fn` ist
 *   von aussen hereingereicht, und ein nacktes `let fehler: unknown = null`
 *   koennte „kein Fehler" nicht von „hat `null` geworfen" unterscheiden.
 *
 * Alle Beobachtungen laufen ueber die Verwaltungsverbindung: ueber den
 * Laufzeitkanal saehe `easytree_app` nach dem Rollenwechsel nur, was RLS
 * durchlaesst — eine Zaehlung dort belegte das Verschwinden der Zeile nicht.
 */
async function mitZweiterMitgliedschaft(fn: () => Promise<void>): Promise<void> {
  await admin.query(
    `insert into public.memberships (id, org_id, user_id, role, active)
     values ($1, $2, $3, 'manager', true)`,
    [MITGLIEDSCHAFT_ZWEITE, ORG_BETA, USER_A],
  );

  let fehlerAusFall: [unknown] | null = null;
  try {
    // Die Leihe hat gewirkt — gemessen, nicht angenommen. Ohne diese Kontrolle
    // koennte der Fall gruen sein, weil das Subjekt gar nicht mehrfach
    // organisiert war.
    const stand = await admin.query<{ role: string; active: boolean }>(
      "select role, active from public.memberships where id = $1",
      [MITGLIEDSCHAFT_ZWEITE],
    );
    expect(stand.rows[0]?.role, "die geliehene Mitgliedschaft traegt die falsche Rolle").toBe(
      "manager",
    );
    expect(stand.rows[0]?.active, "die geliehene Mitgliedschaft ist nicht aktiv").toBe(true);
    await fn();
  } catch (e) {
    fehlerAusFall = [e];
  }

  // Auch das Aufraeumen liegt in einem eigenen `try`: ohne das stiege ein Wurf
  // zwischen `fn` und dem DELETE als roher `DatabaseError` auf — ohne benannte
  // Meldung und ohne `cause`, der Fehler aus dem Fall waere verloren.
  let aufraeumen: [unknown] | null = null;
  try {
    await admin.query("delete from public.memberships where id = $1", [MITGLIEDSCHAFT_ZWEITE]);
    const rest = await zaehle("select count(*) as n from public.memberships where id = $1", [
      MITGLIEDSCHAFT_ZWEITE,
    ]);
    if (rest !== 0) {
      aufraeumen = [
        new Error(
          `das delete lief fehlerfrei, die Zeile ist danach trotzdem da (count=${String(rest)}).`,
        ),
      ];
    }
  } catch (e) {
    aufraeumen = [e];
  }

  // Vorrang fuer den gefaehrlicheren Befund: ein fehlgeschlagener Fall kostet
  // diesen Lauf, eine ueberlebende Mitgliedschaft verfaelscht spaetere
  // Mandantengates im selben Job. Verloren geht keiner von beiden.
  if (aufraeumen !== null) {
    const ursache =
      fehlerAusFall === null
        ? aufraeumen[0]
        : new AggregateError(
            [aufraeumen[0], fehlerAusFall[0]],
            "[snapshot-http] Aufraeumen UND Fall sind gescheitert (EYT-139).",
          );
    throw new Error(
      "[snapshot-http] die geliehene Mitgliedschaft ist NICHT nachweislich entfernt worden — " +
        "spaetere Mandantengates wuerden auf einem falschen Zustand messen (EYT-139).",
      { cause: ursache },
    );
  }
  if (fehlerAusFall !== null) throw fehlerAusFall[0];
}

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

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

/** Die veroeffentlichten Planversionen dieser Suite, gefuellt in `beforeAll`. */
let planErfolg = "";
let planOhneSatz = "";
let planAbloesung = "";
let planMoAlpha = "";
let planMoBeta = "";

const SCHICHT_ERFOLG_A = schicht(W_ERFOLG, 0);
const SCHICHT_ERFOLG_B = schicht(W_ERFOLG, 1);
const SCHICHT_OHNE_SATZ = schicht(W_OHNE_SATZ, 0);
const SCHICHT_ABLOESUNG = schicht(W_ABLOESUNG, 0);
const SCHICHT_MO_ALPHA = schicht(W_MO_ALPHA, 0);
const SCHICHT_MO_BETA = schicht(W_MO_BETA, 0);

beforeAll(async () => {
  if (APP_DB_URL === undefined) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        "[snapshot-http] fail-closed: EASYTREE_TEST_APP_DB_URL ist nicht gesetzt. Der " +
          "Snapshot-Schreibweg soll auf demselben Kanal gemessen werden, auf dem API und " +
          "Worker arbeiten (Loginrolle easytree_app).",
      );
    }
    console.warn("[snapshot-http.integration] SKIPPED: EASYTREE_TEST_APP_DB_URL nicht gesetzt.");
    return;
  }
  dbAvailable = (await probeDatabase(DB_URL)) && (await probeDatabase(APP_DB_URL));
  if (!dbAvailable) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        `[snapshot-http] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-139).`,
      );
    }
    console.warn(`[snapshot-http.integration] SKIPPED: Postgres unter ${DB_URL} nicht erreichbar.`);
    return;
  }

  admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  await raeumeAuf();

  // `owner` in ALPHA — und nachgesehen. Die Datenbank entscheidet ueber
  // `app.has_permission` unabhaengig von der gestellten Sitzung; ohne die Rolle
  // maesse jeder Erfolgsfall eine Ablehnung.
  await admin.query(
    "update public.memberships set role = 'owner', active = true where org_id = $1 and user_id = $2",
    [ORG_ALPHA, USER_A],
  );
  expect(
    await zaehle(
      "select count(*) as n from public.memberships where org_id = $1 and user_id = $2 and role = 'owner' and active",
      [ORG_ALPHA, USER_A],
    ),
    "USER_A ist nicht aktiver owner in ORG_ALPHA",
  ).toBe(1);

  planErfolg = await veroeffentlichterPlan(W_ERFOLG, ORG_ALPHA, [
    SCHICHT_ERFOLG_A,
    SCHICHT_ERFOLG_B,
  ]);
  planOhneSatz = await veroeffentlichterPlan(W_OHNE_SATZ, ORG_ALPHA, [SCHICHT_OHNE_SATZ]);
  planAbloesung = await veroeffentlichterPlan(W_ABLOESUNG, ORG_ALPHA, [SCHICHT_ABLOESUNG]);
  planMoAlpha = await veroeffentlichterPlan(W_MO_ALPHA, ORG_ALPHA, [SCHICHT_MO_ALPHA]);
  planMoBeta = await veroeffentlichterPlan(W_MO_BETA, ORG_BETA, [SCHICHT_MO_BETA]);

  // Die Satzlage. Bewusst mit LUECKE: `W_OHNE_SATZ` liegt zwischen den beiden
  // ALPHA-Intervallen, und genau daran haengt I5.
  await satzversion(
    SATZ_ERFOLG,
    ORG_ALPHA,
    EMPLOYEE_ALPHA,
    SATZ_PRO_STUNDE_ERFOLG,
    datumDerWoche(W_ERFOLG, 0),
    datumDerWoche(W_ERFOLG, 7),
  );
  // Offen, weil I8 sie ueber den regulaeren Abloesungspfad schliesst — der
  // verlangt einen offenen Vorgaenger (`VORGAENGER_BEREITS_GESCHLOSSEN`). Der
  // Beginn liegt eine Woche VOR dem Leistungstag, damit die Nachfolgerin
  // spaeter beginnen kann als die Vorgaengerin UND trotzdem den bereits
  // bepreisten Tag erreicht (`NACHFOLGER_NICHT_SPAETER`).
  await satzversion(
    SATZ_ABLOESUNG_V1,
    ORG_ALPHA,
    EMPLOYEE_ALPHA,
    SATZ_PRO_STUNDE_V1,
    datumDerWoche(W_ABLOESUNG, -7),
    null,
  );
  await satzversion(
    SATZ_BETA,
    ORG_BETA,
    EMPLOYEE_BETA,
    SATZ_PRO_STUNDE_BETA,
    datumDerWoche(W_MO_BETA, 0),
    null,
  );

  // Die Luecke ist gemessen, nicht gerechnet: am Leistungstag von I5 gilt
  // KEINE Satzversion. Ohne diese Zeile koennte I5 aus einem ganz anderen
  // Grund 409 antworten und trotzdem gruen aussehen.
  expect(
    await wirksameSaetze(EMPLOYEE_ALPHA, ORG_ALPHA, SCHICHT_OHNE_SATZ.ortstag),
    `am ${SCHICHT_OHNE_SATZ.ortstag} darf kein Satz gelten`,
  ).toEqual([]);
  expect(
    await wirksameSaetze(EMPLOYEE_ALPHA, ORG_ALPHA, SCHICHT_ERFOLG_A.ortstag),
    `am ${SCHICHT_ERFOLG_A.ortstag} muss genau der Erfolgssatz gelten`,
  ).toEqual([SATZ_ERFOLG]);

  // Der Laufzeitkanal — die echte Klasse, nur die Verbindung zeigt auf die
  // Testinstanz. Siehe Kopf.
  runner = PgTenantQueryRunner.fromConnection({
    databaseUrl: APP_DB_URL,
    sslRootCert: undefined,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TENANT_QUERY_RUNNER)
    .useValue(runner)
    .overrideProvider(DATABASE_PING)
    .useValue({ ping: () => Promise.resolve(true) } satisfies DatabasePing)
    .overrideProvider(REQUEST_IDENTITY)
    .useValue({
      // Liest `sitzung` bei JEDEM Aufruf — sonst truege die Anwendung das
      // Subjekt des ersten Falls in alle folgenden.
      identify: () => Promise.resolve({ userId: sitzung.userId, sessionId: "test-sitzung" }),
    })
    .overrideProvider(SESSION_ORGANISATIONS)
    .useValue({
      organisationsFor: () =>
        Promise.resolve(
          sitzung.mitgliedschaften.map((m) => ({
            organisationId: m.organisationId,
            organisationName: "Org",
            role: "owner" as const,
            permissions: m.permissions,
          })),
        ),
    })
    .compile();

  const anwendungsinstanz = moduleRef.createNestApplication();
  anwendungsinstanz.setGlobalPrefix(API_BASE_PATH);
  await anwendungsinstanz.init();
  app = anwendungsinstanz;
});

afterAll(async () => {
  if (dbAvailable) {
    // Defensiv, jede Zeile fuer sich: ein Fehler beim Aufraeumen darf die
    // Berichtszeile und `assertOrThrow()` unten nicht verdraengen.
    await app?.close().catch(() => undefined);
    await raeumeAuf().catch(() => undefined);
    await runner?.close().catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  app = null;
  process.stdout.write(gate.reportLine());
  gate.assertOrThrow();
});

describe("Die Snapshot-HTTP-Naht gegen echtes PostgreSQL (EYT-139)", () => {
  /**
   * Der Kanal gehoert gemessen, nicht angenommen.
   *
   * Gefragt wird DER Runner, den das `AppModule` benutzt — dieselbe Instanz.
   * Ohne diese Aussage koennte `EASYTREE_TEST_APP_DB_URL` unbemerkt auf
   * `postgres` zeigen, und jede Mandantenaussage dieser Datei waere wertlos:
   * `postgres` traegt BYPASSRLS.
   */
  dbIt(
    "I0 — die Anwendung schreibt auf dem Laufzeitkanal, nicht auf der Verwaltungsverbindung",
    async () => {
      const gemessen = await laufzeitkanal().run({ userId: USER_A }, async (tx) => {
        const zeile = await tx.query<{ session_user: string; current_user: string }>(
          "select session_user, current_user",
        );
        return zeile.rows[0];
      });

      expect(gemessen?.session_user).toBe(LAUFZEITROLLE);
      expect(gemessen?.current_user).toBe("authenticated");
    },
  );

  // -------------------------------------------------------------------------
  dbIt("I1 — POST schreibt genau einen Snapshot mit seinen Positionen", async () => {
    const korrelation = `${MARKE}-i1`;
    const vorher = await alleKoepfeDieserSuite();

    const antwort = await postSnapshot({
      korrelation,
      schluessel: `${MARKE}-i1`,
      planVersionId: planErfolg,
    });
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);

    // Zustand unmittelbar nach dem Schreiben, ueber die Beobachterverbindung.
    const gespeichert = alsSnapshot(antwort.body);
    expect(await koepfeMitKorrelation(korrelation)).toBe(1);
    expect(await positionenVon(gespeichert.id)).toBe(2);
    expect(await alleKoepfeDieserSuite()).toBe(vorher + 1);
    expect(await organisationVon(gespeichert.id)).toBe(ORG_ALPHA);

    // Der Kopf stammt aus der Planung, nicht aus der Anfrage: der Rumpf trug
    // nur `publishedPlanVersionId` und `worksiteId`.
    expect(gespeichert.planVersionId).toBe(planErfolg);
    expect(gespeichert.weekKey).toBe(W_ERFOLG);
    expect(gespeichert.timeZone).toBe("Europe/Berlin");
    expect(gespeichert.worksiteId).toBeNull();
    expect(gespeichert.correlationId).toBe(korrelation);
    // `created_by` kommt aus `app.current_user_id()`, nicht aus der Eingabe —
    // die insert-Policy aus 0018 verlangt `created_by = auth.uid()`. Die
    // Anfrage nennt das Subjekt nirgends.
    expect(gespeichert.createdBy).toBe(USER_A);

    // Die Positionen: zwei Ortstage, aufsteigend, mit den Betraegen, die die
    // echte Satzversion ergibt.
    expect(gespeichert.positions.map((p) => p.localDate)).toEqual([
      SCHICHT_ERFOLG_A.ortstag,
      SCHICHT_ERFOLG_B.ortstag,
    ]);
    for (const position of gespeichert.positions) {
      expect(position.employeeId).toBe(EMPLOYEE_ALPHA);
      expect(position.worksiteId).toBe(WORKSITE_ALPHA);
      expect(position.rateVersionId).toBe(SATZ_ERFOLG);
      expect(position.durationMilliseconds).toBe(String(SCHICHT_MS));
      expect(position.amountMinorUnits).toBe(String(BETRAG_ERFOLG_JE_TAG));
    }
    expect(gespeichert.totalMinorUnits).toBe(String(BETRAG_ERFOLG_JE_TAG * 2n));
    expect(gespeichert.days).toEqual([
      { localDate: SCHICHT_ERFOLG_A.ortstag, amountMinorUnits: String(BETRAG_ERFOLG_JE_TAG) },
      { localDate: SCHICHT_ERFOLG_B.ortstag, amountMinorUnits: String(BETRAG_ERFOLG_JE_TAG) },
    ]);
  });

  // -------------------------------------------------------------------------
  /**
   * Der echte Idempotenznachweis.
   *
   * Der Nahttest misst die Wiederholung gegen ein Repository, das auf jeden
   * Aufruf dieselbe Id antwortet — er kann per Konstruktion nicht sehen, ob
   * eine zweite ZEILE entstanden ist. Hier zaehlt die Datenbank.
   */
  dbIt("I2 — Retry mit gleichem Schluessel legt keinen zweiten Snapshot an", async () => {
    const korrelation = `${MARKE}-i2`;
    const schluessel = `${MARKE}-i2`;

    const erst = await postSnapshot({ korrelation, schluessel, planVersionId: planErfolg });
    expect(erst.status, JSON.stringify(erst.body)).toBe(201);
    const zuerst = alsSnapshot(erst.body);
    expect(await koepfeMitKorrelation(korrelation)).toBe(1);
    const nachErstem = await alleKoepfeDieserSuite();

    // Ein echter Retry traegt eine ANDERE Korrelations-Id — sie gehoert
    // deshalb nicht zum Fingerabdruck der Anfrage.
    const wiederholung = `${korrelation}-retry`;
    const wieder = await postSnapshot({
      korrelation: wiederholung,
      schluessel,
      planVersionId: planErfolg,
    });
    expect(wieder.status, JSON.stringify(wieder.body)).toBe(201);
    const nochmal = alsSnapshot(wieder.body);

    // Zustand unmittelbar nach DIESEM Versuch: keine zweite Zeile, weder unter
    // der alten noch unter der neuen Korrelations-Id.
    expect(await koepfeMitKorrelation(korrelation)).toBe(1);
    expect(await koepfeMitKorrelation(wiederholung)).toBe(0);
    expect(await alleKoepfeDieserSuite()).toBe(nachErstem);
    expect(await positionenVon(zuerst.id)).toBe(2);

    // Dieselbe gespeicherte Wahrheit, nicht dieselbe Frage noch einmal.
    expect(nochmal.id).toBe(zuerst.id);
    expect(nochmal.createdAt).toBe(zuerst.createdAt);
    expect(nochmal.correlationId).toBe(korrelation);
    expect(nochmal).toEqual(zuerst);
  });

  // -------------------------------------------------------------------------
  /**
   * Ein Montagefehler hinterlaesst KEINE Zeile.
   *
   * Der Nahttest zaehlt an dieser Stelle Stubaufrufe; ob die Transaktion
   * zurueckgerollt haette, sagt ihm niemand. Ein Snapshot laesst sich nicht
   * loeschen (Migration 0018, weder update- noch delete-Grant) — was hier
   * committet waere, bliebe fuer immer.
   */
  dbIt("I5 — fehlender Satz hinterlaesst keine Zeile", async () => {
    const korrelation = `${MARKE}-i5`;
    const vorher = await alleKoepfeDieserSuite();

    const antwort = await postSnapshot({
      korrelation,
      schluessel: `${MARKE}-i5`,
      planVersionId: planOhneSatz,
    });

    expect(antwort.status, JSON.stringify(antwort.body)).toBe(409);
    expect(ablehnung(antwort.body).type).toBe(SNAPSHOT_ASSEMBLY_ERROR_TYPE.RATE_NOT_FOUND);

    // Zustand unmittelbar nach DIESEM Versuch — beide Zaehlungen einzeln:
    // die eine belegt „nichts unter dieser Korrelations-Id", die andere
    // „nichts unter irgendeiner anderen".
    expect(await koepfeMitKorrelation(korrelation)).toBe(0);
    expect(await alleKoepfeDieserSuite()).toBe(vorher);

    // Und die Vorbedingung gilt weiterhin: der Plan IST veroeffentlicht und
    // traegt seine Zuweisung. Ohne diese Zeile koennte der 409 auch aus einer
    // kaputten Fixture stammen.
    expect(
      await zaehle(
        "select count(*) as n from public.assignments where plan_version_id = $1 and published_at is not null",
        [planOhneSatz],
      ),
    ).toBe(1);
  });

  // -------------------------------------------------------------------------
  /**
   * Ein Snapshot ist ein Dokument, kein Cache.
   *
   * Der scharfe Teil ist die RUECKWIRKEND wirksame Nachfolgerin: sie gilt AB
   * dem Leistungstag, den der gespeicherte Snapshot bereits bepreist hat. Eine
   * erst danach beginnende Version veraenderte eine Neuberechnung gar nicht und
   * unterschiede „Snapshot" deshalb nicht von „Cache".
   */
  dbIt(
    "I8 — eine spaetere Satzversion laesst den gespeicherten Snapshot unveraendert",
    async () => {
      const korrelation = `${MARKE}-i8`;
      const tag = SCHICHT_ABLOESUNG.ortstag;

      // Vorbedingung, gemessen: am Leistungstag gilt genau V1.
      expect(await wirksameSaetze(EMPLOYEE_ALPHA, ORG_ALPHA, tag)).toEqual([SATZ_ABLOESUNG_V1]);

      const erzeugt = await postSnapshot({
        korrelation,
        schluessel: `${MARKE}-i8`,
        planVersionId: planAbloesung,
      });
      expect(erzeugt.status, JSON.stringify(erzeugt.body)).toBe(201);
      const beimAnlegen = alsSnapshot(erzeugt.body);
      expect(await koepfeMitKorrelation(korrelation)).toBe(1);
      expect(beimAnlegen.positions.map((p) => p.rateVersionId)).toEqual([SATZ_ABLOESUNG_V1]);

      // Der regulaere EYT-108-Abloesungspfad — ueber HTTP, nicht per SQL: was
      // die Betreiberin in der Oberflaeche tut, tut dieser Aufruf auch.
      const abgeloest = await request(anwendung().getHttpServer())
        .post(`/${API_BASE_PATH}/kosten/stundensaetze`)
        .set(CORRELATION_ID_HEADER, `${MARKE}-i8-satz`)
        .set(IDEMPOTENCY_HEADER, `${MARKE}-i8-satz`)
        .send({
          employeeId: EMPLOYEE_ALPHA,
          amountMinorUnits: String(SATZ_PRO_STUNDE_V2),
          currency: "EUR",
          validFrom: tag,
          validTo: null,
          reason: MARKE,
          expectedActiveVersionId: SATZ_ABLOESUNG_V1,
        });
      expect(abgeloest.status, JSON.stringify(abgeloest.body)).toBe(201);
      const v2 = RateVersionDtoSchema.parse(abgeloest.body);

      // Der Angriffsschritt hat gewirkt — gemessen, nicht angenommen: am
      // Leistungstag gilt jetzt V2 und NICHT mehr V1. Genau das ist der
      // Unterschied, den eine Neuberechnung zeigen wuerde.
      expect(await wirksameSaetze(EMPLOYEE_ALPHA, ORG_ALPHA, tag)).toEqual([v2.id]);
      expect(v2.id).not.toBe(SATZ_ABLOESUNG_V1);
      expect(v2.predecessorId).toBe(SATZ_ABLOESUNG_V1);
      // Und der neue Satz traegt einen ANDEREN Betrag. Ohne diese Zeile koennte
      // V2 denselben Wert wie V1 tragen — dann saehe auch eine Neuberechnung
      // gleich aus, und der Fall bewiese nichts.
      expect(v2.amountMinorUnits).toBe(String(SATZ_PRO_STUNDE_V2));
      expect(v2.amountMinorUnits).not.toBe(String(SATZ_PRO_STUNDE_V1));

      // Und der gespeicherte Stand ueber HTTP, feldweise unveraendert.
      const gelesen = await getSnapshot(beimAnlegen.id, `${MARKE}-i8-lesen`);
      expect(gelesen.status, JSON.stringify(gelesen.body)).toBe(200);
      const danach = alsSnapshot(gelesen.body);

      expect(danach.id).toBe(beimAnlegen.id);
      expect(danach.createdAt).toBe(beimAnlegen.createdAt);
      expect(danach.totalMinorUnits).toBe(beimAnlegen.totalMinorUnits);
      expect(danach.positions.map((p) => p.id)).toEqual(beimAnlegen.positions.map((p) => p.id));
      expect(danach.positions.map((p) => p.rateVersionId)).toEqual([SATZ_ABLOESUNG_V1]);
      expect(danach.positions.map((p) => p.rateVersionId)).not.toContain(v2.id);
      expect(danach.positions.map((p) => p.amountMinorUnits)).toEqual(
        beimAnlegen.positions.map((p) => p.amountMinorUnits),
      );
      // Der Vollvergleich zuletzt: er faengt auch ein Feld, das oben niemand
      // einzeln genannt hat.
      expect(danach).toEqual(beimAnlegen);

      // Und es ist dabei kein zweiter Snapshot entstanden.
      expect(await koepfeMitKorrelation(korrelation)).toBe(1);
    },
  );

  // -------------------------------------------------------------------------
  /**
   * Die Mandantengrenze entsteht in RLS, nicht im Anwendungscode.
   *
   * Der Nahttest bliebe gruen, wenn die Datenbank jedem alles zeigte: sein
   * Repository antwortet, was der Stub hergibt.
   */
  dbIt("I9 — die Id eines fremden Snapshots antwortet wie eine unbekannte", async () => {
    const korrelation = `${MARKE}-i9`;
    const erzeugt = await postSnapshot({
      korrelation,
      schluessel: `${MARKE}-i9`,
      planVersionId: planErfolg,
    });
    expect(erzeugt.status, JSON.stringify(erzeugt.body)).toBe(201);
    const inAlpha = alsSnapshot(erzeugt.body);

    // Die Zeile EXISTIERT und gehoert ALPHA. Ohne diese Beobachtung waere
    // „nicht sichtbar" von „nicht vorhanden" nicht zu trennen, und der Fall
    // bewiese nichts.
    expect(await koepfeMitKorrelation(korrelation)).toBe(1);
    expect(await organisationVon(inAlpha.id)).toBe(ORG_ALPHA);

    await alsSitzung(
      {
        userId: USER_B,
        mitgliedschaften: [{ organisationId: ORG_BETA, permissions: ["costs.read"] }],
      },
      async () => {
        const fremd = await getSnapshot(inAlpha.id, `${MARKE}-i9-fremd`);
        const unbekannt = await getSnapshot(ID_ERFUNDEN, `${MARKE}-i9-unbekannt`);

        expect(fremd.status, JSON.stringify(fremd.body)).toBe(403);
        expect(ablehnung(fremd.body).type).toBe(SNAPSHOT_READ_ERROR_TYPE.SNAPSHOT_NOT_FOUND);

        // Der Kern: BEIDE Antworten sind identisch. Waeren sie es nicht,
        // verriete die Antwort, welche fremden Ids echt sind.
        expect(fremd.status).toBe(unbekannt.status);
        expect(ablehnung(fremd.body)).toEqual(ablehnung(unbekannt.body));
      },
    );

    // Und der positive Anker: dieselbe Id ist fuer ihre eigene Organisation
    // weiterhin lesbar. Ohne ihn haetten beide Ablehnungen auch dann
    // uebereingestimmt, wenn die Leseroute jede Id ablehnte.
    const eigene = await getSnapshot(inAlpha.id, `${MARKE}-i9-eigen`);
    expect(eigene.status, JSON.stringify(eigene.body)).toBe(200);
    expect(alsSnapshot(eigene.body).id).toBe(inAlpha.id);
  });

  // -------------------------------------------------------------------------
  /**
   * Der Mandant der Rechnung, gegen echtes RLS statt gegen Attrappen.
   *
   * Das Subjekt ist fuer die Dauer dieses Falls WIRKLICH mehrfach
   * organisatorisch — in der gestellten Sitzung UND in `public.memberships`,
   * aus der `app.user_org_ids()` liest. Ohne die zweite Haelfte pruefte der
   * Fall nur die Anwendungsschicht.
   */
  dbIt("I11 — ein Snapshot in Organisation B enthaelt keine Zeile aus Organisation A", async () => {
    const korrelation = `${MARKE}-i11`;

    // Beobachtung gegen Vacuitaet: in A gibt es einen veroeffentlichten Plan
    // MIT Zuweisung. Der Fall waehlt B nicht mangels Alternative.
    expect(
      await zaehle(
        "select count(*) as n from public.assignments where plan_version_id = $1 and published_at is not null",
        [planMoAlpha],
      ),
    ).toBe(1);

    await mitZweiterMitgliedschaft(async () => {
      await alsSitzung(
        {
          userId: USER_A,
          mitgliedschaften: [
            { organisationId: ORG_ALPHA, permissions: RECHTE_ALPHA },
            { organisationId: ORG_BETA, permissions: ["costs.read", "costs.calculate"] },
          ],
        },
        async () => {
          const antwort = await postSnapshot({
            korrelation,
            schluessel: `${MARKE}-i11`,
            planVersionId: planMoBeta,
            organisation: ORG_BETA,
          });
          expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
          const inBeta = alsSnapshot(antwort.body);

          // Der Kopf gehoert B — gemessen an der Zeile, nicht an der Antwort.
          expect(await organisationVon(inBeta.id)).toBe(ORG_BETA);
          expect(await koepfeMitKorrelation(korrelation)).toBe(1);

          // Die Woche ist B's, nicht A's. Beide Wochen sind verschieden, damit
          // dieses Feld ueberhaupt etwas aussagen kann.
          expect(inBeta.planVersionId).toBe(planMoBeta);
          expect(inBeta.weekKey).toBe(W_MO_BETA);
          expect(inBeta.weekKey).not.toBe(W_MO_ALPHA);

          // Und JEDE Position traegt ausschliesslich B-Bezuege.
          expect(inBeta.positions).toHaveLength(1);
          for (const position of inBeta.positions) {
            expect(position.employeeId).toBe(EMPLOYEE_BETA);
            expect(position.worksiteId).toBe(WORKSITE_BETA);
            expect(position.rateVersionId).toBe(SATZ_BETA);
            expect(position.employeeId).not.toBe(EMPLOYEE_ALPHA);
            expect(position.worksiteId).not.toBe(WORKSITE_ALPHA);
          }

          // Gegenprobe auf derselben Sitzung: an A gebunden ist B's Version
          // unauffindbar. Erst zusammen belegen beide Richtungen, dass nicht
          // schlicht die erste sichtbare Organisation genommen wird.
          const querzugriff = await postSnapshot({
            korrelation: `${korrelation}-quer`,
            schluessel: `${MARKE}-i11-quer`,
            planVersionId: planMoBeta,
            organisation: ORG_ALPHA,
          });
          expect(querzugriff.status, JSON.stringify(querzugriff.body)).toBe(400);
          expect(ablehnung(querzugriff.body).type).toBe(COSTS_ERROR_TYPE.PLAN_VERSION_NOT_FOUND);
          expect(await koepfeMitKorrelation(`${korrelation}-quer`)).toBe(0);
        },
      );
    });

    // Zustand nach dem Fall: die Zeilenzahl ist unveraendert die eine.
    expect(await koepfeMitKorrelation(korrelation)).toBe(1);
  });
});
