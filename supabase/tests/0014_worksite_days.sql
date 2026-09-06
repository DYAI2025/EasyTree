-- 0014_worksite_days — Datenfundament der baustellenzentrierten Planung (EYT-147, M1)
--
-- ## Was hier gemessen wird
--
-- Migration 0019 legt die stabile Tagesidentitaet `public.worksite_days` und den
-- revisionsgebundenen Tagesstand `public.worksite_day_configurations` an, ordnet
-- `assignments` additiv unter eine Tageskonfiguration, ergaenzt
-- `idempotency_records.result_payload` samt Lesegrenze und stellt drei neue
-- `app`-Funktionen bereit.
--
-- ## Warum die Struktur VOR dem Verhalten steht
--
-- Die Abschnitte A bis D fragen ausschliesslich den Systemkatalog und werfen
-- deshalb auch dann keinen Fehler, wenn die Objekte fehlen — sie melden `not ok`.
-- Genau das ist der rote Ausgangszustand dieses Meilensteins: einzeln benannte
-- Fehlschlaege statt eines einzigen Abbruchs, aus dem sich nichts lesen liesse.
-- Erst Abschnitt E benutzt `has_column_privilege` (das wirft bei fehlender
-- Spalte und beendet den Lauf), Abschnitt F legt die Fixtures an.
--
-- ## Welche Zusicherungen schon VOR 0019 wahr waren
--
-- GEMESSEN, indem die Migration beiseitegelegt und `db reset` gefahren wurde:
-- ein durchgehender Lauf meldet 44 rote und FUENF gruene Zusicherungen — B5, B7,
-- B8, C8, C9 —, danach bricht er bei E1 ab (`column "result_payload" … does not
-- exist`). Drei weitere sind hinter der Abbruchstelle ebenfalls vorher gruen und
-- deshalb nur EINZELN messbar: E2, J0 und K2.
--
-- Diese acht sagen nichts ueber 0019; sie sind PRESERVATION-Waechter und sollen
-- vor UND nach der Migration halten. Jede andere Zusicherung dieser Datei ist im
-- Vor-Zustand rot. Wer eine neunte vorher-gruene findet, hat eine vakuoese
-- Zusicherung gefunden.
--
-- ## Warum der Kanal hier nur NEGATIV pruefbar ist
--
-- `app.is_runtime_channel()` vergleicht `session_user` mit `easytree_app`. In
-- pgTAP ist `session_user` immer `postgres`; `SET SESSION AUTHORIZATION` verlangt
-- Superuser und steht hier nicht zur Verfuegung (dieselbe Lage wie in
-- `0012_planning_data_api_boundary.sql`). Diese Datei belegt deshalb, dass ein
-- NICHT-Laufzeitkanal abgewiesen wird. Sie belegt NICHT, dass der echte Kanal
-- durchkommt, und sie erreicht die Zweige `P0002` und `23514` von
-- `app.remove_assignment_from_worksite_day` nicht — der Kanalriegel steht davor.
-- Diese Nachweise liegen in M3/M4 ueber eine echte `easytree_app`-Verbindung.
--
-- ## Warum die Rechte ueber `aclexplode` und nicht ueber `has_*_privilege`
--
-- `has_column_privilege` ist wahr, sobald IRGENDEIN Weg das Recht traegt, und
-- beantwortet je Spalte nur eine Ja/Nein-Frage. Die Zusicherung dieses Slices ist
-- aber eine MENGENgleichheit: genau diese Spalten und keine weitere. `aclexplode`
-- ueber `pg_attribute.attacl` liefert die Menge selbst — eine spaeter zusaetzlich
-- gegrantete Spalte faellt damit auf, waehrend eine Reihe von Einzelfragen sie
-- nicht sehen wuerde. Abschnitt E fuehrt die vom Plan woertlich verlangten
-- `has_column_privilege`-Zusicherungen zusaetzlich, nicht ersatzweise.

begin;
select plan(80);

-- ===========================================================================
-- A. Struktur beider neuer Tabellen (katalogbasiert, wirft nie)
-- ===========================================================================

-- A1/A2: die Spaltenmenge EXAKT — das ist zugleich der Nachweis der beiden
-- Negativvorgaben aus dem Plan: keine Zeitspalten, kein eigener Publish-Marker,
-- keine vorgezogenen EYT-120-Felder. Eine Einzelfrage je erwarteter Spalte
-- koennte das nicht sagen.
select is(
  (
    select coalesce(array_agg(
             a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' NOT NULL' else ' NULL' end
             order by a.attnum), array[]::text[])
    from pg_attribute a
    where a.attrelid = to_regclass('public.worksite_days')
      and a.attnum > 0 and not a.attisdropped
  ),
  array[
    'id uuid NOT NULL',
    'org_id uuid NOT NULL',
    'worksite_id uuid NOT NULL',
    'local_date date NOT NULL',
    'created_at timestamp with time zone NOT NULL'
  ],
  'A1 worksite_days traegt exakt die fuenf Identitaetsspalten — keine Zeiten, kein Publish-Marker, kein EYT-120-Feld'
);

select is(
  (
    select coalesce(array_agg(
             a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' NOT NULL' else ' NULL' end
             order by a.attnum), array[]::text[])
    from pg_attribute a
    where a.attrelid = to_regclass('public.worksite_day_configurations')
      and a.attnum > 0 and not a.attisdropped
  ),
  array[
    'id uuid NOT NULL',
    'org_id uuid NOT NULL',
    'worksite_day_id uuid NOT NULL',
    'plan_version_id uuid NOT NULL',
    'lock_version integer NOT NULL',
    'created_at timestamp with time zone NOT NULL'
  ],
  'A2 worksite_day_configurations traegt exakt die sechs Revisionsspalten — keine Taetigkeiten, Ressourcen, Status-, Default- oder Zeitraumfelder'
);

-- A3/A4: Constraints EXAKT, inklusive der beiden Identitaetsgarantien I-3 und
-- I-4 und der tenantgebundenen Fremdschluessel. Gemessen (PostgreSQL 17.6,
-- lokaler Stack, Probetabellen, Transaktion zurueckgerollt): der laengste
-- generierte Name ist `worksite_day_configurations_plan_version_id_worksite_day_id_key`
-- mit 63 Zeichen und wird damit NICHT abgeschnitten (NAMEDATALEN-1 = 63).
select is(
  (
    select coalesce(array_agg(c.conname::text || ' :: ' || pg_get_constraintdef(c.oid)
                              order by c.conname::text), array[]::text[])
    from pg_constraint c
    where c.conrelid = to_regclass('public.worksite_days')
  ),
  array[
    'worksite_days_id_org_id_key :: UNIQUE (id, org_id)',
    'worksite_days_org_id_fkey :: FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE',
    'worksite_days_org_id_worksite_id_local_date_key :: UNIQUE (org_id, worksite_id, local_date)',
    'worksite_days_pkey :: PRIMARY KEY (id)',
    'worksite_days_worksite_id_org_id_fkey :: FOREIGN KEY (worksite_id, org_id) REFERENCES worksites(id, org_id) ON DELETE RESTRICT'
  ],
  'A3 worksite_days: I-4 (org_id, worksite_id, local_date) unique, (id, org_id) unique als FK-Ziel, tenantgebundene Worksite-FK mit RESTRICT'
);

