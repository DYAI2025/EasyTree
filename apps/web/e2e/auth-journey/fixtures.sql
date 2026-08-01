-- Anwendungsdaten der realen Auth-Kostenreise (EYT-106 AK8, EYT-134).
--
-- ## Was hier NICHT passiert: der Benutzer entsteht woanders
--
-- `auth.users` wird von GoTrue angelegt, ueber den echten Signup-Endpunkt
-- (`global-setup.ts`). Das ist Absicht und der Kern von AK8: das Subjekt der
-- Reise muss ein ECHTER Auth-Benutzer sein, der sich mit einem Passwort ueber
-- die oeffentliche Loginseite anmeldet — kein eingeschleustes Subjekt.
--
-- Drei Wege waeren denkbar gewesen, zwei sind ausgeschlossen:
--
--   * Service-Role- bzw. Admin-API — widerspraeche AK6 und dem Waechter aus
--     Arbeitspaket A.
--   * `update auth.users set encrypted_password = crypt(...)` — braucht
--     pgcrypto, und das ist im Repository NICHT eingerichtet (gemessen: nur
--     pgtap und btree_gist werden angelegt). Eine Extension hier zu erzeugen
--     waere eine Schemaaenderung ausserhalb einer Migration und damit gegen
--     die verbindliche Regel, dass `supabase/migrations/` die einzige
--     Schemaquelle ist.
--
-- Bleibt der Signup — erlaubt (`enable_signup = true`) und ohne Bestaetigung
-- sofort nutzbar (`enable_confirmations = false`).
--
-- ## Was hier passiert
--
-- Die Anwendungsseite zu der bereits existierenden Identitaet: Projektion,
-- Organisation, Owner-Mitgliedschaft, ein Mitarbeiter, eine Satzversion.
--
-- `:benutzer` ist die von GoTrue vergebene UUID und kommt als psql-Variable
-- herein. Alles andere hat feste IDs, damit `teardown.sql` genau diese Zeilen
-- trifft. Der Praefix `...e2...` ist bewusst von den Seed-IDs verschieden,
-- damit die Reise nicht versehentlich auf Org Alpha oder Org Beta landet.

\set ON_ERROR_STOP on

begin;

insert into public.users (id, display_name)
values (:'benutzer', 'E2E-Reisender')
on conflict (id) do nothing;

insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-00000000e201', 'E2E Reiseorganisation')
on conflict (id) do nothing;

-- Owner, weil laut Migration 0013 nur diese Rolle alle vier Kostenrechte
-- traegt (manager hat kein costs.manage_rates, member gar keines). Genau EINE
-- Mitgliedschaft: bei mehreren verlangt die Policy einen expliziten
-- Organisationskontext, und das ist ein eigener Nachweis.
insert into public.memberships (id, org_id, user_id, role, active)
values ('00000000-0000-4000-8000-00000000e221',
        '00000000-0000-4000-8000-00000000e201',
        :'benutzer', 'owner', true)
on conflict (org_id, user_id) do update set role = 'owner', active = true;

insert into public.employees (id, org_id, user_id, display_name, active)
values ('00000000-0000-4000-8000-00000000e211',
        '00000000-0000-4000-8000-00000000e201',
        null, 'E2E-Mitarbeiter Reise', true)
on conflict (id) do nothing;

-- Eine Satzversion, damit die Historie etwas zu zeigen hat. Bewusst hier und
-- nicht ueber die Oberflaeche: die Reise ist eine LESEREISE (Schritte 1-10
-- enden beim Oeffnen der Historie); ein Schreibweg im selben Lauf verwaesserte
-- die Aussage darueber, was gelesen wurde.
insert into public.employee_rate_versions
  (id, org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
   predecessor_id, reason, created_by, correlation_id)
values ('00000000-0000-4000-8000-00000000e231',
        '00000000-0000-4000-8000-00000000e201',
        '00000000-0000-4000-8000-00000000e211',
        4250, 'EUR', date '2026-01-01', null,
        null, 'Startsatz der E2E-Reise',
        :'benutzer',
        'e2e-auth-journey')
on conflict (id) do nothing;

commit;

-- Nachrechnen statt behaupten: ein halb eingespieltes Fixture liesse die Reise
-- mit einer irrefuehrenden Meldung scheitern ("kein Zugriff" statt
-- "Mitgliedschaft fehlt").
-- Bewusst OHNE psql-Variable: innerhalb eines dollar-quotierten Blocks
-- ersetzt psql `:'benutzer'` NICHT, der Block liefe mit dem Literaltext und
-- scheiterte mit einem irrefuehrenden Syntaxfehler. Der Benutzer wird deshalb
-- ueber die Mitgliedschaft hergeleitet — was zugleich mitprueft, dass die
-- Verkettung Benutzer -> Mitgliedschaft wirklich steht.
do $$
declare
  n_projektion int;
  n_mitglied int;
  n_satz int;
  n_mitarbeiter int;
begin
  select count(*) into n_mitglied
    from public.memberships
    where org_id = '00000000-0000-4000-8000-00000000e201' and role = 'owner' and active;
  select count(*) into n_projektion
    from public.users u
    join public.memberships m on m.user_id = u.id
    where m.org_id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_mitarbeiter
    from public.employees where org_id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_satz
    from public.employee_rate_versions
    where org_id = '00000000-0000-4000-8000-00000000e201';
  if n_projektion <> 1 or n_mitglied <> 1 or n_satz <> 1 or n_mitarbeiter <> 1 then
    raise exception
      'E2E-Fixture unvollstaendig: projektion=% membership=% mitarbeiter=% satz=%',
      n_projektion, n_mitglied, n_mitarbeiter, n_satz;
  end if;
  raise notice '[auth-journey-fixture] projektion=% membership=% mitarbeiter=% satz=%',
    n_projektion, n_mitglied, n_mitarbeiter, n_satz;
end
$$;
