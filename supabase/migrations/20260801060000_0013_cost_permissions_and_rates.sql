-- Migration 0013_cost_permissions_and_rates (EYT-106, EYT-108)
--
-- EIN Schritt, kein Zwischenzustand: der erweiterte Rollencheck und die
-- Rechtezuordnung entstehen zusammen. Getrennt gaebe es einen Zustand, in dem
-- Rechte fuer eine Rolle existieren, die der Check noch verbietet — oder eine
-- Rolle ohne jedes Recht, die im Zweifel als "darf alles" missverstanden wird.
--
-- Rollback: `drop table public.employee_rate_versions;`
--           `drop function app.has_cost_permission(uuid, text);`
--           `drop table public.role_permissions;`
--           Rollencheck auf ('owner','member') zuruecksetzen — nur solange
--           keine Zeile die Rolle 'manager' traegt.
--
-- ## Warum role_permissions global ist und KEIN org_id traegt
--
-- Die Zuordnung Rolle -> Recht ist eine Produkteigenschaft, keine Kundendaten.
-- Ein org_id waere die Einladung, sie pro Mandant zu verbiegen; genau das
-- verbietet die PO-Entscheidung ("Aenderungen ausschliesslich ueber
-- versionierte Migrationen"). Normale Anwendungsrollen bekommen deshalb NUR
-- select — kein insert, kein update, kein delete, keine Policy dafuer.
--
-- ## Warum das Ueberlappungsverbot in der Datenbank sitzt
--
-- Zwei gleichzeitige Anfragen koennen beide "kein ueberlappender Satz
-- vorhanden" lesen und beide schreiben. Nur ein EXCLUDE-Constraint
-- serialisiert das (dieselbe Begruendung wie assignments_no_published_overlap
-- in Migration 0010). btree_gist steht seit 0009 bereit.

-- ---------------------------------------------------------------------------
-- 1. Rollencheck erweitern: manager
-- ---------------------------------------------------------------------------
alter table public.memberships
  drop constraint memberships_role_check;

alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner', 'manager', 'member'));

comment on column public.memberships.role is
  'owner | manager | member. Welche Rechte daran haengen, steht in public.role_permissions.';

-- ---------------------------------------------------------------------------
-- 2. role_permissions — die Zuordnung, produktweit
-- ---------------------------------------------------------------------------
create table public.role_permissions (
  role text not null check (role in ('owner', 'manager', 'member')),
  permission text not null check (length(trim(permission)) > 0),
  primary key (role, permission)
);

comment on table public.role_permissions is
  'Rolle -> atomares Recht. Produktweit, kein org_id. Aenderungen ausschliesslich ueber versionierte Migrationen; Anwendungsrollen haben nur Leserecht (EYT-106).';

insert into public.role_permissions (role, permission) values
  ('owner', 'costs.read'),
  ('owner', 'costs.calculate'),
  ('owner', 'costs.export'),
  ('owner', 'costs.manage_rates'),
  ('manager', 'costs.read'),
  ('manager', 'costs.calculate'),
  ('manager', 'costs.export');
-- 'member' bekommt bewusst KEINE Zeile: Mitarbeitende sehen keine
-- Wirtschaftsdaten (PRD, Basisdesign §3.1).

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;

revoke all on public.role_permissions from anon;
revoke all on public.role_permissions from authenticated;
grant select on public.role_permissions to authenticated;

-- Lesbar fuer alle Angemeldeten: die Zuordnung ist kein Geheimnis, und die
-- Sitzungsantwort loest die eigenen Rechte daraus auf.
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 3. app.has_cost_permission — die EINE Rechtefrage der Datenbank
-- ---------------------------------------------------------------------------
create or replace function app.has_cost_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
      join public.role_permissions rp on rp.role = m.role
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.active
       and rp.permission = p_permission
  );
$$;

comment on function app.has_cost_permission(uuid, text) is
  'Wahr, wenn die aufrufende Identitaet eine AKTIVE Mitgliedschaft in p_org_id hat und deren Rolle p_permission traegt. security definer, damit die Policy nicht auf memberships rekursiert (EYT-106).';

revoke all on function app.has_cost_permission(uuid, text) from public;
grant execute on function app.has_cost_permission(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. employee_rate_versions — unveraenderliche Satzversionen (EYT-108)
-- ---------------------------------------------------------------------------
create table public.employee_rate_versions (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  -- Minor Units, niemals Gleitkomma. Ein expliziter Nullsatz (0) ist erlaubt
  -- und vom FEHLENDEN Satz unterscheidbar — es gibt dann eine Zeile.
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  currency text not null check (currency = 'EUR'),
  valid_from date not null,
  valid_to date null,
  predecessor_id uuid null,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null references public.users (id),
  correlation_id text not null check (length(trim(correlation_id)) > 0),
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  check (valid_to is null or valid_to > valid_from),
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete restrict,
  foreign key (predecessor_id, org_id) references public.employee_rate_versions (id, org_id) on delete restrict
);

comment on table public.employee_rate_versions is
  'Interne Netto-Stundensaetze je Mitarbeiter als unveraenderliche Versionen. Halboffenes Intervall [valid_from, valid_to); Ueberlappung ist per EXCLUDE ausgeschlossen. Nie ueberschreiben — Aenderung heisst neue Zeile mit predecessor_id (EYT-108).';

-- Das Herzstueck: keine zwei wirksamen Saetze derselben Person zur selben
-- Zeit. `[)` — der letzte Tag von valid_to gehoert NICHT mehr dazu, damit ein
-- nahtloser Anschluss (valid_to = naechstes valid_from) moeglich bleibt.
alter table public.employee_rate_versions
  add constraint employee_rate_versions_no_overlap
  exclude using gist (
    org_id with =,
    employee_id with =,
    daterange(valid_from, valid_to, '[)') with &&
  );

create index employee_rate_versions_lookup_idx
  on public.employee_rate_versions (org_id, employee_id, valid_from desc);

alter table public.employee_rate_versions enable row level security;
alter table public.employee_rate_versions force row level security;

revoke all on public.employee_rate_versions from anon;
revoke all on public.employee_rate_versions from authenticated;
-- Nur select und insert: eine Version ist unveraenderlich, und geloescht wird
-- sie nie (dieselbe Bauart wie idempotency_records, Migration 0012).
grant select, insert on public.employee_rate_versions to authenticated;

-- Lesen braucht costs.read, Anlegen costs.manage_rates. Das ist die
-- Tiefenverteidigung: die Anwendungsschicht entscheidet primaer, aber selbst
-- eine umgangene Policy in der API kommt hier nicht vorbei.
create policy employee_rate_versions_select on public.employee_rate_versions
  for select to authenticated
  using (
    org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.read')
  );

create policy employee_rate_versions_insert on public.employee_rate_versions
  for insert to authenticated
  with check (
    org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.manage_rates')
    and created_by = auth.uid()
  );
