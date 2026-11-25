# EYT-108 — Positive Ablösung eines offenen Stundensatzes (Option A+)

> **Für Claude:** Dieser Plan liegt im Haupt-Worktree und ist **nicht committed** — er darf in
> keinen PR geraten. Ausführung erst, wenn PR #43 gemergt ist und EYT-108 das einzige
> Entwicklungs-WIP ist.

**Ziel:** Ein offener Stundensatz wird durch eine Nachfolgeversion ersetzt — atomar, autorisiert,
idempotent, auditiert. Der Vorgänger wird dabei **genau einmal** geschlossen
(`valid_to = successor.valid_from`), alles andere bleibt unveränderlich.

**Nicht-Ziele:** allgemeine UPDATE-API; pauschales UPDATE-Recht; Änderung von Betrag, Währung,
Mitarbeiter, `valid_from`, Grund, Ersteller, Erstellungszeit oder Korrelations-ID; EYT-107/109/110;
neue Security- oder Audit-Infrastruktur; Supabase Agent Skills.

**Branch:** `feat/eyt-108-rate-succession` (noch nicht angelegt), Basis `origin/master` **nach**
dem Merge von PR #43.

---

## Vorbedingungen — gemessen 02.08.2026 am aktuellen master

Aus `supabase/migrations/20260801060000_0013_cost_permissions_and_rates.sql`:

| Fakt                                                    | Wert                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Grants auf `employee_rate_versions` für `authenticated` | **`select, insert`** — **kein `update`**, kein `delete`                                            |
| Überlappungsschutz                                      | `exclude using gist (org_id =, employee_id =, daterange(valid_from, valid_to, '[)') &&)`           |
| Halboffenes Intervall                                   | `[)` — nahtloser Anschluss `valid_to = nächstes valid_from` ist zulässig                           |
| `predecessor_id`                                        | vorhanden, FK auf `(id, org_id)`, `on delete restrict`                                             |
| Bestehender Check                                       | `valid_to is null or valid_to > valid_from`                                                        |
| RLS                                                     | select braucht `costs.read`, insert braucht `costs.manage_rates` **und** `created_by = auth.uid()` |
| Rechteprüfung in der DB                                 | `app.has_cost_permission(org_id, permission)`, security definer                                    |

**Daraus folgt die zentrale Entwurfsentscheidung, und sie ist nicht Geschmackssache:**
`authenticated` besitzt heute **überhaupt kein** UPDATE-Recht auf dieser Tabelle. Eine
UPDATE-Policy allein bliebe wirkungslos — es bräuchte zusätzlich ein `grant update`, und das
wäre genau das pauschale Recht, das der Auftrag verbietet.

**Gewählt: eine eng begrenzte `security definer`-Funktion.** Sie ist der einzige Weg, `valid_to`
zu setzen; die Tabelle selbst bekommt **kein** UPDATE-Grant. Die Funktion prüft Recht,
Tenant, Offenheit und Einmaligkeit selbst und ist damit die Engstelle, die eine Policy nicht
sein kann.

### Bekannte Lücken

- **Produktion ist derzeit unten** (API-Deployment CRASHED, EYT-45-Rollen-Gate). Die reale
  Browserreise ist bis zur Behebung nicht durchführbar — sie ist der letzte Schritt, nicht der
  erste. Lokale und CI-Nachweise sind davon unabhängig.
- **Dieser Mac kann Supabase nicht starten.** Jede Migration wird erstmals in `db-gates`
  ausgeführt. Entsprechend früh pushen, nicht am Ende.
- **Supabase MCP ist noch nicht authentifiziert.** Für diesen Plan nicht blockierend: der
  Ist-Zustand oben stammt aus der Migration im Repository, die die Schemaquelle ist.

---

## Aufgaben

### T1 — Domänenregel als reine Funktion

**Dateien:** `apps/api/src/modules/costs/domain/rate-succession.ts` (neu),
`packages/domain/test/…` bzw. `apps/api/test/costs/rate-succession.test.ts`.

Eine Funktion `pruefeAbloesung(vorgaenger, nachfolger)` → `Ergebnis`, ohne DB, ohne Nest.
Sie entscheidet, **ob** abgelöst werden darf:

