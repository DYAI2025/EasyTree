-- Abraeumen der Reisedaten (EYT-106 AK8, EYT-134).
--
-- Die PO-Vorgabe verlangt Testdaten, die "vor dem Lauf angelegt und danach
-- entfernt werden". Diese Datei ist die zweite Haelfte davon und laeuft in CI
-- unter `if: always()` — auch nach einem gescheiterten Lauf, sonst bliebe ein
-- anmeldbarer Benutzer im Stack zurueck.
--
-- Der Auth-Benutzer wird ueber seine E-Mail-Adresse getroffen, nicht ueber
-- eine ID: seine UUID vergibt GoTrue beim Signup, sie ist hier nicht bekannt.
-- Die Adresse liegt in der Domain `.test` (RFC 2606) und kann keiner realen
-- Person gehoeren.
--
-- Reihenfolge nach Fremdschluesseln, nicht nach Lesbarkeit: Satzversionen
-- verweisen auf Mitarbeiter und Organisation, Mitgliedschaften auf Benutzer
-- und Organisation, `public.users` haengt an `auth.users`. `on delete
-- restrict` bei employees erzwingt genau diese Reihenfolge.
--
-- Am Ende wird nachgezaehlt. Ein "geloescht" ohne Nachweis waere dieselbe
-- Behauptung, gegen die dieses Ticket antritt.

\set ON_ERROR_STOP on

begin;

delete from public.employee_rate_versions
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.employees
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.memberships
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.organizations
  where id = '00000000-0000-4000-8000-00000000e201';
delete from public.users
  where id in (select id from auth.users where email = :'reisender');
delete from auth.users
  where email = :'reisender';

commit;

do $$
declare
  rest int;
begin
  select
    (select count(*) from public.organizations
       where id = '00000000-0000-4000-8000-00000000e201')
    + (select count(*) from public.memberships
         where org_id = '00000000-0000-4000-8000-00000000e201')
    + (select count(*) from public.employees
         where org_id = '00000000-0000-4000-8000-00000000e201')
    + (select count(*) from public.employee_rate_versions
         where org_id = '00000000-0000-4000-8000-00000000e201')
  into rest;
  if rest <> 0 then
    raise exception 'E2E-Teardown unvollstaendig: % Zeilen uebrig', rest;
  end if;
  raise notice '[auth-journey-teardown] restzeilen=0';
end
$$;
