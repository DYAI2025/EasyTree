-- pgTAP: Veroeffentlichungsrecht und die DB-Haelfte des Publish-Pfads (EYT-107).
--
-- ---------------------------------------------------------------------------
-- Was hier bewiesen wird, und warum ausgerechnet auf DB-Ebene
-- ---------------------------------------------------------------------------
-- Die Unabhaengigkeitszusage: Anwendung UND Datenbank lehnen getrennt ab.
-- Diese Datei prueft ausschliesslich die Datenbankhaelfte. Selbst wenn
-- `MembershipPlanningAccessPolicy` eines Tages jede Anfrage durchwinkt, darf
-- hier niemand ohne `planning.publish` eine Planversion veroeffentlichen.
--
-- Fuenf Aussagen, die ohne echtes PostgreSQL nicht pruefbar sind:
--   1. Die Rollenmatrix aus der PO-Entscheidung steht so in der Datenbank,
--      und `member` traegt NICHTS.
--   2. `planning.write` impliziert `planning.publish` NICHT — das ist der
--      ganze Zweck des dritten Rechts, und ohne Test waere es eine Behauptung.
--   3. Ohne `planning.publish` setzt kein UPDATE `published_at` (0 Zeilen
--      betroffen — RLS liefert hier keinen Fehler, sondern Wirkungslosigkeit;
--      genau deshalb wird die WIRKUNG geprueft und nicht nur der Rueckgabewert).
--   4. Mit dem Recht funktioniert es, und der Trigger aus 0010 stempelt die
--      Zuweisungen in derselben Transaktion mit.
--   5. Ein fremdes `published_by` wird abgelehnt (Urheberzusage).
--
-- ---------------------------------------------------------------------------
-- Warum hier Mitgliedschaften angelegt werden
-- ---------------------------------------------------------------------------
-- `seed.sql` kennt genau drei Mitgliedschaften: zwei owner und einen
-- INAKTIVEN member. Fuer Aussage 1-3 braucht es einen AKTIVEN member und einen
-- manager; beide entstehen hier, vor dem Rollenwechsel, und verschwinden mit
-- dem `rollback` am Dateiende. `seed.sql` bleibt unangetastet — es ist
-- gemeinsame Grundlage aller Suiten und kein Ablageplatz fuer Testfaelle
-- einzelner Tickets.
--
-- Zur Form von throws_ok: ZWEIstellig (sql, errcode). Die dreistellige Form
-- erwartet ERRMSG, nicht eine Beschreibung.

begin;
select plan(17);

-- ===========================================================================
-- Zusaetzliche Mitgliedschaften, nur fuer diese Transaktion
-- ===========================================================================
-- Projektionen zuerst: `memberships.user_id` zeigt auf `public.users`.
insert into public.users (id, display_name) values
  ('00000000-0000-4000-8000-00000000ddd4', 'Testmanagerin Alpha'),
  ('00000000-0000-4000-8000-00000000eee5', 'Testmitarbeiter Alpha')
on conflict (id) do nothing;

insert into public.memberships (id, org_id, user_id, role, active) values
  ('00000000-0000-4000-8000-0000000e0dd4', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-00000000ddd4', 'manager', true),
  ('00000000-0000-4000-8000-0000000e0ee5', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-00000000eee5', 'member', true)
on conflict (id) do nothing;

-- ===========================================================================
-- 1. Die Rollenmatrix (PO-Entscheidung 03.08.2026)
-- ===========================================================================
select is(
  (select count(*)::int from public.role_permissions
    where role = 'owner' and permission like 'planning.%'),
  3,
  'owner traegt alle drei Planungsrechte'
);

select is(
  (select count(*)::int from public.role_permissions
    where role = 'manager' and permission like 'planning.%'),
  3,
  'manager traegt alle drei Planungsrechte'
);

select is(
  (select count(*)::int from public.role_permissions
    where role = 'member' and permission like 'planning.%'),
  0,
  'member traegt kein einziges Planungsrecht'
);

-- Gegenrichtung: kein Tippfehler und kein zusaetzliches Recht schleicht sich
-- ein. Ohne diese Zeile waere 'planning.publsh' gruen.
select is(
  (select count(*)::int from public.role_permissions
    where permission like 'planning.%'
      and permission not in ('planning.read', 'planning.write', 'planning.publish')),
  0,
  'es existiert kein Planungsrecht ausserhalb der drei vereinbarten'
);

-- ===========================================================================
-- 2. Kontext: aktiver member in Org Alpha — darf NICHTS
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000eee5', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000a1', 'planning.publish'),
  false,
  'ein aktiver member darf nicht veroeffentlichen'
);

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000a1', 'planning.read'),
  false,
  'ein aktiver member darf die Planung nicht einmal lesen'
);

-- Der eigentliche Nachweis: nicht „wirft einen Fehler", sondern „bewirkt
-- nichts". RLS filtert die Zeile aus dem UPDATE heraus, statt abzubrechen —
-- ein Test, der nur auf eine Exception prueft, waere hier gruen und falsch.
update public.plan_versions
   set published_at = now(),
       published_by = '00000000-0000-4000-8000-00000000eee5'
 where id = '00000000-0000-4000-8000-0000006010a1';

select is(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006010a1'),
  null,
  'der member hat NICHTS veroeffentlicht — die Zeile ist unveraendert Entwurf'
);

-- ===========================================================================
-- 3. Kontext: manager in Org Alpha — darf lesen, schreiben UND publizieren
-- ===========================================================================
reset role;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000ddd4', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000a1', 'planning.publish'),
  true,
  'die Managerin darf veroeffentlichen'
);

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000b2', 'planning.publish'),
  false,
  'dieselbe Person darf in einer FREMDEN Organisation nicht veroeffentlichen'
);

-- Urheberzusage: ein fremdes published_by verstoesst gegen den with-check.
select throws_ok(
  $$update public.plan_versions
       set published_at = now(),
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '42501'
);

select is(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006010a1'),
  null,
  'nach dem abgelehnten Versuch ist die Version weiterhin Entwurf'
);

-- Der Positivfall. Ohne ihn saehe man nicht, ob die Ablehnungen oben echt sind
-- oder ob generell nichts geht.
select lives_ok(
  $$update public.plan_versions
       set published_at = now(),
           published_by = app.current_user_id()
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  'die Managerin veroeffentlicht die Planversion ihrer Organisation'
);

select isnt(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006010a1'),
  null,
  'plan_versions.published_at ist gesetzt'
);

-- Der Trigger aus 0010 in derselben Transaktion: die Zuweisungen tragen den
-- Marker, ohne dass die Anwendung ihn geschrieben haette.
select is(
  (select count(*)::int from public.assignments
    where plan_version_id = '00000000-0000-4000-8000-0000006010a1'
      and published_at is null),
  0,
  'der Sync-Trigger hat JEDE Zuweisung der Version mitgestempelt'
);

select is(
  (select count(*)::int from public.assignments
    where plan_version_id = '00000000-0000-4000-8000-0000006010a1'),
  1,
  'und es gab ueberhaupt eine Zuweisung — sonst waere die Zeile darueber vakuos'
);

-- Unveraenderlichkeit greift ab jetzt (0010), auch fuer die Berechtigte.
select throws_ok(
  $$update public.plan_versions
       set week_key = '2026-W33'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '23514'
);

-- ===========================================================================
-- 4. Cross-Tenant: fremde Organisation bleibt unberuehrt
-- ===========================================================================
select is(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006020b2'),
  null,
  'die Planversion der fremden Organisation ist unveraendert Entwurf'
);

select * from finish();
rollback;
