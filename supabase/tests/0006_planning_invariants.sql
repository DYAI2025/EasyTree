-- pgTAP: Planungsinvarianten als SQL-Vertraege (EYT-49).
--
-- Muster wie 0002/0004: Rollenwechsel wie im echten API-Pfad, also
-- `set local role authenticated` plus `request.jwt.claims` je Transaktion.
--
-- Was diese Datei NICHT leisten kann: Nebenlaeufigkeit. pgTAP laeuft in EINER
-- Session, und zwei gleichzeitige Transaktionen sind der einzige Weg, den
-- EXCLUDE-Constraint als Sperre statt als Pruefung zu zeigen. Dafuer gibt es
-- apps/api/test/planning-invariants.integration.test.ts mit zwei echten
-- Verbindungen; EYT-49 AK6 stuetzt sich auf beide Dateien zusammen.

begin;
-- 26 statt 24 seit EYT-136, in zwei Schritten:
--   +1  das Verschieben einer veroeffentlichten Zuweisung zerfaellt jetzt in
--       zwei Aussagen — fehlendes Recht (42501) und Trigger (23514) —, damit
--       die urspruengliche Trigger-Aussage nicht im Rechteentzug verschwindet.
--   +1  die Kanalmatrix vom 08.08.2026 hat einen verlorenen Nachweis gefunden
--       (`security definer` auf app.reject_assignment_in_published_plan()) und
--       setzt an seine Stelle eine strukturelle Zusicherung; die Begruendung
--       steht bei ihr, im Abschnitt „dieser Fall hat seinen Kanal gewechselt".
select plan(26);

-- ===========================================================================
-- Schemaform
-- ===========================================================================
select is(
  (
    select count(*)::int
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'assignments'
      and c.conname = 'assignments_no_published_overlap'
      and c.contype = 'x'
  ),
  1,
  'assignments traegt einen EXCLUDE-Constraint gegen veroeffentlichte Ueberlappung'
);

select has_trigger('public', 'plan_versions', 'plan_versions_publish_assignments',
  'plan_versions setzt beim Veroeffentlichen die Marker der Zuweisungen');
select has_trigger('public', 'plan_versions', 'plan_versions_published_immutable',
  'plan_versions schuetzt veroeffentlichte Revisionen');
select has_trigger('public', 'assignments', 'assignments_published_immutable',
  'assignments schuetzt veroeffentlichte Zeilen');
select has_trigger('public', 'assignments', 'assignments_reject_published_plan',
  'assignments weist Zugang zu veroeffentlichten Planversionen ab');

-- published_at darf nicht mehr direkt geschrieben werden. Ohne diesen Entzug
-- waere der partielle EXCLUDE umgehbar: wer den Marker loescht, nimmt die
-- Zeile aus dem Geltungsbereich.
select is(
  has_column_privilege('authenticated', 'public.assignments', 'published_at', 'update'),
  false,
  'authenticated darf assignments.published_at NICHT direkt setzen'
);

-- EYT-136: diese Zeile war die Gegenprobe zur Zeile darueber — sie stellte
-- sicher, dass „published_at ist nicht aenderbar" nicht bloss deshalb gruen
-- ist, weil ueberhaupt kein update-Recht mehr existiert.
--
-- Genau dieser Fall ist jetzt eingetreten, und zwar absichtlich: Migration 0017
-- entzieht `authenticated` das update auf `assignments` vollstaendig, weil kein
-- Produktionspfad eines benutzt. Die Aussage der Zeile darueber ist damit
-- tatsaechlich vakuos geworden — und wird hier durch die STAERKERE ersetzt,
-- statt sie stillschweigend stehen zu lassen.
--
-- Die Nicht-Vakuositaet des Spaltenmodells traegt ab jetzt die insert-Seite
-- weiter unten (`starts_at_utc` ja, `published_at` nein) sowie 0012 A1/A3.
select is(
  has_column_privilege('authenticated', 'public.assignments', 'starts_at_utc', 'update'),
  false,
  'authenticated darf assignments GAR NICHT mehr aendern — auch keine Fachspalte (EYT-136)'
);

