-- Migration 0009_btree_gist (EYT-86, Vorbereitung fuer EYT-49)
-- Extension fuer Ausschluss-Constraints ueber Gleichheit UND Ueberlappung.
--
-- Rollback: `drop extension btree_gist` in einer neuen Migration, sobald kein
-- EXCLUDE-Constraint sie mehr braucht.

-- ---------------------------------------------------------------------------
-- Warum eine eigene Migration
-- ---------------------------------------------------------------------------
-- EYT-49 braucht
--   exclude using gist (org_id with =, employee_id with =, during with &&)
--     where (published_at is not null)
-- und gist kann `=` auf uuid nur mit btree_gist. Die Extension hier anzulegen
-- heisst: EYT-49 kommt mit einer rein additiven Migration aus und muss keine
-- EYT-86-Datei anfassen (append-only, CLAUDE.md).
--
-- IF NOT EXISTS, weil Extensions DATENBANKlokal sind: `supabase db reset` baut
-- die Datenbank neu und die Extension ist dann weg. Anders als bei Rollen
-- (clusterweit, siehe 0003) ist die Wiederholbarkeit hier also gegeben —
-- IF NOT EXISTS schuetzt trotzdem gegen den Fall, dass ein Basis-Image sie
-- bereits mitbringt.
create extension if not exists btree_gist with schema extensions;

comment on extension btree_gist is
  'Ermoeglicht EXCLUDE-Constraints, die Gleichheit (org_id, employee_id) mit Ueberlappung (during) kombinieren. Angelegt in EYT-86, benutzt in EYT-49.';