select is(
  (
    select coalesce(array_agg(c.conname::text || ' :: ' || pg_get_constraintdef(c.oid)
                              order by c.conname::text), array[]::text[])
    from pg_constraint c
    where c.conrelid = to_regclass('public.worksite_day_configurations')
  ),
  array[
    'worksite_day_configurations_id_org_id_key :: UNIQUE (id, org_id)',
    'worksite_day_configurations_lock_version_check :: CHECK ((lock_version >= 0))',
    'worksite_day_configurations_org_id_fkey :: FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE',
    'worksite_day_configurations_pkey :: PRIMARY KEY (id)',
    'worksite_day_configurations_plan_version_id_org_id_fkey :: FOREIGN KEY (plan_version_id, org_id) REFERENCES plan_versions(id, org_id) ON DELETE CASCADE',
    'worksite_day_configurations_plan_version_id_worksite_day_id_key :: UNIQUE (plan_version_id, worksite_day_id)',
    'worksite_day_configurations_worksite_day_id_org_id_fkey :: FOREIGN KEY (worksite_day_id, org_id) REFERENCES worksite_days(id, org_id)'
  ],
  'A4 worksite_day_configurations: I-3 (plan_version_id, worksite_day_id) unique, tenantgebundene FKs, Kaskade NUR an plan_versions'
);

select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname::text), array[]::text[])
    from pg_index i join pg_class c on c.oid = i.indexrelid
    where i.indrelid = to_regclass('public.worksite_day_configurations')
      and not i.indisunique and not i.indisprimary
  ),
  array['worksite_day_configurations_day_idx', 'worksite_day_configurations_version_idx'],
  'A5 worksite_day_configurations traegt die beiden Leseindizes auf Planversion und Tag'
);

-- A5b: der Leseindex auf der Assignment-Seite. A5 zaehlt nur die beiden Indizes
-- AUF worksite_day_configurations und saehe sein Verschwinden nicht.
select is(
  (
    select count(*)::int
    from pg_index i join pg_class c on c.oid = i.indexrelid
    where i.indrelid = to_regclass('public.assignments')
      and c.relname = 'assignments_worksite_day_configuration_idx'
  ),
  1,
  'A5b assignments traegt den Leseindex auf worksite_day_configuration_id'
);

-- A6: die additive Assignment-Spalte. NULLABLE ist die Aussage — Bestandszeilen
-- werden nicht angefasst, und ein Backfill findet nicht statt.
select is(
  (
    select a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' NOT NULL' else ' NULL' end
    from pg_attribute a
    where a.attrelid = to_regclass('public.assignments')
      and a.attname = 'worksite_day_configuration_id' and not a.attisdropped
  ),
  'worksite_day_configuration_id uuid NULL',
  'A6 assignments.worksite_day_configuration_id ist additiv und NULLABLE — Bestandszeilen bleiben gueltig'
);

select is(
  (
    select pg_get_constraintdef(c.oid)
    from pg_constraint c
    where c.conrelid = to_regclass('public.assignments')
      and c.conname = 'assignments_worksite_day_configuration_fk'
  ),
  'FOREIGN KEY (worksite_day_configuration_id, org_id) REFERENCES worksite_day_configurations(id, org_id)',
  'A7 assignments: tenantgebundene FK auf die Tageskonfiguration, ohne Kaskade'
);

select is(
  (
    select a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
           || case when a.attnotnull then ' NOT NULL' else ' NULL' end
    from pg_attribute a
    where a.attrelid = to_regclass('public.idempotency_records')
      and a.attname = 'result_payload' and not a.attisdropped
  ),
  'result_payload jsonb NULL',
  'A8 idempotency_records.result_payload ist additiv und NULLABLE — Bestandsvorgaenge bleiben schreibbar'
);

-- A9: die beiden Pflicht-Checks auf result_payload. Der zweite ist der
-- eigentliche Riegel: ein payloadloser Insert der neuen Vorgaenge ist 23514,
-- nicht ein stiller Zustand, in dem ein Replay weder reproduzieren noch ehrlich
-- scheitern koennte.
select is(
  (
    select coalesce(array_agg(c.conname::text order by c.conname::text), array[]::text[])
    from pg_constraint c
    where c.conrelid = to_regclass('public.idempotency_records')
      and c.contype = 'c'
      and c.conname like 'idempotency_records_%payload%'
  ),
  array['idempotency_records_result_payload_is_object',
        'idempotency_records_worksite_day_ops_need_payload'],
  'A9 idempotency_records: Objektform UND Payloadpflicht der beiden WorksiteDay-Vorgaenge sind Datenbankregeln'
);

-- ===========================================================================
-- B. Rechtelage als MENGE (katalogbasiert ueber aclexplode, wirft nie)
-- ===========================================================================

select is(
  (
    select coalesce(array_agg(a.attname::text order by a.attname::text), array[]::text[])
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) ac
    where a.attrelid = to_regclass('public.worksite_days')
      and ac.grantee = 'authenticated'::regrole and ac.privilege_type = 'INSERT'
  ),
  array['local_date', 'org_id', 'worksite_id'],
  'B1 worksite_days: INSERT erreicht exakt (org_id, worksite_id, local_date) — id und created_at bleiben der Datenbank'
);

select is(
  (
    select coalesce(array_agg(a.attname::text order by a.attname::text), array[]::text[])
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) ac
    where a.attrelid = to_regclass('public.worksite_day_configurations')
      and ac.grantee = 'authenticated'::regrole and ac.privilege_type = 'INSERT'
  ),
  array['lock_version', 'org_id', 'plan_version_id', 'worksite_day_id'],
  'B2 worksite_day_configurations: INSERT erreicht exakt die vier fachlichen Spalten'
);

select is(
  (
    select coalesce(array_agg(a.attname::text order by a.attname::text), array[]::text[])
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) ac
    where a.attrelid = to_regclass('public.worksite_day_configurations')
      and ac.grantee = 'authenticated'::regrole and ac.privilege_type = 'UPDATE'
  ),
  array['lock_version'],
  'B3 worksite_day_configurations: UPDATE erreicht ausschliesslich lock_version'
);

