# EYT-136 — Planungs-Data-API-Grenze bis READY_FOR_PO_REVIEW

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Den offenen Zwischenstand von PR #56 so fertigstellen, dass die Data-API-Schreibgrenze
der Planung durch einen echten PostgREST-Angriffsweg im Pflicht-CI belegt ist, jede tragende
Zusicherung eine **ausgeführte** Gegenmutation hat und alle elf Checks auf exakt einem finalen
PR-Head grün sind — ohne Merge, ohne Jira-Done.

**Architecture:** Migration `0017` bindet `assignments`-INSERT und `plan_versions`-INSERT an
`app.is_runtime_channel()` + `planning.write` und entzieht `assignments` UPDATE/DELETE samt
Policy. Damit ist die Sicherheitsgrenze an die **Login-Rolle** `easytree_app` gekoppelt. Der
Nachweis braucht deshalb drei streng getrennte Kanäle: eine Verwaltungsverbindung (`postgres`,
nur Fixtures/Beobachtung), den Laufzeitkanal (`easytree_app`, nur Domain-Commands) und einen
echten PostgREST-Client (GoTrue-Login + Bearer-Token, der Angriff). Der aktuelle rote
`db-gates`-Lauf ist ein Harness-Fehler genau dieser Trennung, kein Migrationsfehler.

**Tech Stack:** PostgreSQL 17 / Supabase (PostgREST + GoTrue), pgTAP, Vitest + `pg`,
Playwright, GitHub Actions. Node 22, pnpm 10.28.0.

---

## Gemessener Ausgangszustand (08.08.2026, live verifiziert)

| Gegenstand | Wert | Quelle |
|---|---|---|
| `origin/master` | `aad46ddca12abf1c4862e70248f61978dcce96e7` | `git rev-parse origin/master` |
| PR #56 | OPEN, DRAFT, `fix/eyt-136-planning-data-api-boundary`, Head `60a3ce36f026401670d16be35b7ac78fd8102d9b`, `mergeStateStatus: BLOCKED` | `gh pr view 56` |
| PR #56 Checks | 10 grün, **`db-gates` rot**, Lauf `31222989167` | `gh pr checks 56` |
| PR #57 | OPEN, DRAFT, `proof/eyt-136-red-baseline`, Head `cd0a1d3ed093bce23ca49a453c253afdd85117c3`, ändert **nur** `supabase/tests/0012_planning_data_api_boundary.sql` | `gh pr view 57` |
| PR #57 Checks | 11 grün außer `db-gates` rot, Lauf `31222568290` | `gh pr checks 57` |
| Jira EYT-136 | `In Arbeit`, Priority `Highest`, `EYT Sprint 5` (aktiv), Task | `getJiraIssue` |
| Lokaler Worktree | HEAD == PR-#56-Head, 0 ahead / 5 behind `origin/master` | `git rev-list --left-right --count` |

**Alle Handoff-Angaben stimmen.** Keine Abweichung zu dokumentieren.

### Der konkrete rote Befund

`db-gates` bricht im Schritt *Planning write gate* ab:

```
[planning-write] mode=required executed=10 passed=2 skipped=0
Error: [planning-write] fail-closed: 8 von 10 Pflichttests sind nicht bestanden (EYT-92).
error: permission denied for table assignments
error: permission denied for table audit_events
```

Ursache: `neueVerbindung()` liefert seit dem letzten Commit den Laufzeitkanal (`easytree_app`,
`NOINHERIT`, ohne `set local role` also **rechtelos**). Mehrere Testkörper stellen damit weiterhin
**rohe** Beobachtungsabfragen (`select count(*) from public.assignments`, `audit_events`,
`update public.employees …`). Das ist ein Harness-Fehler. `planning-publish.integration.test.ts`
hat dieselbe Umstellung mit EYT-107 bereits korrekt gelöst und ist die Vorlage.

### Dadurch nie gelaufen (db-gates bricht ab)

`Planning publish gate`, `Cost access gate`, `Rate timestamp contract gate`,
`Rate succession gate`, `Resolve pooler URL + pre-flight`,
`Tenant isolation gate (TRANSACTION POOLER)`, `API smoke — healthy runtime`,
`API smoke — refuses to start when the role cannot be verified`,
`API smoke — refuses to start as superuser`, `Worker smoke`.

### Die eigentliche Lücke: AK9 ist unerfüllt

Der grüne `auth-journey` beweist EYT-136 **nicht**. Er enthält die EYT-107-Angriffe
(Schritt 9c2: PATCH `plan_versions` publish; Schritt 9c3: POST `plan_versions` **mit**
`published_at`), aber keinen EYT-136-Angriff:

* kein `assignments` INSERT/UPDATE/DELETE über PostgREST,
* kein **Entwurfs**-INSERT auf `plan_versions` (ohne `published_at`) — genau der Weg, der auf
  der Baseline offen ist, weil `published_at is null` die alte Policy erfüllt,
* kein Akteur mit der Rolle `member` (Jira-AK nennt ihn ausdrücklich).

---

## Drei Kanäle, drei Bedeutungen — die Regel dieses Plans

| Kanal | Verbindung / Client | Wofür ausschließlich |
|---|---|---|
| **Beobachter** | `EASYTREE_TEST_DB_URL` (`postgres`) bzw. `EASYTREE_JOURNEY_ADMIN_DB_URL` | Fixtures, Aufräumen, Zählen, Persistenzprüfung |
| **Laufzeitkanal** | `EASYTREE_TEST_APP_DB_URL` (`easytree_app`) | ausschließlich Domain-Commands, immer durch `runnerAuf(...).run(...)` |
| **Angreifer** | GoTrue-Login → Bearer-Token → PostgREST (`authenticator`) | ausschließlich Data-API-Angriffe |

**Verboten:** `easytree_app` zusätzliche Tabellenrechte geben, damit ein Testkörper wieder
durchläuft. Beobachtung gehört auf den Beobachter.

---

## Task 1 — Planning-Write-Harness: Kanäle sauber trennen

**Files:**
- Modify: `apps/api/test/planning-write.integration.test.ts`
- Vorlage (nur lesen, nicht ändern): `apps/api/test/planning-publish.integration.test.ts:235-320,760-800`

### Step 1.1: Vorlage lesen

```bash
sed -n '225,330p' apps/api/test/planning-publish.integration.test.ts
sed -n '755,800p' apps/api/test/planning-publish.integration.test.ts
```

Erwartet: `neueAdminVerbindung()` liefert `postgres`, `neueVerbindung()` liefert `easytree_app`,
**jede** rohe Abfrage läuft über das Modul-Level `admin`, und ein eigener Fall misst
`session_user` / `current_user` / `app.is_runtime_channel()` innerhalb des Runners.

### Step 1.2: Alle rohen Abfragen im Testkörper finden

```bash
grep -n "client\.query\|\ba\.query\|\bb\.query" apps/api/test/planning-write.integration.test.ts
```

Erwartet (Stand `60a3ce3`) — diese Zeilen laufen auf dem Laufzeitkanal und müssen auf den
Beobachter umziehen:

| Zeile | Abfrage | Tabelle |
|---|---|---|
| 376 | `select count(*) as n` | `assignments` |
| 384 | `select count(*) as n` | `outbox_messages` |
| 413 | `select subject_id, actor_user_id` | `audit_events` |
| 423 | `select payload` | `outbox_messages` |
| 481 | Schleife über drei `select count(*)` | `assignments`, `audit_events`, `outbox_messages` |
| 569 | `select … as n` (Entwurfsstand) | `assignments` |
| 687 | `update public.employees set active = false` | `employees` |
| 697 | `update public.employees set active = true` | `employees` |

Die Zeilen 122–139 (`runnerAuf`) bleiben unverändert — das ist der Runner selbst.

### Step 1.3: Beobachter-Helfer einführen

In `apps/api/test/planning-write.integration.test.ts` direkt nach `adminVerbindung()` einfügen:

```ts
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
```

### Step 1.4: Jede Beobachtung umstellen

Beispiel für Zeile 376 (die anderen analog):

