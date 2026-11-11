# Running the site locally

## Start it

```sh
npm install
cp .env.example .env        # fill it in, see below
npm run dev                 # http://localhost:5173
```

Use another port if 5173 is taken, and set `APP_ORIGIN` to match (for example
`APP_ORIGIN=http://localhost:5183 npx vite dev --port 5183 --strictPort`). Restart the server after any `.env` change;
it only reads `.env` when it starts.

## Which database

You have two choices:

- **A hosted Supabase project** (the simplest). Use a separate project for development if your team's real data lives
  in one, so test submissions and deletes never touch it.
- **A local Supabase** with the [Supabase CLI](https://supabase.com/docs/guides/local-development) (needs Docker):

  ```sh
  npx supabase start          # prints the local URL and keys
  npx supabase db reset       # applies supabase/migrations
  ```

  Put the printed API URL in `PUBLIC_SUPABASE_URL`, the anon key in `PUBLIC_SUPABASE_ANON_KEY` and the service_role key
  in `SUPABASE_SERVICE_KEY`. Local Supabase auth does not send real emails (see its Inbucket/Mailpit page for sign-up
  confirmations), and `supabase/config.toml` already allows `http://localhost:5173`.

## Set up `.env`

| Variable | Where it comes from |
| --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` | Supabase dashboard > Project Settings > API, or `npx supabase status` locally |
| `TBA_API_KEY` | The Blue Alliance account page, "Read API Keys" |
| `APP_ORIGIN` | The address you open, e.g. `http://localhost:5173` |

Then make your admin account and set your team (`npm run admin -- create-admin ...` and `set-team ...`, see the
README), and sign in.

## Check it

```sh
npm run admin -- show
```

It prints the team settings row when `.env` points at a database with the schema applied, and an error otherwise. On
the site, a "Not connected to a database yet" page means the same problem (in development it says which).

```sh
curl -s "http://localhost:5173/api/tba/event-info?event_key=2026cc"
```

`"success":true` is good. `Server missing TBA_API_KEY` means the key isn't in `.env`.

## Common problems

| Problem | Fix |
| --- | --- |
| Every page says "Not connected to a database yet" | `.env` is missing or incomplete, or the schema is not applied. In development the page shows which. Fill in `.env` and restart the server |
| A reminder to set your team shows on every page | No team yet: set it in Scouting Admin > Team settings or with `npm run admin -- set-team` |
| Sign-up says to check your email, but no email comes | Hosted Supabase's built-in email is rate limited; set up SMTP in Supabase, or turn off "Confirm email" while developing |
| Signed in but every page is empty | Your account is waiting for approval. An admin approves it in Scouting Admin > People |
| Requests fail when the server is started from a sandboxed shell | The server needs network access. Start it from a normal terminal |
