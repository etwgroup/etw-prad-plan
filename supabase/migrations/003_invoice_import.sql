-- PrądPlan / przygotowanie importu KSeF
-- Ta migracja nie aktywuje importu. Import wykonuje później funkcja Edge Function.

create table public.invoice_import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  environment text not null check (environment in ('test', 'production')),
  requested_by uuid references public.profiles(id) on delete set null,
  imported_count integer not null default 0 check (imported_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invoices
  add column import_run_id uuid references public.invoice_import_runs(id) on delete set null,
  add column ksef_imported_at timestamptz;

create index invoices_import_run_idx on public.invoices(import_run_id);
create index invoice_import_runs_created_idx on public.invoice_import_runs(created_at desc);

alter table public.invoice_import_runs enable row level security;

create policy "finance reads import runs" on public.invoice_import_runs
  for select to authenticated using (public.can_manage_finance());

grant select on table public.invoice_import_runs to authenticated;

-- Nie dodawaj polityki INSERT/UPDATE. Te operacje wykonuje wyłącznie
-- zabezpieczona funkcja Edge Function z sekretami KSeF po stronie serwera.