-- B4: kein DELETE auf beiden neuen Tabellen. `delete` kennt kein Spaltenrecht,
-- die Frage geht deshalb an relacl.
select is(
  (
    select coalesce(array_agg(c.relname::text || ':' || ac.privilege_type order by c.relname::text, ac.privilege_type), array[]::text[])
    from pg_class c
    cross join lateral aclexplode(c.relacl) ac
    where c.oid in (to_regclass('public.worksite_days'), to_regclass('public.worksite_day_configurations'))
      and ac.grantee = 'authenticated'::regrole
  ),
  array['worksite_day_configurations:SELECT', 'worksite_days:SELECT'],
  'B4 beide neuen Tabellen: auf Tabellenebene traegt authenticated NUR select — kein delete, kein pauschales insert/update'
);

select is(
  (
    select coalesce(array_agg(c.relname::text || ':' || ac.privilege_type order by c.relname::text, ac.privilege_type), array[]::text[])
    from pg_class c
    cross join lateral aclexplode(c.relacl) ac
    where c.oid in (to_regclass('public.worksite_days'), to_regclass('public.worksite_day_configurations'))
      and ac.grantee = 'anon'::regrole
  ),
  array[]::text[],
  'B5 beide neuen Tabellen: anon traegt kein einziges Recht'
);

-- B6/B7: der 0017-Grantumfang auf assignments waechst um GENAU eine Spalte.
select is(
  (
    select coalesce(array_agg(a.attname::text order by a.attname::text), array[]::text[])
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) ac
    where a.attrelid = to_regclass('public.assignments')
      and ac.grantee = 'authenticated'::regrole and ac.privilege_type = 'INSERT'
  ),
  array['employee_id', 'ends_at_utc', 'org_id', 'plan_version_id', 'starts_at_utc',
        'worksite_day_configuration_id', 'worksite_id'],
  'B6 assignments: der INSERT-Grant waechst um genau worksite_day_configuration_id — id bleibt draussen (0012 A4)'
);

-- Gefiltert auf die vier DML-Rechte, wie in 0005 Regel 4/5/7. Gemessen
-- (PostgreSQL 17.6, lokaler Stack nach 0019): `authenticated` traegt auf
-- `public.assignments` ausserdem MAINTAIN, REFERENCES, TRIGGER und TRUNCATE —
-- und zwar auf `public.plan_versions` genauso, also aus den Supabase-
-- Default-Privilegien und NICHT aus dieser Migration. Sie hier mitzuzaehlen
-- machte die Zusicherung zu einer Aussage ueber die Plattform statt ueber den
-- 0017-Grantumfang, den sie bewachen soll.
select is(
  (
    select coalesce(array_agg(distinct ac.privilege_type order by ac.privilege_type), array[]::text[])
    from pg_class c
    cross join lateral aclexplode(c.relacl) ac
    where c.oid = to_regclass('public.assignments') and ac.grantee = 'authenticated'::regrole
      and ac.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  array['SELECT'],
  'B7 assignments: von den vier DML-Rechten bleibt auf Tabellenebene NUR select — kein update-, kein delete-Grant (0012 A1/A2 bleiben wahr)'
);

select is(
  (
    select coalesce(array_agg(distinct ac.privilege_type order by ac.privilege_type), array[]::text[])
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) ac
    where a.attrelid = to_regclass('public.assignments')
      and ac.grantee = 'authenticated'::regrole and ac.privilege_type in ('UPDATE', 'DELETE')
  ),
  array[]::text[],
  'B8 assignments: auch spaltenweise traegt authenticated kein update- und kein delete-Recht'
);

-- B9/B10: die Lesegrenze des Payloads sitzt auf der SPALTE. Das Tabellenrecht
-- select ist entzogen, die uebrigen sieben Spalten sind einzeln gegrantet, und
-- result_payload ist in dieser Menge NICHT enthalten.
select is(
  (
    select coalesce(array_agg(a.attname::text order by a.attname::text), array[]::text[])
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) ac
    where a.attrelid = to_regclass('public.idempotency_records')
      and ac.grantee = 'authenticated'::regrole and ac.privilege_type = 'SELECT'
  ),
  array['created_at', 'id', 'idempotency_key', 'operation', 'org_id',
        'request_fingerprint', 'subject_id'],
  'B9 idempotency_records: SELECT ist spaltenweise vergeben und result_payload steht NICHT darin'
);

