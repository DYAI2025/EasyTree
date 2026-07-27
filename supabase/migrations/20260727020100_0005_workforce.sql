-- Migration 0005_workforce (EYT-86)
-- Beschaeftigte einer Organisation.
--
-- Rollback: forward-fix per neuer Migration. Datenverlust: alle employees.

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
-- Bewusst getrennt von public.users: users ist die Identitaet (1:1 auf
-- auth.users, kein org_id, RLS "nur self"), employees ist die Beschaeftigung IN
-- einer Organisation. Eine Person kann in zwei Organisationen beschaeftigt sein
-- und ist dann zweimal employee, aber einmal user.
--
-- user_id ist NULLABLE: eine geplante Person braucht nicht zwingend einen
-- Zugang. Genau deshalb kann employees NICHT ueber users mandantisiert werden
-- und traegt sein eigenes org_id.
--
-- PERSONENBEZUG: diese Tabelle enthaelt Beschaeftigtendaten. EYT-86 beweist
-- Organisationsisolation, NICHT die endgueltige Self-Service-Autorisierung —
-- innerhalb einer Organisation darf hier vorerst jedes aktive Mitglied lesen
-- und schreiben. Das Subjekt- und Rollenmodell bleibt bei EYT-14.
create table public.employees (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  display_name text not null check (length(trim(display_name)) > 0),
  -- Inaktive Personen bleiben referenzierbar: historische Zuweisungen und
  -- Auditspuren muessen eine Deaktivierung ueberleben (PRD v1.3, EYT-14).
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Eine Identitaet ist pro Organisation hoechstens einmal beschaeftigt.
  unique (org_id, user_id)
);

comment on table public.employees is
  'Beschaeftigte Person je Organisation (EYT-86). Traegt Personenbezug. Loeschen ist nicht vorgesehen — Deaktivierung ueber active, damit Historie und Audit erhalten bleiben.';

comment on column public.employees.user_id is
  'Optionaler Zugang. NULL = geplante Person ohne Login. Deshalb ist org_id eigenstaendig und nicht aus users abgeleitet.';

create index employees_org_active_idx on public.employees (org_id, active);

revoke all on table public.employees from anon;

-- KEIN delete. Der Tabellenkommentar oben sagt "Loeschen ist nicht vorgesehen —
-- Deaktivierung ueber active"; ein delete-Grant haette genau das zur blossen
-- Bitte gemacht. Der FK RESTRICT aus 0007 schuetzt nur BEREITS referenzierte
-- Personen: eine Person ohne Zuweisung waere fuer jedes aktive Mitglied
-- physisch loeschbar gewesen — unwiderruflich, und bei personenbezogenen Daten
-- ohne jede Spur.
--
-- Loeschen auf Betroffenenverlangen (DSGVO Art. 17) ist damit NICHT
-- ausgeschlossen, sondern noch nicht gebaut. Es braucht einen eigenen,
-- protokollierten Pfad und gehoert zu EYT-14; hier waere es ein Nebeneffekt
-- eines Grants gewesen, den niemand entschieden hat.
grant select, insert, update on table public.employees to authenticated;

alter table public.employees enable row level security;
alter table public.employees force row level security;

create policy employees_select_in_org on public.employees
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy employees_insert_in_org on public.employees
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

create policy employees_update_in_org on public.employees
  for update to authenticated
  using (org_id in (select app.user_org_ids()))
  with check (org_id in (select app.user_org_ids()));

-- Bewusst KEINE delete-Policy. Sie waere ohne Grant wirkungslos und wuerde
-- beim Lesen der Datei den Eindruck erwecken, Loeschen sei vorgesehen.
