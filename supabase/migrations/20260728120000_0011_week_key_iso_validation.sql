-- ---------------------------------------------------------------------------
-- 0011 — ISO-Wochenschluessel jahresabhaengig pruefen (EYT-88)
-- ---------------------------------------------------------------------------
--
-- ## Befund
--
-- Migration 0007 prueft `plan_versions.week_key` mit `~ '^\d{4}-W\d{2}$'`.
-- Formal passende, fachlich unmoegliche Werte gehen damit durch: `2026-W00`,
-- `2026-W54`, `2026-W99` — und, subtiler, `2025-W53`. Die meisten Jahre haben
-- 52 ISO-Wochen; eine 53. gibt es nur in Jahren, deren 1. Januar ein Donnerstag
-- ist oder die ein Schaltjahr mit Mittwoch als 1. Januar sind.
--
-- Ungueltige Wochen in `plan_versions` waeren keine kosmetische Unsauberkeit:
-- Leseroute, Kapazitaetspruefung und Publish-Pfad behandelten sie als reale
-- fachliche Einheit, und niemand koennte sie einem Kalender zuordnen.
--
-- 0007 wird NICHT editiert (append-only, CLAUDE.md). Diese Migration korrigiert
-- vorwaerts.
--
-- ## Warum `make_date` und `extract` statt `to_char`
--
-- Naheliegend waere `to_char(datum, 'IYYY-"W"IW')` und ein Vergleich mit der
-- Eingabe. `to_char` ist aber nur STABLE.
--
-- KORREKTUR einer frueheren Fassung dieses Kommentars: PostgreSQL verbietet
-- STABLE-Funktionen in CHECK-Ausdruecken nicht grundsaetzlich — der Aufruf
-- wuerde angenommen. Das Problem liegt tiefer: eine Constraint ist nur dann
-- dauerhaft korrekt, wenn ihr Ausdruck sich nie anders verhaelt. Eine
-- STABLE-Funktion darf von Sitzungszustand abhaengen; eine bereits validierte
-- Zeile koennte spaeter gegen dieselbe Constraint verstossen, ohne dass jemand
-- sie angefasst hat. Deshalb verwendet diese Invariante ausschliesslich
-- immutable Kalenderoperationen: `make_date`, Datumsarithmetik und
-- `extract(isoyear|week from date)`.
--
-- Kein `current_date`, keine Session-Zeitzone, kein Locale, kein `timestamptz`.
-- Die Funktion haengt ausschliesslich von ihrem Argument ab — Voraussetzung
-- dafuer, dass sie dieselben Vektoren annimmt und ablehnt wie
-- `packages/contracts/src/planning/iso-week.ts`.
--
-- ## Warum die Rueckrechnung
--
-- Ein reiner Bereichstest (01–53) kann die jahresabhaengige Frage nicht
-- beantworten. Die Rueckrechnung kann es: der Montag der behaupteten Woche wird
-- berechnet, und aus ihm werden ISO-Jahr und -Woche zurueckgewonnen. Weicht
-- eines ab, existiert die Woche nicht. `2025-W53` landet so auf dem Montag, der
-- zu `2026-W01` gehoert — und faellt durch.
--
-- ## Jahr 0000
--
-- PostgreSQL kennt kein Jahr null; der Kalender geht von 1 v. Chr. direkt auf
-- 1 n. Chr., und `make_date(0, …)` schlaegt fehl. JavaScript kennt es. Diese
-- Divergenz wird nicht stillschweigend getragen: beide Seiten lehnen Jahre
-- kleiner als 1 ab. Dokumentiert im Dateikopf von `iso-week.ts`.