```ts
// vorher
const anzahl = await client.query<{ n: string }>(
  `select count(*) as n from public.assignments
    where plan_version_id in (select id from public.plan_versions
                               where org_id = $1 and week_key = $2)`,
  [ORG_ALPHA, WOCHE],
);
expect(anzahl.rows[0]?.n).toBe("1");

// nachher
const anzahl = await beobachte<{ n: string }>(
  `select count(*) as n from public.assignments
    where plan_version_id in (select id from public.plan_versions
                               where org_id = $1 and week_key = $2)`,
  [ORG_ALPHA, WOCHE],
);
expect(anzahl[0]?.n).toBe("1");
```

Für Zeile 687/697 (`update public.employees`) ebenso: der Beobachter ist auch der einzige
Kanal, der Stammdaten für die Fixture umschalten darf.

### Step 1.5: Positiven Laufzeitnachweis ergänzen

Am Ende des `describe`-Blocks, vor der schließenden Klammer:

```ts
/**
 * Der Vertrag selbst, nicht seine Wirkung (EYT-136).
 *
 * Alle anderen Faelle wuerden auch dann gruen, wenn der Command versehentlich
 * ueber `postgres` liefe — sie messen Ergebnisse, nicht den Kanal. Dieser Fall
 * misst den Kanal: `session_user` ist die LOGINrolle und laesst sich durch
 * `set local role` nicht faelschen, `current_user` ist die gewechselte Rolle.
 * Genau dieses Paar verlangt `app.is_runtime_channel()` in den Insert-Policies
 * aus Migration 0017.
 */
dbIt("der Entwurfspfad laeuft auf dem Laufzeitkanal, nicht als postgres", async () => {
  const client = await neueVerbindung();
  const zeile = await runnerAuf(client).run({ userId: USER_A }, async (tx) => {
    const r = await tx.query<{
      session_user: string;
      current_user: string;
      runtime: boolean;
    }>("select session_user, current_user, app.is_runtime_channel() as runtime");
    return r.rows[0];
  });

  process.stdout.write(
    `[planning-write] session_user=${zeile?.session_user ?? "?"} ` +
      `current_user=${zeile?.current_user ?? "?"} ` +
      `runtime_channel=${String(zeile?.runtime ?? false)}\n`,
  );

  expect(zeile?.session_user).toBe("easytree_app");
  expect(zeile?.current_user).toBe("authenticated");
  expect(zeile?.runtime).toBe(true);
});
```

### Step 1.6: Negativen Rechtenachweis auf dem Laufzeitkanal ergänzen (Ziel von GM2)

Dieser Fall fehlt heute vollständig: er ist der einzige, der das Recht `planning.write`
**auf dem Laufzeitkanal** misst. Über PostgREST ist er nicht messbar, weil dort schon der
Kanalriegel greift.

Konstanten oben ergänzen:

```ts
/** Aktives Mitglied ohne planning.write — als Fixture angelegt, nicht im Seed. */
const USER_MITGLIED_ALPHA = "00000000-0000-4000-8000-00000000dd44";
const MITGLIEDSCHAFT_MITGLIED = "00000000-0000-4000-8000-0000000e0dd4";
```

In `beforeAll`, nach `await neueAdminVerbindung()`:

```ts
// Aktives Mitglied der Organisation Alpha OHNE planning.write. Bewusst als
// Fixture und nicht in seed.sql: der Seed wird von mehreren Suiten gezaehlt,
// eine zusaetzliche Zeile dort aendert fremde Erwartungen.
// `USER_C` aus dem Seed traegt zwar die Rolle `member`, ist aber INAKTIV —
// er wuerde an der Mitgliedschaft scheitern, nicht am Recht, und der Test
// wuerde den falschen Riegel messen.
await adminVerbindung().query(
  "insert into public.users (id, display_name) values ($1, $2) on conflict (id) do nothing",
  [USER_MITGLIED_ALPHA, "Mitglied Alpha (EYT-136 Fixture)"],
);
await adminVerbindung().query(
  `insert into public.memberships (id, org_id, user_id, role, active)
   values ($1, $2, $3, 'member', true)
   on conflict (org_id, user_id) do update set role = 'member', active = true`,
  [MITGLIEDSCHAFT_MITGLIED, ORG_ALPHA, USER_MITGLIED_ALPHA],
);
```

In `afterAll`, vor dem `employees`-Delete:

```ts
await admin.query("delete from public.memberships where id = $1", [MITGLIEDSCHAFT_MITGLIED]);
await admin.query("delete from public.users where id = $1", [USER_MITGLIED_ALPHA]);
```

Und der Fall selbst:

```ts
/**
 * Recht UND Kanal — hier faellt allein das Recht (EYT-136).
 *
 * Nicht-Vakuositaet zuerst: dieselbe Verbindung, derselbe Runner, derselbe
 * Command sind fuer USER_A gruen (Faelle oben). Was sich unterscheidet, ist
 * ausschliesslich die Rolle des Subjekts. Die Mitgliedschaft ist AKTIV und
 * dieselbe Organisation — sonst schuege die Tenant-Bedingung zu, nicht die
 * Rechtebedingung, und der Test bewiese den falschen Riegel.
 */
dbIt("ein aktives Mitglied ohne planning.write legt auch ueber den Laufzeitkanal nichts an", async () => {
  const belegRecht = await beobachte<{ n: string }>(
    `select count(*) as n from public.role_permissions
      where role = 'member' and permission = 'planning.write'`,
  );
  expect(belegRecht[0]?.n, "member traegt planning.write — die Praemisse stimmt nicht").toBe("0");

  const client = await neueVerbindung();
  await raeumeWoche(WOCHE);
  const repo = new PlanningWriteRepository(
    runnerAuf(client),
    USER_MITGLIED_ALPHA,
    wochenschluessel,
    idempotenzSpeicher,
  );

  let fehler: DatabaseError | null = null;
  try {
    await repo.createAssignment(anfrage(`eyt136-member-${Date.now()}`));
  } catch (e) {
    fehler = e as DatabaseError;
  }

  expect(fehler, "das Mitglied konnte einen Entwurf anlegen").not.toBeNull();
  expect(fehler?.code).toBe("42501");

  const danach = await beobachte<{ n: string }>(
    `select count(*) as n from public.assignments
      where plan_version_id in (select id from public.plan_versions
                                 where org_id = $1 and week_key = $2)`,
    [ORG_ALPHA, WOCHE],
  );
  expect(danach[0]?.n, "trotz Fehler ist eine Zuweisung entstanden").toBe("0");
});
```

> `anfrage(...)` ist der im File bereits vorhandene Anfragen-Erzeuger. Beim Ausführen den
> tatsächlichen Namen aus der Datei übernehmen und diese Zeile entsprechend anpassen.

### Step 1.7: Lokal typprüfen (die DB läuft hier nicht)

```bash
pnpm --filter @easytree/config build
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/domain build
pnpm --filter @easytree/api exec tsc --noEmit -p tsconfig.json
pnpm exec prettier --check apps packages docs supabase .github
```

Erwartet: beide ohne Fehler. **Eine grüne Typprüfung ist kein Ausführungsnachweis** —
die Datenbank läuft ausschließlich in CI.

### Step 1.8: Commit und Push

```bash
git add apps/api/test/planning-write.integration.test.ts
git diff --cached --name-only
git commit -m "test(db): EYT-136 — Beobachtung und Laufzeitkanal im Schreibgate trennen"
git push origin fix/eyt-136-planning-data-api-boundary
```

Erwartet in `git diff --cached --name-only`: **genau eine** Datei.

