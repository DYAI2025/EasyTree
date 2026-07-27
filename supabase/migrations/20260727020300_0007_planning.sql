-- Migration 0007_planning (EYT-86)
-- Planversionen und Einsatzzuweisungen — der Kern des Sprintziels.
--
-- Rollback: forward-fix per neuer Migration. Datenverlust: alle Planversionen
-- und Zuweisungen. Ein Rueckbau nach der ersten Veroeffentlichung ist ohne
-- Restore-Nachweis verboten (CLAUDE.md).

-- ---------------------------------------------------------------------------
-- plan_versions — Entwurf und veroeffentlichte Version sind getrennt (EYT-18)
-- ---------------------------------------------------------------------------
-- published_at ist AUTORITATIV. NULL = Entwurf, gesetzt = veroeffentlicht.
-- Kein status-Enum: ein Zeitpunkt traegt dieselbe Information und zusaetzlich
-- das Wann, das das Audit ohnehin braucht.
create table public.plan_versions (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- ISO-Woche als Planungsfenster, Format 2026-W32. Dieselbe Einheit, die
  -- packages/domain/src/planning-week.ts erzeugt und packages/contracts
  -- transportiert — der Client rechnet Wochen nicht selbst (FIND-003).
  week_key text not null check (week_key ~ '^\d{4}-W\d{2}$'),
  published_at timestamptz,
  published_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Wer veroeffentlicht, muss auch das Wann tragen — und umgekehrt.
  constraint plan_versions_publication_complete
    check ((published_at is null) = (published_by is null))
);

comment on table public.plan_versions is
  'Planversion je Organisation und ISO-Woche (EYT-86). published_at ist die autoritative Veroeffentlichungsmarke; assignments.published_at wird davon abgeleitet und atomar mitgesetzt (EYT-49).';

-- Genau eine unveroeffentlichte Version je Woche: sonst gaebe es zwei
-- konkurrierende Entwuerfe und "der" Entwurf waere nicht bestimmbar.
create unique index plan_versions_one_draft_per_week
  on public.plan_versions (org_id, week_key)
  where published_at is null;

create index plan_versions_org_week_idx on public.plan_versions (org_id, week_key);

-- ---------------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------------
-- Tenantgebundene FKs: (employee_id, org_id) und (worksite_id, org_id) zeigen
-- auf die zusammengesetzten Unique-Keys. Eine Zuweisung kann damit NIE eine
-- Person oder Baustelle eines anderen Mandanten referenzieren — Cross-Tenant
-- scheitert am FK (23503), unabhaengig von RLS.
--
-- Zeitmodell: zwei timestamptz-Spalten plus eine generierte halboffene
-- tstzrange. Die Spalten sind lesbar und einzeln indizierbar, die Range ist
-- das, woran EYT-49 seinen EXCLUDE haengt. '[)' entspricht exakt
-- packages/domain/src/time-interval.ts — ein Baustellenwechsel um 12:00 ist
-- kein Konflikt.
--
-- published_at ist der LOKAL PRUEFBARE Marker. plan_versions.published_at
-- bleibt autoritativ; diese Spalte existiert, weil ein Tabellen-Constraint
-- keine andere Tabelle referenzieren darf und EYT-49 seinen partiellen EXCLUDE
-- sonst nicht schreiben koennte. EYT-49 setzt beide atomar und filtert mit
-- `where published_at is not null`.
create table public.assignments (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_version_id uuid not null,
  employee_id uuid not null,
  worksite_id uuid not null,
  starts_at_utc timestamptz not null,
  ends_at_utc timestamptz not null,
  during tstzrange generated always as (tstzrange(starts_at_utc, ends_at_utc, '[)')) stored,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Halboffen und echt positiv — dieselbe Regel wie im Domainmodell (EYT-73).
  -- Der Prototyp wertete start == end als 24 Stunden; hier ist es ungueltig.
  constraint assignments_interval_ordered check (starts_at_utc < ends_at_utc),
  foreign key (plan_version_id, org_id)
    references public.plan_versions (id, org_id) on delete cascade,
  foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete restrict,
  foreign key (worksite_id, org_id)
    references public.worksites (id, org_id) on delete restrict
);

comment on table public.assignments is
  'Zuweisung einer Person zu einer Baustelle in einem halboffenen Zeitraum (EYT-86). Tenantgebundene FKs machen Cross-Tenant-Referenzen auf FK-Ebene unmoeglich.';

comment on column public.assignments.during is
  'Generierte halboffene Range [starts_at_utc, ends_at_utc). Traeger des EXCLUDE-Constraints aus EYT-49; entspricht packages/domain/src/time-interval.ts.';

comment on column public.assignments.published_at is
  'Lokal pruefbarer Veroeffentlichungsmarker. Autoritativ ist plan_versions.published_at; EYT-49 setzt beide atomar und braucht diesen Marker, weil ein Tabellen-Constraint keine Fremdtabelle referenzieren kann.';

create index assignments_org_employee_idx on public.assignments (org_id, employee_id);
create index assignments_plan_version_idx on public.assignments (plan_version_id);

-- ---------------------------------------------------------------------------
-- Grants und RLS
-- ---------------------------------------------------------------------------
revoke all on table public.plan_versions, public.assignments from anon;
grant select, insert, update, delete on table public.plan_versions to authenticated;
grant select, insert, update, delete on table public.assignments to authenticated;

alter table public.plan_versions enable row level security;
alter table public.plan_versions force row level security;
alter table public.assignments enable row level security;
alter table public.assignments force row level security;

create policy plan_versions_select_in_org on public.plan_versions
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy plan_versions_insert_in_org on public.plan_versions
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

create policy plan_versions_update_in_org on public.plan_versions
  for update to authenticated
  using (org_id in (select app.user_org_ids()))
  with check (org_id in (select app.user_org_ids()));

create policy plan_versions_delete_in_org on public.plan_versions
  for delete to authenticated
  using (org_id in (select app.user_org_ids()));

create policy assignments_select_in_org on public.assignments
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy assignments_insert_in_org on public.assignments
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

create policy assignments_update_in_org on public.assignments
  for update to authenticated
  using (org_id in (select app.user_org_ids()))
  with check (org_id in (select app.user_org_ids()));

create policy assignments_delete_in_org on public.assignments
  for delete to authenticated
  using (org_id in (select app.user_org_ids()));