select is(
  (
    select coalesce(array_agg(distinct ac.privilege_type order by ac.privilege_type), array[]::text[])
    from pg_class c
    cross join lateral aclexplode(c.relacl) ac
    where c.oid = to_regclass('public.idempotency_records') and ac.grantee = 'authenticated'::regrole
      and ac.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  array['INSERT'],
  'B10 idempotency_records: von den vier DML-Rechten bleibt auf Tabellenebene NUR insert — select ist entzogen und spaltenweise neu vergeben, update und delete gab es nie'
);

-- ===========================================================================
-- C. Policy- und RLS-Lage (katalogbasiert, wirft nie)
-- ===========================================================================

select is(
  (
    select coalesce(array_agg(c.relname::text || ' rls=' || c.relrowsecurity::text
                              || ' forced=' || c.relforcerowsecurity::text
                              order by c.relname::text), array[]::text[])
    from pg_class c
    where c.oid in (to_regclass('public.worksite_days'), to_regclass('public.worksite_day_configurations'))
  ),
  array['worksite_day_configurations rls=true forced=true', 'worksite_days rls=true forced=true'],
  'C1 beide neuen Tabellen haben RLS aktiviert UND erzwungen'
);

select is(
  (
    select coalesce(array_agg(p.cmd::text order by p.cmd::text), array[]::text[])
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'worksite_days'
  ),
  array['INSERT', 'SELECT'],
  'C2 worksite_days: genau zwei Policies (select, insert) — keine update-, keine delete-Policy, die ein spaeteres grant reaktivieren koennte'
);

select is(
  (
    select coalesce(array_agg(p.cmd::text order by p.cmd::text), array[]::text[])
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'worksite_day_configurations'
  ),
  array['INSERT', 'SELECT', 'UPDATE'],
  'C3 worksite_day_configurations: genau drei Policies — keine delete-Policy'
);

select ok(
  (
    select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'worksite_days' and cmd = 'INSERT'
  ) like '%is_runtime_channel%',
  'C4 worksite_days: die INSERT-Policy prueft den Laufzeitkanal'
);

select ok(
  (
    select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'worksite_days' and cmd = 'INSERT'
  ) like '%planning.write%',
  'C5 worksite_days: die INSERT-Policy prueft das atomare Recht planning.write'
);

select ok(
  (
    select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'worksite_day_configurations' and cmd = 'INSERT'
  ) like '%is_runtime_channel%'
  and (
    select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'worksite_day_configurations' and cmd = 'INSERT'
  ) like '%planning.write%',
  'C6 worksite_day_configurations: die INSERT-Policy prueft Kanal UND planning.write'
);

-- C7 misst die beiden Klauseln EINZELN. Eine frueher Fassung verkettete
-- `qual || with_check` zu einem String und suchte darin — ein Treffer in nur
-- EINER Haelfte genuegte dann, obwohl der Zusicherungstext "in beiden Klauseln"
-- behauptet (Review-MESSUNG: eine UPDATE-Policy mit vollem `using`, aber
-- `with check (org_id in (…))` ohne Kanal und ohne Recht, blieb gruen).
select is(
  (
    select coalesce(array_agg(teil || '=' || (klausel like '%is_runtime_channel%'
                                              and klausel like '%planning.write%')::text
                              order by teil), array[]::text[])
    from (
      select 'qual' as teil, coalesce(qual, '') as klausel from pg_policies
       where schemaname = 'public' and tablename = 'worksite_day_configurations' and cmd = 'UPDATE'
      union all
      select 'with_check', coalesce(with_check, '') from pg_policies
       where schemaname = 'public' and tablename = 'worksite_day_configurations' and cmd = 'UPDATE'
    ) k
  ),
  array['qual=true', 'with_check=true'],
  'C7 worksite_day_configurations: die UPDATE-Policy prueft Kanal UND planning.write in JEDER der beiden Klauseln einzeln'
);

-- C4b/C5b: die MANDANTENGRENZE der beiden Lese-Policies. Sie ist dort das
-- EINZIGE Glied — ohne diese Zusicherung liesse sich `using (org_id in (select
-- app.user_org_ids()))` durch `using (true)` ersetzen, und ALLE 14 pgTAP-Dateien
-- des Repos blieben gruen (Review-MESSUNG, Gegenmutation in einer Transaktion).
select is(
  (
    select coalesce(array_agg(p.tablename::text || ' :: ' || coalesce(p.qual, '<null>')
                              order by p.tablename::text), array[]::text[])
    from pg_policies p
    where p.schemaname = 'public' and p.cmd = 'SELECT'
      and p.tablename in ('worksite_days', 'worksite_day_configurations')
  ),
  array[
    'worksite_day_configurations :: (org_id IN ( SELECT app.user_org_ids() AS user_org_ids))',
    'worksite_days :: (org_id IN ( SELECT app.user_org_ids() AS user_org_ids))'
  ],
  'C4b beide Lese-Policies binden woertlich an die aktiven Mitgliedschaften der Identitaet — hier ist die Mandantengrenze das einzige Glied'
);

-- C5b: und die INSERT-Policies tragen dasselbe Glied. Heute deckt
-- `app.has_permission(org_id, …)` denselben Mandanten mit ab; die Zusicherung
-- schuetzt die Tiefenverteidigung, nicht die heutige Grenze.
select is(
  (
    select count(*)::int from pg_policies
    where schemaname = 'public' and cmd = 'INSERT'
      and tablename in ('worksite_days', 'worksite_day_configurations')
      and coalesce(with_check, '') like '%org_id IN ( SELECT app.user_org_ids()%'
  ),
  2,
  'C5b beide INSERT-Policies binden zusaetzlich zu Kanal und Recht ausdruecklich an die Organisation'
);

-- C8: 0012 A/B-Erhalt an der Grenze. Genau EINE Schreibpolicy auf assignments —
-- keine zweite, die neben der 0017-Fassung stuende.
select is(
  (
    select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'assignments'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  1,
  'C8 assignments: es bleibt bei GENAU EINER Schreibpolicy (INSERT) — 0019 fuegt keine zweite hinzu'
);

-- C9: die SELECT-Policy von idempotency_records ist gegenueber 0012 woertlich
-- unveraendert. Die Grenze soll auf der Spalte sitzen (B9), nicht in der
-- Zeilenbedingung — sonst verschoebe sich unbemerkt, was 0012 zusichert.
select is(
  (
    select qual from pg_policies
    where schemaname = 'public' and tablename = 'idempotency_records' and cmd = 'SELECT'
  ),
  '(org_id IN ( SELECT app.user_org_ids() AS user_org_ids))',
  'C9 idempotency_records: die SELECT-Policy ist byte-gleich zur 0012-Fassung — die Lesegrenze sitzt auf der Spalte, nicht in der Zeile'
);

select ok(
  (
    select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'idempotency_records' and cmd = 'INSERT'
  ) like '%is_runtime_channel%',
  'C10 idempotency_records: die INSERT-Policy verlangt den Laufzeitkanal, sobald ein result_payload geschrieben wird'
);

-- C10b: und zwar OPERATIONSGEBUNDEN ueber die Payloadbedingung, nicht pauschal —
-- sonst braeche `costs.create_rate_version`, dessen Bestandssuite ueber eine
-- postgres-Sitzung laeuft.
select ok(
  (
    select coalesce(with_check, '') from pg_policies
    where schemaname = 'public' and tablename = 'idempotency_records' and cmd = 'INSERT'
  ) like '%result_payload IS NULL%',
  'C11 idempotency_records: die Kanalpflicht haengt an result_payload — ein payloadloser Bestandsvorgang bleibt ohne Kanal schreibbar'
);

-- ===========================================================================
-- D. Struktur der neuen Funktionen (Stolperdraehte nach dem 0006-Muster)
-- ===========================================================================

select is(
  (
    select coalesce(array_agg(p.proname::text || '=' || p.prosecdef::text order by p.proname::text), array[]::text[])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('reject_worksite_day_configuration_change_in_published_plan',
                        'remove_assignment_from_worksite_day',
                        'read_idempotency_result',
                        'lock_week_draft',
                        'assignment_belongs_to_worksite_day_configuration')
  ),
  array[
    'assignment_belongs_to_worksite_day_configuration=false',
    'lock_week_draft=true',
    'read_idempotency_result=true',
    'reject_worksite_day_configuration_change_in_published_plan=true',
    'remove_assignment_from_worksite_day=true'
  ],
  'D1 alle fuenf neuen app-Funktionen existieren mit der geplanten Rechtestellung — vier definer, der Zugehoerigkeitstrigger bewusst invoker'
);

select is(
  (
    -- `proconfig::text` rendert die Array-Literalform mit Backslash-Escapes
    -- (`{"search_path=\"\""}`) und machte den Vergleich zu einer Aussage ueber
    -- die Quotierung. `array_to_string` liefert den Wert selbst.
    select coalesce(array_agg(p.proname::text || ' -> '
                              || coalesce(array_to_string(p.proconfig, ','), '<null>')
                              order by p.proname::text), array[]::text[])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('reject_worksite_day_configuration_change_in_published_plan',
                        'remove_assignment_from_worksite_day',
                        'read_idempotency_result',
                        'lock_week_draft',
                        'assignment_belongs_to_worksite_day_configuration')
  ),
  array[
    'assignment_belongs_to_worksite_day_configuration -> search_path=""',
    'lock_week_draft -> search_path=""',
    'read_idempotency_result -> search_path=""',
    'reject_worksite_day_configuration_change_in_published_plan -> search_path=""',
    'remove_assignment_from_worksite_day -> search_path=""'
  ],
  'D2 alle fuenf neuen Funktionen setzen search_path = "" — kein Suchpfad aus der Sitzung'
);

select is(
  (
    select coalesce(array_agg(g.g order by g.g), array[]::text[])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(p.proacl::text[]) as g(g)
    where n.nspname = 'app' and p.proname = 'read_idempotency_result'
  ),
  array['authenticated=X/postgres', 'postgres=X/postgres'],
  'D3 app.read_idempotency_result: execute nur fuer authenticated und den Eigentuemer — public ist entzogen'
);

select is(
  (
    select coalesce(array_agg(g.g order by g.g), array[]::text[])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(p.proacl::text[]) as g(g)
    where n.nspname = 'app' and p.proname = 'lock_week_draft'
  ),
  array['authenticated=X/postgres', 'postgres=X/postgres'],
  'D4 app.lock_week_draft: execute nur fuer authenticated und den Eigentuemer'
);

select is(
  (
    select coalesce(array_agg(g.g order by g.g), array[]::text[])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(p.proacl::text[]) as g(g)
    where n.nspname = 'app' and p.proname = 'remove_assignment_from_worksite_day'
  ),
  array['authenticated=X/postgres', 'postgres=X/postgres'],
  'D5 app.remove_assignment_from_worksite_day: execute nur fuer authenticated und den Eigentuemer'
);

-- D6/D7: F1-Strukturhaelfte. Die Signatur traegt KEINEN Organisationsparameter —
-- den duerfte sonst der Client waehlen —, und der ausfuehrbare Rumpf enthaelt
-- weder `limit 1` noch `order by`, also keine geratene Auswahl unter mehreren
-- Mitgliedschaften. Der Match strippt vorher die Kommentare: `pg_get_functiondef`
-- liefert sie mit, und die normative Begruendung des Designs nennt
-- `order by … limit 1` woertlich als das Ausgeschlossene — die naive Fassung
-- ginge auf einer KORREKTEN Implementierung rot und belohnte das Loeschen genau
-- dieser Begruendung.
select is(
  (
    select pg_get_function_arguments(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'read_idempotency_result'
  ),
  'p_operation text, p_key text',
  'D6 app.read_idempotency_result traegt KEINEN Organisationsparameter — die Mandantenbindung kommt aus dem authentisierten Kontext'
);

select ok(
  (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'read_idempotency_result'
  ) !~* '(limit +1|order +by)',
  'D7 app.read_idempotency_result: der ausfuehrbare Rumpf enthaelt weder limit 1 noch order by — keine geratene Organisationsauswahl'
);

-- D8: und die Auswahl ist an den VOLLSTAENDIGEN Unique-Schluessel gebunden.
select ok(
  (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'read_idempotency_result'
  ) ~* 'org_id *= *v_org',
  'D8 app.read_idempotency_result: die Payloadabfrage ist an die aufgeloeste Organisation gebunden, nicht nur nachgefiltert'
);

-- D9 bis D12: F2/F3-Strukturhaelfte von app.lock_week_draft.
select is(
  (
    select pg_get_function_arguments(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'lock_week_draft'
  ),
  'p_week_key text',
  'D9 app.lock_week_draft traegt KEINEN Organisationsparameter (F3)'
);

select ok(
  (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'lock_week_draft'
  ) ~* 'for +share',
  'D10 app.lock_week_draft erwirbt einen Klasse-(2)-Lock mit for share — die Invoker-Variante im Anwendungscode ist damit ausgeschlossen'
);

select ok(
  (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'lock_week_draft'
  ) ~* 'loop',
  'D11 app.lock_week_draft enthaelt die Wiederholungsrunde — nach einem konkurrierenden Publish steht der Aufrufer nicht ohne Entwurf da'
);

select ok(
  (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'lock_week_draft'
  ) !~* '(limit +1|order +by|org_id +in *\()',
  'D12 app.lock_week_draft: kein limit 1, kein order by und KEINE Mengenform org_id in ( — unter definer waere die Menge eine Auswahl, keine Grenze (F3)'
);

select ok(
  (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'lock_week_draft'
  ) ~* 'org_id *= *v_org',
  'D13 app.lock_week_draft: jeder Zugriff ist explizit an die eine aufgeloeste Organisation gebunden'
);

-- D14: die Zusicherung, gegenueber der 0012 A1/A2/B1/C2/C3 strukturell BLIND
-- sind. Gemessen: bei gruenem A2/B1/C3 loeschte ein definer-Weg die Zeile
-- trotzdem, weil der Eigentuemer weder Grant noch Policy passiert. Genau EINE
-- benannte app-Funktion darf mit Ownerrechten aus public.assignments loeschen.
select is(
  (
    select coalesce(array_agg(p.proname::text order by p.proname::text), array[]::text[])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prokind = 'f' and p.prosecdef
      and pg_get_functiondef(p.oid) ~* 'delete +from +public\.assignments'
  ),
  array['remove_assignment_from_worksite_day'],
  'D14 genau eine security-definer-Funktion in app darf aus public.assignments loeschen — jede weitere waere ein Loch, das 0012 A1/A2/B1/C2/C3 nicht sehen'
);

-- D15: die REICHWEITE beider Trigger, nicht nur ihre Existenz. Der Aufnahme-Guard
-- muss auch beim UMHAENGEN feuern (`update of plan_version_id`); auf `before
-- insert` reduziert, liesse sich eine Tageskonfiguration nachtraeglich in eine
-- veroeffentlichte Version haengen. Der Unveraenderlichkeits-Guard muss `delete`
-- UND `update` abdecken.
select is(
  (
    select coalesce(array_agg(t.tgname::text || ' :: ' || pg_get_triggerdef(t.oid)
                              order by t.tgname::text), array[]::text[])
    from pg_trigger t
    where t.tgrelid = to_regclass('public.worksite_day_configurations') and not t.tgisinternal
  ),
  array[
    'worksite_day_configurations_immutable_when_published :: CREATE TRIGGER worksite_day_configurations_immutable_when_published BEFORE DELETE OR UPDATE ON public.worksite_day_configurations FOR EACH ROW EXECUTE FUNCTION app.reject_worksite_day_configuration_change_in_published_plan()',
    'worksite_day_configurations_reject_published_plan :: CREATE TRIGGER worksite_day_configurations_reject_published_plan BEFORE INSERT OR UPDATE OF plan_version_id ON public.worksite_day_configurations FOR EACH ROW EXECUTE FUNCTION app.reject_assignment_in_published_plan()'
  ],
  'D15 beide Trigger auf worksite_day_configurations haben exakt die geplante Reichweite — der Aufnahme-Guard feuert auch beim Umhaengen, der Unveraenderlichkeits-Guard bei update UND delete'
);

-- D16: auch die beiden TRIGGERfunktionen haben PUBLIC entzogen. D3/D4/D5 pruefen
-- nur die drei aufrufbaren Funktionen; ohne diese Zeile bliebe ein
-- `grant execute … to public` auf einer Triggerfunktion unbemerkt.
select is(
  (
    select coalesce(array_agg(p.proname::text || ' :: '
                              || coalesce(array_to_string(p.proacl::text[], ','), '<null>')
                              order by p.proname::text), array[]::text[])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('reject_worksite_day_configuration_change_in_published_plan',
                        'assignment_belongs_to_worksite_day_configuration')
  ),
  array[
    'assignment_belongs_to_worksite_day_configuration :: postgres=X/postgres',
    'reject_worksite_day_configuration_change_in_published_plan :: postgres=X/postgres'
  ],
  'D16 beide neuen Triggerfunktionen tragen NUR das Eigentuemerrecht — PUBLIC ist entzogen, und sie sind fuer niemanden direkt aufrufbar'
);

-- ===========================================================================
-- E. Rechte in der vom Plan woertlich verlangten Form
-- ===========================================================================
-- Abschnitt B misst dieselbe Sache als Menge und ist damit schaerfer. Diese vier
-- Zeilen fuehren die Frage zusaetzlich so, wie der akzeptierte Plan sie stellt —
-- und sie WERFEN bei fehlender Spalte, stehen deshalb hinter dem katalogbasierten
-- Teil.

select ok(
  not has_column_privilege('authenticated', 'public.idempotency_records', 'result_payload', 'SELECT'),
  'E1 (P2) result_payload ist fuer authenticated auf KEINEM direkten Weg lesbar — weder ueber die Data-API noch roh im Laufzeitkanal'
);

select ok(
  has_column_privilege('authenticated', 'public.idempotency_records', 'subject_id', 'SELECT')
  and has_column_privilege('authenticated', 'public.idempotency_records', 'request_fingerprint', 'SELECT'),
  'E2 (P1) der einzige Bestandsleser (subject_id, request_fingerprint) behaelt sein Recht — alle vier Bestandsvorgaenge bleiben unberuehrt'
);

select ok(
  has_column_privilege('authenticated', 'public.idempotency_records', 'result_payload', 'INSERT'),
  'E3 das Tabellen-INSERT aus 0012 deckt die neue Spalte mit ab — gemessen statt angenommen'
);

select ok(
  has_column_privilege('authenticated', 'public.assignments', 'worksite_day_configuration_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.assignments', 'id', 'INSERT'),
  'E4 assignments: die neue Spalte ist insert-bar, id bleibt es nicht (0012 A4 laeuft nach der Neuvergabe erneut)'
);

-- ===========================================================================
-- F. Fixtures (Eigentuemerpfad — PO-Vorgabe 07.08.2026)
-- ===========================================================================
-- Zwei Baustellen, drei Planversionen (ein Entwurf zum Arbeiten, eine
-- veroeffentlichte fuer die Unveraenderlichkeit, ein Entwurf zum Loeschen), zwei
-- Tagesidentitaeten und drei Tageskonfigurationen. Alles in Org Alpha; die
-- Transaktion wird am Ende zurueckgerollt.

insert into public.worksites (id, org_id, name, activity_count)
values ('00000000-0000-4000-8000-0000005011a1', '00000000-0000-4000-8000-0000000000a1',
        'Alpha Allee 2', 1);

insert into public.plan_versions (id, org_id, week_key)
values ('00000000-0000-4000-8000-0000006040a1', '00000000-0000-4000-8000-0000000000a1', '2026-W40'),
       ('00000000-0000-4000-8000-0000006041a1', '00000000-0000-4000-8000-0000000000a1', '2026-W41'),
       ('00000000-0000-4000-8000-0000006042a1', '00000000-0000-4000-8000-0000000000a1', '2026-W42');

insert into public.worksite_days (id, org_id, worksite_id, local_date)
values ('00000000-0000-4000-8000-0000008010a1', '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000005010a1', '2026-09-28'),
       ('00000000-0000-4000-8000-0000008011a1', '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000005010a1', '2026-09-29');

insert into public.worksite_day_configurations
  (id, org_id, worksite_day_id, plan_version_id)
values
  -- Arbeitsstand im Entwurf W40
  ('00000000-0000-4000-8000-0000009010a1', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000008010a1', '00000000-0000-4000-8000-0000006040a1'),
  -- Stand in W41, der GLEICH VEROEFFENTLICHT wird
  ('00000000-0000-4000-8000-0000009011a1', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000008010a1', '00000000-0000-4000-8000-0000006041a1'),
  -- Stand im Entwurf W42, der gleich mit seinem Entwurf geloescht wird
  ('00000000-0000-4000-8000-0000009012a1', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000008011a1', '00000000-0000-4000-8000-0000006042a1');

update public.plan_versions
   set published_at = '2026-10-05T12:00:00Z',
       published_by = '00000000-0000-4000-8000-00000000aaa1'
 where id = '00000000-0000-4000-8000-0000006041a1';

-- ===========================================================================
-- G. Negative Datenbank-Invarianten
-- ===========================================================================
-- SQLSTATE allein waere mehrdeutig: 23514 entsteht aus jedem CHECK und aus jedem
-- Trigger, der ihn erhebt. Jede Zusicherung nennt deshalb zusaetzlich den
-- Wortlaut — nur so sagt der rote Lauf, WELCHER Riegel gehalten hat.

select throws_ok(
  $$insert into public.worksite_day_configurations (org_id, worksite_day_id, plan_version_id)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000008011a1',
            '00000000-0000-4000-8000-0000006041a1')$$,
  '23514',
  'Planversion 00000000-0000-4000-8000-0000006041a1 ist veroeffentlicht und nimmt keine Zuweisung mehr auf',
  'G1 eine veroeffentlichte Planversion nimmt KEINE neue Tageskonfiguration mehr auf (Aufnahme-Guard, generische 0016-Fassung wiederverwendet)'
);

select throws_ok(
  $$update public.worksite_day_configurations set lock_version = 1
     where id = '00000000-0000-4000-8000-0000009011a1'$$,
  '23514',
  'Tageskonfiguration einer veroeffentlichten Planversion ist unveraenderlich',
  'G2 die Tageskonfiguration einer veroeffentlichten Version laesst sich nicht aendern — ohne eigenen Publish-Marker, der Versionszustand wird gelesen'
);

select throws_ok(
  $$delete from public.worksite_day_configurations
     where id = '00000000-0000-4000-8000-0000009011a1'$$,
  '23514',
  'Tageskonfiguration einer veroeffentlichten Planversion ist unveraenderlich',
  'G3 die Tageskonfiguration einer veroeffentlichten Version laesst sich nicht loeschen'
);

select throws_ok(
  $$insert into public.worksite_day_configurations (org_id, worksite_day_id, plan_version_id)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000008010a1',
            '00000000-0000-4000-8000-0000006040a1')$$,
  '23505',
  NULL,
  'G4 (I-3) ein Baustellentag hat je Planversion HOECHSTENS EINEN Stand — der Riegel ist der in A4 benannte unique-Constraint'
);

select throws_ok(
  $$insert into public.worksite_days (org_id, worksite_id, local_date)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000005010a1', '2026-09-28')$$,
  '23505',
  NULL,
  'G5 (I-4) derselbe reale Baustellentag ist immer dieselbe Zeile — der Riegel ist der in A3 benannte unique-Constraint'
);

select throws_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, worksite_day_configuration_id, employee_id, worksite_id,
       starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006040a1',
            '00000000-0000-4000-8000-0000009010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005011a1',
            '2026-09-28T06:00:00Z', '2026-09-28T14:00:00Z')$$,
  '23514',
  'Zuweisung widerspricht Baustelle oder Planversion ihrer Tageskonfiguration',
  'G6 (I-1) eine Zuweisung mit FREMDER Baustelle wird abgewiesen — beide Zeilen sind fuer sich gueltig, nur ihre Kombination nicht'
);

select throws_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, worksite_day_configuration_id, employee_id, worksite_id,
       starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006042a1',
            '00000000-0000-4000-8000-0000009010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-09-28T06:00:00Z', '2026-09-28T14:00:00Z')$$,
  '23514',
  'Zuweisung widerspricht Baustelle oder Planversion ihrer Tageskonfiguration',
  'G7 (I-1) eine Zuweisung mit FREMDER Planversion wird abgewiesen — der Fremdschluessel allein saehe hier nichts'
);

-- G8: die Zugehoerigkeit einer Tageskonfiguration ist UNVERAENDERLICH. Ohne
-- diesen Riegel liesse sich I-1 NACHTRAEGLICH brechen: der Zugehoerigkeitstrigger
-- auf `assignments` (G6/G7) feuert nur dort und laeuft bei einer Aenderung HIER
-- nie erneut. Review-MESSUNG: beide Netze liessen das Umhaengen durch, danach
-- zeigte die Konfiguration auf Planversion B und ihre Zuweisungen auf A.
select throws_ok(
  $$update public.worksite_day_configurations
       set plan_version_id = '00000000-0000-4000-8000-0000006042a1'
     where id = '00000000-0000-4000-8000-0000009010a1'$$,
  '23514',
  'Tageskonfiguration kann nicht auf einen anderen Tag oder eine andere Planversion umgehaengt werden',
  'G8 eine Tageskonfiguration laesst sich nicht in eine andere Planversion umhaengen — auch nicht in einen ENTWURF, wo der Publish-Guard nichts saehe'
);

select throws_ok(
  $$update public.worksite_day_configurations
       set worksite_day_id = '00000000-0000-4000-8000-0000008011a1'
     where id = '00000000-0000-4000-8000-0000009010a1'$$,
  '23514',
  'Tageskonfiguration kann nicht auf einen anderen Tag oder eine andere Planversion umgehaengt werden',
  'G9 eine Tageskonfiguration laesst sich nicht auf einen anderen Baustellentag umhaengen — der Aufnahme-Guard feuert bei dieser Spalte gar nicht'
);

-- G10: der Unveraenderlichkeits-Guard loest den Publish-Stand an der ELTERNZEILE
-- auf. Traegt er dabei einen Sichtbarkeitsfilter, erzeugt eine Sitzung mit
-- ORG-FREMDER Identitaet denselben `not found` wie die Loeschkaskade — und der
-- fail-open-Zweig fuer DELETE liesse sie durch. Review-MESSUNG an genau dieser
-- Fassung: `DELETE 1`, die Tageskonfiguration einer VEROEFFENTLICHTEN
-- Planversion war weg, waehrend dieselbe Anweisung ohne Claims korrekt mit 23514
-- scheiterte. Der Bestandsguard `app.reject_published_row_change` (0010) hat die
-- Luecke nicht, weil er `old.published_at` an der Zeile SELBST liest.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000bbb2', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$delete from public.worksite_day_configurations
     where id = '00000000-0000-4000-8000-0000009011a1'$$,
  '23514',
  'Tageskonfiguration einer veroeffentlichten Planversion ist unveraenderlich',
  'G10 auch eine Sitzung mit ORG-FREMDER Identitaet kann die Tageskonfiguration einer veroeffentlichten Version nicht loeschen — der Guard sieht den Publish-Stand unabhaengig von der Sitzung'
);

