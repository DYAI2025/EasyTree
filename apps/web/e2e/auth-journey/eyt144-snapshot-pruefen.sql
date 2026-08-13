-- Der Kosten-Snapshot der Reise, IN PostgreSQL nachgezaehlt (EYT-144).
--
-- ## Warum das noetig ist
--
-- Die Oberflaeche zeigt, was der Server geantwortet hat. Ob dieselben Werte
-- auch GESPEICHERT sind, sagt sie nicht — ein Server, der die Antwort aus der
-- Anfrage baute, saehe im Browser identisch aus. Diese Datei liest die Zeilen
-- selbst und vergleicht sie mit dem, was die Reise gesehen hat.
--
-- ## Warum sie zweimal laeuft
--
-- Beim zweiten Aufruf (nach Reload und zweitem Browserkontext) ist `n_kopf = 1`
-- die eigentliche Aussage: Ansehen erzeugt nichts. Ohne diesen zweiten Lauf
-- bewiese die Reise nur, dass EIN Snapshot entstand, nicht dass es bei einem
-- blieb.
--
-- ## Warum die Erwartung durch eine temporaere Tabelle geht
--
-- psql ersetzt `:'name'` INNERHALB eines dollar-quotierten Blocks nicht — der
-- Block liefe mit dem Literaltext und scheiterte mit einem irrefuehrenden
-- Syntaxfehler. Dieselbe Falle ist in `fixtures.sql` notiert; dort half eine
-- Konstante, hier geht es nicht, weil die Snapshot-Id erst zur Laufzeit
-- entsteht. Also wird sie ausserhalb des Blocks materialisiert.

\set ON_ERROR_STOP on

create temporary table eyt144_erwartung as
select :'snapshot_id'::uuid as snapshot_id,
       :'summe'::bigint as summe,
       :'positionen'::int as positionen,
       :'woche'::text as woche;

do $$
declare
  e record;
  n_kopf int;
  n_treffer int;
  ist_summe bigint;
  ist_positionen int;
  ist_woche text;
  ist_regel text;
  ist_waehrung text;
  ist_filter uuid;
  summe_positionen bigint;
begin
  select * into e from eyt144_erwartung;

  -- Alle Snapshots DIESER Organisation, nicht nur der erwartete: ein zweiter
  -- faellt nur auf, wenn man ihn zaehlt.
  select count(*) into n_kopf from public.cost_snapshots
    where org_id = '00000000-0000-4000-8000-00000000e201';

  select count(*) into n_treffer from public.cost_snapshots
    where org_id = '00000000-0000-4000-8000-00000000e201' and id = e.snapshot_id;

  select total_minor_units, week_key, rule_version, currency, worksite_id
    into ist_summe, ist_woche, ist_regel, ist_waehrung, ist_filter
    from public.cost_snapshots
    where org_id = '00000000-0000-4000-8000-00000000e201' and id = e.snapshot_id;

  select count(*), coalesce(sum(amount_minor_units), 0)
    into ist_positionen, summe_positionen
    from public.cost_snapshot_positions
    where org_id = '00000000-0000-4000-8000-00000000e201' and snapshot_id = e.snapshot_id;

  if n_kopf <> 1 or n_treffer <> 1 then
    raise exception
      'EYT-144: erwartet war GENAU EIN Snapshot mit der Id %, gezaehlt: koepfe=% treffer=%',
      e.snapshot_id, n_kopf, n_treffer;
  end if;

  if ist_summe <> e.summe or ist_positionen <> e.positionen or ist_woche <> e.woche then
    raise exception
      'EYT-144: gespeicherter Stand weicht ab — summe=% (erwartet %) positionen=% (erwartet %) woche=% (erwartet %)',
      ist_summe, e.summe, ist_positionen, e.positionen, ist_woche, e.woche;
  end if;

  -- Die Herkunftsangaben. Ohne sie waere spaeter nicht entscheidbar, nach
  -- welcher Regel gerechnet wurde.
  if ist_regel <> 'personnel-plan-cost-v1' or ist_waehrung <> 'EUR' then
    raise exception 'EYT-144: Herkunft unvollstaendig — regel=% waehrung=%', ist_regel, ist_waehrung;
  end if;

  -- Diese Scheibe erzeugt ausdruecklich OHNE Baustellenfilter.
  if ist_filter is not null then
    raise exception 'EYT-144: unerwarteter Baustellenfilter %', ist_filter;
  end if;

  raise notice
    '[eyt144-snapshot] koepfe=% id=% summe=% positionen=% positionssumme=% woche=% regel=% waehrung=% filter=null',
    n_kopf, e.snapshot_id, ist_summe, ist_positionen, summe_positionen, ist_woche,
    ist_regel, ist_waehrung;
end
$$;

drop table eyt144_erwartung;
