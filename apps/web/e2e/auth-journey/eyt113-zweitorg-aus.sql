-- Rueckgabe der Leihgabe aus `eyt113-zweitorg-an.sql` (EYT-113 Inkrement 2).
--
-- Laeuft auf JEDEM Weg — auch nachdem der Mehr-Org-Nachweis geworfen hat. Der
-- Test faengt seinen eigenen Fehler dafuer ein, statt ihn durchzureichen; ein
-- `throw` im `finally` verwuerfe ihn (`no-unsafe-finally`).
--
-- ## Warum dieses Skript ohne das andere auskommen muss
--
-- Wirft `eyt113-zweitorg-an.sql` mitten in seiner Nachbedingung, ist trotzdem
-- offen, ob die Zeilen stehen. Dieses Skript loescht deshalb unbedingt und
-- verlangt danach NULL — es ist idempotent und setzt nichts voraus.
--
-- ## Warum die Nachkontrolle hier steht und nicht im Teardown
--
-- `teardown.sql` kennt die Zweitorganisation nicht: es loescht die Zeilen der
-- REISEorganisation und die beiden Benutzer. Das Loeschen der Benutzer wuerde
-- die geliehene Mitgliedschaft zwar kaskadieren, die Organisation `…e213`
-- bliebe aber stehen — unsichtbar fuer jede dortige Zaehlung. Die Rueckgabe
-- muss sich deshalb selbst belegen; der Block unten ist der PRIMAERE
-- Waechter, und er greift im selben Nachweis, in dem die Leihgabe entstand.
--
-- Die zweite, unabhaengige Gegenprobe ist der Schritt 5 der Hauptreise
-- ("genau eine Organisation") — aber erst im NAECHSTEN Gesamtlauf, denn die
-- Hauptreise laeuft VOR diesem Nachweis. Sie deckt damit genau den Fall
-- "Leihgabe ueberlebt, waehrend dieser Lauf sonst gruen endet".

\set ON_ERROR_STOP on

select set_config('easytree.eyt113_a', :'benutzer_a', false);

begin;

-- Nur die eigenen Zeilen, ueber ihre festen Ids — erst die Mitgliedschaft,
-- dann die Organisation (die FK-Kaskade der Organisation traefe die
-- Mitgliedschaft zwar mit, aber eine ausdrueckliche Reihenfolge liest sich
-- als das, was sie ist: zwei Leihgaben, zwei Rueckgaben).
delete from public.memberships
  where id = '00000000-0000-4000-8000-0000e213a001';

delete from public.organizations
  where id = '00000000-0000-4000-8000-00000000e213';

commit;

begin;

do $$
declare
  c_reiseorg constant uuid := '00000000-0000-4000-8000-00000000e201';
  c_zweitorg constant uuid := '00000000-0000-4000-8000-00000000e213';
  c_leihe constant uuid := '00000000-0000-4000-8000-0000e213a001';
  v_a uuid := current_setting('easytree.eyt113_a')::uuid;
  n_leihe int;
  n_org int;
  n_a_aktiv int;
  n_owner int;
begin
  select count(*) into n_leihe from public.memberships where id = c_leihe;
  select count(*) into n_org from public.organizations where id = c_zweitorg;
  -- Nicht nur "die Zeilen sind fort", sondern "A ist wieder Ein-Org-Reisender".
  select count(*) into n_a_aktiv from public.memberships
    where user_id = v_a and active;
  -- Und die Owner-Zeile ist noch da: geloescht wurde die Leihgabe, nicht der
  -- Reisende.
  select count(*) into n_owner from public.memberships
    where org_id = c_reiseorg and user_id = v_a and role = 'owner' and active;

  if n_leihe <> 0 or n_org <> 0 or n_a_aktiv <> 1 or n_owner <> 1 then
    raise exception
      'EYT-113-Leihgabe nicht zurueckgegeben: leihe=% org=% a_aktiv=% owner_aktiv=% (erwartet 0/0/1/1)',
      n_leihe, n_org, n_a_aktiv, n_owner;
  end if;

  raise notice '[eyt113-zweitorg-aus] leihe=% org=% a_aktiv=% owner_aktiv=%',
    n_leihe, n_org, n_a_aktiv, n_owner;
end
$$;

commit;
