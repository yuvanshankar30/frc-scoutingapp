# Scouting Admin: People and roles

Everyone with an account: names, approval, competition roles and teams.

## Waiting for approval

New self sign-ups are listed at the top until someone deals with them. **Approve** lets the person see the scouting
data; **Ban** signs them out and blocks the account for good. Admins and the Competition Lead can do this (the
`approve-user` and `ban-and-revoke-user` actions).

## Accounts

Under each person's name, admins and the Competition Lead can **Set password** (the person is signed out everywhere),
**Take away access** (back to waiting for approval, without banning), and admins can **Make admin** / **Remove admin**.
Nobody can change their own admin role, and only an admin can change an admin's password. Click a name to rename it.

## Competition roles and teams

A person can hold several competition roles (one list in `src/lib/scouting/competitionRoles.js`: Leadership, Drive
Team, Pit Crew, Strategy, Picklist, Scouting, including the Data / Performance / Robot Scout roles), shown as chips with
an Add role picker. **Competition Lead** is the top role and passes every Scouting Admin and permission check. Lead
roles can only be granted by an admin or a Competition Lead. The roles live in the "Competition Roles" roster
(`rosters`, `roster_keys`, `roster_entries`); the role keys are created the first time this page saves one.

**Team** is the team the person competes for at this event: your team number, any other teams from
[Team settings](team-settings.md), or Mentor (only an admin or the Competition Lead can give Mentor). It is stored in
`competition_team_members`; with no row, the team on the person's profile applies.

## Scouting Admin column

Next to **Team**, a checkmark shows everyone who can use Scouting Admin: an admin, the Competition Lead, or anyone
holding a role that carries Scouting Admin (Scouting, Strategy, Pit, Picklist 1 or Picklist 2 Lead). Everyone else
shows "—". The rule is `hasScoutingAdmin()` in `src/lib/scouting/competitionRoles.js`, the same one the Scouting Admin
API checks. On phones the check and the words "Scouting Admin" sit next to the team picker.

## Roles and permissions

Scouting Admin > People > **Roles** builds roles out of permissions (the catalog is `PERMISSION_CATALOG` in
`src/lib/app/accessRoles.js`, also served by `GET /api/access-roles`). Everyone without a role is a **Member**: once
approved they can use the app, scout and read the analysis pages. A permission is only ever given through a role:
assigning a role, or changing one, rewrites its holders' `user_profiles.permissions`, and deleting a role makes its
holders Members again. Nobody can put a permission into a role, or give a role, that carries something they can't do
themselves. Roles live in `access_roles`; a person's role is `user_profiles.access_role_id`.

Admins, the Competition Lead and holders of a Scouting Admin competition role keep full access. Anyone else needs the
specific permission for each action (the map is `ACTION_PERMISSIONS` in `src/routes/api/scouting-admin/+server.js`).

## Activity

People > **Activity** lists every change the database records in `activity_log` (a trigger on every main table, roles
and team settings included): who did it, what kind of record, which record, and the fields that changed. Search
filters what is loaded; the area dropdown narrows it on the server. Needs the "See the activity log" permission.
