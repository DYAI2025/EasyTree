-- pgTAP: Laufzeitrolle darf RLS nicht umgehen (EYT-45).
--
-- Diese Suite prueft eine SICHERHEITSEIGENSCHAFT, keine Schemaform. Sie muss
-- rot werden, wenn jemand der Anwendungsrolle spaeter Superuser- oder
-- BYPASSRLS-Rechte gibt — genau der Zustand, den 0003_app_role.sql behebt.

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Existenz
-- ---------------------------------------------------------------------------
select has_role('easytree_app', 'Laufzeitrolle easytree_app existiert');

-- ---------------------------------------------------------------------------
-- Die vier Attribute, an denen alles haengt
-- ---------------------------------------------------------------------------
select is(
  (select rolsuper from pg_roles where rolname = 'easytree_app'),
  false,
  'easytree_app ist kein Superuser — Superuser umgehen RLS vollstaendig'
);

select is(
  (select rolbypassrls from pg_roles where rolname = 'easytree_app'),
  false,
  'easytree_app traegt kein BYPASSRLS'
);

select is(
  (select rolinherit from pg_roles where rolname = 'easytree_app'),
  false,
  'easytree_app ist NOINHERIT — ohne set local role authenticated keine Tabellenrechte'
);

select is(
  (select rolcanlogin from pg_roles where rolname = 'easytree_app'),
  true,
  'easytree_app kann sich anmelden'
);

-- ---------------------------------------------------------------------------
-- Mitgliedschaft: der einzige Weg zu Rechten fuehrt ueber authenticated
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles grantor on grantor.oid = m.roleid
    where member.rolname = 'easytree_app'
      and grantor.rolname = 'authenticated'
  ),
  1,
  'easytree_app ist Mitglied von authenticated'
);

-- ---------------------------------------------------------------------------
-- Ohne Rollenwechsel gibt es keine Rechte. Das ist der Kern von NOINHERIT.
-- ---------------------------------------------------------------------------
select is(
  has_table_privilege('easytree_app', 'public.items', 'select'),
  false,
  'easytree_app hat OHNE Rollenwechsel kein select auf public.items'
);

select is(
  has_table_privilege('easytree_app', 'public.memberships', 'select'),
  false,
  'easytree_app hat OHNE Rollenwechsel kein select auf public.memberships'
);

-- ---------------------------------------------------------------------------
-- Gegenprobe: authenticated hat die Rechte sehr wohl. Ohne diese Zeile koennte
-- der Test oben auch gruen sein, weil die Grants insgesamt fehlen.
-- ---------------------------------------------------------------------------
select is(
  has_table_privilege('authenticated', 'public.items', 'select'),
  true,
  'authenticated hat select auf public.items — die Rechte existieren, nur nicht geerbt'
);

select * from finish();
rollback;
