-- pgTAP: die Abloesung eines offenen Stundensatzes (EYT-108, Option A+).
--
-- ---------------------------------------------------------------------------
-- Was hier bewiesen wird, und warum auf DB-Ebene
-- ---------------------------------------------------------------------------
-- Migration 0014 oeffnet den EINEN erlaubten Zustandsuebergang: eine offene
-- Version wird genau einmal geschlossen. Diese Datei misst, dass die Oeffnung
-- so eng ist wie behauptet — mit einer Gegenprobe zu jeder Verweigerung, sonst
-- waere jede Ablehnung auch dann gruen, wenn ueberhaupt nichts ginge.
--
--   1. NUR `valid_to` traegt ein update-Recht. Betrag, valid_from, Grund und
--      predecessor_id nicht. Das erzwingt PostgreSQL, nicht der Anwendungscode.
--   2. Geschlossen heisst geschlossen: der zweite Versuch trifft keine Zeile.
--   3. Wieder-Oeffnen (valid_to zurueck auf NULL) ist ausgeschlossen.
--   4. Ohne costs.manage_rates geht nichts, in einem fremden Tenant auch nicht.
--   5. Nach dem Schliessen passt der nahtlose Nachfolger — der Sinn der Uebung
--      und zugleich die Gegenprobe gegen einen zu strengen Endtag.
--
-- Warum kein `security definer`: die Tabelle traegt `force row level security`
-- (0013 Z. 148). Eine definer-Funktion kaeme daran nur vorbei, weil ihr
-- Eigentuemer BYPASSRLS traegt — genau das Privileg, das der Startgate aus
-- EYT-45 im Laufzeitpfad verweigert. Das Spaltenrecht bleibt innerhalb von RLS.
--
-- Zur Form von throws_ok: ZWEIstellig (sql, errcode). Die dreistellige Form
-- erwartet ERRMSG, nicht eine Beschreibung — dieser Irrtum hat in diesem
-- Repository schon einen roten CI-Lauf gekostet.

begin;
select plan(16);

-- ===========================================================================
-- Rechte: genau eine Spalte, und der Beweis, dass es nicht mehr sind
-- ===========================================================================
select is(
  has_column_privilege('authenticated', 'public.employee_rate_versions', 'valid_to', 'update'),
  true,
  'valid_to darf geaendert werden — das ist der eine erlaubte Uebergang'
);

select is(
  has_column_privilege('authenticated', 'public.employee_rate_versions', 'amount_minor_units', 'update'),
  false,
  'der Betrag bleibt unveraenderlich'
);

select is(
  has_column_privilege('authenticated', 'public.employee_rate_versions', 'valid_from', 'update'),
  false,
  'der Beginn bleibt unveraenderlich'
);

select is(
  has_column_privilege('authenticated', 'public.employee_rate_versions', 'reason', 'update'),
  false,
  'der Grund bleibt unveraenderlich'
);

select is(
  has_column_privilege('authenticated', 'public.employee_rate_versions', 'predecessor_id', 'update'),
  false,
  'die Vorgaengerkette kann nachtraeglich nicht umgehaengt werden'
);

