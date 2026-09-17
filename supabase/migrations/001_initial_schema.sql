-- PrądPlan / Supabase / migracja początkowa
-- Uruchom raz w SQL Editor nowego projektu Supabase.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null default '',
  role text not null default 'viewer' check (role in ('owner', 'manager', 'accountant', 'viewer')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text not null default '',
  trade text not null default '',
  value_cents bigint not null default 0 check (value_cents >= 0),
  budget_cents bigint not null default 0 check (budget_cents >= 0),
  baseline_progress integer not null default 0 check (baseline_progress between 0 and 100),
  due_date date,
  status text not null default 'w_realizacji' check (status in ('w_realizacji', 'do_decyzji', 'ryzyko', 'zakonczony')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  period date not null,
  settlement_date date not null,
  kind text not null check (kind in ('przerob', 'faktura', 'koszt', 'platnosc', 'zaliczka', 'korekta')),
  net_amount_cents bigint not null check (net_amount_cents >= 0),
  vat_rate numeric(5,2) not null default 23 check (vat_rate between 0 and 100),
  reference_number text not null default '',
  budget_category text not null default 'pozostale',
  status text not null default 'robocze' check (status in ('robocze', 'do_akceptacji', 'zafakturowane', 'oplacone')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_type text not null check (invoice_type in ('purchase', 'sales')),
  source text not null default 'manual' check (source in ('manual', 'ksef')),
  document_number text not null,
  ksef_number text unique,
  counterparty text not null,
  issue_date date not null,
  due_date date,
  net_amount_cents bigint not null check (net_amount_cents >= 0),
  vat_rate numeric(5,2) not null default 23 check (vat_rate between 0 and 100),
  allocation text not null default 'unassigned' check (allocation in ('unassigned', 'contract', 'company')),
  contract_id uuid references public.contracts(id) on delete set null,
  company_category text,
  payment_status text not null default 'nowa' check (payment_status in ('nowa', 'do_platnosci', 'oplacona', 'zaksiegowana')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (allocation = 'contract' and contract_id is not null and company_category is null)
    or (allocation = 'company' and contract_id is null and company_category is not null)
    or (allocation = 'unassigned' and contract_id is null and company_category is null)
  )
);

create table public.company_costs (
  id uuid primary key default gen_random_uuid(),
  cost_date date not null,
  category text not null,
  description text not null default '',
  vendor text not null default '',
  document_number text not null default '',
  net_amount_cents bigint not null check (net_amount_cents >= 0),
  vat_rate numeric(5,2) not null default 23 check (vat_rate between 0 and 100),
  payment_status text not null default 'do_platnosci' check (payment_status in ('nowa', 'do_platnosci', 'oplacona', 'zaksiegowana')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index settlements_contract_date_idx on public.settlements(contract_id, settlement_date desc);
create index invoices_issue_date_idx on public.invoices(issue_date desc);
create index invoices_allocation_idx on public.invoices(allocation, issue_date desc);
create index company_costs_date_idx on public.company_costs(cost_date desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger contracts_updated_at before update on public.contracts for each row execute procedure public.set_updated_at();
create trigger settlements_updated_at before update on public.settlements for each row execute procedure public.set_updated_at();
create trigger invoices_updated_at before update on public.invoices for each row execute procedure public.set_updated_at();
create trigger company_costs_updated_at before update on public.company_costs for each row execute procedure public.set_updated_at();

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.can_manage_contracts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('owner', 'manager');
$$;

create or replace function public.can_manage_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('owner', 'accountant');
$$;

alter table public.profiles enable row level security;
alter table public.contracts enable row level security;
alter table public.settlements enable row level security;
alter table public.invoices enable row level security;
alter table public.company_costs enable row level security;

create policy "profile visible to owner or self" on public.profiles
  for select to authenticated using (id = auth.uid() or public.current_app_role() = 'owner');
create policy "owner manages profiles" on public.profiles
  for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');

create policy "authenticated users read contracts" on public.contracts
  for select to authenticated using (public.current_app_role() is not null);
create policy "managers manage contracts" on public.contracts
  for all to authenticated using (public.can_manage_contracts()) with check (public.can_manage_contracts());

create policy "authenticated users read settlements" on public.settlements
  for select to authenticated using (public.current_app_role() is not null);
create policy "managers manage settlements" on public.settlements
  for all to authenticated using (public.can_manage_contracts()) with check (public.can_manage_contracts());

create policy "authenticated users read invoices" on public.invoices
  for select to authenticated using (public.current_app_role() is not null);
create policy "finance manages invoices" on public.invoices
  for all to authenticated using (public.can_manage_finance()) with check (public.can_manage_finance());

create policy "authenticated users read company costs" on public.company_costs
  for select to authenticated using (public.current_app_role() is not null);
create policy "finance manages company costs" on public.company_costs
  for all to authenticated using (public.can_manage_finance()) with check (public.can_manage_finance());

-- RLS określa dostęp do rekordów, natomiast GRANT dopuszcza samą rolę
-- authenticated do wykonywania zapytań przez API Supabase.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.contracts to authenticated;
grant select, insert, update, delete on table public.settlements to authenticated;
grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete on table public.company_costs to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.can_manage_contracts() to authenticated;
grant execute on function public.can_manage_finance() to authenticated;