### Step 1.9: CI messen

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 2400
gh pr checks 56
```

Erwartet: `db-gates` grün. Im Log muss stehen:

```
[planning-write] mode=required executed=12 passed=12 skipped=0
[planning-write] session_user=easytree_app current_user=authenticated runtime_channel=true
```

Wird jetzt ein **anderer** Schritt rot (publish, cost, rate, pooler, smokes), diagnostizieren —
**nicht** Migration 0017 abschwächen.

---

## Task 2 — Bestehende pgTAP-Aussagen: erschöpfende Kanalmatrix statt Stichprobe

PR #56 ändert `0004_core_domain.sql`, `0006_planning_invariants.sql` und
`0007_temporal_and_idempotency.sql`. Diese Änderungen wechseln den Ausführungskanal von
`authenticated` auf den Eigentümerpfad. Das ist zulässig — eine neue Grenze darf einen alten
Test zwingen, den Kanal zu wechseln. Sie darf ihn nicht zwingen, seine Aussage zu verlieren.

**Files:**
- Review: `supabase/tests/0004_core_domain.sql`, `supabase/tests/0006_planning_invariants.sql`,
  `supabase/tests/0007_temporal_and_idempotency.sql`
- Create: `docs/reviews/2026-08-08-eyt-136-kanalmatrix.md`

### Step 2.1: Vollständige Matrix erzeugen, nicht stichprobenartig prüfen

```bash
for f in 0004_core_domain 0006_planning_invariants 0007_temporal_and_idempotency; do
  echo "=== $f ==="
  grep -n "set local role\|reset role\|select \(ok\|is\|throws_ok\|lives_ok\|plan\)(" \
    "supabase/tests/$f.sql"
done
```

Aus der Ausgabe für **jede** Assertion in Ausführungsreihenfolge eintragen: aktive Rolle
(`authenticated` oder Eigentümer), Aussage, Kanal vorher, Kanal nachher.

### Step 2.2: Die vier bekannten Risikostellen einzeln entscheiden

| # | Stelle | Was zu prüfen ist |
|---|---|---|
| R1 | `0004_core_domain.sql:~203` — neues nacktes `reset role;` | In welcher Rolle lief die Datei vorher an dieser Stelle, und läuft nach dem `reset` eine Assertion, die `authenticated` **braucht**? Falls ja: nach dem Fall `set local role authenticated;` wiederherstellen. |
| R2 | `0006:~52` — `has_column_privilege(starts_at_utc,'update')` von `true` auf `false` gedreht | Die alte Zeile war die **Gegenprobe** zur Zeile darüber. Ist die Zeile darüber jetzt vakuös? Belegen, dass eine positive Spaltenrechtaussage (`insert` auf `starts_at_utc` = `true`) im selben File oder in `0012` A1/A3 tatsächlich existiert und positiv prüft. Sonst neue Gegenprobe ergänzen. |
| R3 | `0006:~94` und `0006:~340` — entfernte `set local role authenticated` | Für jede nachfolgende Assertion bis zum nächsten Rollenwechsel: war die Aussage über den Client-Kanal oder über Constraint/Trigger? Nur letztere darf umziehen. |
| R4 | `0007` — vier `set local role authenticated` durch Kommentar ersetzt | Dasselbe. Zusätzlich: läuft danach noch eine Assertion, die `app.current_user_id()` benötigt? Der Eigentümerpfad liefert dort weiterhin die gesetzte JWT-Claim, das ist zu belegen, nicht anzunehmen. |

Für R2 zuerst nachsehen:

```bash
grep -n "A1\|A3" supabase/tests/0012_planning_data_api_boundary.sql
sed -n '44,80p' supabase/tests/0012_planning_data_api_boundary.sql
```

### Step 2.3: Ergebnis schreiben

`docs/reviews/2026-08-08-eyt-136-kanalmatrix.md` mit einer Zeile je geänderter Assertion:

```markdown
| Datei:Zeile | Alte Aussage | Warum nach 0017 nicht mehr in dieser Form messbar | Wo dieselbe Invariante jetzt bewiesen wird |
```

Jede Zeile braucht einen konkreten neuen Fundort — „ist ohnehin abgedeckt" ist keine Antwort.

### Step 2.4: Gefundene Schwächungen korrigieren

Falls R1–R4 eine verlorene Aussage ergeben: ergänzen, **nicht** die Erwartung anpassen.
`plan(N)` in der betroffenen Datei mitziehen.

### Step 2.5: Commit

```bash
git add supabase/tests docs/reviews/2026-08-08-eyt-136-kanalmatrix.md
git diff --cached --name-only
git commit -m "test(db): EYT-136 — Kanalmatrix der umgezogenen pgTAP-Aussagen belegen"
```

---

## Task 3 — Echter PostgREST-Angriffsweg im Pflichtpfad `auth-journey`

Der Angriff kommt in den **bestehenden** `auth-journey`-Job. Kein neuer Job — ein neuer Job
wäre kein Pflichtcheck und `scripts/setup-branch-protection.sh` meldete Drift.

### Warum zwei Akteure

> **Korrektur 08.08.2026:** eine frühere Fassung dieses Abschnitts nannte den Owner „Akteur B"
> und das Mitglied „Akteur A". Der Code sagt das Gegenteil — der Owner **ist** Reisender A
> (`fixtures.sql`, `journey.pwtest.ts`, `eyt136-member-an.sql`). Maßgeblich ist der Code.

* **Reisender A — Owner mit `planning.write`.** Er beweist den **Kanalriegel**: trotz
  vorhandenem Recht schlägt der direkte Data-API-Schreibzugriff fehl. Ohne ihn wäre der ganze
  Nachweis vakuös — man hätte nur gezeigt, dass ein Rechtloser nichts darf.
* **Reisender B — `member` mit geliehener Mitgliedschaft, ohne `planning.write`.** Er beweist
  die Rechtegrenze für `assignments` (INSERT/UPDATE/DELETE) und `plan_versions`.

### PO-Entscheidung 08.08.2026 — Steps 3.1 bis 3.3 sind überholt

Der ursprüngliche Entwurf legte für Akteur A einen **dritten** GoTrue-Benutzer an. Das ist
nicht nötig und wurde vom Product Owner abgelehnt („keinen weiteren User bauen"). Stattdessen:

* **Akteur A ist der bereits existierende Reisende B** (`auth-journey-b@easytree.test`). Er
  entsteht schon heute über den echten öffentlichen GoTrue-Signup, ist also anmeldbar und hat
  ein gültiges JWT — nur hat er bisher **keine** Mitgliedschaft. Für die Dauer des
  EYT-136-Angriffsschritts bekommt er eine **temporäre aktive `member`-Mitgliedschaft** in der
  Reiseorganisation `…e201`.
* **Akteur B bleibt Reisender A** (Owner, trägt `planning.write`). Unverändert.

Bedingungen des Product Owners, alle zwingend:

1. **Kein Schreibzugriff auf `auth.users` oder `auth.identities`** — nirgends, in keinem Helfer.
2. Die Mitgliedschaft entsteht **unmittelbar vor** dem Angriffsschritt und wird **unmittelbar
   danach** wieder gelöscht — im kleinstmöglichen `try/finally`-Rahmen, **nicht** erst im
   globalen Teardown.
3. Nach dem Löschen wird **nachgesehen**, nicht geglaubt: eine Restzeilenprüfung, die laut
   scheitert, wenn die Zeile überlebt.
4. Solange die Mitgliedschaft existiert, darf **kein** Cross-Tenant-Test laufen. Konkret:
   `journey.pwtest.ts` enthält den Fall „Benutzer B ist angemeldet, aber ohne Mitgliedschaft
   ausgesperrt" als eigenen `test()` **nach** der Hauptreise. Der Angriffsschritt liegt innerhalb
   der Hauptreise, also ist die Reihenfolge erfüllt — das ist zu **belegen**, nicht anzunehmen,
   denn genau dieser Fall würde falsch grün oder falsch rot, wenn die Zeile überlebte.
5. Die temporäre Zeile trägt eine eindeutig testspezifische Id.

**Mechanik:** die Mitgliedschaft wird über `psqlMitMarker` aus `global-setup.ts` gesetzt und
wieder entfernt — der Helfer ist bereits exportiert, erzwingt eine Markerzeile und **wirft**,
wenn sie fehlt. Zwei kleine SQL-Dateien neben den bestehenden:
`apps/web/e2e/auth-journey/eyt136-member-an.sql` und `…-aus.sql`, beide mit
`raise notice '[eyt136-member] …'` als Nachbedingung (`an`: genau eine aktive
`member`-Mitgliedschaft; `aus`: null Restzeilen).

**Vor dem Angriff zu beweisen (Vorgabe des Product Owners, nicht optional):** GoTrue-Login
funktioniert, JWT ist gültig, die Reiseorganisation liegt in `user_org_ids()`, die Mitgliedschaft
ist `active = true` mit Rolle `member`, `has_permission(org,'planning.write')` ist **false**, und
beim direkten PostgREST-Aufruf gilt der Laufzeitkanal **nicht**. Für Akteur B analog, nur mit
`has_permission(org,'planning.write') = true` — genau das macht seinen Fehlschlag zum Beweis
des Kanalriegels statt eines fehlenden Rechts.

**Was das an Steps 3.1–3.3 streicht:** kein dritter Signup in `global-setup.ts`, keine dritte
Projektion und keine dauerhafte `member`-Mitgliedschaft in `fixtures.sql`, kein
`:'reisender_c'` in `teardown.sql`, keine zusätzliche CI-Variable. Was aus Step 3.2 **bleibt**:
die Prämissenprüfung des Rechtemodells (`member` ohne, `owner` mit `planning.write`) — sie
gehört jetzt in `eyt136-member-an.sql`.

### ~~Step 3.1: Dritten echten Benutzer anlegen~~ — ÜBERHOLT, nicht ausführen

**File:** `apps/web/e2e/auth-journey/global-setup.ts`

```ts
export const REISENDER_C = "auth-journey-c@easytree.test";
```

In `globalSetup()`:

```ts
const passwortC = randomBytes(24).toString("base64url");
const idC = await legeBenutzerAn(supabaseUrl, anonKey, REISENDER_C, passwortC);
```

`psqlMitMarker`-Aufruf erweitern:

```ts
["-v", `benutzer_a=${idA}`, "-v", `benutzer_b=${idB}`, "-v", `benutzer_c=${idC}`],
```

und am Ende:

```ts
process.env["EASYTREE_JOURNEY_EMAIL_C"] = REISENDER_C;
process.env["EASYTREE_JOURNEY_PASSWORT_C"] = passwortC;
process.env["EASYTREE_JOURNEY_USER_C"] = idC;

