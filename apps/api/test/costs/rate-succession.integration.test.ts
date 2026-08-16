/**
 * Abloesung und Wiederholung gegen ECHTES PostgreSQL (EYT-108 Option A+).
 *
 * ## Was hier bewiesen wird, und warum es ohne Datenbank nicht geht
 *
 * `rate-succession.test.ts` prueft die reine Regel. Sie bliebe vollstaendig
 * gruen, wenn die Datenbank jede Ueberlappung durchliesse, jeden Retry doppelt
 * schriebe und zwei gleichzeitige Bearbeiter beide gewinnen liesse — sie sieht
 * PostgreSQL ja nie.
 *
 * Drei Aussagen sind nur mit zwei ECHTEN Verbindungen pruefbar:
 *
 *   1. `for update` serialisiert den kritischen Abschnitt. Eine Verbindung
 *      kann das nicht zeigen: sie sieht ihre eigene Sperre nie als Wartezeit.
 *   2. Ein Retry mit demselben Schluessel liefert dasselbe Ergebnis, statt
 *      eine zweite Version anzulegen.
 *   3. Derselbe Schluessel in zwei Organisationen kollidiert nicht — und
 *      Organisation A sieht das Ergebnis von B nicht.
 *
 * ## Warum diese Suite committet
 *
 * Anders als `cost-access.integration.test.ts` laeuft sie NICHT in einer
 * zurueckgerollten Transaktion: Nebenlaeufigkeit zwischen zwei Verbindungen
 * setzt voraus, dass die erste wirklich committet. Aufgeraeumt wird deshalb
 * ueber die Marke im Feld `reason` — dieselbe Technik wie in
 * `rate-timestamp.integration.test.ts`, die dort aus demselben Grund gewaehlt
 * wurde.
 *
 * ## Fail-closed
 *
 * Modus aus `EASYTREE_TENANT_TESTS`. In CI (`required`) ist eine unerreichbare
 * Datenbank ein Fehler, kein Skip. Jeder Lauf schreibt eine greppbare Zeile,
 * die `scripts/assert-tenant-report.sh` auswertet.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgRateRepository } from "../../src/modules/costs";
import type { RateWriteResult } from "../../src/modules/costs";
import { PgTenantQueryRunner } from "../../src/platform/database/tenant-query-runner";
import { PgIdempotencyStore } from "../../src/platform/idempotency/pg-idempotency-store";
import {
  FailClosedGate,
  ORG_ALPHA,
  ORG_BETA,
  probeDatabase,
  USER_A,
} from "../tenant-context.helper";

const DB_URL =
  process.env["EASYTREE_TEST_DB_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TENANT_TESTS_MODE = process.env["EASYTREE_TENANT_TESTS"] ?? "local";
const gate = new FailClosedGate("rate-succession", TENANT_TESTS_MODE, "EYT-108");

/** Seed-Fixtures (supabase/seed.sql). */
const EMPLOYEE_ALPHA = "00000000-0000-4000-8000-0000004010a1";
const EMPLOYEE_ALPHA_2 = "00000000-0000-4000-8000-0000004011a1";
const USER_B = "00000000-0000-4000-8000-00000000bbb2";
const EMPLOYEE_BETA = "00000000-0000-4000-8000-0000004020b2";

/**
 * Eigene Mitarbeiter je Fall — der Seed hat in Alpha nur zwei.
 *
 * Gemessen im CI-Lauf 30773551669: die Faelle teilten sich eine Person, und
 * die OFFENE Version des vorigen Falls ueberlappte mit der naechsten. Beide
 * scheiterten am EXCLUDE — also am Aufraeumen, nicht an der Aussage, die sie
 * treffen sollten. Ein Test, der aus dem falschen Grund rot ist, misst nichts.
 */
const EMPLOYEE_KONFLIKT = "00000000-0000-4000-8000-00000040e801";
const EMPLOYEE_MANDANT = "00000000-0000-4000-8000-00000040e802";
const EMPLOYEE_ROLLBACK = "00000000-0000-4000-8000-00000040e803";
/** Eigene Person fuer die Persistenzgrenze aus EYT-109 D1. */
const EMPLOYEE_GRENZE = "00000000-0000-4000-8000-00000040e804";

