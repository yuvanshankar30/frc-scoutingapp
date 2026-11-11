# Signing in

People sign in at `/login` with their email and password, checked by Supabase Auth. A bare username (no `@`) is
shorthand for an address at the username domain (`PUBLIC_USERNAME_EMAIL_DOMAIN`, default `scouting.local`), which is
how shared logins (for example `pit1` on a scouting tablet) work. Signing out only signs out this device, and
asks first if there are scouting reports on the device that haven't been sent yet.

The sign-in page shows the team's name, app name, logo and colors from [Team settings](../scouting-admin/team-settings.md),
so it looks like your app before anyone signs in.

## Creating an account

When Team settings allow self sign-up, "Create an account" asks for a name, email and password. The new account is
**pending**: it can sign in but sees no scouting data until an admin approves it in
[Scouting Admin > People](../scouting-admin/people-and-roles.md). If the Supabase project requires email confirmation
(the default for hosted projects), the person first clicks the link in the email Supabase sends.

Turning sign-up off in Team settings hides the button. To block sign-ups at the source as well, also turn off
"Allow new users to sign up" in the Supabase dashboard (Authentication > Sign In / Providers); admins can still add
accounts.

## Forgotten passwords

An admin sets a new password in Scouting Admin > People. (Supabase's own password reset email also works if you set up
a page for it; the app doesn't include one.)

## Code

`src/routes/login/+page.svelte` (the page), `src/lib/stores/auth.js` (session and profile), `src/lib/app/loginEmail.js`
(usernames), `src/lib/app/safeUrl.js` (the `?next=` return address only ever points inside the app). If sign-in fails
on a local server, see [local-dev.md](../development/local-dev.md#common-problems).