-- Dasselbe fuer insert. Ohne den Entzug koennte der Marker beim ANLEGEN
-- mitgeliefert werden: die Zeile naehme sofort am EXCLUDE teil und waere
-- danach unveraenderlich und unloeschbar — ein Wert, den niemand mehr
-- korrigieren kann.
select is(
  has_column_privilege('authenticated', 'public.assignments', 'published_at', 'insert'),
  false,
  'authenticated darf assignments.published_at NICHT beim Anlegen mitgeben'
);

select is(
  has_column_privilege('authenticated', 'public.assignments', 'starts_at_utc', 'insert'),
  true,
  'authenticated darf assignments anlegen — nur den Marker nicht mitliefern'
);

-- ===========================================================================
-- Kontext: User A, aktiv in Org Alpha
-- ===========================================================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000aaa1', 'role', 'authenticated')::text,
  true
);

-- ---------------------------------------------------------------------------
-- EYT-136: die naechsten beiden Faelle laufen auf dem EIGENTUEMERPFAD
-- ---------------------------------------------------------------------------
-- Bis EYT-136 liefen sie unter `set local role authenticated`. Das geht nicht
-- mehr, und der Grund ist der Zweck dieses Tickets: `assignments_insert_in_org`
-- verlangt seit Migration 0017 `app.is_runtime_channel()`, und `authenticated`
-- hat gar kein `delete`-Recht mehr. In pgTAP ist `session_user` immer
-- `postgres` — `SET SESSION AUTHORIZATION` braucht Superuser —, also ist diese
-- Sitzung nie der Laufzeitkanal.
--
-- Was die beiden Faelle beweisen, ist davon unberuehrt: sie sind Aussagen ueber
-- den partiellen EXCLUDE aus 0010 und ueber den Unveraenderlichkeitstrigger,
-- nicht ueber den Client-Kanal. Constraints und Trigger feuern fuer den
-- Eigentuemer unveraendert. Die Erzeugung ist damit Fixture-Arbeit, und dafuer
-- ist der privilegierte Pfad zulaessig.
--
-- Die Kanalgrenze selbst wird nicht hier gemessen, sondern in
-- `0012_planning_data_api_boundary.sql` (C1 bis C4) und ueber eine echte
-- `easytree_app`-Verbindung in `planning-write.integration.test.ts`.

-- ---------------------------------------------------------------------------
-- Entwuerfe duerfen sich ueberschneiden — das ist ihr Zweck
-- ---------------------------------------------------------------------------
-- Der Seed haelt fuer Alpha eine Schicht 06:00-14:00 UTC im Entwurf 2026-W32.
select lives_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-03T10:00:00Z', '2026-08-03T18:00:00Z')$$,
  'Zwei ueberlappende ENTWURFS-Zuweisungen derselben Person sind erlaubt'
);

-- ---------------------------------------------------------------------------
-- Veroeffentlichen setzt beide Marker in derselben Transaktion
-- ---------------------------------------------------------------------------
-- Zuerst die eben angelegte Ueberlappung wieder entfernen, sonst scheitert die
-- Veroeffentlichung an genau dem Constraint, der weiter unten geprueft wird.
select lives_ok(
  $$delete from public.assignments
    where org_id = '00000000-0000-4000-8000-0000000000a1'
      and starts_at_utc = '2026-08-03T10:00:00Z'$$,
  'Eine unveroeffentlichte Zuweisung laesst sich loeschen'
);

-- ---------------------------------------------------------------------------
-- Veroeffentlichen laeuft hier ueber den EIGENTUEMERPFAD (EYT-107 P1)
-- ---------------------------------------------------------------------------
-- Seit dem P1-Fix verlangt `plan_versions_update_in_org` zusaetzlich den
-- Laufzeitkanal (`app.is_runtime_channel()`, also `session_user =
-- 'easytree_app'`). Die Sitzung dieser Datei ist `postgres`, und
-- `SET SESSION AUTHORIZATION` steht nicht zur Verfuegung — `postgres` ist in
-- Supabase kein Superuser. Ueber `authenticated` bewirkt ein UPDATE hier
-- deshalb nichts mehr, und die Folgeaussagen dieser Datei waeren still vakuos.
--
-- Diese Datei misst die 0010-Mechanik: Sync-Trigger, Unveraenderlichkeit,
-- EXCLUDE. Die gelten unabhaengig von RLS, also wird fuer die
-- Publish-Anweisungen kurz auf den Eigentuemer zurueckgeschaltet. Die
-- Kanalgrenze selbst beweist `0011_planning_publish.sql`, den echten
-- Serverpfad `planning-publish.integration.test.ts`.
reset role;

