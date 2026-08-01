-- pgTAP: atomare Kostenrechte und unveraenderliche Satzversionen (EYT-106, EYT-108).
--
-- ---------------------------------------------------------------------------
-- Was hier bewiesen wird, und warum auf DB-Ebene
-- ---------------------------------------------------------------------------
-- Die Unabhaengigkeitszusage aus EYT-106 AK4: API UND Datenbank lehnen
-- getrennt ab. Diese Datei prueft ausschliesslich die Datenbankhaelfte —
-- selbst wenn die Anwendungsschicht eines Tages durchwinkt, kommt hier
-- niemand ohne Recht an einen Satz.
--
-- Vier Aussagen, die ohne echtes PostgreSQL nicht pruefbar sind:
--   1. Die Rechtematrix ist vollstaendig und member hat NICHTS.
--   2. Ueberlappende Gueltigkeitsintervalle scheitern am EXCLUDE (23P01) —
--      auch, und gerade, unter Parallelitaet.
--   3. Satzversionen sind unveraenderlich: kein update, kein delete.
--   4. Normale Anwendungsrollen koennen role_permissions nicht beschreiben.
--
-- Zur Form von throws_ok: ZWEIstellig (sql, errcode). Die dreistellige Form
-- erwartet ERRMSG, nicht eine Beschreibung — dieser Irrtum hat in diesem
-- Repository schon einen roten CI-Lauf gekostet. Die fachliche Aussage traegt
-- jeweils die nachfolgende is()-Zeile mit dem Wirkungslosigkeitsnachweis.

begin;
select plan(21);

-- ===========================================================================
-- Rechtematrix: produktweit, nicht mandantenabhaengig
-- ===========================================================================
select is(
  (select count(*)::int from public.role_permissions where role = 'owner'),
  4,
  'owner traegt alle vier Kostenrechte'
);

select is(
  (select count(*)::int from public.role_permissions where role = 'manager'),
  3,
  'manager traegt drei Kostenrechte'
);

select is(
  (select count(*)::int from public.role_permissions
    where role = 'manager' and permission = 'costs.manage_rates'),
  0,
  'manager darf ausdruecklich KEINE Saetze pflegen'
);

select is(
  (select count(*)::int from public.role_permissions where role = 'member'),
  0,
  'member traegt kein einziges Kostenrecht — Mitarbeitende sehen keine Wirtschaftsdaten'
);

-- Vollstaendigkeit in die andere Richtung: kein unbekanntes Recht schleicht
-- sich ein. Ohne diese Zeile waere ein Tippfehler wie "costs.exports" gruen.
select is(
  (select count(*)::int from public.role_permissions
    where permission not in
      ('costs.read', 'costs.calculate', 'costs.export', 'costs.manage_rates')),
  0,
  'es existiert kein Recht ausserhalb der vier vereinbarten'
);

-- ===========================================================================
-- Schreibschutz auf der Zuordnung selbst
-- ===========================================================================
select is(
  has_table_privilege('authenticated', 'public.role_permissions', 'insert'),
  false,
  'authenticated darf role_permissions NICHT beschreiben'
);

select is(
  has_table_privilege('authenticated', 'public.role_permissions', 'update'),
  false,
  'authenticated darf role_permissions NICHT aendern'
);

select is(
  has_table_privilege('authenticated', 'public.role_permissions', 'delete'),
  false,
  'authenticated darf role_permissions NICHT loeschen'
);

-- Gegenprobe: das Leserecht existiert sehr wohl. Ohne sie waeren die drei
-- Zeilen oben auch dann gruen, wenn die Tabelle gar nicht zugaenglich waere.
select is(
  has_table_privilege('authenticated', 'public.role_permissions', 'select'),
  true,
  'authenticated darf role_permissions lesen — nur eben nicht aendern'
);

-- Dasselbe fuer die Satzversionen: unveraenderlich heisst unveraenderlich.
select is(
  has_table_privilege('authenticated', 'public.employee_rate_versions', 'update'),
  false,
  'eine Satzversion kann nicht geaendert werden'
);

select is(
  has_table_privilege('authenticated', 'public.employee_rate_versions', 'delete'),
  false,
  'eine Satzversion kann nicht geloescht werden'
);

select is(
  has_table_privilege('authenticated', 'public.employee_rate_versions', 'insert'),
  true,
  'eine NEUE Satzversion kann angelegt werden — das ist der einzige Schreibweg'
);