-- Claims wieder entfernen: die folgenden Zusicherungen laufen ohne
-- Anwendungsidentitaet, wie die vorherigen auch.
select set_config('request.jwt.claims', '', true);

-- ===========================================================================
-- H. Positive Invarianten
-- ===========================================================================

select lives_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, worksite_day_configuration_id, employee_id, worksite_id,
       starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006040a1',
            '00000000-0000-4000-8000-0000009010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-09-28T06:00:00Z', '2026-09-28T10:00:00Z')$$,
  'H1 eine Zuweisung, deren Baustelle und Planversion zu ihrer Tageskonfiguration passen, wird angenommen'
);

select lives_ok(
  $$insert into public.assignments
      (org_id, plan_version_id, worksite_day_configuration_id, employee_id, worksite_id,
       starts_at_utc, ends_at_utc)
    values ('00000000-0000-4000-8000-0000000000a1',
            '00000000-0000-4000-8000-0000006040a1',
            '00000000-0000-4000-8000-0000009010a1',
            '00000000-0000-4000-8000-0000004010a1',
            '00000000-0000-4000-8000-0000005010a1',
            '2026-09-28T12:00:00Z', '2026-09-28T16:00:00Z')$$,
  'H2 (F) DIESELBE Person darf an DEMSELBEN Baustellentag ZWEI verschiedene Intervalle haben — der Tag traegt keine Zeit und erzwingt keine'
);

