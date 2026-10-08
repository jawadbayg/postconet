-- Share recipients must see the workspace and parent containers without
-- inheriting the owner's environments or other credentials.
-- can_read_resource = visibility; can_edit_resource = editor (or workspace editor).

create or replace function public.has_resource_share(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.resource_shares s
    where s.workspace_id = ws
      and s.grantee_user_id = auth.uid()
  );
$$;

create or replace function public.can_read_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) is not null
      or public.has_resource_share(ws);
$$;

create or replace function public.strongest_share_role(roles public.share_role[])
returns public.share_role
language sql
immutable
as $$
  select case
    when 'editor' = any (roles) then 'editor'::public.share_role
    when 'viewer' = any (roles) then 'viewer'::public.share_role
    else null
  end;
$$;

create or replace function public.folder_share_role(p_folder uuid)
returns public.share_role
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestors as (
    select f.id, f.parent_id, f.collection_id, 0 as depth
    from public.folders f
    where f.id = p_folder
    union all
    select f.id, f.parent_id, f.collection_id, a.depth + 1
    from public.folders f
    join ancestors a on f.id = a.parent_id
  )
  select public.strongest_share_role(array_remove(array[
    (select public.direct_share_role('folder', p_folder)),
    (select public.strongest_share_role(array_agg(public.direct_share_role('folder', a.id))) from ancestors a),
    (select public.direct_share_role('collection', (select collection_id from ancestors limit 1)))
  ], null));
$$;

create or replace function public.resource_access_role(p_kind public.resource_kind, p_id uuid, p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case
      when public.workspace_role(p_workspace) in ('owner', 'administrator', 'editor') then 'editor'
      when public.workspace_role(p_workspace) = 'viewer' then 'viewer'
      else null
    end,
    case p_kind
      when 'collection' then public.direct_share_role('collection', p_id)::text
      when 'folder' then public.folder_share_role(p_id)::text
      when 'request' then coalesce(
        public.direct_share_role('request', p_id)::text,
        public.folder_share_role((select folder_id from public.requests where id = p_id))::text,
        public.direct_share_role('collection', (select collection_id from public.requests where id = p_id))::text
      )
    end
  );
$$;

create or replace function public.folder_subtree_ids(p_folder uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select f.id from public.folders f where f.id = p_folder
    union all
    select c.id from public.folders c join tree t on c.parent_id = t.id
  )
  select id from tree;
$$;

create or replace function public.can_see_resource(p_kind public.resource_kind, p_id uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.workspace_role(p_workspace) is not null
    or public.resource_access_role(p_kind, p_id, p_workspace) is not null
    or (
      p_kind = 'collection'
      and exists (
        select 1
        from public.resource_shares s
        where s.grantee_user_id = auth.uid()
          and s.workspace_id = p_workspace
          and (
            (s.resource_kind = 'collection' and s.resource_id = p_id)
            or (s.resource_kind = 'folder' and exists (
              select 1 from public.folders f where f.id = s.resource_id and f.collection_id = p_id
            ))
            or (s.resource_kind = 'request' and exists (
              select 1 from public.requests r where r.id = s.resource_id and r.collection_id = p_id
            ))
          )
      )
    )
    or (
      p_kind = 'folder'
      and exists (
        select 1
        from public.resource_shares s
        join public.requests r on r.id = s.resource_id
        where s.grantee_user_id = auth.uid()
          and s.resource_kind = 'request'
          and r.folder_id is not null
          and r.folder_id in (select public.folder_subtree_ids(p_id))
      )
    );
$$;

create or replace function public.can_read_resource(p_kind public.resource_kind, p_id uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_see_resource(p_kind, p_id, p_workspace);
$$;

create or replace function public.can_edit_resource(p_kind public.resource_kind, p_id uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.resource_access_role(p_kind, p_id, p_workspace) = 'editor';
$$;

-- Environments and globals stay with workspace members/owners — never auto-shared.
drop policy if exists "envs read" on public.environments;
drop policy if exists "envs edit" on public.environments;
create policy "envs read" on public.environments
  for select using (public.workspace_role(workspace_id) is not null);
create policy "envs edit" on public.environments
  for all using (public.can_edit_workspace(workspace_id));

drop policy if exists "globals read" on public.globals;
drop policy if exists "globals edit" on public.globals;
create policy "globals read" on public.globals
  for select using (public.workspace_role(workspace_id) is not null);
create policy "globals edit" on public.globals
  for all using (public.can_edit_workspace(workspace_id));

drop policy if exists "changelog read" on public.change_log;
create policy "changelog read" on public.change_log
  for select using (
    public.workspace_role(workspace_id) is not null
    or (
      entity_type = 'collection'
      and public.can_read_resource('collection', entity_id, workspace_id)
    )
    or (
      entity_type = 'folder'
      and public.can_read_resource('folder', entity_id, workspace_id)
    )
    or (
      entity_type = 'request'
      and public.can_read_resource('request', entity_id, workspace_id)
    )
  );

grant execute on function public.has_resource_share(uuid) to authenticated;
grant execute on function public.folder_subtree_ids(uuid) to authenticated;
grant execute on function public.can_see_resource(public.resource_kind, uuid, uuid) to authenticated;
grant execute on function public.can_read_resource(public.resource_kind, uuid, uuid) to authenticated;
grant execute on function public.can_edit_resource(public.resource_kind, uuid, uuid) to authenticated;
grant execute on function public.resource_access_role(public.resource_kind, uuid, uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
