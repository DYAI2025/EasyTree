-- Fixtures des integrierten Read-Through-Nachweises (EYT-50).
--
-- Laeuft als `postgres` NACH `supabase db reset`, also auf dem Seed-Stand.
-- Alle Ids sind fest und tragen erkennbare Praefixe, damit ein Treffer im DOM
-- eindeutig zuzuordnen ist.
--
-- ## Warum der echte Lebenszyklus gegangen wird
--
-- Der erste Entwurf legte die Versionen sofort veroeffentlicht an und schrieb
-- danach Zuweisungen hinein. Das scheiterte an
-- `app.reject_assignment_in_published_plan` aus Migration 0010 — zu Recht:
-- eine veroeffentlichte Planversion nimmt nichts mehr auf, sonst aendert sich
-- der Plan, waehrend die Revision unveraendert bleibt.
--
-- Die Fixture geht deshalb denselben Weg wie die Anwendung: Entwurf anlegen,
-- Zuweisung hinzufuegen, dann veroeffentlichen. Das ist nicht nur noetig,
-- sondern besseres Material — Daten, die unter denselben Regeln entstanden
-- sind, die auch im Betrieb gelten.
--
-- Der Sync-Trigger aus 0010 setzt `assignments.published_at` dabei selbst;
-- direkt schreibbar ist die Spalte ohnehin nicht.
--
-- Drei Konstellationen, die der Standardseed nicht kennt:
--   (a) dieselbe Woche in ZWEI Organisationen, fuer den Nicht-Leak;
--   (b) zwei veroeffentlichte Versionen mit VOLLSTAENDIGEM Zeitstempelgleichstand,
--       damit ausschliesslich der Id-Tie-Breaker entscheidet;
--   (c) einen Entwurf UEBER einer Veroeffentlichung, fuer die Provenienz.

begin;

