-- Migration 0017_planning_write_channel_boundary (EYT-136)
--
-- ANLASS
-- ---------------------------------------------------------------------------
-- Die Planungsschreibflaeche war ueber die Supabase-Data-API am Domain-Command
-- vorbei erreichbar. Migration 0015 hat das fuer das VEROEFFENTLICHEN
-- geschlossen (`app.is_runtime_channel()` + `planning.publish`); der ENTWURF
-- blieb offen. Gemessen am 07.08.2026 gegen das Produktivprojekt (read-only,
-- `has_table_privilege`/`has_column_privilege`/`pg_policies`, PostgreSQL 17.6):
--
--   assignments    select ✅  insert (Spalten) ✅  update (Spalten) ✅  delete ✅
--                  Policies fuer insert/update/delete pruefen NUR die Organisation
--   plan_versions  insert (id, org_id, week_key) ✅
--                  Insert-Policy prueft Organisation + `published_at is null`
--
-- PostgREST meldet sich als `authenticator` an. Diese Rolle ist NICHT Mitglied
-- von `easytree_app` (gemessen 04.08.2026, pg_auth_members), erfuellt also
-- `app.is_runtime_channel()` nie. Genau darauf stuetzt sich diese Migration.
--
-- DATA-API-ANGRIFFSMODELL
-- ---------------------------------------------------------------------------
-- Ein normal angemeldetes, aktives Organisationsmitglied — auch mit der Rolle
-- `member`, der die API mit 403 antwortet — konnte senden:
--
--   POST   /rest/v1/assignments        Entwurfszuweisung anlegen
--   PATCH  /rest/v1/assignments?id=eq. Zuweisung verschieben
--   DELETE /rest/v1/assignments?…      Entwurfsstand einer ganzen Woche loeschen
--   POST   /rest/v1/plan_versions      Entwurfs-Planversion anlegen
--
-- Umgangen wurden damit: das atomare Recht `planning.write`, die Intervall- und
-- Konfliktvalidierung, die Wochenzugehoerigkeitspruefung (`OUTSIDE_WEEK`), die
-- Advisory-Lock-Serialisierung, der Idempotenzdatensatz, das Audit-Ereignis,
-- die Outbox-Nachricht, die Korrelations-ID und die Transaktionsklammer.
-- `assignments_published_immutable` (0010) schuetzt nur Zeilen mit
-- `published_at is not null` — der Entwurf ist genau die Luecke.
--
-- LEGITIME VERBRAUCHER (gemessen im Produktionscode, nicht angenommen)
-- ---------------------------------------------------------------------------
--   plan_versions  INSERT (org_id, week_key)          planning-write.repository.ts:469
--   plan_versions  UPDATE (published_at, published_by) planning-write.repository.ts:801
--   assignments    INSERT (org_id, plan_version_id, employee_id, worksite_id,
--                          starts_at_utc, ends_at_utc) planning-write.repository.ts:509, :555
--   assignments    UPDATE                              KEIN VERBRAUCHER
--   assignments    DELETE                              KEIN VERBRAUCHER
--
-- Der Produktionscode enthaelt kein einziges `delete from public.<tabelle>` und
-- kein `update public.assignments`. Deshalb werden diese beiden Rechte ENTZOGEN
-- statt mit Praedikaten versehen: ein Recht ohne Verbraucher braucht keine
-- Bedingung, es braucht kein Recht zu sein. Die Spalte `id` faellt aus beiden
-- Insert-Grants, weil kein Statement sie mitliefert.
--
-- KEINE ZWEITE GESCHAEFTSLOGIK IN RLS
-- ---------------------------------------------------------------------------
-- Diese Migration fuehrt KEINE neue Funktion und KEINE neue Regel ein. Sie
-- verwendet ausschliesslich `app.is_runtime_channel()` und `app.has_permission()`
-- aus 0015. Validierung, Wochenzuordnung, Idempotenz, Audit und Outbox bleiben
-- vollstaendig im Application-Command; die Datenbank beantwortet weiterhin nur
-- die Frage „darf dieser Kanal mit diesem Recht ueberhaupt schreiben".
--
-- AUSDRUECKLICH NICHT ENTHALTEN
-- ---------------------------------------------------------------------------
--   * `outbox_messages`, `idempotency_records`, `audit_events` — Bypass jeweils
--     reproduzierbar, aber ohne heute belegbare unerwuenschte Wirkung bzw. ohne
--     Rechteueberschuss gegenueber dem gemessenen Verbraucher. Als Findings
--     dokumentiert (docs/reviews/2026-08-07-data-api-grant-inventar.md §5),
--     Folgetickets vorgeschlagen. PO-Entscheidung: nicht pauschal mitnehmen.
--   * Die SELECT-Flaeche. Sie haengt am Subjektmodell EYT-14.
--   * Ein schemaweites `revoke all` — ausdruecklich NICHT autorisiert (PO).
--   * `service_role`/`postgres` tragen BYPASSRLS. Plattformeigenschaft, durch
--     keine Policy erreichbar.
--
-- BETRIEBSHINWEIS: POOLER
-- ---------------------------------------------------------------------------
-- Die Kanalgrenze haengt an `session_user = 'easytree_app'`. Laeuft die
-- Anwendung eines Tages ueber den Supavisor-Transaktionspooler, lautet
-- `session_user` dort `postgres.<pooler-tenant-id>`. Bisher braeche damit NUR
-- das Veroeffentlichen; ab dieser Migration braeche auch das Anlegen von
-- Entwuerfen und Zuweisungen. Der Fehler ist laut, nicht still: null betroffene
-- Zeilen bzw. SQLSTATE 42501, beides wird im Repository als Ausnahme gemeldet.
-- Siehe docs/runbooks/planning-publish.md.
--
-- ROLLBACK (vorwaerts, als NEUE 0018 — 0017 wird nach dem Merge nie editiert)
-- ---------------------------------------------------------------------------
--   grant insert (id) on table public.plan_versions to authenticated;
--   drop policy plan_versions_insert_in_org on public.plan_versions;
--   create policy plan_versions_insert_in_org on public.plan_versions
--     for insert to authenticated
--     with check (org_id in (select app.user_org_ids()) and published_at is null);
--   create policy plan_versions_delete_in_org on public.plan_versions
--     for delete to authenticated using (org_id in (select app.user_org_ids()));
--   grant insert (id) on table public.assignments to authenticated;
--   grant update (plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
--     on table public.assignments to authenticated;
--   grant delete on table public.assignments to authenticated;
--   drop policy assignments_insert_in_org on public.assignments;
--   create policy assignments_insert_in_org on public.assignments
--     for insert to authenticated with check (org_id in (select app.user_org_ids()));
--   create policy assignments_update_in_org on public.assignments
--     for update to authenticated
--     using (org_id in (select app.user_org_ids()))
--     with check (org_id in (select app.user_org_ids()));
--   create policy assignments_delete_in_org on public.assignments
--     for delete to authenticated using (org_id in (select app.user_org_ids()));
--
-- KEIN DATENVERLUST: diese Migration legt keine Tabelle und keine Spalte an,
-- loescht keine Zeile und veraendert keinen Wert. Sie entzieht Rechte, entfernt
-- drei wirkungslos gewordene Policies und verschaerft zwei Insert-Policies.

-- ---------------------------------------------------------------------------
-- 1. assignments: UPDATE und DELETE haben keinen Verbraucher
-- ---------------------------------------------------------------------------
-- Recht UND Policy fallen. Beides, nicht nur eines: bliebe die Policy stehen,
-- genuegte ein spaeteres `grant`, um den Weg unbemerkt wieder zu oeffnen — und
-- ein Grant ist eine Zeile, die niemand als Sicherheitsentscheidung liest.
-- Faellt die Policy mit, verweigert RLS auch dann noch (kein permissiver
-- Eintrag fuer den Befehl), und der Fehler zeigt auf diese Migration.
revoke update on table public.assignments from authenticated;
revoke delete on table public.assignments from authenticated;

drop policy assignments_update_in_org on public.assignments;
drop policy assignments_delete_in_org on public.assignments;

-- Der Sync-Trigger aus 0010 ist davon NICHT betroffen: er ist
-- `security definer` und laeuft als Eigentuemer, der die Tabelle besitzt und
-- BYPASSRLS traegt. 0010 hat ihn aus genau diesem Grund als definer angelegt
-- (Kopfkommentar dort, Punkt 3) — damals, weil `authenticated` das Schreiben
-- auf `published_at` verlor; heute traegt dieselbe Begruendung den Entzug von
-- `update` insgesamt.

-- ---------------------------------------------------------------------------
-- 2. assignments: INSERT braucht Kanal UND Recht
-- ---------------------------------------------------------------------------
-- Die Spalte `id` faellt weg: kein Statement liefert sie mit (beide Inserts
-- sind `insert … select`, siehe planning-write.repository.ts:509 und :555).
-- 0010 hatte sie fuer selbstgewaehlte Ids beim idempotenten Kommando erlaubt —
-- das Kommando waehlt sie nicht, also traegt die Begruendung nicht mehr.
revoke insert on table public.assignments from authenticated;
grant insert (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
  on table public.assignments to authenticated;

drop policy assignments_insert_in_org on public.assignments;

-- `app.is_runtime_channel()` steht zuerst, wie in 0015: PostgreSQL garantiert
-- keine Auswertungsreihenfolge, aber die Zeile sagt dem Lesenden, welche
-- Bedingung die tragende ist.
create policy assignments_insert_in_org on public.assignments
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
  );

-- ---------------------------------------------------------------------------
-- 3. plan_versions: Entwuerfe entstehen nur ueber den Command
-- ---------------------------------------------------------------------------
-- Auch hier faellt `id`: `insert into public.plan_versions (org_id, week_key)`
-- ist die einzige Schreibstelle (planning-write.repository.ts:469).
revoke insert on table public.plan_versions from authenticated;
grant insert (org_id, week_key) on table public.plan_versions to authenticated;

drop policy plan_versions_insert_in_org on public.plan_versions;

create policy plan_versions_insert_in_org on public.plan_versions
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
    -- Aus 0016 uebernommen: eine Planversion wird als Entwurf geboren.
    and published_at is null
  );

-- ---------------------------------------------------------------------------
-- 4. plan_versions: die tote DELETE-Policy entfernen
-- ---------------------------------------------------------------------------
-- 0016 hat das `delete`-Recht entzogen, die Policy aber stehen lassen. Sie ist
-- heute wirkungslos und morgen eine Falle: ein spaeteres `grant delete`
-- reaktivierte sie ohne weiteres Zutun. Ohne Policy verweigert RLS auch dann.
drop policy plan_versions_delete_in_org on public.plan_versions;

-- ---------------------------------------------------------------------------
-- 5. Dokumentation am Objekt
-- ---------------------------------------------------------------------------
comment on table public.assignments is
  'Zuweisung einer Person zu einer Baustelle in einem halboffenen Zeitraum (EYT-86). Tenantgebundene FKs machen Cross-Tenant-Referenzen auf FK-Ebene unmoeglich. Schreibend ausschliesslich ueber den Laufzeitkanal (app.is_runtime_channel) mit planning.write erreichbar; update und delete besitzen keinen Verbraucher und sind entzogen (EYT-136).';
