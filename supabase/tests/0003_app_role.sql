-- pgTAP: Laufzeitrolle darf RLS nicht umgehen (EYT-45).
--
-- Diese Suite prueft eine SICHERHEITSEIGENSCHAFT, keine Schemaform. Sie muss
-- rot werden, wenn jemand der Anwendungsrolle spaeter Superuser- oder
-- BYPASSRLS-Rechte gibt — genau der Zustand, den 0003_app_role.sql behebt.
--
-- ---------------------------------------------------------------------------
-- Richtigstellung zur Begruendung in 0003_app_role.sql
-- ---------------------------------------------------------------------------
-- Der Kopf jener Migration begruendet die idempotente Anlage damit, dass
-- `supabase db reset` "die Datenbank neu aufbaut, die Rollen aber stehen
-- laesst". Diese Aussage war NICHT gemessen.
--
-- Was der CI-Lauf zu Commit 9c58155 tatsaechlich zeigt: der Reset meldet
-- "Recreating database..." gefolgt von "Seeding globals from roles.sql...",
-- und Migration 0003 wurde dreimal fehlerfrei angewandt (Start, Reset 1,
-- Reset 2). Bewiesen ist damit die WIEDERHOLBARKEIT der Migration — nicht,
-- welcher Zweig des do-Blocks jeweils lief, also nicht, ob die Rolle den Reset
-- ueberlebt hat.
--
-- Die idempotente Form ist unter beiden Verhaltensweisen korrekt, deshalb wird
-- die gemergte Migration nicht angefasst (append-only, CLAUDE.md). Ein
-- gezielter Probe-Test — Rolle loeschen, Reset, Existenz pruefen — gehoert in
-- die CI und wird mit EYT-86 nachgezogen, wo eine neue Migration ihn tragen
-- kann.

begin;
select plan(13);

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

-- ---------------------------------------------------------------------------
-- Mitgliedschaftsoptionen (PostgreSQL 16+)
-- ---------------------------------------------------------------------------
-- Nachtrag zu EYT-45. Die Tests oben pruefen `rolinherit` — ein Attribut der
-- ROLLE. Seit PostgreSQL 16 traegt aber die MITGLIEDSCHAFT eigene Flags, und
-- die entscheiden ueber das Verhalten von SET ROLE:
--
--   inherit_option = false  -> Rechte von authenticated werden NICHT automatisch
--                              vererbt; ohne `set local role` gibt es keine.
--   set_option     = true   -> `set local role authenticated` ist ueberhaupt
--                              erlaubt. Ohne dieses Flag koennte die Anwendung
--                              den Kontext gar nicht setzen und jede Fachquery
--                              schluege fehl.
--   admin_option   = false  -> easytree_app darf die Mitgliedschaft nicht
--                              weitergeben.
--
-- Ohne diese drei Zusicherungen waere die Rollenattribut-Pruefung oben allein
-- unvollstaendig: eine Mitgliedschaft mit abweichenden Optionen koennte das
-- Verhalten aendern, ohne dass `rolinherit` sich bewegt.
select is(
  (
    select m.inherit_option
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles grantor on grantor.oid = m.roleid
    where member.rolname = 'easytree_app' and grantor.rolname = 'authenticated'
  ),
  false,
  'Mitgliedschaft easytree_app -> authenticated vererbt NICHT automatisch (inherit_option)'
);

select is(
  (
    select m.set_option
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles grantor on grantor.oid = m.roleid
    where member.rolname = 'easytree_app' and grantor.rolname = 'authenticated'
  ),
  true,
  'easytree_app darf set role authenticated ausfuehren (set_option) — sonst kaeme die Anwendung nie an Rechte'
);

select is(
  (
    select m.admin_option
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles grantor on grantor.oid = m.roleid
    where member.rolname = 'easytree_app' and grantor.rolname = 'authenticated'
  ),
  false,
  'easytree_app darf die Mitgliedschaft nicht weitergeben (admin_option)'
);

-- Nicht-Leerlauf: schlaegt die Katalogabfrage oben fehl oder liefert sie NULL,
-- waeren die drei Zusicherungen `is(NULL, …)` und damit rot — aber aus dem
-- falschen Grund. Diese Zeile trennt "Option falsch" von "Mitgliedschaft weg".
select isnt(
  (
    select m.set_option
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles grantor on grantor.oid = m.roleid
    where member.rolname = 'easytree_app' and grantor.rolname = 'authenticated'
  ),
  null,
  'Die Mitgliedschaftszeile existiert ueberhaupt'
);

select * from finish();
rollback;
