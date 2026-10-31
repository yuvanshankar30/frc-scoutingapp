-- FRC Scouting App: the whole database schema, for a new Supabase project.
--
-- Apply it with `supabase db push` (or paste it into the Supabase SQL editor). It creates every table the
-- app uses, their row-level security policies and grants, the triggers that create a profile for each new
-- account, the storage buckets for pit photos and the team logo, and the starting rows (see seed.sql for
-- nothing else: there is no team data in here). Your team is set up on the site itself, in first-run setup.
--
-- Access rules in short: nothing is readable until an admin approves the account (public.approved_user()),
-- except app_settings (your team name, colors and logo), which the sign-in page shows to everyone.

create extension if not exists pgcrypto with schema extensions;

--
-- PostgreSQL database dump
--





SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: approved_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approved_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select (up.role = 'admin') or (coalesce(up.permissions, '{}'::text[]) @> array['CAN_SEE_ROUTES'])
    from public.user_profiles up
    where up.id = auth.uid() and coalesce(up.banned, false) = false
  ), false);
$$;


--
-- Name: complete_match_scout_assignment_from_report(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_match_scout_assignment_from_report() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  assignment_match_suffix text;
  match_digits text;
BEGIN
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND NEW.created_by <> auth.uid() AND NOT public.has_permission('DATA_SCOUT_ADMIN') THEN
    RETURN NEW;
  END IF;

  IF NEW.match_key LIKE '%\_%' ESCAPE '\' THEN
    assignment_match_suffix := lower(split_part(NEW.match_key, '_', 2));
  ELSIF NEW.match_key ~* '^(qm|qf|sf|f)[0-9]' THEN
    assignment_match_suffix := lower(NEW.match_key);
  ELSE
    match_digits := (regexp_match(NEW.match_key, '[0-9]+'))[1];
    assignment_match_suffix := CASE WHEN match_digits IS NOT NULL THEN 'qm' || match_digits ELSE NULL END;
  END IF;

  IF assignment_match_suffix IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.scout_match_assignments
  SET completed_at = coalesce(NEW.updated_at, NEW.created_at, now())
  WHERE scouting_type = 'data'
    AND completed_at IS NULL
    AND assigned_user = NEW.created_by
    AND team_key = NEW.team_key
    AND split_part(match_key, '_', 1) = NEW.event_key
    AND lower(split_part(match_key, '_', 2)) = assignment_match_suffix;

  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.user_profiles (id, email, full_name, role, general_role, team_role, frc_team, permissions, banned, is_dev)
  values (new.id, new.email, coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), new.email),
          'member', 'none', 'other', null, '{}'::text[], false, false)
  on conflict (id) do nothing;
  return new;
end;
$$;


--
-- Name: has_any_permission(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_any_permission(required text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT (up.role = 'admin')
             OR (required IS NOT NULL AND COALESCE(up.permissions, '{}'::text[]) && required)
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND COALESCE(up.banned, false) = false
    ),
    FALSE
  );
$$;


--
-- Name: has_permission(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_permission(required text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT (up.role = 'admin')
             OR (COALESCE(up.permissions, '{}'::text[]) @> ARRAY[required])
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND COALESCE(up.banned, false) = false
    ),
    FALSE
  );
$$;


