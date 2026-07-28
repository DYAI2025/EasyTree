-- pgTAP-Isolationstests (EYT-15): Tenant-Isolation per RLS BEWEISEN.
-- TDD: Diese Tests wurden VOR den Policies geschrieben (roter Lauf
-- dokumentiert in docs/architecture/tenant-isolation-report.md).
--
-- Technik: Rollenwechsel wie im echten API-Pfad — `set local role
-- authenticated` + `request.jwt.claims` (nur sub/role) pro Transaktion.
-- Ausfuehrung: pnpm exec supabase test db

begin;

select plan(27);

-- ===========================================================================
-- Kontext: User A — AKTIVE Membership in Org Alpha
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-00000000aaa1',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

-- (1) A sieht ausschliesslich Org-Alpha-Items
select results_eq(
  $$select org_id from public.items$$,
  $$values ('00000000-0000-4000-8000-0000000000a1'::uuid)$$,
  'A: select items liefert ausschliesslich Org-Alpha-Zeilen'
);

-- (2) Cross-Tenant-Read: Org-Beta-Items sind leer
select is_empty(
  $$select * from public.items where org_id = '00000000-0000-4000-8000-0000000000b2'$$,
  'A: Cross-Tenant-Read auf Org-Beta-Items ist leer'
);

-- (3) IDOR: direkter Zugriff auf bekannte fremde Item-UUID ist leer
select is_empty(
  $$select * from public.items where id = '00000000-0000-4000-8000-0000000220b2'$$,
  'A: IDOR mit fremder Item-UUID liefert keine Zeile'
);

-- (4) IDOR auf item_notes des fremden Tenants ist leer
select is_empty(
  $$select * from public.item_notes where org_id = '00000000-0000-4000-8000-0000000000b2'$$,
  'A: Cross-Tenant-Read auf Org-Beta-Notes ist leer'
);

-- (5) Cross-Tenant-Insert (manipulierte org_id) wird abgelehnt
select throws_ok(
  $$insert into public.items (org_id, title)
    values ('00000000-0000-4000-8000-0000000000b2', 'smuggled')$$,
  '42501',
  'new row violates row-level security policy for table "items"',
  'A: insert mit org_id=Beta wird mit 42501 abgelehnt'
);

-- (6) Manipulierte org_id auf item_notes wird abgelehnt (RLS vor FK)
select throws_ok(
  $$insert into public.item_notes (org_id, item_id, body)
    values ('00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-0000000220b2', 'smuggled note')$$,
  '42501',
  'new row violates row-level security policy for table "item_notes"',
  'A: insert item_notes mit org_id=Beta wird mit 42501 abgelehnt'
);

-- (7) Cross-Tenant-Update trifft 0 Zeilen
select results_eq(
  $$with upd as (
      update public.items set title = 'pwned'
      where org_id = '00000000-0000-4000-8000-0000000000b2'
      returning 1)
    select count(*) from upd$$,
  $$values (0::bigint)$$,
  'A: update auf Org-Beta-Items betrifft 0 Zeilen'
);

-- (8) Cross-Tenant-Delete trifft 0 Zeilen
select results_eq(
  $$with del as (
      delete from public.items
      where org_id = '00000000-0000-4000-8000-0000000000b2'
      returning 1)
    select count(*) from del$$,
  $$values (0::bigint)$$,
  'A: delete auf Org-Beta-Items betrifft 0 Zeilen'
);

-- (9) Positivkontrolle: Schreiben im EIGENEN Tenant funktioniert
select lives_ok(
  $$insert into public.items (org_id, title)
    values ('00000000-0000-4000-8000-0000000000a1', 'Alpha Item von A')$$,
  'A: insert im eigenen Tenant Org Alpha funktioniert'
);

-- (10) users: nur das eigene Profil sichtbar
select results_eq(
  $$select id from public.users$$,
  $$values ('00000000-0000-4000-8000-00000000aaa1'::uuid)$$,
  'A: select users liefert ausschliesslich das eigene Profil'
);

-- (11) memberships: nur eigene Memberships sichtbar
select results_eq(
  $$select user_id from public.memberships$$,
  $$values ('00000000-0000-4000-8000-00000000aaa1'::uuid)$$,
  'A: select memberships liefert ausschliesslich eigene Zeilen'
);

-- (12) memberships: Selbst-Eskalation (A traegt sich in Org Beta ein) abgelehnt
select throws_ok(
  $$insert into public.memberships (org_id, user_id, role, active)
    values ('00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-00000000aaa1', 'owner', true)$$,
  '42501',
  null,
  'A: insert in memberships (Selbst-Eskalation nach Org Beta) wird abgelehnt'
);

