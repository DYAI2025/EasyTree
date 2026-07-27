-- Seed fuer die lokale Entwicklung (EYT-44).
-- AUSSCHLIESSLICH synthetische Fantasiedaten — niemals echte Kunden- oder Personendaten.
-- Feste UUIDs, damit pgTAP- und Isolationstests (EYT-15) deterministisch referenzieren koennen.

insert into public.organizations (id, name)
values
  ('00000000-0000-0000-0000-0000000000a1', 'Org Alpha'),
  ('00000000-0000-0000-0000-0000000000b2', 'Org Beta')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Synthetische auth-User (EYT-15).
-- TESTSPEZIFISCH: Direktes Insert in auth.users ist NUR im lokalen Stack ok
-- (deterministische UUIDs fuer pgTAP-/Integrationstests). In echten
-- Umgebungen legt ausschliesslich GoTrue (Supabase Auth) auth.users an.
-- Passwoerter: keine (encrypted_password leer) — Login ist nicht Testziel.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
   created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000aaa1',
   'authenticated', 'authenticated', 'user-a@example.test', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000bbb2',
   'authenticated', 'authenticated', 'user-b@example.test', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ccc3',
   'authenticated', 'authenticated', 'user-c@example.test', '',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

-- App-Profile
insert into public.users (id, display_name)
values
  ('00000000-0000-0000-0000-00000000aaa1', 'User A (Alpha)'),
  ('00000000-0000-0000-0000-00000000bbb2', 'User B (Beta)'),
  ('00000000-0000-0000-0000-00000000ccc3', 'User C (Alpha, inaktiv)')
on conflict (id) do nothing;

-- Memberships: A aktiv in Alpha, B aktiv in Beta, C INAKTIV in Alpha
insert into public.memberships (id, org_id, user_id, role, active)
values
  ('00000000-0000-0000-0000-0000000e0aa1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-00000000aaa1', 'owner', true),
  ('00000000-0000-0000-0000-0000000e0bb2', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-00000000bbb2', 'owner', true),
  ('00000000-0000-0000-0000-0000000e0cc3', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-00000000ccc3', 'member', false)
on conflict (id) do nothing;

-- Items: je Org genau eines (deterministische IDs fuer IDOR-Tests)
insert into public.items (id, org_id, title)
values
  ('00000000-0000-0000-0000-0000000110a1', '00000000-0000-0000-0000-0000000000a1',
   'Alpha Item 1'),
  ('00000000-0000-0000-0000-0000000220b2', '00000000-0000-0000-0000-0000000000b2',
   'Beta Item 1')
on conflict (id) do nothing;

-- Item-Notes: je Org eine, via tenantgebundenem FK (item_id, org_id)
insert into public.item_notes (id, org_id, item_id, body)
values
  ('00000000-0000-0000-0000-0000000310a1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000110a1', 'Alpha Note 1'),
  ('00000000-0000-0000-0000-0000000320b2', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000220b2', 'Beta Note 1')
on conflict (id) do nothing;

-- Storage-Objekte (nur Metadatenzeilen, testspezifisch): Pfadkonvention
-- '<org_id>/...' im privaten Bucket tenant-files.
insert into storage.objects (bucket_id, name, owner_id)
values
  ('tenant-files', '00000000-0000-0000-0000-0000000000a1/alpha-welcome.txt',
   '00000000-0000-0000-0000-00000000aaa1'),
  ('tenant-files', '00000000-0000-0000-0000-0000000000b2/beta-welcome.txt',
   '00000000-0000-0000-0000-00000000bbb2')
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- Fachschema (EYT-86)
-- ---------------------------------------------------------------------------
-- Weiterhin ausschliesslich synthetische Fantasiedaten mit festen UUIDs. Die
-- Namen sind bewusst erfunden und nicht personenbeziehbar ("Alpha Planerin"),
-- damit der Seed die Auflage "keine personenbezogenen Produktionsdaten"
-- erfuellt, ohne dass jemand sie im Einzelfall abwaegen muss.

-- Beschaeftigte: je Org eine, plus eine INAKTIVE in Alpha fuer Negativfaelle.
insert into public.employees (id, org_id, user_id, display_name, active)
values
  ('00000000-0000-0000-0000-0000004010a1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-00000000aaa1', 'Alpha Planerin', true),
  ('00000000-0000-0000-0000-0000004011a1', '00000000-0000-0000-0000-0000000000a1',
   null, 'Alpha Inaktive', false),
  ('00000000-0000-0000-0000-0000004020b2', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-00000000bbb2', 'Beta Planer', true)
on conflict (id) do nothing;

-- Baustellen: je Org eine mit mindestens einer Taetigkeit.
insert into public.worksites (id, org_id, name, activity_count)
values
  ('00000000-0000-0000-0000-0000005010a1', '00000000-0000-0000-0000-0000000000a1',
   'Alpha Allee 1', 2),
  ('00000000-0000-0000-0000-0000005020b2', '00000000-0000-0000-0000-0000000000b2',
   'Beta Boulevard 2', 1)
on conflict (id) do nothing;

-- Planversionen: je Org ein Entwurf fuer 2026-W32 (published_at NULL).
insert into public.plan_versions (id, org_id, week_key)
values
  ('00000000-0000-0000-0000-0000006010a1', '00000000-0000-0000-0000-0000000000a1', '2026-W32'),
  ('00000000-0000-0000-0000-0000006020b2', '00000000-0000-0000-0000-0000000000b2', '2026-W32')
on conflict (id) do nothing;

-- Zuweisungen: je Org eine Achtstundenschicht am Montag der Woche 32.
-- 06:00-14:00 UTC entspricht 08:00-16:00 Europe/Berlin.
insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values
  ('00000000-0000-0000-0000-0000007010a1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000006010a1', '00000000-0000-0000-0000-0000004010a1',
   '00000000-0000-0000-0000-0000005010a1',
   '2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z'),
  ('00000000-0000-0000-0000-0000007020b2', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000006020b2', '00000000-0000-0000-0000-0000004020b2',
   '00000000-0000-0000-0000-0000005020b2',
   '2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z')
on conflict (id) do nothing;
