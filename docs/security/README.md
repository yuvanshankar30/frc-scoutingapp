# Security

How the app protects accounts, scouting data and secrets. Scouting data is competitive information, and event venues
are full of people on the same Wi-Fi, so the rules are enforced in the database, not only in the pages.

## Who can see what

- **The browser holds only public keys.** `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` are public by design;
  anyone could call Supabase with them. Row-level security (RLS) on every table is what protects the data.
- **Nothing is readable until an account is approved.** Policies check `public.approved_user()`: an admin, or an
  account with `CAN_SEE_ROUTES`, and not banned. A new or pending account sees only its own profile. The one table
  anyone can read is `app_settings` (team name, colors, logo), which the sign-in page needs.
- **Nobody can raise their own privileges.** The `user_profiles_security_guard` trigger and the insert policy stop a
  person changing their own role, permissions, team or ban status, and only admins can grant admin.
- **Bans apply at once.** A banned account fails `approved_user()` and every permission check.
- **Least-privilege grants.** The schema revokes the project's default table privileges from `anon` and
  `authenticated` and grants back only what each table needs; `TRUNCATE` is never granted.
- **Storage.** Pit photos can only be uploaded by approved accounts and changed by their uploader or a scouting admin.
  The logo bucket is written only by the server.

`supabase/tests/rls_access.sql` checks these rules against a real database ([testing](../development/testing.md)).

## The server

- **The service-role key stays on the server** (`src/lib/server/serviceClient.js`, `$env/dynamic/private`). Routes that
  use it check the caller first (`src/lib/server/scouting/scoutingAccess.js`).
- **No setup screen to hijack.** A new site has no web page that makes the first admin: it is made with
  `npm run admin -- create-admin`, which needs the service key, so only someone with access to the server's `.env` can.
- **Cross-site requests.** `hooks.server.js` rejects cross-site form posts and adds `X-Frame-Options: DENY`,
  `frame-ancestors 'none'`, `nosniff` and a same-origin referrer policy. SvelteKit's own origin check stays on.
- **The Blue Alliance key and AI keys** are only used on the server; the browser calls `/api/tba/*` (public data,
  limited to 1,200 requests a minute per address) and `/api/scouting-assistant` (approved accounts only, and every
  model call has an output cap, `ASSISTANT_MAX_TOKENS`).
- **API answers are never cached.** Every `/api/*` answer that sets no `Cache-Control` of its own gets
  `private, no-store`, so a shared device or proxy never keeps someone's scouting data.
- **Server-only database functions** (the data-cleanup inventory, the trigger functions) can't be run by client roles.
- **Untrusted text.** Scout notes and other free text are escaped when shown; the AI assistant is told to treat them as
  data, never as instructions, and can only propose changes that a person confirms.
- **Error text is scrubbed** of tokens and keys before it is stored or shown (`src/lib/server/redact.js`).

## Your responsibilities when you deploy

- Keep `.env` and `SUPABASE_SERVICE_KEY` out of git and out of any `PUBLIC_` variable.
- Serve the site over HTTPS, and set `ORIGIN` / `APP_ORIGIN` to its real address.
- Approve only people you know, and remove or ban accounts when people leave.
- Keep dependencies up to date (`npm audit`). The Docker build installs with `npm ci --ignore-scripts`.

Found a security problem? Report it privately to the repository owner rather than in a public issue.
