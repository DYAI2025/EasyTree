-- pgTAP-Smoke-Test (EYT-44): Foundation-Migration + Seed sind reproduzierbar eingespielt.
-- Ausfuehrung: supabase test db
begin;

select plan(6);

-- Extension
select has_extension('pgtap', 'extension pgtap is installed');

-- Tabelle organizations
select has_table('public', 'organizations', 'table public.organizations exists');
select col_is_pk('public', 'organizations', 'id', 'organizations.id is primary key');

-- Seed-Daten (zwei synthetische Organisationen)
select ok(
  (select count(*) >= 2 from public.organizations),
  'at least 2 seed organizations present'
);

-- Privater Storage-Bucket
select ok(
  exists (select 1 from storage.buckets where id = 'tenant-files'),
  'bucket tenant-files exists'
);
select ok(
  (select public = false from storage.buckets where id = 'tenant-files'),
  'bucket tenant-files is private (public = false)'
);

select * from finish();

rollback;
