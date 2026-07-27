-- Nachweis 1: die Datensaetze existieren wirklich in PostgreSQL (EYT-50).
--
-- Direkt gegen die Datenbank, nicht ueber die API — sonst waere "B ist
-- unsichtbar" auch dann gruen, wenn B gar nicht existiert. Genau diese
-- Vakuitaet soll der Nachweis ausschliessen.
--
-- Laeuft als `postgres` (BYPASSRLS) und sieht deshalb beide Organisationen.
\set ON_ERROR_STOP on

select
  case
    when count(*) filter (where org_id = '00000000-0000-0000-0000-0000000000a1') = 3
     and count(*) filter (where org_id = '00000000-0000-0000-0000-0000000000b2') = 1
    then 'SEED OK: 3 Zuweisungen in Alpha, 1 in Beta'
    else 'SEED KAPUTT: ' || count(*)::text || ' Zuweisungen gesamt'
  end as befund
from public.assignments
where starts_at_utc >= '2026-09-28T00:00:00Z'
  and starts_at_utc <  '2026-10-01T00:00:00Z';

-- Der Zeitstempelgleichstand, ohne den Nachweis 8 nichts prueft.
select
  case
    when count(*) = 2 then 'GLEICHSTAND OK: zwei veroeffentlichte Versionen, identische Zeitstempel'
    else 'GLEICHSTAND FEHLT: ' || count(*)::text
  end as befund
from public.plan_versions
where org_id = '00000000-0000-0000-0000-0000000000a1'
  and week_key = '2026-W40'
  and published_at = '2026-09-25T09:00:00Z'
  and created_at   = '2026-09-20T08:00:00Z';

-- Und die Beta-Zuweisung namentlich: sie ist der Datensatz, der spaeter
-- weder in der Antwort noch im DOM auftauchen darf.
select
  case when count(*) = 1 then 'FREMDTENANT OK: b5510001 existiert in Beta'
       else 'FREMDTENANT FEHLT' end as befund
from public.assignments
where id = 'b5510001-0001-4001-8001-000000000001'
  and org_id = '00000000-0000-0000-0000-0000000000b2';