select lives_ok(
  $$update public.plan_versions
       set published_at = '2026-07-31T12:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  'Eine Planversion laesst sich veroeffentlichen'
);

set local role authenticated;

select is(
  (
    select published_at
    from public.assignments
    where id = '00000000-0000-4000-8000-0000007010a1'
  ),
  timestamptz '2026-07-31T12:00:00Z',
  'Die Zuweisung traegt danach denselben Veroeffentlichungszeitpunkt — ein Vorgang, nicht zwei'
);

-- ---------------------------------------------------------------------------
-- Veroeffentlichtes ist unveraenderlich
-- ---------------------------------------------------------------------------
-- Zwei getrennte Aussagen, weil seit EYT-107 P1 zwei verschiedene Mechanismen
-- greifen und die Reihenfolge bedeutungstragend ist.
--
-- (a) Ueber `authenticated`: das Spaltenrecht endet bei published_at und
--     published_by. `week_key` ist gar nicht erst adressierbar — 42501 wird
--     VOR der Zeilenauswahl und vor jedem Trigger geprueft. Frueher stand hier
--     23514, weil `authenticated` das volle Tabellen-UPDATE besass; genau das
--     war die Haelfte des P1-Befunds.
-- ZWEIstellig (sql, errcode): PostgreSQL formuliert fehlende Spaltenrechte je
-- nach Version als „permission denied for column …" oder „… for table …". Der
-- SQLSTATE ist in beiden Faellen 42501 und die stabilere Aussage.
select throws_ok(
  $$update public.plan_versions set week_key = '2026-W33'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '42501'
);

-- (b) Ueber den Eigentuemer, der volle Spaltenrechte hat: jetzt entscheidet
--     der Unveraenderlichkeits-Trigger aus 0010. Ohne diese Zeile waere nach
--     dem P1-Fix nicht mehr belegt, dass er ueberhaupt noch feuert.
reset role;

select throws_ok(
  $$update public.plan_versions set week_key = '2026-W33'
     where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '23514',
  'Veroeffentlichte Zeile in public.plan_versions ist unveraenderlich',
  'Eine veroeffentlichte Planversion laesst sich nicht aendern'
);

set local role authenticated;

-- Auch das Loeschen zerfaellt seit dem Reviewbefund F3 (04.08.2026) in zwei
-- Aussagen. `authenticated` besitzt gar kein delete-Recht mehr auf
-- plan_versions: kein Anwendungspfad loescht Planversionen, und ueber die
-- Data-API haette jedes Mitglied einen Entwurf samt seiner Zuweisungen
-- entfernen koennen (`on delete cascade`, 0007). Der Trigger schuetzte nur das
-- Veroeffentlichte.
select throws_ok(
  $$delete from public.plan_versions where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '42501'
);

-- Und der Trigger aus 0010, dort wo das Recht nicht mehr im Weg steht.
reset role;

select throws_ok(
  $$delete from public.plan_versions where id = '00000000-0000-4000-8000-0000006010a1'$$,
  '23514',
  'Veroeffentlichte Zeile in public.plan_versions ist unveraenderlich und kann nicht geloescht werden',
  'Eine veroeffentlichte Planversion laesst sich nicht loeschen'
);

set local role authenticated;

-- EYT-136: dieselbe Zweiteilung wie beim Loeschen von plan_versions darueber.
-- Erst das RECHT — `authenticated` besitzt seit 0017 kein update auf
-- assignments mehr, weil kein Anwendungspfad eines benutzt.
select throws_ok(
  $$update public.assignments set starts_at_utc = '2026-08-03T05:00:00Z'
     where id = '00000000-0000-4000-8000-0000007010a1'$$,
  '42501'
);

-- Und dann der TRIGGER aus 0010, dort wo das Recht nicht mehr im Weg steht.
-- Ohne diesen zweiten Teil waere die urspruengliche Aussage verloren: dass
-- eine veroeffentlichte Zuweisung unveraenderlich ist, haengt nicht am
-- Spaltenrecht, sondern an `app.reject_published_row_change()`.
reset role;

