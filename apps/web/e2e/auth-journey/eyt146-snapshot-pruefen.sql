-- Der GEFILTERTE Kosten-Snapshot der Reise, IN PostgreSQL nachgezaehlt (EYT-146).
--
-- ## Was diese Datei behauptet, das der Browser nicht behaupten kann
--
-- Die Oberflaeche zeigt, was der Server geantwortet hat. Ob der Filter
-- tatsaechlich GESPEICHERT wurde — und ob er serverseitig gewirkt hat —, sagt
-- sie nicht. Ein Server, der alle Positionen speicherte und nur die Antwort
-- beschnitte, saehe im Browser identisch aus. Genau diesen Fall schliesst die
-- Zaehlung `n_fremd` aus: sie sucht Positionen der NICHT gewaehlten Baustelle
-- in eben diesem Snapshot.
--
-- ## Warum die Gesamtzahl mitgezaehlt wird
--
-- `n_kopf_gesamt` umfasst ALLE Snapshots der Reiseorganisation, also auch den
-- ungefilterten aus EYT-144. Beim zweiten Aufruf (nach Reload und zweitem
-- Browserkontext) ist das die eigentliche Aussage: Ansehen erzeugt nichts.
-- Ohne diese Zahl bewiese die Reise nur, dass EIN gefilterter Snapshot
-- entstand, nicht dass es bei ihm blieb.
--
-- ## Warum die Erwartung durch eine temporaere Tabelle geht
--
-- psql ersetzt `:'name'` INNERHALB eines dollar-quotierten Blocks nicht — der
-- Block liefe mit dem Literaltext und scheiterte mit einem irrefuehrenden
-- Syntaxfehler. Dieselbe Falle ist in `fixtures.sql` und
-- `eyt144-snapshot-pruefen.sql` notiert.

\set ON_ERROR_STOP on

create temporary table eyt146_erwartung as
select :'snapshot_id'::uuid as snapshot_id,
       :'baustelle'::uuid as baustelle,
       :'fremde_baustelle'::uuid as fremde_baustelle,
       :'summe'::bigint as summe,
       :'positionen'::int as positionen,
       :'woche'::text as woche,
       :'koepfe_gesamt'::int as koepfe_gesamt;

do $$
declare
  e record;
  n_kopf_gesamt int;
  n_treffer int;
  n_fremd int;
  n_andere_baustelle int;
  ist_summe bigint;
  ist_positionen int;
  ist_woche text;
  ist_filter uuid;
  summe_positionen bigint;
begin
  select * into e from eyt146_erwartung;

  select count(*) into n_kopf_gesamt from public.cost_snapshots
    where org_id = '00000000-0000-4000-8000-00000000e201';

  select count(*) into n_treffer from public.cost_snapshots
    where org_id = '00000000-0000-4000-8000-00000000e201' and id = e.snapshot_id;

  select total_minor_units, week_key, worksite_id
    into ist_summe, ist_woche, ist_filter
    from public.cost_snapshots
    where org_id = '00000000-0000-4000-8000-00000000e201' and id = e.snapshot_id;

  select count(*), coalesce(sum(amount_minor_units), 0)
    into ist_positionen, summe_positionen
    from public.cost_snapshot_positions
    where org_id = '00000000-0000-4000-8000-00000000e201' and snapshot_id = e.snapshot_id;

  -- Die Kernaussage des Filters: KEINE Position der anderen Baustelle liegt in
  -- diesem Snapshot. Namentlich gesucht, nicht ueber „alle ausser der
  -- gewaehlten" — die zweite Baustelle ist die, die es wirklich gibt und die
  -- ohne Filter mit gespeichert worden waere.
  select count(*) into n_fremd
    from public.cost_snapshot_positions
    where org_id = '00000000-0000-4000-8000-00000000e201'
      and snapshot_id = e.snapshot_id
      and worksite_id = e.fremde_baustelle;

  -- Und die Gegenprobe ohne Namen: ueberhaupt irgendeine Position, die nicht
  -- zur gewaehlten Baustelle gehoert. Ohne sie bewiese die Zeile darueber nur,
  -- dass GENAU e242 fehlt.
  select count(*) into n_andere_baustelle
    from public.cost_snapshot_positions
    where org_id = '00000000-0000-4000-8000-00000000e201'
      and snapshot_id = e.snapshot_id
      and worksite_id <> e.baustelle;

  if n_treffer <> 1 or n_kopf_gesamt <> e.koepfe_gesamt then
    raise exception
      'EYT-146: erwartet war GENAU EIN Snapshot mit der Id % und % Koepfe insgesamt, gezaehlt: treffer=% koepfe=%',
      e.snapshot_id, e.koepfe_gesamt, n_treffer, n_kopf_gesamt;
  end if;

  -- Der Filter steht IM KOPF. Ohne diese Zeile koennte der Server die
  -- Positionen richtig eingrenzen und den Filter trotzdem als null speichern —
  -- der Snapshot waere dann nicht mehr als gefiltert erkennbar.
  if ist_filter is distinct from e.baustelle then
    raise exception 'EYT-146: gespeicherter Baustellenfilter ist % (erwartet %)',
      ist_filter, e.baustelle;
  end if;

  if n_fremd <> 0 or n_andere_baustelle <> 0 then
    raise exception
      'EYT-146: der gefilterte Snapshot enthaelt fremde Positionen — auf %: %, insgesamt fremd: %',
      e.fremde_baustelle, n_fremd, n_andere_baustelle;
  end if;

  if ist_summe <> e.summe or ist_positionen <> e.positionen or ist_woche <> e.woche then
    raise exception
      'EYT-146: gespeicherter Stand weicht ab — summe=% (erwartet %) positionen=% (erwartet %) woche=% (erwartet %)',
      ist_summe, e.summe, ist_positionen, e.positionen, ist_woche, e.woche;
  end if;

  raise notice
    '[eyt146-snapshot] koepfe_gesamt=% id=% filter=% summe=% positionen=% positionssumme=% woche=% fremde_positionen=%',
    n_kopf_gesamt, e.snapshot_id, ist_filter, ist_summe, ist_positionen,
    summe_positionen, ist_woche, n_andere_baustelle;
end
$$;

drop table eyt146_erwartung;
