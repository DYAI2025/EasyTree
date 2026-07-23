-- Migration 0002_tenancy (EYT-15)
-- Tenant-/Identity-Schema + RLS-Beweis (Sicherheitsgate, Task 7).
-- Schemaquelle: AUSSCHLIESSLICH Migrationen in supabase/migrations/.
-- Siehe docs/runbooks/database-workflow.md, ADR-001 und
-- docs/architecture/tenant-isolation-report.md.

-- ---------------------------------------------------------------------------
-- Schema app: Tenantkontext-Helper (kein Tabellenbestand)
-- ---------------------------------------------------------------------------
create schema if not exists app;

comment on schema app is
  'Tenantkontext-Helper (RLS). Keine Tabellen. Zugriff: authenticated (execute only).';

grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- Tabelle: users — Mapping auf auth.users (verifizierte Identitaet)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.users is
  'App-Profil je auth.users-Identitaet. RLS: nur self (id = auth.uid()).';

-- ---------------------------------------------------------------------------
-- Tabelle: memberships — User <-> Organization mit Rolle und Aktiv-Flag
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

comment on table public.memberships is
  'Tenant-Mitgliedschaften. Nur AKTIVE Memberships oeffnen Tenantzugriff (app.user_org_ids()).';

-- ---------------------------------------------------------------------------
-- Beispiel-Fachtabelle: items — jede exponierte Tabelle traegt org_id
-- Zusammengesetzter Unique (id, org_id) als Ziel tenantgebundener FKs.
-- ---------------------------------------------------------------------------
create table public.items (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id)
);

comment on table public.items is
  'Beispiel-Fachtabelle. unique(id, org_id) macht tenantgebundene FKs moeglich.';

-- ---------------------------------------------------------------------------
-- item_notes — Demonstration tenantgebundener FK:
-- (item_id, org_id) referenziert items(id, org_id). Eine Note kann damit
-- NIE auf ein Item eines anderen Tenants zeigen — Cross-Tenant-Referenzen
-- sind bereits auf DB-Ebene (FK, 23503) unmoeglich, unabhaengig von RLS.
-- ---------------------------------------------------------------------------
create table public.item_notes (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (id),
  foreign key (item_id, org_id)
    references public.items (id, org_id) on delete cascade
);

comment on table public.item_notes is
  'Tenantgebundener FK (item_id, org_id) -> items(id, org_id): Cross-Tenant-Referenz unmoeglich.';

-- ---------------------------------------------------------------------------
-- Tenantkontext-Helper
-- ---------------------------------------------------------------------------
-- Identitaet AUSSCHLIESSLICH aus dem verifizierten JWT (auth.uid() liest
-- request.jwt.claims.sub, das nur der Auth-Stack bzw. der DB-Rollenwechsel
-- pro Transaktion setzt). Kein Client-Parameter, keine Header-Injektion.
create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;

comment on function app.current_user_id() is
  'Verifizierte User-Identitaet aus dem JWT (auth.uid()). Einzige Identitaetsquelle fuer RLS.';

-- security definer: liest memberships am RLS vorbei (verhindert Policy-
-- Rekursion), search_path fixiert (kein Schema-Hijacking), liefert NUR
-- AKTIVE Memberships — eine inaktive Membership oeffnet keinen Tenant.
create or replace function app.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
    and m.active
$$;

comment on function app.user_org_ids() is
  'Org-IDs der AKTIVEN Memberships des JWT-Users. security definer mit fixiertem search_path.';

revoke all on function app.current_user_id() from public;
revoke all on function app.user_org_ids() from public;
grant execute on function app.current_user_id() to authenticated;
grant execute on function app.user_org_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants (Least Privilege):
-- - Die Supabase-Default-Privileges geben authenticated auf neuen Tabellen
--   KEIN select/insert/update/delete (fail closed). Wir granten explizit nur,
--   was die RLS-Policies tragen sollen.
-- - anon: gar nichts (Defense-in-Depth, zusaetzlich zu fehlenden Policies).
-- - memberships: authenticated darf NUR lesen — Verwaltung von Memberships
--   ist kein Self-Service (kein insert/update/delete-Grant, keine Policies).
-- ---------------------------------------------------------------------------
revoke all on table public.users, public.memberships, public.items, public.item_notes
  from anon;

