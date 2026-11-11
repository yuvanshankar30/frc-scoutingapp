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
