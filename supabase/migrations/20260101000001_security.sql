-- FRC Scouting App, part 2 of 2: who can read and write what.
--
-- Run this after 20260101000000_schema.sql. It turns on row-level security for every table, adds the policies and
-- grants, the storage policies for pit photos, and locks server-only functions away from client roles.
-- In short: nothing is readable until an admin approves the account (public.approved_user()), except app_settings
-- (your team name, colors and logo), which the sign-in page shows to everyone.







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
-- Name: TABLE user_notification_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_notification_logs TO service_role;


--
-- Name: TABLE user_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_profiles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_profiles TO authenticated;




SET search_path = public, extensions;

drop policy if exists pit_scout_photos_select on storage.objects;
drop policy if exists pit_scout_photos_insert on storage.objects;
drop policy if exists pit_scout_photos_update on storage.objects;
drop policy if exists pit_scout_photos_delete on storage.objects;
create policy pit_scout_photos_delete on storage.objects as permissive for DELETE to authenticated using (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((owner = auth.uid()) OR has_permission('DATA_SCOUT_ADMIN'::text)) AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text))));
create policy pit_scout_photos_insert on storage.objects as permissive for INSERT to authenticated with check (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text))));
create policy pit_scout_photos_select on storage.objects as permissive for SELECT to authenticated using (((bucket_id = 'pit-scout-photos'::text) AND approved_user()));
create policy pit_scout_photos_update on storage.objects as permissive for UPDATE to authenticated using (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((owner = auth.uid()) OR has_permission('DATA_SCOUT_ADMIN'::text)) AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text)))) with check (((bucket_id = 'pit-scout-photos'::text) AND approved_user() AND ((owner = auth.uid()) OR has_permission('DATA_SCOUT_ADMIN'::text)) AND ((name !~~ 'match-starts/%'::text) OR has_permission('DATA_SCOUT_ADMIN'::text))));

-- ---- from 20260102000000_security_followups.sql ----
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

-- ---- from 20260106000000_access_roles.sql ----
alter table public.access_roles enable row level security;
revoke all on table public.access_roles from anon, authenticated;
grant select on table public.access_roles to authenticated;
grant all on table public.access_roles to service_role;
drop policy if exists access_roles_read on public.access_roles;
create policy access_roles_read on public.access_roles for select to authenticated using (public.approved_user());

-- ---- from 20260107000000_scout_shifts.sql ----
alter table public.scout_shifts enable row level security;
revoke all on table public.scout_shifts from anon, authenticated;
grant select on table public.scout_shifts to authenticated;
grant all on table public.scout_shifts to service_role;
drop policy if exists scout_shifts_read on public.scout_shifts;
create policy scout_shifts_read on public.scout_shifts for select to authenticated using (public.approved_user());
