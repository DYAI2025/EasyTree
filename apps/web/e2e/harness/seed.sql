-- Fixtures des integrierten Read-Through-Nachweises (EYT-50).
--
-- Laeuft als `postgres` NACH `supabase db reset`, also auf dem Seed-Stand.
-- Alle Ids sind fest und tragen erkennbare Praefixe, damit ein Treffer im DOM
-- eindeutig zuzuordnen ist.
--
-- Warum eigene Daten statt des Standardseeds: der Nachweis braucht drei
-- Konstellationen, die dort nicht vorkommen —
--   (a) dieselbe Woche in ZWEI Organisationen, fuer den Nicht-Leak;
--   (b) zwei veroeffentlichte Versionen mit VOLLSTAENDIGEM Zeitstempelgleichstand,
--       damit ausschliesslich der Id-Tie-Breaker entscheidet;
--   (c) einen Entwurf UEBER einer Veroeffentlichung, fuer die Provenienz.

begin;

-- ---------------------------------------------------------------------------
-- (b) + (c) Organisation Alpha, Woche 2026-W40
-- ---------------------------------------------------------------------------
-- Zwei veroeffentlichte Versionen. published_at UND created_at sind identisch;
-- ohne den Id-Tie-Breaker aus `order by ... id asc` waere die Auswahl damit
-- von der Speicherreihenfolge abhaengig und von Lauf zu Lauf verschieden.
insert into public.plan_versions (id, org_id, week_key, published_at, published_by, created_at)
values
  ('aaaa1111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-0000000000a1',
   '2026-W40', '2026-09-25T09:00:00Z', '00000000-0000-0000-0000-00000000aaa1',
   '2026-09-20T08:00:00Z'),
  ('aaaa2222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-0000000000a1',
   '2026-W40', '2026-09-25T09:00:00Z', '00000000-0000-0000-0000-00000000aaa1',
   '2026-09-20T08:00:00Z');

-- Entwurf derselben Woche. Er ist der ANGEZEIGTE Stand (sourceVersion.state
-- = draft), waehrend publishedVersionId getrennt die zuletzt veroeffentlichte
-- meldet — genau die Trennung, die vorher fehlte.
insert into public.plan_versions (id, org_id, week_key, created_at)
values
  ('aaaa3333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-0000000000a1',
   '2026-W40', '2026-09-21T08:00:00Z');

-- Zuweisungen: je eine in beiden veroeffentlichten Versionen und eine im
-- Entwurf. Unterscheidbar, damit im DOM nachweisbar ist, WELCHE gezeigt wird.
insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values
  ('a5510001-0001-4001-8001-000000000001', '00000000-0000-0000-0000-0000000000a1',
   'aaaa1111-1111-4111-8111-111111111111',
   '00000000-0000-0000-0000-0000004010a1', '00000000-0000-0000-0000-0000005010a1',
   '2026-09-28T06:00:00Z', '2026-09-28T10:00:00Z'),
  ('a5510002-0002-4002-8002-000000000002', '00000000-0000-0000-0000-0000000000a1',
   'aaaa2222-2222-4222-8222-222222222222',
   '00000000-0000-0000-0000-0000004010a1', '00000000-0000-0000-0000-0000005010a1',
   '2026-09-29T06:00:00Z', '2026-09-29T10:00:00Z'),
  ('a5510003-0003-4003-8003-000000000003', '00000000-0000-0000-0000-0000000000a1',
   'aaaa3333-3333-4333-8333-333333333333',
   '00000000-0000-0000-0000-0000004010a1', '00000000-0000-0000-0000-0000005010a1',
   '2026-09-30T06:00:00Z', '2026-09-30T10:00:00Z');

-- ---------------------------------------------------------------------------
-- (a) Organisation Beta, DIESELBE Woche
-- ---------------------------------------------------------------------------
-- Existiert nachweislich in PostgreSQL und darf fuer Subjekt A weder in der
-- HTTP-Antwort noch im DOM auftauchen. Die Id traegt das Praefix bbbb/b551,
-- damit eine Textsuche eindeutig ist.
insert into public.plan_versions (id, org_id, week_key, published_at, published_by, created_at)
values
  ('bbbb1111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-0000000000b2',
   '2026-W40', '2026-09-25T09:00:00Z', '00000000-0000-0000-0000-00000000bbb2',
   '2026-09-20T08:00:00Z');

insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values
  ('b5510001-0001-4001-8001-000000000001', '00000000-0000-0000-0000-0000000000b2',
   'bbbb1111-1111-4111-8111-111111111111',
   '00000000-0000-0000-0000-0000004020b2', '00000000-0000-0000-0000-0000005020b2',
   '2026-09-28T06:00:00Z', '2026-09-28T10:00:00Z');

commit;
