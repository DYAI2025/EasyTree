-- Migration 0014_rate_succession (EYT-108)
--
-- Der EINE erlaubte Zustandsuebergang an einer Satzversion: eine offene
-- Version wird genau einmal geschlossen, indem `valid_to` gesetzt wird.
--
-- EIN Schritt, weil Spaltenrecht und Policy zusammen erst die Zusage ergeben.
-- Getrennt eingespielt gaebe es einen Moment, in dem das Recht existiert und
-- die Policy noch fehlt (oder umgekehrt) — beides waere kurzzeitig entweder
-- zu weit oder wirkungslos.
--
-- Rollback:
--   drop policy if exists employee_rate_versions_close on public.employee_rate_versions;
--   revoke update (valid_to) on public.employee_rate_versions from authenticated;
-- Kein Datenverlust: es entsteht keine Tabelle und keine Zeile. Bereits
-- geschlossene Versionen bleiben geschlossen, was richtig ist — sie sind
-- fachlich abgeloest. Als Vorwaertsmigration einspielen, nie diese Datei
-- editieren.
--
-- ## Warum ein SPALTENRECHT und keine Funktion
--
-- Erwogen und verworfen wurde eine `security definer`-Funktion. Sie waere hier
-- die schlechtere Loesung, und zwar aus einem gemessenen Grund: Migration 0013
-- setzt auf dieser Tabelle `force row level security`. Eine definer-Funktion
-- laeuft als ihr Eigentuemer, und der kommt an `force` nur deshalb vorbei,
-- weil `postgres` BYPASSRLS beziehungsweise Superuser ist. Die Engstelle haenge
-- damit an genau dem Privileg, das ADR-001 aus dem Laufzeitpfad heraushaelt —
-- und das der Startgate aus EYT-45 in `DATABASE_URL` ausdruecklich verweigert.
--
-- Das Spaltenrecht bleibt dagegen vollstaendig innerhalb von RLS. Es ist
-- ausserdem bereits das Idiom dieses Repositories: Migration 0010 verengt
-- `assignments` auf dieselbe Weise, und `supabase/tests/0006_planning_invariants.sql`
-- prueft es mit `has_column_privilege` samt Gegenprobe.
--
-- ## Was dadurch UNMOEGLICH bleibt
--
-- Betrag, Waehrung, Organisation, Mitarbeiter, `valid_from`, Grund, Ersteller,
-- Erstellungszeit, Korrelations-Id und `predecessor_id` tragen KEIN
-- update-Recht. Das erzwingt PostgreSQL selbst, nicht der Anwendungscode —
-- ein Kommando, das sie zu aendern versucht, scheitert mit 42501, egal welcher
-- Weg es aufruft.
--
-- ## Einmaligkeit
--
-- `using (valid_to is null)`: eine bereits geschlossene Zeile ist fuer UPDATE
-- schlicht nicht sichtbar. Die Pruefung steht in der Policy und nicht in einer
-- vorherigen SELECT-Abfrage der Anwendung, weil zwischen Lesen und Schreiben
-- eine zweite Transaktion dazwischenkaeme. So entscheidet die Zeilensperre des
-- UPDATE selbst, und der Verlierer sieht null betroffene Zeilen.

-- Erst entziehen, dann eng zurueckgeben. Ohne das `revoke` bliebe ein spaeter
-- ergaenztes Tabellenrecht unbemerkt bestehen.
revoke update on table public.employee_rate_versions from authenticated;
grant update (valid_to) on table public.employee_rate_versions to authenticated;

-- Die Policy traegt die fachlichen Bedingungen, die ein Spaltenrecht nicht
-- ausdruecken kann.
--
--   using      -> WELCHE Zeile darf ueberhaupt angefasst werden: nur eine
--                 offene, nur im eigenen Tenant, nur mit costs.manage_rates.
--   with check -> WIE sie danach aussehen muss: geschlossen, und der Endtag
--                 liegt nach dem Beginn. Ohne `with check` koennte dieselbe
--                 Anweisung `valid_to` wieder auf NULL setzen und die
--                 Einmaligkeit unterlaufen.
create policy employee_rate_versions_close on public.employee_rate_versions
  for update to authenticated
  using (
    org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.manage_rates')
  )
  with check (
    valid_to is not null
    and valid_to > valid_from
    and org_id in (select app.user_org_ids())
    and app.has_cost_permission(org_id, 'costs.manage_rates')
  );

comment on policy employee_rate_versions_close on public.employee_rate_versions is
  'Schliesst eine OFFENE Satzversion genau einmal. Zusammen mit dem Spaltenrecht auf valid_to der einzige Weg, eine Satzversion zu veraendern; alle uebrigen Spalten bleiben ohne update-Recht (EYT-108).';
