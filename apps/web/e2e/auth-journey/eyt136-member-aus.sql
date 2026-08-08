-- Rueckgabe der Leihgabe aus `eyt136-member-an.sql` (EYT-136, Schritt 9c5).
--
-- Laeuft auf JEDEM Weg — auch nachdem der Angriffsnachweis geworfen hat. Der
-- Test faengt seinen eigenen Fehler dafuer ein, statt ihn durchzureichen; ein
-- `throw` im `finally` verwuerfe ihn (`no-unsafe-finally`).
--
-- ## Warum dieses Skript ohne das andere auskommen muss
--
-- Wirft `eyt136-member-an.sql` mitten in seiner Nachbedingung, ist trotzdem
-- offen, ob die Zeile steht. Dieses Skript loescht deshalb unbedingt und
-- verlangt danach NULL — es ist idempotent und setzt nichts voraus.
--
-- ## Warum die Nachkontrolle hier steht und nicht im Teardown
--
-- `teardown.sql` loescht ALLE Mitgliedschaften der Reiseorganisation und zaehlt
-- ERST DANACH. Eine ueberlebende Leihgabe wuerde dort also aufgeraeumt, nicht
-- bemerkt — `restzeilen=0` bliebe wahr. Die Rueckgabe muss sich deshalb selbst
-- belegen: der Block unten ist der PRIMAERE Waechter, und er greift im selben
-- Schritt, in dem die Leihgabe entstand.
--
-- Die zweite, unabhaengige Gegenprobe ist der nachfolgende Nachweis „Benutzer B
-- ist angemeldet, aber ohne Mitgliedschaft ausgesperrt" (leere
-- Organisationsliste in Bs Sitzung). Sie ist ausdruecklich SEKUNDAER: die
-- Reisedatei laeuft im `serial`-Modus, ein roter Hauptnachweis laesst jenen
-- Fall also AUSFALLEN statt ihn rot zu faerben. Er deckt damit genau den Fall
-- „Leihgabe ueberlebt, waehrend sonst alles gruen ist".

\set ON_ERROR_STOP on

select set_config('easytree.eyt136_b', :'benutzer_b', false);

begin;

-- Nur die eigene Zeile, ueber ihre feste Id. Ein `delete … where user_id = …`
-- traefe auch eine Mitgliedschaft, die B aus einem anderen Grund haette.
delete from public.memberships
  where id = '00000000-0000-4000-8000-0000e136e901';

commit;

begin;

do $$
declare
  c_org constant uuid := '00000000-0000-4000-8000-00000000e201';
  c_leihe constant uuid := '00000000-0000-4000-8000-0000e136e901';
  v_b uuid := current_setting('easytree.eyt136_b')::uuid;
  n_leihe int;
  n_b_gesamt int;
  n_org_gesamt int;
  n_owner int;
begin
  select count(*) into n_leihe from public.memberships where id = c_leihe;
  -- Nicht nur „die Zeile ist fort", sondern „B ist wieder mitgliedslos".
  select count(*) into n_b_gesamt from public.memberships where user_id = v_b;
  -- Und A ist noch da: geloescht wurde die Leihgabe, nicht der Reisende.
  select count(*) into n_org_gesamt from public.memberships where org_id = c_org;
  select count(*) into n_owner from public.memberships
    where org_id = c_org and role = 'owner' and active;

  if n_leihe <> 0 or n_b_gesamt <> 0 or n_org_gesamt <> 1 or n_owner <> 1 then
    raise exception
      'EYT-136-Leihgabe nicht zurueckgegeben: leihe=% b_gesamt=% org_gesamt=% owner_aktiv=% (erwartet 0/0/1/1)',
      n_leihe, n_b_gesamt, n_org_gesamt, n_owner;
  end if;

  raise notice '[eyt136-member-aus] leihe=% b_gesamt=% org_gesamt=% owner_aktiv=%',
    n_leihe, n_b_gesamt, n_org_gesamt, n_owner;
end
$$;

commit;
