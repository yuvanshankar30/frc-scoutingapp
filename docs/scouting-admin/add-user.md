# Scouting Admin: Add user

Creates a login by hand: a username or a full email, an optional name and team, and a password. A bare username is
shorthand for `name@scouting.local` (or `PUBLIC_USERNAME_EMAIL_DOMAIN`), which suits shared scouting tablets; no email
is sent. Accounts made here are **approved straight away**, unlike self sign-ups. The team list comes from
[Team settings](team-settings.md) plus Mentor.

Code: `src/lib/components/scouting/AdminAddUser.svelte` and the `create-user` action in
`src/lib/server/scouting/admin/actions.js`.
