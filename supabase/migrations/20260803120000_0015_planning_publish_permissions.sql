-- Migration 0015_planning_publish_permissions (EYT-107)
--
-- Veroeffentlichen bekommt ein eigenes Recht — und die Datenbank bekommt eine
-- eigene Meinung dazu.
--
-- Rollback (vorwaerts, als neue Migration; 0015 wird nach dem Merge nicht
-- editiert):
--   drop policy plan_versions_update_in_org on public.plan_versions;
--   create policy plan_versions_update_in_org on public.plan_versions
--     for update to authenticated
--     using (org_id in (select app.user_org_ids()))
--     with check (org_id in (select app.user_org_ids()));
--   grant update on table public.plan_versions to authenticated;
--   delete from public.role_permissions where permission like 'planning.%';
--   drop function app.has_permission(uuid, text);
--   drop function app.is_runtime_channel();
-- Kein Datenverlust: diese Migration legt keine Tabelle und keine Spalte an,
-- sie ergaenzt zwei Funktionen, sechs Zuordnungszeilen, eine Spaltengrenze und
-- verschaerft eine Policy.
--
-- ---------------------------------------------------------------------------
-- Nachtrag 04.08.2026 — P1 aus der unabhaengigen Finalpruefung von PR #52
-- ---------------------------------------------------------------------------
-- Diese Migration wurde innerhalb des noch offenen PR #52 korrigiert, nicht
-- durch eine 0016 ersetzt: sie ist NIRGENDS angewandt (das gehostete Projekt
-- steht auf 0013, gemessen 04.08.2026), und eine Nachfolgemigration, die ihre
-- Vorgaengerin sofort zurueckninmt, waere schwerer zu lesen als die Sache
-- selbst. Nach dem Merge gilt wieder: append-only.
--
-- Der Befund: die erste Fassung verlangte fuer ein `update plan_versions` zwar
-- `planning.publish` — aber sonst nichts. `authenticated` besass aus Migration
-- 0007 weiterhin `grant select, insert, update, delete` OHNE Spaltenbegrenzung,
-- und PostgREST stellt `public` als Data-API bereit (supabase/config.toml,
-- schemas = ["public", "graphql_public"]). Eine Managerin konnte damit
--
--     PATCH /rest/v1/plan_versions?id=eq.<id>  {"published_at": ..., ...}
--
-- senden und veroeffentlichen — am Application Command vorbei, also ohne
-- Wochenzuordnungspruefung, ohne benannte Konfliktpruefung, ohne
-- Idempotenzdatensatz, ohne Audit-Ereignis, ohne Outbox-Nachricht und ohne
-- stabilen Fehler. Der Sync-Trigger aus 0010 haette die Zuweisungen dabei
-- bereitwillig mitgestempelt.
--
-- Gemessen am 04.08.2026 gegen das gehostete Projekt (read-only, pg_roles /
-- pg_auth_members, PostgreSQL 17.6):
--
--   easytree_app   LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS, Mitglied von
--                  `authenticated` (set_option = true)
--   authenticator  LOGIN NOINHERIT, Mitglied von anon/authenticated/service_role,
--                  KEIN Mitglied von easytree_app
--                  -> pg_has_role('authenticator','easytree_app','member') = false
--   postgres       BYPASSRLS, KEIN Superuser; Mitglied von easytree_app mit
--                  inherit_option = false, set_option = false
--   service_role   BYPASSRLS
--
-- Daraus die Korrektur: `app.is_runtime_channel()` vergleicht `session_user`
-- mit der Laufzeitrolle. Die Anwendung verbindet sich als `easytree_app` und
-- setzt in der Transaktion `set local role authenticated` — `session_user`
-- bleibt dabei `easytree_app`. PostgREST verbindet sich als `authenticator`
-- und erfuellt die Bedingung nie.
--
-- Was diese Grenze NICHT deckt und auch nicht decken kann: `service_role` und
-- `postgres` tragen BYPASSRLS und umgehen jede Policy — auf jeder Tabelle,
-- nicht nur auf dieser. Das ist eine bestehende Plattformeigenschaft, keine
-- Regression dieser Aenderung; CLAUDE.md verbietet Service-Role-Pfade in der
-- Anwendung aus genau diesem Grund.
--
-- BETRIEBSHINWEIS: die Loginrolle ist damit Teil der Sicherheitsgrenze. Laeuft
-- die Anwendung eines Tages ueber den Supavisor-Transaktionspooler, lautet
-- `session_user` dort `postgres.<pooler-tenant-id>` und das Veroeffentlichen
-- bricht. Es bricht LAUT: `planning-write.repository.ts` wirft bei null
-- betroffenen Zeilen eine benannte Ausnahme, statt Erfolg zu melden. Siehe
-- docs/runbooks/planning-publish.md.
--
-- ---------------------------------------------------------------------------
-- Warum eine NEUE Funktion und kein Umbenennen von app.has_cost_permission
-- ---------------------------------------------------------------------------
-- `app.has_cost_permission(uuid, text)` aus 0013 ist im Rumpf bereits
-- generisch — sie vergleicht `rp.permission = p_permission` und weiss nichts
-- von Kosten. Ihr Name ist trotzdem kostenspezifisch, und zwei RLS-Policies in
-- 0013 referenzieren sie. Ein `alter function ... rename` waere eine
-- rueckwirkende Aenderung an einer bereits gemergten Migration (append-only,
-- CLAUDE.md), ein `drop` wuerde die beiden Policies mitreissen.
--
-- Deshalb: `app.has_permission` entsteht daneben. Die Doppelung ist bewusst und
-- benannt — sie kostet eine Funktion und erspart eine Aenderung an bestehenden
-- Policies. Wer sie spaeter zusammenfuehrt, ersetzt zuerst die beiden
-- 0013-Policies und entfernt die alte Funktion danach, in EINER Migration.
--
-- ---------------------------------------------------------------------------
-- Warum plan_versions.published_at bisher jedem Mitglied offenstand
-- ---------------------------------------------------------------------------
-- 0007 vergibt `grant select, insert, update, delete on plan_versions to
-- authenticated` und eine Update-Policy, die AUSSCHLIESSLICH die Organisation
-- prueft. 0010 hat danach `assignments.published_at` per Spalten-Grant
-- geschuetzt — plan_versions aber nicht, weil es dort kein Recht gab, auf das
-- man haette pruefen koennen.
--
-- Damit konnte bis heute jedes aktive Mitglied einer Organisation eine
-- Planversion veroeffentlichen, sobald es die API umging. Der Sync-Trigger aus
-- 0010 haette die Zuweisungen bereitwillig mitgestempelt. Diese Migration
-- schliesst das: ab hier verlangt die Update-Policy `planning.publish`.
--
-- Das ist die zweite Haelfte der Unabhaengigkeitszusage (dieselbe Bauart wie
-- AK4 in EYT-106): schaltet man die Anwendungs-Policy auf „immer erlaubt",
-- muss die Datenbank weiterhin ablehnen.

