-- pgTAP: Zeitverhalten und Idempotenz auf Datenbankebene (EYT-61).
--
-- ---------------------------------------------------------------------------
-- Warum diese Datei existiert
-- ---------------------------------------------------------------------------
-- Zwei belegte Luecken aus der Bestandsaufnahme zu EYT-61:
--
-- 1. KEIN EINZIGER Zeitumstellungs- oder Mitternachtsfall auf DB-Ebene. Alle
--    bisherigen SQL-Fixtures liegen im August 2026 (seed.sql, 0004, 0006). Der
--    EXCLUDE-Constraint aus EYT-49 arbeitet auf einer generierten tstzrange und
--    ist nie an einem Umstellungsdatum ausgefuehrt worden. Dass tstzrange
--    zeitzonenneutral IST, ist ein plausibles Argument — es stand nirgends als
--    Test. Ein Argument ist kein Beleg.
--
-- 2. Die Idempotenzmechanismen sind vorhanden und ungeprueft. Weder
--    `unique (org_id, message_type, idempotency_key)` auf outbox_messages
--    (0008) noch der partielle Index `plan_versions_one_draft_per_week` (0007)
--    hatte bis hierher einen Positiv- ODER Negativtest. Beide sind die einzigen
--    Stellen, an denen EYT-61 AK4 heute ueberhaupt einen Gegenstand hat: es gibt
--    im Repository keinen Ausfuehrungspfad, an dem ein Idempotency-Key ankaeme
--    (genau ein Controller, und der ist lesend).
--
-- ---------------------------------------------------------------------------
-- Zur Form von throws_ok
-- ---------------------------------------------------------------------------
-- Hier steht bewusst die ZWEIstellige Form throws_ok(sql, errcode). Die
-- dreistellige waere throws_ok(sql, errcode, ERRMSG) — nicht (…, Beschreibung);
-- dieser Irrtum hat in diesem Repository schon einen roten CI-Lauf gekostet.
-- Die fachliche Aussage traegt jeweils die nachfolgende is()-Zeile, die den
-- WIRKUNGSLOSIGKEITSNACHWEIS fuehrt: nach der Ablehnung steht genau eine Zeile.
-- Auf Constraintnamen wird nicht gematcht, weil `unique (…)` in 0008 unbenannt
-- ist und PostgreSQL den Namen erzeugt.
--
-- ---------------------------------------------------------------------------
-- Die Umstellungstermine
-- ---------------------------------------------------------------------------
-- Europe/Berlin 2026:
--   Fruehjahr  So 2026-03-29  02:00 CET  -> 03:00 CEST   (01:00 UTC)
--   Herbst     So 2026-10-25  03:00 CEST -> 02:00 CET    (01:00 UTC)
-- Die ersten Zusicherungen rechnen das gegen die Zeitzonendatenbank DIESES
-- Servers nach, statt es zu glauben.

begin;
select plan(24);

-- ===========================================================================
-- Voraussetzung: dieser Server kennt die Umstellung wirklich
-- ===========================================================================
select is(
  (select count(*)::int from pg_timezone_names where name = 'Europe/Berlin'),
  1,
  'Die Zeitzonendatenbank kennt Europe/Berlin'
);

select is(
  (timestamptz '2026-03-29T00:30:00Z' at time zone 'Europe/Berlin')::time,
  time '01:30',
  'Vor der Fruehjahrsumstellung gilt CET (+1)'
);

select is(
  (timestamptz '2026-03-29T01:30:00Z' at time zone 'Europe/Berlin')::time,
  time '03:30',
  'Nach der Fruehjahrsumstellung gilt CEST (+2) — die Stunde 02:xx existiert nicht'
);

select is(
  (timestamptz '2026-10-25T00:30:00Z' at time zone 'Europe/Berlin')::time,
  time '02:30',
  'Erster Durchlauf der doppelten Winterzeitstunde'
);

select is(
  (timestamptz '2026-10-25T01:30:00Z' at time zone 'Europe/Berlin')::time,
  time '02:30',
  'Zweiter Durchlauf derselben Wanduhrzeit — gleiche Anzeige, anderer Instant'
);