/**
 * Aufraeummarke.
 *
 * Alles, was diese Suite committet, traegt sie im Feld `reason`. Ein
 * abgebrochener Lauf hinterlaesst sonst eine offene Version, und der naechste
 * Lauf scheitert am EXCLUDE statt an dem, was er messen will.
 */
const MARKE = "EYT-108-abloesung-integration";

let dbAvailable = false;
let admin: Client;
let runnerA: PgTenantQueryRunner;
let runnerB: PgTenantQueryRunner;

function dbIt(name: string, fn: () => Promise<void>): void {
  it(name, async (ctx) => {
    if (!dbAvailable) {
      gate.markSkipped();
      ctx.skip(`SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`);
      return;
    }
    await gate.run(fn);
  });
}

async function aufraeumen(): Promise<void> {
  // Reihenfolge nach Fremdschluesseln: employee_rate_versions verweist mit
  // `on delete restrict` auf employees. Andersherum bliebe die Person stehen.
  await admin.query("delete from public.employee_rate_versions where reason like $1", [
    `${MARKE}%`,
  ]);
  await admin.query("delete from public.employees where display_name like $1", [`${MARKE}%`]);
  await admin.query("delete from public.idempotency_records where idempotency_key like $1", [
    `${MARKE}%`,
  ]);
}

/** Legt einen OFFENEN Vorgaenger an und committet ihn. */
async function offenerVorgaenger(
  organisationId: string,
  employeeId: string,
  createdBy: string,
  validFrom: string,
): Promise<string> {
  const ergebnis = await admin.query<{ id: string }>(
    `insert into public.employee_rate_versions
       (org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
        reason, created_by, correlation_id)
     values ($1::uuid, $2::uuid, 3850, 'EUR', $3::date, null, $4, $5::uuid, 'korr-fixtur')
     returning id`,
    [organisationId, employeeId, validFrom, `${MARKE}-vorgaenger`, createdBy],
  );
  return ergebnis.rows[0]?.id ?? "";
}

function repositoryFuer(runner: PgTenantQueryRunner, userId: string): PgRateRepository {
  return new PgRateRepository(runner, userId, new PgIdempotencyStore());
}

beforeAll(async () => {
  dbAvailable = await probeDatabase(DB_URL);
  if (!dbAvailable) {
    if (TENANT_TESTS_MODE === "required") {
      throw new Error(
        `[rate-succession] fail-closed: Pflichttests koennen nicht laufen — DB unter ${DB_URL} nicht erreichbar (EYT-108).`,
      );
    }
    console.warn(
      `[rate-succession.integration] SKIPPED: PostgreSQL unter ${DB_URL} nicht erreichbar.`,
    );
    return;
  }
  admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  // Vorbedingung, nicht Annahme: beide Seed-Owner muessen Saetze pflegen
  // duerfen. Fehlte das Recht, scheiterten die Faelle an RLS statt an dem,
  // was sie messen — und waeren rot aus dem falschen Grund.
  await admin.query("update public.memberships set role = 'owner' where user_id in ($1, $2)", [
    USER_A,
    USER_B,
  ]);
  await aufraeumen();
  // Eigene Personen fuer die Faelle 3 und 4, damit keine offene Version des
  // vorigen Falls in ihr Intervall ragt.
  for (const id of [EMPLOYEE_KONFLIKT, EMPLOYEE_MANDANT, EMPLOYEE_ROLLBACK, EMPLOYEE_GRENZE]) {
    await admin.query(
      `insert into public.employees (id, org_id, user_id, display_name, active)
       values ($1::uuid, $2::uuid, null, $3, true)
       on conflict (id) do nothing`,
      [id, ORG_ALPHA, `${MARKE}-person`],
    );
  }

  runnerA = PgTenantQueryRunner.fromConnection({ databaseUrl: DB_URL, sslRootCert: undefined });
  runnerB = PgTenantQueryRunner.fromConnection({ databaseUrl: DB_URL, sslRootCert: undefined });
});

afterAll(async () => {
  if (dbAvailable) {
    await aufraeumen();
    await admin.end().catch(() => undefined);
    await runnerA.close().catch(() => undefined);
    await runnerB.close().catch(() => undefined);
  }
});