-- ---------------------------------------------------------------------------
-- 1. app.has_permission — dieselbe Frage wie 0013, ohne Modulnamen
-- ---------------------------------------------------------------------------
create or replace function app.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
      join public.role_permissions rp on rp.role = m.role
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.active
       and rp.permission = p_permission
  );
$$;

comment on function app.has_permission(uuid, text) is
  'Wahr, wenn die aufrufende Identitaet eine AKTIVE Mitgliedschaft in p_org_id hat und deren Rolle p_permission traegt. security definer, damit die Policy nicht auf memberships rekursiert. Modulunabhaengige Nachfolgerin von app.has_cost_permission (EYT-107).';

revoke all on function app.has_permission(uuid, text) from public;
grant execute on function app.has_permission(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. app.is_runtime_channel — welcher KANAL fragt (EYT-107 P1)
-- ---------------------------------------------------------------------------
-- `session_user` ist die Rolle, mit der sich die Verbindung ANGEMELDET hat.
-- `set local role` aendert `current_user`, niemals `session_user`; ein Client
-- kann sie also nicht faelschen, und auch eine security-definer-Funktion sieht
-- weiterhin die echte Loginrolle.
--
-- Der Vergleich steht in einer benannten Funktion statt als Literal in der
-- Policy: eine Stelle statt zweier (using und with check), direkt pruefbar
-- (`select app.is_runtime_channel()`), und eine kuenftige Umbenennung der
-- Laufzeitrolle hat genau einen Fundort.
--
-- Kein `security definer`: die Funktion liest keine Tabelle. `stable` und
-- nicht `immutable`, weil `session_user` je Sitzung verschieden ist.
create or replace function app.is_runtime_channel()
returns boolean
language sql
stable
set search_path = ''
as $$
  select session_user = 'easytree_app';
$$;

comment on function app.is_runtime_channel() is
  'Wahr, wenn die Verbindung sich als Laufzeitrolle easytree_app angemeldet hat — der Kanal von API und Worker. Falsch fuer PostgREST (authenticator) und fuer jede andere Loginrolle. Grenze aus dem P1-Befund zu EYT-107: ohne sie konnte ein Benutzer mit planning.publish ueber die Data-API am Publish-Command vorbei veroeffentlichen.';

revoke all on function app.is_runtime_channel() from public;
grant execute on function app.is_runtime_channel() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rollenmatrix der Planung (Product-Owner-Entscheidung 03.08.2026)
-- ---------------------------------------------------------------------------
--   owner    -> read, write, publish
--   manager  -> read, write, publish
--   member   -> KEINE Zeile
--
-- `member` bekommt bewusst nichts: Mitarbeitende sehen ihre eigenen Einsaetze
-- ueber die Mitarbeitersicht (EYT-14, noch nicht gebaut), nicht ueber die
-- Planungsansicht der Leitung. Dieselbe Begruendung wie bei den Kostenrechten
-- in 0013.
--
-- `planning.publish` ist ein EIGENES Recht und wird von `planning.write` NICHT
-- impliziert. Wer einen Entwurf bearbeiten darf, darf ihn deshalb nicht
-- automatisch verbindlich machen — die Trennung ist der ganze Zweck des
-- dritten Eintrags.
insert into public.role_permissions (role, permission) values
  ('owner',   'planning.read'),
  ('owner',   'planning.write'),
  ('owner',   'planning.publish'),
  ('manager', 'planning.read'),
  ('manager', 'planning.write'),
  ('manager', 'planning.publish');

-- ---------------------------------------------------------------------------
-- 3. Veroeffentlichen verlangt Recht UND Kanal — auch an der API vorbei
-- ---------------------------------------------------------------------------
-- `using` entscheidet, WELCHE Zeile geaendert werden darf; `with check`
-- entscheidet, WIE sie danach aussehen darf. Der Check
-- `plan_versions_publication_complete` aus 0007 verlangt ohnehin, dass
-- published_at und published_by gemeinsam gesetzt werden.
-- Zuerst die SPALTENGRENZE. Sie ist unabhaengig von der Policy und greift
-- frueher: fehlende Spaltenrechte werfen 42501, bevor ueberhaupt eine Zeile
-- ausgewaehlt oder ein Trigger gefeuert wird.
--
-- Genau diese Bauart schuetzt `assignments.published_at` seit Migration 0010
-- (Z. 83-86). `plan_versions` blieb damals aussen vor, weil es kein Recht gab,
-- auf das man haette pruefen koennen — das holt diese Migration nach.
--
-- Damit sind `org_id`, `week_key` und `created_at` ueber das Publish-Recht
-- nicht mehr erreichbar. Der Publish-Pfad braucht sie nicht: er hat GENAU EINE
-- Schreibstelle (`planning-write.repository.ts`), und die setzt ausschliesslich
-- diese beiden Spalten.
revoke update on table public.plan_versions from authenticated;
grant update (published_at, published_by) on table public.plan_versions to authenticated;

drop policy plan_versions_update_in_org on public.plan_versions;

-- `app.is_runtime_channel()` steht ZUERST: PostgreSQL wertet die Konjunktion
-- zwar nicht garantiert von links nach rechts aus, aber die Reihenfolge sagt
-- dem Lesenden, welche Bedingung die tragende ist. Sie ist ausserdem die
-- billigste — ein Zeichenkettenvergleich gegen zwei Funktionsaufrufe.
--
-- Die Kanalbedingung steht in BEIDEN Klauseln. Im `with check` ist sie
-- redundant, solange `using` sie bereits erzwingt, und das wird hier nicht
-- schoengeredet: es ist Tiefenverteidigung, kein zweiter Nachweis. Sie steht
-- trotzdem da, weil `with check` die Bedingung auf dem NEUEN Zeilenzustand
-- erzwingen soll — wer die Policy spaeter um einen `for insert`-Zweig oder um
-- eine zweite Update-Policy ergaenzt, findet sie an der richtigen Stelle vor,
-- statt sie zu vergessen.
--
-- `app.has_permission` ebenfalls in beiden Klauseln, aus demselben Grund und
-- mit derselben Einschraenkung: solange `org_id` nicht aenderbar ist (siehe
-- Spaltengrenze oben), kann die zweite Auswertung nie ein anderes Ergebnis
-- liefern.
--
-- `published_by is null or published_by = auth.uid()` ist die Urheberzusage
-- und die EINZIGE Bedingung, die ausschliesslich im `with check` sinnvoll ist:
-- sie betrifft den neuen Wert, den `using` gar nicht sehen kann. Ein Client
-- kann damit keine fremde Person als Veroeffentlichende eintragen.
create policy plan_versions_update_in_org on public.plan_versions
  for update to authenticated
  using (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.publish')
  )
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.publish')
    and (published_by is null or published_by = auth.uid())
  );

comment on table public.plan_versions is
  'Planversion je Organisation und ISO-Woche (EYT-86). published_at ist die autoritative Veroeffentlichungsmarke; assignments.published_at wird davon abgeleitet und atomar mitgesetzt (EYT-49). Ein UPDATE verlangt seit EYT-107 das Recht planning.publish, laeuft ausschliesslich ueber den Laufzeitkanal (app.is_runtime_channel), erreicht nur die Spalten published_at und published_by und darf published_by nur auf die aufrufende Identitaet setzen.';

comment on column public.plan_versions.published_at is
  'Autoritative Veroeffentlichungsmarke. Nur ueber den EasyTree-Publish-Command setzbar: die Update-Policy verlangt planning.publish UND app.is_runtime_channel(), das Spaltenrecht endet bei published_at/published_by. Ein direkter Data-API-Zugriff bewirkt nichts (P1 zu EYT-107, 04.08.2026).';
