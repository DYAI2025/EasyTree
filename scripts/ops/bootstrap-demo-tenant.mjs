#!/usr/bin/env node
/**
 * Ops-Command: isolierter Demo-Mandant (EYT-106, PO-Freigabe 01.08.2026;
 * nachgeführt EYT-142, 26.08.2026).
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
 * Er ist auch NICHT die Journey-Fixture: die Testdaten der Staging-Kernreise
 * (Org "E2E Reiseorganisation" `…e201`, Mitarbeiter `…e211`/`…e212`) kommen
 * aus `apps/web/e2e/auth-journey/fixtures.sql` — Runbook §5 beschreibt den
 * Weg. Zwei Mechanismen fuer dieselben Zeilen waeren zwei Wahrheiten.
 *
 * ## Herkunft dieser Datei
 *
 * Erstmals ausgefuehrt am 24.08.2026 gegen die VPS-Staging-Grenze (Protokoll
 * `docs/plans/2026-08-24-vps-staging-deploy-protokoll.md`, §Demo-Mandant) —
 * damals als lokales, nicht eingechecktes Skript. Diese eingecheckte Fassung
 * rekonstruiert das dokumentierte Verhalten und ergaenzt zwei Dinge: die
 * Zaehlung der Satzversionen ist auf den Demo-Mandanten eingegrenzt (die alte
 * Fassung zaehlte tabellenweit und ging rot, sobald IRGENDEINE Organisation
 * einen Satz hatte), und ein Produktionsziel wird fail-closed verweigert.
 *
 * ## Was hier NICHT passiert
 *
 * Kein Stundensatz. Der entsteht ausschliesslich ueber die Weboberflaeche —
 * sonst waere der Nachweis "die UI schreibt wirklich" wertlos (PO-Vorgabe).
 * Kein Passwort, kein Token, kein Schluessel steht in dieser Datei oder
 * erscheint in Ausgabe oder Log; die Verbindung kommt ausschliesslich aus
 * der Umgebungsvariable `DATABASE_URL`.
 *
 * ## Fail-closed gegen Produktion
 *
 * Dieses Skript ist ausschliesslich fuer Nicht-Produktions-Grenzen (lokaler
 * Supabase-CLI-Stack, VPS-Staging). Es verweigert jede `DATABASE_URL`, die
 * das Produktionsprojekt nennt oder auf einen Supabase-**Cloud**-Host zeigt:
 * eine cloudseitige Staging-Grenze existiert nicht
 * (`BLOCKER_ENVIRONMENT_SEPARATION`, Runbook §1) — ein Cloud-Ziel ist hier
 * also entweder die Produktion oder ein Irrtum, und beides bricht ab.
 *
 * ## Aufruf
 *
 *   node scripts/ops/bootstrap-demo-tenant.mjs --user-id <uuid> [--verify]
 *
 * Die Auth-Identitaet wird vorher ueber die Supabase-Admin-API angelegt; ihre
 * ID kommt hier herein. Diese Trennung ist Absicht: die Datenbankseite kennt
 * keinen Admin-Schluessel. `--verify` schreibt nichts und rechnet nur nach.
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

/** project_ref der Produktion (Runbook §1) — niemals Ziel dieses Skripts. */
const PRODUKTIONS_REF = "inypnrvpawvhgiyagxbd";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/**
 * Wirft bei jedem Ziel, das Produktion sein koennte. Bewusst grob: die
 * Produktions-Ref irgendwo in der URL (direkter Host, Pooler-Benutzername)
 * reicht zum Abbruch, ebenso jeder Supabase-Cloud-Host — es gibt keine
 * freigegebene Cloud-Staging-Grenze, gegen die dieses Skript laufen duerfte.
 */
function pruefeNichtProduktion(databaseUrl) {
  if (databaseUrl.includes(PRODUKTIONS_REF)) {
    throw new Error(
      "DATABASE_URL nennt das Produktionsprojekt — dieses Skript laeuft ausschliesslich " +
        "gegen Nicht-Produktions-Grenzen (Runbook §1). Abbruch.",
    );
  }
  let host = "";
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL ist keine parsbare URL.");
  }
  if (host.endsWith(".supabase.co") || host.endsWith(".supabase.com")) {
    throw new Error(
      `DATABASE_URL zeigt auf den Supabase-Cloud-Host "${host}". Eine cloudseitige ` +
        "Staging-Grenze existiert nicht (BLOCKER_ENVIRONMENT_SEPARATION) — ein Cloud-Ziel " +
        "ist Produktion oder Irrtum. Abbruch.",
    );
  }
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
  pruefeNichtProduktion(databaseUrl);
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

    // Nachrechnen statt behaupten: genau eine Zeile je Gegenstand. Die
    // Satzversionen sind auf den Demo-Mandanten eingegrenzt — andere
    // Organisationen (etwa die Journey-Fixture) duerfen Saetze haben, ohne
    // dass dieser Verify luegt oder faelschlich rot geht.
    const zaehler = await client.query(
      `select
         (select count(*) from public.organizations where id = $1) as orgs,
         (select count(*) from public.organizations) as orgs_gesamt,
         (select count(*) from public.memberships where org_id = $1) as memberships,
         (select count(*) from public.employees where org_id = $1) as mitarbeiter,
         (select count(*) from public.users where id = $2) as projektionen,
         (select count(*) from public.employee_rate_versions where org_id = $1) as saetze,
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
      stundensatzversionen_demo_org: Number(z.saetze),
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
    if (bericht.stundensatzversionen_demo_org !== 0) {
      throw new Error(
        "Der Demo-Mandant traegt bereits eine Stundensatzversion. Der Bootstrap legt bewusst " +
          "keine an — Saetze entstehen ausschliesslich ueber die Weboberflaeche.",
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