--
-- Name: is_event_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_event_key(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $_$ select value ~ '^[0-9]{4}[a-z][a-z0-9]{1,27}$' $_$;


--
-- Name: is_frc_team_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_frc_team_key(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $_$ select value ~ '^frc[0-9]{1,5}$' $_$;


--
-- Name: is_match_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_match_key(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $_$ select value ~ '^[0-9a-z]+_(qm|ef|qf|sf|f|pm)[0-9]+(m[0-9]+)?$' $_$;


--
-- Name: is_privileged_roster_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_privileged_roster_key(p_key_name text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select lower(trim(coalesce(p_key_name, ''))) = any (array[
    'competition lead', 'scouting lead', 'strategy lead', 'pit lead', 'picklist 1 lead', 'picklist 2 lead', 'scouting admin'
  ]);
$$;


--
-- Name: log_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_old jsonb := NULL;
  v_new jsonb := NULL;
  v_changed text[] := NULL;
  v_actor uuid := auth.uid();
  v_actor_text text := NULL;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_old := to_jsonb(OLD);
  ELSIF (TG_OP = 'INSERT') THEN
    v_new := to_jsonb(NEW);
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT array_agg(key) INTO v_changed
    FROM jsonb_each(v_new) n
    WHERE n.value IS DISTINCT FROM (v_old -> n.key);
    -- Skip no-op updates
    IF v_changed IS NULL THEN RETURN NULL; END IF;
  END IF;

  IF v_actor IS NULL THEN
    v_actor_text := COALESCE(
      v_new ->> 'updated_by',
      v_new ->> 'created_by',
      v_new ->> 'set_by',
      v_new ->> 'resolved_by',
      v_old ->> 'updated_by',
      v_old ->> 'created_by'
    );
    IF v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_actor := v_actor_text::uuid;
    END IF;
  END IF;

  INSERT INTO public.activity_log(table_name, operation, row_id, actor, changed_columns, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(v_new ->> 'id', v_old ->> 'id', v_new ->> 'event_key', v_old ->> 'event_key'),
    v_actor,
    v_changed,
    v_old,
    v_new
  );
  RETURN NULL;
END;
$_$;


--
-- Name: retention_event_inventory(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retention_event_inventory() RETURNS TABLE(source text, event_key text, items bigint, newest timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select 'scout_data_events'::text, lower(split_part(e.match_key, '_', 1)), count(*), max(e.created_at)
    from public.scout_data_events e
   where e.match_key like '%\_%'
   group by 2
  union all
  select 'storage:' || o.bucket_id, lower(split_part(o.name, '/', 1)), count(*), max(o.created_at)
    from storage.objects o
   where o.bucket_id = 'pit-scout-photos'
   group by o.bucket_id, 2;
$$;


--
-- Name: retention_sizes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retention_sizes() RETURNS TABLE(kind text, name text, bytes bigint, objects bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select 'database'::text, current_database()::text, pg_database_size(current_database()), null::bigint
  union all
  select 'table'::text, c.relname::text, pg_total_relation_size(c.oid), greatest(c.reltuples, 0)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'bucket'::text, o.bucket_id::text, coalesce(sum((o.metadata->>'size')::bigint), 0), count(*)
    from storage.objects o
   group by o.bucket_id;
$$;


--
-- Name: retention_storage_objects(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retention_storage_objects(p_bucket text, p_event_key text) RETURNS TABLE(name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select o.name::text
    from storage.objects o
   where p_bucket = 'pit-scout-photos'
     and o.bucket_id = p_bucket
     and length(coalesce(p_event_key, '')) > 0
     and lower(split_part(o.name, '/', 1)) = lower(p_event_key)
   order by o.name;
$$;


--
-- Name: robot_tickets_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.robot_tickets_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: user_profiles_actor_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_profiles_actor_context(p_actor uuid, OUT profile_exists boolean, OUT actor_role text, OUT actor_permissions text[], OUT actor_banned boolean, OUT actor_is_dev boolean, OUT auth_email text) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  profile_exists := false;
  actor_role := 'member';
  actor_permissions := '{}'::text[];
  actor_banned := false;
  actor_is_dev := false;
  auth_email := NULL;

  IF p_actor IS NULL THEN
    RETURN;
  END IF;

  SELECT u.email INTO auth_email
  FROM auth.users u
  WHERE u.id = p_actor;

  SELECT
    true,
    COALESCE(up.role, 'member')::text,
    COALESCE(up.permissions, '{}'::text[]),
    COALESCE(up.banned, false),
    COALESCE(up.is_dev, false)
  INTO
    profile_exists,
    actor_role,
    actor_permissions,
    actor_banned,
    actor_is_dev
  FROM public.user_profiles up
  WHERE up.id = p_actor;

  profile_exists := COALESCE(profile_exists, false);
  actor_role := COALESCE(actor_role, 'member');
  actor_permissions := COALESCE(actor_permissions, '{}'::text[]);
  actor_banned := COALESCE(actor_banned, false);
  actor_is_dev := COALESCE(actor_is_dev, false);
END;
$$;


--
-- Name: user_profiles_security_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_profiles_security_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_db_role text := current_user::text;
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
  v_actor uuid := auth.uid();
  v_ctx record;
  v_can_edit_roles boolean := false;
  v_can_ban_users boolean := false;
  v_is_super_admin boolean := false;
begin
  -- The server (service_role), migrations and security-definer triggers (handle_new_user) are trusted.
  if v_db_role not in ('authenticated', 'anon') or v_jwt_role = 'service_role' then
    return new;
  end if;
  if v_db_role = 'anon' or v_actor is null then
    raise exception 'Authentication required to modify user_profiles' using errcode = '42501';
  end if;

  select * into v_ctx from public.user_profiles_actor_context(v_actor);
  if coalesce(v_ctx.actor_banned, false) then
    raise exception 'Banned accounts cannot modify user_profiles' using errcode = '42501';
  end if;

  v_is_super_admin := coalesce(v_ctx.actor_is_dev, false) or v_ctx.actor_role = 'admin';
  v_can_edit_roles := v_is_super_admin
    or (v_ctx.actor_permissions && array['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text, 'APPROVE_USERS'::text]);
  v_can_ban_users := v_is_super_admin or (v_ctx.actor_permissions && array['BAN_USERS'::text]);

  if tg_op = 'INSERT' then
    if new.id is distinct from v_actor and not v_is_super_admin then
      raise exception 'Cannot insert a user_profiles row for another user' using errcode = '42501';
    end if;
    if not v_is_super_admin then
      new.role := 'member';
      new.general_role := 'none';
      new.team_role := 'other';
      new.frc_team := null;
      new.permissions := '{}'::text[];
      new.banned := false;
      new.is_dev := false;
      new.slack_user_id := null;
      new.slack_dm_channel := null;
      new.email := coalesce(v_ctx.auth_email, new.email);
    elsif coalesce(new.is_dev, false) and not coalesce(v_ctx.actor_is_dev, false) then
      raise exception 'Only a developer account may grant is_dev' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Cannot change user_profiles.id' using errcode = '42501';
  end if;
  if (old.is_dev is distinct from new.is_dev or coalesce(old.is_dev, false))
     and not coalesce(v_ctx.actor_is_dev, false)
     and (old.is_dev is distinct from new.is_dev or old.id <> v_actor) then
    raise exception 'Only a developer account may modify developer status or another developer profile' using errcode = '42501';
  end if;
  if new.email is distinct from old.email then
    raise exception 'The account email can only be changed by the server' using errcode = '42501';
  end if;

  -- Your own row: name, theme and notification settings only.
  if old.id = v_actor then
    if new.role is distinct from old.role
       or new.general_role is distinct from old.general_role
       or new.team_role is distinct from old.team_role
       or new.frc_team is distinct from old.frc_team
       or new.permissions is distinct from old.permissions
       or new.banned is distinct from old.banned
       or new.is_dev is distinct from old.is_dev
       or (not v_is_super_admin and (new.slack_user_id is distinct from old.slack_user_id
                                     or new.slack_dm_channel is distinct from old.slack_dm_channel)) then
      raise exception 'Cannot modify privileged profile fields on your own account' using errcode = '42501';
    end if;
    return new;
  end if;

  if not (v_can_edit_roles or v_can_ban_users) then
    raise exception 'Not authorized to modify another user profile' using errcode = '42501';
  end if;
  if (old.role = 'admin' or new.role = 'admin' or old.role is distinct from new.role) and not v_is_super_admin then
    raise exception 'Only an administrator may grant or modify the admin role' using errcode = '42501';
  end if;
  if new.banned is distinct from old.banned and not v_can_ban_users then
    raise exception 'Not authorized to change account ban status' using errcode = '42501';
  end if;
  if (new.general_role is distinct from old.general_role
      or new.team_role is distinct from old.team_role
      or new.frc_team is distinct from old.frc_team
      or new.permissions is distinct from old.permissions)
     and not v_can_edit_roles then
    raise exception 'Not authorized to modify user roles or permissions' using errcode = '42501';
  end if;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id bigint NOT NULL,
    table_name text NOT NULL,
    operation text NOT NULL,
    row_id text,
    actor uuid,
    changed_columns text[],
    old_data jsonb,
    new_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id integer DEFAULT 1 NOT NULL,
    team_number integer NOT NULL,
    team_name text DEFAULT ''::text NOT NULL,
    other_team_numbers integer[] DEFAULT '{}'::integer[] NOT NULL,
    app_name text DEFAULT ''::text NOT NULL,
    app_short_name text DEFAULT ''::text NOT NULL,
    brand_color text DEFAULT '#2563eb'::text NOT NULL,
    default_theme text DEFAULT 'dark'::text NOT NULL,
    time_zone text DEFAULT 'UTC'::text NOT NULL,
    logo_url text,
    hidden_features text[] DEFAULT '{}'::text[] NOT NULL,
    allow_sign_up boolean DEFAULT true NOT NULL,
    setup_completed_at timestamp with time zone,
    setup_by uuid,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_settings_brand_color_check CHECK ((brand_color ~ '^#[0-9a-f]{6}$'::text)),
    CONSTRAINT app_settings_default_theme_check CHECK ((default_theme = ANY (ARRAY['dark'::text, 'light'::text]))),
    CONSTRAINT app_settings_id_check CHECK ((id = 1)),
    CONSTRAINT app_settings_team_number_check CHECK (((team_number >= 1) AND (team_number <= 99999)))
);


--
-- Name: competition_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_team_members (
    user_id uuid NOT NULL,
    frc_team text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT competition_team_members_frc_team_check CHECK (((frc_team = 'Mentor'::text) OR (frc_team ~ '^[1-9][0-9]{0,4}$'::text)))
);


--
-- Name: match_scout_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_scout_entries (
    id bigint NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    team_key text NOT NULL,
    alliance text,
    starting_position text,
    auto_start_zone text,
    auto_points_band text,
    auto_finish text,
    auto_moved text,
    ball_sources text[] DEFAULT '{}'::text[] NOT NULL,
    auto_path jsonb DEFAULT '[]'::jsonb NOT NULL,
    ratings jsonb DEFAULT '{}'::jsonb NOT NULL,
    teleop_notes text,
    crash_or_break boolean DEFAULT false NOT NULL,
    robot_disabled text,
    card text,
    driver_skill integer,
    post_notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auto_collision boolean DEFAULT false NOT NULL,
    auto_collision_notes text,
    intake_speed integer,
    intake_jammed boolean DEFAULT false NOT NULL,
    auto_path_name text,
    balls_scored_band text,
    balls_scored_min numeric,
    balls_scored_max numeric,
    balls_scored_average numeric,
    auto_points_min numeric,
    auto_points_max numeric,
    auto_points_average numeric,
    teleop_roles text[] DEFAULT '{}'::text[] NOT NULL,
    form_version integer DEFAULT 1 NOT NULL,
    scout_name text,
    preload boolean,
    auto_cycles integer,
    teleop_roles_none boolean DEFAULT false NOT NULL,
    ratings_unknown text[] DEFAULT '{}'::text[] NOT NULL,
    significant_crash boolean,
    crash_target text,
    crash_details text,
    teleop_robot_status text,
    mechanical_break boolean,
    beached boolean DEFAULT false NOT NULL,
    custom_answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    custom_form_version integer,
    shuttled boolean,
    shuttle_band text,
    shuttle_min numeric,
    shuttle_max numeric,
    shuttle_average numeric,
    shuttle_rating integer,
    shuttle_notes text,
    offense_rating integer,
    defense_rating integer,
    performance_notes text,
    power_ranking jsonb DEFAULT '{}'::jsonb NOT NULL,
    fouls_minor integer,
    fouls_major integer,
    break_details text,
    break_impact text,
    break_response text,
    report_kind text DEFAULT 'data'::text NOT NULL,
    match_label text,
    scouted_by uuid,
    robot_present boolean,
    CONSTRAINT match_scout_entries_alliance_check CHECK (((alliance IS NULL) OR (alliance = ANY (ARRAY['red'::text, 'blue'::text])))),
    CONSTRAINT match_scout_entries_auto_collision_notes_length_check CHECK (((auto_collision_notes IS NULL) OR (char_length(auto_collision_notes) <= 500))),
    CONSTRAINT match_scout_entries_auto_cycles_check CHECK (((auto_cycles >= 0) AND (auto_cycles <= 100))),
    CONSTRAINT match_scout_entries_auto_path_name_length_check CHECK (((auto_path_name IS NULL) OR (char_length(auto_path_name) <= 120))),
    CONSTRAINT match_scout_entries_card_check CHECK (((card IS NULL) OR (card = ANY (ARRAY[''::text, 'yellow'::text, 'red'::text])))),
    CONSTRAINT match_scout_entries_crash_target_check CHECK ((crash_target = ANY (ARRAY['robot'::text, 'wall'::text, 'field element'::text, 'other'::text]))),
    CONSTRAINT match_scout_entries_data_only_fields CHECK (((COALESCE(report_kind, 'data'::text) = 'data'::text) OR (num_nonnulls(starting_position, auto_start_zone, auto_points_band, auto_points_min, auto_points_max, auto_points_average, auto_finish, auto_moved, auto_path_name, auto_cycles, preload, teleop_notes, balls_scored_band, balls_scored_min, balls_scored_max, balls_scored_average, shuttled, shuttle_band, shuttle_min, shuttle_max, shuttle_average, shuttle_rating, shuttle_notes) = 0))),
    CONSTRAINT match_scout_entries_defense_rating_check CHECK (((defense_rating IS NULL) OR ((defense_rating >= 1) AND (defense_rating <= 5)))),
    CONSTRAINT match_scout_entries_driver_skill_check CHECK (((driver_skill IS NULL) OR ((driver_skill >= 0) AND (driver_skill <= 5)))),
    CONSTRAINT match_scout_entries_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT match_scout_entries_fouls_check CHECK ((((fouls_minor IS NULL) OR ((fouls_minor >= 0) AND (fouls_minor <= 50))) AND ((fouls_major IS NULL) OR ((fouls_major >= 0) AND (fouls_major <= 50))))),
    CONSTRAINT match_scout_entries_intake_speed_check CHECK (((intake_speed IS NULL) OR ((intake_speed >= 1) AND (intake_speed <= 3)))),
    CONSTRAINT match_scout_entries_match_label_check CHECK (((match_label IS NULL) OR (char_length(match_label) <= 120))),
    CONSTRAINT match_scout_entries_offense_rating_check CHECK (((offense_rating IS NULL) OR ((offense_rating >= 1) AND (offense_rating <= 5)))),
    CONSTRAINT match_scout_entries_performance_only_fields CHECK (((COALESCE(report_kind, 'data'::text) = 'performance'::text) OR (num_nonnulls(offense_rating, defense_rating, performance_notes) = 0))),
    CONSTRAINT match_scout_entries_power_ranking_object_check CHECK ((jsonb_typeof(power_ranking) = 'object'::text)),
    CONSTRAINT match_scout_entries_report_kind_check CHECK ((report_kind = ANY (ARRAY['data'::text, 'performance'::text, 'robot'::text]))),
    CONSTRAINT match_scout_entries_robot_only_fields CHECK (((COALESCE(report_kind, 'data'::text) = 'robot'::text) OR (num_nonnulls(fouls_minor, fouls_major, break_details, break_impact, break_response) = 0))),
    CONSTRAINT match_scout_entries_shuttle_rating_check CHECK (((shuttle_rating IS NULL) OR ((shuttle_rating >= 1) AND (shuttle_rating <= 5)))),
    CONSTRAINT match_scout_entries_team_key_format CHECK (public.is_frc_team_key(team_key)),
    CONSTRAINT match_scout_entries_teleop_robot_status_check CHECK ((teleop_robot_status = ANY (ARRAY['active'::text, 'dead'::text, 'stopped'::text, 'brownout'::text, 'unknown'::text])))
);


--
-- Name: COLUMN match_scout_entries.match_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.match_scout_entries.match_label IS 'What the scout typed in the match box, kept verbatim. match_key is the canonical key.';


--
-- Name: COLUMN match_scout_entries.scouted_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.match_scout_entries.scouted_by IS 'Account of the scout who filled in the report (may differ from created_by on a shared phone). Null when only the typed scout_name is known.';


--
-- Name: COLUMN match_scout_entries.robot_present; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.match_scout_entries.robot_present IS 'Did the robot show up to the field? false = no-show (other answers optional); null = not answered.';


--
-- Name: match_scout_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_scout_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_scout_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_scout_entries_id_seq OWNED BY public.match_scout_entries.id;


--
-- Name: pit_problem_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pit_problem_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    team_key text NOT NULL,
    match_key text,
    source text DEFAULT 'Match scout'::text NOT NULL,
    summary text NOT NULL,
    detail text,
    severity text DEFAULT 'watch'::text NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    slack_channel text,
    slack_ts text,
    slack_notified_at timestamp with time zone,
    scout_observations jsonb DEFAULT '[]'::jsonb NOT NULL,
    slack_last_payload text,
    match_label text,
    CONSTRAINT pit_problem_reports_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT pit_problem_reports_match_label_check CHECK (((match_label IS NULL) OR (char_length(match_label) <= 120))),
    CONSTRAINT pit_problem_reports_severity_check CHECK ((severity = ANY (ARRAY['urgent'::text, 'watch'::text]))),
    CONSTRAINT pit_problem_reports_team_key_format CHECK (public.is_frc_team_key(team_key))
);


--
-- Name: COLUMN pit_problem_reports.match_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pit_problem_reports.match_label IS 'What the scout typed in the match box, kept verbatim. match_key is the canonical key when it could be read.';


--
-- Name: pit_scout_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pit_scout_entries (
    id bigint NOT NULL,
    event_key text NOT NULL,
    team_key text NOT NULL,
    drivebase_type text,
    shooter_type text,
    hopper_type text,
    human_player_balls_in_auto text,
    photo_paths text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auto_options jsonb DEFAULT '[]'::jsonb NOT NULL,
    likely_breaking_component text,
    estimated_bps numeric,
    climb_options text[] DEFAULT '{}'::text[] NOT NULL,
    technical_details jsonb DEFAULT '{}'::jsonb NOT NULL,
    scout_name text,
    robot_archetype text,
    additional_notes text,
    auto_points_estimate text,
    custom_answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    custom_form_version integer,
    CONSTRAINT pit_scout_entries_additional_notes_length_check CHECK (((additional_notes IS NULL) OR (length(additional_notes) <= 4000))),
    CONSTRAINT pit_scout_entries_auto_options_array_check CHECK ((jsonb_typeof(auto_options) = 'array'::text)),
    CONSTRAINT pit_scout_entries_climb_options_check CHECK (((COALESCE(array_length(climb_options, 1), 0) <= 5) AND (climb_options <@ ARRAY['No Climb'::text, 'L1 Auto'::text, 'L1'::text, 'L2'::text, 'L3'::text]) AND ((NOT ('No Climb'::text = ANY (climb_options))) OR (COALESCE(array_length(climb_options, 1), 0) = 1)))),
    CONSTRAINT pit_scout_entries_estimated_bps_nonnegative_check CHECK (((estimated_bps IS NULL) OR (estimated_bps >= (0)::numeric))),
    CONSTRAINT pit_scout_entries_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT pit_scout_entries_human_player_balls_check CHECK (((human_player_balls_in_auto IS NULL) OR (human_player_balls_in_auto = ANY (ARRAY['0-10'::text, '10-20'::text, '20+'::text])))),
    CONSTRAINT pit_scout_entries_photo_limit_check CHECK ((COALESCE(array_length(photo_paths, 1), 0) <= 3)),
    CONSTRAINT pit_scout_entries_scout_name_length_check CHECK (((scout_name IS NULL) OR (char_length(scout_name) <= 120))),
    CONSTRAINT pit_scout_entries_team_key_format CHECK (public.is_frc_team_key(team_key)),
    CONSTRAINT pit_scout_entries_technical_details_object_check CHECK ((jsonb_typeof(technical_details) = 'object'::text))
);


--
-- Name: pit_scout_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pit_scout_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pit_scout_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pit_scout_entries_id_seq OWNED BY public.pit_scout_entries.id;


--
-- Name: plan_project_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_project_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pm_alliance_draft_picks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_alliance_draft_picks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_key text NOT NULL,
    predicted_captain text NOT NULL,
    predicted_pick text NOT NULL,
    pick_round integer NOT NULL,
    placed_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    correct boolean
);


--
-- Name: pm_elo_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_elo_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    picked_side text NOT NULL,
    model_probability numeric NOT NULL,
    elo_delta numeric NOT NULL,
    elo_after numeric NOT NULL,
    resolved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pm_elo_history_picked_side_check CHECK ((picked_side = ANY (ARRAY['red'::text, 'blue'::text])))
);


--
-- Name: pm_elo_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_elo_ratings (
    user_id uuid NOT NULL,
    elo numeric DEFAULT 1000 NOT NULL,
    events_participated integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pm_friends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_friends (
    user_id uuid NOT NULL,
    friend_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pm_friends_check CHECK ((user_id <> friend_id)),
    CONSTRAINT pm_friends_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text])))
);


--
-- Name: pm_match_picks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_match_picks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    side text NOT NULL,
    picked_at timestamp with time zone DEFAULT now() NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    CONSTRAINT pm_match_picks_side_check CHECK ((side = ANY (ARRAY['red'::text, 'blue'::text])))
);


--
-- Name: pm_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_key text NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prediction_market_bets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_market_bets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    created_by uuid NOT NULL,
    side text NOT NULL,
    stake numeric NOT NULL,
    placed_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    payout numeric,
    winning_side text,
    CONSTRAINT prediction_market_bets_side_check CHECK ((side = ANY (ARRAY['red'::text, 'blue'::text]))),
    CONSTRAINT prediction_market_bets_stake_positive CHECK ((stake > (0)::numeric)),
    CONSTRAINT prediction_market_bets_winning_side_check CHECK (((winning_side IS NULL) OR (winning_side = ANY (ARRAY['red'::text, 'blue'::text]))))
);


--
-- Name: robot_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_key text,
    subsystem_owner text NOT NULL,
    severity text NOT NULL,
    occurred_on date NOT NULL,
    context_type text NOT NULL,
    context_detail text,
    short_term_fix text,
    short_term_fix_minutes integer,
    suspected_root_cause text,
    is_repeat boolean DEFAULT false NOT NULL,
    long_term_fix text,
    deadline date,
    assigned_subsystem_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    validated_by uuid,
    validated_at timestamp with time zone,
    CONSTRAINT robot_tickets_context_chk CHECK ((context_type = ANY (ARRAY['drive_practice'::text, 'match'::text]))),
    CONSTRAINT robot_tickets_severity_chk CHECK ((severity = ANY (ARRAY['match_ending'::text, 'severe'::text, 'minor'::text]))),
    CONSTRAINT robot_tickets_status_chk CHECK ((status = ANY (ARRAY['open'::text, 'triaged'::text, 'resolved'::text, 'validated'::text])))
);


--
-- Name: roster_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid,
    user_id uuid,
    key_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: roster_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roster_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid,
    key_name text NOT NULL,
    category text DEFAULT 'General'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: rosters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rosters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_public boolean DEFAULT false,
    is_admin_editable boolean DEFAULT false,
    type text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    target_frc_team text DEFAULT 'all'::text,
    CONSTRAINT rosters_target_frc_team_check CHECK (((target_frc_team = ANY (ARRAY['all'::text, 'students'::text])) OR (target_frc_team ~ '^[1-9][0-9]{0,4}$'::text))),
    CONSTRAINT rosters_type_check CHECK ((type = ANY (ARRAY['single'::text, 'multi'::text])))
);


