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
| `SETUP_TOKEN` | Any long random string, e.g. `openssl rand -base64 32` |
| `TBA_API_KEY` | The Blue Alliance account page, "Read API Keys" |
| `APP_ORIGIN` | The address you open, e.g. `http://localhost:5173` |

The first time you open the site you land on [first-run setup](../app/first-run-setup.md).

## Check it

```sh
curl -s http://localhost:5173/api/setup
```

`{"configured":false,"tokenConfigured":true,"databaseError":null}` means the server reaches the database and setup is
waiting for you. `databaseError` set means the URL or service key is wrong, or the schema has not been applied.
`tokenConfigured: false` means `SETUP_TOKEN` is missing.

```sh
curl -s "http://localhost:5173/api/tba/event-info?event_key=2026cc"
```

`"success":true` is good. `Server missing TBA_API_KEY` means the key isn't in `.env`.

## Common problems

| Problem | Fix |
| --- | --- |
| Every page goes to `/setup` | Setup hasn't been finished yet. Finish it, or check `databaseError` above |
| Setup says the token is wrong | It must match `SETUP_TOKEN` exactly. Restart the server after editing `.env` |
| Sign-up says to check your email, but no email comes | Hosted Supabase's built-in email is rate limited; set up SMTP in Supabase, turn off "Confirm email" while developing, or add accounts in Scouting Admin > Add user |
| Signed in but every page is empty | Your account is waiting for approval. An admin approves it in Scouting Admin > People |
| Requests fail when the server is started from a sandboxed shell | The server needs network access. Start it from a normal terminal |
