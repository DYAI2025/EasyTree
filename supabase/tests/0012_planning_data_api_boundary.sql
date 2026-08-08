-- 0012_planning_data_api_boundary — Data-API-Grenze der Planung (EYT-136)
--
-- ## Was hier gemessen wird
--
-- Migration 0017 bindet das Anlegen von Entwuerfen und Zuweisungen an den
-- Laufzeitkanal (`app.is_runtime_channel()`) und an das atomare Recht
-- `planning.write`. `update` und `delete` auf `public.assignments` fallen ganz
-- weg, weil der Produktionscode sie nirgends benutzt.
--
-- ## Warum Rechte UND Verhalten geprueft werden
--
-- SQLSTATE `42501` ist mehrdeutig: er entsteht sowohl aus einem fehlenden
-- Tabellen-/Spaltenrecht als auch aus einer verletzten RLS-Policy. Ein reiner
-- Verhaltenstest sagt deshalb NICHT, welcher Riegel gehalten hat — und ein
-- Riegel, von dem man das nicht weiss, kann unbemerkt verschwinden. Abschnitt A
-- stellt die Rechtelage fest, Abschnitt C das Verhalten, und Abschnitt A3 ist
-- die Gegenprobe, die beides trennt: das INSERT-Spaltenrecht auf `assignments`
-- besteht WEITER, also kann die Ablehnung in C nur aus der Policy stammen.
--
-- ## Warum der Kanal hier nur NEGATIV pruefbar ist
--
-- `app.is_runtime_channel()` vergleicht `session_user` mit `easytree_app`. In
-- pgTAP ist `session_user` immer `postgres`; `SET SESSION AUTHORIZATION`
-- verlangt Superuser und steht hier nicht zur Verfuegung. Diese Datei kann also
-- belegen, dass ein NICHT-Laufzeitkanal abgewiesen wird — dass der echte Kanal
-- durchkommt, belegt `apps/api/test/planning-write.integration.test.ts` ueber
-- eine echte `easytree_app`-Verbindung, und der echte Angriffsweg ueber
-- PostgREST steht in `apps/web/e2e/auth-journey/`.
--
-- ## Mitgefuehrte Invarianten (Doppelung, kein Umzug)
--
-- Abschnitt D fuehrt zwei Zusicherungen mit, die bis EYT-136 in
-- `0006_planning_invariants.sql` unter `set local role authenticated` liefen:
-- „Entwuerfe duerfen sich ueberschneiden" und „eine unveroeffentlichte
-- Zuweisung laesst sich loeschen". Beide sind Aussagen ueber Constraints und
-- Trigger, nicht ueber den Client-Kanal; sie laufen deshalb weiter — nur auf
-- dem Eigentuemerpfad, der fuer Fixtures legitim ist.
--
-- Praezisierung aus der Kanalmatrix vom 08.08.2026
-- (docs/reviews/2026-08-08-eyt-136-kanalmatrix.md, Befund B5): die Originale
-- stehen WEITERHIN in `0006` (Z. 126 und 142), ebenfalls auf dem
-- Eigentuemerpfad. D1/D2 sind also eine Doppelung an der Grenze, kein Umzug —
-- „uebernommen" waere das falsche Wort und hiesse, in `0006` sei nichts mehr.

begin;
select plan(18);

-- ===========================================================================
-- A. Rechtelage (Struktur)
-- ===========================================================================

select ok(
  not has_table_privilege('authenticated', 'public.assignments', 'UPDATE'),
  'A1 assignments: authenticated hat KEIN update-Recht mehr (kein Verbraucher im Produktionscode)'
);

select ok(
  not has_table_privilege('authenticated', 'public.assignments', 'DELETE'),
  'A2 assignments: authenticated hat KEIN delete-Recht mehr — 0007 vergab es, niemand entzog es bis 0017'
);

-- Die Gegenprobe zur Mehrdeutigkeit von 42501: das Spaltenrecht BESTEHT.
-- Faellt C1 trotzdem, kann es nur die Policy gewesen sein.
select ok(
  has_column_privilege('authenticated', 'public.assignments', 'starts_at_utc', 'INSERT'),
  'A3 assignments: das INSERT-Spaltenrecht besteht weiter — die Ablehnung in C1 stammt aus der Policy, nicht aus dem Grant'
);

select ok(
  not has_column_privilege('authenticated', 'public.assignments', 'id', 'INSERT'),
  'A4 assignments: die ungenutzte Spalte id ist aus dem INSERT-Grant entfernt'
);