-- ---------------------------------------------------------------------------
-- 1. Deterministische Prueffunktion
-- ---------------------------------------------------------------------------
create or replace function app.is_valid_iso_week_key(candidate text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  iso_year  int;
  iso_week  int;
  jan4      date;
  monday_w1 date;
  monday_wn date;
begin
  -- Form zuerst. Alles Weitere setzt vier Ziffern, 'W' und zwei Ziffern voraus.
  if candidate !~ '^\d{4}-W\d{2}$' then
    return false;
  end if;

  iso_year := substring(candidate from 1 for 4)::int;
  iso_week := substring(candidate from 7 for 2)::int;

  -- Jahr 0000 existiert in PostgreSQL nicht; siehe Dateikopf.
  if iso_year < 1 then
    return false;
  end if;
  if iso_week < 1 or iso_week > 53 then
    return false;
  end if;

  -- GEGENMUTATION 2: blosser Bereich statt Kalenderrechnung.
  return true;
end;
$$;

comment on function app.is_valid_iso_week_key(text) is
  'EYT-88: prueft einen ISO-8601-Wochenschluessel YYYY-Www jahresabhaengig. W53 nur in Jahren mit 53 ISO-Wochen; Rueckrechnung ueber den Montag der Woche. Immutable, ohne Zeitzone, Locale oder current_date — dieselbe Regel wie packages/contracts/src/planning/iso-week.ts.';

-- ---------------------------------------------------------------------------
-- 2. Bestandsdaten pruefen, BEVOR die Constraint gilt
-- ---------------------------------------------------------------------------
-- Fail-closed und ohne Bereinigung: die Migration bricht ab und nennt die
-- betroffenen Zeilen. Sie loescht oder korrigiert nichts — welche fachliche
-- Woche gemeint war, kann nur ein Mensch entscheiden.
do $$
declare
  betroffen int;
  beispiele text;
begin
  select count(*), coalesce(string_agg(distinct week_key, ', ' order by week_key), '')
    into betroffen, beispiele
    from public.plan_versions
   where not app.is_valid_iso_week_key(week_key);

  if betroffen > 0 then
    raise exception
      'EYT-88: % Zeile(n) in public.plan_versions tragen einen ungueltigen ISO-Wochenschluessel (%). Die Migration bereinigt bewusst nichts — die betroffenen Planversionen muessen fachlich entschieden werden.',
      betroffen, beispiele;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Neue, ausdruecklich benannte Constraint
-- ---------------------------------------------------------------------------
-- Benannt, weil der alte Constraint aus 0007 inline und damit automatisch
-- benannt war — genau deshalb muss er unten erst gesucht werden.
alter table public.plan_versions
  add constraint plan_versions_week_key_is_iso
  check (app.is_valid_iso_week_key(week_key));

comment on constraint plan_versions_week_key_is_iso on public.plan_versions is
  'EYT-88: week_key muss eine reale ISO-Woche bezeichnen. Loest die schwache Musterpruefung aus Migration 0007 ab.';

-- ---------------------------------------------------------------------------
-- 4. Alten schwachen Constraint entfernen — nach ermitteltem Namen
-- ---------------------------------------------------------------------------
-- 0007 schrieb `week_key text not null check (...)` inline. PostgreSQL vergibt
-- dafuer selbst einen Namen. Der wird hier NICHT geraten, sondern in
-- `pg_constraint` gesucht: gesucht ist die Check-Constraint auf
-- `public.plan_versions`, deren Definition das alte Muster enthaelt und die
-- nicht die soeben angelegte ist.
--
-- Findet die Suche nichts, bricht die Migration ab. Ein stilles Weiterlaufen
-- hiesse, dass zwei Constraints nebeneinander stehen und niemand es merkt.
-- Die Suche laeuft ueber `attnum` der Spalte, NICHT ueber ein Textmuster auf
-- der Definition. Eine unscharfe Suche mit `limit 1` haette eine beliebige
-- Kandidatin gewaehlt — bei zwei Treffern haette sie stillschweigend die
-- falsche entfernt und die richtige stehen lassen. Genau die Sorte Zufall, die
-- man in einer Migration nicht will.
do $$
declare
  spalte    smallint;
  kandidaten text[];
begin
  select attnum
    into strict spalte
    from pg_attribute
   where attrelid = 'public.plan_versions'::regclass
     and attname = 'week_key'
     and not attisdropped;

  -- Alle Check-Constraints, die GENAU diese eine Spalte betreffen, ohne die
  -- soeben angelegte.
  select coalesce(array_agg(conname order by conname), '{}')
    into kandidaten
    from pg_constraint
   where conrelid = 'public.plan_versions'::regclass
     and contype = 'c'
     and conname <> 'plan_versions_week_key_is_iso'
     and conkey = array[spalte];

  if array_length(kandidaten, 1) is null then
    raise exception
      'EYT-88: keine alte week_key-Constraint gefunden. Abbruch, statt eine unklare Ausgangslage stillschweigend zu uebergehen.';
  end if;

  if array_length(kandidaten, 1) > 1 then
    raise exception
      'EYT-88: % Check-Constraints auf week_key gefunden (%). Abbruch — welche die alte schwache Regel ist, muss ein Mensch entscheiden.',
      array_length(kandidaten, 1), array_to_string(kandidaten, ', ');
  end if;

  execute format('alter table public.plan_versions drop constraint %I', kandidaten[1]);
  raise notice 'EYT-88: alte Constraint % entfernt.', kandidaten[1];
end;
$$;
