-- Whole-workspace invites use workspace_members (already in 0001).
-- Recipients must be able to read the owner's display name for the switcher label.

drop policy if exists "profiles visible in readable workspaces" on public.profiles;
create policy "profiles visible in readable workspaces"
on public.profiles
for select
using (
  exists (
    select 1
    from public.workspaces w
    where w.owner_user_id = profiles.id
      and public.can_read_workspace(w.id)
  )
  or exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = profiles.id
      and public.can_read_workspace(wm.workspace_id)
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_members'
  ) then
    alter publication supabase_realtime add table public.workspace_members;
  end if;
end $$;
