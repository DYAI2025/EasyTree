# Kundensichtbarer Slice: Login → Stundensätze → Tageskosten → Excel (PO-Weisung 01.08.2026)

**Stand:** 01.08.2026 · Basis `master` = `8b38406` · Branch `feat/eyt-106-cost-slice-login-to-export`
· Tickets EYT-106 (Kern), EYT-108/109/110 (im minimal nötigen Umfang)
· Verbindliche Gestalt: Basisdesign v2.0 (Confluence 8814623), Verträge aus den Jira-Beschreibungen.

Erledigt: `69ca8e0` (ES256-Tokenverifikation, 11 Tests, M-I), `1b9ff7b` (Session-Liveness
fail-closed, 7 Tests, M-J).

## Commit-Folge (PO §12) und Bauentscheidungen

### 1 — Auth- und Sessionfluss (Rest)

- **Verträge** `packages/contracts/src/auth/`: `LoginCommandSchema` (email, password),
  `SessionDtoSchema` (userId, Anzeigename optional, Organisationen mit Rolle),
  `AuthGateway`-Port (`login`, `logout`, `session`) — Cookies trägt der Browser, der Port
  sieht sie nie. HTTP-Client `src/http/auth-gateway.ts` nach `http/planning-gateway.ts`-Muster
  (Status→`GatewayFailure`, jede 2xx per `safeParse`).
- **API** `apps/api/src/modules/tenancy/`: `interface/http/auth.controller.ts` —
  `POST /api/v1/auth/login` (GoTrue Password-Grant serverseitig, HttpOnly-Cookies
  `eyt_access`/`eyt_refresh`, `SameSite=Strict`, `Secure` bei production, `Path=/`),
  `POST /auth/logout` (GoTrue-Logout + Cookies löschen), `GET /auth/session`.
  Fehlerform RFC-7807 wie `HttpExceptionFilter`.
- **Request-Identität** `apps/api/src/platform/auth/request-identity.ts`: Token aus Cookie
  ODER `Authorization: Bearer`; beide vorhanden und nicht dieselbe Identität ⇒
  `401 AUTH_CREDENTIAL_CONFLICT`. Kette je Anfrage: `JoseTokenVerifier` (Remote-JWKS
  `SUPABASE_URL/auth/v1/.well-known/jwks.json`) → `GotrueSessionLiveness` → Identität.
  Ersetzt `UnauthenticatedSubjectResolver` für geschützte Routen.

### 2 — Stundensatz-Domain und Migration `0013`

**Eine** Migration, kein Zwischenzustand (Plan-§6 von EYT-106 gilt fort):

- `memberships`-Rollencheck erweitern: `('owner','manager','member')`.
- `role_permissions(role text, permission text, primary key(role, permission))` —
  global, **kein** org_id (Zuordnung ist produktweit, Änderungen nur per Migration);
  Grants: `authenticated` NUR select. Matrix seeden: owner×4, manager×{read,calculate,export}.
- `app.has_cost_permission(p_org_id uuid, p_permission text)`: security definer,
  `search_path=''`; wahr ⇔ aktive Mitgliedschaft in p_org_id UND deren Rolle hat das Recht.
- `employee_rate_versions` (EYT-108): `id`, `org_id`, `employee_id` (FK zusammengesetzt),
  `amount_minor_units bigint not null check (>= 0)`, `currency text not null check ('EUR')`,
  `valid_from date not null`, `valid_to date null check (valid_to > valid_from)`,
  `predecessor_id uuid null` (FK zusammengesetzt, selbe Tabelle), `reason text not null`
  (nicht leer), `created_by uuid not null`, `correlation_id text not null`,
  `created_at timestamptz not null default now()`, `unique (id, org_id)`.
  **Überlappungsverbot in der DB:** `EXCLUDE USING gist (org_id with =, employee_id with =,
daterange(valid_from, coalesce(valid_to,'infinity'::date), '[)') with &&)` — btree_gist
  existiert (0009). Versionen unveränderlich: Grants nur select+insert, keine
  update/delete-Policy (Muster idempotency_records). RLS-Standardmuster; **select nur mit
  costs.read**: Policy nutzt `app.has_cost_permission(org_id, 'costs.read')`,
  insert `costs.manage_rates` — die Unabhängigkeitszusage AK4.
- pgTAP `supabase/tests/0009_cost_permissions_and_rates.sql`: Matrix 3 Rollen × 4 Rechte,
  Überlappung 23P01, member sieht keine Zeilen, keine Schreibrechte auf role_permissions,
  Version unveränderlich.
- Domain (`packages/domain`): `effectiveRateVersion(versions, date)` → genau eine |
  `RATE_NOT_FOUND` | `RATE_AMBIGUOUS`; Intervallsemantik `[from, to)` zentral.

