-- Nachweis 1: die Datensaetze existieren wirklich in PostgreSQL (EYT-50).
--
-- Direkt gegen die Datenbank, nicht ueber die API — sonst waere "Beta ist
-- unsichtbar" auch dann gruen, wenn Beta gar nicht angelegt wurde.
--
-- ## Warum RAISE EXCEPTION und kein select mit Text
--
-- Die erste Fassung gab 'SEED KAPUTT' als SPALTENWERT aus. psql beendet sich
-- dabei mit 0, der CI-Schritt waere gruen geblieben, und der Nachweis haette
-- eine kaputte Fixture stillschweigend durchgelassen. Ein Text, den niemand
-- liest, ist keine Zusicherung.
--
-- Laeuft als `postgres` (BYPASSRLS) und sieht deshalb beide Organisationen.
\set ON_ERROR_STOP on

do $$
declare
  alpha_zuweisungen int;
  beta_zuweisungen int;
  gleichstand int;
  beta_bekannt int;
begin
  select
    count(*) filter (where org_id = '00000000-0000-4000-8000-0000000000a1'),
    count(*) filter (where org_id = '00000000-0000-4000-8000-0000000000b2')
    into alpha_zuweisungen, beta_zuweisungen
  from public.assignments
  where starts_at_utc >= '2026-09-28T00:00:00Z'
    and starts_at_utc <  '2026-10-01T00:00:00Z';

  if alpha_zuweisungen <> 3 then
    raise exception 'Fixture kaputt: erwartet 3 Alpha-Zuweisungen, gefunden %', alpha_zuweisungen;
  end if;
  if beta_zuweisungen <> 1 then
    raise exception 'Fixture kaputt: erwartet 1 Beta-Zuweisung, gefunden %', beta_zuweisungen;
  end if;

  -- Ohne den VOLLSTAENDIGEN Zeitstempelgleichstand prueft Nachweis 8 den
  -- Id-Tie-Breaker gar nicht: die Sortierung haette schon vorher entschieden.
  select count(*) into gleichstand
  from public.plan_versions
  where org_id = '00000000-0000-4000-8000-0000000000a1'
    and week_key = '2026-W40'
    and published_at = '2026-09-25T09:00:00Z'
    and created_at   = '2026-09-20T08:00:00Z';

  if gleichstand <> 2 then
    raise exception
      'Fixture kaputt: erwartet 2 veroeffentlichte Alpha-Versionen mit identischem published_at UND created_at, gefunden %',
      gleichstand;
  end if;

  -- Der namentliche Datensatz, der spaeter weder in Antwort noch DOM
  -- auftauchen darf.
  select count(*) into beta_bekannt
  from public.assignments
  where id = 'b5510001-0001-4001-8001-000000000001'
    and org_id = '00000000-0000-4000-8000-0000000000b2';

  if beta_bekannt <> 1 then
    raise exception 'Fixture kaputt: Beta-Zuweisung b5510001 fehlt';
  end if;

  raise notice 'Fixture OK: 3 Alpha, 1 Beta, 2 Versionen im Gleichstand';
end
$$;
