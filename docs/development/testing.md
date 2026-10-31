# Testing and checks

Run these before opening a pull request, and say what you ran in its description. If your fork has CI, have it run the
same commands.

| What | Command |
| --- | --- |
| Unit tests (also the UI rules, API auth and formatting checks) | `npm test` (or `npx vitest run`) |
| Svelte and type check (fails on warnings too) | `npm run check` |
| Lint: undefined names, dead code | `npm run lint` |
| Format with Prettier, after every code change (config in `prettier/`) | `npm run format` |
| A production build | `npm run build` (needs `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` set) |

The unit tests need no network and no database: Supabase and The Blue Alliance are mocked.

## Database tests

`supabase/tests/rls_access.sql` checks the row-level security in `supabase/migrations/` as real `anon` and
`authenticated` sessions: anyone can read the team settings and nothing else, a pending account sees no scouting data
and cannot approve or promote itself, an approved scout can read but not change roles or settings, a banned account
loses access, and an admin can approve accounts. It runs in a transaction that is rolled back.

```sh
npx supabase start          # a local Supabase (needs Docker)
npx supabase db reset       # applies supabase/migrations
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls_access.sql
```

It prints `rls_access: all checks passed`, or stops at the first check that failed.