select throws_ok(
  $$update public.assignments set starts_at_utc = '2026-08-03T05:00:00Z'
     where id = '00000000-0000-4000-8000-0000007010a1'$$,
  '23514',
  'Veroeffentlichte Zeile in public.assignments ist unveraenderlich',
  'Eine veroeffentlichte Zuweisung laesst sich nicht nachtraeglich verschieben'
);

-- ---------------------------------------------------------------------------
-- EYT-136: dieser Fall hat seinen Kanal gewechselt — und dabei etwas verloren
-- ---------------------------------------------------------------------------
-- Bis hierher lief er ueber `authenticated` und trug damit eine ZWEITE Last:
-- `app.reject_assignment_in_published_plan()` liest die Elternzeile mit
-- `for share`, und PostgreSQL prueft bei einer Sperrklausel zusaetzlich die
-- `using`-Klausel der UPDATE-Policy. Ohne `security definer` (0015) faende das
-- select nichts, der Zweig „nicht gefunden" liesse die Zuweisung durch — und
-- der Test waere gruen-falsch. Genau so fiel er am 04.08.2026 in Lauf
-- 30862744360 auf.
--
-- Seit Migration 0017 lehnt die INSERT-Policy schon VOR dem Trigger ab (42501,
-- fehlender Laufzeitkanal). Der Trigger kaeme gar nicht mehr zum Zug, die
-- Definer-Aussage ist hier also nicht mehr messbar.
--
-- KORREKTUR DER ERSTEN FASSUNG (Kanalmatrix 08.08.2026,
-- docs/reviews/2026-08-08-eyt-136-kanalmatrix.md, Befund B1). Hier stand, die
-- Aussage sei nach `apps/api/test/planning-write.integration.test.ts`
-- umgezogen. Das trifft nicht zu, und der Grund ist nachlesbar statt vermutet:
-- der dortige Fall „eine veroeffentlichte Planversion nimmt ueber den
-- Laufzeitkanal keine Zuweisung mehr auf" laeuft IM Laufzeitkanal mit einem
-- Subjekt, das `planning.publish` traegt (USER_A ist owner in Alpha, seed.sql
-- Z. 46; 0015 Z. 182-184 gibt owner alle drei Planungsrechte). Damit ist die
-- `using`-Klausel von `plan_versions_update_in_org` erfuellt, das `for share`
-- faende die Elternzeile auch als INVOKER — die Definer-Eigenschaft wird dort
-- weder gebraucht noch gemessen. Der Fall beweist den Trigger, nicht den
-- Definer.
--
-- Im STATISCHEN Rechtemodell ist der behaviourale Nachweis nirgends
-- erreichbar. Er braeuchte eine Sitzung, die die Insert-Policy passiert
-- (Laufzeitkanal UND `planning.write`) und zugleich an der using-Klausel der
-- Update-Policy scheitert (`planning.publish` fehlt). `role_permissions`
-- vergibt beide Rechte an dieselben zwei Rollen — owner und manager (0015
-- Z. 181-187) —, `member` bekommt keines.
--
-- Der Schluss „also ist er ueberhaupt nicht messbar" waere aber einer zu
-- weit, und eine erste Fassung dieses Kommentars zog ihn: ein Test muss das
-- Subjekt nicht FINDEN, er kann das Modell fuer die Dauer eines Falls
-- HERSTELLEN. Genau das tut `apps/api/test/planning-write.integration.test.ts`
-- seit dem 08.08.2026. Die Klammer `ohnePublishRecht` (dort Z. 547) entzieht
-- die eine Zeile ('owner','planning.publish') aus `role_permissions` und
-- stellt sie unbedingt wieder her; der Fall „eine veroeffentlichte
-- Planversion weist die Zuweisung auch ab, wenn die Sitzung sie nicht
-- sperrend lesen darf" (dort Z. 1553) laeuft im Laufzeitkanal mit
-- `planning.write`, misst `lesbar=1` bei `sperrlesbar=0` und verlangt
-- weiterhin 23514 (dort Z. 1710-1712).
--
-- Was hier bleibt, ist deshalb ZWEIERLEI, und es wird getrennt benannt statt
-- vermischt:
--   (a) eine STRUKTURELLE Zusicherung, direkt hier. Sie ist ein Stolperdraht,
--       kein Verhaltensbeweis, und wird auch so bezeichnet. Gegenmutation:
--       die Funktion als `security invoker` neu anlegen. AUSGEFUEHRT, in drei
--       Laeufen: 31238661331 (diese Zeile rot, `have: false / want: true`),
--       31238804687 (isoliert, fiel weiterhin strukturell) und 31239527407,
--       in dem der Verhaltensfall oben rot wurde — der Insert lief durch,
--       `fehler` war null, kein 23514.
--   (b) die Trigger-Aussage selbst, danach, auf dem Eigentuemerpfad.
select is(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname = 'reject_assignment_in_published_plan'
  ),
  true,
  'app.reject_assignment_in_published_plan() ist security definer — Stolperdraht; den Verhaltensnachweis fuehrt planning-write.integration.test.ts (EYT-136)'
);