- Vorgänger ist offen (`valid_to === null`) — sonst `VORGAENGER_BEREITS_GESCHLOSSEN`;
- `nachfolger.validFrom > vorgaenger.validFrom` — sonst `NACHFOLGER_NICHT_SPAETER`;
- gleiche Organisation und gleicher Mitarbeiter — sonst `FREMDER_KONTEXT`;
- `expectedActiveVersionId === vorgaenger.id` — sonst `STALE_VERSION`.

**Erst der Test, dann die Funktion.** Je Regel ein positiver **und** ein negativer Fall; die
Registry `apps/api/test/domain-invariants/registry.ts` bekommt einen Eintrag, sonst geht
`domain-invariant-coverage.test.ts` rot.

**Evidenz:** `pnpm --filter @easytree/api exec vitest run test/costs/rate-succession.test.ts`.

---

### T2 — Migration `0014`: die eng begrenzte Funktion

**Datei:** `supabase/migrations/<timestamp>_0014_rate_succession.sql`
(`supabase migration new` erzeugt nur den Zeitstempel — **Datei auf `_0014_` umbenennen**).

```sql
create function app.close_rate_version(
  p_predecessor_id uuid,
  p_org_id uuid,
  p_valid_to date
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not app.has_cost_permission(p_org_id, 'costs.manage_rates') then
    raise exception 'costs.manage_rates fehlt' using errcode = '42501';
  end if;
  update public.employee_rate_versions
     set valid_to = p_valid_to
   where id = p_predecessor_id
     and org_id = p_org_id
     and valid_to is null            -- Einmaligkeit: eine geschlossene Version wird nie wieder angefasst
     and p_valid_to > valid_from;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Vorgaenger nicht offen oder nicht im Tenant' using errcode = 'P0001';
  end if;
end $$;

revoke all on function app.close_rate_version(uuid, uuid, date) from public;
grant execute on function app.close_rate_version(uuid, uuid, date) to authenticated;
```

**Kein `grant update` auf der Tabelle.** Das ist der Punkt der ganzen Migration.

**pgTAP** in `supabase/tests/`: `authenticated` kann `valid_to` **nicht** direkt per UPDATE
setzen; die Funktion setzt es genau einmal; ein zweiter Aufruf schlägt fehl; ein fremder Tenant
schlägt fehl; ohne `costs.manage_rates` schlägt sie fehl.

**Evidenz:** zwei aufeinanderfolgende `db reset` plus grünes `supabase test db` in `db-gates`.

---

### T3 — Domain-Command in einer Transaktion

**Dateien:** `apps/api/src/modules/costs/application/rate-repository.port.ts` (erweitern),
`apps/api/src/modules/costs/infrastructure/rate-repository.pg.ts`.

Eine Methode `succeed(befehl)` — **eine** Transaktion über den `TenantQueryRunner`:

1. `select … for update` auf den offenen Vorgänger (Sperre gegen Parallelität);
2. `expectedActiveVersionId` prüfen → sonst `STALE_VERSION`;
3. `app.close_rate_version(...)`;
4. `insert` des Nachfolgers mit `predecessor_id`;
5. Audit- und Idempotenzwirkung im selben Commit;
6. jeder Fehler → vollständiger Rollback.

Reihenfolge 3 vor 4 ist Absicht: der EXCLUDE-Constraint würde den Nachfolger sonst wegen
Überlappung ablehnen.

**Tests:** Retry mit demselben Idempotenzschlüssel liefert dasselbe Ergebnis ohne zweite Zeile;
zwei **echte** konkurrierende Verbindungen erzeugen genau einen Nachfolger (eine Verbindung
kann Serialisierung nicht zeigen — dieselbe Bauart wie der Planungsinvarianten-Gate aus EYT-49);
Cross-Tenant; fehlendes `costs.manage_rates`; stale predecessor.

---

### T4 — Vertrag und HTTP

**Dateien:** `packages/contracts/src/costs/schemas.ts`, `openapi/v1.json` (**regeneriert**,
nie von Hand), `apps/api/src/modules/costs/interface/http/costs.controller.ts`.