-- ===========================================================================
-- Kontext: User A, owner in Org Alpha (seed.sql)
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000aaa1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  app.has_cost_permission('00000000-0000-4000-8000-0000000000a1', 'costs.manage_rates'),
  true,
  'owner in der eigenen Organisation darf Saetze pflegen'
);

select is(
  app.has_cost_permission('00000000-0000-4000-8000-0000000000b2', 'costs.read'),
  false,
  'dieselbe Person hat in einer FREMDEN Organisation kein Kostenrecht'
);

-- Erste Version: der Positivfall. Ohne ihn saehe man nicht, ob die folgenden
-- Ablehnungen echt sind oder ob generell nichts geht.
select lives_ok(
  $$insert into public.employee_rate_versions
      (id, org_id, employee_id, amount_minor_units, currency,
       valid_from, valid_to, reason, created_by, correlation_id)
    values
      ('00000000-0000-4000-8000-00000053a001',
       '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000004010a1',
       3850, 'EUR', date '2026-01-01', date '2026-07-01',
       'Erstanlage', '00000000-0000-4000-8000-00000000aaa1', 'test-korrelation-1')$$,
  'owner legt die erste Satzversion an'
);

-- Der Kern von EYT-108: ueberlappende Intervalle derselben Person.
select throws_ok(
  $$insert into public.employee_rate_versions
      (id, org_id, employee_id, amount_minor_units, currency,
       valid_from, valid_to, reason, created_by, correlation_id)
    values
      ('00000000-0000-4000-8000-00000053a002',
       '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000004010a1',
       4000, 'EUR', date '2026-06-01', date '2026-12-01',
       'Ueberlappt absichtlich', '00000000-0000-4000-8000-00000000aaa1', 'test-korrelation-2')$$,
  '23P01'
);

select is(
  (select count(*)::int from public.employee_rate_versions
    where employee_id = '00000000-0000-4000-8000-0000004010a1'),
  1,
  'nach der Ablehnung steht genau eine Version — der Versuch blieb wirkungslos'
);

-- Nahtloser Anschluss MUSS gehen: [) heisst, valid_to gehoert nicht mehr dazu.
-- Ohne diese Zeile waere ein zu strenges Intervall (etwa `[]`) unbemerkt.
select lives_ok(
  $$insert into public.employee_rate_versions
      (id, org_id, employee_id, amount_minor_units, currency,
       valid_from, valid_to, predecessor_id, reason, created_by, correlation_id)
    values
      ('00000000-0000-4000-8000-00000053a003',
       '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000004010a1',
       4000, 'EUR', date '2026-07-01', null,
       '00000000-0000-4000-8000-00000053a001',
       'Tariferhoehung', '00000000-0000-4000-8000-00000000aaa1', 'test-korrelation-3')$$,
  'die Folgeversion schliesst nahtlos an (halboffenes Intervall)'
);

-- Eine offene Version (valid_to null) blockiert alles Spaetere.
select throws_ok(
  $$insert into public.employee_rate_versions
      (id, org_id, employee_id, amount_minor_units, currency,
       valid_from, valid_to, reason, created_by, correlation_id)
    values
      ('00000000-0000-4000-8000-00000053a004',
       '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000004010a1',
       4200, 'EUR', date '2027-01-01', null,
       'Kollidiert mit der offenen Version',
       '00000000-0000-4000-8000-00000000aaa1', 'test-korrelation-4')$$,
  '23P01'
);

-- Negativer Betrag: fachlich unzulaessig (EYT-108).
select throws_ok(
  $$insert into public.employee_rate_versions
      (id, org_id, employee_id, amount_minor_units, currency,
       valid_from, valid_to, reason, created_by, correlation_id)
    values
      ('00000000-0000-4000-8000-00000053a005',
       '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000004011a1',
       -1, 'EUR', date '2026-01-01', null,
       'Negativ', '00000000-0000-4000-8000-00000000aaa1', 'test-korrelation-5')$$,
  '23514'
);

-- ===========================================================================
-- Kontext: User B, owner in Org Beta — Cross-Tenant
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000bbb2', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.employee_rate_versions),
  0,
  'eine fremde Organisation sieht KEINE Satzversion von Alpha'
);

select * from finish();
rollback;
