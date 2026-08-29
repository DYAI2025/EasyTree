-- Leihgabe: Reisender A bekommt fuer die Dauer EINES Nachweises eine ZWEITE
-- Organisation — als `member` OHNE `costs.read` (EYT-113 Inkrement 2,
-- Mehr-Org-Ladegrenze).
--
-- ## Warum eine zweite Organisation und kein zweiter Benutzer
--
-- Der Kern der PO-Entscheidung vom 29.08.2026 ist, dass die Kosten-Ladegrenze
-- der AUSGEWAEHLTEN Organisation folgt: As Recht in der Reiseorganisation darf
-- nichts gewaehren, solange die Zweitorganisation ausgewaehlt ist. Das laesst
-- sich nur an EINEM Benutzer mit ZWEI Organisationen messen — ein zweiter
-- Benutzer besaesse nie beide Seiten derselben Auswahl. A existiert bereits
-- ueber den oeffentlichen GoTrue-Signup; dieses Skript leiht ihm genau eine
-- Organisation samt Mitgliedschaft, `eyt113-zweitorg-aus.sql` nimmt beides im
-- selben Nachweis wieder zurueck.
--
-- ## Warum das eng bleiben MUSS
--
-- Die Hauptreise (laeuft VORHER, Datei-Reihenfolge, `workers: 1`,
-- `fullyParallel: false`) sichert in Schritt 5 zu, dass A GENAU EINE
-- Organisation hat. Ueberlebte die Leihgabe diesen Nachweis, faerbte der
-- NAECHSTE Gesamtlauf dort rot — die Rueckgabe belegt sich deshalb selbst
-- (Nachbedingung in `eyt113-zweitorg-aus.sql`), und der Praemissenwaechter
-- unten findet Reste eines abgebrochenen Laufs LAUT statt sie zu ueberbauen.
--
-- ## KEINE Plandaten
--
-- Die Zweitorganisation bekommt bewusst weder Planwochen noch Snapshots:
-- veroeffentlichte Wochen sind unloeschbar (auch fuer Superuser, gemessen —
-- `staging-journey-wochen-sind-verbrauchsmaterial`), und der Nachweis braucht
-- nur die MITGLIEDSCHAFT, nicht ihren Inhalt.
--
-- ## psql-Variablen und dollar-quotierte Bloecke
--
-- psql ersetzt `:'name'` INNERHALB eines dollar-quotierten Blocks NICHT
-- (siehe fixtures.sql). Die Benutzer-Id reist deshalb als Sitzungsparameter
-- in die Waechterbloecke statt als Literaltext.

\set ON_ERROR_STOP on

select set_config('easytree.eyt113_a', :'benutzer_a', false);

begin;

-- ---------------------------------------------------------------------------
-- Praemissenwaechter — laufen VOR der Mutation und werfen, statt still
-- weiterzumachen. Wirft der Block, rollt die Transaktion zurueck und NICHTS
-- ist mutiert.
-- ---------------------------------------------------------------------------
do $$
declare
  c_reiseorg constant uuid := '00000000-0000-4000-8000-00000000e201';
  c_zweitorg constant uuid := '00000000-0000-4000-8000-00000000e213';
  c_leihe constant uuid := '00000000-0000-4000-8000-0000e213a001';
  v_a uuid := current_setting('easytree.eyt113_a')::uuid;
  n_a_aktiv int;
  n_a_owner int;
  n_member_read int;
  n_org_rest int;
  n_leihe_rest int;
begin
  -- (1) A hat GENAU EINE aktive Mitgliedschaft — die Owner-Zeile der
  -- Reiseorganisation. Alles andere hiesse: eine fruehere Leihgabe (eyt136
  -- oder diese hier) hat ueberlebt, oder die Fixtur ist nicht die erwartete.
  select count(*) into n_a_aktiv from public.memberships
    where user_id = v_a and active;
  select count(*) into n_a_owner from public.memberships
    where user_id = v_a and org_id = c_reiseorg and role = 'owner' and active;

  -- (2) Die PRAEMISSE des Negativnachweises: `member` traegt KEIN
  -- `costs.read`. Bekaeme `member` das Recht eines Tages, waere die
  -- Forbidden-Messung in der Zweitorganisation vakuos — der Nachweis wuerde
  -- gruen, ohne die Grenze je zu beruehren. Genau wie bei eyt136 faellt das
  -- HIER auf, vor der ersten Messung, nicht danach.
  select count(*) into n_member_read from public.role_permissions
    where role = 'member' and permission = 'costs.read';

  -- (3) Reste eines abgebrochenen Laufs fallen LAUT auf, statt still
  -- ueberschrieben zu werden — bewusst KEIN `on conflict` unten.
  select count(*) into n_org_rest from public.organizations where id = c_zweitorg;
  select count(*) into n_leihe_rest from public.memberships where id = c_leihe;

  if n_a_aktiv <> 1 or n_a_owner <> 1 or n_member_read <> 0
     or n_org_rest <> 0 or n_leihe_rest <> 0 then
    raise exception
      'EYT-113-Leihgabe nicht anwendbar: a_aktiv=% a_owner=% member_costs_read=% org_rest=% leihe_rest=% (erwartet 1/1/0/0/0)',
      n_a_aktiv, n_a_owner, n_member_read, n_org_rest, n_leihe_rest;
  end if;