select ok(
  has_column_privilege('authenticated', 'public.plan_versions', 'week_key', 'INSERT')
    and not has_column_privilege('authenticated', 'public.plan_versions', 'id', 'INSERT'),
  'A5 plan_versions: INSERT nur noch auf (org_id, week_key), id entfernt'
);

-- Das Veroeffentlichen darf durch 0017 NICHT verloren gehen.
select ok(
  has_column_privilege('authenticated', 'public.plan_versions', 'published_at', 'UPDATE'),
  'A6 plan_versions: das UPDATE-Recht auf published_at bleibt erhalten (EYT-107 darf nicht regressieren)'
);

-- ===========================================================================
-- B. Policylage
-- ===========================================================================

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'assignments'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  1,
  'B1 assignments: von drei Schreibpolicies bleibt genau eine (INSERT) — update und delete sind samt Policy entfernt'
);

select ok(
  (select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'assignments' and cmd = 'INSERT')
    like '%is_runtime_channel%',
  'B2 assignments: die INSERT-Policy prueft den Laufzeitkanal'
);

select ok(
  (select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'assignments' and cmd = 'INSERT')
    like '%planning.write%',
  'B3 assignments: die INSERT-Policy prueft das atomare Recht planning.write'
);

select ok(
  (select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'plan_versions' and cmd = 'INSERT')
    like '%is_runtime_channel%'
  and (select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'plan_versions' and cmd = 'INSERT')
    like '%planning.write%',
  'B4 plan_versions: die INSERT-Policy prueft Kanal UND planning.write'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'plan_versions' and cmd = 'DELETE'),
  0,
  'B5 plan_versions: die seit 0016 wirkungslose DELETE-Policy ist entfernt — ein spaeteres grant reaktiviert sie nicht mehr'
);

-- ===========================================================================
-- C. Verhalten im NICHT-Laufzeitkanal
-- ===========================================================================
-- Kontext: User A, `owner` in Org Alpha, traegt also planning.write. Genau das
-- ist der Punkt — abgelehnt wird hier nicht das fehlende Recht, sondern der
-- Kanal. Ein Test mit einem rechtlosen `member` koennte das nicht trennen.

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000aaa1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select ok(
  not app.is_runtime_channel(),
  'C0 diese Sitzung ist NICHT der Laufzeitkanal (session_user = postgres) — die Voraussetzung von C1 bis C4'
);

select throws_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-05T10:00:00Z', '2026-08-05T18:00:00Z')$$,
  '42501',
  NULL,
  'C1 assignments INSERT ausserhalb des Laufzeitkanals wird abgewiesen — obwohl Spaltenrecht (A3) und planning.write vorliegen'
);

select throws_ok(
  $$update public.assignments set starts_at_utc = '2026-08-03T05:00:00Z'
     where org_id = '00000000-0000-4000-8000-0000000000a1'$$,
  '42501',
  NULL,
  'C2 assignments UPDATE wird abgewiesen — das Recht ist entzogen (A1)'
);

select throws_ok(
  $$delete from public.assignments
     where org_id = '00000000-0000-4000-8000-0000000000a1'$$,
  '42501',
  NULL,
  'C3 assignments DELETE wird abgewiesen — das Recht ist entzogen (A2)'
);

select throws_ok(
  $$insert into public.plan_versions (org_id, week_key)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-W44')$$,
  '42501',
  NULL,
  'C4 plan_versions INSERT ausserhalb des Laufzeitkanals wird abgewiesen'
);

-- ===========================================================================
-- D. Uebernommene Invarianten auf dem Eigentuemerpfad
-- ===========================================================================
-- Fixture-Erzeugung darf privilegiert laufen (PO-Vorgabe 07.08.2026). Die
-- Aussage dieser beiden Zusicherungen betrifft Constraints und Trigger, nicht
-- den Client-Kanal — sie feuern fuer den Eigentuemer unveraendert.
reset role;

select lives_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-03T10:00:00Z', '2026-08-03T18:00:00Z')$$,
  'D1 Zwei ueberlappende ENTWURFS-Zuweisungen derselben Person sind erlaubt (uebernommen aus 0006, Eigentuemerpfad)'
);

select lives_ok(
  $$delete from public.assignments
     where org_id = '00000000-0000-4000-8000-0000000000a1'
       and starts_at_utc = '2026-08-03T10:00:00Z'$$,
  'D2 Eine unveroeffentlichte Zuweisung laesst sich loeschen (uebernommen aus 0006, Eigentuemerpfad)'
);

select * from finish();
rollback;