console.log(
  "[auth-journey-setup] drei echte Benutzer: A owner, B ohne Mitgliedschaft, C member (EYT-136).",
);
```

### ~~Step 3.2: Fixture erweitern~~ — ÜBERHOLT bis auf die Prämissenprüfung des Rechtemodells

**File:** `apps/web/e2e/auth-journey/fixtures.sql`

`public.users`-Insert um C ergänzen:

```sql
insert into public.users (id, display_name)
values (:'benutzer_a', 'E2E-Reisender A'),
       (:'benutzer_b', 'E2E-Reisender B ohne Mitgliedschaft'),
       (:'benutzer_c', 'E2E-Reisender C mit Rolle member (EYT-136)')
on conflict (id) do nothing;
```

Mitgliedschaft für C:

```sql
-- C ist AKTIVES Mitglied derselben Organisation, Rolle `member`. Er traegt
-- damit weder planning.write noch planning.publish (Migration 0015 vergibt
-- `member` bewusst keine Zeile). Genau diese Konstellation verlangt die
-- Akzeptanzbedingung von EYT-136: ein normal angemeldetes Mitglied darf die
-- Zuweisungen nicht ueber die Data-API veraendern.
insert into public.memberships (id, org_id, user_id, role, active)
values ('00000000-0000-4000-8000-00000000e222',
        '00000000-0000-4000-8000-00000000e201',
        :'benutzer_c', 'member', true)
on conflict (org_id, user_id) do update set role = 'member', active = true;
```

Nachbedingung im `do $$`-Block anpassen — `n_mitglied` zählt bisher nur `role = 'owner'`.
Zwei getrennte Zähler, damit ein vertauschtes Rollenpaar auffällt:

```sql
  select count(*) into n_owner from public.memberships
    where org_id = '00000000-0000-4000-8000-00000000e201' and role = 'owner' and active;
  select count(*) into n_member from public.memberships
    where org_id = '00000000-0000-4000-8000-00000000e201' and role = 'member' and active;
```

`n_projektion` erwartet jetzt **3**. Die Prüfbedingung entsprechend erweitern
(`n_owner <> 1 or n_member <> 1 or n_projektion <> 3 …`) und die Markerzeile mitziehen.

Zusätzlich die **Prämisse des Nachweises** belegen — sonst könnte eine spätere Migration
`member` still `planning.write` geben und der Angriffstest bliebe grün, ohne noch etwas zu
messen:

```sql
  select count(*) into n_recht_member from public.role_permissions
    where role = 'member' and permission = 'planning.write';
  select count(*) into n_recht_owner from public.role_permissions
    where role = 'owner' and permission = 'planning.write';
  -- member OHNE, owner MIT. Andernfalls ist der Angriffsnachweis vakuos:
  -- Akteur B soll trotz Recht scheitern, Akteur A mangels Recht.
  if n_recht_member <> 0 or n_recht_owner <> 1 then
    raise exception 'Rechtemodell passt nicht zum Angriffsnachweis: member=% owner=%',
      n_recht_member, n_recht_owner;
  end if;
```

### ~~Step 3.3: Teardown erweitern~~ — ÜBERHOLT, es entsteht kein dritter Benutzer

**File:** `apps/web/e2e/auth-journey/teardown.sql` — beide Delete-Anweisungen:

```sql
delete from public.users
  where id in (select id from auth.users
                where email in (:'reisender_a', :'reisender_b', :'reisender_c'));
delete from auth.users
  where email in (:'reisender_a', :'reisender_b', :'reisender_c');
```

Die Zählung im `do $$`-Block läuft bereits über das Adressmuster `auth-journey-%` und trifft C
damit automatisch — **verifizieren, nicht annehmen.**

**File:** `apps/web/e2e/auth-journey/global-teardown.ts` — Variable `reisender_c` ergänzen
(Datei zuerst lesen, sie ist 36 Zeilen).

**File:** `.github/workflows/ci.yml`, Schritt *Testdaten entfernen und Leere ZWEIMAL belegen*:

```yaml
              -v reisender_c=auth-journey-c@easytree.test \
```

### Step 3.4: Angriff 9c4 — Akteur B (Owner, MIT `planning.write`)

**File:** `apps/web/e2e/auth-journey/journey.pwtest.ts`, unmittelbar **nach** Schritt 9c3
(`schritte["9c3_postgrest_insert"] = { … }`) und **vor** Schritt 9d. Reihenfolge ist der Punkt:
9d veröffentlicht, danach greift zusätzlich der Unveränderlichkeitstrigger aus 0010 — dann wäre
nicht mehr entscheidbar, welcher Riegel gehalten hat.

```ts
// -----------------------------------------------------------------------
// 9c4 — EYT-136: Kanalriegel TROTZ vorhandenem Recht
// -----------------------------------------------------------------------
// Der entscheidende, nicht-vakuoese Nachweis. Reisender A ist Owner und
// traegt `planning.write` (Migration 0015). Er scheitert hier NICHT an
// einem fehlenden Recht, sondern ausschliesslich daran, dass PostgREST
// sich als `authenticator` anmeldet und `app.is_runtime_channel()` damit
// falsch ist. Genau das ist die Zusicherung von Migration 0017.
//
// Auf der Baseline (bis 0016) gelingen beide Versuche: die alten
// Insert-Policies pruefen nur die Organisation bzw. zusaetzlich
// `published_at is null` — und ein Entwurf hat genau das.
const ENTWURFSWOCHE_ANGRIFF = "2026-W36";

// Nicht-Vakuositaet: dasselbe Token SIEHT die Zuweisungen der eigenen
// Organisation. Ohne diese Zeile bewiese ein 403 nur, dass irgendetwas an
// der Anfrage nicht stimmt.
const sichtbar = await request.get(
  `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id,plan_version_id,starts_at_utc`,
  { headers: restKopf },
);
expect(sichtbar.status(), "der Owner kann die Zuweisungen nicht einmal lesen").toBe(200);
const sichtbareZeilen = (await sichtbar.json()) as { id: string; starts_at_utc: string }[];
expect(sichtbareZeilen.length).toBeGreaterThan(0);

