-- pgTAP: Veroeffentlichungsrecht, Kanalgrenze und Spaltengrenze (EYT-107).
--
-- ---------------------------------------------------------------------------
-- Was hier bewiesen wird, und warum ausgerechnet auf DB-Ebene
-- ---------------------------------------------------------------------------
-- Die Unabhaengigkeitszusage: Anwendung UND Datenbank lehnen getrennt ab.
-- Diese Datei prueft ausschliesslich die Datenbankhaelfte. Selbst wenn
-- `MembershipPlanningAccessPolicy` eines Tages jede Anfrage durchwinkt, darf
-- hier niemand ohne `planning.publish` eine Planversion veroeffentlichen — und
-- niemand ausserhalb des Laufzeitkanals ueberhaupt.
--
-- ---------------------------------------------------------------------------
-- Der P1-Befund vom 04.08.2026 — warum der Positivfall hier verschwunden ist
-- ---------------------------------------------------------------------------
-- Eine fruehere Fassung dieser Datei enthielt an genau dieser Stelle einen
-- `lives_ok` auf
--
--     update public.plan_versions set published_at = now(), published_by = ...
--
-- und nannte ihn „die Managerin veroeffentlicht die Planversion ihrer
-- Organisation". Der Test war gruen und beschrieb einen BYPASS: PostgREST
-- stellt `public` als Data-API bereit (supabase/config.toml), und `authenticated`
-- besass aus Migration 0007 ein Tabellen-UPDATE ohne Spaltenbegrenzung. Jede
-- Managerin konnte damit ueber `PATCH /rest/v1/plan_versions` veroeffentlichen,
-- ohne Wochenzuordnungspruefung, ohne benannte Konfliktpruefung, ohne
-- Idempotenzdatensatz, ohne Audit und ohne Outbox.
--
-- Der Fall ist deshalb nicht geloescht, sondern UMGEDREHT: dieselbe Anweisung
-- steht weiterhin da, ihre Erwartung ist jetzt Wirkungslosigkeit.
--
-- ---------------------------------------------------------------------------
-- Was diese Datei NICHT beweisen kann (und wo es bewiesen wird)
-- ---------------------------------------------------------------------------
-- `session_user` laesst sich hier nicht wechseln: `SET SESSION AUTHORIZATION`
-- verlangt, dass der urspruengliche Sitzungsbenutzer Superuser war, und
-- `postgres` ist das in Supabase nicht (gemessen 04.08.2026: rolsuper=false,
-- rolbypassrls=true). Die Sitzung dieser Datei ist also `postgres`, nicht
-- `authenticator`.
--
-- Bewiesen wird hier folglich: „eine Sitzung, deren Loginrolle nicht
-- easytree_app ist, bewirkt nichts". Dass die PostgREST-Sitzung genau so eine
-- ist, misst `apps/web/e2e/auth-journey/journey.pwtest.ts` gegen die echte
-- Data-API — und dass der Serverpfad weiterhin funktioniert, misst
-- `apps/api/test/planning-publish.integration.test.ts` gegen eine echte
-- `easytree_app`-Verbindung. Drei Ebenen, drei Aussagen; keine ersetzt eine
-- andere.
--
-- ---------------------------------------------------------------------------
-- Woher die Testidentitaet kommt
-- ---------------------------------------------------------------------------
-- Aus `seed.sql`, nicht aus dieser Datei. `public.users` haengt am
-- Fremdschluessel auf `auth.users`; eigene Benutzer anzulegen hiesse, GoTrue
-- nachzuahmen (eine erste Fassung ist daran mit 23503 gescheitert).
--
-- Zur Form von throws_ok: ZWEIstellig (sql, errcode). Die dreistellige Form
-- erwartet ERRMSG, nicht eine Beschreibung.

begin;
select plan(31);

-- ===========================================================================
-- Die Testidentitaet: User C aus dem Seed, nur die Rolle aendert sich
-- ===========================================================================
-- Derselbe Benutzer, dieselbe Organisation, dieselbe Mitgliedschaftszeile — es
-- aendert sich AUSSCHLIESSLICH die Rolle. Zwei verschiedene Benutzer haetten
-- zwei Variablen zugleich verstellt.
update public.memberships
   set active = true, role = 'member'
 where user_id = '00000000-0000-4000-8000-00000000ccc3';

-- ===========================================================================
-- 1. Die Rollenmatrix (PO-Entscheidung 03.08.2026)
-- ===========================================================================
select is(
  (select count(*)::int from public.role_permissions
    where role = 'owner' and permission like 'planning.%'),
  3,
  'owner traegt alle drei Planungsrechte'
);

select is(
  (select count(*)::int from public.role_permissions
    where role = 'manager' and permission like 'planning.%'),
  3,
  'manager traegt alle drei Planungsrechte'
);

