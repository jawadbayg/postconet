-- Resource-level sharing (collection / folder / request), invitations, and in-app notifications.
-- Access is enforced in Postgres RLS. The desktop app never receives a service-role key.

create type public.share_role as enum ('viewer', 'editor');
create type public.resource_kind as enum ('collection', 'folder', 'request');

create table public.resource_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  resource_kind public.resource_kind not null,
  resource_id uuid not null,
  grantee_user_id uuid not null references public.profiles (id) on delete cascade,
  role public.share_role not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (resource_kind, resource_id, grantee_user_id)
);

create table public.share_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  resource_kind public.resource_kind not null,
  resource_id uuid not null,
  resource_name text not null,
  email text not null,
  role public.share_role not null,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_resource_shares_grantee on public.resource_shares (grantee_user_id);
create index idx_share_invitations_email on public.share_invitations (email);
create index idx_notifications_user on public.notifications (user_id, created_at desc);

-- Service-role only: never grant this to anon/authenticated (prevents user-directory scraping).
create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and u.email_confirmed_at is not null
  limit 1;
$$;

revoke all on function public.lookup_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.lookup_user_id_by_email(text) to service_role;

create or replace function public.is_workspace_owner(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = ws and w.owner_user_id = auth.uid()
  ) or public.workspace_role(ws) = 'owner';
$$;

create or replace function public.direct_share_role(p_kind public.resource_kind, p_id uuid)
returns public.share_role
language sql
stable
security definer
set search_path = public
as $$
  select s.role
  from public.resource_shares s
  where s.resource_kind = p_kind
    and s.resource_id = p_id
    and s.grantee_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.folder_share_role(p_folder uuid)
returns public.share_role
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestors as (
    select f.id, f.parent_id, f.collection_id
    from public.folders f
    where f.id = p_folder
    union all
    select f.id, f.parent_id, f.collection_id
    from public.folders f
    join ancestors a on f.id = a.parent_id
  )
  select coalesce(
    (select public.direct_share_role('folder', a.id) from ancestors a where public.direct_share_role('folder', a.id) is not null limit 1),
    (select public.direct_share_role('collection', (select collection_id from ancestors limit 1)))
  );
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
      when public.workspace_role(p_workspace) in ('owner', 'administrator') then 'editor'
      when public.workspace_role(p_workspace) = 'editor' then 'editor'
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

create or replace function public.can_read_resource(p_kind public.resource_kind, p_id uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.resource_access_role(p_kind, p_id, p_workspace) is not null;
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

alter table public.resource_shares enable row level security;
alter table public.share_invitations enable row level security;
alter table public.notifications enable row level security;

create policy "shares grantee or owner read" on public.resource_shares
  for select using (
    grantee_user_id = auth.uid()
    or created_by = auth.uid()
    or public.is_workspace_owner(workspace_id)
  );

create policy "shares owner insert" on public.resource_shares
  for insert with check (public.is_workspace_owner(workspace_id) and created_by = auth.uid());

create policy "shares owner update" on public.resource_shares
  for update using (public.is_workspace_owner(workspace_id));

create policy "shares owner delete" on public.resource_shares
  for delete using (public.is_workspace_owner(workspace_id) or grantee_user_id = auth.uid());

-- Invitations: owners manage; recipients never list other people's invites via a directory.
-- Recipients accept through the share-accept Edge Function (service role), not client SELECT of all invites.
create policy "invites owner manage" on public.share_invitations
  for all using (public.is_workspace_owner(workspace_id) or invited_by = auth.uid());

create policy "notifications self" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications self update" on public.notifications
  for update using (user_id = auth.uid());

drop policy if exists "collections read" on public.collections;
drop policy if exists "collections edit" on public.collections;
create policy "collections read" on public.collections
  for select using (public.can_read_resource('collection', id, workspace_id));
create policy "collections insert" on public.collections
  for insert with check (public.can_edit_workspace(workspace_id));
create policy "collections update" on public.collections
  for update using (public.can_edit_resource('collection', id, workspace_id));
create policy "collections delete" on public.collections
  for delete using (public.is_workspace_owner(workspace_id));

drop policy if exists "folders read" on public.folders;
drop policy if exists "folders edit" on public.folders;
create policy "folders read" on public.folders
  for select using (public.can_read_resource('folder', id, workspace_id));
create policy "folders insert" on public.folders
  for insert with check (public.can_edit_resource('collection', collection_id, workspace_id));
create policy "folders update" on public.folders
  for update using (public.can_edit_resource('folder', id, workspace_id));
create policy "folders delete" on public.folders
  for delete using (public.can_edit_resource('folder', id, workspace_id));

drop policy if exists "requests read" on public.requests;
drop policy if exists "requests edit" on public.requests;
create policy "requests read" on public.requests
  for select using (public.can_read_resource('request', id, workspace_id));
create policy "requests insert" on public.requests
  for insert with check (public.can_edit_resource('collection', collection_id, workspace_id));
create policy "requests update" on public.requests
  for update using (public.can_edit_resource('request', id, workspace_id));
create policy "requests delete" on public.requests
  for delete using (public.can_edit_resource('request', id, workspace_id));

alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.resource_shares;
alter publication supabase_realtime add table public.share_invitations;