afterAll(() => {
  process.stdout.write(gate.reportLine());
  gate.assertOrThrow();
});

describe("Abloesung unter echter Nebenlaeufigkeit (EYT-108)", () => {
  dbIt("zwei Verbindungen loesen denselben offenen Satz ab — genau eine gewinnt", async () => {
    const vorgaengerId = await offenerVorgaenger(ORG_ALPHA, EMPLOYEE_ALPHA, USER_A, "2030-01-01");

    // Beide Anfragen sehen denselben offenen Vorgaenger und wollen ihn
    // abloesen. VERSCHIEDENE Idempotenzschluessel — mit demselben Schluessel
    // wuerde die Idempotenzsperre serialisieren und der Zeilenlock waere gar
    // nicht das, was hier geprueft wird.
    const befehl = (schluessel: string) => ({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ALPHA,
      amountMinorUnits: "4200",
      validFrom: "2030-07-01",
      validTo: null,
      reason: `${MARKE}-nachfolger`,
      expectedActiveVersionId: vorgaengerId,
      correlationId: "korr-parallel",
      idempotencyKey: schluessel,
    });

    const [a, b] = await Promise.allSettled([
      repositoryFuer(runnerA, USER_A).append(befehl(`${MARKE}-parallel-a`)),
      repositoryFuer(runnerB, USER_A).append(befehl(`${MARKE}-parallel-b`)),
    ]);

    // Beide Aufrufe muessen ein ERGEBNIS liefern, keinen Ausnahmefehler. Ein
    // Wurf waere genau der Zustand, den `for update` verhindern soll: der
    // Verlierer haette den Vorgaenger als offen gelesen und danach null
    // Zeilen geschlossen.
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    const ergebnisse = [a, b]
      .filter((e): e is PromiseFulfilledResult<RateWriteResult> => e.status === "fulfilled")
      .map((e) => e.value);

    const gewinner = ergebnisse.filter((e) => e.ok);
    const verlierer = ergebnisse.filter((e) => !e.ok);
    expect(gewinner).toHaveLength(1);
    expect(verlierer).toHaveLength(1);
    // Stabiler fachlicher Grund, kein Constraint-Rauschen: der Verlierer sieht
    // nach der Sperre den bereits geschlossenen Vorgaenger.
    const grund = verlierer[0];
    if (grund !== undefined && !grund.ok) {
      expect(["VORGAENGER_BEREITS_GESCHLOSSEN", "STALE_ACTIVE_VERSION"]).toContain(grund.problem);
    }

    const zustand = await admin.query<{
      id: string;
      valid_to: string | null;
      predecessor_id: string | null;
    }>(
      `select id, to_char(valid_to,'YYYY-MM-DD') as valid_to, predecessor_id
         from public.employee_rate_versions
        where employee_id = $1 and reason like $2
        order by valid_from`,
      [EMPLOYEE_ALPHA, `${MARKE}%`],
    );

    // Genau zwei Zeilen: der geschlossene Vorgaenger und EIN Nachfolger.
    expect(zustand.rows).toHaveLength(2);
    expect(zustand.rows[0]?.valid_to).toBe("2030-07-01");
    expect(zustand.rows[1]?.valid_to).toBeNull();
    expect(zustand.rows[1]?.predecessor_id).toBe(vorgaengerId);
  });
});