`expectedActiveVersionId` im Request; `STALE_VERSION` als RFC-7807-Problem mit eigenem
`costs-error-type`. Nach jeder Schemaänderung
`pnpm --filter @easytree/contracts run openapi:write`, sonst geht `openapi-drift.test.ts`
byteweise rot. Der `NOT_YET_IMPLEMENTED`-Eintrag der Operation muss **entfernt** werden —
`openapi-route-conformance.test.ts` schlägt sonst in beide Richtungen an.

---

### T5 — Sichtbares Ergebnis in der UI

**Datei:** `apps/web/components/rate-management.tsx` (existiert bereits).

Zeigen: aktive Version, geschlossene Vorgängerversion, „ersetzt Version vom …", gültig ab,
gültig bis, Grund, Erstellungszeit, Status (aktiv / zukünftig / abgelaufen).

**Verbindlich:** Tokens und Komponenten nach Basisdesign v2.0 (Confluence 8814623) — vor der
ersten Zeile Frontend dort nachlesen.

**Tests:** jsdom + axe in `apps/web/test/`, Playwright-Reise in `apps/web/e2e/`:
offener Satz → neue Version ab späterem Datum → Vorgänger geschlossen → Nachfolger verweist auf
Vorgänger → Reload zeigt beide → zweiter Browserkontext zeigt denselben Zustand → je
Leistungsdatum genau eine wirksame Version.

---

### T6 — Gegenmutationen, ausgeführt und zurückgenommen

Vor jeder Mutation `cp` der Datei; **nie** `git checkout --`. Keine Mutation committen.
Jede Zahl in den Bericht („N von M rot").

| Mutation                                          | Erwartung                                    |
| ------------------------------------------------- | -------------------------------------------- |
| `and valid_to is null` aus der Funktion entfernen | pgTAP „zweiter Aufruf schlägt fehl" rot      |
| `expectedActiveVersionId`-Prüfung überspringen    | stale-predecessor-Test rot                   |
| `for update` weglassen                            | Nebenläufigkeitstest rot (zwei Verbindungen) |
| `grant update … to authenticated` ergänzen        | pgTAP „kein direktes UPDATE" rot             |

Die letzte ist die wichtigste: sie beweist, dass die Enge der Funktion gemessen ist und nicht
nur behauptet.

---

### T7 — Reale Browserreise

**Erst nach Behebung des Produktionsausfalls.** Artefakte: Screenshot vor und nach der
Nachfolgeversion, maschinenlesbare Zusammenfassung, DB-Nachweis der `predecessor`-Kette — ohne
Tokens, Passwörter oder personenbezogene Inhalte.

Danach EYT-108 als `SNAPSHOT_READY` dokumentieren, **nicht** auf Fertig setzen: das Kriterium
„Spätere Satzänderungen verändern bereits erzeugte Kosten-Snapshots nicht" bleibt
`BLOCKED_BY_EYT-109`.

---

## Risiken und Rollback

| Risiko                                                | Gegenmaßnahme                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `security definer` ist selbst eine Rechteerweiterung  | `set search_path = ''`, Rechteprüfung als erste Anweisung, nur `execute` für `authenticated`, kein Tabellen-Grant; pgTAP prüft jede Verweigerung |
| Reihenfolge Close-vor-Insert falsch → EXCLUDE-Verstoß | im Command festgeschrieben, Test mit nahtlosem Anschluss                                                                                         |
| Migration erstmals in CI ausgeführt                   | früh pushen, `db-gates` als erste echte Ausführung einplanen                                                                                     |
| Nebenläufigkeitstest mit nur einer Verbindung         | zwei echte Verbindungen, wie im EYT-49-Gate                                                                                                      |
| Produktionsausfall verzögert T7                       | T1–T6 sind davon unabhängig und laufen vollständig                                                                                               |

**Rollback:** Migrationen sind append-only — Rücknahme nur als neue Vorwärtsmigration, die die
Funktion droppt. Da kein Tabellen-Grant erteilt wird, entsteht kein dauerhaft erweitertes Recht.
Der Branch ist bis zum Merge folgenlos verwerfbar.