-- (13) Storage: fremder Tenant-Pfad ist nicht lesbar
select is_empty(
  $$select name from storage.objects
    where bucket_id = 'tenant-files'
      and name like '00000000-0000-4000-8000-0000000000b2/%'$$,
  'A: Storage-Pfad org_beta/... ist nicht lesbar'
);

-- (14) Storage-Positivkontrolle: eigener Tenant-Pfad ist lesbar
select results_eq(
  $$select count(*) from storage.objects
    where bucket_id = 'tenant-files'
      and name like '00000000-0000-4000-8000-0000000000a1/%'$$,
  $$values (1::bigint)$$,
  'A: Storage-Pfad org_alpha/... ist lesbar (1 Seed-Objekt)'
);

-- (15) Storage: Schreiben in fremden Tenant-Pfad wird abgelehnt
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('tenant-files',
            '00000000-0000-4000-8000-0000000000b2/evil.txt',
            '00000000-0000-4000-8000-00000000aaa1')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'A: Storage-Insert unter org_beta/... wird mit 42501 abgelehnt'
);

-- (16) Storage-Positivkontrolle: Schreiben im eigenen Tenant-Pfad funktioniert
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('tenant-files',
            '00000000-0000-4000-8000-0000000000a1/upload-von-a.txt',
            '00000000-0000-4000-8000-00000000aaa1')$$,
  'A: Storage-Insert unter org_alpha/... funktioniert'
);

-- ===========================================================================
-- Kontext: User C — INAKTIVE Membership in Org Alpha
-- ===========================================================================
reset role;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-00000000ccc3',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

-- (17) Inaktive Membership oeffnet keinen Item-Zugriff
select is_empty(
  $$select * from public.items$$,
  'C (inaktive Membership): select items ist leer'
);

-- (18) Inaktive Membership oeffnet keinen Notes-Zugriff
select is_empty(
  $$select * from public.item_notes$$,
  'C (inaktive Membership): select item_notes ist leer'
);

-- (19) Inaktive Membership oeffnet keinen Storage-Zugriff
select is_empty(
  $$select name from storage.objects
    where bucket_id = 'tenant-files'
      and name like '00000000-0000-4000-8000-0000000000a1/%'$$,
  'C (inaktive Membership): Storage-Pfad org_alpha/... ist nicht lesbar'
);

-- ===========================================================================
-- Kontext: User B — AKTIVE Membership in Org Beta (Gegenprobe)
-- ===========================================================================
reset role;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-00000000bbb2',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

-- (20) B sieht ausschliesslich Org-Beta-Items
select results_eq(
  $$select distinct org_id from public.items$$,
  $$values ('00000000-0000-4000-8000-0000000000b2'::uuid)$$,
  'B: select items liefert ausschliesslich Org-Beta-Zeilen'
);

-- ===========================================================================
-- DB-Ebene (als Migrationsrolle): strukturelle Garantien
-- ===========================================================================
reset role;

-- (21) Tenantgebundener FK: Cross-Tenant-Referenz scheitert bereits am FK
--      (Alpha-Item unter Beta-org_id — selbst OHNE RLS unmoeglich, 23503)
select throws_ok(
  $$insert into public.item_notes (org_id, item_id, body)
    values ('00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-0000000110a1', 'cross-tenant ref')$$,
  '23503',
  null,
  'FK (item_id, org_id): Cross-Tenant-Referenz wird mit 23503 abgelehnt'
);

-- (22) Least Privilege: authenticated hat KEIN BYPASSRLS
select ok(
  (select not rolbypassrls from pg_roles where rolname = 'authenticated'),
  'Rolle authenticated hat rolbypassrls = false'
);

-- (23-26) RLS ist ENABLED + FORCED auf allen exponierten Tabellen
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.users'::regclass),
  'RLS enabled + forced auf public.users'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.memberships'::regclass),
  'RLS enabled + forced auf public.memberships'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.items'::regclass),
  'RLS enabled + forced auf public.items'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.item_notes'::regclass),
  'RLS enabled + forced auf public.item_notes'
);

-- (27) Keine service_role-Umgehungs-Policies im normalen Pfad
select is_empty(
  $$select policyname from pg_policies
    where schemaname in ('public', 'storage')
      and 'service_role' = any (roles)$$,
  'keine expliziten Policies fuer service_role in public/storage'
);

select * from finish();

rollback;
