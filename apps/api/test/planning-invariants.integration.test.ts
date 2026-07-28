/**
 * Nebenlaeufigkeitsbeweis fuer die Planungsinvarianten aus EYT-49
 * (Migration 0010_planning_invariants.sql).
 *
 * ## Warum diese Datei neben supabase/tests/0006_planning_invariants.sql steht
 *
 * pgTAP laeuft in EINER Session. Dort laesst sich zeigen, dass der
 * EXCLUDE-Constraint eine Ueberlappung ABLEHNT — aber nicht, dass er zwei
 * GLEICHZEITIGE Veroeffentlichungen gegeneinander serialisiert. Genau das ist
 * der Fall, der ohne Datenbankconstraint durchrutscht: zwei Anfragen pruefen
 * beide "keine Ueberlappung vorhanden", beide schreiben, beide committen.
 * Anwendungscode kann das nicht verhindern; ein Index kann es.
 *
 * ## Wie der Beweis gefuehrt wird — und warum ohne commit
 *
 * Sitzung A veroeffentlicht in einer OFFENEN Transaktion. Ihre Indexeintraege
 * existieren dann bereits, sind aber noch nicht sichtbar. Sitzung B
 * veroeffentlicht ueberlappend und muss deshalb BLOCKIEREN, bis A entschieden
 * ist — sie wartet auf As Transaktion, nicht auf eine Zeile, die sie sehen
 * koennte. Mit `set local lock_timeout` wird aus dem Warten ein messbarer
 * Fehler (55P03). Genau dieses Warten ist die Aussage: haette B die
 * Ueberlappung nicht bemerkt, liefe sie einfach durch.
 *
 * Danach rollt A zurueck, und Bs Veroeffentlichung gelingt. Ohne diese
 * Gegenprobe waere die Blockade auch dann "gruen", wenn B aus einem beliebigen
 * anderen Grund haengt.
 *
 * KEINE Transaktion committet. Das ist keine Vorsicht, sondern Notwendigkeit:
 * 0010 macht veroeffentlichte Zeilen unveraenderlich UND unloeschbar. Eine
 * committete Veroeffentlichung liesse sich nicht mehr aufraeumen und wuerde
 * jeden nachfolgenden Schritt in db-gates auf einer veraenderten Datenbank
 * laufen lassen.
 *
 * Fail-closed wie die Tenant-Suiten (EYT-66): Modus aus EASYTREE_TENANT_TESTS,
 * "required" in CI laesst unerreichbare DB und jeden Skip fehlschlagen.
 */
import { Client, DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FailClosedGate, ORG_ALPHA, probeDatabase, USER_A } from "./tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local"; // "required" | "local"

// EYT-90: dritter Nutzer desselben Zaehlwerks. Vorher stieg `executed` VOR der
// Assertion und es gab kein `passed` — `executed=5 skipped=0` las sich wie fuenf
// bestandene Invariantentests, obwohl die Zahl das nie getragen hat. Die
// Fehlerpropagation war nie kaputt (der CI-Step setzt `shell: bash`, also
// `-eo pipefail`); betroffen war allein die Evidence-Zeile.
const gate = new FailClosedGate("planning-invariants", TENANT_TESTS_MODE, "EYT-90");

let dbAvailable = false;
let sessionA: Client;
let sessionB: Client;

/** Seed-Konstanten aus supabase/seed.sql (Org Alpha). */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const WORKSITE_ALPHA = "00000000-0000-4000-8000-0000005010a1";