select throws_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006010a1',
            '00000000-0000-4000-8000-0000004011a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-04T06:00:00Z', '2026-08-04T14:00:00Z')$$,
  '23514',
  'Planversion 00000000-0000-4000-8000-0000006010a1 ist veroeffentlicht und nimmt keine Zuweisung mehr auf',
  'Eine veroeffentlichte Planversion nimmt keine weitere Zuweisung auf'
);

-- ---------------------------------------------------------------------------
-- Der EXCLUDE greift beim Veroeffentlichen der ZWEITEN Version
-- ---------------------------------------------------------------------------
-- Der realistische Weg: Woche 32 hat jetzt eine veroeffentlichte Version. Eine
-- neue Entwurfsversion derselben Woche ist erlaubt (der partielle Unique-Index
-- aus 0007 gilt nur fuer Entwuerfe). Ihre ueberlappende Zuweisung ist als
-- Entwurf ebenfalls erlaubt — und faellt erst in dem Moment auf, in dem sie
-- verbindlich werden soll.
select lives_ok(
  $$insert into public.plan_versions (id, org_id, week_key)
    values ('00000000-0000-4000-8000-0000006099a1',
            '00000000-0000-4000-8000-0000000000a1', '2026-W32')$$,
  'Nach der Veroeffentlichung ist ein neuer Entwurf derselben Woche erlaubt'
);

select lives_ok(
  $$insert into public.assignments
      (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000007099a1',
            '00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006099a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-08-03T10:00:00Z', '2026-08-03T18:00:00Z')$$,
  'Die kollidierende Zuweisung ist als Entwurf erlaubt'
);

-- Wieder Eigentuemerpfad, gleiche Begruendung wie oben: gemessen wird der
-- EXCLUDE, nicht die Kanalgrenze.
reset role;

select throws_ok(
  $$update public.plan_versions
       set published_at = '2026-07-31T13:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006099a1'$$,
  '23P01',
  'conflicting key value violates exclusion constraint "assignments_no_published_overlap"',
  'Die zweite Veroeffentlichung scheitert an der Ueberlappung derselben Person'
);

-- Gegenprobe zur Halboffenheit: direkt anschliessend, nicht ueberlappend.
-- Ohne diese Zeile waere der Constraint auch dann gruen, wenn er JEDE zweite
-- Veroeffentlichung ablehnt.
--
-- EYT-136: Eigentuemerpfad. Gemessen wird die Halboffenheit des EXCLUDE, nicht
-- der Client-Kanal; `authenticated` hat seit 0017 ohnehin kein update-Recht
-- auf assignments mehr (belegt weiter oben mit 42501).
select lives_ok(
  $$update public.assignments
       set starts_at_utc = '2026-08-03T14:00:00Z', ends_at_utc = '2026-08-03T18:00:00Z'
     where id = '00000000-0000-4000-8000-0000007099a1'$$,
  'Die kollidierende Zuweisung laesst sich auf einen anschliessenden Zeitraum verschieben'
);

select lives_ok(
  $$update public.plan_versions
       set published_at = '2026-07-31T13:00:00Z',
           published_by = '00000000-0000-4000-8000-00000000aaa1'
     where id = '00000000-0000-4000-8000-0000006099a1'$$,
  'Ein anschliessender Zeitraum (14:00 nach 06:00-14:00) ist kein Konflikt — halboffen wie im Domainmodell'
);

select * from finish();
rollback;
