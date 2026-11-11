-- How the app looks beyond the brand color: surface palette, second color, fonts, corners, the logo badge, a tagline
-- and a few switches, as one JSON object that src/lib/app/appearance.js reads and checks (unknown keys are ignored
-- there). Readable by everyone like the rest of app_settings; only the service role writes it.
-- Rollback: alter table public.app_settings drop column appearance;

alter table public.app_settings add column if not exists appearance jsonb not null default '{}'::jsonb;

alter table public.app_settings drop constraint if exists app_settings_appearance_check;
alter table public.app_settings add constraint app_settings_appearance_check
  check (jsonb_typeof(appearance) = 'object' and pg_column_size(appearance) <= 4096);