describe("Die Persistenzgrenze uebersetzt in beide Richtungen (EYT-109 D1)", () => {
  dbIt("persistiert den fachlichen Endtag als exklusive DB-Grenze", async () => {
    // Gegenmutation: `validToZuDbEnde` im INSERT entfernen -> die DB hielte
    // `2026-06-30`, und der Nahtstellentag verschoebe sich um einen Tag.
    const ergebnis = await repositoryFuer(runnerA, USER_A).append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_GRENZE,
      amountMinorUnits: "4200",
      validFrom: "2026-06-01",
      // FACHLICH: letzter wirksamer Tag. In der Datenbank muss daraus die
      // exklusive Grenze `2026-07-01` werden (Migration 0013, `[)`).
      validTo: "2026-06-30",
      reason: `${MARKE}-grenze`,
      expectedActiveVersionId: null,
      correlationId: "korr-grenze",
      idempotencyKey: `${MARKE}-grenze-key`,
    });
    expect(ergebnis.ok, JSON.stringify(ergebnis)).toBe(true);
    if (!ergebnis.ok) return;

    // Die ROHE Zeile ueber eine Adminverbindung. Der Rundlauf allein genuegt
    // NICHT: zwei sich aufhebende Vorzeichenfehler blieben gruen. Erst diese
    // Abfrage trennt „richtig gespeichert" von „symmetrisch falsch"
    // (`net-count-checks-cancel-out`). Sie laeuft auf `postgres`, nicht auf
    // `easytree_app` (`runtime-channel-tests-need-observer-connection`).
    const roh = await admin.query<{ valid_from: string; valid_to: string | null }>(
      `select to_char(valid_from,'YYYY-MM-DD') as valid_from,
              to_char(valid_to,'YYYY-MM-DD')   as valid_to
         from public.employee_rate_versions where id = $1`,
      [ergebnis.version.id],
    );
    expect(roh.rows[0]?.valid_from).toBe("2026-06-01");
    expect(roh.rows[0]?.valid_to).toBe("2026-07-01");

    // Und der Rundlauf: was zurueckkommt, ist wieder fachlich.
    expect(ergebnis.version.validTo).toBe("2026-06-30");

    // Ein direkt anschliessender Nachfolger ab dem Folgetag ist zulaessig —
    // lueckenlos UND ueberlappungsfrei. Waere die Grenze falsch uebersetzt,
    // schluege hier der EXCLUDE-Constraint aus Migration 0013 zu.
    const nachfolger = await repositoryFuer(runnerA, USER_A).append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_GRENZE,
      amountMinorUnits: "4400",
      validFrom: "2026-07-01",
      validTo: null,
      reason: `${MARKE}-grenze-nachfolger`,
      expectedActiveVersionId: null,
      correlationId: "korr-grenze-2",
      idempotencyKey: `${MARKE}-grenze-2-key`,
    });
    expect(nachfolger.ok, JSON.stringify(nachfolger)).toBe(true);
    if (!nachfolger.ok) return;
    // `null` bleibt `null` — in beide Richtungen, ueber die echte Datenbank.
    expect(nachfolger.version.validTo).toBeNull();
    const rohOffen = await admin.query<{ valid_to: string | null }>(
      `select to_char(valid_to,'YYYY-MM-DD') as valid_to
         from public.employee_rate_versions where id = $1`,
      [nachfolger.version.id],
    );
    expect(rohOffen.rows[0]?.valid_to).toBeNull();
  });

  dbIt("ein Retry mit demselben Koerper bleibt eine Wiederholung (EYT-108 T9)", async () => {
    // `anfrageFingerabdruck` hasht `version.validTo` — den FACHLICHEN Wert, auf
    // beiden Seiten von D1 derselbe. Ein Abdruck ueber dem umgerechneten Wert
    // haette hier still falsch sein koennen: derselbe Koerper erzeugte dann
    // einen anderen Abdruck, und der Retry haette `IDEMPOTENCY_KEY_REUSED`
    // gemeldet statt die erste Antwort zu wiederholen.
    const wieder = await repositoryFuer(runnerB, USER_A).append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_GRENZE,
      amountMinorUnits: "4200",
      validFrom: "2026-06-01",
      validTo: "2026-06-30",
      reason: `${MARKE}-grenze`,
      expectedActiveVersionId: null,
      // Andere Korrelations-Id, gleicher Schluessel — genau ein echter Retry.
      correlationId: "korr-grenze-retry",
      idempotencyKey: `${MARKE}-grenze-key`,
    });
    expect(wieder.ok, JSON.stringify(wieder)).toBe(true);
    if (!wieder.ok) return;
    expect(wieder.version.validTo).toBe("2026-06-30");

    // Und es entstand KEINE zweite Zeile.
    const anzahl = await admin.query<{ n: string }>(
      `select count(*)::text as n from public.employee_rate_versions
        where employee_id = $1 and reason = $2`,
      [EMPLOYEE_GRENZE, `${MARKE}-grenze`],
    );
    expect(anzahl.rows[0]?.n).toBe("1");
  });

  dbIt("liest die Historie einschliessend zurueck — beide Zeilen, eine Lesart", async () => {
    // Der Lesepfad ueber den Laufzeitkanal, nicht ueber die Adminverbindung:
    // `versionsFor` ist das, was Controller und Montage benutzen.
    // Gegenmutation: `dbEndeZuValidTo` aus `toRecord` entfernen -> der
    // Vorgaenger meldete `2026-07-01` und der Wechseltag stuende zweimal da.
    const historie = await repositoryFuer(runnerA, USER_A).versionsFor(EMPLOYEE_GRENZE);
    const unsere = [...historie]
      .filter((v) => v.reason.startsWith(`${MARKE}-grenze`))
      .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
    expect(unsere.map((v) => [v.validFrom, v.validTo])).toEqual([
      ["2026-06-01", "2026-06-30"],
      ["2026-07-01", null],
    ]);
  });
});

