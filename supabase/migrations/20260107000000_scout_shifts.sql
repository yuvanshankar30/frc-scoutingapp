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

alter table public.scout_shifts enable row level security;
revoke all on table public.scout_shifts from anon, authenticated;
grant select on table public.scout_shifts to authenticated;
grant all on table public.scout_shifts to service_role;
drop policy if exists scout_shifts_read on public.scout_shifts;
create policy scout_shifts_read on public.scout_shifts for select to authenticated using (public.approved_user());

drop trigger if exists zz_activity_log on public.scout_shifts;
create trigger zz_activity_log after insert or delete or update on public.scout_shifts
  for each row execute function public.log_activity();
