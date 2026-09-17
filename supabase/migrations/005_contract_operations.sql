-- PrądPlan / karta kontraktu, akceptacje i dokumenty

alter table public.contracts
  add column contract_number text not null default '',
  add column description text not null default '',
  add column manager_id uuid references public.profiles(id) on delete set null;

alter table public.settlements
  add column approved_at timestamptz,
  add column approved_by uuid references public.profiles(id) on delete set null,
  add column rejection_reason text not null default '';

create table public.contract_changes (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  kind text not null check (kind in ('zmiana', 'roszczenie', 'ryzyko')),
  title text not null,
  description text not null default '',
  net_amount_cents bigint not null default 0,
  status text not null default 'otwarte' check (status in ('otwarte', 'zaakceptowane', 'odrzucone')),
  due_date date,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index contracts_manager_idx on public.contracts(manager_id);
create index contract_changes_contract_idx on public.contract_changes(contract_id, created_at desc);
create index contract_documents_contract_idx on public.contract_documents(contract_id, created_at desc);

create trigger contract_changes_updated_at before update on public.contract_changes
  for each row execute procedure public.set_updated_at();

alter table public.contract_changes enable row level security;
alter table public.contract_documents enable row level security;

create policy "active users read contract changes" on public.contract_changes
  for select to authenticated using (public.current_app_role() is not null);
create policy "managers manage contract changes" on public.contract_changes
  for all to authenticated using (public.can_manage_contracts()) with check (public.can_manage_contracts());

create policy "active users read contract documents" on public.contract_documents
  for select to authenticated using (public.current_app_role() is not null);
create policy "managers manage contract documents" on public.contract_documents
  for all to authenticated using (public.can_manage_contracts()) with check (public.can_manage_contracts());

grant select, insert, update, delete on table public.contract_changes to authenticated;
grant select, insert, update, delete on table public.contract_documents to authenticated;
