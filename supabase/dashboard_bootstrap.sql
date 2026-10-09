-- PostConet dashboard bootstrap: run once in SQL Editor (New query → paste all → Run).
-- Do not re-run if it succeeded. Fresh project only.
-- Combines 0001_init, 0002_storage, 0003_resource_shares, 0004_share_visibility.

-- PostConet API Studio schema. RLS on every client-accessible table.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type org_role as enum ('owner', 'administrator', 'editor', 'viewer');
create type workspace_kind as enum ('personal', 'private', 'shared');
create type change_op as enum ('upsert', 'delete');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.auth_throttle (
  email text primary key,
  attempts int not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role org_role not null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role org_role not null,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind workspace_kind not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references public.profiles (id) on delete cascade,
  description text,
  archived_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  constraint workspace_owner_ck check (
    (kind = 'personal' and owner_user_id is not null and organization_id is null)
    or (kind in ('private', 'shared') and organization_id is not null)
  )
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role org_role not null default 'editor',
  primary key (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  sort_order bigint not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  name text not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  collection_id uuid not null references public.collections (id) on delete cascade,
  parent_id uuid references public.folders (id) on delete cascade,
  name text not null,
  sort_order bigint not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  collection_id uuid not null references public.collections (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  name text not null,
  protocol text not null default 'http',
  sort_order bigint not null default 0,
  favorite boolean not null default false,
  archived_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table public.environments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table public.globals (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  payload jsonb not null default '[]'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_id uuid not null,
  author_id uuid not null references public.profiles (id),
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  version bigint not null,
  payload jsonb not null,
  actor_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.change_log (
  seq bigserial primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  op change_op not null,
  version bigint not null,
  payload jsonb,
  actor_id uuid not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.collab_documents (
  entity_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  snapshot bytea,
  updated_at timestamptz not null default now()
);

create table public.collab_updates (
  id bigserial primary key,
  entity_id uuid not null references public.collab_documents (entity_id) on delete cascade,
  workspace_id uuid not null,
  update bytea not null,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.presence (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, client_id)
);

create table public.shared_secrets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  ciphertext bytea not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  collection_id uuid,
  actor_id uuid not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  collection_id uuid,
  name text not null,
  cron text not null,
  local_only boolean not null default true,
  enabled boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.monitor_runs (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  report jsonb
);

create table public.mocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  collection_id uuid,
  name text not null,
  hosted boolean not null default false,
  slug text unique,
  payload jsonb not null default '{}'::jsonb
);

create index idx_change_log_ws_seq on public.change_log (workspace_id, seq);
create index idx_requests_ws on public.requests (workspace_id);
create index idx_collections_ws on public.collections (workspace_id);
create index idx_folders_col on public.folders (collection_id);

-- Helpers
create or replace function public.is_org_member(org uuid, min_role org_role default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and (
        min_role = 'viewer'
        or (min_role = 'editor' and m.role in ('editor','administrator','owner'))
        or (min_role = 'administrator' and m.role in ('administrator','owner'))
        or (min_role = 'owner' and m.role = 'owner')
      )
  );
$$;

create or replace function public.workspace_role(ws uuid)
returns org_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select wm.role from public.workspace_members wm where wm.workspace_id = ws and wm.user_id = auth.uid()),
    (select m.role from public.workspaces w
       join public.memberships m on m.organization_id = w.organization_id
      where w.id = ws and m.user_id = auth.uid()),
    (select 'owner'::org_role from public.workspaces w where w.id = ws and w.owner_user_id = auth.uid())
  );
$$;

create or replace function public.can_read_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) is not null;
$$;

create or replace function public.can_edit_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) in ('editor','administrator','owner');
$$;

create or replace function public.can_admin_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) in ('administrator','owner');
$$;