--
-- Name: scout_data_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_data_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_key text NOT NULL,
    match_number integer,
    team_key text NOT NULL,
    phase text,
    event_type text NOT NULL,
    event_value text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role text,
    on_shift boolean,
    CONSTRAINT scout_data_events_team_key_format CHECK (public.is_frc_team_key(team_key))
);


--
-- Name: scout_match_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_match_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scouting_type text NOT NULL,
    match_key text NOT NULL,
    team_key text NOT NULL,
    assigned_user uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scout_match_assignments_match_key_format CHECK (public.is_match_key(match_key)),
    CONSTRAINT scout_match_assignments_team_key_format CHECK (public.is_frc_team_key(team_key))
);


--
-- Name: scout_match_deadlines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_match_deadlines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scout_match_deadlines_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT scout_match_deadlines_match_key_format CHECK ((public.is_match_key(match_key) AND starts_with(match_key, (event_key || '_'::text))))
);


--
-- Name: scout_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_key text NOT NULL,
    match_number integer,
    team_key text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scout_notes_team_key_format CHECK (public.is_frc_team_key(team_key))
);


--
-- Name: scout_pit_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_pit_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    team_key text NOT NULL,
    assigned_user uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scout_pit_assignments_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT scout_pit_assignments_team_key_format CHECK (public.is_frc_team_key(team_key))
);


--
-- Name: scout_prescout_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_prescout_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    team_key text NOT NULL,
    assigned_user uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scout_prescout_assignments_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT scout_prescout_assignments_team_key_format CHECK (public.is_frc_team_key(team_key))
);


--
-- Name: scouting_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_events (
    event_key text NOT NULL,
    name text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    training boolean DEFAULT false NOT NULL,
    tba_event_key text,
    CONSTRAINT scouting_events_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT scouting_events_tba_event_key_check CHECK (((tba_event_key IS NULL) OR (tba_event_key ~ '^[0-9]{4}[a-z0-9]{2,28}$'::text)))
);


--
-- Name: scouting_form_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_form_drafts (
    form_type text NOT NULL,
    schema jsonb NOT NULL,
    base_version integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scouting_form_drafts_form_type_check CHECK ((form_type = ANY (ARRAY['match'::text, 'pit'::text])))
);


--
-- Name: scouting_form_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_form_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_type text NOT NULL,
    version integer NOT NULL,
    schema jsonb NOT NULL,
    note text,
    restored_from integer,
    published_by uuid,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scouting_form_versions_form_type_check CHECK ((form_type = ANY (ARRAY['match'::text, 'pit'::text]))),
    CONSTRAINT scouting_form_versions_version_check CHECK ((version > 0))
);


--
-- Name: scouting_match_rankings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_match_rankings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    ranked_team_keys text[] NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scouting_match_rankings_at_least_two_teams CHECK ((cardinality(ranked_team_keys) >= 2)),
    CONSTRAINT scouting_match_rankings_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT scouting_match_rankings_match_key_format CHECK ((public.is_match_key(match_key) AND starts_with(match_key, (event_key || '_'::text))))
);


--
-- Name: scouting_pairwise_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_pairwise_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    team_a_key text NOT NULL,
    team_b_key text NOT NULL,
    winner_team_key text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scouting_pairwise_votes_distinct_teams CHECK ((team_a_key <> team_b_key)),
    CONSTRAINT scouting_pairwise_votes_winner_in_pair CHECK (((winner_team_key = team_a_key) OR (winner_team_key = team_b_key)))
);


--
-- Name: scouting_picklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_picklist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    team_key text NOT NULL,
    team_number integer,
    nickname text,
    "position" integer NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scouting_picklist_event_key_format CHECK (public.is_event_key(event_key)),
    CONSTRAINT scouting_picklist_team_key_format CHECK (public.is_frc_team_key(team_key))
);


--
-- Name: scouting_practice_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_practice_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    label text NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scouting_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_settings (
    id integer NOT NULL,
    event_key text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    smart_fuel_algorithm_enabled boolean DEFAULT false NOT NULL,
    google_sheet_id text,
    google_sheet_last_synced_at timestamp with time zone,
    google_sheet_last_sync_error text,
    manual_teams text[] DEFAULT '{}'::text[] NOT NULL,
    start_position_photos jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT scouting_settings_single_row CHECK ((id = 1))
);


--
-- Name: scouting_training_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scouting_training_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    match_key text NOT NULL,
    source_event_key text NOT NULL,
    source_event_name text,
    source_match_key text NOT NULL,
    source_label text,
    red_team_keys text[] DEFAULT '{}'::text[] NOT NULL,
    blue_team_keys text[] DEFAULT '{}'::text[] NOT NULL,
    video_key text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scouting_training_matches_match_in_event CHECK ((split_part(match_key, '_'::text, 1) = event_key)),
    CONSTRAINT scouting_training_matches_match_key_format CHECK (public.is_match_key(match_key))
);


--
-- Name: user_notification_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notification_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    entity_key text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    email character varying(255),
    full_name character varying(255),
    role character varying(100) DEFAULT 'member'::character varying,
    permissions text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    banned boolean DEFAULT false,
    general_role text DEFAULT 'none'::text,
    team_role text DEFAULT 'other'::text,
    notification_settings jsonb DEFAULT '{}'::jsonb,
    slack_user_id text,
    slack_dm_channel text,
    frc_team text,
    is_dev boolean DEFAULT false NOT NULL,
    theme_preference text,
    CONSTRAINT user_profiles_frc_team_check CHECK (((frc_team IS NULL) OR (frc_team = 'Mentor'::text) OR (frc_team ~ '^[1-9][0-9]{0,4}$'::text)))
);


--
-- Name: match_scout_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scout_entries ALTER COLUMN id SET DEFAULT nextval('public.match_scout_entries_id_seq'::regclass);


