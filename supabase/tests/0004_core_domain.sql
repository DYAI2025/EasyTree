-- pgTAP: Fachschema und seine Mandantengrenze (EYT-86).
--
-- Muster wie 0002_rls_isolation.sql: Rollenwechsel wie im echten API-Pfad,
-- `set local role authenticated` plus `request.jwt.claims` pro Transaktion.
--
-- Diese Suite beweist ORGANISATIONSISOLATION. Sie beweist NICHT die
-- Self-Service-Autorisierung innerhalb einer Organisation: employees und
-- assignments sind personenbezogen, und bis EYT-14 darf dort jedes aktive
-- Mitglied lesen und schreiben. Das ist eine bewusste Zwischenstufe, keine
-- Luecke, die hier stillschweigend als geschlossen gilt.

begin;
select plan(19);

-- ===========================================================================
-- Schemaform: die Zusagen aus der Migration
-- ===========================================================================
select has_column('public', 'organizations', 'time_zone', 'organizations traegt eine Zeitzone');

select is(
  (select time_zone from public.organizations where id = '00000000-0000-0000-0000-0000000000a1'),
  'Europe/Berlin',
  'Org Alpha hat eine gueltige IANA-Zeitzone'
);

-- ---------------------------------------------------------------------------
-- Die Zeitzone ist geprueft, nicht nur getippt
-- ---------------------------------------------------------------------------
-- Die Pruefung ist ein Trigger, keine CHECK-Constraint (Begruendung in
-- 0004_org_settings.sql). Wer sie sucht, findet sie deshalb NICHT in
-- pg_constraint — daher diese explizite Zusicherung.
select has_trigger(
  'public', 'organizations', 'organizations_time_zone_known',
  'organizations traegt den Zeitzonen-Trigger'
);

select throws_ok(
  $$insert into public.organizations (name, time_zone)
    values ('Zeitzonenprobe', 'Europe/Berlin_gibt_es_nicht')$$,
  '23514',
  'Unbekannte IANA-Zeitzone: Europe/Berlin_gibt_es_nicht',
  'Eine unbekannte Zeitzone wird abgelehnt'
);

-- Gegenprobe: ohne sie waere ein Trigger, der ALLES ablehnt, ebenfalls gruen.
select lives_ok(
  $$insert into public.organizations (name, time_zone)
    values ('Zeitzonenprobe gueltig', 'Pacific/Auckland')$$,
  'Eine gueltige, nicht-europaeische Zeitzone wird akzeptiert'
);

select has_column('public', 'assignments', 'during', 'assignments traegt die generierte Range fuer EYT-49');

select has_column('public', 'assignments', 'published_at', 'assignments traegt den lokal pruefbaren Veroeffentlichungsmarker');

-- btree_gist ist die Voraussetzung dafuer, dass EYT-49 seinen EXCLUDE ueber
-- Gleichheit UND Ueberlappung ueberhaupt schreiben kann.
select is(
  (select count(*)::int from pg_extension where extname = 'btree_gist'),
  1,
  'btree_gist ist installiert — EYT-49 kann darauf aufbauen'
);

-- ===========================================================================
-- Kontext: User A — AKTIVE Membership in Org Alpha
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-0000-0000-00000000aaa1',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Lesen: nur die eigene Organisation
-- ---------------------------------------------------------------------------
select is_empty(
  $$select * from public.employees where org_id = '00000000-0000-0000-0000-0000000000b2'$$,
  'A: Cross-Tenant-Read auf Beta-Employees ist leer'
);

select is_empty(
  $$select * from public.worksites where org_id = '00000000-0000-0000-0000-0000000000b2'$$,
  'A: Cross-Tenant-Read auf Beta-Worksites ist leer'
);

select is_empty(
  $$select * from public.assignments where org_id = '00000000-0000-0000-0000-0000000000b2'$$,
  'A: Cross-Tenant-Read auf Beta-Assignments ist leer'
);

select is_empty(
  $$select * from public.plan_versions where org_id = '00000000-0000-0000-0000-0000000000b2'$$,
  'A: Cross-Tenant-Read auf Beta-Planversionen ist leer'
);

-- Die eigene Organisation ist sichtbar — sonst waeren die Leer-Zusicherungen
-- oben auch dann gruen, wenn gar nichts lesbar ist.
select isnt_empty(
  $$select * from public.organizations$$,
  'A: die eigene Organisation ist lesbar'
);

-- ---------------------------------------------------------------------------
-- Schreiben: manipulierte org_id wird abgelehnt
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.employees (org_id, display_name)
    values ('00000000-0000-0000-0000-0000000000b2', 'geschmuggelt')$$,
  '42501',
  'new row violates row-level security policy for table "employees"',
  'A: insert employees mit fremder org_id wird mit 42501 abgelehnt'
);

select throws_ok(
  $$insert into public.worksites (org_id, name)
    values ('00000000-0000-0000-0000-0000000000b2', 'geschmuggelt')$$,
  '42501',
  'new row violates row-level security policy for table "worksites"',
  'A: insert worksites mit fremder org_id wird mit 42501 abgelehnt'
);

select throws_ok(
  $$insert into public.audit_events (org_id, event_type, subject_type, subject_id)
    values ('00000000-0000-0000-0000-0000000000b2', 'x', 'y', gen_random_uuid())$$,
  '42501',
  'new row violates row-level security policy for table "audit_events"',
  'A: insert audit_events mit fremder org_id wird mit 42501 abgelehnt'
);

-- ---------------------------------------------------------------------------
-- Anfuegbarkeit ist ein RECHT, keine Konvention
-- ---------------------------------------------------------------------------
-- Kein update/delete-Grant auf audit_events. Der Fehler ist deshalb 42501
-- "permission denied", nicht eine Policy-Ablehnung — die Tabelle ist auf
-- Rechteebene anfuegbar, nicht nur per Vereinbarung.
select is(
  has_table_privilege('authenticated', 'public.audit_events', 'update'),
  false,
  'authenticated darf audit_events NICHT aendern'
);

select is(
  has_table_privilege('authenticated', 'public.audit_events', 'delete'),
  false,
  'authenticated darf audit_events NICHT loeschen'
);

-- ---------------------------------------------------------------------------
-- Zeitmodell: dieselbe Regel wie im Domainmodell (EYT-73)
-- ---------------------------------------------------------------------------
-- start == end war im Prototyp 24 Stunden. Hier ist es ungueltig, und zwar auf
-- Datenbankebene, nicht nur in TypeScript.
select throws_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    select o.id, pv.id, e.id, w.id,
           timestamptz '2026-08-03T06:00:00Z', timestamptz '2026-08-03T06:00:00Z'
    from public.organizations o
    join public.plan_versions pv on pv.org_id = o.id
    join public.employees e on e.org_id = o.id
    join public.worksites w on w.org_id = o.id
    limit 1$$,
  '23514',
  'A: assignment mit start == end verletzt assignments_interval_ordered'
);

select * from finish();
rollback;