end
$$;

-- Die Mutation: Zweitorganisation plus member-Mitgliedschaft fuer A. Die Ids
-- sind testspezifisch (`e213`) und kollidieren mit keiner anderen Fixtur —
-- zwei Nachweise, zwei Fundorte, nichts wird versehentlich mitgeloescht.
insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-00000000e213', 'EYT-113 Zweitorganisation');

insert into public.memberships (id, org_id, user_id, role, active)
values ('00000000-0000-4000-8000-0000e213a001',
        '00000000-0000-4000-8000-00000000e213',
        :'benutzer_a', 'member', true);

commit;

-- Der Nachbedingungsblock laeuft in einer EIGENEN, ausdruecklichen
-- Transaktion: `set_config(…, true)` wirkt nur innerhalb eines
-- Transaktionsblocks; ausserhalb warnt PostgreSQL und der Wert bleibt
-- wirkungslos — die `has_permission`-Sonde unten braeche dann still zusammen
-- (Begruendung woertlich in `eyt136-member-an.sql`).
begin;

do $$
declare
  c_reiseorg constant uuid := '00000000-0000-4000-8000-00000000e201';
  c_zweitorg constant uuid := '00000000-0000-4000-8000-00000000e213';
  c_leihe constant uuid := '00000000-0000-4000-8000-0000e213a001';
  v_a uuid := current_setting('easytree.eyt113_a')::uuid;
  n_leihe int;
  n_a_aktiv int;
  a_zweitorg_read boolean;
  a_reiseorg_read boolean;
begin
  -- Die Leihgabe hat gewirkt: genau die erwartete Zeile, mit der erwarteten
  -- Rolle, aktiv. Eine inaktive Mitgliedschaft oeffnete keinen Mandanten
  -- (`app.user_org_ids()`) — die Session naennte die Zweitorganisation dann
  -- gar nicht, und der Nachweis maesse die falsche Grenze.
  select count(*) into n_leihe from public.memberships
    where id = c_leihe and org_id = c_zweitorg and user_id = v_a
      and role = 'member' and active;

  -- A hat jetzt GENAU zwei aktive Mitgliedschaften — den Auswahlfall, den
  -- der Nachweis braucht (erst ab zwei zeigt die Shell den Picker).
  select count(*) into n_a_aktiv from public.memberships
    where user_id = v_a and active;

  -- Dieselbe Frage an die FUNKTION, die die Policies aufrufen — nicht an
  -- eine Nachbildung ihres Rumpfes. Beide Richtungen: A traegt in der
  -- ZWEITorganisation KEIN costs.read (sonst waere die Forbidden-Messung
  -- vakuos), und in der REISEorganisation SEHR WOHL (sonst bewiese der
  -- Positivteil nur "wer nichts darf, darf nichts").
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  a_zweitorg_read := app.has_permission(c_zweitorg, 'costs.read');
  a_reiseorg_read := app.has_permission(c_reiseorg, 'costs.read');

  if n_leihe <> 1 or n_a_aktiv <> 2 or a_zweitorg_read or not a_reiseorg_read then
    raise exception
      'EYT-113-Leihgabe unbrauchbar: leihe=% a_aktiv=% a_zweitorg_costs_read=% a_reiseorg_costs_read=% (erwartet 1/2/false/true)',
      n_leihe, n_a_aktiv, a_zweitorg_read, a_reiseorg_read;
  end if;

  raise notice '[eyt113-zweitorg-an] leihe=% a_aktiv=% a_zweitorg_costs_read=% a_reiseorg_costs_read=%',
    n_leihe, n_a_aktiv, a_zweitorg_read, a_reiseorg_read;
end
$$;

commit;
