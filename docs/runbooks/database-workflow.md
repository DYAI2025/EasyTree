# Runbook: Datenbank-Workflow (Supabase, EYT-44)

Gilt für alle Schemaänderungen an der easyTree-Datenbank. Grundlage: [ADR-001](../architecture/ADR-001-boilerplate-architecture.md), Abschnitt „SQL-Migrationen als einzige Schemaquelle".

## Grundregeln (nicht verhandelbar)

1. **Migrationen sind die einzige Schemaquelle.** Jede Schemaänderung (Tabellen, Spalten, Indizes, Policies, Extensions, Storage-Buckets, Grants) existiert ausschließlich als versionierte SQL-Datei unter `supabase/migrations/`. Was nicht als Migration im Repo liegt, existiert nicht.
2. **Remote-Dashboard-Schemaänderungen sind verboten.** Der SQL-Editor / Table-Editor des Supabase-Dashboards (lokal Studio wie remote) wird niemals für Schemaänderungen benutzt — auch nicht „nur schnell zum Ausprobieren". Ausprobieren geht lokal per Migration + `db reset`.
3. **Reviewpflicht.** Jede Migration geht per Pull Request ins Repo und braucht mindestens ein Review, bevor sie gemerged wird. Review-Fokus: Rückwärtskompatibilität, RLS-/Grant-Auswirkungen, tenantgebundene FKs, keine Secrets/echten Daten in Migration oder Seed.
4. **Migrationen sind append-only.** Eine gemergte Migration wird nie editiert oder gelöscht; Korrekturen erfolgen durch eine neue Migration.
5. **Seed enthält nur Fantasiedaten.** `supabase/seed.sql` enthält ausschließlich synthetische Daten (feste UUIDs für deterministische Tests). Niemals echte Kunden-, Personen- oder Zugangsdaten.
6. **Cloudflare deployt Web und API — niemals das Schema (EYT-142).** Eigentümerin des Migrationspfads ist und bleibt die Supabase↔GitHub-Integration: ein Merge nach `master` spielt die Migrationen ein. Kein Cloudflare-Build, kein `wrangler`-Hook und kein Worker führt `supabase db push`, `supabase migration`, `prisma migrate`, `psql` oder `drizzle-kit push` aus. Zwei Stellen, die dasselbe Schema ändern dürfen, sind kein Redundanzgewinn, sondern ein Rennen ohne Schiedsrichter — mit unterschiedlicher Reihenfolge, unterschiedlichen Rechten und ohne gemeinsamen Stand. Das ist keine Absichtserklärung: `apps/api/test/deploy-authority.test.ts` liest beide `wrangler.jsonc` und wird rot, wenn eines dieser Werkzeuge in einem `build`- oder `deploy`-Feld auftaucht. Der Wächter ist fail-closed — findet er keine `wrangler.jsonc`, ist er ebenfalls rot, damit ein Umbenennen ihn nicht still abschaltet.

## Voraussetzungen

- Docker (Daemon läuft)
- Repo-Abhängigkeiten installiert: `pnpm install` — die Supabase CLI ist als devDependency (`supabase`) im Root-`package.json` versioniert und via `pnpm exec supabase …` bzw. `./node_modules/.bin/supabase …` aufrufbar.
- Hinter TLS-interceptierenden Proxys empfohlen: `pnpm exec supabase telemetry disable` (einmalig pro Maschine), sonst endet jeder CLI-Aufruf mit einem PostHog-Timeout-Fehler trotz erfolgreicher Arbeit.

## Standard-Workflow

```bash
# 1. Stack starten (erstmalig zieht Docker-Images; dauert einige Minuten)
pnpm exec supabase start

# 2. Neue Migration anlegen (Timestamp-Prefix erzeugt die CLI)
pnpm exec supabase migration new <kurzer_name>
#    -> supabase/migrations/<timestamp>_<kurzer_name>.sql editieren

# 3. Reproduzierbarkeit beweisen: Datenbank vollständig neu aufbauen
pnpm exec supabase db reset      # spielt ALLE Migrationen + seed.sql ein

# 4. pgTAP-Tests (supabase/tests/*.sql)
pnpm exec supabase test db

# 5. Stack stoppen
pnpm exec supabase stop
```

