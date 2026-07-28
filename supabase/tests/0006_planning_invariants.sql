-- pgTAP: Planungsinvarianten als SQL-Vertraege (EYT-49).
--
-- Muster wie 0002/0004: Rollenwechsel wie im echten API-Pfad, also
-- `set local role authenticated` plus `request.jwt.claims` je Transaktion.
--
-- Was diese Datei NICHT leisten kann: Nebenlaeufigkeit. pgTAP laeuft in EINER
-- Session, und zwei gleichzeitige Transaktionen sind der einzige Weg, den
-- EXCLUDE-Constraint als Sperre statt als Pruefung zu zeigen. Dafuer gibt es
-- apps/api/test/planning-invariants.integration.test.ts mit zwei echten
-- Verbindungen; EYT-49 AK6 stuetzt sich auf beide Dateien zusammen.

begin;
select plan(22);

-- ===========================================================================
-- Schemaform
-- ===========================================================================
select is(
  (
    select count(*)::int
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'assignments'
      and c.conname = 'assignments_no_published_overlap'
      and c.contype = 'x'
  ),
  1,
  'assignments traegt einen EXCLUDE-Constraint gegen veroeffentlichte Ueberlappung'
);

select has_trigger('public', 'plan_versions', 'plan_versions_publish_assignments',
  'plan_versions setzt beim Veroeffentlichen die Marker der Zuweisungen');
select has_trigger('public', 'plan_versions', 'plan_versions_published_immutable',
  'plan_versions schuetzt veroeffentlichte Revisionen');
select has_trigger('public', 'assignments', 'assignments_published_immutable',
  'assignments schuetzt veroeffentlichte Zeilen');
select has_trigger('public', 'assignments', 'assignments_reject_published_plan',
  'assignments weist Zugang zu veroeffentlichten Planversionen ab');

-- published_at darf nicht mehr direkt geschrieben werden. Ohne diesen Entzug
-- waere der partielle EXCLUDE umgehbar: wer den Marker loescht, nimmt die
-- Zeile aus dem Geltungsbereich.
select is(
  has_column_privilege('authenticated', 'public.assignments', 'published_at', 'update'),
  false,
  'authenticated darf assignments.published_at NICHT direkt setzen'
);

-- Gegenprobe: die fachlichen Spalten sind sehr wohl aenderbar. Ohne sie waere
-- die Zeile oben auch dann gruen, wenn gar kein update-Recht mehr existiert.
select is(
  has_column_privilege('authenticated', 'public.assignments', 'starts_at_utc', 'update'),
  true,
  'authenticated darf assignments.starts_at_utc aendern — das Recht existiert, nur nicht auf dem Marker'
);

-- Dasselbe fuer insert. Ohne den Entzug koennte der Marker beim ANLEGEN
-- mitgeliefert werden: die Zeile naehme sofort am EXCLUDE teil und waere
-- danach unveraenderlich und unloeschbar — ein Wert, den niemand mehr
-- korrigieren kann.
select is(
  has_column_privilege('authenticated', 'public.assignments', 'published_at', 'insert'),
  false,
  'authenticated darf assignments.published_at NICHT beim Anlegen mitgeben'
);

select is(
  has_column_privilege('authenticated', 'public.assignments', 'starts_at_utc', 'insert'),
  true,
  'authenticated darf assignments anlegen — nur den Marker nicht mitliefern'
);

-- ===========================================================================
-- Kontext: User A, aktiv in Org Alpha
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000aaa1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Entwuerfe duerfen sich ueberschneiden — das ist ihr Zweck
-- ---------------------------------------------------------------------------
-- Der Seed haelt fuer Alpha eine Schicht 06:00-14:00 UTC im Entwurf 2026-W32.
select lives_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-0000-0000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-03T10:00:00Z', '2026-08-03T18:00:00Z')$$,
  'Zwei ueberlappende ENTWURFS-Zuweisungen derselben Person sind erlaubt'
);

-- ---------------------------------------------------------------------------
-- Veroeffentlichen setzt beide Marker in derselben Transaktion
-- ---------------------------------------------------------------------------
-- Zuerst die eben angelegte Ueberlappung wieder entfernen, sonst scheitert die
-- Veroeffentlichung an genau dem Constraint, der weiter unten geprueft wird.
select lives_ok(
  $$delete from public.assignments
    where org_id = '00000000-0000-4000-8000-0000000000a1'
      and starts_at_utc = '2026-08-03T10:00:00Z'$$,
  'Eine unveroeffentlichte Zuweisung laesst sich loeschen'
);

