-- Security follow-ups to the initial schema.
--
-- 1. user_profiles_actor_context() only answers for the signed-in caller. The profile guard only ever asks about the
--    caller, but signed-in users can also call the function through the API, and it would have told a pending account
--    another account's role, ban status and email.
-- 2. Supabase grants EXECUTE on new functions in `public` straight to anon and authenticated, which `revoke ... from
--    public` does not remove. These functions are for the server or for triggers only, so client roles lose it:
--    the data-cleanup inventory (it reports table sizes and stored file names) and the trigger functions.

create or replace function public.user_profiles_actor_context(p_actor uuid, out profile_exists boolean,
  out actor_role text, out actor_permissions text[], out actor_banned boolean, out actor_is_dev boolean,
  out auth_email text) returns record
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  profile_exists := false;
  actor_role := 'member';
  actor_permissions := '{}'::text[];
  actor_banned := false;
  actor_is_dev := false;
  auth_email := null;

  -- Only ever about the caller: any other id gets the defaults above.
  if p_actor is null or p_actor is distinct from auth.uid() then
    return;
  end if;

  select u.email into auth_email from auth.users u where u.id = p_actor;

  select true, coalesce(up.role, 'member')::text, coalesce(up.permissions, '{}'::text[]), coalesce(up.banned, false),
         coalesce(up.is_dev, false)
    into profile_exists, actor_role, actor_permissions, actor_banned, actor_is_dev
  from public.user_profiles up
  where up.id = p_actor;

  profile_exists := coalesce(profile_exists, false);
  actor_role := coalesce(actor_role, 'member');
  actor_permissions := coalesce(actor_permissions, '{}'::text[]);
  actor_banned := coalesce(actor_banned, false);
  actor_is_dev := coalesce(actor_is_dev, false);
end;
$function$;
revoke all on function public.user_profiles_actor_context(uuid) from public, anon;
grant execute on function public.user_profiles_actor_context(uuid) to authenticated, service_role;

revoke all on function public.retention_sizes() from public, anon, authenticated;
revoke all on function public.retention_event_inventory() from public, anon, authenticated;
revoke all on function public.retention_storage_objects(text, text) from public, anon, authenticated;
grant execute on function public.retention_sizes() to service_role;
grant execute on function public.retention_event_inventory() to service_role;
grant execute on function public.retention_storage_objects(text, text) to service_role;

-- Trigger functions never run through the API (EXECUTE is only checked when a trigger is created).
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.log_activity() from public, anon, authenticated;
revoke all on function public.user_profiles_security_guard() from public, anon, authenticated;
revoke all on function public.complete_match_scout_assignment_from_report() from public, anon, authenticated;