--
-- Name: pit_scout_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pit_scout_entries ALTER COLUMN id SET DEFAULT nextval('public.pit_scout_entries_id_seq'::regclass);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: competition_team_members competition_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_team_members
    ADD CONSTRAINT competition_team_members_pkey PRIMARY KEY (user_id);


--
-- Name: match_scout_entries match_scout_entries_match_key_canonical; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.match_scout_entries
    ADD CONSTRAINT match_scout_entries_match_key_canonical CHECK (((match_key ~ '^[0-9a-z]+_(qm|ef|qf|sf|f|pm)[0-9]+(m[0-9]+)?$'::text) AND starts_with(match_key, (event_key || '_'::text)))) NOT VALID;


--
-- Name: match_scout_entries match_scout_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scout_entries
    ADD CONSTRAINT match_scout_entries_pkey PRIMARY KEY (id);


--
-- Name: match_scout_entries match_scout_entries_unique_scout; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scout_entries
    ADD CONSTRAINT match_scout_entries_unique_scout UNIQUE (event_key, match_key, team_key, created_by, report_kind);


--
-- Name: pit_problem_reports pit_problem_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pit_problem_reports
    ADD CONSTRAINT pit_problem_reports_pkey PRIMARY KEY (id);


--
-- Name: pit_scout_entries pit_scout_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pit_scout_entries
    ADD CONSTRAINT pit_scout_entries_pkey PRIMARY KEY (id);


--
-- Name: pit_scout_entries pit_scout_entries_unique_event_team; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pit_scout_entries
    ADD CONSTRAINT pit_scout_entries_unique_event_team UNIQUE (event_key, team_key);


--
-- Name: pm_alliance_draft_picks pm_alliance_draft_picks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_alliance_draft_picks
    ADD CONSTRAINT pm_alliance_draft_picks_pkey PRIMARY KEY (id);


--
-- Name: pm_elo_history pm_elo_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_elo_history
    ADD CONSTRAINT pm_elo_history_pkey PRIMARY KEY (id);


--
-- Name: pm_elo_history pm_elo_history_user_id_event_key_match_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_elo_history
    ADD CONSTRAINT pm_elo_history_user_id_event_key_match_key_key UNIQUE (user_id, event_key, match_key);


--
-- Name: pm_elo_ratings pm_elo_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_elo_ratings
    ADD CONSTRAINT pm_elo_ratings_pkey PRIMARY KEY (user_id);


--
-- Name: pm_friends pm_friends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_friends
    ADD CONSTRAINT pm_friends_pkey PRIMARY KEY (user_id, friend_id);


--
-- Name: pm_match_picks pm_match_picks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_match_picks
    ADD CONSTRAINT pm_match_picks_pkey PRIMARY KEY (id);


--
-- Name: pm_match_picks pm_match_picks_user_id_event_key_match_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_match_picks
    ADD CONSTRAINT pm_match_picks_user_id_event_key_match_key_key UNIQUE (user_id, event_key, match_key);


--
-- Name: pm_reactions pm_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_reactions
    ADD CONSTRAINT pm_reactions_pkey PRIMARY KEY (id);


--
-- Name: prediction_market_bets prediction_market_bets_event_key_match_key_created_by_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_market_bets
    ADD CONSTRAINT prediction_market_bets_event_key_match_key_created_by_key UNIQUE (event_key, match_key, created_by);


--
-- Name: prediction_market_bets prediction_market_bets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_market_bets
    ADD CONSTRAINT prediction_market_bets_pkey PRIMARY KEY (id);


--
-- Name: robot_tickets robot_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_tickets
    ADD CONSTRAINT robot_tickets_pkey PRIMARY KEY (id);


--
-- Name: roster_entries roster_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_pkey PRIMARY KEY (id);


--
-- Name: roster_entries roster_entries_roster_id_user_id_key_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_roster_id_user_id_key_id_key UNIQUE (roster_id, user_id, key_id);


--
-- Name: roster_keys roster_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_keys
    ADD CONSTRAINT roster_keys_pkey PRIMARY KEY (id);


--
-- Name: rosters rosters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_pkey PRIMARY KEY (id);


--
-- Name: scout_data_events scout_data_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_data_events
    ADD CONSTRAINT scout_data_events_pkey PRIMARY KEY (id);


--
-- Name: scout_match_assignments scout_match_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_match_assignments
    ADD CONSTRAINT scout_match_assignments_pkey PRIMARY KEY (id);


--
-- Name: scout_match_deadlines scout_match_deadlines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_match_deadlines
    ADD CONSTRAINT scout_match_deadlines_pkey PRIMARY KEY (id);


--
-- Name: scout_match_deadlines scout_match_deadlines_unique_match; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_match_deadlines
    ADD CONSTRAINT scout_match_deadlines_unique_match UNIQUE (event_key, match_key);


--
-- Name: scout_notes scout_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_notes
    ADD CONSTRAINT scout_notes_pkey PRIMARY KEY (id);


--
-- Name: scout_pit_assignments scout_pit_assignments_event_key_team_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_pit_assignments
    ADD CONSTRAINT scout_pit_assignments_event_key_team_key_key UNIQUE (event_key, team_key);


--
-- Name: scout_pit_assignments scout_pit_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_pit_assignments
    ADD CONSTRAINT scout_pit_assignments_pkey PRIMARY KEY (id);


--
-- Name: scout_prescout_assignments scout_prescout_assignments_event_key_team_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_prescout_assignments
    ADD CONSTRAINT scout_prescout_assignments_event_key_team_key_key UNIQUE (event_key, team_key);


--
-- Name: scout_prescout_assignments scout_prescout_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_prescout_assignments
    ADD CONSTRAINT scout_prescout_assignments_pkey PRIMARY KEY (id);


--
-- Name: scouting_events scouting_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_events
    ADD CONSTRAINT scouting_events_pkey PRIMARY KEY (event_key);


--
-- Name: scouting_form_drafts scouting_form_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_form_drafts
    ADD CONSTRAINT scouting_form_drafts_pkey PRIMARY KEY (form_type);


--
-- Name: scouting_form_versions scouting_form_versions_form_type_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_form_versions
    ADD CONSTRAINT scouting_form_versions_form_type_version_key UNIQUE (form_type, version);


--
-- Name: scouting_form_versions scouting_form_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_form_versions
    ADD CONSTRAINT scouting_form_versions_pkey PRIMARY KEY (id);


--
-- Name: scouting_match_rankings scouting_match_rankings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_match_rankings
    ADD CONSTRAINT scouting_match_rankings_pkey PRIMARY KEY (id);


--
-- Name: scouting_match_rankings scouting_match_rankings_unique_match; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_match_rankings
    ADD CONSTRAINT scouting_match_rankings_unique_match UNIQUE (event_key, match_key);


--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_event_key_team_a_key_team_b_key_cre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_pairwise_votes
    ADD CONSTRAINT scouting_pairwise_votes_event_key_team_a_key_team_b_key_cre_key UNIQUE (event_key, team_a_key, team_b_key, created_by);


--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_pairwise_votes
    ADD CONSTRAINT scouting_pairwise_votes_pkey PRIMARY KEY (id);


--
-- Name: scouting_picklist scouting_picklist_event_key_team_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_picklist
    ADD CONSTRAINT scouting_picklist_event_key_team_key_key UNIQUE (event_key, team_key);


--
-- Name: scouting_picklist scouting_picklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_picklist
    ADD CONSTRAINT scouting_picklist_pkey PRIMARY KEY (id);


--
-- Name: scouting_practice_matches scouting_practice_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_practice_matches
    ADD CONSTRAINT scouting_practice_matches_pkey PRIMARY KEY (id);


--
-- Name: scouting_practice_matches scouting_practice_matches_unique_match; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_practice_matches
    ADD CONSTRAINT scouting_practice_matches_unique_match UNIQUE (event_key, match_key);


--
-- Name: scouting_settings scouting_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_settings
    ADD CONSTRAINT scouting_settings_pkey PRIMARY KEY (id);


--
-- Name: scouting_training_matches scouting_training_matches_match_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_training_matches
    ADD CONSTRAINT scouting_training_matches_match_key_key UNIQUE (match_key);


--
-- Name: scouting_training_matches scouting_training_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_training_matches
    ADD CONSTRAINT scouting_training_matches_pkey PRIMARY KEY (id);


--
-- Name: user_notification_logs user_notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_logs
    ADD CONSTRAINT user_notification_logs_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: activity_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_created_at_idx ON public.activity_log USING btree (created_at DESC);


--
-- Name: match_scout_entries_event_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_scout_entries_event_match_idx ON public.match_scout_entries USING btree (event_key, match_key);


--
-- Name: match_scout_entries_scouted_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_scout_entries_scouted_by_idx ON public.match_scout_entries USING btree (scouted_by);


--
-- Name: match_scout_entries_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_scout_entries_team_idx ON public.match_scout_entries USING btree (event_key, team_key);


--
-- Name: pit_problem_reports_one_open_match_issue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pit_problem_reports_one_open_match_issue_idx ON public.pit_problem_reports USING btree (event_key, team_key, match_key, source) WHERE ((resolved = false) AND (source = 'Match scout'::text));


--
-- Name: pit_problem_reports_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pit_problem_reports_open_idx ON public.pit_problem_reports USING btree (event_key, resolved, created_at DESC);


--
-- Name: pit_problem_reports_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pit_problem_reports_team_idx ON public.pit_problem_reports USING btree (event_key, team_key);


--
-- Name: pit_problem_reports_unsent_slack_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pit_problem_reports_unsent_slack_idx ON public.pit_problem_reports USING btree (created_at) WHERE (slack_notified_at IS NULL);


--
-- Name: pit_scout_entries_event_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pit_scout_entries_event_team_idx ON public.pit_scout_entries USING btree (event_key, team_key);


--
-- Name: pit_scout_entries_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pit_scout_entries_team_idx ON public.pit_scout_entries USING btree (team_key);


--
-- Name: pm_alliance_draft_picks_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_alliance_draft_picks_event_idx ON public.pm_alliance_draft_picks USING btree (event_key, placed_at);


--
-- Name: pm_elo_history_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_elo_history_event_idx ON public.pm_elo_history USING btree (event_key, resolved_at);


--
-- Name: pm_match_picks_event_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_match_picks_event_match_idx ON public.pm_match_picks USING btree (event_key, match_key);


--
-- Name: pm_reactions_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_reactions_event_idx ON public.pm_reactions USING btree (event_key, created_at DESC);


--
-- Name: prediction_market_bets_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_market_bets_event_idx ON public.prediction_market_bets USING btree (event_key);


--
-- Name: prediction_market_bets_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_market_bets_match_idx ON public.prediction_market_bets USING btree (event_key, match_key);


--
-- Name: robot_tickets_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robot_tickets_status_idx ON public.robot_tickets USING btree (status, created_at DESC);


--
-- Name: robot_tickets_subsystem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX robot_tickets_subsystem_idx ON public.robot_tickets USING btree (assigned_subsystem_id) WHERE (assigned_subsystem_id IS NOT NULL);


--
-- Name: scout_data_events_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_data_events_match_idx ON public.scout_data_events USING btree (match_key);


--
-- Name: scout_data_events_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_data_events_team_idx ON public.scout_data_events USING btree (team_key);


--
-- Name: scout_match_assignments_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scout_match_assignments_unique ON public.scout_match_assignments USING btree (scouting_type, match_key, team_key, assigned_user);