select is(
  (select count(*)::int from public.role_permissions
    where role = 'member' and permission like 'planning.%'),
  0,
  'member traegt kein einziges Planungsrecht'
);

-- Gegenrichtung: kein Tippfehler und kein zusaetzliches Recht schleicht sich
-- ein. Ohne diese Zeile waere 'planning.publsh' gruen.
select is(
  (select count(*)::int from public.role_permissions
    where permission like 'planning.%'
      and permission not in ('planning.read', 'planning.write', 'planning.publish')),
  0,
  'es existiert kein Planungsrecht ausserhalb der drei vereinbarten'
);

-- ===========================================================================
-- 2. Kontext: aktiver member in Org Alpha — darf NICHTS
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000ccc3', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000a1', 'planning.publish'),
  false,
  'ein aktiver member darf nicht veroeffentlichen'
);

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000a1', 'planning.read'),
  false,
  'ein aktiver member darf die Planung nicht einmal lesen'
);

-- Nicht „wirft einen Fehler", sondern „bewirkt nichts": RLS filtert die Zeile
-- aus dem UPDATE heraus, statt abzubrechen. Seit dem P1-Fix scheitert dieser
-- Versuch doppelt — am fehlenden Recht UND am Kanal. Beides ist beabsichtigt;
-- die trennscharfe Aussage zum Recht steht zwei Zeilen darueber.
update public.plan_versions
   set published_at = now(),
       published_by = '00000000-0000-4000-8000-00000000ccc3'
 where id = '00000000-0000-4000-8000-0000006010a1';

select is(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006010a1'),
  null,
  'der member hat NICHTS veroeffentlicht — die Zeile ist unveraendert Entwurf'
);

-- ===========================================================================
-- 3. DIESELBE Person als `manager` — das Recht reicht NICHT
-- ===========================================================================
-- Einzige Aenderung gegenueber Abschnitt 2: die Rolle. Was jetzt anders
-- ausgeht, geht wegen der ROLLE anders aus — nichts sonst wurde angefasst.
reset role;
update public.memberships
   set role = 'manager'
 where user_id = '00000000-0000-4000-8000-00000000ccc3';
set local role authenticated;

-- Die Kanalaussage direkt an der Funktion. `session_user` ist hier `postgres`
-- (siehe Kopf), also nicht der Laufzeitkanal.
select is(
  app.is_runtime_channel(),
  false,
  'diese Sitzung ist NICHT der EasyTree-Laufzeitkanal'
);

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000a1', 'planning.publish'),
  true,
  'die Managerin traegt das Recht planning.publish'
);

select is(
  app.has_permission('00000000-0000-4000-8000-0000000000b2', 'planning.publish'),
  false,
  'dieselbe Person traegt es in einer FREMDEN Organisation nicht'
);

-- --------------------------------------------------------------------------
-- Der umgedrehte Fall: das Recht genuegt nicht, der Kanal entscheidet mit
-- --------------------------------------------------------------------------
-- Genau diese Anweisung stand hier frueher als `lives_ok`. Sie laeuft weiterhin
-- fehlerfrei durch — RLS wirft nicht, sie filtert. Deshalb wird wieder die
-- WIRKUNG geprueft und nicht der Rueckgabewert.
update public.plan_versions
   set published_at = now(),
       published_by = '00000000-0000-4000-8000-00000000ccc3'
 where id = '00000000-0000-4000-8000-0000006010a1';

select is(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006010a1'),
  null,
  'trotz planning.publish bleibt die Planversion Entwurf — falscher Kanal'
);

-- Keine Teilwirkung: der Sync-Trigger aus 0010 haette bei Erfolg JEDE Zuweisung
-- der Version mitgestempelt. Diese Zeile ist der Waechter ueber die
-- Gegenmutation „Kanalpruefung aus der Policy entfernen" — sie wird dann rot.
select is(
  (select count(*)::int from public.assignments
    where plan_version_id = '00000000-0000-4000-8000-0000006010a1'
      and published_at is not null),
  0,
  'keine einzige Zuweisung wurde mitgestempelt'
);

-- Die drei folgenden Zaehlungen sind AUSDRUECKLICH nicht falsifizierend: sie
-- bleiben auch dann 0, wenn die Kanalpruefung faellt. Genau das ist der
-- Befund — der direkte Tabellenweg erzeugt niemals Audit, Outbox oder
-- Idempotenz, egal ob er gelingt. Sie stehen hier als benannte Beschreibung
-- des Schadens, nicht als bestandener Nachweis; falsifizierend ist die
-- Zuweisungszeile darueber.
select is(
  (select count(*)::int from public.audit_events
    where subject_id = '00000000-0000-4000-8000-0000006010a1'
      and event_type = 'planning.plan_published'),
  0,
  'der direkte Weg hat keine Auditspur erzeugt (und koennte es nie)'
);