select is(
  has_column_privilege('authenticated', 'public.employee_rate_versions', 'valid_to', 'insert'),
  true,
  'valid_to darf beim Anlegen mitgegeben werden — Gegenprobe, dass die Spalte ueberhaupt erreichbar ist'
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

-- Ausgangslage: eine OFFENE Version.
insert into public.employee_rate_versions
  (id, org_id, employee_id, amount_minor_units, currency,
   valid_from, valid_to, reason, created_by, correlation_id)
values
  ('00000000-0000-4000-8000-00000054a001',
   '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000004010a1',
   3850, 'EUR', date '2026-01-01', null,
   'Erstanlage', '00000000-0000-4000-8000-00000000aaa1', 'test-korrelation-s1');

-- Der Betrag laesst sich nicht mitaendern — 42501 kommt aus dem Spaltenrecht.
select throws_ok(
  $$update public.employee_rate_versions
       set amount_minor_units = 9999
     where id = '00000000-0000-4000-8000-00000054a001'$$,
  '42501'
);

select lives_ok(
  $$update public.employee_rate_versions
       set valid_to = date '2026-07-01'
     where id = '00000000-0000-4000-8000-00000054a001'$$,
  'die offene Version laesst sich schliessen'
);

select is(
  (select valid_to from public.employee_rate_versions
    where id = '00000000-0000-4000-8000-00000054a001'),
  date '2026-07-01',
  'valid_to steht exakt auf dem Beginn des Nachfolgers'
);

-- Einmaligkeit. Die Policy macht die geschlossene Zeile fuer UPDATE unsichtbar,
-- also wird sie nicht abgelehnt, sondern gar nicht erst getroffen.
update public.employee_rate_versions
   set valid_to = date '2026-09-01'
 where id = '00000000-0000-4000-8000-00000054a001';

select is(
  (select valid_to from public.employee_rate_versions
    where id = '00000000-0000-4000-8000-00000054a001'),
  date '2026-07-01',
  'der zweite Versuch blieb wirkungslos — der Endtag ist unveraendert'
);

-- Wieder-Oeffnen ist ausgeschlossen. Ohne `with check` waere genau das der
-- Weg zurueck und die Einmaligkeit nur eine Behauptung.
update public.employee_rate_versions
   set valid_to = null
 where id = '00000000-0000-4000-8000-00000054a001';

select is(
  (select valid_to from public.employee_rate_versions
    where id = '00000000-0000-4000-8000-00000054a001'),
  date '2026-07-01',
  'eine geschlossene Version laesst sich nicht wieder oeffnen'
);

-- Der Sinn der Uebung: jetzt passt der nahtlose Nachfolger.
select lives_ok(
  $$insert into public.employee_rate_versions
      (id, org_id, employee_id, amount_minor_units, currency,
       valid_from, valid_to, predecessor_id, reason, created_by, correlation_id)
    values
      ('00000000-0000-4000-8000-00000054a002',
       '00000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000004010a1',
       4200, 'EUR', date '2026-07-01', null,
       '00000000-0000-4000-8000-00000054a001',
       'Tariferhoehung', '00000000-0000-4000-8000-00000000aaa1', 'test-korrelation-s2')$$,
  'der Nachfolger schliesst nahtlos an und verweist auf den Vorgaenger'
);

select is(
  (select count(*)::int from public.employee_rate_versions
    where employee_id = '00000000-0000-4000-8000-0000004010a1' and valid_to is null),
  1,
  'genau eine offene Version je Mitarbeiter'
);

-- ===========================================================================
-- Kontext: User B — owner in Beta, also FREMD in Alpha
-- ===========================================================================
reset role;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000bbb2', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

update public.employee_rate_versions
   set valid_to = date '2027-01-01'
 where id = '00000000-0000-4000-8000-00000054a002';

select is(
  (select count(*)::int from public.employee_rate_versions
    where id = '00000000-0000-4000-8000-00000054a002' and valid_to is null),
  0,
  'ein fremder Tenant sieht die Zeile nicht einmal — der Versuch blieb wirkungslos'
);

-- ===========================================================================
-- Kontext: ein AKTIVES Mitglied ohne costs.manage_rates
-- ===========================================================================
-- Die Aktivschaltung passiert bewusst vor dem Rollenwechsel und rollt mit der
-- Transaktion zurueck. Im seed ist C inaktiv; ohne diese Zeile pruefte der Fall
-- die Mitgliedschaft statt des fehlenden Rechts — also gerade nicht das, was
-- hier behauptet wird.
reset role;
update public.memberships set active = true
 where id = '00000000-0000-4000-8000-0000000e0cc3';

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000ccc3', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  app.has_cost_permission('00000000-0000-4000-8000-0000000000a1', 'costs.manage_rates'),
  false,
  'das aktive Mitglied traegt costs.manage_rates wirklich nicht — Voraussetzung des naechsten Falls'
);

update public.employee_rate_versions
   set valid_to = date '2027-01-01'
 where id = '00000000-0000-4000-8000-00000054a002';

select is(
  (select count(*)::int from public.employee_rate_versions
    where id = '00000000-0000-4000-8000-00000054a002' and valid_to is not null),
  0,
  'ohne costs.manage_rates bleibt die offene Version offen'
);

select * from finish();
rollback;