--
-- Name: scout_match_assignments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_match_assignments_user_idx ON public.scout_match_assignments USING btree (assigned_user);


--
-- Name: scout_match_deadlines_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_match_deadlines_event_idx ON public.scout_match_deadlines USING btree (event_key, due_at);


--
-- Name: scout_notes_match_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_notes_match_key_idx ON public.scout_notes USING btree (match_key);


--
-- Name: scout_notes_team_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_notes_team_key_idx ON public.scout_notes USING btree (team_key);


--
-- Name: scouting_match_rankings_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scouting_match_rankings_event_idx ON public.scouting_match_rankings USING btree (event_key, updated_at DESC);


--
-- Name: scouting_pairwise_votes_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scouting_pairwise_votes_event_idx ON public.scouting_pairwise_votes USING btree (event_key, updated_at DESC);


--
-- Name: scouting_picklist_event_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scouting_picklist_event_key_idx ON public.scouting_picklist USING btree (event_key, "position");


--
-- Name: scouting_practice_matches_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scouting_practice_matches_event_idx ON public.scouting_practice_matches USING btree (event_key, created_at);


--
-- Name: scouting_training_matches_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scouting_training_matches_event_idx ON public.scouting_training_matches USING btree (event_key, created_at);


--
-- Name: user_notification_logs_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_notification_logs_key ON public.user_notification_logs USING btree (user_id, event_type, entity_key);


--
-- Name: match_scout_entries match_scout_entry_completes_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER match_scout_entry_completes_assignment AFTER INSERT OR UPDATE OF event_key, match_key, team_key, created_by ON public.match_scout_entries FOR EACH ROW EXECUTE FUNCTION public.complete_match_scout_assignment_from_report();


--
-- Name: robot_tickets robot_tickets_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER robot_tickets_set_updated_at BEFORE UPDATE ON public.robot_tickets FOR EACH ROW EXECUTE FUNCTION public.robot_tickets_touch_updated_at();


--
-- Name: pit_scout_entries trg_touch_pit_scout_entries; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_pit_scout_entries BEFORE UPDATE ON public.pit_scout_entries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: scout_match_assignments trg_touch_scout_assign; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_scout_assign BEFORE UPDATE ON public.scout_match_assignments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: user_profiles user_profiles_a_security_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_profiles_a_security_guard BEFORE INSERT OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.user_profiles_security_guard();


--
-- Name: match_scout_entries zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.match_scout_entries FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: pit_problem_reports zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.pit_problem_reports FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: pit_scout_entries zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.pit_scout_entries FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: roster_entries zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.roster_entries FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: roster_keys zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.roster_keys FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: rosters zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.rosters FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scout_match_assignments zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scout_match_assignments FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scout_match_deadlines zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scout_match_deadlines FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scout_notes zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scout_notes FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scout_pit_assignments zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scout_pit_assignments FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scouting_events zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scouting_events FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scouting_form_versions zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scouting_form_versions FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scouting_match_rankings zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scouting_match_rankings FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scouting_picklist zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scouting_picklist FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: scouting_settings zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.scouting_settings FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: user_profiles zz_activity_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_activity_log AFTER INSERT OR DELETE OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.log_activity();


--
-- Name: app_settings app_settings_setup_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_setup_by_fkey FOREIGN KEY (setup_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: competition_team_members competition_team_members_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_team_members
    ADD CONSTRAINT competition_team_members_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;


--
-- Name: competition_team_members competition_team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_team_members
    ADD CONSTRAINT competition_team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: match_scout_entries match_scout_entries_scouted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scout_entries
    ADD CONSTRAINT match_scout_entries_scouted_by_fkey FOREIGN KEY (scouted_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;


--
-- Name: pm_alliance_draft_picks pm_alliance_draft_picks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_alliance_draft_picks
    ADD CONSTRAINT pm_alliance_draft_picks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pm_elo_history pm_elo_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_elo_history
    ADD CONSTRAINT pm_elo_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pm_elo_ratings pm_elo_ratings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_elo_ratings
    ADD CONSTRAINT pm_elo_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pm_friends pm_friends_friend_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_friends
    ADD CONSTRAINT pm_friends_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES auth.users(id);


--
-- Name: pm_friends pm_friends_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_friends
    ADD CONSTRAINT pm_friends_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pm_match_picks pm_match_picks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_match_picks
    ADD CONSTRAINT pm_match_picks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pm_reactions pm_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_reactions
    ADD CONSTRAINT pm_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: prediction_market_bets prediction_market_bets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_market_bets
    ADD CONSTRAINT prediction_market_bets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: roster_entries roster_entries_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_key_id_fkey FOREIGN KEY (key_id) REFERENCES public.roster_keys(id) ON DELETE CASCADE;


--
-- Name: roster_entries roster_entries_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.rosters(id) ON DELETE CASCADE;


--
-- Name: roster_entries roster_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_entries
    ADD CONSTRAINT roster_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: roster_keys roster_keys_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roster_keys
    ADD CONSTRAINT roster_keys_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.rosters(id) ON DELETE CASCADE;


--
-- Name: rosters rosters_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rosters
    ADD CONSTRAINT rosters_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profiles(id);


--
-- Name: scout_data_events scout_data_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_data_events
    ADD CONSTRAINT scout_data_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scout_match_assignments scout_match_assignments_assigned_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_match_assignments
    ADD CONSTRAINT scout_match_assignments_assigned_user_fkey FOREIGN KEY (assigned_user) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scout_notes scout_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_notes
    ADD CONSTRAINT scout_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scout_pit_assignments scout_pit_assignments_assigned_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_pit_assignments
    ADD CONSTRAINT scout_pit_assignments_assigned_user_fkey FOREIGN KEY (assigned_user) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scout_prescout_assignments scout_prescout_assignments_assigned_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_prescout_assignments
    ADD CONSTRAINT scout_prescout_assignments_assigned_user_fkey FOREIGN KEY (assigned_user) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scouting_match_rankings scouting_match_rankings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_match_rankings
    ADD CONSTRAINT scouting_match_rankings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scouting_match_rankings scouting_match_rankings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_match_rankings
    ADD CONSTRAINT scouting_match_rankings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_pairwise_votes
    ADD CONSTRAINT scouting_pairwise_votes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: scouting_picklist scouting_picklist_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_picklist
    ADD CONSTRAINT scouting_picklist_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scouting_practice_matches scouting_practice_matches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_practice_matches
    ADD CONSTRAINT scouting_practice_matches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: scouting_training_matches scouting_training_matches_event_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scouting_training_matches
    ADD CONSTRAINT scouting_training_matches_event_key_fkey FOREIGN KEY (event_key) REFERENCES public.scouting_events(event_key) ON DELETE CASCADE;


--
-- Name: user_notification_logs user_notification_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_logs
    ADD CONSTRAINT user_notification_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: roster_entries Roster entries are viewable by approved users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Roster entries are viewable by approved users" ON public.roster_entries FOR SELECT TO authenticated USING ((public.approved_user() OR (user_id = auth.uid())));


--
-- Name: roster_keys Roster keys are viewable by approved users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Roster keys are viewable by approved users" ON public.roster_keys FOR SELECT TO authenticated USING ((public.approved_user() OR (EXISTS ( SELECT 1
   FROM public.roster_entries re
  WHERE ((re.key_id = roster_keys.id) AND (re.user_id = auth.uid()))))));


--
-- Name: rosters Rosters are viewable by approved users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Rosters are viewable by approved users" ON public.rosters FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_log activity_log_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_log_admin_read ON public.activity_log FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND ((up.role)::text = 'admin'::text) AND (COALESCE(up.banned, false) = false)))));


--
-- Name: activity_log activity_log_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_log_service_all ON public.activity_log TO service_role USING (true) WITH CHECK (true);


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_read_all ON public.app_settings FOR SELECT TO anon, authenticated USING (true);


--
-- Name: app_settings app_settings_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_service_all ON public.app_settings TO service_role USING (true) WITH CHECK (true);


--
-- Name: competition_team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_team_members competition_team_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competition_team_members_select ON public.competition_team_members FOR SELECT TO authenticated USING ((public.approved_user() OR (user_id = auth.uid())));


--
-- Name: match_scout_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_scout_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: match_scout_entries match_scout_entries_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY match_scout_entries_delete_authenticated ON public.match_scout_entries FOR DELETE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (auth.uid() = created_by))));


--
-- Name: match_scout_entries match_scout_entries_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY match_scout_entries_insert_authenticated ON public.match_scout_entries FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (created_by = auth.uid())));


--
-- Name: match_scout_entries match_scout_entries_modify_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY match_scout_entries_modify_authenticated ON public.match_scout_entries FOR UPDATE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (auth.uid() = created_by)))) WITH CHECK ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (auth.uid() = created_by))));


--
-- Name: match_scout_entries match_scout_entries_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY match_scout_entries_select_authenticated ON public.match_scout_entries FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: match_scout_entries match_scout_entries_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY match_scout_entries_service_all ON public.match_scout_entries TO service_role USING (true) WITH CHECK (true);


--
-- Name: pit_problem_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pit_problem_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: pit_problem_reports pit_problem_reports_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_problem_reports_delete_authenticated ON public.pit_problem_reports FOR DELETE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (auth.uid() = created_by))));


--
-- Name: pit_problem_reports pit_problem_reports_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_problem_reports_insert_authenticated ON public.pit_problem_reports FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (created_by = auth.uid())));


--
-- Name: pit_problem_reports pit_problem_reports_modify_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_problem_reports_modify_authenticated ON public.pit_problem_reports FOR UPDATE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (auth.uid() = created_by)))) WITH CHECK ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (auth.uid() = created_by))));


--
-- Name: pit_problem_reports pit_problem_reports_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_problem_reports_select_authenticated ON public.pit_problem_reports FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: pit_problem_reports pit_problem_reports_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_problem_reports_service_all ON public.pit_problem_reports TO service_role USING (true) WITH CHECK (true);


--
-- Name: pit_scout_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pit_scout_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: pit_scout_entries pit_scout_entries_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_scout_entries_delete_authenticated ON public.pit_scout_entries FOR DELETE TO authenticated USING ((public.approved_user() AND public.has_permission('DATA_SCOUT_ADMIN'::text)));


--
-- Name: pit_scout_entries pit_scout_entries_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_scout_entries_insert_authenticated ON public.pit_scout_entries FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND ((created_by IS NULL) OR (created_by = auth.uid()))));


--
-- Name: pit_scout_entries pit_scout_entries_modify_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_scout_entries_modify_authenticated ON public.pit_scout_entries FOR UPDATE TO authenticated USING (public.approved_user()) WITH CHECK ((public.approved_user() AND ((created_by IS NULL) OR (created_by = auth.uid()) OR public.has_permission('DATA_SCOUT_ADMIN'::text))));


--
-- Name: pit_scout_entries pit_scout_entries_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_scout_entries_select_authenticated ON public.pit_scout_entries FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: pit_scout_entries pit_scout_entries_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pit_scout_entries_service_all ON public.pit_scout_entries TO service_role USING (true) WITH CHECK (true);


--
-- Name: pm_alliance_draft_picks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pm_alliance_draft_picks ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_alliance_draft_picks pm_alliance_draft_picks_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_alliance_draft_picks_delete_authenticated ON public.pm_alliance_draft_picks FOR DELETE TO authenticated USING ((public.approved_user() AND (auth.uid() = user_id) AND (resolved_at IS NULL)));