select is(
  (select count(*)::int from public.outbox_messages
    where message_type = 'planning.plan_published'
      and payload ->> 'planVersionId' = '00000000-0000-4000-8000-0000006010a1'),
  0,
  'der direkte Weg hat keine Outbox-Nachricht erzeugt'
);

select is(
  (select count(*)::int from public.idempotency_records
    where operation = 'planning.publish_plan'
      and subject_id = '00000000-0000-4000-8000-0000006010a1'),
  0,
  'der direkte Weg hat keinen Idempotenzdatensatz erzeugt'
);

-- --------------------------------------------------------------------------
-- Die Spaltengrenze: das Publish-Recht oeffnet nur zwei Spalten
-- --------------------------------------------------------------------------
-- 42501, nicht 23514: das Spaltenrecht wird vor der Zeilenauswahl und vor
-- jedem Trigger geprueft. Frueher standen hier 23514 — dieselbe Anweisung kam
-- damals bis zum Unveraenderlichkeits-Trigger aus 0010 durch, weil
-- `authenticated` das volle Tabellen-UPDATE besass.
select throws_ok(
  $$update public.plan_versions
       set week_key = '2026-W33'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '42501'
);

select throws_ok(
  $$update public.plan_versions
       set org_id = '00000000-0000-4000-8000-0000000000b2'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '42501'
);

-- Dieselbe Aussage noch einmal am Katalog statt am Verhalten — dieselbe
-- Bauart, mit der 0006 die Spaltengrenze von `assignments` festhaelt. Die
-- Gegenprobe darunter ist kein Beiwerk: ohne sie waere die Zeile auch dann
-- gruen, wenn `authenticated` GAR KEIN Update-Recht mehr auf der Tabelle
-- haette — und das waere eine andere, unbeabsichtigte Welt.
select is(
  has_column_privilege('authenticated', 'public.plan_versions', 'week_key', 'update'),
  false,
  'authenticated darf plan_versions.week_key NICHT aendern'
);

select is(
  has_column_privilege('authenticated', 'public.plan_versions', 'published_at', 'update'),
  true,
  'das Update-Recht existiert — es endet nur bei published_at und published_by'
);

-- --------------------------------------------------------------------------
-- Der INSERT-Pfad: eine Planversion wird als ENTWURF geboren (Befund F1)
-- --------------------------------------------------------------------------
-- Das Selbstreview der P1-Korrektur am 04.08.2026 fand die zweite Tuer: das
-- UPDATE war abgedichtet, der INSERT nicht. `authenticated` durfte
-- `published_at` beim ANLEGEN mitgeben, und keiner der beiden Trigger auf
-- plan_versions feuert bei INSERT (beide sind `update`/`delete`). Der partielle
-- Unique-Index deckt nur Entwuerfe ab, eine geborene Veroeffentlichung
-- kollidierte also mit nichts.
--
-- Wirkung waere gewesen: eine veroeffentlichte Planversion ohne
-- Wochenzuordnungspruefung, ohne Konflikte, ohne Idempotenz, ohne Audit, ohne
-- Outbox — und dank 0010 unveraenderlich UND unloeschbar. Sie haette
-- `publishedVersionId` der Woche dauerhaft besetzt.
--
-- Dieselbe Bauart wie bei `assignments` in 0010, wo derselbe Entzug schon
-- steht (dort mit derselben Begruendung: ein gefaelschter Marker beim Anlegen
-- ist schlimmer als beim Aendern, weil niemand ihn danach korrigieren kann).
select is(
  has_column_privilege('authenticated', 'public.plan_versions', 'published_at', 'insert'),
  false,
  'authenticated darf plan_versions.published_at NICHT beim Anlegen mitgeben'
);

-- Gegenprobe: das Anlegen als solches bleibt erlaubt. Ohne sie waere die Zeile
-- darueber auch dann gruen, wenn `authenticated` gar keine Planversion mehr
-- anlegen koennte — und der Publish-Pfad haette nichts zu veroeffentlichen.
select is(
  has_column_privilege('authenticated', 'public.plan_versions', 'week_key', 'insert'),
  true,
  'Entwuerfe darf authenticated weiterhin anlegen'
);

select throws_ok(
  $$insert into public.plan_versions (org_id, week_key, published_at, published_by)
    values ('00000000-0000-4000-8000-0000000000a1', '2026-W35',
            now(), '00000000-0000-4000-8000-00000000ccc3')$$,
  '42501'
);

