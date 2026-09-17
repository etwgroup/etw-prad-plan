-- PrądPlan / historia zmian

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on public.audit_log(entity, entity_id, created_at desc);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, action, entity, entity_id, before_data)
    values (auth.uid(), lower(tg_op), tg_table_name, old.id, to_jsonb(old));
    return old;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before_data, after_data)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger contracts_audit after insert or update or delete on public.contracts
  for each row execute procedure public.audit_row_change();
create trigger settlements_audit after insert or update or delete on public.settlements
  for each row execute procedure public.audit_row_change();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute procedure public.audit_row_change();
create trigger company_costs_audit after insert or update or delete on public.company_costs
  for each row execute procedure public.audit_row_change();

alter table public.audit_log enable row level security;

create policy "owners read audit log" on public.audit_log
  for select to authenticated using (public.current_app_role() = 'owner');