--
-- Name: pm_alliance_draft_picks pm_alliance_draft_picks_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_alliance_draft_picks_insert_authenticated ON public.pm_alliance_draft_picks FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (auth.uid() = user_id) AND (resolved_at IS NULL) AND (correct IS NULL)));


--
-- Name: pm_alliance_draft_picks pm_alliance_draft_picks_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_alliance_draft_picks_select_authenticated ON public.pm_alliance_draft_picks FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: pm_alliance_draft_picks pm_alliance_draft_picks_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_alliance_draft_picks_service_all ON public.pm_alliance_draft_picks TO service_role USING (true) WITH CHECK (true);


--
-- Name: pm_alliance_draft_picks pm_alliance_draft_picks_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_alliance_draft_picks_update_authenticated ON public.pm_alliance_draft_picks FOR UPDATE TO authenticated USING ((public.approved_user() AND (auth.uid() = user_id) AND (resolved_at IS NULL))) WITH CHECK ((public.approved_user() AND (auth.uid() = user_id) AND (resolved_at IS NULL) AND (correct IS NULL)));


--
-- Name: pm_elo_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pm_elo_history ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_elo_history pm_elo_history_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_elo_history_select_authenticated ON public.pm_elo_history FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: pm_elo_history pm_elo_history_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_elo_history_service_all ON public.pm_elo_history TO service_role USING (true) WITH CHECK (true);


--
-- Name: pm_elo_ratings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pm_elo_ratings ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_elo_ratings pm_elo_ratings_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_elo_ratings_select_authenticated ON public.pm_elo_ratings FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: pm_elo_ratings pm_elo_ratings_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_elo_ratings_service_all ON public.pm_elo_ratings TO service_role USING (true) WITH CHECK (true);


--
-- Name: pm_friends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pm_friends ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_friends pm_friends_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_friends_delete_authenticated ON public.pm_friends FOR DELETE TO authenticated USING ((public.approved_user() AND ((auth.uid() = user_id) OR (auth.uid() = friend_id))));


--
-- Name: pm_friends pm_friends_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_friends_insert_authenticated ON public.pm_friends FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (auth.uid() = user_id) AND (status = 'pending'::text)));


--
-- Name: pm_friends pm_friends_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_friends_select_authenticated ON public.pm_friends FOR SELECT TO authenticated USING ((public.approved_user() AND ((auth.uid() = user_id) OR (auth.uid() = friend_id))));


--
-- Name: pm_friends pm_friends_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_friends_service_all ON public.pm_friends TO service_role USING (true) WITH CHECK (true);


--
-- Name: pm_friends pm_friends_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_friends_update_authenticated ON public.pm_friends FOR UPDATE TO authenticated USING ((public.approved_user() AND ((auth.uid() = user_id) OR (auth.uid() = friend_id)))) WITH CHECK ((public.approved_user() AND (((auth.uid() = user_id) AND (status = 'pending'::text)) OR ((auth.uid() = friend_id) AND (status = 'accepted'::text)))));


--
-- Name: pm_match_picks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pm_match_picks ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_match_picks pm_match_picks_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_match_picks_delete_authenticated ON public.pm_match_picks FOR DELETE TO authenticated USING ((public.approved_user() AND (auth.uid() = user_id) AND (locked = false)));


--
-- Name: pm_match_picks pm_match_picks_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_match_picks_insert_authenticated ON public.pm_match_picks FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (auth.uid() = user_id) AND (locked = false)));


--
-- Name: pm_match_picks pm_match_picks_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_match_picks_select_authenticated ON public.pm_match_picks FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: pm_match_picks pm_match_picks_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_match_picks_service_all ON public.pm_match_picks TO service_role USING (true) WITH CHECK (true);


--
-- Name: pm_match_picks pm_match_picks_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_match_picks_update_authenticated ON public.pm_match_picks FOR UPDATE TO authenticated USING ((public.approved_user() AND (auth.uid() = user_id) AND (locked = false))) WITH CHECK ((public.approved_user() AND (auth.uid() = user_id) AND (locked = false)));


--
-- Name: pm_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pm_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_reactions pm_reactions_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_reactions_delete_authenticated ON public.pm_reactions FOR DELETE TO authenticated USING ((public.approved_user() AND (auth.uid() = user_id)));


--
-- Name: pm_reactions pm_reactions_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_reactions_insert_authenticated ON public.pm_reactions FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (auth.uid() = user_id)));


--
-- Name: pm_reactions pm_reactions_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_reactions_select_authenticated ON public.pm_reactions FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: pm_reactions pm_reactions_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pm_reactions_service_all ON public.pm_reactions TO service_role USING (true) WITH CHECK (true);


--
-- Name: prediction_market_bets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_market_bets ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_market_bets prediction_market_bets_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_market_bets_delete_authenticated ON public.prediction_market_bets FOR DELETE TO authenticated USING ((public.approved_user() AND (auth.uid() = created_by) AND (resolved_at IS NULL)));


--
-- Name: prediction_market_bets prediction_market_bets_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_market_bets_insert_authenticated ON public.prediction_market_bets FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (auth.uid() = created_by) AND (resolved_at IS NULL) AND (payout IS NULL) AND (winning_side IS NULL)));


--
-- Name: prediction_market_bets prediction_market_bets_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_market_bets_select_authenticated ON public.prediction_market_bets FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: prediction_market_bets prediction_market_bets_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_market_bets_service_all ON public.prediction_market_bets TO service_role USING (true) WITH CHECK (true);


--
-- Name: prediction_market_bets prediction_market_bets_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_market_bets_update_authenticated ON public.prediction_market_bets FOR UPDATE TO authenticated USING ((public.approved_user() AND (auth.uid() = created_by) AND (resolved_at IS NULL))) WITH CHECK ((public.approved_user() AND (auth.uid() = created_by) AND (resolved_at IS NULL) AND (payout IS NULL) AND (winning_side IS NULL)));


--
-- Name: robot_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.robot_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: robot_tickets robot_tickets_insert_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY robot_tickets_insert_approved ON public.robot_tickets FOR INSERT TO authenticated WITH CHECK (public.approved_user());


--
-- Name: robot_tickets robot_tickets_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY robot_tickets_select_approved ON public.robot_tickets FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: robot_tickets robot_tickets_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY robot_tickets_service_all ON public.robot_tickets TO service_role USING (true) WITH CHECK (true);


--
-- Name: robot_tickets robot_tickets_update_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY robot_tickets_update_approved ON public.robot_tickets FOR UPDATE TO authenticated USING (public.approved_user()) WITH CHECK (public.approved_user());


--
-- Name: roster_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_entries roster_entries_delete_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_entries_delete_leadership ON public.roster_entries FOR DELETE TO authenticated USING ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT (EXISTS ( SELECT 1
   FROM public.roster_keys rk
  WHERE ((rk.id = roster_entries.key_id) AND public.is_privileged_roster_key(rk.key_name))))) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text]))));


--
-- Name: roster_entries roster_entries_insert_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_entries_insert_leadership ON public.roster_entries FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT (EXISTS ( SELECT 1
   FROM public.roster_keys rk
  WHERE ((rk.id = roster_entries.key_id) AND public.is_privileged_roster_key(rk.key_name))))) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text]))));


--
-- Name: roster_entries roster_entries_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_entries_service_all ON public.roster_entries TO service_role USING (true) WITH CHECK (true);


--
-- Name: roster_entries roster_entries_update_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_entries_update_leadership ON public.roster_entries FOR UPDATE TO authenticated USING ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT (EXISTS ( SELECT 1
   FROM public.roster_keys rk
  WHERE ((rk.id = roster_entries.key_id) AND public.is_privileged_roster_key(rk.key_name))))) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text])))) WITH CHECK ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT (EXISTS ( SELECT 1
   FROM public.roster_keys rk
  WHERE ((rk.id = roster_entries.key_id) AND public.is_privileged_roster_key(rk.key_name))))) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text]))));


--
-- Name: roster_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roster_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: roster_keys roster_keys_delete_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_keys_delete_leadership ON public.roster_keys FOR DELETE TO authenticated USING ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT public.is_privileged_roster_key(key_name)) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text]))));


--
-- Name: roster_keys roster_keys_insert_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_keys_insert_leadership ON public.roster_keys FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT public.is_privileged_roster_key(key_name)) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text]))));


--
-- Name: roster_keys roster_keys_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_keys_service_all ON public.roster_keys TO service_role USING (true) WITH CHECK (true);


--
-- Name: roster_keys roster_keys_update_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roster_keys_update_leadership ON public.roster_keys FOR UPDATE TO authenticated USING ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT public.is_privileged_roster_key(key_name)) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text])))) WITH CHECK ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))) AND ((NOT public.is_privileged_roster_key(key_name)) OR public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'PROMOTE_USERS'::text]))));


--
-- Name: rosters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;

--
-- Name: rosters rosters_delete_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rosters_delete_leadership ON public.rosters FOR DELETE TO authenticated USING ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text)))))));


--
-- Name: rosters rosters_insert_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rosters_insert_leadership ON public.rosters FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text)))))));


--
-- Name: rosters rosters_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rosters_service_all ON public.rosters TO service_role USING (true) WITH CHECK (true);


--
-- Name: rosters rosters_update_leadership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rosters_update_leadership ON public.rosters FOR UPDATE TO authenticated USING ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text))))))) WITH CHECK ((public.approved_user() AND (EXISTS ( SELECT 1
   FROM public.user_profiles up
  WHERE ((up.id = auth.uid()) AND (COALESCE(up.banned, false) = false) AND (((up.role)::text = 'admin'::text) OR (up.general_role = ANY (ARRAY['lead'::text, 'subsystem_lead'::text])) OR (up.team_role ~~* '%Lead'::text)))))));


--
-- Name: scout_match_assignments scout_assignments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_assignments_delete ON public.scout_match_assignments FOR DELETE TO authenticated USING ((public.approved_user() AND (((scouting_type = ANY (ARRAY['data'::text, 'quick'::text, 'performance'::text, 'robot'::text])) AND public.has_permission('DATA_SCOUT_ADMIN'::text)) OR ((scouting_type = 'note'::text) AND public.has_permission('NOTE_SCOUT_ADMIN'::text)))));


--
-- Name: scout_match_assignments scout_assignments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_assignments_insert ON public.scout_match_assignments FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (((scouting_type = ANY (ARRAY['data'::text, 'quick'::text, 'performance'::text, 'robot'::text])) AND public.has_permission('DATA_SCOUT_ADMIN'::text)) OR ((scouting_type = 'note'::text) AND public.has_permission('NOTE_SCOUT_ADMIN'::text)))));


--
-- Name: scout_match_assignments scout_assignments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_assignments_select ON public.scout_match_assignments FOR SELECT TO authenticated USING ((public.approved_user() AND ((assigned_user = auth.uid()) OR ((scouting_type = ANY (ARRAY['data'::text, 'quick'::text, 'performance'::text, 'robot'::text])) AND public.has_permission('DATA_SCOUT_ADMIN'::text)) OR ((scouting_type = 'note'::text) AND public.has_permission('NOTE_SCOUT_ADMIN'::text)))));


