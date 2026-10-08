-- Share editors can write change_log / revisions. Version history already lives in public.revisions.

drop policy if exists "changelog insert" on public.change_log;
create policy "changelog insert" on public.change_log
  for insert with check (
    actor_id = auth.uid()
    and (
      public.can_edit_workspace(workspace_id)
      or (
        entity_type = 'collection'
        and public.can_edit_resource('collection', entity_id, workspace_id)
      )
      or (
        entity_type = 'folder'
        and public.can_edit_resource('folder', entity_id, workspace_id)
      )
      or (
        entity_type = 'request'
        and public.can_edit_resource('request', entity_id, workspace_id)
      )
    )
  );

drop policy if exists "revisions insert" on public.revisions;
create policy "revisions insert" on public.revisions
  for insert with check (
    actor_id = auth.uid()
    and (
      public.can_edit_workspace(workspace_id)
      or (
        entity_type = 'collection'
        and public.can_edit_resource('collection', entity_id, workspace_id)
      )
      or (
        entity_type = 'folder'
        and public.can_edit_resource('folder', entity_id, workspace_id)
      )
      or (
        entity_type = 'request'
        and public.can_edit_resource('request', entity_id, workspace_id)
      )
    )
  );

create index if not exists idx_revisions_entity on public.revisions (entity_type, entity_id, version);
