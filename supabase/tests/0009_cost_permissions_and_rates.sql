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
-- Seit EYT-107 (Migration 0015) traegt `role_permissions` auch `planning.*`.
-- Die Zaehlungen sind deshalb auf das Praefix `costs.` eingeschraenkt. Ohne
-- diese Einschraenkung waere die Aussage nicht mehr „owner hat alle
-- Kostenrechte", sondern „owner hat genau N Rechte insgesamt" — und die haette
-- bei jedem neuen Modul erneut korrigiert werden muessen, ohne dass sich an
-- den KOSTENrechten etwas geaendert haette.
select is(
  (select count(*)::int from public.role_permissions
    where role = 'owner' and permission like 'costs.%'),
  4,
  'owner traegt alle vier Kostenrechte'
);

select is(
  (select count(*)::int from public.role_permissions
    where role = 'manager' and permission like 'costs.%'),
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
  (select count(*)::int from public.role_permissions
    where role = 'member' and permission like 'costs.%'),
  0,
  'member traegt kein einziges Kostenrecht — Mitarbeitende sehen keine Wirtschaftsdaten'
);

-- Vollstaendigkeit in die andere Richtung: kein unbekanntes KOSTENrecht
-- schleicht sich ein. Ohne diese Zeile waere ein Tippfehler wie
-- "costs.exports" gruen. Die Gegenrichtung fuer `planning.*` steht in
-- 0011_planning_publish.sql — jede Suite prueft die Vollstaendigkeit ihres
-- eigenen Praefixes, sonst muessten beide bei jedem neuen Modul angefasst
-- werden.
select is(
  (select count(*)::int from public.role_permissions
    where permission like 'costs.%'
      and permission not in
        ('costs.read', 'costs.calculate', 'costs.export', 'costs.manage_rates')),
  0,
  'es existiert kein Kostenrecht ausserhalb der vier vereinbarten'
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
--
-- Seit Migration 0014 ist die Aussage SPALTENWEISE zu treffen und nicht mehr
-- tabellenweit: `valid_to` traegt ein update-Recht, damit eine offene Version
-- genau einmal geschlossen werden kann. Die frueher hier stehende Zeile
-- `has_table_privilege(..., 'update') = false` waere nach 0014 eine Aussage
-- ueber das Tabellenrecht, waehrend die eigentliche Zusicherung — dass Betrag,
-- Beginn und Grund unveraenderlich bleiben — ungeprueft bliebe. Die
-- vollstaendige Spaltenmatrix samt Gegenprobe steht in
-- supabase/tests/0010_rate_succession.sql.
select is(
  has_column_privilege('authenticated', 'public.employee_rate_versions',
                       'amount_minor_units', 'update'),
  false,
  'der Betrag einer Satzversion kann nicht geaendert werden'
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