-- ===========================================================================
-- tstzrange zaehlt verstrichene Zeit, nicht Wanduhrdifferenz
-- ===========================================================================
select is(
  upper(tstzrange('2026-03-29T00:00:00Z', '2026-03-29T02:00:00Z', '[)'))
    - lower(tstzrange('2026-03-29T00:00:00Z', '2026-03-29T02:00:00Z', '[)')),
  interval '2 hours',
  'Ueber die Sommerzeitluecke: Wanduhr springt 3 h, die Range zaehlt 2 h'
);

select is(
  upper(tstzrange('2026-10-25T00:00:00Z', '2026-10-25T03:00:00Z', '[)'))
    - lower(tstzrange('2026-10-25T00:00:00Z', '2026-10-25T03:00:00Z', '[)')),
  interval '3 hours',
  'Ueber die doppelte Winterzeitstunde: 2 h Anzeige, 3 h Arbeit'
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
-- Der EXCLUDE an einem Umstellungsdatum
-- ---------------------------------------------------------------------------
-- Erste Version: eine Schicht MITTEN durch die Faltung, 00:00-03:00 UTC, also
-- Wanduhr 02:00 bis 04:00 am 25. Oktober.
select lives_ok(
  $$insert into public.plan_versions (id, org_id, week_key)
    values ('00000000-0000-4000-8000-0000006143a1',
            '00000000-0000-4000-8000-0000000000a1', '2026-W43')$$,
  'Entwurf fuer die Oktober-Umstellungswoche laesst sich anlegen'
);

select lives_ok(
  $$insert into public.assignments
      (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000007143a1',
            '00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006143a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-10-25T00:00:00Z', '2026-10-25T03:00:00Z')$$,
  'Schicht durch die doppelte Winterzeitstunde laesst sich anlegen'
);

-- ---------------------------------------------------------------------------
-- Veroeffentlichen laeuft ab hier ueber den EIGENTUEMERPFAD (EYT-107 P1)
-- ---------------------------------------------------------------------------
-- `plan_versions_update_in_org` verlangt seit dem P1-Fix zusaetzlich den
-- Laufzeitkanal (`session_user = 'easytree_app'`). Die Sitzung dieser Datei ist
-- `postgres` und laesst sich nicht umbenennen — `SET SESSION AUTHORIZATION`
-- verlangt einen Superuser, und `postgres` ist in Supabase keiner.
--
-- Ueber `authenticated` waere jedes Veroeffentlichen hier wirkungslos, und die
-- drei folgenden Aussagen ueber den EXCLUDE waeren still vakuos: ein `lives_ok`
-- bliebe gruen (RLS wirft nicht, sie filtert), das `throws_ok('23P01')` dagegen
-- wuerde rot. Gemessen wird in dieser Datei der Constraint an der
-- Zeitumstellung, nicht der Kanal — also kurz zurueck auf den Eigentuemer.
reset role;

select lives_ok(
  $$update public.plan_versions
       set published_at = '2026-10-20T09:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006143a1'$$,
  'Die Umstellungswoche laesst sich veroeffentlichen'
);

set local role authenticated;

-- Zweite Version: zuerst UEBERLAPPEND. Reihenfolge ist Absicht — waere der
-- beruehrende Fall zuerst erfolgreich, waere die Zuweisung danach
-- veroeffentlicht und damit unveraenderlich (0010), und der Ueberlappungsfall
-- liesse sich nicht mehr aus derselben Zeile herstellen.
select lives_ok(
  $$insert into public.plan_versions (id, org_id, week_key)
    values ('00000000-0000-4000-8000-0000006144a1',
            '00000000-0000-4000-8000-0000000000a1', '2026-W43')$$,
  'Zweiter Entwurf derselben Woche nach der Veroeffentlichung der ersten'
);

select lives_ok(
  $$insert into public.assignments
      (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000007144a1',
            '00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006144a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-10-25T02:00:00Z', '2026-10-25T06:00:00Z')$$,
  'Die ueberlappende Schicht ist als Entwurf erlaubt — Entwuerfe duerfen kollidieren'
);

reset role;

select throws_ok(
  $$update public.plan_versions
       set published_at = '2026-10-20T10:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006144a1'$$,
  '23P01'
);

set local role authenticated;

select is(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006144a1'),
  null,
  'Ueberlappung IN der doppelten Winterzeitstunde verhindert die Veroeffentlichung'
);

-- Jetzt beruehrend statt ueberlappend: 03:00Z ist exakt das Ende der ersten
-- Schicht. Halboffen [start, end) heisst, dass das KEIN Konflikt ist — auch
-- nicht an dem Tag, an dem eine Wanduhrzeit zweimal vorkommt.
select lives_ok(
  $$update public.assignments
       set starts_at_utc = '2026-10-25T03:00:00Z'
     where id = '00000000-0000-4000-8000-0000007144a1'$$,
  'Die noch unveroeffentlichte Schicht laesst sich verschieben'
);

reset role;

select lives_ok(
  $$update public.plan_versions
       set published_at = '2026-10-20T11:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006144a1'$$,
  'Beruehrung am Umstellungstag ist kein Konflikt — halboffen gilt auch dort'
);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Idempotenz: derselbe Schluessel erzeugt keine zweite Nachricht (AK4)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.outbox_messages (org_id, message_type, idempotency_key, payload)
    values ('00000000-0000-4000-8000-0000000000a1', 'plan.published', 'schluessel-1', '{}'::jsonb)$$,
  'Erste Nachricht mit einem Idempotenzschluessel'
);

