-- FRC Scouting App, part 1 of 2: the database itself.
--
-- Run this first on a new Supabase project, then 20260101000001_security.sql. Together they are the whole schema:
-- every table, function, index and trigger the app uses, the trigger that gives each new account a profile waiting
-- for approval, the storage buckets for pit photos and the team logo, and the few starting rows. There is no team
-- data in here; your team is set up on the site (Scouting Admin > Team settings) or with `npm run admin`.

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
-- Name: user_notification_logs_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_notification_logs_key ON public.user_notification_logs USING btree (user_id, event_type, entity_key);


--
-- Name: match_scout_entries match_scout_entry_completes_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER match_scout_entry_completes_assignment AFTER INSERT OR UPDATE OF event_key, match_key, team_key, created_by ON public.match_scout_entries FOR EACH ROW EXECUTE FUNCTION public.complete_match_scout_assignment_from_report();


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

-- The branding bucket is written only by the server (service role) after an admin check, so it needs no
-- insert, update or delete policies.

-- Starting rows: the single scouting settings row, and the roster that holds the competition roles
-- (Scouting Admin > People creates the role keys in it the first time it opens).
insert into public.scouting_settings (id) values (1) on conflict (id) do nothing;
insert into public.rosters (name, is_public, is_admin_editable, type)
select 'Competition Roles', false, true, 'multi'
where not exists (select 1 from public.rosters where name = 'Competition Roles');

-- ---- from 20260103000000_team_settings_without_setup.sql ----
-- Team settings without a first-run setup screen.
--
-- The site no longer asks for the team on first visit. The settings row exists from the start with no team, admins
-- fill it in under Scouting Admin > Team settings, and scripts can set it with `npm run admin -- set-team ...`
-- (scripts/admin.mjs). The first admin account is made the same way: `npm run admin -- create-admin ...`.

alter table public.app_settings alter column team_number drop not null;
insert into public.app_settings (id, team_name) values (1, '') on conflict (id) do nothing;

-- ---- from 20260104000000_match_report_detail_fields.sql ----
-- Match report detail fields: defense details (Data), exact BPS (Performance), robot status per shift and foul nature (Robot).
--
-- All columns are nullable and additive; older reports keep null. The kind-only checks from the initial schema are
-- recreated with the new columns so each kind still keeps to its own fields (KIND_ONLY_FIELDS in reportKinds.js).
-- Rollback: recreate the three constraints from the initial schema, then drop the five columns.

alter table public.match_scout_entries
  add column if not exists defense jsonb,
  add column if not exists bps numeric,
  add column if not exists robot_status_shifts jsonb,
  add column if not exists foul_nature text,
  add column if not exists foul_details text;
alter table public.match_scout_entries drop constraint if exists match_scout_entries_data_only_fields;
alter table public.match_scout_entries add constraint match_scout_entries_data_only_fields check (
  coalesce(report_kind, 'data') = 'data' or num_nonnulls(starting_position, auto_start_zone, auto_points_band, auto_points_min, auto_points_max, auto_points_average, auto_finish, auto_moved, auto_path_name, auto_cycles, preload, teleop_notes, balls_scored_band, balls_scored_min, balls_scored_max, balls_scored_average, shuttled, shuttle_band, shuttle_min, shuttle_max, shuttle_average, shuttle_rating, shuttle_notes, defense) = 0
);
alter table public.match_scout_entries drop constraint if exists match_scout_entries_performance_only_fields;
alter table public.match_scout_entries add constraint match_scout_entries_performance_only_fields check (
  coalesce(report_kind, 'data') = 'performance' or num_nonnulls(offense_rating, defense_rating, performance_notes, bps) = 0
);
alter table public.match_scout_entries drop constraint if exists match_scout_entries_robot_only_fields;
alter table public.match_scout_entries add constraint match_scout_entries_robot_only_fields check (
  coalesce(report_kind, 'data') = 'robot' or num_nonnulls(fouls_minor, fouls_major, break_details, break_impact, break_response, robot_status_shifts, foul_nature, foul_details) = 0
);

-- ---- from 20260105000000_team_appearance.sql ----
-- How the app looks beyond the brand color: surface palette, second color, fonts, corners, the logo badge, a tagline
-- and a few switches, as one JSON object that src/lib/app/appearance.js reads and checks (unknown keys are ignored
-- there). Readable by everyone like the rest of app_settings; only the service role writes it.
-- Rollback: alter table public.app_settings drop column appearance;
alter table public.app_settings add column if not exists appearance jsonb not null default '{}'::jsonb;
alter table public.app_settings drop constraint if exists app_settings_appearance_check;
alter table public.app_settings add constraint app_settings_appearance_check
  check (jsonb_typeof(appearance) = 'object' and pg_column_size(appearance) <= 4096);

-- ---- from 20260106000000_access_roles.sql ----
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
drop trigger if exists zz_activity_log on public.access_roles;
create trigger zz_activity_log after insert or delete or update on public.access_roles
  for each row execute function public.log_activity();
-- Team settings changes are logged too, so the Activity view covers who changed the look, the team or the menu.
drop trigger if exists zz_activity_log on public.app_settings;
create trigger zz_activity_log after insert or delete or update on public.app_settings
  for each row execute function public.log_activity();

-- ---- from 20260107000000_scout_shifts.sql ----
-- Shift-based match scouting (Scouting Admin > Assignments > Shifts): one scout on one field slot for a run of
-- qualification matches. Publishing a plan writes ordinary scout_match_assignments; this table keeps the plan itself.
create table if not exists public.scout_shifts (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  slot text not null check (slot in ('red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3')),
  start_match integer not null check (start_match between 1 and 400),
  end_match integer not null check (end_match between 1 and 400),
  assigned_user uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scout_shifts_range check (start_match <= end_match)
);
create index if not exists scout_shifts_event_idx on public.scout_shifts (event_key, slot, start_match);
drop trigger if exists zz_activity_log on public.scout_shifts;
create trigger zz_activity_log after insert or delete or update on public.scout_shifts
  for each row execute function public.log_activity();
