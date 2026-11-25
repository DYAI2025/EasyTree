#!/usr/bin/env node
/**
 * Ops-Command: isolierter Demo-Mandant (EYT-106, PO-Freigabe 01.08.2026).
 *
 * ## Was dieser Befehl ist — und was er nicht ist
 *
 * Er legt GENAU EINEN synthetischen Demo-Mandanten an: Organisation,
 * Benutzerprojektion, Owner-Membership, ein Mitarbeiter. Nichts davon sind
 * Kundendaten; die Namen sind ausdruecklich als Demo gekennzeichnet.
 *
 * Er ist KEIN Seed und kein Ersatz fuer `seed.sql`: er schreibt genau vier
 * Zeilen, jede mit fester UUID, jede `on conflict do nothing`. Zweimal
 * ausgefuehrt entsteht nichts Zweites — das ist die Zusage, die der
 * `--verify`-Lauf am Ende nachrechnet.
 *
 * ## Warum ein Skript und nicht vier `psql -c`-Aufrufe
 *
 * Vier lose Inserts haben vier Gelegenheiten, halb durchzulaufen: Organisation
 * ohne Membership, Membership ohne Benutzerprojektion. Hier laeuft alles in
 * EINER Transaktion — entweder der Mandant existiert vollstaendig oder gar
 * nicht. Ausserdem validiert der Befehl seine Eingaben, statt sie zu glauben.
 *
 * ## Was hier NICHT passiert
 *
 * Kein Stundensatz. Der entsteht ausschliesslich ueber die Weboberflaeche —
 * sonst waere der Nachweis "die UI schreibt wirklich" wertlos (PO-Vorgabe).
 * Kein Passwort, kein Token, kein Schluessel erscheint in Ausgabe oder Log.
 *
 * ## Aufruf
 *
 *   node scripts/ops/bootstrap-demo-tenant.mjs --user-id <uuid> [--verify]
 *
 * Die Auth-Identitaet wird vorher ueber die Supabase-Admin-API angelegt; ihre
 * ID kommt hier herein. Diese Trennung ist Absicht: die Datenbankseite kennt
 * keinen Admin-Schluessel.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

/**
 * `pg` liegt in `apps/api`, dieses Skript in `scripts/ops` — und ESM loest
 * Abhaengigkeiten relativ zur DATEI auf, nicht zum Arbeitsverzeichnis. Der
 * Treiber wird deshalb ausdruecklich am API-Paket verankert, statt das Skript
 * an einen Ort zu verschieben, an den es fachlich nicht gehoert.
 */
const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { Client } = require("pg");

/** Feste IDs — damit ein zweiter Lauf dieselben Zeilen trifft, nicht neue. */
const DEMO = {
  organisationId: "00000000-0000-4000-8000-00000de70001",
  organisationName: "EasyTree Demo",
  employeeId: "00000000-0000-4000-8000-00000de70011",
  employeeName: "Demo-Mitarbeiter 01",
  membershipId: "00000000-0000-4000-8000-00000de70021",
  zweck: "Kundendemonstration und Abnahmetest",
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main() {
  const userId = argument("user-id");
  const nurPruefen = process.argv.includes("--verify");

  if (userId === null || !UUID_V4.test(userId)) {
    throw new Error("--user-id fehlt oder ist keine UUID v4.");
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL fehlt.");
  }
  const sslRootCert = process.env["DATABASE_SSL_ROOT_CERT_PATH"];

  const client = new Client({
    connectionString: databaseUrl.split("?")[0],
    ...(sslRootCert === undefined
      ? {}
      : { ssl: { ca: readFileSync(sslRootCert, "utf8"), rejectUnauthorized: true } }),
  });
  await client.connect();

  try {
    if (!nurPruefen) {
      await client.query("begin");
      // Benutzerprojektion: public.users spiegelt auth.users. Ohne sie
      // scheitert die Membership am Fremdschluessel.
      await client.query(
        `insert into public.users (id, display_name)
         values ($1, 'Demo-Owner')
         on conflict (id) do nothing`,
        [userId],
      );
      await client.query(
        `insert into public.organizations (id, name)
         values ($1, $2)
         on conflict (id) do nothing`,
        [DEMO.organisationId, DEMO.organisationName],
      );
      await client.query(
        `insert into public.memberships (id, org_id, user_id, role, active)
         values ($1, $2, $3, 'owner', true)
         on conflict (org_id, user_id) do nothing`,
        [DEMO.membershipId, DEMO.organisationId, userId],
      );
      await client.query(
        `insert into public.employees (id, org_id, user_id, display_name, active)
         values ($1, $2, null, $3, true)
         on conflict (id) do nothing`,
        [DEMO.employeeId, DEMO.organisationId, DEMO.employeeName],
      );
      await client.query("commit");
    }

    // Nachrechnen statt behaupten: genau eine Zeile je Gegenstand.
    const zaehler = await client.query(
      `select
         (select count(*) from public.organizations where id = $1) as orgs,
         (select count(*) from public.organizations) as orgs_gesamt,
         (select count(*) from public.memberships where org_id = $1) as memberships,
         (select count(*) from public.employees where org_id = $1) as mitarbeiter,
         (select count(*) from public.users where id = $2) as projektionen,
         (select count(*) from public.employee_rate_versions) as saetze,
         (select role from public.memberships where org_id = $1 and user_id = $2) as rolle`,
      [DEMO.organisationId, userId],
    );
    const z = zaehler.rows[0];
    const bericht = {
      modus: nurPruefen ? "verify" : "bootstrap",
      zweck: DEMO.zweck,
      organisationId: DEMO.organisationId,
      organisationName: DEMO.organisationName,
      employeeId: DEMO.employeeId,
      employeeName: DEMO.employeeName,
      membershipId: DEMO.membershipId,
      rolle: z.rolle,
      organisationen_gesamt: Number(z.orgs_gesamt),
      demo_organisationen: Number(z.orgs),
      memberships: Number(z.memberships),
      mitarbeiter: Number(z.mitarbeiter),
      benutzerprojektionen: Number(z.projektionen),
      stundensatzversionen: Number(z.saetze),
    };
    console.log(JSON.stringify(bericht, null, 2));

    const idempotent =
      bericht.demo_organisationen === 1 &&
      bericht.memberships === 1 &&
      bericht.mitarbeiter === 1 &&
      bericht.benutzerprojektionen === 1 &&
      bericht.rolle === "owner";
    if (!idempotent) {
      throw new Error("Bootstrap nicht im erwarteten Zustand — siehe Bericht oben.");
    }
    if (bericht.stundensatzversionen !== 0) {
      throw new Error(
        "Es existiert bereits eine Stundensatzversion. Der Bootstrap legt bewusst keine an.",
      );
    }
  } catch (fehler) {
    if (!nurPruefen) await client.query("rollback").catch(() => undefined);
    throw fehler;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((fehler) => {
  console.error(`FEHLER: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
  process.exitCode = 1;
});
