-- Migration 0006_worksites (EYT-86)
-- Baustellen einer Organisation.
--
-- Rollback: forward-fix per neuer Migration. Datenverlust: alle worksites.

-- ---------------------------------------------------------------------------
-- worksites
-- ---------------------------------------------------------------------------
-- Bewusst schmal: Adresse, Treffpunkt, Taetigkeiten und Briefing gehoeren zu
-- EYT-16, das nicht im Sprint ist (Sprintplan L-7). Eine Spalte, die kein
-- Ticket schreibt, ist das Schema-Aequivalent zu totem Code.
--
-- activity_count bildet die PRD-Regel "mindestens eine Taetigkeit vor
-- Veroeffentlichung" ab, ohne die Taetigkeitstabelle vorwegzunehmen. Der Wert
-- ist heute vom Aufrufer gepflegt; sobald EYT-16 activities anlegt, wird er
-- durch eine abgeleitete Groesse ersetzt (forward-fix).
create table public.worksites (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  activity_count integer not null default 0 check (activity_count >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id)
);

comment on table public.worksites is
  'Baustelle je Organisation (EYT-86). Adresse, Treffpunkt und Taetigkeiten folgen mit EYT-16.';

comment on column public.worksites.activity_count is
  'Anzahl hinterlegter Taetigkeiten. > 0 ist Voraussetzung fuer die Veroeffentlichung (PRD v1.3, EYT-16). Vorlaeufig gepflegt, spaeter abgeleitet.';

create index worksites_org_active_idx on public.worksites (org_id, active);

revoke all on table public.worksites from anon;
grant select, insert, update, delete on table public.worksites to authenticated;

alter table public.worksites enable row level security;
alter table public.worksites force row level security;

create policy worksites_select_in_org on public.worksites
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy worksites_insert_in_org on public.worksites
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

create policy worksites_update_in_org on public.worksites
  for update to authenticated
  using (org_id in (select app.user_org_ids()))
  with check (org_id in (select app.user_org_ids()));

create policy worksites_delete_in_org on public.worksites
  for delete to authenticated
  using (org_id in (select app.user_org_ids()));
