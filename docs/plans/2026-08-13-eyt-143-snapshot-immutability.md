# EYT-143 — Historischen Kosten-Snapshot gegen spätere Satzversionen unveränderlich nachweisen

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Beweisen — gegen echtes PostgreSQL, fail-closed in `db-gates` — dass ein bereits
gespeicherter Kosten-Snapshot unverändert bleibt, wenn danach eine rückwirkend wirksame
Satzversion V2 entsteht, und dass genau dieser Nachweis rot wird, wenn der Lesepfad aus
aktuellen Sätzen nachrechnet.

**Architecture:** Eine neue, enge Integrationssuite an der **Persistenznaht**
(`PgCostSnapshotRepository`), nicht an der HTTP-Naht. Zwei Verbindungen wie in allen
Kosten-Suiten: `EASYTREE_TEST_APP_DB_URL` (Laufzeitkanal `easytree_app`) für das Repository,
`EASYTREE_TEST_DB_URL` (`postgres`) als Beobachter. Ein zusätzlicher Schritt im **bestehenden**
Job `db-gates` — kein neuer Pflichtcheck. Danach eine AUSGEFÜHRTE Gegenmutation auf einem
Wegwerf-PR.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`), Vitest + SWC, `pg`, Supabase-Postgres,
GitHub Actions.

---

## Ausgangslage — gemessen, nicht angenommen

| Fakt                    | Messung                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| PR #69                  | `gh pr view 69` → OPEN, `isDraft: true`, base `master`, head `17fa7cc00827aa75d74d0c396ef7e845a5564e49`                      |
| Arbeitsstand            | Worktree `…/scratchpad/eyt143-wt`, detached auf `17fa7cc`                                                                    |
| Lokaler Branchzeiger    | `feat/eyt-109-daily-plan-cost-snapshot` steht auf `b8a96a9`, **19 Commits hinter** dem PR-Head. Nicht als Referenz benutzen. |
| Docker/PostgreSQL lokal | **Nicht verfügbar** (siehe `docs/…`, Sprint-5-Erfahrung). Lokale Läufe dieser Suite sind Skips und **kein** Nachweis.        |

### Der entscheidende Befund

**Das EYT-143-Szenario existiert bereits** — als Fall `I8` in
`apps/api/test/costs/snapshot-http.integration.test.ts:1068-1138`, geliefert mit EYT-139, und er
läuft bereits fail-closed im Schritt „Snapshot-HTTP-Naht" (`.github/workflows/ci.yml:423-431`).

Abgleich gegen die Akzeptanzkriterien von EYT-143:

| AK                                                        | Bereits gedeckt durch I8?                                                                       | Fundstelle                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Snapshot unter gültiger V1 real erzeugt                   | ja                                                                                              | `:1075` Vorbedingung `wirksameSaetze(...) == [V1]`, `:1085` Positionen tragen V1 |
| Snapshot persistiert                                      | ja                                                                                              | `:1084` `koepfeMitKorrelation(...) === 1`                                        |
| Spätere gültige V2 mit abweichendem Satz                  | ja                                                                                              | `:1089-1101` über die echte EYT-108-Route, `:1114-1115` abweichender Betrag      |
| Aktuelle Satzauflösung sieht V2                           | ja                                                                                              | `:1108` `wirksameSaetze(...) == [v2.id]`                                         |
| Gelesener Snapshot behält `rateVersionId`, Beträge, Summe | ja                                                                                              | `:1122-1130`                                                                     |
| Positionen/Metadaten nicht aus V2 neu aufgebaut           | **teilweise** — nur die ANTWORT wird verglichen (`:1133` `toEqual`), nie die gespeicherte Zeile | —                                                                                |
| Kompilierende Gegenmutation macht den Test rot            | **nein**                                                                                        | Datei-Kopf `:90` sagt wörtlich „Gegenmutationen — BENANNT, nicht ausgeführt"     |

**Daraus folgt der Zuschnitt dieses Plans.** Er baut kein zweites I8. Er schließt genau die zwei
offenen Hälften:

1. **Die gespeicherte Zeile selbst.** I8 beobachtet ausschließlich die Leseausgabe. Ein Defekt,
   der die gespeicherten Zeilen umschreibt UND sie konsistent zurückliest, lässt I8 grün. Nur eine
   Beobachtung über die `postgres`-Verbindung — dieselben Spaltenwerte vor und nach V2 — trifft
   diese Aussage. Dazu die strukturelle Begründung: `easytree_app` hat auf
   `cost_snapshot_positions` gar kein `update`-Recht (`has_table_privilege`), denn nach
   Memory-Regel ist SQLSTATE 42501 mehrdeutig und ein Verhaltensfall allein sagt nicht, welcher
   Riegel hielt.
2. **Die AUSGEFÜHRTE Gegenmutation.** Die in `snapshot-http.integration.test.ts:102-106` benannte
   Mutation wird eingespielt, in `db-gates` gemessen, und zurückgenommen.

Zusätzlich misst die neue Suite die aktuelle Satzauflösung über den **Produktionspfad**
(`PgRateRepository.versionsFor` + `effectiveRateVersion`), während I8 dafür rohes Admin-SQL
benutzt (`wirksameSaetze`, `:388-403`). Das ist die strengere Form derselben Nicht-Tautologie-Zusage.

### Was ausdrücklich NICHT passiert

Keine Migration, keine RLS-Änderung, keine neue Geschäftsregel, kein Refactor des Repositories,
keine UI, kein EYT-110, kein Merge, kein Ready-for-review, keine Jira-Änderung, kein Task 15.
Produktionscode wird **nur** temporär für die Gegenmutation berührt und vollständig zurückgenommen.

---

## Task 1: Die neue Suite anlegen (roter Rahmen zuerst)

**Files:**

- Create: `apps/api/test/costs/snapshot-immutability.integration.test.ts`

**Kontext, den du für diese Datei brauchst:**

- Vorlage für Bauart, Fixtures und Aufräumen: `apps/api/test/costs/cost-snapshot.integration.test.ts`
  (insbesondere `runnerAuf`, `neueVerbindung`, `neueAdminVerbindung`, `dbIt`, `raeumeAuf`).
- Vorlage für die Satzablösung über den Produktionspfad:
  `apps/api/test/costs/rate-succession.integration.test.ts:110-130`.
- `FailClosedGate`, `probeDatabase`, `ORG_ALPHA`, `USER_A` kommen aus `../tenant-context.helper`.
- Importe ins Kostenmodul **ausschließlich über die Modulwurzel** `../../src/modules/costs` —
  ein tiefer Pfad fällt am Wächter `costs-cross-module-public-api-only`, auch aus einem Test.

**Step 1: Datei mit Kopf, Konstanten und Rahmen schreiben**

```typescript
/**
 * Ein gespeicherter Snapshot ueberlebt eine RUECKWIRKEND wirksame Satzversion
 * (EYT-143, EYT-109 Task 14).
 *
 * ## Warum es diese Datei zusaetzlich zu I8 gibt
 *
 * `snapshot-http.integration.test.ts::I8` misst dasselbe Szenario an der
 * HTTP-Naht und misst es gut. Zwei Aussagen kann er aus Bauart nicht treffen,
 * und genau die stehen hier:
 *
 *  1. I8 beobachtet ausschliesslich die LESEAUSGABE. Ein Defekt, der die
 *     gespeicherten Zeilen umschriebe UND sie konsistent zurueckliese, liesse
 *     ihn gruen. Diese Suite vergleicht die Zeilen SELBST — dieselben Spalten
 *     vor und nach der Abloesung, gelesen ueber die Beobachterverbindung.
 *  2. I8 belegt die aktuelle Satzauflage mit rohem Admin-SQL. Diese Suite fragt
 *     den PRODUKTIONSPFAD: `PgRateRepository.versionsFor` plus
 *     `effectiveRateVersion` — dieselbe Auswahl, die die Montage benutzt. Ein
 *     Defekt in der Satzauswahl waere unter rohem SQL unsichtbar.
 *
 * Und sie misst an der PERSISTENZNAHT, nicht ueber HTTP: `read()` direkt, ohne
 * Controller, Filter und DTO dazwischen.
 *
 * ## Zwei Verbindungen, und warum
 *
 * `EASYTREE_TEST_APP_DB_URL` ist der LAUFZEITKANAL (`easytree_app`) — dieselbe
 * Loginrolle wie API und Worker; nur dort darf geschrieben werden (Migration
 * 0018 verlangt `app.is_runtime_channel()`). `EASYTREE_TEST_DB_URL` ist die
 * Verwaltungs- und BEOBACHTERverbindung (`postgres`).
 *
 * Beobachtungen laufen NIE ueber den Laufzeitkanal. `easytree_app` ist NOINHERIT
 * und saehe nach `set local role authenticated` nur, was RLS durchlaesst — eine
 * Zaehlung dort koennte gerade das nicht sehen, dessen Abwesenheit sie belegen
 * soll, und scheiterte ausserdem an fehlenden Rechten (42501).
 *
 * ## Warum eigene Person und eigene Jahre
 *
 * `effectiveRateVersion` antwortet RATE_AMBIGUOUS, sobald zwei Versionen am
 * selben Tag gelten. Teilte diese Suite die Person mit einer anderen, entschiede
 * die Laufreihenfolge ueber das Ergebnis — der Fall waere rot aus dem falschen
 * Grund (gemessen in EYT-108, CI-Lauf 30773551669). Eigene Person, eigene Ids,
 * eigene Jahre.
 *
 * ## Fail-closed
 *
 * Modus aus `EASYTREE_TENANT_TESTS`. In CI (`required`) ist eine unerreichbare
 * Datenbank ein Fehler, kein Skip. Jeder Lauf schreibt eine greppbare Zeile, die
 * `scripts/assert-tenant-report.sh` auswertet.
 *
 * ## Gegenmutation — AUSGEFUEHRT, nicht nur benannt
 *
 * In `cost-snapshot-repository.pg.ts::read` die Positionsabfrage um einen
 * `left join public.employee_rate_versions` erweitern und `rate_version_id` wie
 * `amount_minor_units` aus dem am Leistungstag WIRKSAMEN Satz ermitteln statt
 * sie zu lesen. Sie kompiliert (die Zeilenform bleibt `PositionsZeile`) und
 * faellt an keinem Waechter: `employee_rate_versions` gehoert dem Kostenmodul
 * selbst, `costs-touches-only-own-tables` sieht sie als erlaubt an. Ergebnis und
 * Laufnummer stehen in `docs/plans/2026-08-13-eyt-143-snapshot-immutability.md`.
 */
