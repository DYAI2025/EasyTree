-- pgTAP: ISO-Wochenschluessel jahresabhaengig (EYT-88).
--
-- Dieselben Testvektoren wie
-- `packages/contracts/test/iso-week-key.test.ts`. Das ist der Kern der
-- Aufgabe: Vertrag und Datenbank duerfen nicht unterschiedliche Jahre als
-- 53-Wochen-Jahre ansehen. Weicht eine Seite ab, faellt es hier auf und nicht
-- erst an einer Planversion, die keiner Woche zuzuordnen ist.
--
-- Geprueft wird beides:
--   1. die Funktion `app.is_valid_iso_week_key` direkt;
--   2. die Constraint auf `public.plan_versions` — eine Funktion, die niemand
--      aufruft, schuetzt nichts.
--
-- Die 53-Wochen-Jahre folgen der Donnerstagsregel: 2020 (1. Januar Mittwoch,
-- Schaltjahr) und 2026 (1. Januar Donnerstag) haben 53; 2021 und 2025 haben 52.

begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- 1. Form
-- ---------------------------------------------------------------------------
select ok(not app.is_valid_iso_week_key('2026W32'), 'ohne Trenner ungueltig');
select ok(not app.is_valid_iso_week_key('26-W32'), 'zweistelliges Jahr ungueltig');
select ok(not app.is_valid_iso_week_key('2026-32'), 'ohne W ungueltig');
select ok(not app.is_valid_iso_week_key('2026-w32'), 'kleines w ungueltig');
select ok(not app.is_valid_iso_week_key('2026-W3'), 'einstellige Woche ungueltig');
select ok(not app.is_valid_iso_week_key(''), 'leer ungueltig');

-- ---------------------------------------------------------------------------
-- 2. Wochenbereich
-- ---------------------------------------------------------------------------
select ok(not app.is_valid_iso_week_key('2026-W00'), 'W00 ungueltig');
select ok(not app.is_valid_iso_week_key('2026-W54'), 'W54 ungueltig');
select ok(not app.is_valid_iso_week_key('2026-W99'), 'W99 ungueltig');
select ok(app.is_valid_iso_week_key('2026-W01'), 'W01 gueltig');
select ok(app.is_valid_iso_week_key('2026-W32'), 'W32 gueltig');
select ok(app.is_valid_iso_week_key('2026-W52'), 'W52 gueltig');

-- ---------------------------------------------------------------------------
-- 3. Jahresabhaengige 53. Woche — der eigentliche Befund
-- ---------------------------------------------------------------------------
select ok(app.is_valid_iso_week_key('2020-W53'), '2020 hat 53 Wochen');
select ok(app.is_valid_iso_week_key('2026-W53'), '2026 hat 53 Wochen');
select ok(not app.is_valid_iso_week_key('2021-W53'), '2021 hat nur 52 Wochen');
select ok(not app.is_valid_iso_week_key('2025-W53'), '2025 hat nur 52 Wochen');

-- ---------------------------------------------------------------------------
-- 4. Jahresgrenze
-- ---------------------------------------------------------------------------
-- PostgreSQL kennt kein Jahr 0; der Vertrag lehnt es deshalb ebenfalls ab.
-- Ohne diesen Fall traegen beide Seiten eine stille Divergenz.
select ok(not app.is_valid_iso_week_key('0000-W01'), 'Jahr 0000 ungueltig (kein Jahr null)');
select ok(app.is_valid_iso_week_key('0099-W01'), 'fuehrend nullgefuelltes Jahr gueltig');

-- ---------------------------------------------------------------------------
-- 5. Determinismus
-- ---------------------------------------------------------------------------
-- Die Funktion darf nicht von der Session abhaengen. Waere sie es, koennten
-- zwei Verbindungen dieselbe Woche verschieden bewerten.
set local timezone = 'Pacific/Kiritimati';
select ok(
  app.is_valid_iso_week_key('2026-W53') and not app.is_valid_iso_week_key('2025-W53'),
  'Ergebnis haengt nicht von der Session-Zeitzone ab'
);
set local timezone = 'UTC';

select is(
  (select provolatile from pg_proc where proname = 'is_valid_iso_week_key'),
  'i'::"char",
  'Funktion ist als IMMUTABLE deklariert — Voraussetzung fuer den CHECK'
);

-- ---------------------------------------------------------------------------
-- 6. Die Constraint greift wirklich
-- ---------------------------------------------------------------------------
-- Eine Funktion ohne Aufrufer schuetzt nichts. Diese beiden Faelle sind der
-- Unterschied zwischen "die Regel existiert" und "die Regel gilt".
select has_check('public', 'plan_versions', 'plan_versions hat eine Check-Constraint');

select throws_ok(
  $$insert into public.plan_versions (id, org_id, week_key)
    values ('00000000-0000-4000-8000-00000088e001',
            '00000000-0000-4000-8000-0000000000a1',
            '2025-W53')$$,
  '23514',
  null,
  'eine 53. Woche in einem 52-Wochen-Jahr wird von der Datenbank abgelehnt'
);

select * from finish();
rollback;