// Angriff 1: eine Zuweisung direkt anlegen.
const zuweisungAnlegen = await request.post(`${supabaseUrl}/rest/v1/assignments`, {
  headers: { ...restKopf, prefer: "return=representation" },
  data: {
    org_id: ORG_ID,
    plan_version_id: entwurfsVersionId,
    employee_id: MITARBEITER_ID,
    worksite_id: BAUSTELLE_ID,
    starts_at_utc: "2026-08-05T06:00:00Z",
    ends_at_utc: "2026-08-05T14:00:00Z",
  },
});
expect(
  zuweisungAnlegen.status(),
  "PostgREST hat eine Zuweisung angelegt — der Kanalriegel aus 0017 greift nicht",
).toBe(403);

// Wirkung statt Status: nachgesehen, nicht geglaubt.
const zuweisungenDanach = await request.get(
  `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id`,
  { headers: restKopf },
);
expect((await zuweisungenDanach.json()) as unknown[]).toHaveLength(sichtbareZeilen.length);

// Angriff 2: eine ENTWURFS-Planversion direkt anlegen — ohne
// `published_at`. Das ist die Luecke, die 0016 offen gelassen hat: die
// alte Policy verlangte `published_at is null`, und ein Entwurf erfuellt
// das. Eigene, unbenutzte Woche, damit 9d unberuehrt bleibt.
const entwurfAnlegen = await request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
  headers: { ...restKopf, prefer: "return=representation" },
  data: { org_id: ORG_ID, week_key: ENTWURFSWOCHE_ANGRIFF },
});
expect(
  entwurfAnlegen.status(),
  "PostgREST hat eine Entwurfs-Planversion angelegt — der Command ist umgehbar",
).toBe(403);

const entwurfNachsehen = await request.get(
  `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.${ENTWURFSWOCHE_ANGRIFF}&select=id`,
  { headers: restKopf },
);
expect(entwurfNachsehen.status()).toBe(200);
expect((await entwurfNachsehen.json()) as unknown[]).toHaveLength(0);

schritte["9c4_eyt136_owner"] = {
  recht: "planning.write vorhanden",
  assignmentInsert: zuweisungAnlegen.status(),
  planVersionDraftInsert: entwurfAnlegen.status(),
  erwarteterStatus: 403,
  hinweis: "EYT-136 — app.is_runtime_channel() in Migration 0017",
};
```

`MITARBEITER_ID` (`…e211`) und `BAUSTELLE_ID` (`…e241`) als Konstanten oben ergänzen, falls
sie dort noch nicht existieren (`grep -n "e211\|e241" apps/web/e2e/auth-journey/journey.pwtest.ts`).

### Step 3.5: Angriff 9c5 — Akteur A (`member`, OHNE `planning.write`)

> **Angepasst 08.08.2026:** Akteur A ist **Reisender B** mit temporär geliehener
> `member`-Mitgliedschaft, nicht ein dritter Benutzer C. Der gesamte Schritt läuft in einem
> `try/finally`: Mitgliedschaft an → Vorbedingungen beweisen → Angriffe → Persistenz prüfen →
> Mitgliedschaft aus → Restzeilen null. Im Code unten also `EASYTREE_JOURNEY_EMAIL_B` /
> `…_PASSWORT_B` statt `…_C`, und der Fall „Benutzer B ausgesperrt" muss danach weiterhin
> grün sein — er ist die Gegenprobe, dass die Leihe wirklich zurückgegeben wurde.

Direkt anschließend, weiterhin **vor** 9d:

```ts
// -----------------------------------------------------------------------
// 9c5 — EYT-136: das normale Mitglied (Jira-AK, wortwoertlich)
// -----------------------------------------------------------------------
// Eigener GoTrue-Login, eigenes Token. Auf der Baseline gelingen INSERT,
// UPDATE und DELETE: die Policies aus 0007/0010 pruefen ausschliesslich die
// Organisation, und C ist in dieser Organisation.
await test.step("9c5 — ein Mitglied kann die Zuweisungen nicht ueber die Data-API aendern", async () => {
  const emailC = pflicht("EASYTREE_JOURNEY_EMAIL_C");
  const passwortC = pflicht("EASYTREE_JOURNEY_PASSWORT_C");

  const anmeldungC = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey, "content-type": "application/json" },
    data: { email: emailC, password: passwortC },
  });
  expect(anmeldungC.status(), "GoTrue hat fuer C kein Token ausgegeben").toBe(200);
  const tokenC = ((await anmeldungC.json()) as { access_token?: string }).access_token ?? "";
  expect(tokenC).not.toBe("");

  const kopfC = {
    apikey: anonKey,
    authorization: `Bearer ${tokenC}`,
    "content-type": "application/json",
  };

  // Nicht-Vakuositaet in drei Teilen: das Token traegt, C ist im selben
  // Mandanten, und C hat das Recht wirklich nicht.
  const rechtC = await request.get(
    `${supabaseUrl}/rest/v1/role_permissions?role=eq.member&permission=eq.planning.write&select=role`,
    { headers: kopfC },
  );
  expect(rechtC.status()).toBe(200);
  expect(
    (await rechtC.json()) as unknown[],
    "member traegt planning.write — die Praemisse dieses Nachweises stimmt nicht",
  ).toHaveLength(0);

  const zielLesen = await request.get(
    `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id,starts_at_utc`,
    { headers: kopfC },
  );
  expect(zielLesen.status(), "C sieht die Zuweisungen seiner Organisation nicht").toBe(200);
  const ziele = (await zielLesen.json()) as { id: string; starts_at_utc: string }[];
  expect(ziele.length, "kein sichtbares Ziel — der Angriff waere vakuos").toBeGreaterThan(0);
  const ziel = ziele[0]!;

  // INSERT
  const insertC = await request.post(`${supabaseUrl}/rest/v1/assignments`, {
    headers: { ...kopfC, prefer: "return=representation" },
    data: {
      org_id: ORG_ID,
      plan_version_id: entwurfsVersionId,
      employee_id: MITARBEITER_ID,
      worksite_id: BAUSTELLE_ID,
      starts_at_utc: "2026-08-06T06:00:00Z",
      ends_at_utc: "2026-08-06T14:00:00Z",
    },
  });
  expect(insertC.status(), "ein Mitglied hat eine Zuweisung angelegt").toBe(403);

  // UPDATE — die Zeile ist nachweislich sichtbar (oben), das Verschieben
  // scheitert also nicht am Nichtfinden.
  const updateC = await request.patch(
    `${supabaseUrl}/rest/v1/assignments?id=eq.${ziel.id}`,
    {
      headers: { ...kopfC, prefer: "return=representation" },
      data: { starts_at_utc: "2026-08-03T05:00:00Z" },
    },
  );
  expect(updateC.status(), "ein Mitglied hat eine Zuweisung verschoben").toBe(403);

  // DELETE
  const deleteC = await request.delete(`${supabaseUrl}/rest/v1/assignments?id=eq.${ziel.id}`, {
    headers: { ...kopfC, prefer: "return=representation" },
  });
  expect(deleteC.status(), "ein Mitglied hat eine Zuweisung geloescht").toBe(403);

  // Entwurfs-Planversion
  const entwurfC = await request.post(`${supabaseUrl}/rest/v1/plan_versions`, {
    headers: { ...kopfC, prefer: "return=representation" },
    data: { org_id: ORG_ID, week_key: "2026-W37" },
  });
  expect(entwurfC.status(), "ein Mitglied hat eine Planversion angelegt").toBe(403);

  // Persistenz, nicht Statuscode: die Zeile steht unveraendert, und es gibt
  // keine neue. Ein Status allein saehe bei RLS-Filterung auch dann gut aus,
  // wenn PostgREST 200 ueber die leere Menge meldete.
  const nachher = await request.get(
    `${supabaseUrl}/rest/v1/assignments?org_id=eq.${ORG_ID}&select=id,starts_at_utc`,
    { headers: kopfC },
  );
  const zeilenNachher = (await nachher.json()) as { id: string; starts_at_utc: string }[];
  expect(zeilenNachher).toHaveLength(ziele.length);
  expect(zeilenNachher.find((z) => z.id === ziel.id)?.starts_at_utc).toBe(ziel.starts_at_utc);

  const versionenNachher = await request.get(
    `${supabaseUrl}/rest/v1/plan_versions?week_key=eq.2026-W37&select=id`,
    { headers: kopfC },
  );
  expect((await versionenNachher.json()) as unknown[]).toHaveLength(0);

  schritte["9c5_eyt136_member"] = {
    recht: "planning.write NICHT vorhanden",
    assignmentInsert: insertC.status(),
    assignmentUpdate: updateC.status(),
    assignmentDelete: deleteC.status(),
    planVersionDraftInsert: entwurfC.status(),
    erwarteterStatus: 403,
    hinweis: "EYT-136 — Rechte- und Kanalriegel in Migration 0017",
  };
});
```

### Step 3.6: Erwartete Statuscodes einmal messen, dann festschreiben

`403` ist begründet, aber **noch nicht gemessen**: fehlendes Tabellen-/Spaltenrecht ist
SQLSTATE `42501`, und PostgREST bildet `42501` auf HTTP 403 ab (belegt in `journey.pwtest.ts:551`
für 9c3). Beim UPDATE/DELETE fehlt seit 0017 das Recht **vollständig**, deshalb wird geworfen —
anders als in 9c2, wo das Recht existierte und nur die `using`-Klausel filterte (dort: 200 mit
leerer Menge).

**Falls der erste CI-Lauf einen anderen Status meldet:** den gemessenen Wert übernehmen, die
Begründung im Kommentar korrigieren, und die Persistenzprüfung unverändert lassen — sie ist
kanalunabhängig. Den gemessenen Wert samt Lauf-ID im Reviewdokument festhalten.

### Step 3.7: Kopfkommentar der Reise ergänzen

`journey.pwtest.ts` beginnt mit einer Liste „welche Mutation macht welchen Schritt rot"
(Zeilen ~55–70). Die neuen Schritte dort eintragen — sonst verliert genau die Liste ihren Wert,
die die Nichtvakuosität dokumentiert.

### Step 3.8: Commit und CI

```bash
git add apps/web/e2e/auth-journey .github/workflows/ci.yml
git diff --cached --name-only
git commit -m "test(web): EYT-136 — echter PostgREST-Angriffsweg fuer Mitglied und Owner"
git push origin fix/eyt-136-planning-data-api-boundary
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 2400
```

Erwartet: alle elf Checks grün. Im `auth-journey`-Log muss stehen:
`[auth-journey-fixture] projektionen=3 …` und `[auth-journey-teardown] restzeilen=0`.

---

## Task 4 — Roter Nachweis auf der Baseline (PR #57)

Der Angriff aus Task 3 muss auf dem Stand **ohne** Migration 0017 tatsächlich gelingen.
Sonst misst er nichts.

### Step 4.1: Nur die Testnachweise übertragen — niemals 0017

```bash
git checkout proof/eyt-136-red-baseline
git pull --ff-only origin proof/eyt-136-red-baseline
git checkout fix/eyt-136-planning-data-api-boundary -- \
  apps/web/e2e/auth-journey/global-setup.ts \
  apps/web/e2e/auth-journey/global-teardown.ts \
  apps/web/e2e/auth-journey/fixtures.sql \
  apps/web/e2e/auth-journey/teardown.sql \
  apps/web/e2e/auth-journey/journey.pwtest.ts \
  .github/workflows/ci.yml \
  supabase/tests/0012_planning_data_api_boundary.sql