select is(
  (
    select count(*)::int from public.assignments
    where worksite_day_configuration_id = '00000000-0000-4000-8000-0000009010a1'
  ),
  2,
  'H3 beide Intervalle stehen wirklich an derselben Tageskonfiguration — lives_ok allein sagt nicht, WORAN sie haengen'
);

-- H4: die Loeschkaskaden-Ausnahme. Gemessen im Review: eine fail-closed-Variante
-- des Unveraenderlichkeits-Guards machte genau das unmoeglich und haette die
-- Aufraeumpfade der Bestandssuiten gebrochen. Im BEFORE-DELETE des Kindes ist die
-- Elternzeile bereits entfernt — "nicht gefunden" ist dort der NORMALFALL.
select lives_ok(
  $$delete from public.plan_versions
     where id = '00000000-0000-4000-8000-0000006042a1'$$,
  'H4 ein UNVEROEFFENTLICHTER Entwurf mit Tageskonfiguration laesst sich loeschen — die Kaskade laeuft, der Guard blockiert sie nicht'
);

select is(
  (
    select count(*)::int from public.worksite_day_configurations
    where id = '00000000-0000-4000-8000-0000009012a1'
  ),
  0,
  'H5 die Tageskonfiguration ist mit ihrem Entwurf gegangen — die Kaskade hat gewirkt, nicht nur nicht geworfen'
);

