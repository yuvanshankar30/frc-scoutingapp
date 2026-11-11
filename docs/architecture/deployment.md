# Deployment

The app is a Node server built with `@sveltejs/adapter-node`. Anything that runs Node 22 or a Docker image can host it.

## Build and run

The Supabase URL and anon key are inlined into the browser bundle at build time, so they must be set when building.
Everything else is read when the server starts.

**Docker** (`deploy/Dockerfile`; build from the repo root with `npm run docker:build`; listens on port 8080):

```sh
docker build -f deploy/Dockerfile \
  --build-arg PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co \
  --build-arg PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t frc-scoutingapp .
docker run -p 8080:8080 --env-file .env -e ORIGIN=https://scouting.example.org frc-scoutingapp
```

**Plain Node:**

```sh
PUBLIC_SUPABASE_URL=... PUBLIC_SUPABASE_ANON_KEY=... npm run build
ORIGIN=https://scouting.example.org PORT=3000 node build
```

## Environment

Set every variable from [.env.example](../../.env.example) in the host's environment or secret manager. In production:

- `APP_ORIGIN` and `ORIGIN` are the public address (`https://...`). `ORIGIN` is read by adapter-node to check where form
  posts come from; `APP_ORIGIN` is used for links the app builds.
- `SUPABASE_SERVICE_KEY` is a secret: keep it in a secret manager, never in the image or a public variable.
- The first admin is made from a machine that has the service key: `npm run admin -- create-admin ...` (see the
  README). There is no web page that can do it.

In Supabase, add the public address to **Authentication > URL Configuration** (Site URL and Redirect URLs).

## Hosting notes

- Serve it over HTTPS (most hosts do this for you).
- Behind a proxy or load balancer, set `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=1` so `getClientAddress()`
  returns the visitor's address (the rightmost `X-Forwarded-For` entry, which your proxy adds). The per-address
  limit on the `/api/tba/*` proxies depends on it.
- One instance is enough for a team. Team settings are cached for 30 seconds per instance, so with several instances a
  change can take that long to show everywhere.
- The Supabase free plan is enough for a season of scouting for one team. The cleanup check below warns admins before
  the limits are reached.

## Scheduled data cleanup check (optional)

Have a scheduler call the daily check with the cron token. It only sends admins a Slack DM when a cleanup is waiting
for approval, and never deletes anything itself ([Scouting Admin, Data](../scouting-admin/data.md#storage-and-data-cleanup)):

```sh
curl -X POST https://scouting.example.org/api/scouting-admin/retention-cron \
  -H "Authorization: Bearer $CRON_SECRET"
```

Optional limits: `RETENTION_DB_LIMIT_MB`, `RETENTION_STORAGE_LIMIT_MB` (environment variables, MB).

## Where to host it

The app is one Node.js server (SvelteKit's `adapter-node`) plus the database, so any host that runs a container or a
Node process works. A few that teams use:

| Host | How |
| --- | --- |
| **Google Cloud Run** | Build the image (`npm run docker:build`, or `gcloud builds submit` with `deploy/Dockerfile`), deploy it, and set the environment variables as Cloud Run secrets. It scales to zero between events. |
| **Firebase App Hosting** | Runs on Cloud Run underneath: connect the repository, keep the default Node build, and add the environment variables as App Hosting secrets. Firebase Hosting alone (static files) is not enough, because the app has a server. |
| **Render, Railway, Fly.io** | Point them at the repository or the Docker image; they read `PORT` themselves. |
| **A school or pit computer** | `npm run build`, then `node build` behind any reverse proxy, or run the Docker image. |

**The database** is Supabase (Postgres with sign-in and file storage). Use the hosted service, or run Supabase
yourself: it is open source and ships as Docker containers, so it also runs on a Google Cloud virtual machine next to
the app. Firestore or other non-Postgres databases are not supported: every query and every security rule is written
for Postgres.
