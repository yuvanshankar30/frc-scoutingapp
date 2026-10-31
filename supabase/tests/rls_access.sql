-- Row-level security test for the schema in supabase/migrations. It runs as real anon and authenticated
-- sessions inside one transaction that is rolled back, so it leaves nothing behind. Run it against a local
-- Supabase (`supabase start`, then `supabase db reset`):
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -v ON_ERROR_STOP=1 -f supabase/tests/rls_access.sql
-- Any failed expectation raises an exception (non-zero exit); success prints 'rls_access: all checks passed'.
begin;

create temporary table ids (name text primary key, id uuid not null) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('admin', gen_random_uuid()), ('scout', gen_random_uuid()), ('pending', gen_random_uuid());
insert into auth.users (id, email)
select id, name || '@example.test' from ids;

-- The trigger made a pending profile for each. Promote the admin and approve the scout as the server would.
update public.user_profiles set role = 'admin', general_role = 'lead' where id = (select id from ids where name = 'admin');
update public.user_profiles set general_role = 'member', permissions = array['CAN_SEE_ROUTES']
 where id = (select id from ids where name = 'scout');
insert into public.app_settings (id, team_number, team_name) values (1, 1234, 'Test Team')
  on conflict (id) do update set team_number = excluded.team_number, team_name = excluded.team_name;
insert into public.match_scout_entries (event_key, match_key, team_key, created_by)
values ('2026test', '2026test_qm1', 'frc254', (select id from ids where name = 'scout'));

create function pg_temp.act_as(who text) returns void language plpgsql as $$
begin
  if who = 'anon' then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'anon', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', (select id::text from ids where name = who), true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
  end if;
end $$;

create function pg_temp.expect(condition boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then raise exception 'FAILED: %', message; end if;
end $$;

-- Denied means an error, or (for an update RLS hides the row from) no rows changed.
create function pg_temp.expect_denied(statement text, message text) returns void language plpgsql as $$
declare changed integer;
begin
  execute statement;
  get diagnostics changed = row_count;
  if changed = 0 and statement ~* '^\s*(update|delete)' then return; end if;
  raise exception 'FAILED (allowed): %', message;
exception when insufficient_privilege or check_violation then null;
  when raise_exception then
    if sqlerrm like 'FAILED%' then raise; end if;
end $$;

-- Anyone, signed in or not, can read the team settings the sign-in page shows, and nothing else.
select pg_temp.act_as('anon');
select pg_temp.expect((select team_number from public.app_settings) = 1234, 'anon reads app_settings');
select pg_temp.expect_denied('select 1 from public.match_scout_entries', 'anon reads match reports');
select pg_temp.expect_denied('update public.app_settings set team_name = ''x''', 'anon writes app_settings');

-- A new account waiting for approval sees its own profile and no scouting data.
select pg_temp.act_as('pending');
select pg_temp.expect((select count(*) from public.match_scout_entries) = 0, 'pending account reads match reports');
select pg_temp.expect((select count(*) from public.user_profiles) = 1, 'pending account sees only its own profile');
select pg_temp.expect_denied(
  'update public.user_profiles set role = ''admin'' where id = (select id from ids where name = ''pending'')',
  'pending account makes itself admin');
select pg_temp.expect_denied(
  'update public.user_profiles set permissions = array[''CAN_SEE_ROUTES''] where id = (select id from ids where name = ''pending'')',
  'pending account approves itself');
select pg_temp.expect_denied('update public.app_settings set team_name = ''x''', 'pending account writes app_settings');

-- An approved scout reads the event's data but cannot change roles or the team settings.
select pg_temp.act_as('scout');
select pg_temp.expect((select count(*) from public.match_scout_entries) = 1, 'approved scout reads match reports');
select pg_temp.expect((select count(*) from public.user_profiles where id in (select id from ids)) = 3, 'approved scout sees the roster');
select pg_temp.expect_denied(
  'update public.user_profiles set permissions = array[''CAN_SEE_ROUTES''] where id = (select id from ids where name = ''pending'')',
  'scout approves someone else');
select pg_temp.expect_denied('update public.app_settings set team_name = ''x''', 'scout writes app_settings');

-- A banned account loses access straight away.
reset role;
update public.user_profiles set banned = true where id = (select id from ids where name = 'scout');
select pg_temp.act_as('scout');
select pg_temp.expect((select count(*) from public.match_scout_entries) = 0, 'banned scout reads match reports');

-- An admin approves accounts.
select pg_temp.act_as('admin');
update public.user_profiles set general_role = 'member', permissions = array['CAN_SEE_ROUTES']
 where id = (select id from ids where name = 'pending');
reset role;
select pg_temp.expect(
  (select permissions @> array['CAN_SEE_ROUTES'] from public.user_profiles where id = (select id from ids where name = 'pending')),
  'admin approves an account');

-- The profile guard's helper never describes another account, and the data-cleanup functions are server-only.
select pg_temp.act_as('pending');
select pg_temp.expect(
  (select auth_email from public.user_profiles_actor_context((select id from ids where name = 'admin'))) is null,
  'actor context describes another account');
reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.retention_sizes()', 'execute'), 'anon can run retention_sizes');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.retention_storage_objects(text,text)', 'execute'),
  'signed-in users can list stored files');

select 'rls_access: all checks passed' as result;
rollback;