grant select, insert, update, delete on table public.users to authenticated;
grant select on table public.memberships to authenticated;
grant select, insert, update, delete on table public.items to authenticated;
grant select, insert, update, delete on table public.item_notes to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE + Policies  (implementiert NACH dem roten pgTAP-Lauf,
-- siehe docs/architecture/tenant-isolation-report.md)
--
-- Prinzipien:
-- - Policies ausschliesslich `to authenticated`. anon: keine Policies, keine
--   Grants. KEINE service_role-Policies — service_role umgeht RLS nur ueber
--   das Rollenattribut BYPASSRLS und ist im normalen API-/Worker-Pfad
--   verboten (ADR-001, Sicherheitsgrenzen).
-- - Tenantzugriff NUR ueber app.user_org_ids() (aktive Memberships aus
--   verifiziertem JWT). users: nur self. memberships: lesbar nur eigene.
-- - FORCE: auch der Tabellenowner unterliegt RLS (greift, sobald der Owner
--   kein BYPASSRLS-Attribut traegt).
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
alter table public.items enable row level security;
alter table public.items force row level security;
alter table public.item_notes enable row level security;
alter table public.item_notes force row level security;

-- users: ausschliesslich das eigene Profil
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select app.current_user_id()));

create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = (select app.current_user_id()));

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select app.current_user_id()))
  with check (id = (select app.current_user_id()));

create policy users_delete_self on public.users
  for delete to authenticated
  using (id = (select app.current_user_id()));

-- memberships: lesbar nur eigene. BEWUSST keine insert/update/delete-Policies
-- (und keine Grants): Membership-Verwaltung ist kein Self-Service —
-- Selbst-Eskalation in fremde Orgs ist damit doppelt (Grant + Policy) dicht.
create policy memberships_select_own on public.memberships
  for select to authenticated
  using (user_id = (select app.current_user_id()));

-- items: voller CRUD nur innerhalb aktiver eigener Orgs
create policy items_select_in_org on public.items
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy items_insert_in_org on public.items
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

create policy items_update_in_org on public.items
  for update to authenticated
  using (org_id in (select app.user_org_ids()))
  with check (org_id in (select app.user_org_ids()));

create policy items_delete_in_org on public.items
  for delete to authenticated
  using (org_id in (select app.user_org_ids()));

-- item_notes: voller CRUD nur innerhalb aktiver eigener Orgs
create policy item_notes_select_in_org on public.item_notes
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy item_notes_insert_in_org on public.item_notes
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

create policy item_notes_update_in_org on public.item_notes
  for update to authenticated
  using (org_id in (select app.user_org_ids()))
  with check (org_id in (select app.user_org_ids()));

create policy item_notes_delete_in_org on public.item_notes
  for delete to authenticated
  using (org_id in (select app.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Storage-Policies: privater Bucket tenant-files
-- Pfadkonvention: '<org_id>/...' — erstes Pfadsegment ist die Org-UUID.
-- Zugriff NUR bei aktiver Membership der Org im Pfad (app.user_org_ids()).
-- storage.objects hat RLS bereits enabled (Storage-Service); ohne Policies
-- ist der Bucket komplett dicht (fail closed).
-- ---------------------------------------------------------------------------
create policy tenant_files_select_in_org on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenant-files'
    and split_part(name, '/', 1) in (select o::text from app.user_org_ids() as o)
  );

create policy tenant_files_insert_in_org on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-files'
    and split_part(name, '/', 1) in (select o::text from app.user_org_ids() as o)
  );

create policy tenant_files_update_in_org on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tenant-files'
    and split_part(name, '/', 1) in (select o::text from app.user_org_ids() as o)
  )
  with check (
    bucket_id = 'tenant-files'
    and split_part(name, '/', 1) in (select o::text from app.user_org_ids() as o)
  );

create policy tenant_files_delete_in_org on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenant-files'
    and split_part(name, '/', 1) in (select o::text from app.user_org_ids() as o)
  );