```

**Kontrolle, bevor irgendetwas committet wird:**

```bash
git status --short
ls supabase/migrations | tail -3
git diff --cached --name-only
```

Erwartet: **keine** Datei unter `supabase/migrations/`, insbesondere kein
`20260807220000_0017_planning_write_channel_boundary.sql`. Der `ci.yml`-Übertrag bringt auch
`EASYTREE_TEST_APP_DB_URL` für das Schreibgate mit — das ist auf der Baseline harmlos
(`postgres` erfüllte die alte Policy ohnehin) und hält die Dateien deckungsgleich.

`supabase/tests/0012` wird mitgenommen, damit der TAP-Plan (`plan(18)`) korrekt ist und der
zweite Rotnachweis keine Planfehler mehr enthält.

### Step 4.2: Push und Lauf

```bash
git commit -m "test: EYT-136 — PostgREST-Angriffsweg auf der Baseline messen [WEGWERF]"
git push origin proof/eyt-136-red-baseline
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 2400 || true
gh pr checks 57
```

### Step 4.3: Erwartetes Rotbild und was es belegt

| Job | Erwartung auf der Baseline | Was das belegt |
|---|---|---|
| `db-gates` | `0012` rot mit **12** fachlichen Fehlschlägen, **kein** Planfehler mehr | Rechte-/Policy-Lage vor 0017 |
| `auth-journey` | rot beim **ersten** greifenden Angriff | die Data-API war ein Schreibweg |

Wichtig: Playwright bricht beim ersten fehlgeschlagenen `expect` ab. Der Lauf belegt deshalb
**einen** gelungenen Angriff, nicht alle sechs. Das ist genau so zu berichten. Wer alle sechs
einzeln belegen will, braucht sechs Läufe — für den Rotnachweis genügt der stärkste:

> Reisender A besitzt `planning.write`, sein direkter PostgREST-INSERT auf `assignments`
> (bzw. der Entwurfs-INSERT auf `plan_versions`) **gelingt** ohne den Kanalriegel.

### Step 4.4: Evidenz erfassen

Notieren: PR, Commit-SHA, Run-ID, Job, konkreter Angriff, tatsächliches Ergebnis (HTTP-Status
und angelegte Zeilen). Kommt in Task 6 ins Reviewdokument. **Erst danach** darf der Branch
später entfernt werden. PR #57 wird niemals gemergt.

```bash
git checkout fix/eyt-136-planning-data-api-boundary
```

---

## Task 5 — Gegenmutationen: fünf getrennte Läufe

**Regel:** Jede Mutation lebt auf einem eigenen Wegwerf-Branch vom finalen Feature-Head,
läuft **einmal** durch CI und wird danach gelöscht. Keine Mutation bleibt im finalen PR.
Getrennte Läufe, weil ein fehlgeschlagenes `expect` in Playwright den Rest des Tests abbricht —
zwei Mutationen in einem Lauf bewiesen nur die erste.

### Schema für jede Mutation

```bash
BASIS=$(git rev-parse fix/eyt-136-planning-data-api-boundary)
git checkout -b gm/eyt-136-gmN "$BASIS"
# … Mutation in supabase/migrations/20260807220000_0017_… einspielen …
grep -n "<mutierte Zeile>" supabase/migrations/20260807220000_0017_planning_write_channel_boundary.sql
git commit -am "GEGENMUTATION GMn — NICHT MERGEN"
git push origin gm/eyt-136-gmN
gh pr create --draft --title "[WEGWERF] EYT-136 GMn" --body "Gegenmutation. Niemals mergen."
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 2400 || true
gh run view <id> --log-failed | grep -A5 "<erwarteter Test>"
```

Nach jedem Lauf **die Mutation wirklich prüfen, nicht erinnern** — Ergebnis der obigen
`grep`-Zeile ins Protokoll. Anschließend:

```bash
gh pr close <n> --delete-branch
git checkout fix/eyt-136-planning-data-api-boundary
git branch -D gm/eyt-136-gmN
```

### GM1 — `assignments` INSERT ohne Kanalriegel

Mutation: in Abschnitt 2 von `0017` die Zeile `app.is_runtime_channel()` aus dem
`with check` der Policy `assignments_insert_in_org` entfernen. `planning.write` bleibt.

Erwartet rot: `auth-journey`, Schritt 9c4, Zusicherung
*„PostgREST hat eine Zuweisung angelegt — der Kanalriegel aus 0017 greift nicht"*.
Akteur B hat `planning.write`, der INSERT gelingt jetzt.

**Das ist der stärkste Einzelbeweis für `app.is_runtime_channel()`.**

### GM2a / GM2b — Recht `planning.write` entfernen (zwei getrennte Läufe)

**Angepasst 08.08.2026.** Der ursprüngliche Entwurf hatte für dieses Recht gar kein rotes Ziel
und nannte einen Fall, den es nicht gab. Nach Task 1 gibt es **zwei** Verhaltensziele, weil
`createAssignment` immer zuerst die Entwurfsversion anlegt und ein Mehr-Organisationen-Subjekt
den Command ohnehin nie erreicht (`AMBIGUOUS_ORGANISATION`, `planning-write.repository.ts:359`).
Beide Fälle sind deshalb **rohe** Inserts über den Laufzeitkanal — und das ist die richtige
Bauart, nicht die zweitbeste: `planning.controller.ts:378/:415` prüft `planning.write` bereits
in der Anwendungsschicht, ein Test über den Command hätte also den Anwendungsriegel gemessen.
Der rohe Insert umgeht die Anwendungsschicht vollständig und misst genau die
Unabhängigkeitszusage.

**GM2a — `plan_versions`.** Mutation: in Abschnitt 3 von `0017` die Zeile
`and app.has_permission(org_id, 'planning.write')` aus dem `with check` von
`plan_versions_insert_in_org` entfernen. Kanalriegel und `published_at is null` bleiben.

Erwartet rot: `db-gates`, Schritt *Planning write gate*, Fall
*„ein aktives Mitglied ohne planning.write legt keine Planversion an"*.

**GM2b — `assignments`.** Mutation: dieselbe Zeile aus Abschnitt 2, Policy
`assignments_insert_in_org`. Kanalriegel bleibt.

Erwartet rot: derselbe Schritt, Fall
*„ein aktives Mitglied ohne planning.write haengt auch in einen Entwurf keine Zuweisung"*.

GM2b ist der wichtigere der beiden: bis Task 1 war dieser Riegel **ausschließlich** durch die
Textassertion B3 in `supabase/tests/0012_planning_data_api_boundary.sql:99-104` gedeckt, die
gegen `app.has_permission(org_id,'planning.write') or true` grün geblieben wäre.

Getrennte Läufe, weil beide Fälle im selben vitest-Lauf liegen und der Gate-Bericht
`passed !== executed` wirft — ein gemeinsamer Lauf zeigte nicht, welcher Fall an welcher
Mutation hängt.

`auth-journey` bleibt bei beiden grün. Das ist kein Mangel, sondern die Aussage: Rechteriegel
und Kanalriegel sind unabhängig.

### GM3 — `assignments` UPDATE wieder öffnen

Grant allein genügt nicht — 0017 entfernt auch die Policy, und ohne permissiven Eintrag
verweigert RLS weiterhin. Die Mutation muss beides herstellen: in Abschnitt 1 die Zeilen
`revoke update …` und `drop policy assignments_update_in_org …` entfernen.

Erwartet rot: `auth-journey`, Schritt 9c5, Zusicherung
*„ein Mitglied hat eine Zuweisung verschoben"*.

> Vorher prüfen, dass 9c5 nicht schon beim INSERT (davor) abbricht — GM3 lässt INSERT
> unberührt, der bleibt 403. Reihenfolge im Test ist INSERT → UPDATE → DELETE, das passt.

### GM4 — `assignments` DELETE wieder öffnen

Analog: `revoke delete …` und `drop policy assignments_delete_in_org …` entfernen.

Erwartet rot: 9c5, Zusicherung *„ein Mitglied hat eine Zuweisung geloescht"*.

### GM6 — `app.reject_assignment_in_published_plan()` als `security invoker`

**Neu 08.08.2026, aus Task 2.** Die Kanalmatrix hat belegt, dass PR #56 einen bestehenden
Beweis unbemerkt verloren hat: der Fall in `0006` trug bis dahin die Aussage, dass diese
Triggerfunktion `security definer` sein **muss**, weil ein sperrender Lesezugriff zusätzlich
die `using`-Klausel der UPDATE-Policy auswertet. Auf dem Eigentümerpfad ist diese zweite Last
weg. Die Behauptung des PR, sie sei nach `planning-write.integration.test.ts` umgezogen, ist
**falsch** — nachgerechnet: `USER_A` ist Owner (`seed.sql:46`), Owner trägt `planning.publish`
(`0015:181-187`), die `using`-Klausel (`0015:243-255`) ist für ihn also auch als Invoker
erfüllt.

Mutation: die Funktion in einer Wegwerf-Migration als `security invoker` neu anlegen.

Erwartet rot:
* `db-gates`, pgTAP `0006:311` — die strukturelle `prosecdef`-Zusicherung (Stolperdraht);
* **und**, falls F3 aus Task 2 gelandet ist, der Verhaltensfall im Schreibgate, in dem
  `planning.publish` für die Dauer eines Falls aus `role_permissions` entfernt ist und die
  Zuweisung trotzdem an einer veröffentlichten Planversion scheitern muss.

Eine Mutation, zwei rote Ziele auf zwei Ebenen — genau die Trennung, die ein struktureller
Katalogtest allein nicht liefert.

### GM5 — `plan_versions` INSERT ohne Kanalriegel

Mutation: in Abschnitt 3 die Zeile `app.is_runtime_channel()` aus dem `with check` der
Policy `plan_versions_insert_in_org` entfernen. `planning.write` und `published_at is null`
bleiben.

Erwartet rot: 9c4, Zusicherung
*„PostgREST hat eine Entwurfs-Planversion angelegt — der Command ist umgehbar"*.

> 9c4 prüft zuerst den `assignments`-INSERT. Der bleibt unter GM5 rot-frei (403), der Test
> läuft also bis zur `plan_versions`-Zusicherung durch. Falls doch vorher abgebrochen wird:
> GM5 zusammen mit einem lokal auskommentierten 9c4-INSERT-Block fahren wäre **falsch** —
> stattdessen die `plan_versions`-Zusicherung in einen eigenen `test.step` ziehen, damit
> beide unabhängig messbar sind.

### Protokoll

| Mutation | Branch/SHA | Run-ID | erwarteter roter Test | tatsächliches Ergebnis |
|---|---|---|---|---|
| GM1 — Kanal aus `assignments`-INSERT | | | auth-journey 9c4, assignments INSERT | |
| GM2a — `planning.write` aus `plan_versions`-INSERT | | | db-gates, Fall „Mitglied legt keine Planversion an" | |
| GM2b — `planning.write` aus `assignments`-INSERT | | | db-gates, Fall „Mitglied haengt keine Zuweisung in den Entwurf" | |
| GM3 — `assignments` UPDATE wieder öffnen | | | auth-journey 9c5, assignments UPDATE | |
| GM4 — `assignments` DELETE wieder öffnen | | | auth-journey 9c5, assignments DELETE | |
| GM5 — Kanal aus `plan_versions`-INSERT | | | auth-journey 9c4, plan_versions Entwurf | |
| GM6 — Triggerfunktion als `security invoker` | | | db-gates `0006:311` + ggf. Definer-Verhaltensfall | |

Sieben Läufe, nicht fünf. Jede Zeile braucht eine **ausgeführte** Messung; eine benannte, aber
nie gefahrene Mutation zählt in diesem Repository ausdrücklich nicht.

Wird eine Mutation **nicht** rot: das ist ein Befund über den Test, nicht über die Mutation.
Test nachbessern, erneut messen.

### Step 5.6: Nach dem Block — finalen Diff kontrollieren

```bash
git checkout fix/eyt-136-planning-data-api-boundary
git status --short
git diff origin/master...HEAD -- supabase/migrations/
git branch --list "gm/eyt-136-*"
```

Erwartet: keine `gm/`-Branches, `0017` unverändert gegenüber Task 3, keine Änderung an
`0001`–`0016`.

---

## Task 6 — Dokumentation korrigieren

**Files:**
- Modify: `docs/reviews/2026-08-07-data-api-grant-inventar.md`
- Modify: PR-Body #56

### Step 6.1: Rotnachweis `31222568290` richtig beschreiben

**Nicht:** „14 Security-Tests waren rot."

**Sondern, gemessen:**

* Die Datei lief mit **18 ausgeführten Tests**, deklarierte aber `plan(16)`.
* TAP-Zusammenfassung: `Tests: 18 Failed: 14`, `Failed tests: 2, 4-5, 7-11, 13-18`,
  `Parse errors: Bad plan. You planned 16 tests but ran 18.`
* **Zwölf** davon sind benannte fachliche Fehlschläge:
  `A2` (delete-Recht), `A4` (Spalte `id` im assignments-INSERT-Grant),
  `A5` (Spalte `id` im plan_versions-INSERT-Grant),
  `B1` (drei Schreibpolicies statt einer), `B2` (Kanal in assignments-INSERT-Policy),
  `B3` (`planning.write` in assignments-INSERT-Policy),
  `B4` (Kanal + Recht in plan_versions-INSERT-Policy),
  `B5` (tote DELETE-Policy), `C1`–`C4` (Verhalten: INSERT/UPDATE/DELETE/plan_versions-INSERT).
* Die Zählung `14` enthält zusätzlich die Tests **17 und 18**, die außerhalb des deklarierten
  Plans lagen. Das ist ein Fehler der Testdatei, keine zusätzliche Sicherheitsverletzung.
* Behoben auf dem Feature-Branch (`plan(18)`) und in Task 4 auch auf dem Proof-Branch.

### Step 6.2: PostgREST-Rotnachweis ergänzen

Neuer Abschnitt mit PR, SHA, Run-ID, Job, Akteur, dessen Rechtelage, konkretem Angriff und
tatsächlichem Ergebnis (HTTP-Status, angelegte/geänderte Zeilen). Ausdrücklich vermerken, dass
Playwright beim ersten Fehlschlag abbricht und der Lauf deshalb **einen** gelungenen Angriff
belegt.

### Step 6.3: Weitere Abschnitte

* Kanalmatrix aus Task 2 verlinken.
* Gegenmutationstabelle aus Task 5 (mit echten Run-IDs).
* Gemessene finale Statuscodes je Angriff aus Task 3/7.
* Positive Laufzeitvalidierung: `session_user=easytree_app current_user=authenticated`,
  Run-ID.

### Step 6.4: PR-Body #56 neu schreiben

Zu entfernen/ersetzen:
* alte Zwischenstands-SHAs,
* der Lauf `31222989167` als aktueller Stand,
* jede Formulierung „auth-journey grün", die sich auf den Stand **ohne** EYT-136-Angriff bezog.

```bash
gh pr edit 56 --body-file /tmp/pr56-body.md
gh pr view 56 --json body -q .body | head -40
```

Body erst schreiben, dann zurücklesen, dann senden — externe Mutationen werden gelesen wie
Evidenz.

**PR bleibt Draft**, bis Task 7 vollständig grün ist.

---

## Task 7 — Finaler Lauf, Selbstreview, Übergabe

### Step 7.1: Finalen Stand pushen und einen VOLLSTÄNDIGEN Lauf abwarten

```bash
git fetch origin
git push origin fix/eyt-136-planning-data-api-boundary
FINAL=$(git rev-parse HEAD)
echo "$FINAL"
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$FINAL" 2700
```

Die zehn grünen Checks von `60a3ce36…` zählen **nicht mehr**. Gebraucht werden alle elf auf
exakt `$FINAL`.

```bash
gh pr checks 56
gh pr view 56 --json headRefOid -q .headRefOid
```

Beide Ausgaben müssen `$FINAL` nennen. Kein `skipped`, kein `continue-on-error`, kein älterer SHA.

### Step 7.2: Belegen, dass die zuvor übersprungenen Schritte wirklich liefen

```bash
gh run view <run-id> --log | grep -E "\[planning-(write|publish)\]|\[tenant-(isolation|pooling)\]|\[cost-access\]|\[rate-|Worker smoke|API smoke"
```

Erwartet: je eine `mode=required executed=… skipped=0`-Zeile, plus die Smoke-Ausgaben.

### Step 7.3: Selbstreview

```bash
git fetch origin
git status --short
git rev-parse HEAD
git diff --check
git log origin/master..HEAD --oneline
git diff origin/master...HEAD --stat
git diff origin/master...HEAD -- supabase/migrations/ --name-only
```

Prüfliste:

- [ ] keine fremden lokalen Dateien committet (die untracked `docs/plans/*`, `scripts/ops/`,
      `docs/architecture/EasyTree – Softwaredokumentation.md` bleiben untracked)
- [ ] keine `.env`, kein Secret, kein Token in Diff oder PR-Body
- [ ] keine Gegenmutation im Branch (`grep -n "GEGENMUTATION" -r supabase apps` leer)
- [ ] kein Rotnachweis-Code aus #57 im Feature-PR
- [ ] `supabase/migrations/` enthält im Diff **nur** `…_0017_…sql`
- [ ] kein abgeschalteter Test, keine abgeschwächte Assertion ohne Eintrag in der Kanalmatrix
- [ ] PR-Head == geprüfter CI-Head
- [ ] `mergeable`-Status gelesen und berichtet

### Step 7.4: Migration 0017 Selbstreview

Gegen die Liste aus dem Migrationskopf prüfen: kein `revoke all`, jeder Entzug mit benanntem
(fehlendem) Verbraucher, Kanal bleibt der erlaubte Command-Weg, `planning.write` bleibt die
fachliche Autorisierung, Tenantgrenze unberührt, keine Geschäftslogik in RLS, keine
Datenmigration, Rollback im Kopf dokumentiert.

Die **stärkste Gegenposition** ausdrücklich bewerten:

> Die Grenze hängt an `session_user = 'easytree_app'`. Ein späterer Wechsel auf den
> Supavisor-Transaktionspooler macht `session_user` zu `postgres.<tenant>` und bräche
> legitime Commands.

Bewertung nur mit Belegen aus dem finalen Lauf: Planning Write, Planning Publish,
Pooler-/Tenant-Gates, API-Rollenprobe, Worker-Smoke. Fail-loud ist besser als stiller Bypass —
belegt durch die Nullzeilen-Ausnahme bzw. `42501` im Repository.

### Step 7.5: Draft aufheben — nur wenn wirklich fertig

```bash
gh pr ready 56
```

**Kein Merge. Kein Jira-Done.** EYT-136 bleibt `In Arbeit`. EYT-109 und EYT-110 werden nicht
begonnen.

### Step 7.6: PO_REVIEW_PACKET ausgeben

Genau ein Paket mit den 22 Abschnitten aus dem Auftrag. Die Empfehlung ist `BLOCKED`, sobald
**eines** gilt:

* ein gültiger Same-Tenant-PostgREST-Client kann `assignments` INSERT/UPDATE/DELETE ausführen
* ein Benutzer mit `planning.write` kann direkt über die Data-API einfügen
* ein direkter `plan_versions`-Entwurfs-POST gelingt
* ein legitimer EasyTree-Planning-Command scheitert
* ein Benutzer ohne `planning.write` kann den Runtime-Command ausführen
* Tenant-Isolation bricht
* eine Gegenmutation öffnet die Grenze, aber der Test bleibt grün
* eine alte fachliche Aussage wurde nur entfernt oder abgeschwächt
* ein Pflichtcheck fehlt oder lief auf einem anderen SHA
* eine Gegenmutation blieb im finalen Branch
* ein offener P1/P2 bleibt

Sonst `READY_FOR_PO_REVIEW` — und dann **STOP**.

---

## Sicherheits- und Secret-Grenzen (gelten durchgehend)

* kein produktiver `service_role`
* keine lokalen geheimen `.env`-Werte lesen oder ausgeben
* keine Secrets in Logs, Commits, PRs
* keine direkten Writes auf `auth.users` / `auth.identities` — Benutzer entstehen
  ausschließlich über den öffentlichen GoTrue-Signup mit dem Anon-Key
* keine produktive Migration, keine produktive Identity-Provisionierung
* kein lokales Docker installieren — GitHub Actions ist der DB-Executor (PO-Freigabe liegt vor);
  die Evidenzanforderungen sinken dadurch **nicht**

## Ausdrücklich nicht in diesem Slice

EYT-109, EYT-110, Kostenberechnung, XLSX, EYT-80, EYT-130, EYT-14, SELECT-/Subjektmodell,
allgemeine Supabase-Härtung, Boilerplate-Aufräumen, Pooler-Umbau, Auth-Neudesign.
`outbox_messages`, `idempotency_records`, `audit_events` bleiben dokumentierte Findings —
keine pauschale Schema-Härtung (PO-Entscheidung).