--
-- Name: scout_match_assignments scout_assignments_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_assignments_service_all ON public.scout_match_assignments TO service_role USING (true) WITH CHECK (true);


--
-- Name: scout_match_assignments scout_assignments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_assignments_update ON public.scout_match_assignments FOR UPDATE TO authenticated USING ((public.approved_user() AND (((scouting_type = ANY (ARRAY['data'::text, 'quick'::text, 'performance'::text, 'robot'::text])) AND public.has_permission('DATA_SCOUT_ADMIN'::text)) OR ((scouting_type = 'note'::text) AND public.has_permission('NOTE_SCOUT_ADMIN'::text))))) WITH CHECK ((public.approved_user() AND (((scouting_type = ANY (ARRAY['data'::text, 'quick'::text, 'performance'::text, 'robot'::text])) AND public.has_permission('DATA_SCOUT_ADMIN'::text)) OR ((scouting_type = 'note'::text) AND public.has_permission('NOTE_SCOUT_ADMIN'::text)))));


--
-- Name: scout_data_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scout_data_events ENABLE ROW LEVEL SECURITY;

--
-- Name: scout_data_events scout_data_events_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_data_events_delete_admin ON public.scout_data_events FOR DELETE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR ((auth.uid() = created_by) AND (COALESCE(lower(TRIM(BOTH FROM role)), ''::text) <> 'vision'::text) AND (COALESCE(lower(TRIM(BOTH FROM event_type)), ''::text) <> 'hub_fuel_override'::text)))));


--
-- Name: scout_data_events scout_data_events_insert_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_data_events_insert_members ON public.scout_data_events FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND public.has_any_permission(ARRAY['DATA_SCOUT_ADMIN'::text, 'DATA_SCOUT_MEMBER'::text]) AND (created_by = auth.uid()) AND (((COALESCE(lower(TRIM(BOTH FROM role)), ''::text) <> 'vision'::text) AND (COALESCE(lower(TRIM(BOTH FROM event_type)), ''::text) <> 'hub_fuel_override'::text)) OR public.has_permission('VISION_RELEASE'::text))));


--
-- Name: scout_data_events scout_data_events_select_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_data_events_select_members ON public.scout_data_events FOR SELECT TO authenticated USING ((public.approved_user() AND public.has_any_permission(ARRAY['DATA_SCOUT_ADMIN'::text, 'DATA_SCOUT_MEMBER'::text])));


--
-- Name: scout_data_events scout_data_events_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_data_events_service_all ON public.scout_data_events TO service_role USING (true) WITH CHECK (true);


--
-- Name: scout_data_events scout_data_events_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_data_events_update_admin ON public.scout_data_events FOR UPDATE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR ((auth.uid() = created_by) AND (COALESCE(lower(TRIM(BOTH FROM role)), ''::text) <> 'vision'::text) AND (COALESCE(lower(TRIM(BOTH FROM event_type)), ''::text) <> 'hub_fuel_override'::text))))) WITH CHECK ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR ((auth.uid() = created_by) AND (COALESCE(lower(TRIM(BOTH FROM role)), ''::text) <> 'vision'::text) AND (COALESCE(lower(TRIM(BOTH FROM event_type)), ''::text) <> 'hub_fuel_override'::text)))));


--
-- Name: scout_match_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scout_match_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: scout_match_deadlines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scout_match_deadlines ENABLE ROW LEVEL SECURITY;

--
-- Name: scout_match_deadlines scout_match_deadlines_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_match_deadlines_select_approved ON public.scout_match_deadlines FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scout_match_deadlines scout_match_deadlines_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_match_deadlines_service_all ON public.scout_match_deadlines TO service_role USING (true) WITH CHECK (true);


--
-- Name: scout_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scout_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: scout_notes scout_notes_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_notes_delete_authenticated ON public.scout_notes FOR DELETE TO authenticated USING ((public.approved_user() AND (public.has_permission('NOTE_SCOUT_ADMIN'::text) OR (auth.uid() = created_by))));


--
-- Name: scout_notes scout_notes_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_notes_insert_authenticated ON public.scout_notes FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (created_by = auth.uid())));


--
-- Name: scout_notes scout_notes_modify_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_notes_modify_authenticated ON public.scout_notes FOR UPDATE TO authenticated USING ((public.approved_user() AND (public.has_permission('NOTE_SCOUT_ADMIN'::text) OR (auth.uid() = created_by)))) WITH CHECK ((public.approved_user() AND (public.has_permission('NOTE_SCOUT_ADMIN'::text) OR (auth.uid() = created_by))));


--
-- Name: scout_notes scout_notes_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_notes_select_authenticated ON public.scout_notes FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scout_notes scout_notes_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_notes_service_all ON public.scout_notes TO service_role USING (true) WITH CHECK (true);


--
-- Name: scout_pit_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scout_pit_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: scout_pit_assignments scout_pit_assignments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_pit_assignments_delete ON public.scout_pit_assignments FOR DELETE TO authenticated USING ((public.approved_user() AND public.has_permission('DATA_SCOUT_ADMIN'::text)));


--
-- Name: scout_pit_assignments scout_pit_assignments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_pit_assignments_insert ON public.scout_pit_assignments FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND public.has_permission('DATA_SCOUT_ADMIN'::text)));


--
-- Name: scout_pit_assignments scout_pit_assignments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_pit_assignments_select ON public.scout_pit_assignments FOR SELECT TO authenticated USING ((public.approved_user() AND ((assigned_user = auth.uid()) OR public.has_permission('DATA_SCOUT_ADMIN'::text))));


--
-- Name: scout_pit_assignments scout_pit_assignments_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_pit_assignments_service_all ON public.scout_pit_assignments TO service_role USING (true) WITH CHECK (true);


--
-- Name: scout_pit_assignments scout_pit_assignments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_pit_assignments_update ON public.scout_pit_assignments FOR UPDATE TO authenticated USING ((public.approved_user() AND public.has_permission('DATA_SCOUT_ADMIN'::text))) WITH CHECK ((public.approved_user() AND public.has_permission('DATA_SCOUT_ADMIN'::text)));


--
-- Name: scout_prescout_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scout_prescout_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: scout_prescout_assignments scout_prescout_assignments_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_prescout_assignments_select_approved ON public.scout_prescout_assignments FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scout_prescout_assignments scout_prescout_assignments_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scout_prescout_assignments_service_all ON public.scout_prescout_assignments TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_events ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_events scouting_events_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_events_select_approved ON public.scouting_events FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_events scouting_events_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_events_service_all ON public.scouting_events TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_form_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_form_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_form_drafts scouting_form_drafts_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_form_drafts_service_all ON public.scouting_form_drafts TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_form_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_form_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_form_versions scouting_form_versions_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_form_versions_select_approved ON public.scouting_form_versions FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_form_versions scouting_form_versions_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_form_versions_service_all ON public.scouting_form_versions TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_match_rankings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_match_rankings ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_match_rankings scouting_match_rankings_delete_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_match_rankings_delete_approved ON public.scouting_match_rankings FOR DELETE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (created_by = auth.uid()))));


--
-- Name: scouting_match_rankings scouting_match_rankings_insert_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_match_rankings_insert_approved ON public.scouting_match_rankings FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (COALESCE(created_by, auth.uid()) = auth.uid()) AND ((updated_by IS NULL) OR (updated_by = auth.uid()))));


--
-- Name: scouting_match_rankings scouting_match_rankings_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_match_rankings_select_approved ON public.scouting_match_rankings FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_match_rankings scouting_match_rankings_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_match_rankings_service_all ON public.scouting_match_rankings TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_match_rankings scouting_match_rankings_update_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_match_rankings_update_approved ON public.scouting_match_rankings FOR UPDATE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (created_by = auth.uid())))) WITH CHECK ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (created_by = auth.uid())) AND (COALESCE(updated_by, auth.uid()) = auth.uid())));


--
-- Name: scouting_pairwise_votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_pairwise_votes ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_pairwise_votes_delete_authenticated ON public.scouting_pairwise_votes FOR DELETE TO authenticated USING ((public.approved_user() AND (auth.uid() = created_by)));


--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_pairwise_votes_insert_authenticated ON public.scouting_pairwise_votes FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (auth.uid() = created_by)));


--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_pairwise_votes_select_authenticated ON public.scouting_pairwise_votes FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_pairwise_votes_service_all ON public.scouting_pairwise_votes TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_pairwise_votes scouting_pairwise_votes_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_pairwise_votes_update_authenticated ON public.scouting_pairwise_votes FOR UPDATE TO authenticated USING ((public.approved_user() AND (auth.uid() = created_by))) WITH CHECK ((public.approved_user() AND (auth.uid() = created_by)));


--
-- Name: scouting_picklist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_picklist ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_picklist scouting_picklist_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_picklist_delete_authenticated ON public.scouting_picklist FOR DELETE TO authenticated USING ((public.approved_user() AND (public.has_any_permission(ARRAY['DATA_SCOUT_ADMIN'::text, 'NOTE_SCOUT_ADMIN'::text, 'VIEW_ADMIN_PANEL'::text]) OR (created_by = auth.uid()))));


--
-- Name: scouting_picklist scouting_picklist_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_picklist_insert_authenticated ON public.scouting_picklist FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND ((created_by IS NULL) OR (created_by = auth.uid()))));


--
-- Name: scouting_picklist scouting_picklist_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_picklist_select_authenticated ON public.scouting_picklist FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_picklist scouting_picklist_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_picklist_service_all ON public.scouting_picklist TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_picklist scouting_picklist_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_picklist_update_authenticated ON public.scouting_picklist FOR UPDATE TO authenticated USING (public.approved_user()) WITH CHECK (public.approved_user());


--
-- Name: scouting_practice_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_practice_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_practice_matches scouting_practice_matches_delete_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_practice_matches_delete_approved ON public.scouting_practice_matches FOR DELETE TO authenticated USING ((public.approved_user() AND (public.has_permission('DATA_SCOUT_ADMIN'::text) OR (created_by = auth.uid()))));


--
-- Name: scouting_practice_matches scouting_practice_matches_insert_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_practice_matches_insert_approved ON public.scouting_practice_matches FOR INSERT TO authenticated WITH CHECK ((public.approved_user() AND (COALESCE(created_by, auth.uid()) = auth.uid())));


--
-- Name: scouting_practice_matches scouting_practice_matches_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_practice_matches_select_approved ON public.scouting_practice_matches FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_practice_matches scouting_practice_matches_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_practice_matches_service_all ON public.scouting_practice_matches TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_settings scouting_settings_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_settings_select_approved ON public.scouting_settings FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_settings scouting_settings_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_settings_service_all ON public.scouting_settings TO service_role USING (true) WITH CHECK (true);


--
-- Name: scouting_training_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scouting_training_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: scouting_training_matches scouting_training_matches_select_approved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_training_matches_select_approved ON public.scouting_training_matches FOR SELECT TO authenticated USING (public.approved_user());


--
-- Name: scouting_training_matches scouting_training_matches_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scouting_training_matches_service_all ON public.scouting_training_matches TO service_role USING (true) WITH CHECK (true);


--
-- Name: user_notification_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notification_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notification_logs user_notification_logs_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_notification_logs_service_all ON public.user_notification_logs TO service_role USING (true) WITH CHECK (true);


