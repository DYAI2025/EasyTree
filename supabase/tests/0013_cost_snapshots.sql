-- pgTAP: Struktur, Rechte, Policies und Kanalgrenze der Snapshot-Tabellen (EYT-109).
--
-- ---------------------------------------------------------------------------
-- Was hier bewiesen wird, und warum auf DB-Ebene
-- ---------------------------------------------------------------------------
-- Migration 0018 macht den Kosten-Snapshot zu einem HISTORISCHEN DOKUMENT: er
-- entsteht nur ueber den Laufzeitkanal mit `costs.calculate`, und danach gibt
-- es fuer `authenticated` schlicht kein Recht mehr, ihn zu aendern oder zu
-- loeschen. Diese Datei prueft ausschliesslich die Datenbankhaelfte — selbst
-- wenn die Anwendungsschicht eines Tages durchwinkt, kommt hier niemand ohne
-- Recht und ohne Kanal an einen Snapshot.
--
-- ---------------------------------------------------------------------------
-- Warum Rechte UND Verhalten geprueft werden
-- ---------------------------------------------------------------------------
-- SQLSTATE `42501` ist mehrdeutig: er entsteht sowohl aus einem fehlenden
-- Tabellen-/Spaltenrecht als auch aus einer verletzten RLS-Policy. Ein reiner
-- Verhaltenstest sagt deshalb NICHT, welcher Riegel gehalten hat — und ein
-- Riegel, von dem man das nicht weiss, kann unbemerkt verschwinden. Abschnitt B
-- stellt die Rechtelage am Katalog fest, Abschnitt D das Verhalten. Die
-- Trennung ist in D1/D3 ausdruecklich hergestellt: das INSERT-Spaltenrecht
-- BESTEHT (B5/B6), die Identitaet traegt `costs.calculate` (D0b) — faellt der
-- Versuch trotzdem, kann es nur die Policy gewesen sein, und in ihr nur die
-- Kanalbedingung.
--
-- ---------------------------------------------------------------------------
-- Warum der Kanal hier nur NEGATIV pruefbar ist
-- ---------------------------------------------------------------------------
-- `app.is_runtime_channel()` vergleicht `session_user` mit `easytree_app`. In
-- pgTAP ist `session_user` immer `postgres`; `SET SESSION AUTHORIZATION`
-- verlangt Superuser, und `postgres` ist das in Supabase nicht (gemessen
-- 04.08.2026: rolsuper=false, rolbypassrls=true). Diese Datei kann also
-- ausschliesslich belegen, dass ein NICHT-Laufzeitkanal abgewiesen wird. Dass
-- der echte Kanal durchkommt, muss der Integrationstest gegen eine echte
-- `easytree_app`-Verbindung zeigen (Task 11) — hier steht dazu bewusst nichts,
-- damit die Luecke niemand spaeter fuer Abdeckung haelt.
--
-- ---------------------------------------------------------------------------
-- Woher die Testidentitaeten kommen
-- ---------------------------------------------------------------------------
-- Aus `seed.sql`, nicht aus dieser Datei. `public.users` haengt am
-- Fremdschluessel auf `auth.users`; eigene Benutzer anzulegen hiesse, GoTrue
-- nachzuahmen. User A ist `owner` in Org Alpha, User B `owner` in Org Beta —
-- beide tragen damit `costs.read` und `costs.calculate` (0013).
--
-- Satzversionen und Snapshots gibt es im Seed nicht; sie entstehen unten als
-- Fixture auf dem Eigentuemerpfad. Das ist zulaessig (PO-Vorgabe 07.08.2026,
-- vgl. 0012 Abschnitt D) und hier sogar noetig: ueber den authenticated-Pfad
-- LAESST sich richtigerweise kein Snapshot anlegen.
--
-- Zur Form von throws_ok: die VIERstellige Form (sql, errcode, errmsg,
-- description) mit NULL als errmsg — dieselbe wie in 0012. Die dreistellige
-- Form erwartet ERRMSG statt einer Beschreibung; dieser Irrtum hat in diesem
-- Repository schon einen roten CI-Lauf gekostet.