-- ---------------------------------------------------------------------------
-- Eigene Beschaeftigte und Baustellen mit GUELTIGEN v4-UUIDs
-- ---------------------------------------------------------------------------
-- Befund aus dem zweiten Harnesslauf: die Antwort wurde vom Server selbst
-- abgelehnt ("Antwort entspricht nicht dem Vertrag"). Ursache war nicht die
-- Fachlogik, sondern die Id-Form.
--
-- `IdSchema` ist `z.uuid()` und prueft Version und Variante. Die Ids aus
-- supabase/seed.sql tragen die Form 00000000-0000-0000-0000-0000004010a1 —
-- Versions-Nibble 0, also KEINE gueltige UUID v4. Sie stehen als employeeId
-- und worksiteId in der Antwort und fallen dort durch.
--
-- Der Harness legt sich deshalb eigene an. Der Befund selbst ist damit NICHT
-- behoben: der Standardseed bleibt vertragswidrig, sobald seine Ids in einer
-- Antwort auftauchen. Er gehoert zu dem Vorgang, der den Seed besitzt.
insert into public.employees (id, org_id, user_id, display_name, active)
values
  ('e11a0001-0001-4001-8001-000000000001', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-00000000aaa1', 'Harness Planerin Alpha', true),
  ('e11b0001-0001-4001-8001-000000000001', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-00000000bbb2', 'Harness Planer Beta', true);

insert into public.worksites (id, org_id, name, activity_count)
values
  ('5117a001-0001-4001-8001-000000000001', '00000000-0000-0000-0000-0000000000a1',
   'Harness Baustelle Alpha', 1),
  ('5117b001-0001-4001-8001-000000000001', '00000000-0000-0000-0000-0000000000b2',
   'Harness Baustelle Beta', 1);

-- ---------------------------------------------------------------------------
-- Alpha, Woche 2026-W40 — erste Version
-- ---------------------------------------------------------------------------
-- `created_at` ausdruecklich gesetzt: der Default waere `now()`, und dann
-- entschiede die Sortierung schon vor dem Id-Tie-Breaker. Nachweis 8 pruefte
-- damit nichts.
insert into public.plan_versions (id, org_id, week_key, created_at)
values ('aaaa1111-1111-4111-8111-111111111111',
        '00000000-0000-0000-0000-0000000000a1', '2026-W40', '2026-09-20T08:00:00Z');

insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values ('a5510001-0001-4001-8001-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        'aaaa1111-1111-4111-8111-111111111111',
        'e11a0001-0001-4001-8001-000000000001', '5117a001-0001-4001-8001-000000000001',
        '2026-09-28T06:00:00Z', '2026-09-28T10:00:00Z');

-- Jetzt erst veroeffentlichen. Der Trigger stempelt die Zuweisung mit.
update public.plan_versions
   set published_at = '2026-09-25T09:00:00Z',
       published_by = '00000000-0000-0000-0000-00000000aaa1'
 where id = 'aaaa1111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- Alpha, zweite Version — identischer Zeitstempel in BEIDEN Spalten
-- ---------------------------------------------------------------------------
-- Erst jetzt moeglich: `plan_versions_one_draft_per_week` laesst hoechstens
-- EINEN Entwurf je Woche zu, und der erste ist gerade veroeffentlicht worden.
insert into public.plan_versions (id, org_id, week_key, created_at)
values ('aaaa2222-2222-4222-8222-222222222222',
        '00000000-0000-0000-0000-0000000000a1', '2026-W40', '2026-09-20T08:00:00Z');

-- Anderer Tag als die erste Zuweisung: sonst griffe der EXCLUDE-Constraint
-- beim Veroeffentlichen, und die Fixture pruefte den Ueberlappungsschutz
-- statt den Tie-Breaker.
insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values ('a5510002-0002-4002-8002-000000000002',
        '00000000-0000-0000-0000-0000000000a1',
        'aaaa2222-2222-4222-8222-222222222222',
        'e11a0001-0001-4001-8001-000000000001', '5117a001-0001-4001-8001-000000000001',
        '2026-09-29T06:00:00Z', '2026-09-29T10:00:00Z');

update public.plan_versions
   set published_at = '2026-09-25T09:00:00Z',
       published_by = '00000000-0000-0000-0000-00000000aaa1'
 where id = 'aaaa2222-2222-4222-8222-222222222222';

-- ---------------------------------------------------------------------------
-- Alpha, Entwurf UEBER den Veroeffentlichungen — der ANGEZEIGTE Stand
-- ---------------------------------------------------------------------------
insert into public.plan_versions (id, org_id, week_key, created_at)
values ('aaaa3333-3333-4333-8333-333333333333',
        '00000000-0000-0000-0000-0000000000a1', '2026-W40', '2026-09-21T08:00:00Z');

insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values ('a5510003-0003-4003-8003-000000000003',
        '00000000-0000-0000-0000-0000000000a1',
        'aaaa3333-3333-4333-8333-333333333333',
        'e11a0001-0001-4001-8001-000000000001', '5117a001-0001-4001-8001-000000000001',
        '2026-09-30T06:00:00Z', '2026-09-30T10:00:00Z');

-- ---------------------------------------------------------------------------
-- (a) Beta, DIESELBE Woche
-- ---------------------------------------------------------------------------
-- Existiert nachweislich in PostgreSQL und darf fuer Subjekt A weder in der
-- HTTP-Antwort noch im DOM auftauchen.
insert into public.plan_versions (id, org_id, week_key, created_at)
values ('bbbb1111-1111-4111-8111-111111111111',
        '00000000-0000-0000-0000-0000000000b2', '2026-W40', '2026-09-20T08:00:00Z');

insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values ('b5510001-0001-4001-8001-000000000001',
        '00000000-0000-0000-0000-0000000000b2',
        'bbbb1111-1111-4111-8111-111111111111',
        'e11b0001-0001-4001-8001-000000000001', '5117b001-0001-4001-8001-000000000001',
        '2026-09-28T06:00:00Z', '2026-09-28T10:00:00Z');

update public.plan_versions
   set published_at = '2026-09-25T09:00:00Z',
       published_by = '00000000-0000-0000-0000-00000000bbb2'
 where id = 'bbbb1111-1111-4111-8111-111111111111';

commit;
