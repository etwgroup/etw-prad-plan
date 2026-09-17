-- PrądPlan / prywatny magazyn dokumentów kontraktowych

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contract-documents',
  'contract-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do nothing;

create policy "active users download contract documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'contract-documents' and public.current_app_role() is not null);

create policy "managers upload contract documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contract-documents' and public.can_manage_contracts());

create policy "managers update contract documents" on storage.objects
  for update to authenticated
  using (bucket_id = 'contract-documents' and public.can_manage_contracts())
  with check (bucket_id = 'contract-documents' and public.can_manage_contracts());

create policy "managers delete contract documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'contract-documents' and public.can_manage_contracts());
