-- Roles an admin builds from permissions (Scouting Admin > People > Roles). Each person holds at most one role
-- (user_profiles.access_role_id); no role means Member. Permissions are only ever given through a role: assigning a
-- role, or changing one, rewrites its holders' user_profiles.permissions (src/routes/api/access-roles/+server.js), so
-- every existing permission check keeps reading the same column. Changes land in activity_log like the other tables.
-- Rollback: drop table public.access_roles cascade; alter table public.user_profiles drop column access_role_id;

create table if not exists public.access_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  permissions text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_roles_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint access_roles_description_length check (char_length(description) <= 200),
  constraint access_roles_permissions_size check (coalesce(array_length(permissions, 1), 0) <= 64)
);
create unique index if not exists access_roles_name_key on public.access_roles (lower(btrim(name)));

alter table public.user_profiles
  add column if not exists access_role_id uuid references public.access_roles(id) on delete set null;
create index if not exists user_profiles_access_role_idx on public.user_profiles (access_role_id);

alter table public.access_roles enable row level security;
revoke all on table public.access_roles from anon, authenticated;
grant select on table public.access_roles to authenticated;
grant all on table public.access_roles to service_role;
drop policy if exists access_roles_read on public.access_roles;
create policy access_roles_read on public.access_roles for select to authenticated using (public.approved_user());

drop trigger if exists zz_activity_log on public.access_roles;
create trigger zz_activity_log after insert or delete or update on public.access_roles
  for each row execute function public.log_activity();

-- Team settings changes are logged too, so the Activity view covers who changed the look, the team or the menu.
drop trigger if exists zz_activity_log on public.app_settings;
create trigger zz_activity_log after insert or delete or update on public.app_settings
  for each row execute function public.log_activity();