/**
 * Zwei Planversionen in VERSCHIEDENEN Wochen mit Zuweisungen am selben Tag.
 *
 * Das ist kein Fixture-Fehler, sondern eine bewusst genutzte Schemaluecke:
 * 0007 verknuepft `week_key` mit KEINER Pruefung gegen die Zeitstempel der
 * Zuweisungen — eine Zuweisung kann heute in der Planversion einer fremden
 * Woche haengen, und nichts faellt auf. Hier ist das nuetzlich, weil der
 * partielle Unique-Index `plan_versions_one_draft_per_week` sonst zuschlagen
 * wuerde, bevor der EXCLUDE ueberhaupt drankommt: dann haetten wir die
 * Serialisierung des falschen Constraints bewiesen.
 *
 * Die Luecke selbst gehoert nicht hierhin, sondern in ein eigenes Ticket
 * (Kandidat: EYT-50/EYT-61, wo der Publish-Pfad fachlich entsteht).
 */
const WEEK_A = "2026-W40";
const WEEK_B = "2026-W41";
const SHIFT_A = { start: "2026-09-28T06:00:00Z", end: "2026-09-28T14:00:00Z" };
const SHIFT_B_OVERLAPPING = { start: "2026-09-28T10:00:00Z", end: "2026-09-28T18:00:00Z" };

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

/** Oeffnet eine Transaktion mit Tenantkontext — OHNE commit/rollback. */
async function beginAsPlanner(client: Client): Promise<void> {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: USER_A, role: "authenticated" }),
  ]);
  await client.query("set local role authenticated");
}

/** Legt Entwurf + Zuweisung an und gibt die Planversions-Id zurueck. */
async function stageDraft(
  client: Client,
  weekKey: string,
  shift: { start: string; end: string },
): Promise<string> {
  const version = await client.query<{ id: string }>(
    "insert into public.plan_versions (org_id, week_key) values ($1, $2) returning id",
    [ORG_ALPHA, weekKey],
  );
  const planVersionId = version.rows[0]?.id;
  if (planVersionId === undefined) {
    throw new Error("Planversion konnte nicht angelegt werden — Fixture kaputt.");
  }
  await client.query(
    `insert into public.assignments
       (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
     values ($1, $2, $3, $4, $5, $6)`,
    [ORG_ALPHA, planVersionId, EMPLOYEE_ALPHA, WORKSITE_ALPHA, shift.start, shift.end],
  );
  return planVersionId;
}

async function publish(client: Client, planVersionId: string): Promise<void> {
  await client.query(
    "update public.plan_versions set published_at = now(), published_by = $1 where id = $2",
    [USER_A, planVersionId],
  );
}