begin;
select plan(34);

-- ===========================================================================
-- A. Struktur
-- ===========================================================================

-- A1 beweist zugleich, dass beide Tabellen ueberhaupt existieren: die Auswahl
-- filtert auf `relrowsecurity and relforcerowsecurity`, eine fehlende oder
-- ungeschuetzte Tabelle faellt aus dem Ergebnis heraus.
select is(
  (
    select array_agg(c.relname::text order by c.relname::text)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname in ('cost_snapshots', 'cost_snapshot_positions')
       and c.relrowsecurity
       and c.relforcerowsecurity
  ),
  (select array_agg(x order by x)
     from unnest(array['cost_snapshots', 'cost_snapshot_positions']) x),
  'A1 beide Snapshot-Tabellen existieren und haben RLS ENABLED UND FORCED'
);

-- A2 ist die namentliche Zusicherung der mandantengebundenen Bindung
-- Position -> Kopf. Sie steht bewusst neben der vollstaendigen FK-Karte in A4:
-- A4 wuerde bei jeder FK-Aenderung rot, A2 sagt, WELCHE Aussage dabei
-- verlorenginge.
-- Die Spaltenreihenfolge wird ueber `array_position` in der Schluesselliste
-- wiederhergestellt, nicht ueber die Katalogreihenfolge der Spalten: bei einem
-- zusammengesetzten FK ist die REIHENFOLGE Bestandteil der Aussage.
select is(
  (
    select
      (select string_agg(a.attname::text, ',' order by array_position(c.conkey, a.attnum))
         from pg_attribute a
        where a.attrelid = c.conrelid and a.attnum = any(c.conkey))
      || ' -> ' ||
      (select string_agg(a.attname::text, ',' order by array_position(c.confkey, a.attnum))
         from pg_attribute a
        where a.attrelid = c.confrelid and a.attnum = any(c.confkey))
      from pg_constraint c
     where c.conrelid = 'public.cost_snapshot_positions'::regclass
       and c.confrelid = 'public.cost_snapshots'::regclass
       and c.contype = 'f'
  ),
  'snapshot_id,org_id -> id,org_id'::text,
  'A2 die Bindung Position -> Kopf ist der ZUSAMMENGESETZTE, mandantengebundene FK — er haelt unabhaengig von jeder Policy'
);

-- A3 zaehlt ALLE Unique-Constraints auf, nicht nur die gesuchte. Ein reiner
-- Existenztest waere auch dann gruen, wenn jemand zusaetzlich etwas
-- Ungewolltes eindeutig gemacht haette.
select is(
  (
    select array_agg(sig order by sig)
      from (
        select (select string_agg(a.attname::text, ',' order by array_position(c.conkey, a.attnum))
                  from pg_attribute a
                 where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) as sig
          from pg_constraint c
         where c.conrelid = 'public.cost_snapshot_positions'::regclass
           and c.contype = 'u'
      ) s
  ),
  (select array_agg(x order by x)
     from unnest(array['id,org_id', 'snapshot_id,ordinal']) x),
  'A3 genau zwei Unique-Constraints auf den Positionen — (snapshot_id, ordinal) friert die Reihenfolge ein'
);

