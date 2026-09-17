-- PrądPlan / uprawnienia PostgreSQL dla aplikacji przeglądarkowej
-- Uruchom po migracjach 001-003. Ta migracja jest potrzebna także wtedy,
-- gdy 001-003 zostały już uruchomione w istniejącym projekcie.
--
-- GRANT pozwala roli authenticated wykonać zapytanie, a RLS nadal decyduje,
-- które rekordy i operacje są dozwolone dla konkretnego użytkownika.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.contracts to authenticated;
grant select, insert, update, delete on table public.settlements to authenticated;
grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete on table public.company_costs to authenticated;

grant select on table public.audit_log to authenticated;
grant select on table public.invoice_import_runs to authenticated;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.can_manage_contracts() to authenticated;
grant execute on function public.can_manage_finance() to authenticated;