**Definition of Done einer Migration:** `supabase db reset` läuft zweimal hintereinander fehlerfrei durch (idempotenter, vollständiger Neuaufbau) und `supabase test db` ist grün.

## Reset-Workflow (Wegwerf-Prinzip)

Die lokale Datenbank ist jederzeit wegwerfbar. Bei jedem Zweifel am lokalen Zustand (manuelle Experimente, halbe Migrationen, Datenmüll):

```bash
pnpm exec supabase db reset
```

Das löscht die lokale DB, spielt alle Migrationen in Reihenfolge ein und lädt `supabase/seed.sql`. Wer Daten braucht, die einen Reset überleben sollen, gehört mit ihnen in den Seed (synthetisch!) oder in einen Test.

## Tenant-Test-Modi (EYT-66)

Die Tenant-Isolationstests (`apps/api/test/tenant-isolation.integration.test.ts`) laufen fail-closed. Der Modus kommt aus der Umgebungsvariable `EASYTREE_TENANT_TESTS`:

| Modus      | Verhalten bei unerreichbarer DB / Skips                                                                  | Wer setzt das                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `local`    | Suite skippt mit Warnung, Exit 0 (bewusster lokaler Opt-out)                                             | Default — NUR für Entwicklermaschinen ohne laufenden Supabase-Stack      |
| `required` | Suite schlägt fehl: unerreichbare DB ⇒ Error in `beforeAll`; jeder Skip ⇒ Error in `afterAll` (Exit ≠ 0) | CI, Job `db-gates` (EYT-57) — Pflicht-Gate, kein grüner Lauf durch Skips |

Jeder Lauf schreibt eine greppbare Report-Zeile ins Log: `[tenant-isolation] mode=<modus> executed=<n> skipped=<n>`. CI prüft zusätzlich `skipped=0`.

Das fail-closed-Verhalten selbst ist durch einen Regressionstest bewiesen: `apps/api/test/tenant-gate.fail-closed.test.ts` (Kind-Vitest-Lauf im Required-Modus gegen eine unerreichbare DB-URL muss mit Exit ≠ 0 und „fail-closed"-Fehler enden).

## Ist-Zustand (Foundation, Migration 0001)

- Extension `pgtap` (Schema `extensions`) für DB-Tests
- Tabelle `public.organizations` (`id uuid pk default gen_random_uuid()`, `name text not null`, `created_at timestamptz not null default now()`)
- Privater Storage-Bucket `tenant-files` (`storage.buckets`, `public = false`), **ohne** public-Policies — Zugriffs-Policies folgen erst mit dem RLS-Spike (EYT-15)
- Seed: zwei synthetische Organisationen `Org Alpha` (`…00a1`) und `Org Beta` (`…00b2`)
- Smoke-Test: `supabase/tests/0001_smoke.sql` (6 Assertions)

## Abweichungen / TOOL_GAPs dieser Umgebung

- `TOOL_GAP` **Edge Runtime deaktiviert:** In `supabase/config.toml` ist `[edge_runtime] enabled = false` gesetzt. Der Edge-Runtime-Container startet in der Sandbox-Umgebung nicht (runc: `error setting rlimit type 7: operation not permitted`); Edge Functions werden in Sprint 1 ohnehin nicht genutzt. Bei Bedarf reaktivieren und hier vermerken.
- `TOOL_GAP` **pg-delta-Katalog-Cache:** `supabase start` / `db reset` loggen eine Warnung `failed to cache migrations catalog … invalid peer certificate: UnknownIssuer` — der Deno-Prozess im Container kennt das Proxy-CA-Bundle nicht. Nicht-fatal: Migrationen und Seed werden trotzdem vollständig eingespielt, beide Kommandos enden mit Exit 0.
- Ebenso deaktiviert die CLI in dieser Umgebung selbständig `imgproxy` und `pooler` nicht — sie wurden von `supabase start` als `Stopped services` gemeldet (imgproxy, edge_runtime, pooler); für Migrations-/Testworkflow irrelevant. Der Pooling-Modus wird im RLS-Spike (EYT-15, Task 7 Step 7) gesondert geprüft.

## Verbindungsdaten (nur lokal, Supabase-Demo-Defaults)

`pnpm exec supabase status` zeigt URLs und Keys. Die lokalen Keys sind öffentlich bekannte Supabase-Demo-Defaults — niemals in Produktion verwenden, echte Keys niemals ins Repo.