-- A4/A5 vergleichen die VOLLSTAENDIGE Fremdschluesselkarte. Der Name der
-- Zieltabelle wird ueber pg_class/pg_namespace zusammengesetzt und nicht ueber
-- `regclass::text`: regclass laesst das Schema weg, sobald es im search_path
-- steht, und die Zusicherung haengte dann am search_path des Laufs.
select is(
  (
    select array_agg(sig order by sig)
      from (
        select (select string_agg(a.attname::text, ',' order by array_position(c.conkey, a.attnum))
                  from pg_attribute a
                 where a.attrelid = c.conrelid and a.attnum = any(c.conkey))
               || ' -> ' || pn.nspname || '.' || pc.relname || '('
               || (select string_agg(a.attname::text, ',' order by array_position(c.confkey, a.attnum))
                     from pg_attribute a
                    where a.attrelid = c.confrelid and a.attnum = any(c.confkey))
               || ')' as sig
          from pg_constraint c
          join pg_class pc on pc.oid = c.confrelid
          join pg_namespace pn on pn.oid = pc.relnamespace
         where c.conrelid = 'public.cost_snapshot_positions'::regclass
           and c.contype = 'f'
      ) s
  ),
  (select array_agg(x order by x) from unnest(array[
     'org_id -> public.organizations(id)',
     'snapshot_id,org_id -> public.cost_snapshots(id,org_id)',
     'worksite_id,org_id -> public.worksites(id,org_id)',
     'employee_id,org_id -> public.employees(id,org_id)',
     'rate_version_id,org_id -> public.employee_rate_versions(id,org_id)'
  ]) x),
  'A4 die Positionen tragen genau fuenf FKs, drei davon mandantengebunden — und keinen auf assignments'
);

-- A5 ist die Zusicherung einer ABWESENHEIT (Planentscheidung: ein Snapshot ist
-- ein historisches Dokument und darf weder die Planung festhalten noch mit ihr
-- verschwinden). Als vollstaendige Karte formuliert, weil ein `not exists`-Test
-- auf plan_versions einen spaeter ergaenzten FK auf assignments uebersaehe.
select is(
  (
    select array_agg(sig order by sig)
      from (
        select (select string_agg(a.attname::text, ',' order by array_position(c.conkey, a.attnum))
                  from pg_attribute a
                 where a.attrelid = c.conrelid and a.attnum = any(c.conkey))
               || ' -> ' || pn.nspname || '.' || pc.relname || '('
               || (select string_agg(a.attname::text, ',' order by array_position(c.confkey, a.attnum))
                     from pg_attribute a
                    where a.attrelid = c.confrelid and a.attnum = any(c.confkey))
               || ')' as sig
          from pg_constraint c
          join pg_class pc on pc.oid = c.confrelid
          join pg_namespace pn on pn.oid = pc.relnamespace
         where c.conrelid = 'public.cost_snapshots'::regclass
           and c.contype = 'f'
      ) s
  ),
  (select array_agg(x order by x) from unnest(array[
     'org_id -> public.organizations(id)',
     'created_by -> public.users(id)',
     'worksite_id,org_id -> public.worksites(id,org_id)'
  ]) x),
  'A5 der Snapshotkopf hat KEINEN FK auf plan_versions oder assignments — die Herkunft steht als Wert'
);

select ok(
  (select pg_get_constraintdef(oid) like '%is_valid_iso_week_key%'
     from pg_constraint
    where conrelid = 'public.cost_snapshots'::regclass
      and conname = 'cost_snapshots_week_key_is_iso'),
  'A6 week_key unterliegt derselben jahresabhaengigen ISO-Regel wie plan_versions (EYT-88)'
);

-- ===========================================================================
-- B. Rechtelage — Unveraenderlichkeit ist ein FEHLENDES RECHT
-- ===========================================================================

-- B1/B2 messen ueber ALLE SPALTEN, nicht ueber die Tabelle. Der Grund ist ein
-- in 0012 gemessener Fehlbefund: `has_table_privilege` sieht Spalten-Grants
-- nicht und meldet auch dann „kein Recht", wenn einzelne Spalten sehr wohl
-- beschreibbar sind. `has_any_column_privilege` schliesst das Tabellenrecht
-- mit ein und ist damit strikt schaerfer.
select ok(
  not has_any_column_privilege('authenticated', 'public.cost_snapshots', 'UPDATE'),
  'B1 authenticated traegt auf KEINER Spalte von cost_snapshots ein update-Recht'
);