-- Profile bootstrap
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.workspaces (id, name, kind, owner_user_id, payload)
  values (gen_random_uuid(), 'Personal', 'personal', new.id, jsonb_build_object('name','Personal'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.auth_throttle enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.collections enable row level security;
alter table public.folders enable row level security;
alter table public.requests enable row level security;
alter table public.environments enable row level security;
alter table public.globals enable row level security;
alter table public.comments enable row level security;
alter table public.revisions enable row level security;
alter table public.change_log enable row level security;
alter table public.collab_documents enable row level security;
alter table public.collab_updates enable row level security;
alter table public.presence enable row level security;
alter table public.shared_secrets enable row level security;
alter table public.audit_log enable row level security;
alter table public.runs enable row level security;
alter table public.monitors enable row level security;
alter table public.monitor_runs enable row level security;
alter table public.mocks enable row level security;

create policy "profiles self read" on public.profiles for select using (auth.uid() = id or exists (
  select 1 from public.memberships m
  join public.memberships m2 on m2.organization_id = m.organization_id
  where m.user_id = auth.uid() and m2.user_id = profiles.id
));
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

create policy "orgs member select" on public.organizations for select using (public.is_org_member(id));
create policy "orgs owner update" on public.organizations for update using (public.is_org_member(id, 'administrator'));
create policy "orgs insert" on public.organizations for insert with check (created_by = auth.uid());

create policy "memberships member select" on public.memberships for select using (public.is_org_member(organization_id));
create policy "memberships admin write" on public.memberships for all using (public.is_org_member(organization_id, 'administrator'));

create policy "invites admin" on public.invitations for all using (public.is_org_member(organization_id, 'administrator'));

create policy "workspaces read" on public.workspaces for select using (public.can_read_workspace(id));
create policy "workspaces insert personal" on public.workspaces for insert with check (
  (kind = 'personal' and owner_user_id = auth.uid())
  or (kind in ('private','shared') and public.is_org_member(organization_id, 'administrator'))
);
create policy "workspaces update" on public.workspaces for update using (public.can_edit_workspace(id));
create policy "workspaces delete" on public.workspaces for delete using (public.can_admin_workspace(id) or owner_user_id = auth.uid());

create policy "ws members read" on public.workspace_members for select using (public.can_read_workspace(workspace_id));
create policy "ws members admin" on public.workspace_members for all using (public.can_admin_workspace(workspace_id));

create policy "projects read" on public.projects for select using (public.can_read_workspace(workspace_id));
create policy "projects edit" on public.projects for all using (public.can_edit_workspace(workspace_id));

create policy "collections read" on public.collections for select using (public.can_read_workspace(workspace_id));
create policy "collections edit" on public.collections for all using (public.can_edit_workspace(workspace_id));

create policy "folders read" on public.folders for select using (public.can_read_workspace(workspace_id));
create policy "folders edit" on public.folders for all using (public.can_edit_workspace(workspace_id));

create policy "requests read" on public.requests for select using (public.can_read_workspace(workspace_id));
create policy "requests edit" on public.requests for all using (public.can_edit_workspace(workspace_id));

create policy "envs read" on public.environments for select using (public.can_read_workspace(workspace_id));
create policy "envs edit" on public.environments for all using (public.can_edit_workspace(workspace_id));

create policy "globals read" on public.globals for select using (public.can_read_workspace(workspace_id));
create policy "globals edit" on public.globals for all using (public.can_edit_workspace(workspace_id));

create policy "comments read" on public.comments for select using (public.can_read_workspace(workspace_id));
create policy "comments insert" on public.comments for insert with check (
  public.workspace_role(workspace_id) in ('editor','administrator','owner') and author_id = auth.uid()
);

create policy "revisions read" on public.revisions for select using (public.can_read_workspace(workspace_id));
create policy "revisions insert" on public.revisions for insert with check (public.can_edit_workspace(workspace_id));

create policy "changelog read" on public.change_log for select using (public.can_read_workspace(workspace_id));
create policy "changelog insert" on public.change_log for insert with check (public.can_edit_workspace(workspace_id) and actor_id = auth.uid());

create policy "collab doc read" on public.collab_documents for select using (public.can_read_workspace(workspace_id));
create policy "collab doc edit" on public.collab_documents for all using (public.can_edit_workspace(workspace_id));
create policy "collab upd read" on public.collab_updates for select using (public.can_read_workspace(workspace_id));
create policy "collab upd insert" on public.collab_updates for insert with check (public.can_edit_workspace(workspace_id));

create policy "presence rw" on public.presence for all using (public.can_read_workspace(workspace_id) and user_id = auth.uid());
create policy "presence read others" on public.presence for select using (public.can_read_workspace(workspace_id));

create policy "secrets read editors" on public.shared_secrets for select using (public.can_edit_workspace(workspace_id));
create policy "secrets write admin" on public.shared_secrets for all using (public.can_admin_workspace(workspace_id));

create policy "audit admin" on public.audit_log for select using (false);
create policy "runs read" on public.runs for select using (public.can_read_workspace(workspace_id));
create policy "runs insert" on public.runs for insert with check (public.can_edit_workspace(workspace_id));
create policy "monitors read" on public.monitors for select using (public.can_read_workspace(workspace_id));
create policy "monitors edit" on public.monitors for all using (public.can_edit_workspace(workspace_id));
create policy "monitor runs read" on public.monitor_runs for select using (
  exists (select 1 from public.monitors m where m.id = monitor_id and public.can_read_workspace(m.workspace_id))
);
create policy "mocks read" on public.mocks for select using (public.can_read_workspace(workspace_id));
create policy "mocks edit" on public.mocks for all using (public.can_edit_workspace(workspace_id));

-- Viewers cannot update request payloads: enforced by can_edit_workspace.
-- auth_throttle is service-only
create policy "throttle deny" on public.auth_throttle for all using (false);

alter publication supabase_realtime add table public.change_log;
alter publication supabase_realtime add table public.collab_updates;
alter publication supabase_realtime add table public.presence;
alter publication supabase_realtime add table public.memberships;
alter publication supabase_realtime add table public.workspace_members;
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

-- 0008_workspace_invite: owner names on shared workspaces + realtime members
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