select throws_ok(
  $$insert into public.outbox_messages (org_id, message_type, idempotency_key, payload)
    values ('00000000-0000-4000-8000-0000000000a1', 'plan.published', 'schluessel-1', '{"anders": true}'::jsonb)$$,
  '23505'
);

select is(
  (select count(*)::int from public.outbox_messages
    where org_id = '00000000-0000-4000-8000-0000000000a1'
      and message_type = 'plan.published'
      and idempotency_key = 'schluessel-1'),
  1,
  'Der wiederholte Schluessel hinterlaesst genau eine Nachricht — auch mit anderem payload'
);

-- Gegenprobe 1: ein anderer Schluessel geht durch. Ohne sie waere die
-- Ablehnung oben auch dann gruen, wenn ueberhaupt nur eine Nachricht je
-- Organisation moeglich waere.
select lives_ok(
  $$insert into public.outbox_messages (org_id, message_type, idempotency_key, payload)
    values ('00000000-0000-4000-8000-0000000000a1', 'plan.published', 'schluessel-2', '{}'::jsonb)$$,
  'Ein anderer Schluessel erzeugt sehr wohl eine Nachricht'
);

-- Gegenprobe 2: derselbe Schluessel unter anderem Nachrichtentyp ebenso. Der
-- Index ist dreiteilig; ohne diese Zeile waere nicht belegt, dass der Typ
-- ueberhaupt mitzaehlt.
select lives_ok(
  $$insert into public.outbox_messages (org_id, message_type, idempotency_key, payload)
    values ('00000000-0000-4000-8000-0000000000a1', 'plan.retracted', 'schluessel-1', '{}'::jsonb)$$,
  'Derselbe Schluessel unter anderem Nachrichtentyp ist eine eigene Nachricht'
);

-- ---------------------------------------------------------------------------
-- Genau ein Entwurf je Woche (AK4, zweiter Mechanismus)
-- ---------------------------------------------------------------------------
-- Eigene Woche, damit die Veroeffentlichungen oben nicht hineinspielen.
select lives_ok(
  $$insert into public.plan_versions (org_id, week_key)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-W44')$$,
  'Ein Entwurf fuer eine bisher unbeplante Woche'
);

select throws_ok(
  $$insert into public.plan_versions (org_id, week_key)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-W44')$$,
  '23505'
);

select is(
  (select count(*)::int from public.plan_versions
    where org_id = '00000000-0000-4000-8000-0000000000a1'
      and week_key = '2026-W44'),
  1,
  'Zwei gleichzeitige Entwuerfe derselben Woche sind unmoeglich — "der" Entwurf bleibt bestimmbar'
);

select * from finish();
rollback;