import { Client } from "pg";
import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COST_RULE_VERSION } from "@easytree/domain";

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

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("snapshot-immutability", TENANT_TESTS_MODE, "EYT-143");

/** Marke, an der der Aufraeumschritt die Zeilen dieser Suite erkennt. */
const MARKE = "snapshot-immutability-integration";

/** Eigene Person dieser Suite — siehe Kopf, Abschnitt „eigene Person". */
const EMPLOYEE = "00000000-0000-4000-8000-000000401431";
/** Baustelle aus `supabase/seed.sql` (Org ALPHA). */
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";
/** Feste Id der Ausgangsversion — ein roter Lauf soll wiederholbar sein. */
const SATZ_V1 = "00000000-0000-4000-8000-0000006d1431";

/**
 * Der Leistungstag, den der Snapshot bepreist.
 *
 * V2 beginnt GENAU an diesem Tag. Das ist der scharfe Teil: eine erst danach
 * beginnende Version veraenderte eine Neuberechnung gar nicht und unterschiede
 * „Snapshot" deshalb nicht von „Cache".
 */
const LEISTUNGSTAG = "2029-03-15";
const V1_AB = "2029-01-01";

/** Acht Stunden. */
const SCHICHT_MS = 28_800_000n;
/** Deutlich verschieden — sonst saehe eine Neuberechnung dieselbe Zahl. */
const SATZ_V1_PRO_STUNDE = 2_500n;
const SATZ_V2_PRO_STUNDE = 9_900n;
const BETRAG_V1 = (SATZ_V1_PRO_STUNDE * SCHICHT_MS) / 3_600_000n;