select lives_ok(
  $$update public.plan_versions
       set published_at = '2026-07-31T12:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  'Eine Planversion laesst sich veroeffentlichen'
);

select is(
  (
    select published_at
    from public.assignments
    where id = '00000000-0000-4000-8000-0000007010a1'
  ),
  timestamptz '2026-07-31T12:00:00Z',
  'Die Zuweisung traegt danach denselben Veroeffentlichungszeitpunkt — ein Vorgang, nicht zwei'
);

-- ---------------------------------------------------------------------------
-- Veroeffentlichtes ist unveraenderlich
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.plan_versions set week_key = '2026-W33'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '23514',
  'Veroeffentlichte Zeile in public.plan_versions ist unveraenderlich',
  'Eine veroeffentlichte Planversion laesst sich nicht aendern'
);

select throws_ok(
  $$delete from public.plan_versions where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '23514',
  'Veroeffentlichte Zeile in public.plan_versions ist unveraenderlich und kann nicht geloescht werden',
  'Eine veroeffentlichte Planversion laesst sich nicht loeschen'
);

select throws_ok(
  $$update public.assignments set starts_at_utc = '2026-08-03T05:00:00Z'
     where id = '00000000-0000-4000-8000-0000007010a1'$$,
  '23514',
  'Veroeffentlichte Zeile in public.assignments ist unveraenderlich',
  'Eine veroeffentlichte Zuweisung laesst sich nicht nachtraeglich verschieben'
);

select throws_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-4000-8000-0000004011a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-04T06:00:00Z', '2026-08-04T14:00:00Z')$$,
  '23514',
  'Planversion 00000000-0000-4000-8000-0000006010a1 ist veroeffentlicht und nimmt keine Zuweisung mehr auf',
  'Eine veroeffentlichte Planversion nimmt keine weitere Zuweisung auf'
);

-- ---------------------------------------------------------------------------
-- Der EXCLUDE greift beim Veroeffentlichen der ZWEITEN Version
-- ---------------------------------------------------------------------------
-- Der realistische Weg: Woche 32 hat jetzt eine veroeffentlichte Version. Eine
-- neue Entwurfsversion derselben Woche ist erlaubt (der partielle Unique-Index
-- aus 0007 gilt nur fuer Entwuerfe). Ihre ueberlappende Zuweisung ist als
-- Entwurf ebenfalls erlaubt — und faellt erst in dem Moment auf, in dem sie
-- verbindlich werden soll.
select lives_ok(
  $$insert into public.plan_versions (id, org_id, week_key)
    values ('00000000-0000-4000-8000-0000006099a1',
            '00000000-0000-4000-8000-0000000000a1', '2026-W32')$$,
  'Nach der Veroeffentlichung ist ein neuer Entwurf derselben Woche erlaubt'
);

select lives_ok(
  $$insert into public.assignments
      (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000007099a1',
            '00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006099a1',
            '00000000-0000-0000-0000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-03T10:00:00Z', '2026-08-03T18:00:00Z')$$,
  'Die kollidierende Zuweisung ist als Entwurf erlaubt'
);

select throws_ok(
  $$update public.plan_versions
       set published_at = '2026-07-31T13:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006099a1'$$,
  '23P01',
  'conflicting key value violates exclusion constraint "assignments_no_published_overlap"',
  'Die zweite Veroeffentlichung scheitert an der Ueberlappung derselben Person'
);

-- Gegenprobe zur Halboffenheit: direkt anschliessend, nicht ueberlappend.
-- Ohne diese Zeile waere der Constraint auch dann gruen, wenn er JEDE zweite
-- Veroeffentlichung ablehnt.
select lives_ok(
  $$update public.assignments
       set starts_at_utc = '2026-08-03T14:00:00Z', ends_at_utc = '2026-08-03T18:00:00Z'
     where id = '00000000-0000-4000-8000-0000007099a1'$$,
  'Die kollidierende Zuweisung laesst sich auf einen anschliessenden Zeitraum verschieben'
);

select lives_ok(
  $$update public.plan_versions
       set published_at = '2026-07-31T13:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006099a1'$$,
  'Ein anschliessender Zeitraum (14:00 nach 06:00-14:00) ist kein Konflikt — halboffen wie im Domainmodell'
);

select * from finish();
rollback;