select is(
  (
    select count(*)::int from public.worksite_days
    where id = '00000000-0000-4000-8000-0000008011a1'
  ),
  1,
  'H6 die stabile TAGESIDENTITAET ueberlebt das Loeschen des Entwurfs — sie haengt nicht an der Planversion (R-01)'
);

-- H7: die Gegenprobe zu G8/G9. Der Umhaenge-Riegel darf die EINE Spalte, die der
-- Plan als schreibbar vorsieht, nicht mitsperren — sonst waere der Riegel kein
-- Riegel, sondern eine Totalsperre, und B3 (update-Grant nur auf lock_version)
-- liefe ins Leere.
select lives_ok(
  $$update public.worksite_day_configurations
       set lock_version = lock_version + 1
     where id = '00000000-0000-4000-8000-0000009010a1'$$,
  'H7 lock_version bleibt im ENTWURF schreibbar — der Umhaenge-Riegel trifft nur worksite_day_id und plan_version_id'
);

select is(
  (
    select lock_version from public.worksite_day_configurations
    where id = '00000000-0000-4000-8000-0000009010a1'
  ),
  1,
  'H8 der Zaehler ist wirklich gestiegen — lives_ok allein sagt nicht, dass etwas passiert ist'
);

-- ===========================================================================
-- J. Kanalgrenze der neuen Funktionen — hier NUR negativ pruefbar
-- ===========================================================================
-- Diese Sitzung ist session_user = postgres und erfuellt app.is_runtime_channel()
-- nie. Die Zusicherungen belegen deshalb genau eines: der Kanalriegel steht VORNE
-- und laesst nichts an sich vorbei. Die dahinterliegenden Zweige (P0002 bei
-- fremder Konfiguration, 23514 bei veroeffentlichter Zuweisung, der positive
-- Kanalfall) sind hier UNERREICHBAR und liegen in M3/M4.

