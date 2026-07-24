# Tenant-Isolation-Report (EYT-15, Sprint-1-Sicherheitsgate)

- **Datum:** 2026-07-23
- **Jira:** [EYT-15](https://dyai2026.atlassian.net/browse/EYT-15), Epic [EYT-2](https://dyai2026.atlassian.net/browse/EYT-2)
- **Grundlage:** [ADR-001](./ADR-001-boilerplate-architecture.md) (Shared-Schema-Multitenancy mit RLS), [Sprintplan Task 7](../plans/2026-07-23-eyt-sprint-1-foundation.md)
- **Artefakte:** `supabase/migrations/20260723222457_0002_tenancy.sql`, `supabase/tests/0002_rls_isolation.sql`, `apps/api/test/tenant-isolation.integration.test.ts`, `supabase/seed.sql`

## Fazit: **BELEGT**

Die Tenant-Isolation ist auf drei Ebenen nachgewiesen — strukturell (tenantgebundene
zusammengesetzte FKs, 23503), deklarativ (RLS ENABLE+FORCE mit Policies nur über
aktive Memberships aus verifiziertem JWT) und empirisch (27 pgTAP-Assertions + 7
Node-Integrationstests real gegen den lokalen Supabase-Postgres, alle grün; TDD mit
dokumentiertem rotem Erstlauf).

## Schema- und Policy-Design (Kurzfassung)

- `public.users` (pk = `auth.users.id`), `public.memberships` (`org_id`, `user_id`,
  `role in ('owner','member')`, `active`, `unique(org_id, user_id)`).
- `public.items` mit `unique(id, org_id)`; `public.item_notes` referenziert
  `items(id, org_id)` per **zusammengesetztem FK** `(item_id, org_id)` —
  Cross-Tenant-Referenzen sind damit bereits auf DB-Ebene unmöglich (23503),
  unabhängig von RLS.
- Tenantkontext-Helper in Schema `app`:
  - `app.current_user_id()` = `auth.uid()` (verifiziertes JWT, einzige Identitätsquelle),
  - `app.user_org_ids()` = `security definer` mit fixiertem `search_path`, liefert
    **nur aktive** Memberships.
- RLS **ENABLE + FORCE** auf `users`, `memberships`, `items`, `item_notes`.
  Policies ausschließlich `to authenticated`: `items`/`item_notes` CRUD nur bei
  `org_id in app.user_org_ids()`; `users` nur self; `memberships` nur eigene lesbar,
  **keine** Schreib-Policies und **keine** Schreib-Grants (kein Self-Service).
- Storage: Bucket `tenant-files` (privat), Pfadkonvention `<org_id>/…`; Policies auf
  `storage.objects` nur bei aktiver Membership der Org im ersten Pfadsegment.
- Least Privilege: `anon` ohne Grants und ohne Policies; `authenticated` hat
  `rolbypassrls = false` (per Test asserted); **keine** `service_role`-Policies in
  `public`/`storage` (per Test asserted — Befund: Supabase-Default-Privileges geben
  neuen Tabellen ohnehin kein select/insert/update/delete für `authenticated`;
  Grants wurden explizit und minimal gesetzt).

## Testmatrix (Angriff ⇒ Ergebnis)

| #   | Angriff / Szenario (Angreifer)                                                           | Ebene               | Erwartung                           | Ergebnis  |
| --- | ---------------------------------------------------------------------------------------- | ------------------- | ----------------------------------- | --------- |
| 1   | Cross-Tenant-Read: A (Org Alpha) liest alle `items`                                      | pgTAP + Integration | nur Alpha-Zeilen                    | BESTANDEN |
| 2   | Cross-Tenant-Read: A liest `items where org_id = Beta`                                   | pgTAP + Integration | leer                                | BESTANDEN |
| 3   | IDOR: A liest fremde Item-/Note-UUID direkt                                              | pgTAP + Integration | leer, kein Leak                     | BESTANDEN |
| 4   | Cross-Tenant-Insert: A schreibt `items` mit manipulierter `org_id = Beta`                | pgTAP + Integration | 42501 (with check)                  | BESTANDEN |
| 5   | Manipulierte `org_id` auf `item_notes` (Beta-Item referenziert)                          | pgTAP               | 42501 (RLS vor FK)                  | BESTANDEN |
| 6   | Cross-Tenant-Update/-Delete auf Beta-`items`                                             | pgTAP + Integration | 0 rows affected                     | BESTANDEN |
| 7   | Positivkontrolle: A schreibt/liest im eigenen Tenant                                     | pgTAP               | erlaubt                             | BESTANDEN |
| 8   | A liest fremde `users`-Profile / fremde `memberships`                                    | pgTAP               | nur self / nur eigene               | BESTANDEN |
| 9   | Selbst-Eskalation: A fügt sich selbst als owner in Org Beta ein                          | pgTAP               | 42501 (kein Grant, keine Policy)    | BESTANDEN |
| 10  | Inaktive Membership: C (inaktiv in Alpha) liest `items`/`item_notes`/Storage             | pgTAP + Integration | leer                                | BESTANDEN |
| 11  | Cross-Tenant-FK: Note mit Alpha-Item unter Beta-`org_id` (ohne RLS, als Migrationsrolle) | DB-Struktur         | 23503 FK-Fehler                     | BESTANDEN |
| 12  | Storage: A liest Pfad `org_beta/…`                                                       | pgTAP               | leer                                | BESTANDEN |
| 13  | Storage: A schreibt Pfad `org_beta/…`                                                    | pgTAP               | 42501                               | BESTANDEN |
| 14  | Storage-Positivkontrolle: A liest/schreibt `org_alpha/…`                                 | pgTAP               | erlaubt                             | BESTANDEN |
| 15  | Rollenbypass: `authenticated` mit `BYPASSRLS`?                                           | pg_roles            | `rolbypassrls = false`              | BESTANDEN |
| 16  | RLS versehentlich nicht enforced (enable/force fehlt)?                                   | pg_class            | enabled+forced auf allen 4 Tabellen | BESTANDEN |
| 17  | Versteckte `service_role`-Policy als Umgehung?                                           | pg_policies         | keine in `public`/`storage`         | BESTANDEN |
| 18  | Pooler-Szenario: Tenantkontext leakt in Folgetransaktion (wiederverwendete Connection)   | Integration         | `auth.uid()` null ⇒ leer            | BESTANDEN |

## TDD-Nachweis: roter Erstlauf (VOR Policy-Implementierung)

Migration enthielt zum Zeitpunkt dieses Laufs Schema, Helper und Grants, aber
**keine** RLS-Aktivierung/Policies. `pnpm exec supabase test db` (wörtlich, gekürzt
auf die Kernaussagen; vollständige Liste: Tests 1–8, 10–11, 14, 16–18, 20, 23–26 rot):

```
/home/claude/work/easytree/supabase/tests/0001_smoke.sql .......... ok
/home/claude/work/easytree/supabase/tests/0002_rls_isolation.sql ..
# Failed test 2: "A: Cross-Tenant-Read auf Org-Beta-Items ist leer"
#     Unexpected records:
#         (00000000-0000-0000-0000-0000000220b2,00000000-0000-0000-0000-0000000000b2,"Beta Item 1","2026-07-23 22:29:23.729301+00")
# Failed test 5: "A: insert mit org_id=Beta wird mit 42501 abgelehnt"
#       caught: no exception
#       wanted: 42501
# Failed test 7: "A: update auf Org-Beta-Items betrifft 0 Zeilen"
#     Results differ beginning at row 1:
#         have: (2)
#         want: (0)
# Failed test 17: "C (inaktive Membership): select items ist leer"
#     Unexpected records:
#         (00000000-0000-0000-0000-0000000110a1,00000000-0000-0000-0000-0000000000a1,"Alpha Item 1",…)
# Failed test 23: "RLS enabled + forced auf public.users"
# Looks like you failed 19 tests of 27
Failed 19/27 subtests
Result: FAIL
```

Der rote Lauf beweist, dass die Tests die Lücke real detektieren (Cross-Tenant-Reads
lieferten Beta-Zeilen, Cross-Tenant-Writes trafen 2 Zeilen) — grün ist danach nicht
trivial erfüllbar.

## Grüner Lauf nach Policy-Implementierung (wörtlich)

`pnpm exec supabase db reset && pnpm exec supabase test db`:

```
Applying migration 20260723214800_0001_foundation.sql...
Applying migration 20260723222457_0002_tenancy.sql...
Seeding data from supabase/seed.sql...
Finished supabase db reset on branch main.

Connecting to local database...
/home/claude/work/easytree/supabase/tests/0001_smoke.sql .......... ok
/home/claude/work/easytree/supabase/tests/0002_rls_isolation.sql .. ok
All tests successful.
Files=2, Tests=33,  1 wallclock secs ( 0.02 usr  0.01 sys +  0.01 cusr  0.00 csys =  0.04 CPU)
Result: PASS
```

## Integrationstest (real gegen DB gelaufen, nicht geskippt — wörtlich)

`pnpm exec vitest run test/tenant-isolation.integration.test.ts --reporter=verbose`
(Verbindung: `postgresql://…@127.0.0.1:54322/postgres`, Kontext pro Transaktion via
`set_config('request.jwt.claims', …, true)` + `set local role authenticated`):

```
 ✓ … > runs as authenticated without BYPASSRLS (no service role involved) 8ms
 ✓ … > cross-tenant read: user A sees only Org-Alpha rows, Org-Beta reads are empty 17ms
 ✓ … > IDOR: direct lookup of a foreign UUID leaks nothing 4ms
 ✓ … > cross-tenant write: insert with foreign org_id fails with 42501 3ms
 ✓ … > cross-tenant write: update/delete on foreign rows affect 0 rows 3ms
 ✓ … > inactive membership: user C sees no Org-Alpha data at all 3ms
 ✓ … > transaction-mode guarantee: tenant context does not leak into the next transaction 4ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  334ms
```

CI-Schutz verifiziert: mit unerreichbarer DB (`EASYTREE_TEST_DB_URL` auf Port 59999)
meldet dieselbe Suite `Tests  7 skipped (7)` mit klarem Hinweis statt Fehlschlag.

Gesamtsuite `pnpm --filter @easytree/api test`: `Test Files 6 passed (6), Tests 17
passed (17)`. Root-Gates `pnpm lint && pnpm typecheck && pnpm build && pnpm test`:
alle grün.

## Pooling-Befund

- **Produktionsentscheid: Transaction Mode (Supavisor).** Konsequenz: keine
  session-level Settings; der komplette Tenantkontext (JWT-Claims) muss pro
  Transaktion via `set_config(…, is_local => true)` gesetzt werden und stirbt mit
  `commit`/`rollback`.
- Genau dieses Muster erzwingt der Integrationstest (`begin` → `set_config(…, true)`
  → `set local role authenticated` → Queries → `rollback`) und beweist zusätzlich,
  dass eine Folgetransaktion ohne Claims **nichts** sieht (`auth.uid()` = null) —
  d. h. eine vom Pooler wiederverwendete Connection kann keinen fremden
  Tenantkontext erben (Testmatrix #18).
- `TOOL_GAP` **Live-Pooler-Test:** Der lokale Supavisor-Container
  (`supabase_pooler_easytree`, Port 54329) startet in dieser Sandbox nicht
  (von `supabase start` als „Stopped services" gemeldet, bekannte Limitierung, siehe
  Runbook `database-workflow.md`). Der Transaction-Mode-Kontraktsvertrag ist daher
  auf DB-Ebene simuliert bewiesen, nicht gegen einen laufenden Supavisor. Vor dem
  ersten produktiven Deployment: denselben Integrationstest einmal mit
  `EASYTREE_TEST_DB_URL` auf den Pooler-Port ausführen.

## Pooling-Evidenz (Sprint 2, real)

Schließt den oben dokumentierten `TOOL_GAP` **Live-Pooler-Test** (EYT-15, Sprint 2):

- **Vorher (Sprint 1, simuliert):** Der Transaction-Mode-Kontrakt wurde nur auf
  DB-Ebene nachgestellt — dieselbe Direct Connection (Port 54322), Kontext pro
  Transaktion via `set_config(…, is_local => true)`, Leak-Probe über eine
  Folgetransaktion ohne Claims (Testmatrix #18). Ein realer Supavisor war nie
  im Pfad; der lokale Pooler-Container war in `supabase/config.toml` deaktiviert
  (`[db.pooler] enabled = false`) und startete in der Entwicklungs-Sandbox nicht.
- **Jetzt (Sprint 2, real):** `[db.pooler] enabled = true` (transaction mode,
  Port 54329), und die neue Suite `apps/api/test/tenant-pooling.integration.test.ts`
  verbindet über `EASYTREE_TEST_POOLER_URL` (Default
  `postgresql://postgres:postgres@127.0.0.1:54329/postgres`) **durch den laufenden
  Supavisor** statt direkt. Geteilte Bausteine (Seed-Konstanten, `probeDatabase`,
  `inTenantTx`-Muster) liegen DRY in `apps/api/test/tenant-context.helper.ts` und
  werden von Direct- und Pooler-Suite gemeinsam genutzt.
- **Real getestete Szenarien (3 Tests, eigenes Report-Prefix `[tenant-pooling]`):**
  1. Tenantkontext funktioniert durch den Pooler: ein Client, transaktionslokaler
     Kontext, User A sieht ausschließlich Org-Alpha-Items (identisches Muster wie
     die Direct-Suite).
  2. **Parallelität:** 8 gleichzeitige `pg.Client`-Verbindungen via `Promise.all`
     (4x User A aktiv, 2x User C inaktiv, 2x ohne Claims) teilen sich die gepoolten
     Server-Connections — A-Clients sehen ausschließlich Org-Alpha-Zeilen (nie
     leer), C-/No-Claims-Clients 0 Zeilen.
  3. **Leak-Probe nach Parallellast:** eine frische Transaktion ohne Claims liefert
     `auth.uid() IS NULL` und 0 Items — eine vom Pooler wiederverwendete
     Server-Connection erbt keinen fremden Tenantkontext.
- **Fail-closed-Gate (gleiche Semantik wie EYT-66):** CI-Job `db-gates`, Step
  „Tenant isolation gate (fail-closed, TRANSACTION POOLER)" läuft mit
  `EASYTREE_TENANT_TESTS=required` und greppt die Report-Zeile
  `[tenant-pooling] mode=required executed=[1-9][0-9]* skipped=0` aus
  `/tmp/tenant-pooled.log` — unerreichbarer Pooler oder auch nur ein Skip lässt
  den Job fehlschlagen. Lokal ohne Docker verifiziert: Required-Mode gegen den
  nicht erreichbaren Pooler-Port ⇒ Exit 1 mit
  `[tenant-pooling] fail-closed: Pflicht-Pooler-Tests koennen nicht laufen …`;
  Local-Mode ⇒ Exit 0 mit `[tenant-pooling] mode=local executed=0 skipped=3`.
- **Evidenzstufe:** CI-Lauf ausstehend — Run-URL nach erstem grünen Lauf hier
  eintragen (erst dann gilt das EYT-15-AC „reproduzierbar belegt“ als erfüllt).

## Verbleibende Risiken

1. **Service-Role-Key-Disziplin:** `service_role` hat `BYPASSRLS` per Rollenattribut
   (Supabase-Design; per Policy nicht abschaltbar). Die Isolation gilt nur, solange
   der Key in keinem normalen API-/Worker-Pfad verwendet wird (ADR-001-Verbot).
   Empfehlung Folgesprint: Lint-/CI-Regel gegen `SERVICE_ROLE` im Runtime-Code plus
   getrennte Runtime-Credentials.
2. **Storage-Pfadkonvention ist Konvention:** Die Policies binden an das erste
   Pfadsegment (`<org_id>/…`). Uploads über andere Kanäle (z. B. service_role,
   Admin-Tools) könnten Objekte außerhalb der Konvention anlegen, die dann für alle
   Tenants unsichtbar, aber auch unkontrolliert wären. Empfehlung: Upload-Pfade
   ausschließlich serverseitig konstruieren, nie aus Client-Input.
3. **`users`-Anlage ist Self-Service (nur self):** `users_insert_self` erlaubt
   jedem authentifizierten JWT das Anlegen des eigenen Profils. Gewollt (Onboarding),
   aber `display_name` ist unvalidiert — Längen-/Inhaltsvalidierung folgt im
   API-Layer.
4. **Membership-Verwaltung fehlt bewusst:** Es gibt keinen RLS-Pfad, Memberships zu
   erstellen/ändern (kein Self-Service, keine Owner-Delegation). Ein künftiger
   Admin-Flow braucht eigene, erneut negativ getestete Policies — nicht service_role.
5. **Synthetische auth-User im Seed:** Direktes Insert in `auth.users` ist
   **testspezifisch lokal** (im Seed dokumentiert); echte Umgebungen legen User nur
   über GoTrue an. Der Seed darf nie gegen Remote-Umgebungen laufen.
6. **`organizations` selbst trägt noch keine RLS** (Migration 0001, kein
   `authenticated`-Grant — fail closed über fehlende Grants). Vor erster Exponierung
   über die API braucht die Tabelle eigene Policies (Membership-basiertes select).

## Stop-Regel

Nicht ausgelöst: Alle Negativtests bestehen; es war **kein** Reparaturansatz wegen
einer Sicherheitslücke nötig (einziger Fix im TDD-Zyklus: fehlende
Least-Privilege-Grants, die zu „permission denied" statt Datenleck führten —
fail closed).