select ok(
  not has_any_column_privilege('authenticated', 'public.cost_snapshot_positions', 'UPDATE'),
  'B2 authenticated traegt auf KEINER Spalte von cost_snapshot_positions ein update-Recht'
);

-- B3/B4 bleiben bei `has_table_privilege` und haben den blinden Fleck von
-- B1/B2 nicht: PostgreSQL kennt Spaltenrechte nur fuer select, insert, update
-- und references. Ein `delete` ist immer ein Tabellenrecht; `delete` an
-- `has_any_column_privilege` zu uebergeben waere laut Dokumentation ein Fehler
-- („unrecognized privilege type"), kein schaerferer Waechter.
select ok(
  not has_table_privilege('authenticated', 'public.cost_snapshots', 'DELETE'),
  'B3 authenticated hat KEIN delete-Recht auf cost_snapshots'
);

select ok(
  not has_table_privilege('authenticated', 'public.cost_snapshot_positions', 'DELETE'),
  'B4 authenticated hat KEIN delete-Recht auf cost_snapshot_positions'
);

-- B5/B6 zaehlen die INSERT-Spaltenmenge ERSCHOEPFEND auf, in beide Richtungen.
-- Einzelne `has_column_privilege`-Stichproben haetten eine zu weit geratene
-- Grantliste nicht bemerkt — insbesondere nicht ein versehentliches
-- Tabellen-Grant, das jede Spalte oeffnet. Beide Seiten des Vergleichs werden
-- in SQL sortiert, damit die Sortierung auf beiden Seiten dieselbe Kollation
-- benutzt.
select is(
  (
    select array_agg(a.attname::text order by a.attname::text)
      from pg_attribute a
     where a.attrelid = 'public.cost_snapshots'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')
  ),
  (select array_agg(x order by x) from unnest(array[
     'org_id', 'plan_version_id', 'worksite_id', 'week_key', 'time_zone',
     'currency', 'rule_version', 'total_minor_units', 'created_by', 'correlation_id'
  ]) x),
  'B5 authenticated darf auf cost_snapshots GENAU zehn Spalten schreiben — id und created_at bleiben Serverdefaults'
);

select is(
  (
    select array_agg(a.attname::text order by a.attname::text)
      from pg_attribute a
     where a.attrelid = 'public.cost_snapshot_positions'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')
  ),
  (select array_agg(x order by x) from unnest(array[
     'org_id', 'snapshot_id', 'assignment_id', 'worksite_id', 'worksite_label',
     'employee_id', 'employee_label', 'local_date', 'duration_ms',
     'rate_version_id', 'amount_minor_units', 'ordinal'
  ]) x),
  'B6 authenticated darf auf cost_snapshot_positions GENAU zwoelf Spalten schreiben — id bleibt Serverdefault'
);

-- B7 ist die Gegenprobe zu B1 bis B6: ohne sie waeren alle Verbote auch dann
-- gruen, wenn ueberhaupt kein Recht vergeben waere — und die Anwendung stuende
-- vor lauter permission denied.
select ok(
  has_table_privilege('authenticated', 'public.cost_snapshots', 'SELECT')
  and has_table_privilege('authenticated', 'public.cost_snapshot_positions', 'SELECT'),
  'B7 lesen darf authenticated beide Tabellen — der Entzug trifft nur Aendern und Loeschen'
);

select is(
  (
    select coalesce(array_agg(distinct c.relname::text order by c.relname::text), array[]::text[])
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('cost_snapshots', 'cost_snapshot_positions')
       and (
         has_any_column_privilege('anon', c.oid, 'SELECT')
         or has_any_column_privilege('anon', c.oid, 'INSERT')
         or has_any_column_privilege('anon', c.oid, 'UPDATE')
         or has_table_privilege('anon', c.oid, 'DELETE')
       )
  ),
  array[]::text[],
  'B8 anon hat auf keiner der beiden Tabellen irgendein DML-Recht — auch nicht spaltenweise'
);

-- ===========================================================================
-- C. Policylage
-- ===========================================================================

-- C1 zaehlt erschoepfend auf. Damit ist zugleich gesagt, dass es KEINE update-
-- und KEINE delete-Policy gibt: eine wirkungslose Policy waere eine Falle, weil
-- ein spaeteres `grant` sie ohne weiteres Zutun reaktivierte (0017 Abschnitt 4).
select is(
  (
    -- `policyname` hat den Typ `name`, nicht `text` — ohne den Cast haengt der
    -- Verkettungsoperator an einer impliziten Umwandlung. Derselbe Grund, aus
    -- dem 0005 ueberall `relname::text` schreibt.
    select array_agg(policyname::text || ':' || cmd order by policyname::text || ':' || cmd)
      from pg_policies
     where schemaname = 'public'
       and tablename in ('cost_snapshots', 'cost_snapshot_positions')
  ),
  (select array_agg(x order by x) from unnest(array[
     'cost_snapshots_select:SELECT',
     'cost_snapshots_insert:INSERT',
     'cost_snapshot_positions_select:SELECT',
     'cost_snapshot_positions_insert:INSERT'
  ]) x),
  'C1 genau vier Policies, ausschliesslich fuer SELECT und INSERT — keine update-, keine delete-Policy'
);

-- C2 bis C5 pruefen neben dem RECHT auch die aufgerufene FUNKTION. Das ist
-- keine Stiltreue, sondern eine echte Unterscheidung: `has_permission` ist KEIN
-- Teilstring von `has_cost_permission` (dort folgt auf `has_` das Wort `cost`),
-- also faellt die Zusicherung, sobald jemand eine dieser Policies auf die in
-- 0015 abgeloeste Funktion zuruecksetzt. Ohne diese Haelfte waere der Wechsel
-- eine Behauptung im Kopfkommentar und sonst nichts.
select ok(
  (select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshots' and cmd = 'INSERT')
    like '%is_runtime_channel%'
  and (select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshots' and cmd = 'INSERT')
    like '%has_permission%'
  and (select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshots' and cmd = 'INSERT')
    like '%costs.calculate%'
  and (select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshots' and cmd = 'INSERT')
    like '%auth.uid()%',
  'C2 die INSERT-Policy des Kopfes prueft Laufzeitkanal, app.has_permission mit costs.calculate UND die Urheberschaft'
);

select ok(
  (select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshot_positions' and cmd = 'INSERT')
    like '%is_runtime_channel%'
  and (select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshot_positions' and cmd = 'INSERT')
    like '%has_permission%'
  and (select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshot_positions' and cmd = 'INSERT')
    like '%costs.calculate%',
  'C3 die INSERT-Policy der Positionen prueft Laufzeitkanal UND app.has_permission mit costs.calculate'
);

select ok(
  (select coalesce(qual, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshots' and cmd = 'SELECT')
    like '%has_permission%'
  and (select coalesce(qual, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshots' and cmd = 'SELECT')
    like '%costs.read%',
  'C4 die SELECT-Policy des Kopfes verlangt costs.read ueber app.has_permission'
);

select ok(
  (select coalesce(qual, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshot_positions' and cmd = 'SELECT')
    like '%has_permission%'
  and (select coalesce(qual, '') from pg_policies
    where schemaname = 'public' and tablename = 'cost_snapshot_positions' and cmd = 'SELECT')
    like '%costs.read%',
  'C5 die SELECT-Policy der Positionen verlangt costs.read ueber app.has_permission'
);

-- ===========================================================================
-- Fixtures auf dem Eigentuemerpfad
-- ===========================================================================
-- Ueber den authenticated-Pfad laesst sich hier richtigerweise kein Snapshot
-- anlegen (das ist die Aussage von D1). Die Ausgangslage entsteht deshalb als
-- Eigentuemer; `postgres` traegt BYPASSRLS und umgeht damit auch FORCE RLS.
-- Constraints und Fremdschluessel gelten weiterhin — die sind keine Policies,
-- und genau darauf beruht Abschnitt E.
insert into public.employee_rate_versions
  (id, org_id, employee_id, amount_minor_units, currency,
   valid_from, valid_to, reason, created_by, correlation_id)
values
  ('00000000-0000-4000-8000-00000053c001',
   '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000004010a1',
   3850, 'EUR', date '2026-01-01', null,
   'Fixture 0013_cost_snapshots', '00000000-0000-4000-8000-00000000aaa1', 'fixture-satz-alpha'),
  ('00000000-0000-4000-8000-00000053c002',
   '00000000-0000-4000-8000-0000000000b2',
   '00000000-0000-4000-8000-0000004020b2',
   4100, 'EUR', date '2026-01-01', null,
   'Fixture 0013_cost_snapshots', '00000000-0000-4000-8000-00000000bbb2', 'fixture-satz-beta');

insert into public.cost_snapshots
  (id, org_id, plan_version_id, worksite_id, week_key, time_zone, currency,
   rule_version, total_minor_units, created_by, correlation_id)
values
  ('00000000-0000-4000-8000-0000009010a1',
   '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000006010a1',
   '00000000-0000-4000-8000-0000005010a1',
   '2026-W32', 'Europe/Berlin', 'EUR', 'personnel-plan-cost-v1', 30800,
   '00000000-0000-4000-8000-00000000aaa1', 'fixture-snapshot-alpha'),
  ('00000000-0000-4000-8000-0000009020b2',
   '00000000-0000-4000-8000-0000000000b2',
   '00000000-0000-4000-8000-0000006020b2',
   '00000000-0000-4000-8000-0000005020b2',
   '2026-W32', 'Europe/Berlin', 'EUR', 'personnel-plan-cost-v1', 32800,
   '00000000-0000-4000-8000-00000000bbb2', 'fixture-snapshot-beta');

insert into public.cost_snapshot_positions
  (id, org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
   employee_id, employee_label, local_date, duration_ms, rate_version_id,
   amount_minor_units, ordinal)
values
  ('00000000-0000-4000-8000-0000009110a1',
   '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000009010a1',
   '00000000-0000-4000-8000-0000007010a1',
   '00000000-0000-4000-8000-0000005010a1', 'Alpha Baustelle',
   '00000000-0000-4000-8000-0000004010a1', 'Alpha Planerin',
   date '2026-08-03', 28800000, '00000000-0000-4000-8000-00000053c001', 30800, 0);

-- ===========================================================================
-- D. Verhalten im NICHT-Laufzeitkanal
-- ===========================================================================
-- Kontext: User A, `owner` in Org Alpha, traegt also costs.read UND
-- costs.calculate. Genau das ist der Punkt — abgelehnt wird hier nicht ein
-- fehlendes Recht, sondern der Kanal. Ein Test mit einem rechtlosen `member`
-- koennte das nicht trennen.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000aaa1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  app.is_runtime_channel(),
  false,
  'D0 diese Sitzung ist NICHT der Laufzeitkanal (session_user = postgres) — die Voraussetzung von D1 bis D8'
);

-- Die Sonde ruft DIESELBE Funktion wie die Policy (app.has_permission, nicht
-- die abgeloeste app.has_cost_permission). Sonst belegte sie ein Recht, das an
-- der geprueften Stelle gar nicht abgefragt wird.
select is(
  app.has_permission('00000000-0000-4000-8000-0000000000a1', 'costs.calculate'),
  true,
  'D0b dieselbe Identitaet traegt costs.calculate — was gleich faellt, faellt also nicht am Recht'
);

select throws_ok(
  $$insert into public.cost_snapshots
      (org_id, plan_version_id, worksite_id, week_key, time_zone, currency,
       rule_version, total_minor_units, created_by, correlation_id)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-W33', 'Europe/Berlin', 'EUR', 'personnel-plan-cost-v1', 999,
            '00000000-0000-4000-8000-00000000aaa1', 'angriff-data-api')$$,
  '42501',
  NULL,
  'D1 ein Snapshot laesst sich ausserhalb des Laufzeitkanals nicht anlegen — obwohl Spaltenrecht (B5) und costs.calculate (D0b) vorliegen'
);

select is(
  (select count(*)::int from public.cost_snapshots),
  1,
  'D2 nach dem Versuch steht genau die eine Fixture-Zeile — der Angriff blieb wirkungslos'
);

select throws_ok(
  $$insert into public.cost_snapshot_positions
      (org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
       employee_id, employee_label, local_date, duration_ms, rate_version_id,
       amount_minor_units, ordinal)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000009010a1',
            '00000000-0000-4000-8000-0000007010a1',
            '00000000-0000-4000-8000-0000005010a1', 'Untergeschoben',
            '00000000-0000-4000-8000-0000004010a1', 'Untergeschoben',
            date '2026-08-04', 3600000,
            '00000000-0000-4000-8000-00000053c001', 1, 99)$$,
  '42501',
  NULL,
  'D3 eine Position laesst sich ausserhalb des Laufzeitkanals nicht nachschieben — ein bestehender Snapshot waechst nicht heimlich'
);

select is(
  (select count(*)::int from public.cost_snapshot_positions),
  1,
  'D4 nach dem Versuch steht genau die eine Fixture-Position'
);

-- D5 bis D8 sind die Unveraenderlichkeit selbst. Hier entscheidet das FEHLENDE
-- RECHT, nicht die Policy: es gibt weder Grant noch Policy fuer update/delete.
select throws_ok(
  $$update public.cost_snapshots
       set total_minor_units = 1
     where id = '00000000-0000-4000-8000-0000009010a1'$$,
  '42501',
  NULL,
  'D5 ein Snapshotkopf laesst sich nicht aendern — es gibt kein update-Recht (B1)'
);

select throws_ok(
  $$delete from public.cost_snapshots
     where id = '00000000-0000-4000-8000-0000009010a1'$$,
  '42501',
  NULL,
  'D6 ein Snapshotkopf laesst sich nicht loeschen — es gibt kein delete-Recht (B3)'
);

select throws_ok(
  $$update public.cost_snapshot_positions
       set amount_minor_units = 1
     where id = '00000000-0000-4000-8000-0000009110a1'$$,
  '42501',
  NULL,
  'D7 eine Position laesst sich nicht aendern — es gibt kein update-Recht (B2)'
);

select throws_ok(
  $$delete from public.cost_snapshot_positions
     where id = '00000000-0000-4000-8000-0000009110a1'$$,
  '42501',
  NULL,
  'D8 eine Position laesst sich nicht loeschen — es gibt kein delete-Recht (B4)'
);

-- ===========================================================================
-- E. Eigentuemerpfad: der zusammengesetzte FK haelt OHNE jede Policy
-- ===========================================================================
-- Ab hier wieder `postgres`. Das ist kein Umgehen der eben bewiesenen Grenze,
-- sondern der einzige Weg, die FK-Mechanik ueberhaupt zu messen: `postgres`
-- traegt BYPASSRLS, es wirkt hier also KEINE Policy. Was jetzt noch abgelehnt
-- wird, kann folglich nur der Fremdschluessel gewesen sein — genau die
-- Unabhaengigkeit, um derentwillen die Bindung zusammengesetzt ist.
reset role;

-- `ordinal` ist hier 99 und NICHT 0, und das ist keine Kosmetik.
--
-- Gemessen im ersten echten db-gates-Lauf (09.08.2026, Run 31286864590): mit
-- `ordinal = 0` schlug E1 mit 23505 statt 23503 fehl. Der Grund ist die
-- Reihenfolge, in der PostgreSQL prueft — der Eintrag im Unique-Index entsteht
-- beim Schreiben des Tupels, die FK-Trigger feuern erst danach. Auf dem
-- Alpha-Snapshot liegt aus den Fixtures bereits eine Position mit `ordinal = 0`
-- (genau die, auf der E3 unten seinen 23505 aufbaut), also gewann die
-- Unique-Verletzung das Rennen und der Fremdschluessel kam nie zum Zug.
--
-- E1 hat damit NICHT gemessen, was der Testtitel behauptet. Wer die 99 wieder
-- auf 0 setzt, stellt genau diesen blinden Zustand her — und db-gates faellt
-- dann mit „caught 23505 / wanted 23503" zurueck, was der ausgefuehrte
-- Gegenbeweis zu dieser Zeile ist.
--
-- E1 und E2 tragen bewusst DENSELBEN `ordinal` und unterscheiden sich in genau
-- einer Spalte: `snapshot_id`. Nur deshalb ist der 23503 aus E1 dem
-- zusammengesetzten FK zurechenbar und keiner der uebrigen Bindungen — E2
-- beweist mit derselben Zeile, dass alle anderen Spalten einfuegbar sind.
select throws_ok(
  $$insert into public.cost_snapshot_positions
      (org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
       employee_id, employee_label, local_date, duration_ms, rate_version_id,
       amount_minor_units, ordinal)
    values ('00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-0000009010a1',
            '00000000-0000-4000-8000-0000007020b2',
            '00000000-0000-4000-8000-0000005020b2', 'Beta Baustelle',
            '00000000-0000-4000-8000-0000004020b2', 'Beta Planer',
            date '2026-08-03', 28800000,
            '00000000-0000-4000-8000-00000053c002', 32800, 99)$$,
  '23503',
  NULL,
  'E1 eine Beta-Position kann sich nicht an einen Alpha-Snapshot haengen — der zusammengesetzte FK weist sie ab, ohne dass eine Policy beteiligt waere'
);

select lives_ok(
  $$insert into public.cost_snapshot_positions
      (org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
       employee_id, employee_label, local_date, duration_ms, rate_version_id,
       amount_minor_units, ordinal)
    values ('00000000-0000-4000-8000-0000000000b2',
            '00000000-0000-4000-8000-0000009020b2',
            '00000000-0000-4000-8000-0000007020b2',
            '00000000-0000-4000-8000-0000005020b2', 'Beta Baustelle',
            '00000000-0000-4000-8000-0000004020b2', 'Beta Planer',
            date '2026-08-03', 28800000,
            '00000000-0000-4000-8000-00000053c002', 32800, 99)$$,
  'E2 dieselbe Zeile am EIGENEN Snapshot geht durch — ohne sie waere E1 auch dann gruen, wenn gar nichts einfuegbar waere'
);

select throws_ok(
  $$insert into public.cost_snapshot_positions
      (org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
       employee_id, employee_label, local_date, duration_ms, rate_version_id,
       amount_minor_units, ordinal)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000009010a1',
            '00000000-0000-4000-8000-0000007010a1',
            '00000000-0000-4000-8000-0000005010a1', 'Alpha Baustelle',
            '00000000-0000-4000-8000-0000004010a1', 'Alpha Planerin',
            date '2026-08-04', 3600000,
            '00000000-0000-4000-8000-00000053c001', 481, 0)$$,
  '23505',
  NULL,
  'E3 zwei Positionen desselben Snapshots koennen nicht dieselbe ordinal tragen — die Reihenfolge ist eindeutig'
);

-- ===========================================================================
-- F. Cross-Tenant: eine fremde Organisation sieht nichts
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000bbb2', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.cost_snapshots
    where id = '00000000-0000-4000-8000-0000009010a1'),
  0,
  'F1 User B sieht den Snapshot der fremden Organisation NICHT'
);

select is(
  (select count(*)::int from public.cost_snapshots
    where id = '00000000-0000-4000-8000-0000009020b2'),
  1,
  'F2 den eigenen sieht er sehr wohl — ohne diese Zeile waere F1 auch bei voellig blockiertem Lesen gruen'
);

select * from finish();
rollback;