### 3 — Stundensatz-API und Contracts

`packages/contracts/src/costs/`: `EmployeeForRatesDtoSchema`, `RateVersionDtoSchema`
(id, employeeId, amountMinorUnits als `z.string()`-BigInt-Transport? → **Entscheidung:
string mit `^\d+$`**, nie float), `CreateRateVersionCommandSchema` (employeeId,
amountMinorUnits, validFrom, validTo?, reason, expectedActiveVersionId? für
konkurrierende Änderung → `STALE_VERSION`), Fehlercodes
`RATE_NOT_FOUND | RATE_INTERVAL_OVERLAP | RATE_AMBIGUOUS | ORG_CONTEXT_REQUIRED` als
URN-Erweiterung von `COSTS_ERROR_TYPE`. `CostsGateway`-Port: `listEmployees`,
`rateHistory(employeeId)`, `createRateVersion(cmd, {idempotencyKey})`,
`dailyCosts(query)`, `createSnapshot(cmd, opts)`, `exportUrl(snapshotId)`.
API: `modules/costs/interface/http/costs.controller.ts` + `application/cost-access.policy.ts`
(`CostAccessPolicy` — Rechteprüfung in der Anwendungsschicht, Header wählt Org nur aus)

- `infrastructure/rate-repository.ts` über `TenantQuery`. OpenAPI: NAMED_SCHEMAS + paths,
  `openapi:write`, Route-Conformance-Einträge.

### 4 — AppShell, Kostenroute, Eingabemaske

- Tokens v2.0 nach `apps/web/app/globals.css` (semantische Namen, hell+dunkel via
  `prefers-color-scheme`), bestehende 8 Variablen migrieren.
- `packages/ui` ergänzen (domänenfrei, Klassen `eyt-*`, Styling in globals.css):
  `PageHeader`, `StatusBadge` (Text+Symbol, nie nur Farbe), `StateBanner`, `PrimaryAction`,
  `EmptyState`, `ErrorState`. `AppShell` bleibt App-Komponente (`components/app-shell.tsx`),
  bekommt Navigation mit Rechtefilter (Kosten nur bei `costs.read` aus Session-DTO).
  `CostSnapshotTable` = Admin-Komponente in `apps/web/components/` (Basisdesign §6: adminspezifisch).
- Routen: `app/anmelden/page.tsx` (Login), `app/kosten/page.tsx` (Tageskosten+Snapshot),
  `app/kosten/stundensaetze/page.tsx` (Satzverwaltung; Muster `app/page.tsx`: Fragment,
  KEIN doppeltes `<main>` — Befund Landmark-Doppelung in planung/page.tsx nicht kopieren).
  CTA wörtlich: „Neue Satzversion anlegen". Kein Optimismus: nach Save neu laden.
- Zustände als echte Komponenten (PO-§7-Liste), `FAILURE_TEXT: Record<GatewayFailure,…>`
  vollständig ohne Default-Zweig (Muster planning-window-view).

### 5 — Tageskosten-Snapshot (EYT-109)

`cost_snapshots` + `cost_snapshot_positions` (Migration in Schritt 2 ODER separate 0014 —
Entscheidung: **0014**, damit Satz-Slice unabhängig grün wird). Tagesallokation in Org-Zeitzone
(`Intl` mit explizitem timeZone, kein lokales Datum konstruieren — no-local-time-Guard!),
wirksame Satzversion am Leistungsdatum, fehlend/mehrdeutig blockiert (nie 0,00),
`sumPlanCostAmounts` aus EYT-95. Snapshot unveränderlich (Grants select+insert).

### 6 — Excel-Export (EYT-110)

Nur aus Snapshot-ID, kein zweiter Rechenweg. XLSX-Bibliothek: **exceljs** (Entscheidung,
`XLSX_LIBRARY_PATTERN` in costs-rules.ts + API_ALLOWED_PACKAGES ergänzen). Metadatenblatt +
Positionsblatt, Formula-Injection-Escape (führende `= + - @` → `'`), stabile Header.

### 7 — Deploy + Browser-E2E

Neuer Railway-Service für `@easytree/web` (`EASYTREE_API_PROXY_TARGET` → private
API-Domain), Playwright-Reise ohne injizierte Identität (ersetzt argv-Subjekt des
Harness), Demoablauf-Runbook.

## Offene Entscheidungen, die den Bau nicht blockieren

- Realer Supabase-Benutzer + Membership auf der Kunden-DB für die Live-Demo: braucht
  GoTrue-Signup oder Dashboard-Einladung — vor Schritt 7 mit PO klären (kein Self-Service
  im Slice).
- `costs.manage_rates` bleibt owner-only (Matrix); Manager sieht Historie, legt keine an.