describe("Ein Fehler nach dem Schliessen rollt alles zurueck (EYT-108)", () => {
  dbIt("scheitert der Nachfolger, bleibt der Vorgaenger offen", async () => {
    const vorgaengerId = await offenerVorgaenger(
      ORG_ALPHA,
      EMPLOYEE_ROLLBACK,
      USER_A,
      "2034-01-01",
    );

    // Der Nachfolger verletzt `check (amount_minor_units >= 0)` — also ERST
    // NACHDEM der Vorgaenger geschlossen wurde. Genau hier entstuende eine
    // halb abgeloeste Kette, wenn die Transaktion nicht zurueckrollte: ein
    // geschlossener Satz ohne Nachfolger, und ab dem Endtag gaebe es fuer
    // diese Person gar keinen wirksamen Stundensatz mehr.
    const ergebnis = repositoryFuer(runnerA, USER_A).append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ROLLBACK,
      amountMinorUnits: "-1",
      validFrom: "2034-07-01",
      validTo: null,
      reason: `${MARKE}-rollback`,
      expectedActiveVersionId: vorgaengerId,
      correlationId: "korr-rollback",
      idempotencyKey: `${MARKE}-rollback-key`,
    });
    await expect(ergebnis).rejects.toThrow();

    const nachher = await admin.query<{ valid_to: string | null; n: string }>(
      `select to_char(valid_to,'YYYY-MM-DD') as valid_to,
              (select count(*)::text from public.employee_rate_versions
                where employee_id = $1) as n
         from public.employee_rate_versions where id = $2`,
      [EMPLOYEE_ROLLBACK, vorgaengerId],
    );
    // Der Vorgaenger ist WEITERHIN offen und steht allein da.
    expect(nachher.rows[0]?.valid_to).toBeNull();
    expect(nachher.rows[0]?.n).toBe("1");

    // Und die Idempotenzauskunft wurde NICHT geschrieben: der Schluessel ist
    // wieder frei. Waere sie da, meldete ein Retry "schon erledigt" fuer
    // etwas, das nie passiert ist.
    const auskunft = await admin.query<{ n: string }>(
      `select count(*)::text as n from public.idempotency_records where idempotency_key = $1`,
      [`${MARKE}-rollback-key`],
    );
    expect(auskunft.rows[0]?.n).toBe("0");
  });
});

