-- Leihgabe: Reisender B bekommt fuer die Dauer EINES Nachweises eine aktive
-- `member`-Mitgliedschaft in der Reiseorganisation (EYT-136, Schritt 9c5).
--
-- ## Warum geliehen und nicht angelegt
--
-- Der Angriffsnachweis braucht einen normal angemeldeten Benutzer MIT
-- Mitgliedschaft, aber OHNE `planning.write`. Eine neue Identitaet dafuer
-- braeuchte eine Zeile in `auth.users`; die legt ausschliesslich GoTrue an, und
-- der Product Owner hat den direkten Schreibzugriff darauf fuer diesen Slice
-- ausgeschlossen (Entscheidung 08.08.2026). Reisender B existiert bereits —
-- ueber denselben oeffentlichen Signup wie A — und hat bis hierher KEINE
-- Mitgliedschaft. Dieses Skript fuegt genau eine hinzu,
-- `eyt136-member-aus.sql` nimmt sie unmittelbar danach wieder zurueck.
--
-- ## Warum das eng bleiben MUSS
--
-- Bs Mitgliedslosigkeit ist der ganze Inhalt des zweiten Nachweises dieser
-- Reise („Benutzer B ist angemeldet, aber ohne Mitgliedschaft ausgesperrt").
-- Ueberlebte die Leihgabe den Schritt, wuerde jener Nachweis rot — er ist damit
-- die Gegenprobe darauf, dass die Rueckgabe wirklich stattgefunden hat, und er
-- laeuft nach dem Hauptnachweis (Datei-Reihenfolge, `workers: 1`,
-- `fullyParallel: false`).
--
-- ## psql-Variablen und dollar-quotierte Bloecke
--
-- psql ersetzt `:'name'` INNERHALB eines dollar-quotierten Blocks NICHT (siehe
-- fixtures.sql). Die beiden Benutzer-Ids reisen deshalb als Sitzungsparameter
-- in den Nachbedingungsblock statt als Literaltext, der dort mit einem
-- irrefuehrenden Syntaxfehler endete.

\set ON_ERROR_STOP on

select set_config('easytree.eyt136_a', :'benutzer_a', false);
select set_config('easytree.eyt136_b', :'benutzer_b', false);

begin;

-- Bewusst OHNE `on conflict`: `memberships` traegt `unique (org_id, user_id)`
-- (Migration 0002). Existiert hier schon eine Zeile fuer B, ist das der Rest
-- eines abgebrochenen Laufs — und der soll laut auffallen, statt still
-- ueberschrieben zu werden.
--
-- Die Id ist testspezifisch und verschieden von der Leihgabe der db-gates-Suite
-- (`…-0000e136b001` in apps/api/test/planning-write.integration.test.ts): zwei
-- Laeufe, zwei Zeilen, kein gemeinsamer Fundort, den man versehentlich
-- mitloescht.
insert into public.memberships (id, org_id, user_id, role, active)
values ('00000000-0000-4000-8000-0000e136e901',
        '00000000-0000-4000-8000-00000000e201',
        :'benutzer_b', 'member', true);

commit;

-- Der Nachbedingungsblock laeuft in einer EIGENEN, ausdruecklichen Transaktion.
-- Grund: `set_config(…, true)` wirkt nur innerhalb eines Transaktionsblocks;
-- ausserhalb warnt PostgreSQL und der Wert bleibt wirkungslos. Ohne die Klammer
-- braeche die `has_permission`-Sonde unten still zusammen und meldete fuer
-- BEIDE Reisenden `false` — der Nachweis waere gruen und falsch.
begin;

do $$
declare
  c_org constant uuid := '00000000-0000-4000-8000-00000000e201';
  c_leihe constant uuid := '00000000-0000-4000-8000-0000e136e901';
  v_a uuid := current_setting('easytree.eyt136_a')::uuid;
  v_b uuid := current_setting('easytree.eyt136_b')::uuid;
  n_leihe int;
  n_b_gesamt int;
  n_org_gesamt int;
  n_member_write int;
  n_owner_write int;
  b_write boolean;
  a_write boolean;
begin
  -- Die Leihgabe hat gewirkt: genau die erwartete Zeile, mit der erwarteten
  -- Rolle, aktiv. Eine inaktive Mitgliedschaft oeffnet keinen Mandanten
  -- (`app.user_org_ids()`), und der Angriff scheiterte dann an der
  -- Mandantenbedingung statt am Recht bzw. am Kanal — am falschen Riegel.
  select count(*) into n_leihe from public.memberships
    where id = c_leihe and org_id = c_org and user_id = v_b
      and role = 'member' and active;

  -- B hat GENAU diese eine Mitgliedschaft, nirgends sonst.
  select count(*) into n_b_gesamt from public.memberships where user_id = v_b;

  -- Und die Organisation hat jetzt zwei: A als owner, B als member. Waere A
  -- dabei verlorengegangen, liefe der Rest der Reise ins Leere.
  select count(*) into n_org_gesamt from public.memberships where org_id = c_org;

  -- --------------------------------------------------------------------
  -- Die PRAEMISSE des ganzen Nachweises
  -- --------------------------------------------------------------------
  -- Bekaeme `member` eines Tages `planning.write`, waere Schritt 9c5 vakuos:
  -- der Angriff scheiterte dann am Recht statt am Kanal, und niemand saehe den
  -- Unterschied. Umgekehrt muss der owner das Recht WIRKLICH tragen, sonst
  -- bewiese Schritt 9c4 nur „wer nichts darf, darf nichts".
  select count(*) into n_member_write from public.role_permissions
    where role = 'member' and permission = 'planning.write';
  select count(*) into n_owner_write from public.role_permissions
    where role = 'owner' and permission = 'planning.write';

  -- Dieselbe Frage noch einmal an die FUNKTION, die die Policy aufruft — nicht
  -- an eine Nachbildung ihres Rumpfes. `request.jwt.claims` ist genau die
  -- Transaktionsvariable, aus der `auth.uid()` liest; `true` macht sie
  -- transaktionslokal, sie endet also mit dem `commit` unten.
  --
  -- Gemessen wird hier ueber die VERWALTUNGSVERBINDUNG, nicht ueber das Token
  -- des Reisenden: `app.has_permission` liegt im Schema `app`, und PostgREST
  -- stellt ausschliesslich `public` und `graphql_public` bereit
  -- (supabase/config.toml) — als RPC ist die Funktion nicht erreichbar. Die
  -- staerkere Form, beide Konjunkte ueber das eigene Token des Reisenden, holt
  -- der Test in 9c4/9c5 nach (`memberships` + `role_permissions`, zusammen
  -- exakt der Rumpf dieser Funktion).
  perform set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
  b_write := app.has_permission(c_org, 'planning.write');
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  a_write := app.has_permission(c_org, 'planning.write');

  if n_leihe <> 1 or n_b_gesamt <> 1 or n_org_gesamt <> 2
     or n_member_write <> 0 or n_owner_write <> 1
     or b_write or not a_write then
    raise exception
      'EYT-136-Leihgabe unbrauchbar: leihe=% b_gesamt=% org_gesamt=% member_write=% owner_write=% b_has_permission=% a_has_permission=% (erwartet 1/1/2/0/1/false/true)',
      n_leihe, n_b_gesamt, n_org_gesamt, n_member_write, n_owner_write, b_write, a_write;
  end if;

  raise notice '[eyt136-member-an] leihe=% b_gesamt=% org_gesamt=% member_planning_write=% owner_planning_write=% b_has_permission=% a_has_permission=%',
    n_leihe, n_b_gesamt, n_org_gesamt, n_member_write, n_owner_write, b_write, a_write;
end
$$;

commit;
