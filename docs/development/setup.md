# Setting up the app

This is the full guide for whoever runs the server. The [README](../../README.md) explains what the app is.

You need **Node.js 22 or newer**, a free **[Supabase](https://supabase.com)** project and a free
**[The Blue Alliance](https://www.thebluealliance.com/account) read API key**.

## 1. Get the code

```sh
git clone https://github.com/yuvanshankar30/frc-scoutingapp.git
cd frc-scoutingapp
npm install
```

## 2. Create the database

Create a project at [supabase.com](https://supabase.com), then run the two files in `supabase/migrations/`, in order:
the main schema first, then the security rules. Either:

- **Supabase CLI** (recommended): `npx supabase login`, `npx supabase link --project-ref <your-project-ref>`, then
  `npx supabase db push`.
- **SQL editor:** paste each file into the project's SQL editor and run it, main schema first.

The schema holds no team data. It creates the tables with row-level security, a trigger that gives every new account a
profile waiting for approval, and the storage buckets for pit photos and your logo.

Then in the Supabase dashboard, under **Authentication > URL Configuration**, set the **Site URL** to the address the
app will run at (`http://localhost:5173` for now) and add it to the **Redirect URLs**. Sign-up confirmation emails link
back to it.

## 3. Configure the server

```sh
cp .env.example .env
```

Fill in `.env` ([every variable is explained in Deployment](../architecture/deployment.md#environment)). The required ones:

| Variable | Where to find it |
| --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard > Project Settings > API |
| `SUPABASE_SERVICE_KEY` | Same page, the `service_role` key. Server only; never share or commit it |
| `APP_ORIGIN` | The address you open, e.g. `http://localhost:5173` |
| `TBA_API_KEY` | The Blue Alliance > Account > Read API Keys |

## 4. Make your admin account and set your team

The site has no setup screen. Make the first admin account from the command line, using the service key in `.env`:

```sh
npm run admin -- create-admin --email you@example.com --password 'a-long-password' --name "Your Name"
```

Then set your team, either the same way:

```sh
npm run admin -- set-team --number 1234 --name "Robo Raptors" --color "#2563eb" --timezone America/Chicago
```

or on the site after signing in, in **Scouting Admin > Team settings** (team number and name, other teams your members
compete for, app name, brand color, logo, default theme, timezone, which pages are in the menu, and whether people may
create their own accounts). Until a team is set, admins see a reminder at the top of every page.

`npm run admin -- help` lists every option; `npm run admin -- show` prints the current settings.

## 5. Run it

```sh
npm run dev
```

Open http://localhost:5173 and sign in with the admin account.

## 6. Bring your team in

- **People sign up** on the sign-in page ("Create an account"). New accounts can see nothing until an admin approves
  them in **Scouting Admin > People**. You can turn self sign-up off in Team settings.
- **Shared logins** for scouting tablets: sign up with a bare username like `pit1` (it becomes
  `pit1@scouting.local`, no email is sent), then approve it in Scouting Admin > People.
- Give people **competition roles** (Scouting Lead, Drive Team, Pit Crew, scout roles and so on) in Scouting Admin >
  People. The Competition Lead and the lead roles get Scouting Admin.

Then pick your event in **Scouting Admin > Event setup** and start scouting.