describe("Wiederholung liefert dasselbe Ergebnis (EYT-108)", () => {
  dbIt("gleicher Schluessel und gleiche Nutzlast legen keine zweite Version an", async () => {
    const vorgaengerId = await offenerVorgaenger(ORG_ALPHA, EMPLOYEE_ALPHA_2, USER_A, "2031-01-01");
    const repository = repositoryFuer(runnerA, USER_A);
    const befehl = {
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_ALPHA_2,
      amountMinorUnits: "4400",
      validFrom: "2031-07-01",
      validTo: null,
      reason: `${MARKE}-retry`,
      expectedActiveVersionId: vorgaengerId,
      correlationId: "korr-erster-versuch",
      idempotencyKey: `${MARKE}-retry-key`,
    };

    const erst = await repository.append(befehl);
    expect(erst.ok).toBe(true);

    // Der Retry traegt eine ANDERE Korrelations-Id — so sieht ein echter
    // Wiederholungsversuch aus. Waere sie Teil des Fingerabdrucks, gaelte er
    // als andere Nutzlast und der Schutz waere wirkungslos.
    const wieder = await repository.append({ ...befehl, correlationId: "korr-zweiter-versuch" });
    expect(wieder.ok).toBe(true);
    if (erst.ok && wieder.ok) expect(wieder.version.id).toBe(erst.version.id);

    const anzahl = await admin.query<{ n: string }>(
      `select count(*)::text as n from public.employee_rate_versions
        where employee_id = $1 and reason = $2`,
      [EMPLOYEE_ALPHA_2, `${MARKE}-retry`],
    );
    expect(anzahl.rows[0]?.n).toBe("1");
  });

  dbIt("gleicher Schluessel mit anderer Nutzlast ist ein stabiler Konflikt", async () => {
    const repository = repositoryFuer(runnerA, USER_A);
    const basis = {
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_KONFLIKT,
      amountMinorUnits: "5000",
      validFrom: "2032-01-01",
      validTo: null,
      reason: `${MARKE}-konflikt`,
      expectedActiveVersionId: null,
      correlationId: "korr-a",
      idempotencyKey: `${MARKE}-konflikt-key`,
    };
    expect((await repository.append(basis)).ok).toBe(true);

    const anders = await repository.append({ ...basis, amountMinorUnits: "9999" });
    expect(anders.ok).toBe(false);
    if (!anders.ok) expect(anders.problem).toBe("IDEMPOTENCY_KEY_REUSED");

    // Wirkungslosigkeitsnachweis: der abweichende Versuch hat NICHTS
    // geschrieben. Ohne diese Zeile waere der Fall auch dann gruen, wenn er
    // zusaetzlich eine Zeile angelegt haette.
    const anzahl = await admin.query<{ n: string }>(
      `select count(*)::text as n from public.employee_rate_versions where reason = $1`,
      [`${MARKE}-konflikt`],
    );
    expect(anzahl.rows[0]?.n).toBe("1");
  });

  dbIt("derselbe Schluessel kollidiert nicht ueber Organisationen hinweg", async () => {
    const gemeinsamerSchluessel = `${MARKE}-mandant-key`;
    const alpha = await repositoryFuer(runnerA, USER_A).append({
      organisationId: ORG_ALPHA,
      employeeId: EMPLOYEE_MANDANT,
      amountMinorUnits: "6000",
      validFrom: "2033-01-01",
      validTo: null,
      reason: `${MARKE}-mandant-alpha`,
      expectedActiveVersionId: null,
      correlationId: "korr-alpha",
      idempotencyKey: gemeinsamerSchluessel,
    });
    const beta = await repositoryFuer(runnerB, USER_B).append({
      organisationId: ORG_BETA,
      employeeId: EMPLOYEE_BETA,
      amountMinorUnits: "6100",
      validFrom: "2033-01-01",
      validTo: null,
      reason: `${MARKE}-mandant-beta`,
      expectedActiveVersionId: null,
      correlationId: "korr-beta",
      idempotencyKey: gemeinsamerSchluessel,
    });

    // Beide muessen durchgehen: der unique-Index ist auf (org_id, operation,
    // key) und nicht auf den Schluessel allein. Ginge nur einer durch, waere
    // die Mandantentrennung des Schluesselraums verletzt.
    expect(alpha.ok).toBe(true);
    expect(beta.ok).toBe(true);
    if (alpha.ok && beta.ok) expect(alpha.version.id).not.toBe(beta.version.id);

    // Und Alpha darf Betas Auskunft nicht einmal SEHEN. Gegenprobe im selben
    // Aufruf: die eigene Zeile ist sichtbar, sonst pruefte die Zeile darunter
    // nur, dass ueberhaupt nichts sichtbar ist.
    const sicht = await runnerA.run({ userId: USER_A }, async (tx) => {
      const eigene = await tx.query(
        `select 1 from public.idempotency_records where idempotency_key = $1 and org_id = $2`,
        [gemeinsamerSchluessel, ORG_ALPHA],
      );
      const fremde = await tx.query(
        `select 1 from public.idempotency_records where idempotency_key = $1 and org_id = $2`,
        [gemeinsamerSchluessel, ORG_BETA],
      );
      return { eigene: eigene.rowCount, fremde: fremde.rowCount };
    });
    expect(sicht.eigene).toBe(1);
    expect(sicht.fremde).toBe(0);
  });
});