/**
 * Ohne Fremdschluessel auf `plan_versions` (Migration 0018) genuegt hier eine
 * Id, die niemand vergeben hat — ein historisches Dokument soll die Planung
 * weder festhalten noch mit ihr verschwinden.
 */
const PLANVERSION = "00000000-0000-4000-8000-00000000f143";
const WOCHE = "2029-W11";

let dbAvailable = false;
let admin: Client;
const clients: Client[] = [];
```

**Step 2: Infrastruktur-Helfer ergänzen** (wörtlich übernommen aus
`cost-snapshot.integration.test.ts:129-178` — dieselbe Bauart, damit beide Suiten nicht
auseinanderlaufen)

```typescript
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
 */
async function gespeichertePositionen(snapshotId: string): Promise<readonly unknown[]> {
  const ergebnis = await admin.query(
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
  const ergebnis = await admin.query(
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
 * Die am Leistungstag wirksame Satzversion — ueber den PRODUKTIONSPFAD.
 *
 * `versionsFor` liest ueber den Laufzeitkanal und RLS, `effectiveRateVersion`
 * ist dieselbe reine Auswahl, die die Montage benutzt. Rohes SQL waere die
 * schwaechere Aussage: es kaeme an einem Defekt in der Auswahl vorbei.
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
      ctx.skip(`SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar.`);
      return;
    }
    await gate.run(fn);
  });
}
```

**Step 3: Fixtures, Aufräumen und Lebenszyklus**

```typescript
async function raeumeAuf(): Promise<void> {
  // Reihenfolge nach Fremdschluesseln: Positionen zuerst (FK auf den Kopf steht
  // auf `on delete restrict`), Saetze vor der Person (dito).
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

  // Vorbedingung, nicht Zusicherung: Fixtures entstehen an RLS vorbei.
  await admin.query(
    `insert into public.employees (id, org_id, user_id, display_name, active)
     values ($1::uuid, $2::uuid, null, $3, true)`,
    [EMPLOYEE, ORG_ALPHA, `${MARKE}-person`],
  );
  await admin.query(
    `insert into public.employee_rate_versions
       (id, org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
        reason, created_by, correlation_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4, 'EUR', $5::date, null, $6, $7::uuid, $8)`,
    [SATZ_V1, ORG_ALPHA, EMPLOYEE, String(SATZ_V1_PRO_STUNDE), V1_AB, `${MARKE}-v1`, USER_A, MARKE],
  );
  // Ohne `owner` scheiterte die Abloesung an RLS statt an dem, was sie messen
  // soll — sie waere rot aus dem falschen Grund.
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
```

**Step 4: Format prüfen und committen** (noch ohne Fälle — der Rahmen muss allein sauber sein)

Run:

```bash
cd apps/api && pnpm exec prettier --check test/costs/snapshot-immutability.integration.test.ts
```

Expected: `All matched files use Prettier code style!` — sonst `--write` und erneut prüfen.

```bash
git add apps/api/test/costs/snapshot-immutability.integration.test.ts
git commit -m "test(costs): EYT-143 — Rahmen der Immutabilitaetssuite an den Laufzeitkanal binden"
```

---

## Task 2: Der Nachweisfall

**Files:**

- Modify: `apps/api/test/costs/snapshot-immutability.integration.test.ts` (anhängen)

**Step 1: Den Fall schreiben**

```typescript
describe("Ein gespeicherter Snapshot ueberlebt eine spaetere Satzversion (EYT-143)", () => {
  dbIt("eine rueckwirkend wirksame V2 laesst Zeile, Antwort und Summe unveraendert", async () => {
    const schreibkanal = await neueVerbindung();
    const lesekanal = await neueVerbindung();

    // --- Vorbedingung: am Leistungstag gilt GENAU V1, ueber den Produktionspfad
    expect(await wirksamerSatzId(lesekanal, LEISTUNGSTAG)).toBe(SATZ_V1);

    // --- 1. Der Snapshot entsteht unter V1
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
    //     Keine neue Regel, kein SQL an der Anwendung vorbei: `append` ist
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

    // --- 3. Der Angriffsschritt hat GEWIRKT — die Nicht-Tautologie-Zusage.
    //     Ohne diese drei Zeilen bewiese der Fall nur, dass ein unveraenderter
    //     Zustand unveraendert bleibt.
    expect(v2.id).not.toBe(SATZ_V1);
    expect(v2.amountMinorUnits).toBe(String(SATZ_V2_PRO_STUNDE));
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

  dbIt("dem Laufzeitkanal fehlt jedes Recht, eine gespeicherte Position zu aendern", async () => {
    // Der Verhaltensfall oben zeigt, dass NICHTS die Zeilen umgeschrieben hat.
    // Er sagt nicht, WARUM. SQLSTATE 42501 ist mehrdeutig — fehlendes
    // Spaltenrecht ODER RLS-Verstoss —, deshalb hier die strukturelle Aussage
    // daneben: es gibt gar kein Recht, das ein Umschreiben erlaubte.
    const rechte = await admin.query<{ upd: boolean; del: boolean }>(
      `select has_table_privilege('easytree_app', 'public.cost_snapshot_positions', 'update') as upd,
              has_table_privilege('easytree_app', 'public.cost_snapshot_positions', 'delete') as del`,
    );
    expect(rechte.rows[0]?.upd).toBe(false);
    expect(rechte.rows[0]?.del).toBe(false);

    const kopfrechte = await admin.query<{ upd: boolean; del: boolean }>(
      `select has_table_privilege('easytree_app', 'public.cost_snapshots', 'update') as upd,
              has_table_privilege('easytree_app', 'public.cost_snapshots', 'delete') as del`,
    );
    expect(kopfrechte.rows[0]?.upd).toBe(false);
    expect(kopfrechte.rows[0]?.del).toBe(false);
  });
});
```

**Step 2: Typprüfung**

`test/`-Dateien liegen im `tsconfig` von `apps/api`; `typecheck` hängt an `^build`.

Run:

```bash
pnpm --filter @easytree/contracts build && pnpm --filter @easytree/domain build && pnpm --filter @easytree/config build
pnpm --filter @easytree/api typecheck
```

Expected: exit 0, keine Ausgabe.

> **Falle, gemessen (Memory `api-tests-read-stale-contracts-dist`):** `noEmitOnError` ist nirgends
> gesetzt. Ein roter Build hinterlässt ein benutzbares altes `dist/`. Lies die Ausgabe des
> Build-Schritts, verlass dich nicht auf den Exit-Code der Kette.

**Step 3: Lokaler Lauf — und was er NICHT beweist**

Run:

```bash
pnpm --filter @easytree/api exec vitest run test/costs/snapshot-immutability.integration.test.ts
```

Expected auf dieser Maschine: **Skips**, `[snapshot-immutability] mode=local executed=0 skipped=2`
(oder ähnlich), weil kein Docker läuft. Das ist **kein** Nachweis und wird als solcher auch nicht
gemeldet. Prüfe hier nur zweierlei: dass die Datei überhaupt geladen wird und dass vitest sie
findet.

> **Falle, gemessen (Memory `vitest-silently-skips-missing-files`):** ein Pfadfilter ohne Treffer
> liefert Exit 0, ohne etwas geprüft zu haben. Gegenprüfen:
>
> ```bash
> pnpm --filter @easytree/api exec vitest run test/costs/snapshot-immutability.integration.test.ts 2>&1 | grep -c "snapshot-immutability"
> ```
>
> Expected: eine Zahl ≥ 1.

**Step 4: Commit**

```bash
git add apps/api/test/costs/snapshot-immutability.integration.test.ts
git commit -m "test(costs): EYT-143 — gespeicherten Snapshot gegen eine rueckwirkende Satzversion messen"
```

---

## Task 3: Das Gate in `db-gates`

**Files:**

- Modify: `.github/workflows/ci.yml` (neuer Schritt direkt nach dem Schritt
  „Snapshot-HTTP-Naht (fail-closed, zwei Verbindungen, EYT-139)", derzeit `:423-431`)

**Warum kein neuer Job:** Ein neuer Job wäre ein Status-Check, den Ruleset `19718704` nicht kennt,
und beide Listen in `scripts/setup-branch-protection.sh` **und**
`scripts/verify-branch-protection.sh` müssten mitwachsen — sonst bricht `verify` mit einem
internen Drift-Fehler ab. Dieselbe Begründung steht wörtlich schon bei den Schritten für EYT-108,
EYT-138 und EYT-139.

**Step 1: Schritt einfügen**

```yaml
# EYT-143: ein gespeicherter Snapshot ueberlebt eine RUECKWIRKEND wirksame
# Satzversion. Zwei Aussagen, die der HTTP-Fall I8 aus Bauart nicht
# treffen kann: die gespeicherte ZEILE selbst (er sieht nur die
# Leseausgabe) und die aktuelle Satzauflage ueber den Produktionspfad
# statt ueber rohes Admin-SQL.
#
# Eigener Schritt im BESTEHENDEN Job db-gates, kein neuer Job: ein neuer
# Job waere ein Status-Check, den das Ruleset nicht kennt, und beide
# Listen in setup-/verify-branch-protection.sh muessten mitwachsen.
- name: Snapshot-Unveraenderlichkeit gegen spaetere Saetze (fail-closed, zwei Verbindungen, EYT-143)
  env:
    EASYTREE_TENANT_TESTS: required
    EASYTREE_TEST_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
    EASYTREE_TEST_APP_DB_URL: postgresql://easytree_app:ci-local-app-password@127.0.0.1:54322/postgres
  shell: bash
  run: |
    pnpm --filter @easytree/api exec vitest run test/costs/snapshot-immutability.integration.test.ts 2>&1 | tee /tmp/snapshot-immutability.log
    bash scripts/assert-tenant-report.sh snapshot-immutability /tmp/snapshot-immutability.log
```

**Step 2: Die Einfügung prüfen — nicht den Exit-Code**

Run:

```bash
grep -n "snapshot-immutability" .github/workflows/ci.yml
```

Expected: genau **drei** Treffer (Schrittname trägt den Präfix nicht — Zeilen sind der
`vitest run`-Pfad, das `tee`-Ziel und das `assert-tenant-report.sh`-Argument … tatsächlich vier,
weil `tee` und `assert` je einmal vorkommen und der Testpfad einmal). Zähle die Ausgabe und
vergleiche sie mit dem, was du geschrieben hast — nicht mit dieser Vorhersage.

Und prüfe, dass der Job nicht versehentlich neu ist:

```bash
grep -c "^  [a-z-]*:$" .github/workflows/ci.yml
```

Expected: unverändert gegenüber `git show HEAD:.github/workflows/ci.yml | grep -c "^  [a-z-]*:$"`.

**Step 3: Format + Commit**

```bash
pnpm exec prettier --check .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci(db-gates): EYT-143 — Immutabilitaetssuite fail-closed in das bestehende Gate haengen"
```

---

## Task 4: Push und erster CI-Nachweis

**Step 1: Head vor dem Push gegenprüfen**

```bash
gh pr view 69 --json headRefOid,state,isDraft
```

Expected: `headRefOid` ist **immer noch** `17fa7cc00827aa75d74d0c396ef7e845a5564e49`.
Weicht er ab → **STOP, BLOCKED melden.** (Stop-Condition „PR head changed unexpectedly".)

**Step 2: Nur benannte Dateien prüfen, dann pushen**

```bash
git diff --stat 17fa7cc..HEAD
git diff --name-only 17fa7cc..HEAD
```

Expected: genau drei Pfade —
`apps/api/test/costs/snapshot-immutability.integration.test.ts`, `.github/workflows/ci.yml`,
`docs/plans/2026-08-13-eyt-143-snapshot-immutability.md`.

```bash
git push origin HEAD:feat/eyt-109-daily-plan-cost-snapshot
```

**Step 3: CI abwarten — mit dem geprüften Helfer, nicht mit einer Poll-Schleife**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600
```

Exit 0 = alle Läufe grün, 1 = Fehlschlag, 2 = Timeout.

**Step 4: Die Gate-Zeile aus dem Lauf lesen**

```bash
RUN=$(gh run list --repo DYAI2025/EasyTree --commit "$(git rev-parse HEAD)" --json databaseId,name --jq '.[0].databaseId')
gh run view "$RUN" --repo DYAI2025/EasyTree --log --job db-gates 2>/dev/null | grep -F "[snapshot-immutability]"
```

Expected: eine Zeile `[snapshot-immutability] mode=required executed=3 passed=3 skipped=0` und
darunter `[snapshot-immutability] Gate OK: executed=3 passed=3 skipped=0`.

**Wenn `executed=0` oder `skipped>0`:** das Gate ist per Konstruktion rot — nicht „nachbessern, bis
es grün ist", sondern die Ursache lesen. Ein Skip im Pflichtmodus ist ein Defekt, kein Zustand.

---

## Task 5: Die Gegenmutation — AUSGEFÜHRT

**Ziel:** belegen, dass die Suite genau das Risiko sieht, um dessentwillen sie existiert: der
Lesepfad rechnet aus **aktuellen** Sätzen nach, statt den gespeicherten Stand zu lesen.

**Warum ein Wegwerf-PR:** Die Mutation muss in `db-gates` laufen, und das geht nur über einen Push.
Auf PR #69 zu pushen verschmutzte die Historie des echten PR (Memory
`counter-mutations-on-a-throwaway-pr`). Deshalb ein eigener Branch, ein eigener PR, danach
ungemergt geschlossen.

**Files:**

- Temporär modify: `apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts`
  (Methode `read`, die Positionsabfrage)

**Step 1: Sicherungskopie anlegen — nicht auf `git checkout --` verlassen**

```bash
cp apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts /tmp/eyt143-read-original.ts
git rev-parse HEAD > /tmp/eyt143-sauberer-head.txt
```

> **Falle, gemessen (Memory `git-checkout-reverts-to-commit-not-worktree`):** `git checkout --`
> stellt den COMMIT-Stand her, nicht den Arbeitsstand. Hier ist beides gleich, aber die Kopie
> kostet nichts und hat schon zweimal Arbeit gerettet.

**Step 2: Wegwerf-Branch**

```bash
git switch -c throwaway/eyt-143-gegenmutation
```

**Step 3: Die Mutation einspielen**

In `cost-snapshot-repository.pg.ts::read` die Positionsabfrage ersetzen. **Original:**

```typescript
        `select id, assignment_id, worksite_id, worksite_label, employee_id,
                employee_label,
                to_char(local_date, 'YYYY-MM-DD') as local_date,
                duration_ms::text as duration_ms,
                rate_version_id,
                amount_minor_units::text as amount_minor_units
           from public.cost_snapshot_positions
          where snapshot_id = $1
          order by ordinal`,
```

**Mutiert:**

```typescript
        `select p.id, p.assignment_id, p.worksite_id, p.worksite_label, p.employee_id,
                p.employee_label,
                to_char(p.local_date, 'YYYY-MM-DD') as local_date,
                p.duration_ms::text as duration_ms,
                coalesce(r.id, p.rate_version_id) as rate_version_id,
                coalesce(r.amount_minor_units * p.duration_ms / 3600000,
                         p.amount_minor_units)::text as amount_minor_units
           from public.cost_snapshot_positions p
           left join public.employee_rate_versions r
             on r.employee_id = p.employee_id
            and r.valid_from <= p.local_date
            and (r.valid_to is null or p.local_date < r.valid_to)
          where p.snapshot_id = $1
          order by p.ordinal`,
```

**Der eingebaute semantische Defekt:** `rate_version_id` und `amount_minor_units` kommen jetzt aus
der am Leistungstag **derzeit** wirksamen Satzversion statt aus der gespeicherten Zeile. Der
Snapshot wird damit vom Dokument zum Cache.

**Warum sie kompiliert:** Die Ergebnisform bleibt exakt `PositionsZeile` — dieselben
Spaltennamen, dieselben Typen. `costs-touches-only-own-tables` greift nicht, weil
`employee_rate_versions` dem Kostenmodul selbst gehört, und `api-dependency-allowlist` ist nicht
berührt (kein neuer Import).

> **Korrektur, gemessen am 13.08.2026 — eine Annahme dieses Plans war falsch.** Eine frühere
> Fassung schrieb hier „fällt an keinem Wächter" und übernahm das aus
> `snapshot-http.integration.test.ts:104`. Lokal gemessen
> (`pnpm --filter @easytree/api exec vitest run test/architecture.test.ts test/costs/`) fällt
> zusätzlich **`cost-snapshot-repository.test.ts::Fall 18 — rechnet beim Lesen nichts nach`**:
> `Test Files 1 failed | 22 passed`, `Tests 1 failed | 190 passed | 36 skipped`. Dieser Fall läuft
> ohne Datenbank und prüft den **SQL-Text** der abgesetzten Anweisungen gegen
> `employee_rate_versions` (`:553`).
>
> Das ändert die Bewertung, nicht den Nutzen: Fall 18 sagt „die Anweisung nennt die Satztabelle
> nicht" — er kann nicht sagen, dass die echte Datenbank für dieselbe Id nach einer Ablösung wieder
> die historischen Werte liefert und die gespeicherten Zeilen unberührt bleiben. Ein Nachrechnen
> über eine Sicht, eine Funktion oder eine zweite Datenquelle trüge den Namen nicht im
> Anweisungstext und käme an ihm vorbei. Beide Nachweise ersetzen einander nicht — und ein
> Wegwerf-Lauf, in dem **zwei unabhängige Gates** feuern, ist die stärkere Evidenz, nicht die
> schwächere.
>
> Praktische Folge für Step 6: erwartet wird Rot in **`db-gates` UND `unit-tests`**. Das ist
> messbar, weil `.github/workflows/ci.yml` **kein einziges `needs:`** führt — jeder Job läuft
> unabhängig, ein rotes `unit-tests` verhindert `db-gates` also nicht.

> **Falle, gemessen (Memory `counter-mutation-must-be-coherent`):** eine halbe Mutation zerbricht
> am internen Wächter, und der rote Test misst dann die Selbstverteidigung statt der Regel. Diese
> hier ist vollständig: sie liefert für JEDE Position einen wohlgeformten Wert.

**Step 4: Beweisen, dass sie kompiliert — vor dem Push**

```bash
pnpm --filter @easytree/api typecheck && echo "TYPECHECK_OK"
grep -n "left join public.employee_rate_versions" apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
```

Expected: `TYPECHECK_OK` **und** genau ein Treffer der zweiten Zeile. Kein Treffer heißt: die
Mutation wurde nie geschrieben, und alles danach misst nichts (Memory
`verify-replacements-not-exit-codes`).

**Step 5: Wegwerf-PR öffnen und `db-gates` laufen lassen**

```bash
git add apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
git commit -m "test(costs): EYT-143 — GEGENMUTATION, nicht mergen: read rechnet aus aktuellen Saetzen nach"
git push origin throwaway/eyt-143-gegenmutation
gh pr create --repo DYAI2025/EasyTree --draft \
  --base feat/eyt-109-daily-plan-cost-snapshot \
  --head throwaway/eyt-143-gegenmutation \
  --title "WEGWERF — EYT-143 Gegenmutation, NICHT MERGEN" \
  --body "Nur Messung: belegt, dass test/costs/snapshot-immutability.integration.test.ts rot wird, wenn der Lesepfad aus aktuellen Saetzen nachrechnet. Wird ungemergt geschlossen."
```

**Step 6: Das Rot lesen**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600 ; echo "exit=$?"
```

Expected: `exit=1`.

```bash
RUN=$(gh run list --repo DYAI2025/EasyTree --commit "$(git rev-parse HEAD)" --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --repo DYAI2025/EasyTree --log-failed --job db-gates 2>/dev/null | grep -B3 -A12 "snapshot-immutability"
```

Expected: der Fall
`eine rueckwirkend wirksame V2 laesst Zeile, Antwort und Summe unveraendert` schlägt fehl, an der
Zusicherung `expect(nachher.snapshot.positions[0]?.rateVersionId).toBe(SATZ_V1)` — erwartet
`…6d1431`, erhalten die Id von V2. Notiere die **exakte** fehlgeschlagene Zeile und die Lauf-Id.

Erwartete Nebenwirkung, die den Nachweis stärkt: **auch `I8` in
`snapshot-http.integration.test.ts` wird rot** — genau die Mutation, die dessen Kopf seit EYT-139
benennt, aber nie ausgeführt hat. Notiere auch das.

**Step 7: Zurücknehmen und BEWEISEN, dass zurückgenommen ist**

```bash
git switch --detach "$(cat /tmp/eyt143-sauberer-head.txt)"
diff /tmp/eyt143-read-original.ts apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts && echo "IDENTISCH"
git diff --stat -- apps/api/src/modules/costs/infrastructure/cost-snapshot-repository.pg.ts
```

Expected: `IDENTISCH` und ein **leerer** `git diff --stat` für diese Datei.

> **Falle, gemessen (Memory `revert-evidence-must-be-scoped`):** ein globaler leerer `git diff` ist
> hier unerreichbar, solange andere Dateien in Arbeit sind. Grenze den Beweis auf die mutierte
> Datei ein.

**Step 8: Wegwerf-PR schließen, ohne zu mergen**

```bash
gh pr close --repo DYAI2025/EasyTree --delete-branch <nummer>
gh pr view <nummer> --repo DYAI2025/EasyTree --json state,mergedAt
```

Expected: `state: CLOSED`, `mergedAt: null`.

---

## Task 6: Finaler Nachweis auf PR #69

**Step 1: Auf den sauberen Stand zurück und die volle Kette lokal**

```bash
git switch --detach "$(cat /tmp/eyt143-sauberer-head.txt)"
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

Jeden Exit-Code notieren. `pnpm test` schließt `architecture.test.ts` und
`handoff-guardrails.test.ts` ein.

**Step 2: Falls Task 5 nichts am PR-Branch geändert hat — Head bestätigen**

```bash
gh pr view 69 --json headRefOid,state,isDraft,mergedAt
git rev-parse HEAD
```

Expected: beide gleich; `state: OPEN`, `isDraft: true`, `mergedAt: null`.

**Step 3: Finaler CI-Lauf auf genau diesem Head**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600 ; echo "exit=$?"
gh run list --repo DYAI2025/EasyTree --commit "$(git rev-parse HEAD)" --json databaseId,name,conclusion
```

Expected: exit 0, jeder Job `success`, und die `db-gates`-Zeile
`[snapshot-immutability] Gate OK: executed=3 passed=3 skipped=0`.

**Step 4: Deliverables auf Blocker greppen**

```bash
grep -rniE "offen|TODO|TOOL_GAP|FIXME" \
  apps/api/test/costs/snapshot-immutability.integration.test.ts \
  docs/plans/2026-08-13-eyt-143-snapshot-immutability.md
```

Ein Treffer im Testcode ist ein Blocker. (Im Plandokument sind Treffer in beschreibendem Text
zulässig — lies sie, bevor du sie abhakst.)

**Step 5: Evidenzbericht schreiben** — die 14 vom Auftrag verlangten Punkte, jeder mit der rohen
Ausgabe des Kommandos, das ihn belegt. Keine Zusammenfassung an Stelle einer Messung.

---

## Stop-Conditions — sofort melden, nicht umgehen

| Auslöser                                                                         | Reaktion                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| PR #69 Head ≠ `17fa7cc` vor dem Push                                             | STOP, `BLOCKED — PR head moved`                                |
| Szenario nur mit neuer Geschäftsregel darstellbar                                | STOP, `SOURCE_NEEDED`                                          |
| Produktionscode-/Schema-/RLS-Änderung wäre nötig (außer der temporären Mutation) | STOP, PO-Review anfordern                                      |
| Ein Pflicht-Gate außerhalb von `costs` fällt                                     | STOP, nicht breit reparieren                                   |
| Gegenmutation kompiliert nicht                                                   | STOP — eine nicht kompilierende Mutation ist **keine** Evidenz |

## Verbotene Aktionen

Jira ändern · Confluence ändern · PR #69 mergen · PR #69 auf ready setzen · Wegwerf-PR mergen ·
Migrationen · RLS · UI · EYT-110 · Sprint 6 · Task 15.
