-- Team settings without a first-run setup screen.
--
-- The site no longer asks for the team on first visit. The settings row exists from the start with no team, admins
-- fill it in under Scouting Admin > Team settings, and scripts can set it with `npm run admin -- set-team ...`
-- (scripts/admin.mjs). The first admin account is made the same way: `npm run admin -- create-admin ...`.

alter table public.app_settings alter column team_number drop not null;

insert into public.app_settings (id, team_name) values (1, '') on conflict (id) do nothing;
