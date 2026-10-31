# Database

The schema is SQL in `supabase/migrations/`, applied in filename order (`npx supabase db push`, or paste it into the
Supabase SQL editor). `20260101000000_initial_schema.sql` creates everything; later changes go in new files. Row-level
security decides what each signed-in person can read; see [architecture overview](overview.md#access-model) and
[security](../security/README.md).

## Team settings (`app_settings`)

One row (`id = 1`), present from the start with no team, written by [Team settings](../scouting-admin/team-settings.md)
and `npm run admin -- set-team`: `team_number`, `team_name`, `other_team_numbers`, `app_name`,
`app_short_name`, `brand_color`, `default_theme`, `time_zone`, `logo_url`, `hidden_features`, `allow_sign_up`,
and `setup_completed_at` (no longer used). Anyone may read it (the sign-in page shows the name, colors and logo); only the server writes it.

## Accounts and roles

- `user_profiles`: one row per account (made by the `handle_new_user` trigger): name, email, `role` (`admin` or
  `member`), `general_role`, `permissions` (`CAN_SEE_ROUTES` means approved), `frc_team`, `banned`, theme and
  notification preferences. The `user_profiles_security_guard` trigger stops people changing their own privileges.
- `rosters`, `roster_keys`, `roster_entries`: competition roles. The schema creates a "Competition Roles" roster;
  Scouting Admin > People creates the role keys in it and assigns them.
- `competition_team_members`: which of your teams (or Mentor) a person competes for at the current event.

## Match reports (`match_scout_entries`)

- **One report per scout, robot, match and kind.** `report_kind` (data, performance, robot) is part of the unique key.
  Each kind may only fill its own columns (`KIND_ONLY_FIELDS` in `src/lib/scouting/reportKinds.js`), enforced by the
  API and by database checks.
- **Real match keys.** `match_key` holds the TBA key (`2026cc_qm12`); what the scout typed is kept in `match_label`.
  `canonicalMatchKey()` (`src/lib/matches/matchKeys.js`) does the conversion in the app, and the database checks team,
  event and match key formats (`is_frc_team_key`, `is_event_key`, `is_match_key`).
- **Who scouted it.** `scouted_by` links to the account of the person who scouted (`resolveScoutedBy` in
  `src/lib/server/scouting/scoutIdentity.js`); `scout_name` stays as the typed fallback, and pages show
  `scoutDisplayName` (profile name first).

## Other scouting tables

`pit_scout_entries`, `pit_problem_reports`, `scout_match_assignments`, `scout_pit_assignments`,
`scout_prescout_assignments`, `scout_match_deadlines`, `scout_notes`, `scout_data_events` (quick scout),
`scouting_match_rankings` (`ranked_team_keys` is an ordered array, read and written whole), `scouting_pairwise_votes`,
`scouting_picklist`, `scouting_settings` (the active event and export settings, one row), `scouting_events`,
`scouting_form_versions` / `scouting_form_drafts`, `scouting_training_matches`, `scouting_practice_matches`,
`robot_tickets` (Pit Crew), and the prediction game's `pm_*` and `prediction_market_bets` tables. `activity_log` keeps
an audit trail of changes to the main tables.

## Storage

- `pit-scout-photos`: robot photos from pit scouting (public links, up to 5 MB, JPEG/PNG/WebP). Only approved accounts
  can upload, and only the uploader or a scouting admin can replace or delete one.
- `branding`: the team logo (public, up to 512 KB). Only the server writes it.

## Data cleanup functions

`retention_sizes()`, `retention_event_inventory()` and `retention_storage_objects(bucket, event_key)` report table and
bucket sizes and what old competition data exists per event. They are read-only, `security definer`, and executable by
`service_role` only. The cleanup they feed is described in
[Scouting Admin, Data](../scouting-admin/data.md#storage-and-data-cleanup).
