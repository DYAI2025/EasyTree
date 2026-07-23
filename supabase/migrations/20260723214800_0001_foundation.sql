-- Migration 0001_foundation (EYT-44)
-- Schemaquelle: AUSSCHLIESSLICH Migrationen in supabase/migrations/.
-- Siehe docs/runbooks/database-workflow.md und ADR-001.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- pgTAP fuer Datenbanktests (supabase test db)
create extension if not exists pgtap with schema extensions;

-- ---------------------------------------------------------------------------
-- Schema public: Grundlagen
-- ---------------------------------------------------------------------------
comment on schema public is
  'easyTree Anwendungsschema. Aenderungen NUR ueber versionierte Migrationen (supabase/migrations/).';

-- ---------------------------------------------------------------------------
-- Tabelle: organizations (Tenant-Wurzel)
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant-Wurzeltabelle. RLS-Policies folgen im Tenancy-Spike (EYT-15, Migration 0002).';

-- ---------------------------------------------------------------------------
-- Storage: privater Bucket "tenant-files"
-- ---------------------------------------------------------------------------
-- Privat (public = false). Bewusst KEINE public-Policies auf storage.objects:
-- Zugriff wird erst mit den tenantgebundenen RLS-Policies (EYT-15) eroeffnet.
insert into storage.buckets (id, name, public)
values ('tenant-files', 'tenant-files', false)
on conflict (id) do nothing;