select ok(
  not app.is_runtime_channel(),
  'J0 diese Sitzung ist NICHT der Laufzeitkanal — die Voraussetzung von J1 bis J3'
);

select throws_ok(
  $$select app.remove_assignment_from_worksite_day(
      (select id from public.assignments
        where worksite_day_configuration_id = '00000000-0000-4000-8000-0000009010a1'
        order by starts_at_utc limit 1),
      '00000000-0000-4000-8000-0000009010a1')$$,
  '42501',
  'Nur der Laufzeitkanal darf Zuweisungen aus einem Baustellentag entfernen',
  'J1 app.remove_assignment_from_worksite_day weist einen fremden Kanal ab, BEVOR sie irgendetwas ueber die Zuweisung sagt'
);

select throws_ok(
  $$select app.read_idempotency_result('planning.create_assignment', 'k1')$$,
  '42501',
  'Kein Payload-Vorgang',
  'J2 (P4d) app.read_idempotency_result laesst nur die beiden Payload-Vorgaenge zu — jeder andere Operationsname ist kein Leseweg'
);

select throws_ok(
  $$select app.read_idempotency_result('planning.plan_worksite_day', 'k1')$$,
  '42501',
  'Nur der Laufzeitkanal darf ein Replay-Ergebnis lesen',
  'J3 (P4a) app.read_idempotency_result weist einen fremden Kanal ab — und zwar NACH der Operationspruefung, weshalb J2 und J3 verschiedene Wortlaute haben'
);

select throws_ok(
  $$select app.lock_week_draft('2026-W44')$$,
  '42501',
  'Nur der Laufzeitkanal darf einen Wochenentwurf sperren',
  'J4 app.lock_week_draft weist einen fremden Kanal ab — der Riegel steht vor jeder Mandantenaufloesung'
);

-- ===========================================================================
-- K. Payloadpflicht der beiden neuen Vorgaenge
-- ===========================================================================
-- Der Check ist eine Datenbankregel, kein Testversprechen: ein payloadloser
-- Insert der neuen Operationen scheitert, statt einen Zustand zu hinterlassen,
-- in dem ein Replay weder reproduzieren noch ehrlich scheitern koennte.

select throws_ok(
  $$insert into public.idempotency_records
      (org_id, operation, idempotency_key, subject_id, request_fingerprint)
    values ('00000000-0000-4000-8000-0000000000a1', 'planning.plan_worksite_day',
            'k-ohne-payload', '00000000-0000-4000-8000-0000009010a1', 'fp1')$$,
  '23514',
  NULL,
  'K1 planning.plan_worksite_day ohne result_payload wird abgewiesen — die Pflicht steht in der Datenbank, nicht nur im Test'
);

select lives_ok(
  $$insert into public.idempotency_records
      (org_id, operation, idempotency_key, subject_id, request_fingerprint)
    values ('00000000-0000-4000-8000-0000000000a1', 'planning.create_assignment',
            'k-bestand', '00000000-0000-4000-8000-0000007010a1', 'fp2')$$,
  'K2 ein BESTANDSVORGANG bleibt ohne result_payload schreibbar — die Pflicht ist operationsgebunden, nicht pauschal'
);

select throws_ok(
  $$insert into public.idempotency_records
      (org_id, operation, idempotency_key, subject_id, request_fingerprint, result_payload)
    values ('00000000-0000-4000-8000-0000000000a1', 'planning.update_worksite_day_team',
            'k-kein-objekt', '00000000-0000-4000-8000-0000009010a1', 'fp3', '[]'::jsonb)$$,
  '23514',
  NULL,
  'K3 ein result_payload muss ein JSON-OBJEKT sein — ein Array wird abgewiesen'
);

select lives_ok(
  $$insert into public.idempotency_records
      (org_id, operation, idempotency_key, subject_id, request_fingerprint, result_payload)
    values ('00000000-0000-4000-8000-0000000000a1', 'planning.update_worksite_day_team',
            'k-mit-payload', '00000000-0000-4000-8000-0000009010a1', 'fp4',
            '{"worksiteDayId":"00000000-0000-4000-8000-0000008010a1"}'::jsonb)$$,
  'K4 mit einem Objekt-Payload gelingt der Insert des neuen Vorgangs'
);

select * from finish();
rollback;