-- --------------------------------------------------------------------------
-- Loeschen: ein Recht, das kein Command benutzt (Befund F3)
-- --------------------------------------------------------------------------
-- `authenticated` besass `delete` auf plan_versions, und die Delete-Policy
-- prueft nur die Organisation. Kein Anwendungspfad loescht Planversionen —
-- ueber die Data-API konnte damit jedes Mitglied einen Entwurf entfernen, und
-- `assignments.plan_version_id` ist `on delete cascade` (0007): die
-- Wochenplanung waere still weg gewesen. Veroeffentlichtes schuetzte schon
-- vorher der Trigger aus 0010; Entwuerfe schuetzte nichts.
select is(
  has_table_privilege('authenticated', 'public.plan_versions', 'delete'),
  false,
  'authenticated darf Planversionen gar nicht erst loeschen'
);

select is(
  has_table_privilege('authenticated', 'public.plan_versions', 'select'),
  true,
  'lesen darf es weiterhin — der Entzug trifft nur das Loeschen'
);

-- ===========================================================================
-- 4. Der Eigentuemerpfad — Trigger und Unveraenderlichkeit
-- ===========================================================================
-- Ab hier wieder `postgres`. Das ist kein Umgehen der eben bewiesenen Grenze,
-- sondern der einzige Weg, die 0010-Mechanik in dieser Datei noch zu messen:
-- der authenticated-Pfad ist jetzt (richtigerweise) tot, und `session_user`
-- laesst sich nicht faelschen. `postgres` traegt BYPASSRLS und umgeht damit
-- auch FORCE RLS; Trigger und Constraints gelten weiterhin, denn die sind
-- keine Policies.
--
-- Dass die Managerin auf dem ECHTEN Laufzeitkanal veroeffentlichen kann, misst
-- `planning-publish.integration.test.ts` gegen eine echte
-- `easytree_app`-Verbindung — nicht diese Datei.
reset role;

select lives_ok(
  $$update public.plan_versions
       set published_at = now(),
           published_by = '00000000-0000-4000-8000-00000000ccc3'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  'ueber den Eigentuemerpfad laesst sich die Version veroeffentlichen'
);

select isnt(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006010a1'),
  null,
  'plan_versions.published_at ist gesetzt'
);

-- Der Trigger aus 0010 in derselben Transaktion: die Zuweisungen tragen den
-- Marker, ohne dass jemand ihn geschrieben haette.
select is(
  (select count(*)::int from public.assignments
    where plan_version_id = '00000000-0000-4000-8000-0000006010a1'
      and published_at is null),
  0,
  'der Sync-Trigger hat JEDE Zuweisung der Version mitgestempelt'
);

select is(
  (select count(*)::int from public.assignments
    where plan_version_id = '00000000-0000-4000-8000-0000006010a1'),
  1,
  'und es gab ueberhaupt eine Zuweisung — sonst waere die Zeile darueber vakuos'
);

-- Unveraenderlichkeit greift ab jetzt (0010). Hier 23514 statt 42501: der
-- Eigentuemer hat volle Spaltenrechte, also entscheidet der Trigger.
select throws_ok(
  $$update public.plan_versions
       set week_key = '2026-W33'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '23514'
);

-- --------------------------------------------------------------------------
-- Die Invariante gilt auch OHNE Anwendungsidentitaet (Befund F2)
-- --------------------------------------------------------------------------
-- `app.reject_assignment_in_published_plan()` ist seit dem P1-Fix
-- `security definer` und filterte im ersten Wurf ausnahmslos auf
-- `pv.org_id in (select app.user_org_ids())`. Das war zu breit: ohne
-- JWT-Claims liefert `auth.uid()` NULL, `user_org_ids()` die leere Menge, der
-- Zweig „nicht gefunden heisst fremder Mandant" greift — und die Zuweisung
-- laeuft durch.
--
-- Vorher (invoker, als `postgres` mit BYPASSRLS) fand das `for share` die
-- Zeile und lehnte ab. Der Fix haette also eine Invariante verengt, die es
-- schon gab: Wartungszugriffe per psql, Migrationsskripte und Seeds haetten
-- ohne Warnung in eine veroeffentlichte Planversion schreiben koennen.
--
-- Hier wird genau dieser Fall gefahren: Claims leeren, dann als Eigentuemer
-- einfuegen. Ohne die Bedingung `auth.uid() is null or …` in 0015 ist diese
-- Zeile gruen-falsch.
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-06T06:00:00Z', '2026-08-06T14:00:00Z')$$,
  '23514'
);

-- ===========================================================================
-- 5. Cross-Tenant: fremde Organisation bleibt unberuehrt
-- ===========================================================================
select is(
  (select published_at from public.plan_versions
    where id = '00000000-0000-4000-8000-0000006020b2'),
  null,
  'die Planversion der fremden Organisation ist unveraendert Entwurf'
);

select * from finish();
rollback;