describe("planning invariants under concurrency (EYT-49)", () => {
  beforeAll(async () => {
    dbAvailable = await probeDatabase(DB_URL);
    if (!dbAvailable) {
      if (TENANT_TESTS_MODE === "required") {
        throw new Error(
          "[planning-invariants] fail-closed: Pflichttests koennen nicht laufen — DB unter " +
            DB_URL +
            " nicht erreichbar (EYT-49/EYT-66).",
        );
      }
      console.warn(
        `[planning-invariants.integration] SKIPPED: Supabase-Postgres unter ${DB_URL} nicht erreichbar.`,
      );
      return;
    }
    sessionA = new Client({ connectionString: DB_URL });
    sessionB = new Client({ connectionString: DB_URL });
    await sessionA.connect();
    await sessionB.connect();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await sessionA.end().catch(() => undefined);
      await sessionB.end().catch(() => undefined);
    }
  });

  afterAll(() => {
    process.stdout.write(gate.reportLine());
    gate.assertOrThrow();
  });

  dbIt(
    "zwei gleichzeitige Veroeffentlichungen derselben Person werden serialisiert, nicht beide durchgelassen",
    async () => {
      await beginAsPlanner(sessionA);
      await beginAsPlanner(sessionB);
      try {
        const versionA = await stageDraft(sessionA, WEEK_A, SHIFT_A);
        const versionB = await stageDraft(sessionB, WEEK_B, SHIFT_B_OVERLAPPING);

        // A veroeffentlicht und HAELT die Transaktion offen.
        await publish(sessionA, versionA);

        // B muss jetzt auf A warten. lock_timeout macht daraus einen Fehler
        // statt eines haengenden Tests.
        await sessionB.query("set local lock_timeout = '2s'");
        let blocked: DatabaseError | null = null;
        try {
          await publish(sessionB, versionB);
        } catch (error) {
          blocked = error as DatabaseError;
        }

        expect(
          blocked,
          "B lief durch, obwohl A dieselbe Person bereits verplant hat",
        ).not.toBeNull();
        // 55P03 lock_not_available: B wartete auf As Transaktion.
        expect(blocked?.code).toBe("55P03");

        // Gegenprobe: sobald A zuruecknimmt, gelingt B. Ohne sie waere die
        // Blockade oben auch dann "gruen", wenn B aus einem anderen Grund haengt.
        await sessionA.query("rollback");
        await sessionB.query("rollback");

        await beginAsPlanner(sessionB);
        const versionBAlone = await stageDraft(sessionB, WEEK_B, SHIFT_B_OVERLAPPING);
        await expect(publish(sessionB, versionBAlone)).resolves.toBeUndefined();
      } finally {
        await sessionA.query("rollback").catch(() => undefined);
        await sessionB.query("rollback").catch(() => undefined);
      }
    },
  );

  dbIt(
    "nacheinander veroeffentlicht meldet die zweite Ueberlappung 23P01, nicht nur eine Sperre",
    async () => {
      await beginAsPlanner(sessionA);
      try {
        const versionA = await stageDraft(sessionA, WEEK_A, SHIFT_A);
        await publish(sessionA, versionA);

        // Dieselbe Sitzung, also kein Warten: der Constraint entscheidet sofort.
        const versionB = await stageDraft(sessionA, WEEK_B, SHIFT_B_OVERLAPPING);
        let violation: DatabaseError | null = null;
        try {
          await publish(sessionA, versionB);
        } catch (error) {
          violation = error as DatabaseError;
        }

        expect(violation).not.toBeNull();
        expect(violation?.code).toBe("23P01");
        expect(violation?.constraint).toBe("assignments_no_published_overlap");
      } finally {
        await sessionA.query("rollback").catch(() => undefined);
      }
    },
  );

  dbIt(
    "ein anschliessender Zeitraum ist kein Konflikt — halboffen wie im Domainmodell",
    async () => {
      await beginAsPlanner(sessionA);
      try {
        const versionA = await stageDraft(sessionA, WEEK_A, SHIFT_A);
        await publish(sessionA, versionA);

        // 14:00 beginnt exakt dort, wo SHIFT_A endet. [06:00,14:00) und
        // [14:00,18:00) beruehren sich, ueberlappen aber nicht.
        const versionB = await stageDraft(sessionA, WEEK_B, {
          start: "2026-09-28T14:00:00Z",
          end: "2026-09-28T18:00:00Z",
        });
        await expect(publish(sessionA, versionB)).resolves.toBeUndefined();
      } finally {
        await sessionA.query("rollback").catch(() => undefined);
      }
    },
  );

  dbIt("der Veroeffentlichungsmarker der Zuweisung ist nicht direkt schreibbar", async () => {
    await beginAsPlanner(sessionA);
    try {
      const versionA = await stageDraft(sessionA, WEEK_A, SHIFT_A);
      let denied: DatabaseError | null = null;
      try {
        await sessionA.query(
          "update public.assignments set published_at = now() where plan_version_id = $1",
          [versionA],
        );
      } catch (error) {
        denied = error as DatabaseError;
      }

      expect(
        denied,
        "published_at liess sich direkt setzen — der EXCLUDE waere umgehbar",
      ).not.toBeNull();
      // 42501: das Spaltenrecht fehlt (0010), nicht die Zeile.
      expect(denied?.code).toBe("42501");
    } finally {
      await sessionA.query("rollback").catch(() => undefined);
    }
  });

  dbIt("der Marker laesst sich auch beim ANLEGEN nicht mitliefern", async () => {
    await beginAsPlanner(sessionA);
    try {
      const version = await stageDraft(sessionA, WEEK_A, SHIFT_A);
      let denied: DatabaseError | null = null;
      try {
        await sessionA.query(
          `insert into public.assignments
             (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc, published_at)
           values ($1, $2, $3, $4, $5, $6, now())`,
          [
            ORG_ALPHA,
            version,
            EMPLOYEE_ALPHA,
            WORKSITE_ALPHA,
            "2026-09-29T06:00:00Z",
            "2026-09-29T14:00:00Z",
          ],
        );
      } catch (error) {
        denied = error as DatabaseError;
      }

      // Ein gefaelschter Marker beim insert waere schlimmer als beim update:
      // die Zeile naehme sofort am EXCLUDE teil und waere danach durch 0010
      // unveraenderlich UND unloeschbar — niemand koennte sie korrigieren.
      expect(denied, "published_at liess sich beim Anlegen mitgeben").not.toBeNull();
      expect(denied?.code).toBe("42501");
    } finally {
      await sessionA.query("rollback").catch(() => undefined);
    }
  });

  dbIt(
    "eine Zuweisung kann nicht in eine gerade veroeffentlichte Planversion hineinlaufen",
    async () => {
      // Die Race, die ein ungesperrtes select durchlaesst: A veroeffentlicht
      // und haelt offen; B sieht im eigenen Snapshot noch den Entwurf. Der
      // Fremdschluessel nimmt nur KEY SHARE und kollidiert mit A nicht — ohne
      // das FOR SHARE in 0010 wuerde B einfach committen, und die
      // veroeffentlichte Planversion enthielte danach eine Zuweisung mit
      // published_at = NULL: ausserhalb von Unveraenderlichkeit UND
      // Ueberlappungspruefung.
      // Eine GESEEDETE Planversion, keine frisch angelegte: B muss sie sehen
      // koennen, und Zeilen aus As offener Transaktion sieht B nicht.
      const SEEDED_DRAFT = "00000000-0000-4000-8000-0000006010a1";
      await beginAsPlanner(sessionA);
      await beginAsPlanner(sessionB);
      try {
        await sessionA.query(
          "update public.plan_versions set published_at = now(), published_by = $1 where id = $2",
          [USER_A, SEEDED_DRAFT],
        );

        await sessionB.query("set local lock_timeout = '2s'");
        let blocked: DatabaseError | null = null;
        try {
          await sessionB.query(
            `insert into public.assignments
               (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              ORG_ALPHA,
              SEEDED_DRAFT,
              EMPLOYEE_ALPHA,
              WORKSITE_ALPHA,
              "2026-08-05T06:00:00Z",
              "2026-08-05T14:00:00Z",
            ],
          );
        } catch (error) {
          blocked = error as DatabaseError;
        }

        expect(
          blocked,
          "B lief durch, obwohl A dieselbe Planversion gerade veroeffentlicht",
        ).not.toBeNull();
        expect(blocked?.code).toBe("55P03");

        // Gegenprobe: nimmt A zurueck, ist die Planversion wieder Entwurf und
        // B darf. Ohne sie waere die Sperre auch bei jedem anderen Haenger gruen.
        await sessionA.query("rollback");
        await sessionB.query("rollback");
        await beginAsPlanner(sessionB);
        await expect(
          sessionB.query(
            `insert into public.assignments
               (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              ORG_ALPHA,
              SEEDED_DRAFT,
              EMPLOYEE_ALPHA,
              WORKSITE_ALPHA,
              "2026-08-05T06:00:00Z",
              "2026-08-05T14:00:00Z",
            ],
          ),
        ).resolves.toBeDefined();
      } finally {
        await sessionA.query("rollback").catch(() => undefined);
        await sessionB.query("rollback").catch(() => undefined);
      }
    },
  );
});