--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles user_profiles_admin_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_admin_manage ON public.user_profiles FOR UPDATE TO authenticated USING (public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'BAN_USERS'::text, 'PROMOTE_USERS'::text, 'APPROVE_USERS'::text])) WITH CHECK (public.has_any_permission(ARRAY['EDIT_PERMISSIONS'::text, 'BAN_USERS'::text, 'PROMOTE_USERS'::text, 'APPROVE_USERS'::text]));


--
-- Name: user_profiles user_profiles_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_delete_admin ON public.user_profiles FOR DELETE TO authenticated USING ((public.has_any_permission(ARRAY['BAN_USERS'::text, 'PROMOTE_USERS'::text]) AND (COALESCE(is_dev, false) = false)));


--
-- Name: user_profiles user_profiles_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_insert_self ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (((auth.uid() = id) AND ((COALESCE(role, 'member'::character varying))::text = 'member'::text) AND (COALESCE(general_role, 'none'::text) = 'none'::text) AND (lower(COALESCE(team_role, 'other'::text)) = 'other'::text) AND (frc_team IS NULL) AND (cardinality(COALESCE(permissions, '{}'::text[])) = 0) AND (COALESCE(banned, false) = false) AND (COALESCE(is_dev, false) = false)));


--
-- Name: user_profiles user_profiles_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_select_authenticated ON public.user_profiles FOR SELECT TO authenticated USING (((auth.uid() = id) OR public.approved_user()));


--
-- Name: user_profiles user_profiles_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_service_all ON public.user_profiles TO service_role USING (true) WITH CHECK (true);


--
-- Name: user_profiles user_profiles_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_update_self ON public.user_profiles FOR UPDATE TO authenticated USING (((auth.uid() = id) AND (COALESCE(banned, false) = false))) WITH CHECK (((auth.uid() = id) AND (COALESCE(banned, false) = false)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

-- Least privilege: drop whatever the project grants new tables by default, then grant only what is listed below.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION complete_match_scout_assignment_from_report(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_match_scout_assignment_from_report() FROM PUBLIC;


--
-- Name: FUNCTION log_activity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_activity() FROM PUBLIC;


--
-- Name: FUNCTION retention_event_inventory(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retention_event_inventory() FROM PUBLIC;
GRANT ALL ON FUNCTION public.retention_event_inventory() TO service_role;


--
-- Name: FUNCTION retention_sizes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retention_sizes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.retention_sizes() TO service_role;


--
-- Name: FUNCTION retention_storage_objects(p_bucket text, p_event_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retention_storage_objects(p_bucket text, p_event_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retention_storage_objects(p_bucket text, p_event_key text) TO service_role;


--
-- Name: FUNCTION user_profiles_actor_context(p_actor uuid, OUT profile_exists boolean, OUT actor_role text, OUT actor_permissions text[], OUT actor_banned boolean, OUT actor_is_dev boolean, OUT auth_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.user_profiles_actor_context(p_actor uuid, OUT profile_exists boolean, OUT actor_role text, OUT actor_permissions text[], OUT actor_banned boolean, OUT actor_is_dev boolean, OUT auth_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_profiles_actor_context(p_actor uuid, OUT profile_exists boolean, OUT actor_role text, OUT actor_permissions text[], OUT actor_banned boolean, OUT actor_is_dev boolean, OUT auth_email text) TO authenticated;
GRANT ALL ON FUNCTION public.user_profiles_actor_context(p_actor uuid, OUT profile_exists boolean, OUT actor_role text, OUT actor_permissions text[], OUT actor_banned boolean, OUT actor_is_dev boolean, OUT auth_email text) TO service_role;


--
-- Name: TABLE activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.activity_log TO authenticated;
GRANT ALL ON TABLE public.activity_log TO service_role;


--
-- Name: SEQUENCE activity_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.activity_log_id_seq TO authenticated;
GRANT SELECT,USAGE ON SEQUENCE public.activity_log_id_seq TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.app_settings TO anon;
GRANT SELECT ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE competition_team_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.competition_team_members TO authenticated;
GRANT ALL ON TABLE public.competition_team_members TO service_role;


--
-- Name: TABLE match_scout_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.match_scout_entries TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.match_scout_entries TO service_role;


--
-- Name: SEQUENCE match_scout_entries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.match_scout_entries_id_seq TO authenticated;
GRANT SELECT,USAGE ON SEQUENCE public.match_scout_entries_id_seq TO service_role;


--
-- Name: TABLE pit_problem_reports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pit_problem_reports TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pit_problem_reports TO service_role;


--
-- Name: TABLE pit_scout_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pit_scout_entries TO authenticated;
GRANT ALL ON TABLE public.pit_scout_entries TO service_role;


--
-- Name: SEQUENCE pit_scout_entries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.pit_scout_entries_id_seq TO authenticated;
GRANT SELECT,USAGE ON SEQUENCE public.pit_scout_entries_id_seq TO service_role;


--
-- Name: SEQUENCE plan_project_code_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.plan_project_code_seq TO authenticated;
GRANT SELECT,USAGE ON SEQUENCE public.plan_project_code_seq TO service_role;


--
-- Name: TABLE pm_alliance_draft_picks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pm_alliance_draft_picks TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pm_alliance_draft_picks TO service_role;


--
-- Name: TABLE pm_elo_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.pm_elo_history TO authenticated;
GRANT ALL ON TABLE public.pm_elo_history TO service_role;


--
-- Name: TABLE pm_elo_ratings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.pm_elo_ratings TO authenticated;
GRANT ALL ON TABLE public.pm_elo_ratings TO service_role;


--
-- Name: TABLE pm_friends; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pm_friends TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pm_friends TO service_role;


--
-- Name: TABLE pm_match_picks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pm_match_picks TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pm_match_picks TO service_role;


--
-- Name: TABLE pm_reactions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.pm_reactions TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pm_reactions TO service_role;


--
-- Name: TABLE prediction_market_bets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.prediction_market_bets TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.prediction_market_bets TO service_role;


--
-- Name: TABLE roster_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roster_entries TO authenticated;
GRANT ALL ON TABLE public.roster_entries TO service_role;


--
-- Name: TABLE roster_keys; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roster_keys TO authenticated;
GRANT ALL ON TABLE public.roster_keys TO service_role;


--
-- Name: TABLE rosters; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rosters TO authenticated;
GRANT ALL ON TABLE public.rosters TO service_role;


--
-- Name: TABLE scout_data_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scout_data_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scout_data_events TO authenticated;


--
-- Name: TABLE scout_match_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.scout_match_assignments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scout_match_assignments TO authenticated;


--
-- Name: TABLE scout_match_deadlines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.scout_match_deadlines TO authenticated;
GRANT ALL ON TABLE public.scout_match_deadlines TO service_role;


--
-- Name: TABLE scout_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scout_notes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scout_notes TO authenticated;


--
-- Name: TABLE scout_pit_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scout_pit_assignments TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.scout_pit_assignments TO service_role;


--
-- Name: TABLE scout_prescout_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.scout_prescout_assignments TO authenticated;
GRANT ALL ON TABLE public.scout_prescout_assignments TO service_role;


--
-- Name: TABLE scouting_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.scouting_events TO authenticated;
GRANT ALL ON TABLE public.scouting_events TO service_role;


--
-- Name: TABLE scouting_form_drafts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scouting_form_drafts TO service_role;


--
-- Name: TABLE scouting_form_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.scouting_form_versions TO authenticated;
GRANT ALL ON TABLE public.scouting_form_versions TO service_role;


--
-- Name: TABLE scouting_match_rankings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scouting_match_rankings TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.scouting_match_rankings TO service_role;


--
-- Name: TABLE scouting_pairwise_votes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scouting_pairwise_votes TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.scouting_pairwise_votes TO service_role;


--
-- Name: TABLE scouting_picklist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scouting_picklist TO authenticated;
GRANT ALL ON TABLE public.scouting_picklist TO service_role;


--
-- Name: TABLE scouting_practice_matches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.scouting_practice_matches TO authenticated;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.scouting_practice_matches TO service_role;


--
-- Name: TABLE scouting_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scouting_settings TO service_role;


--
-- Name: COLUMN scouting_settings.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.scouting_settings TO authenticated;


--
-- Name: COLUMN scouting_settings.event_key; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(event_key) ON TABLE public.scouting_settings TO authenticated;


--
-- Name: COLUMN scouting_settings.updated_by; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_by) ON TABLE public.scouting_settings TO authenticated;


--
-- Name: COLUMN scouting_settings.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.scouting_settings TO authenticated;


--
-- Name: COLUMN scouting_settings.smart_fuel_algorithm_enabled; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(smart_fuel_algorithm_enabled) ON TABLE public.scouting_settings TO authenticated;


--
-- Name: COLUMN scouting_settings.manual_teams; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(manual_teams) ON TABLE public.scouting_settings TO authenticated;


--
-- Name: COLUMN scouting_settings.start_position_photos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(start_position_photos) ON TABLE public.scouting_settings TO authenticated;


--
-- Name: TABLE scouting_training_matches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.scouting_training_matches TO authenticated;
GRANT ALL ON TABLE public.scouting_training_matches TO service_role;


--
-- Name: TABLE user_notification_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_notification_logs TO service_role;


--
-- Name: TABLE user_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_profiles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_profiles TO authenticated;


--
-- PostgreSQL database dump complete
--



SET search_path = public, extensions;

-- A profile for every new account (waiting for an admin's approval).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Storage: robot photos from pit scouting (public links, like the photos on The Blue Alliance), and the
-- team logo uploaded in Team settings (public, it is shown on the sign-in page).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pit-scout-photos', 'pit-scout-photos', true, 5242880, '{image/jpeg,image/png,image/webp}'::text[])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 524288, '{image/png,image/jpeg,image/webp}'::text[])
on conflict (id) do nothing;

drop policy if exists pit_scout_photos_select on storage.objects;
drop policy if exists pit_scout_photos_insert on storage.objects;
drop policy if exists pit_scout_photos_update on storage.objects;
drop policy if exists pit_scout_photos_delete on storage.objects;
create policy pit_scout_photos_delete on storage.objects as permissive for DELETE to authenticated using (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((owner = auth.uid()) OR has_permission('DATA_SCOUT_ADMIN'::text)) AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text))));
create policy pit_scout_photos_insert on storage.objects as permissive for INSERT to authenticated with check (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text))));
create policy pit_scout_photos_select on storage.objects as permissive for SELECT to authenticated using (((bucket_id = 'pit-scout-photos'::text) AND approved_user()));
create policy pit_scout_photos_update on storage.objects as permissive for UPDATE to authenticated using (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((owner = auth.uid()) OR has_permission('DATA_SCOUT_ADMIN'::text)) AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text)))) with check (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((owner = auth.uid()) OR has_permission('DATA_SCOUT_ADMIN'::text)) AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text))));
-- The branding bucket is written only by the server (service role) after an admin check, so it needs no
-- insert, update or delete policies.

-- Starting rows: the single scouting settings row, and the roster that holds the competition roles
-- (Scouting Admin > People creates the role keys in it the first time it opens).
insert into public.scouting_settings (id) values (1) on conflict (id) do nothing;
insert into public.rosters (name, is_public, is_admin_editable, type)
select 'Competition Roles', false, true, 'multi'
where not exists (select 1 from public.rosters where name = 'Competition Roles');
