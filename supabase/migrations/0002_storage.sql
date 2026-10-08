insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false), ('backups', 'backups', false)
on conflict (id) do nothing;

create policy "attachments member read"
on storage.objects for select
using (
  bucket_id = 'attachments'
  and public.can_read_workspace(((storage.foldername(name))[1])::uuid)
);

create policy "attachments editor write"
on storage.objects for insert
with check (
  bucket_id = 'attachments'
  and public.can_edit_workspace(((storage.foldername(name))[1])::uuid)
);

create policy "backups owner"
on storage.objects for all
using (
  bucket_id = 'backups'
  and auth.uid()::text = (storage.foldername(name))[1]
);
